'use client';

// 완제품 평가 (Design Review) — upload a finished STEP/STL, measure its geometry
// client-side (Replicad/three importer, zero server graphics cost), then get an
// AI DFM-style evaluation report: strengths / issues / improvements / material
// fit / producibility / scores. Feeds the design→quote→order funnel.

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

interface CostEstimate {
  currency: string;
  process?: string;
  region: string;
  perPart: { min: number; max: number };
  total: { min: number; max: number };
  leadDays?: { min: number; max: number };
  confidence: string;
  calibrated: boolean;
  complexity?: number;
  drivers: string[];
  note: string;
}

interface CostComparison {
  quantity: number;
  options: CostEstimate[];
  cheapest: { process: string; region: string; perPartMid: number };
  notes: string[];
}

interface CostCurvePoint { quantity: number; perPartMid: number; total: number }

interface Structural { stressMPa: number; safetyFactor: number; loadN: number; assumption: string; reliable: boolean }

// Load-based structural ESTIMATE (transparent cantilever-beam approximation —
// NOT a full FEA). Treats the bounding box as a cantilever: weak-axis section
// modulus from the two smaller dims, length = longest dim, moment from the tip
// load + self-weight. Gives a conservative max-bending-stress + safety factor.
function structuralEstimate(metrics: Metrics, materialId: string, loadN: number): Structural | null {
  const yieldMPa = MATERIAL_PRESETS.find(m => m.id === materialId)?.yieldStrength;
  if (!yieldMPa) return null;
  const dims = [metrics.bbox_mm.w, metrics.bbox_mm.h, metrics.bbox_mm.d].filter(n => n > 0).sort((a, b) => a - b);
  if (dims.length < 3) return null;
  const [h, b, L] = dims; // h = smallest (bending depth, worst case), b = middle, L = longest (lever)
  const Z = (b * h * h) / 6; // mm³ section modulus
  if (!(Z > 0)) return null;
  const W = ((metrics.mass_g ?? 0) / 1000) * 9.81; // N self-weight
  const M = loadN * L + (W * L) / 2; // N·mm
  const stress = M / Z; // MPa
  const sf = stress > 0 ? yieldMPa / stress : 999;
  // Solidity = part volume / bbox volume. The beam formula assumes a SOLID bbox
  // cross-section; for a thin shell / hollow part (low solidity) the stiffness —
  // and thus the safety factor — is massively overstated, so flag it unreliable.
  const bboxVol = b * h * L;
  const solidity = bboxVol > 0 ? metrics.volume_mm3 / bboxVol : 1;
  return {
    stressMPa: Math.round(stress * 10) / 10,
    safetyFactor: Math.round(Math.min(sf, 999) * 10) / 10,
    loadN,
    assumption: 'cantilever, weak-axis bending',
    reliable: solidity >= 0.4,
  };
}

const UNIT_FACTOR: Record<string, number> = { mm: 1, cm: 10, inch: 25.4 };

/** Build the metric set from the importer's native (mm) values scaled by the
 *  chosen unit factor — so an inch/cm file gets correct mm-based metrics + DFM. */
