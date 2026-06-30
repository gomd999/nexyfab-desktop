'use client';

// 완제품 평가 (Design Review) — upload a finished STEP/STL, measure its geometry
// client-side (Replicad/three importer, zero server graphics cost), then get an
// AI DFM-style evaluation report: strengths / issues / improvements / material
// fit / producibility / scores. Feeds the design→quote→order funnel.

import { use, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type * as THREE from 'three';
import { MATERIAL_PRESETS } from '@/app/[lang]/shape-generator/materials';

const EvaluateViewer = dynamic(() => import('./EvaluateViewer'), { ssr: false });
import type { ManufacturingProcess } from '@/app/[lang]/shape-generator/analysis/dfmAnalysis';

// Map the page's process ids → the DFM analyzer's ManufacturingProcess enum.
const DFM_PROCESS: Record<string, string> = {
  cnc: 'cnc_milling', '3d_print': '3d_printing', injection: 'injection_molding',
  sheet_metal: 'sheet_metal', casting: 'casting',
};

interface Metrics {
  volume_mm3: number;
  surface_area_mm2: number;
  bbox_mm: { w: number; h: number; d: number };
  sa_to_vol_ratio: number;
  aspect_ratio: number;
  smallest_dim_mm: number;
  triangle_count: number;
  mass_g: number | null;
}

interface Report {
  summary: string;
  scores: { manufacturability: number; cost: number; structure: number };
  strengths: string[];
  issues: string[];
  improvements: string[];
  material: { fit: string; note: string };
  producibility: { process: string; difficulty: string; note: string };
  estCostNote: string;
}

const PROCESSES = [
  { id: 'cnc', ko: 'CNC 절삭', en: 'CNC machining' },
  { id: '3d_print', ko: '3D 프린팅', en: '3D printing' },
  { id: 'injection', ko: '사출 성형', en: 'Injection molding' },
  { id: 'sheet_metal', ko: '판금', en: 'Sheet metal' },
  { id: 'casting', ko: '주조', en: 'Casting' },
];

export default function EvaluatePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const ko = lang === 'ko' || lang === 'kr';
  const T = (k: string, e: string) => (ko ? k : e);

  const [filename, setFilename] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [material, setMaterial] = useState('aluminum');
  const [process, setProcess] = useState('cnc');
  const [importing, setImporting] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [dfmCount, setDfmCount] = useState<{ error: number; warning: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  const [highlightTris, setHighlightTris] = useState<number[]>([]);
  const [fitKey, setFitKey] = useState(0);
  const [history, setHistory] = useState<Array<{ id: string; filename: string; material: string; process: string; created_at: number; report: Report | null }>>([]);
  const geoRef = useRef<THREE.BufferGeometry | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/nexyfab/reviews', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({})) as { reviews?: typeof history };
      if (Array.isArray(data.reviews)) setHistory(data.reviews);
    } catch { /* guest / offline — no history */ }
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setErr(null); setReport(null); setMetrics(null); setImporting(true); setFilename(file.name);
    try {
      const { prepareImportedShapeFromFile } = await import('@/app/[lang]/shape-generator/io/importMeshPipeline');
      const prepared = await prepareImportedShapeFromFile(file);
      geoRef.current = prepared.geometry;
      setGeo(prepared.geometry);
      setHighlightTris([]);
      setFitKey(k => k + 1);
      setDfmCount(null);
      const vol = Math.max(1e-6, prepared.volume_cm3 * 1000); // mm³
      const sa = prepared.surface_area_cm2 * 100; // mm²
      const { w, h, d } = prepared.bbox;
      const dims = [w, h, d].filter(n => n > 0);
      const smallest = dims.length ? Math.min(...dims) : 0;
      const largest = dims.length ? Math.max(...dims) : 0;
      const tri = (prepared.geometry.getAttribute('position')?.count ?? 0) / 3;
      const density = MATERIAL_PRESETS.find(m => m.id === material)?.density ?? null;
      setMetrics({
        volume_mm3: Math.round(vol),
        surface_area_mm2: Math.round(sa),
        bbox_mm: { w, h, d },
        sa_to_vol_ratio: Math.round((sa / vol) * 1000) / 1000,
        aspect_ratio: smallest > 0 ? Math.round((largest / smallest) * 10) / 10 : 0,
        smallest_dim_mm: Math.round(smallest * 10) / 10,
        triangle_count: Math.round(tri),
        mass_g: density != null ? Math.round((prepared.volume_cm3 * density) * 10) / 10 : null,
      });
    } catch (e) {
      setErr(T('파일을 읽지 못했어요. STEP/STL을 확인해 주세요.', 'Could not read the file — check the STEP/STL.') + ` (${(e as Error)?.message ?? e})`);
      setFilename(null);
    } finally {
      setImporting(false);
    }
  }, [material, T]);

  const evaluate = useCallback(async () => {
    if (!metrics) return;
    setEvaluating(true); setErr(null); setReport(null);
    try {
      // Recompute mass for the currently-selected material so it matches the report.
      const density = MATERIAL_PRESETS.find(m => m.id === material)?.density ?? null;
      const massG = density != null ? Math.round((metrics.volume_mm3 / 1000) * density * 10) / 10 : null;

      // Real DFM analysis (client-side) for the chosen process → ground-truth
      // issues (thin wall / undercut / aspect / sharp corner …) fed to the AI.
      let dfmIssues: Array<{ type: string; severity: string; description: string; suggestion?: string }> = [];
      if (geoRef.current) {
        try {
          const { analyzeDFM } = await import('@/app/[lang]/shape-generator/analysis/dfmAnalysis');
          const proc = (DFM_PROCESS[process] ?? 'cnc_milling') as ManufacturingProcess;
          const results = analyzeDFM(geoRef.current, [proc]);
          const allIssues = results.flatMap(r => r.issues);
          dfmIssues = allIssues.map(i => ({ type: i.type, severity: i.severity, description: i.description, suggestion: i.suggestion }));
          setDfmCount({ error: dfmIssues.filter(i => i.severity === 'error').length, warning: dfmIssues.filter(i => i.severity === 'warning').length });
          // Triangle indices of error/warning faces → 3D overlay highlight.
          const tris = allIssues.filter(i => i.severity !== 'info').flatMap(i => i.faceIndices ?? []);
          setHighlightTris(Array.from(new Set(tris)));
        } catch { /* DFM optional — fall back to metrics-only */ }
      }

      const res = await fetch('/api/nexyfab/evaluate-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ metrics: { ...metrics, mass_g: massG }, material, process, filename, lang, dfmIssues }),
      });
      const data = await res.json().catch(() => ({})) as { report?: Report; error?: string };
      if (!res.ok || !data.report) { setErr(data.error || T('평가에 실패했어요.', 'Evaluation failed.')); return; }
      setReport(data.report);
      // Persist to history (fire-and-forget; guests get 401 and are skipped).
      void fetch('/api/nexyfab/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ filename, material, process, metrics, report: data.report }),
      }).then(r => { if (r.ok) void loadHistory(); }).catch(() => {});
    } catch (e) {
      setErr(String(e));
    } finally {
      setEvaluating(false);
    }
  }, [metrics, material, process, filename, lang, T, loadHistory]);

  const matName = (m: typeof MATERIAL_PRESETS[number]) => (ko ? m.name.ko : m.name.en);
  const scoreColor = (n: number) => (n >= 75 ? '#22c55e' : n >= 50 ? '#eab308' : '#ef4444');

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto text-[var(--nx-text,#e6edf3)]">
      {/* Print: keep only the report, drop the rail + upload chrome so "Save as
          PDF" yields a clean customer deliverable (Korean-safe via the browser). */}
      <style>{`@media print {
        .nf-uni-nav, .review-noprint { display: none !important; }
        #review-report { box-shadow: none !important; }
        body { background: #fff !important; }
        #review-report, #review-report * { color: #111 !important; }
      }`}</style>
      <div className="review-noprint">
        <h1 className="text-2xl font-bold mb-1">📋 {T('완제품 평가', 'Design Review')}</h1>
        <p className="text-sm opacity-70 mb-6">
          {T('STEP/STL 완제품을 올리면 제조성·재질·생산성·비용을 종합 평가해 드립니다.',
            'Upload a finished STEP/STL and get a full manufacturability, material, producibility & cost review.')}
        </p>
      </div>

      {/* Upload + options */}
      <div className="review-noprint rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-6">
        <div className="flex flex-col md:flex-row gap-4 md:items-end">
          <label className="flex-1">
            <span className="block text-xs opacity-70 mb-1.5">{T('파일 (STEP / STL)', 'File (STEP / STL)')}</span>
            <input type="file" accept=".step,.stp,.stl,model/step,model/stl"
              onChange={e => { void onFile(e.target.files?.[0]); }}
              className="block w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-md file:border-0 file:bg-blue-600 file:text-white file:cursor-pointer file:text-xs" />
          </label>
          <label>
            <span className="block text-xs opacity-70 mb-1.5">{T('재질', 'Material')}</span>
            <select value={material} onChange={e => setMaterial(e.target.value)}
              className="bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm">
              {MATERIAL_PRESETS.map(m => <option key={m.id} value={m.id}>{matName(m)}</option>)}
            </select>
          </label>
          <label>
            <span className="block text-xs opacity-70 mb-1.5">{T('공정', 'Process')}</span>
            <select value={process} onChange={e => setProcess(e.target.value)}
              className="bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm">
              {PROCESSES.map(p => <option key={p.id} value={p.id}>{ko ? p.ko : p.en}</option>)}
            </select>
          </label>
        </div>

        {importing && <div className="mt-4 text-sm text-blue-300">⏳ {T('형상 분석 중…', 'Measuring geometry…')}</div>}

        {metrics && (
          <div className="mt-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Metric label={T('부피', 'Volume')} value={`${(metrics.volume_mm3 / 1000).toFixed(2)} cm³`} />
              <Metric label={T('표면적', 'Surface')} value={`${(metrics.surface_area_mm2 / 100).toFixed(1)} cm²`} />
              <Metric label={T('치수', 'Bounding box')} value={`${metrics.bbox_mm.w}×${metrics.bbox_mm.h}×${metrics.bbox_mm.d}`} />
              <Metric label={T('질량', 'Mass')} value={metrics.mass_g != null ? `${metrics.mass_g} g` : '—'} />
              <Metric label={T('최소 치수', 'Min dim')} value={`${metrics.smallest_dim_mm} mm`} />
              <Metric label={T('종횡비', 'Aspect')} value={`${metrics.aspect_ratio}×`} />
              <Metric label={T('삼각형', 'Triangles')} value={metrics.triangle_count.toLocaleString()} />
            </div>
            <button onClick={() => void evaluate()} disabled={evaluating}
              className="mt-5 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-bold">
              {evaluating ? T('평가 중…', 'Evaluating…') : T('✨ 종합 평가하기', '✨ Run full review')}
            </button>
          </div>
        )}
      </div>

      {/* 3D viewer — shows the part and (after evaluation) highlights the DFM
          problem faces in red. review-noprint: a WebGL canvas prints unreliably,
          so the PDF stays the clean text report. */}
      {geo && (
        <div className="review-noprint rounded-xl border border-white/10 bg-white/[0.03] p-2 mb-6">
          <div style={{ height: 380 }} className="rounded-lg overflow-hidden">
            <EvaluateViewer geometry={geo} highlightTris={highlightTris} fitKey={fitKey} />
          </div>
          {highlightTris.length > 0 && (
            <div className="text-xs opacity-70 px-2 py-1.5 flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#ef4444' }} />
              {T('빨간 영역 = DFM 문제 면 (얇은 벽 / 언더컷 / 날카로운 모서리 등)', 'Red = DFM problem faces (thin wall / undercut / sharp corners …)')}
            </div>
          )}
        </div>
      )}

      {err && <div className="review-noprint rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 text-sm p-3 mb-6">{err}</div>}

      {/* Report */}
      {report && (
        <div id="review-report" className="space-y-5">
          <div className="review-noprint flex items-center justify-between gap-3">
            <div className="text-xs opacity-70">
              {filename}
              {dfmCount ? ` · ${T('자동 DFM', 'Auto DFM')}: ${T('오류', 'err')} ${dfmCount.error} · ${T('경고', 'warn')} ${dfmCount.warning}` : ''}
            </div>
            <button onClick={() => window.print()} className="text-xs border border-white/15 rounded-md px-3 py-1.5 hover:bg-white/5 shrink-0">
              📄 {T('PDF로 저장', 'Save as PDF')}
            </button>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-base font-bold mb-2 print:block hidden">📋 {T('완제품 평가 보고서', 'Design Review Report')} — {filename}</div>
            <div className="text-sm leading-relaxed">{report.summary}</div>
            <div className="grid grid-cols-3 gap-3 mt-4">
              {([['manufacturability', T('제조성', 'Manufacturability')], ['cost', T('비용 효율', 'Cost')], ['structure', T('구조', 'Structure')]] as const).map(([k, lbl]) => {
                const n = report.scores?.[k] ?? 0;
                return (
                  <div key={k}>
                    <div className="flex justify-between text-xs opacity-70 mb-1"><span>{lbl}</span><span style={{ color: scoreColor(n) }}>{n}</span></div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, n))}%`, background: scoreColor(n) }} /></div>
                  </div>
                );
              })}
            </div>
          </div>

          <ListCard title={T('✅ 잘한 점', '✅ Strengths')} items={report.strengths} color="#22c55e" />
          <ListCard title={T('⚠️ 문제점', '⚠️ Issues')} items={report.issues} color="#eab308" />
          <ListCard title={T('💡 개선점', '💡 Improvements')} items={report.improvements} color="#60a5fa" />

          <div className="grid md:grid-cols-2 gap-5">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-sm font-bold mb-2">🧱 {T('재질 적합성', 'Material fit')}</div>
              <div className="text-sm"><span className="opacity-70">{report.material?.fit}</span></div>
              <div className="text-sm opacity-70 mt-1">{report.material?.note}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-sm font-bold mb-2">🏭 {T('생산성', 'Producibility')}</div>
              <div className="text-sm">{report.producibility?.process} · <span style={{ color: report.producibility?.difficulty === 'high' ? '#ef4444' : report.producibility?.difficulty === 'medium' ? '#eab308' : '#22c55e' }}>{report.producibility?.difficulty}</span></div>
              <div className="text-sm opacity-70 mt-1">{report.producibility?.note}</div>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm font-bold mb-1">💰 {T('비용 메모', 'Cost driver')}</div>
            <div className="text-sm opacity-70">{report.estCostNote}</div>
          </div>

          <a href={`/${lang}/quick-quote`} className="block text-center bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-2.5 text-sm font-bold">
            {T('💵 이 부품으로 견적받기', '💵 Get a quote for this part')}
          </a>
        </div>
      )}

      {/* History — past reviews for this user (server-saved). Click to re-view. */}
      {history.length > 0 && (
        <div className="review-noprint mt-8">
          <div className="text-sm font-bold mb-2 opacity-80">🕘 {T('최근 평가', 'Recent reviews')}</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {history.map(h => (
              <button key={h.id} onClick={() => { if (h.report) { setReport(h.report); window.scrollTo({ top: 0, behavior: 'smooth' }); } }}
                className="text-left rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] px-3 py-2">
                <div className="text-sm font-medium truncate">{h.filename}</div>
                <div className="text-xs opacity-60 flex gap-2 mt-0.5 flex-wrap">
                  <span>{new Date(h.created_at).toLocaleDateString(ko ? 'ko-KR' : 'en-US')}</span>
                  {h.material ? <span>· {h.material}</span> : null}
                  {h.report?.scores ? <span>· {T('제조성', 'Mfg')} {h.report.scores.manufacturability}</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide opacity-50">{label}</div>
      <div className="text-sm font-semibold mt-0.5">{value}</div>
    </div>
  );
}

function ListCard({ title, items, color }: { title: string; items: string[]; color: string }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
      <div className="text-sm font-bold mb-2">{title}</div>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="text-sm flex gap-2"><span style={{ color }}>•</span><span className="opacity-90">{it}</span></li>
        ))}
      </ul>
    </div>
  );
}