function computeMetrics(
  rawVolCm3: number, rawSaCm2: number, bbox: { w: number; h: number; d: number },
  triCount: number, f: number, density: number | null,
): Metrics {
  const vol = Math.max(1e-6, rawVolCm3 * 1000 * f * f * f); // mm³
  const sa = rawSaCm2 * 100 * f * f;                        // mm²
  const w = bbox.w * f, h = bbox.h * f, d = bbox.d * f;
  const dims = [w, h, d].filter(n => n > 0);
  const smallest = dims.length ? Math.min(...dims) : 0;
  const largest = dims.length ? Math.max(...dims) : 0;
  const volCm3 = rawVolCm3 * f * f * f;
  return {
    volume_mm3: Math.round(vol),
    surface_area_mm2: Math.round(sa),
    bbox_mm: { w: Math.round(w), h: Math.round(h), d: Math.round(d) },
    sa_to_vol_ratio: Math.round((sa / vol) * 1000) / 1000,
    aspect_ratio: smallest > 0 ? Math.round((largest / smallest) * 10) / 10 : 0,
    smallest_dim_mm: Math.round(smallest * 10) / 10,
    triangle_count: triCount,
    mass_g: density != null ? Math.round(volCm3 * density * 10) / 10 : null,
  };
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
  const [loadN, setLoadN] = useState(50);
  const [quantity, setQuantity] = useState(100);
  const [unit, setUnit] = useState<'mm' | 'cm' | 'inch'>('mm');
  const [pullAxis, setPullAxis] = useState<'+y' | '-y' | '+x' | '-x' | '+z' | '-z' | 'auto'>('auto');
  const [meshQuality, setMeshQuality] = useState<{ watertight: boolean; reliable: boolean; openEdgeRatio: number; degenerateRatio: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [costComparison, setCostComparison] = useState<CostComparison | null>(null);
  const [costCurve, setCostCurve] = useState<CostCurvePoint[] | null>(null);
  const [costLocked, setCostLocked] = useState(false);
  const [dfmCount, setDfmCount] = useState<{ error: number; warning: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);
  const [highlightTris, setHighlightTris] = useState<number[]>([]);
  const [fitKey, setFitKey] = useState(0);
  const [history, setHistory] = useState<Array<{ id: string; filename: string; material: string; process: string; created_at: number; report: Report | null }>>([]);
  const geoRef = useRef<THREE.BufferGeometry | null>(null);
  const rawRef = useRef<{ volume_cm3: number; surface_area_cm2: number; bbox: { w: number; h: number; d: number }; triCount: number } | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/nexyfab/reviews', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json().catch(() => ({})) as { reviews?: typeof history };
      if (Array.isArray(data.reviews)) setHistory(data.reviews);
    } catch { /* guest / offline — no history */ }
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // Load-based structural estimate (recomputes with metrics / material / load).
  const structural = useMemo(() => (metrics ? structuralEstimate(metrics, material, loadN) : null), [metrics, material, loadN]);

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
      const tri = Math.round((prepared.geometry.getAttribute('position')?.count ?? 0) / 3);
      rawRef.current = { volume_cm3: prepared.volume_cm3, surface_area_cm2: prepared.surface_area_cm2, bbox: prepared.bbox, triCount: tri };
      // Mesh quality — non-watertight / degenerate meshes make DFM unreliable.
      try {
        const { assessMeshQuality } = await import('@/lib/meshQuality');
        const q = assessMeshQuality(prepared.geometry);
        setMeshQuality({ watertight: q.watertight, reliable: q.reliable, openEdgeRatio: q.openEdgeRatio, degenerateRatio: q.degenerateRatio });
      } catch { setMeshQuality(null); }
      const density = MATERIAL_PRESETS.find(m => m.id === material)?.density ?? null;
      setMetrics(computeMetrics(prepared.volume_cm3, prepared.surface_area_cm2, prepared.bbox, tri, UNIT_FACTOR[unit], density));
    } catch (e) {
      setErr(T('파일을 읽지 못했어요. STEP/STL을 확인해 주세요.', 'Could not read the file — check the STEP/STL.') + ` (${(e as Error)?.message ?? e})`);
      setFilename(null);
    } finally {
      setImporting(false);
    }
  }, [material, unit, T]);

  // Re-derive metrics when the unit or material changes (without re-importing).
  useEffect(() => {
    const raw = rawRef.current;
    if (!raw) return;
    const density = MATERIAL_PRESETS.find(m => m.id === material)?.density ?? null;
    setMetrics(computeMetrics(raw.volume_cm3, raw.surface_area_cm2, raw.bbox, raw.triCount, UNIT_FACTOR[unit], density));
  }, [unit, material]);

  // 빠른 견적 → 완제품 평가 핸드오프: quick-quote가 sessionStorage에 실어둔 파일을
  // 그대로 불러와 자동 분석한다. 한 번만 소비(제거).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('nexyfab:evaluate-file');
      if (!raw) return;
      sessionStorage.removeItem('nexyfab:evaluate-file');
      const { name, b64 } = JSON.parse(raw) as { name: string; b64: string };
      if (!name || !b64) return;
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      void onFile(new File([bytes], name, { type: 'application/step' }));
    } catch { /* 손상된 stash → 사용자가 직접 업로드 */ }
    // Mount-only: onFile identity changes with material/unit, but the stash is
    // consumed on first read so re-runs are no-ops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const evaluate = useCallback(async () => {
    if (!metrics) return;
    setEvaluating(true); setErr(null); setReport(null); setCostEstimate(null); setCostComparison(null); setCostCurve(null); setCostLocked(false);
    try {
      // Recompute mass for the currently-selected material so it matches the report.
      const density = MATERIAL_PRESETS.find(m => m.id === material)?.density ?? null;
      const massG = density != null ? Math.round((metrics.volume_mm3 / 1000) * density * 10) / 10 : null;

      // Real DFM analysis (client-side) for the chosen process → ground-truth
      // issues (thin wall / undercut / aspect / sharp corner …) fed to the AI.
      let dfmIssues: Array<{ type: string; severity: string; description: string; suggestion?: string }> = [];
      // DFM signals feed the parametric cost model (undercut→5-axis/slides, etc.).
      let dfmSignals: {
        undercutCount?: number; sharpCornerCount?: number; featureCount?: number;
        deepPocket?: boolean; thinWall?: boolean; errorCount?: number; warningCount?: number;
      } = {};
      if (geoRef.current) {
        try {
          const { analyzeDFM } = await import('@/app/[lang]/shape-generator/analysis/dfmAnalysis');
          const proc = (DFM_PROCESS[process] ?? 'cnc_milling') as ManufacturingProcess;
          // Scale to mm for the chosen unit; injection passes the pull axis.
          const f = UNIT_FACTOR[unit];
          let dfmGeo = geoRef.current;
          if (f !== 1) { dfmGeo = geoRef.current.clone(); dfmGeo.scale(f, f, f); }
          const results = analyzeDFM(dfmGeo, [proc], process === 'injection' ? { pullAxis } : undefined);
          const allIssues = results.flatMap(r => r.issues);
          dfmIssues = allIssues.map(i => ({ type: i.type, severity: i.severity, description: i.description, suggestion: i.suggestion }));
          const errorCount = dfmIssues.filter(i => i.severity === 'error').length;
          const warningCount = dfmIssues.filter(i => i.severity === 'warning').length;
          setDfmCount({ error: errorCount, warning: warningCount });
          const facesOf = (t: string) => allIssues.filter(i => i.type === t).reduce((s, i) => s + (i.faceIndices?.length ?? 0), 0);
          dfmSignals = {
            undercutCount: facesOf('undercut'),
            sharpCornerCount: facesOf('sharp_corner'),
            deepPocket: allIssues.some(i => i.type === 'deep_pocket' || i.type === 'aspect_ratio'),
            thinWall: allIssues.some(i => i.type === 'thin_wall' || i.type === 'uniform_wall'),
            errorCount, warningCount,
          };
          // Triangle indices of error/warning faces → 3D overlay highlight.
          const tris = allIssues.filter(i => i.severity !== 'info').flatMap(i => i.faceIndices ?? []);
          setHighlightTris(Array.from(new Set(tris)));
        } catch { /* DFM optional — fall back to metrics-only */ }
      }

      const res = await fetch('/api/nexyfab/evaluate-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          metrics: { ...metrics, mass_g: massG }, material, process, filename, lang, dfmIssues,
          structural: structural?.reliable ? structural : null,
          quantity, unit, dfmSignals,
          pullAxis: process === 'injection' ? pullAxis : undefined,
          meshReliable: meshQuality ? meshQuality.reliable : true,
          materialProps: (() => { const m = MATERIAL_PRESETS.find(x => x.id === material); return m ? { density: m.density, yieldStrength: m.yieldStrength, youngsModulus: m.youngsModulus } : null; })(),
        }),
      });
      const data = await res.json().catch(() => ({})) as { report?: Report; costEstimate?: CostEstimate | null; costComparison?: CostComparison | null; costCurve?: CostCurvePoint[] | null; costLocked?: boolean; error?: string };
      if (!res.ok || !data.report) { setErr(data.error || T('평가에 실패했어요.', 'Evaluation failed.')); return; }
      setReport(data.report);
      setCostEstimate(data.costEstimate ?? null);
      setCostComparison(data.costComparison ?? null);
      setCostCurve(data.costCurve ?? null);
      setCostLocked(!!data.costLocked);
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
  }, [metrics, material, process, filename, lang, T, loadHistory, structural, quantity, unit, pullAxis, meshQuality]);

  const matName = (m: typeof MATERIAL_PRESETS[number]) => (ko ? m.name.ko : m.name.en);
  const scoreColor = (n: number) => (n >= 75 ? '#22c55e' : n >= 50 ? '#eab308' : '#ef4444');
  // Quote URL prefilled with geometry; extra carries process/region context.
  const quoteUrl = (extra = '') => (metrics
    ? `/${lang}/quick-quote?from=shape-generator&volume_cm3=${(metrics.volume_mm3 / 1000).toFixed(2)}&surface_area_cm2=${(metrics.surface_area_mm2 / 100).toFixed(2)}&bbox_w=${Math.round(metrics.bbox_mm.w)}&bbox_h=${Math.round(metrics.bbox_mm.h)}&bbox_d=${Math.round(metrics.bbox_mm.d)}${extra}`
    : `/${lang}/quick-quote`);

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
        {/* Big, obvious drop zone */}
        <label
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); void onFile(e.dataTransfer.files?.[0]); }}
          className={`block cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${dragOver ? 'border-blue-500 bg-blue-500/10' : 'border-white/20 hover:border-blue-500/60 hover:bg-white/[0.02]'}`}
        >
          <div className="text-4xl mb-2">📤</div>
          <div className="text-sm font-semibold">
            {filename
              ? `📄 ${filename}`
              : T('STEP / STL 파일을 여기로 끌어다 놓거나 클릭하세요', 'Drop a STEP / STL file here, or click to choose')}
          </div>
          <div className="text-xs opacity-50 mt-1">.step · .stp · .stl{filename ? T(' — 다른 파일로 바꾸려면 클릭', ' — click to replace') : ''}</div>
          <input type="file" accept=".step,.stp,.stl,model/step,model/stl" className="hidden"
            onChange={e => { void onFile(e.target.files?.[0]); }} />
        </label>

        {/* Options */}
        <div className="flex flex-wrap gap-4 mt-4">
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
          {process === 'injection' && (
            <label title={T('사출 빼기 방향 (드래프트·언더컷 판정 기준축)', 'Mold pull direction (axis for draft/undercut checks)')}>
              <span className="block text-xs opacity-70 mb-1.5">{T('빼기 방향', 'Pull dir')}</span>
              <select value={pullAxis} onChange={e => setPullAxis(e.target.value as typeof pullAxis)}
                className="bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm">
                <option value="auto">{T('자동', 'Auto')}</option>
                <option value="+y">+Y</option><option value="-y">-Y</option>
                <option value="+x">+X</option><option value="-x">-X</option>
                <option value="+z">+Z</option><option value="-z">-Z</option>
              </select>
            </label>
          )}
          <label title={T('파일 단위 (잘못되면 치수·DFM이 전부 어긋남)', 'File unit (wrong unit skews all dimensions & DFM)')}>
            <span className="block text-xs opacity-70 mb-1.5">{T('단위', 'Unit')}</span>
            <select value={unit} onChange={e => setUnit(e.target.value as typeof unit)}
              className="bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm">
              <option value="mm">mm</option><option value="cm">cm</option><option value="inch">inch</option>
            </select>
          </label>
          <label title={T('경제성(공정 선택)용 목표 수량', 'Target quantity for the economics / process recommendation')}>
            <span className="block text-xs opacity-70 mb-1.5">{T('수량', 'Quantity')}</span>
            <input type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              className="w-24 bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm" />
          </label>
          <label title={T('구조 추정용 적용 하중 (보 근사)', 'Applied load for the structural estimate (beam approx)')}>
            <span className="block text-xs opacity-70 mb-1.5">{T('하중 (N)', 'Load (N)')}</span>
            <input type="number" min={0} value={loadN} onChange={e => setLoadN(Math.max(0, Number(e.target.value) || 0))}
              className="w-20 bg-white/5 border border-white/15 rounded-md px-2 py-2 text-sm" />
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
            {meshQuality && !meshQuality.reliable && (
              <div className="mt-3 text-xs rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300/90 px-3 py-2">
                ⚠️ {T(
                  `메시 품질이 낮습니다 (비방수/퇴화 — 열린 엣지 ${(meshQuality.openEdgeRatio * 100).toFixed(0)}%). 벽두께·언더컷 등 DFM이 부정확(거짓 양성)할 수 있어 참고용입니다. 가능하면 솔리드 STEP로 올려주세요.`,
                  `Low mesh quality (non-watertight/degenerate — ${(meshQuality.openEdgeRatio * 100).toFixed(0)}% open edges). Wall-thickness / undercut DFM may be inaccurate (false positives) — treat as indicative; prefer a solid STEP.`)}
              </div>
            )}
            {structural && (
              structural.reliable ? (
                <div className="mt-3 text-xs rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2">
                  🏗 {T('구조 추정 (보 근사)', 'Structural estimate (beam approx)')}: {T('하중', 'load')} {loadN}N → {T('최대응력', 'max stress')} {structural.stressMPa} MPa · {T('안전계수', 'SF')}{' '}
                  <span className="font-bold" style={{ color: structural.safetyFactor >= 2 ? '#22c55e' : structural.safetyFactor >= 1 ? '#eab308' : '#ef4444' }}>{structural.safetyFactor}×</span>
                  <span className="opacity-50"> · {T('정밀 해석은 모델러 FEA에서', 'full FEA in the modeler')}</span>
                </div>
              ) : (
                <div className="mt-3 text-xs rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300/90 px-3 py-2">
                  🏗 {T('얇은/중공 형상이라 보 근사 구조 추정은 신뢰도가 낮아 생략합니다. 정확한 구조 해석은 모델러 FEA(하중·구속 설정)를 이용하세요.',
                    'Thin/hollow geometry — the beam-approx structural estimate is unreliable, so it is skipped. Use the modeler FEA (set loads/constraints) for an accurate analysis.')}
                </div>
              )
            )}
            <button onClick={() => void evaluate()} disabled={evaluating}
              className="mt-3 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-bold">
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

          {costLocked && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-5 text-center">
              <div className="text-sm font-bold mb-1">🔒 {T('예상 견적·수량곡선·공정비교는 PRO 전용', 'Price estimate · quantity curve · comparison are PRO')}</div>
              <div className="text-sm opacity-75 mb-3">{T('DFM·재질·구조 평가는 무료로 보셨습니다. AI 비교견적(개당 단가·수량별 곡선·한·중 공정 비교)은 PRO에서 열립니다.', 'The DFM/material/structure review is free. Unlock the AI cost comparison (per-part price, quantity curve, KR/CN process comparison) with PRO.')}</div>
              <a href={`/${lang}/nexyfab/billing`} className="inline-block bg-amber-500 hover:bg-amber-400 text-black rounded-lg px-4 py-2 text-sm font-bold">{T('⭐ PRO로 업그레이드', '⭐ Upgrade to PRO')}</a>
            </div>
          )}

          {costEstimate && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.06] p-5">
              <div className="text-sm font-bold mb-1">📟 {T('예상 견적 범위', 'Estimated price range')} <span className="text-[11px] font-normal opacity-60">({costEstimate.region.toUpperCase()} · {costEstimate.calibrated ? T('실견적 보정', 'calibrated') : T('개략치', 'seed rates')})</span></div>
              <div className="text-lg font-bold">{costEstimate.perPart.min.toLocaleString()}~{costEstimate.perPart.max.toLocaleString()}{T('원', ' KRW')} <span className="text-xs font-normal opacity-70">/{T('개', 'ea')}</span></div>
              <div className="text-sm opacity-80">{T('총', 'Total')} {costEstimate.total.min.toLocaleString()}~{costEstimate.total.max.toLocaleString()}{T('원', ' KRW')}</div>
              {costEstimate.drivers.length > 0 && <div className="text-xs opacity-60 mt-1.5">{costEstimate.drivers.join(' · ')}</div>}
              {costCurve && costCurve.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/10">
                  <div className="text-[11px] opacity-60 mb-1">{T('수량별 개당 단가', 'Per-part by quantity')}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {costCurve.map(p => (
                      <span key={p.quantity}><span className="opacity-55">{p.quantity.toLocaleString()}{T('개', '')}</span> {p.perPartMid.toLocaleString()}{T('원', '')}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-[11px] opacity-60 mt-2">⚠️ {costEstimate.note}</div>
            </div>
          )}

          {costComparison && costComparison.options.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
              <div className="text-sm font-bold mb-2">🔀 {T('공정·지역 비교견적', 'Process × region comparison')} <span className="text-[11px] font-normal opacity-60">({T('수량', 'qty')} {costComparison.quantity.toLocaleString()})</span></div>
              <table className="w-full text-xs">
                <thead><tr className="opacity-60 border-b border-white/10">
                  <th className="text-left py-1 font-medium">{T('공정', 'Process')}</th>
                  <th className="text-left font-medium">{T('지역', 'Region')}</th>
                  <th className="text-right font-medium">{T('개당(원)', 'Per ea (KRW)')}</th>
                  <th className="text-right font-medium">{T('납기(일)', 'Lead (d)')}</th>
                  <th className="text-right font-medium">{T('요청', 'Act')}</th>
                </tr></thead>
                <tbody>
                  {costComparison.options.slice(0, 6).map((o, i) => {
                    const label = ({ cnc: 'CNC', injection: T('사출', 'Injection'), sheet_metal: T('판금', 'Sheet'), '3d_print': T('3D 프린팅', '3D print'), casting: T('주조', 'Casting') } as Record<string, string>)[o.process ?? ''] ?? o.process;
                    const best = i === 0;
                    return (
                      <tr key={i} className={best ? 'text-emerald-400 font-semibold' : ''}>
                        <td className="py-1">{label}{best ? ' ★' : ''}</td>
                        <td>{o.region.toUpperCase()}</td>
                        <td className="text-right">{o.perPart.min.toLocaleString()}~{o.perPart.max.toLocaleString()}</td>
                        <td className="text-right opacity-70">{o.leadDays ? `${o.leadDays.min}~${o.leadDays.max}` : '-'}</td>
                        <td className="text-right whitespace-nowrap">
                          <a href={quoteUrl(`&process=${o.process}&region=${o.region}`)} className="text-blue-400 hover:underline mr-2" title={T('이 조건으로 견적요청', 'Request a quote')}>💵</a>
                          <a href={`/${lang}/factories`} className="text-blue-400 hover:underline" title={T('이 지역 공장 찾기', 'Find factories')}>🏭</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {costComparison.notes.length > 0 && <div className="text-[11px] opacity-70 mt-2">💡 {costComparison.notes.join(' ')}</div>}
              <div className="text-[11px] opacity-50 mt-1">{T('개략치 — 확정은 실견적으로', 'Estimate — confirm with a real quote')}</div>
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-sm font-bold mb-1">💰 {T('비용 메모', 'Cost driver')}</div>
            <div className="text-sm opacity-70">{report.estCostNote}</div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <a
              href={metrics
                ? `/${lang}/quick-quote?from=shape-generator&volume_cm3=${(metrics.volume_mm3 / 1000).toFixed(2)}&surface_area_cm2=${(metrics.surface_area_mm2 / 100).toFixed(2)}&bbox_w=${Math.round(metrics.bbox_mm.w)}&bbox_h=${Math.round(metrics.bbox_mm.h)}&bbox_d=${Math.round(metrics.bbox_mm.d)}`
                : `/${lang}/quick-quote`}
              className="block text-center bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-2.5 text-sm font-bold">
              {costComparison
                ? T(`💵 ${costComparison.cheapest.region.toUpperCase()} 최저가로 실견적 요청`, '💵 Request a real quote (cheapest)')
                : T('💵 이 부품으로 실견적 요청', '💵 Request a real quote')}
            </a>
            <a href={`/${lang}/factories`} className="block text-center bg-white/5 hover:bg-white/10 border border-white/15 rounded-lg py-2.5 text-sm font-bold">
              {T('🏭 제조사(공장) 찾기', '🏭 Find factories')}
            </a>
          </div>
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
