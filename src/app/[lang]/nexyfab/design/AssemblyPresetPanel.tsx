'use client';

/**
 * 도메인 어셈블리 프리셋 패널 (#6 비-기계 3D UI) — RC 골조·파고라·데크·카페 등
 * 결정론 어셈블리 템플릿(parts[])을 파라미터로 생성하고, 빌드 결과(질량·간섭·경고)를
 * 보여준 뒤 설계 패키지(zip: GA 3D 계통색·2D GA·구조·BOQ 재적·Dossier·FEA·SCAD)를
 * 바로 다운로드한다. GET/POST /api/nexyfab/drawing/preset?kind=assembly.
 *
 * 어셈블리 템플릿이 없는 분야(mech·rack·civil)에서는 렌더되지 않는다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { isKorean } from '@/lib/i18n/normalize';

interface ParamSpec { name: string; labelKo: string; unit: string; default: number; min: number; max: number }
interface Template { domain: string; id: string; labelKo: string; labelEn: string; params: ParamSpec[] }

interface AssemblyPart { id?: string; type?: string; material?: string; role?: string }
interface Structural { totalMassKg?: number; warnings?: string[]; ok?: boolean }
interface Usage { key: string; kNm2: number; label: string }
interface IntResp {
  ok: boolean; error?: string;
  travel?: { maxTravelM: number; limitM: number; pass: boolean; unreachableM2: number; limitNote?: string };
  egress?: { verdict?: string; derived?: { doorWidthSumMm: number; seatCount: number }; error?: string | null } | null;
  finishes?: { floorM2: number; wallM2: number; ceilingM2: number };
  disclaimer?: string;
}
interface LsResp {
  ok: boolean; error?: string;
  member?: { section: string; spanMm: number; spacingMm: number; verdict?: string; load?: { total_kNm: number; liveRef?: string }; error?: string | null } | null;
  wind?: { skipped?: boolean; note?: string; FS?: number; worst?: string; pass?: boolean; anchorUpliftPerPost_kN?: number; fsLimit?: number } | null;
  disclaimer?: string;
}
interface ChainCheck { verdict?: string; error?: string | null }
interface ChainResp {
  ok: boolean; error?: string;
  loads?: { usage: { label: string; live_kNm2: number }; slab: { D_kN: number; L_kN: number; finishNote: string } };
  beams?: Array<ChainCheck & { id: string; section: string; Mu_kNm: number; Vu_kN: number; combo: string }>;
  columns?: Array<ChainCheck & { id: string; section: string; Pu_kN: number }>;
  footing?: ChainCheck & { needInputs?: string[] };
  disclaimer?: string;
}
interface BuildResp {
  ok: boolean;
  assembly?: { name?: string; domain?: string; parts?: AssemblyPart[] };
  openscad?: string;
  composeIntent?: { name?: string; features?: unknown[] };
  interferences?: Array<{ a: string; b: string }>;
  structural?: Structural | null;
  gateErrors?: string[];
  error?: string;
}

export default function AssemblyPresetPanel({
  lang,
  domain,
  onApply,
}: {
  lang: string;
  domain: string;
  onApply: (intent: { name?: string; features?: unknown[] }, scad: string) => void | Promise<void>;
}) {
  const ko = isKorean(lang);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tid, setTid] = useState('');
  const [params, setParams] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [pkgBusy, setPkgBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [built, setBuilt] = useState<BuildResp | null>(null);
  // 하중경로 체인 (building 전용, Wave A·B1)
  const [usages, setUsages] = useState<Usage[]>([]);
  const [chainP, setChainP] = useState<Record<string, number | string>>({ usage: 'office', fck: 24, fy: 400, beamAs: 1548, beamAv: 142.7, beamS: 250, colAst: 3097, fB: 2200, fL: 2200, fT: 500, fD: 420, qAllow: 200 });
  const [chain, setChain] = useState<ChainResp | null>(null);
  const [chainBusy, setChainBusy] = useState(false);

  useEffect(() => {
    if (domain !== 'building') return;
    fetch('/api/nexyfab/drawing/load-path/')
      .then((r) => r.json())
      .then((d: { ok: boolean; usages?: Usage[] }) => { if (d.ok && d.usages) setUsages(d.usages); })
      .catch(() => {});
  }, [domain]);

  // 공용: 체인 리포트 HTML 다운로드 (라우트 format:'html')
  const downloadHtmlReport = useCallback(async (url: string, bodyObj: Record<string, unknown>, filename: string) => {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...bodyObj, format: 'html' }) });
      const j = (await r.json()) as { html?: string };
      if (!j.html) throw new Error('no html');
      const blobUrl = URL.createObjectURL(new Blob([j.html], { type: 'text/html' }));
      const a = document.createElement('a'); a.href = blobUrl; a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    } catch {
      setMsg(ko ? '리포트 HTML 생성 실패' : 'report HTML failed');
    }
  }, [ko]);

  // 토목 체인 (civil 전용): 옹벽 안정 — 단면=형상 메타 자동 파생, 토질만 입력
  const [cvP, setCvP] = useState<Record<string, number>>({ gammaBackfill: 18, phiBackfill: 30, baseFriction: 0.5, allowableBearing: 200 });
  const [cv, setCv] = useState<{ ok?: boolean; verdict?: string; error?: string; checks?: Record<string, { FS?: number; pass?: boolean }> } | null>(null);
  const [cvBusy, setCvBusy] = useState(false);
  const civilBody = useCallback(() => ({
    intent: built?.assembly, domain: 'civil', calculatorId: 'retaining_wall_stability', params: cvP,
  }), [built, cvP]);
  const runCivil = useCallback(async () => {
    if (!built?.assembly) return;
    setCvBusy(true); setCv(null);
    try {
      const r = await fetch('/api/nexyfab/drawing/verify-domain/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(civilBody()) });
      setCv(await r.json());
    } catch (e) {
      setCv({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setCvBusy(false);
    }
  }, [built, civilBody]);

  // 조경 체인 (landscape 전용, Wave A 조경 L1+L2)
  const [lsP, setLsP] = useState<Record<string, number | string>>({ species: 'pine', grade: 2, usage: 'residence_living', windPressure: 0, extraW: 0 });
  const [ls, setLs] = useState<LsResp | null>(null);
  const [lsBusy, setLsBusy] = useState(false);

  const lsBody = useCallback(() => ({
    assembly: built?.assembly,
    params: {
      species: lsP.species, grade: Number(lsP.grade), usage: lsP.usage,
      extraW_kNm: Number(lsP.extraW) || 0,
      ...(Number(lsP.windPressure) > 0 ? { windPressure_kNm2: Number(lsP.windPressure) } : {}),
    },
  }), [built, lsP]);
  const runLandscape = useCallback(async () => {
    if (!built?.assembly) return;
    setLsBusy(true); setLs(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/landscape-check/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lsBody()),
      });
      setLs((await res.json()) as LsResp);
    } catch (e) {
      setLs({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setLsBusy(false);
    }
  }, [built, lsBody]);

  // 인테리어 체인 (interior 전용, Wave A I2+I3)
  const [intR, setIntR] = useState<IntResp | null>(null);
  const [intBusy, setIntBusy] = useState(false);
  const runInterior = useCallback(async () => {
    if (!built?.assembly) return;
    setIntBusy(true); setIntR(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/interior-check/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: built.assembly, params: {} }),
      });
      setIntR((await res.json()) as IntResp);
    } catch (e) {
      setIntR({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setIntBusy(false);
    }
  }, [built]);

  const chainBody = useCallback(() => ({
    assembly: built?.assembly,
    params: {
      usage: chainP.usage, fck: Number(chainP.fck), fy: Number(chainP.fy),
      beamAs: Number(chainP.beamAs), beamAv: Number(chainP.beamAv), beamS: Number(chainP.beamS),
      colAst: Number(chainP.colAst),
      footing: { B: Number(chainP.fB), L: Number(chainP.fL), t: Number(chainP.fT), d: Number(chainP.fD), qAllow: Number(chainP.qAllow) },
    },
  }), [built, chainP]);
  const runChain = useCallback(async () => {
    if (!built?.assembly) return;
    setChainBusy(true); setChain(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/load-path/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chainBody()),
      });
      setChain((await res.json()) as ChainResp);
    } catch (e) {
      setChain({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setChainBusy(false);
    }
  }, [built, chainBody]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/nexyfab/drawing/preset/?kind=assembly&domain=${encodeURIComponent(domain)}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; templates?: Template[] }) => {
        if (!alive || !d.ok || !d.templates?.length) return;
        setTemplates(d.templates);
        setTid(d.templates[0].id);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [domain]);

  const tpl = useMemo(() => templates?.find((t) => t.id === tid) ?? null, [templates, tid]);

  useEffect(() => {
    if (!tpl) return;
    setParams(Object.fromEntries(tpl.params.map((p) => [p.name, p.default])));
    setMsg(null);
    setBuilt(null);
  }, [tpl]);

  const generate = useCallback(async () => {
    if (!tid) return;
    setBusy(true); setMsg(null); setBuilt(null);
    try {
      const res = await fetch('/api/nexyfab/drawing/preset/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'assembly', domain, templateId: tid, params }),
      });
      const data = (await res.json()) as BuildResp;
      if (data.ok && data.composeIntent && data.openscad) {
        setBuilt(data);
        await onApply(data.composeIntent, data.openscad);
        const mass = data.structural?.totalMassKg;
        setMsg(
          (ko ? '생성됨 · 부재 ' : 'Built · parts ') + (data.assembly?.parts?.length ?? 0)
          + (mass ? ` · ${mass >= 1000 ? (mass / 1000).toFixed(1) + 't' : mass.toFixed(0) + 'kg'}` : '')
          + (data.interferences?.length ? (ko ? ` · ⚠간섭 ${data.interferences.length}` : ` · ⚠clash ${data.interferences.length}`) : ''),
        );
      } else {
        setMsg((ko ? '실패: ' : 'Failed: ') + (data.gateErrors?.join('; ') ?? data.error ?? ''));
      }
    } catch (e) {
      setMsg((ko ? '실패: ' : 'Failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  }, [tid, params, onApply, ko, domain]);

  const downloadPackage = useCallback(async () => {
    if (!built?.assembly) return;
    setPkgBusy(true);
    try {
      const r = await fetch('/api/nexyfab/drawing/package/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assembly: built.assembly }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; zipBase64?: string; files?: Array<{ name: string; content: string; mime?: string }>; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? (ko ? '패키지 생성 실패' : 'package failed'));
      if (typeof j.zipBase64 === 'string') {
        const bin = atob(j.zipBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
        const a = document.createElement('a'); a.href = url; a.download = 'design_package.zip'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } else if (Array.isArray(j.files)) {
        for (const f of j.files) {
          const url = URL.createObjectURL(new Blob([f.content], { type: f.mime ?? 'text/html' }));
          const a = document.createElement('a'); a.href = url; a.download = f.name; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        }
      } else throw new Error(ko ? '패키지 생성 실패' : 'package failed');
    } catch (e) {
      setMsg((ko ? '패키지 실패: ' : 'Package failed: ') + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPkgBusy(false);
    }
  }, [built, ko]);

  if (!templates) return null;

  const warnings = built?.structural?.warnings ?? [];

  return (
    <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: 'var(--nx-accent-soft, #eef4ff)', border: '1px solid var(--nx-border, #dfe3e8)' }}>
      <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
        {ko ? '어셈블리 템플릿' : 'Assembly template'}
        <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
          {ko ? '다부재 · 설계 패키지 지원' : 'multi-part · design package'}
        </span>
      </div>

      <select value={tid} onChange={(e) => setTid(e.target.value)} style={selStyle}>
        {templates.map((t) => <option key={t.id} value={t.id}>{ko ? t.labelKo : t.labelEn}</option>)}
      </select>

      {tpl && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, margin: '8px 0' }}>
          {tpl.params.map((p) => (
            <label key={p.name} style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{p.labelKo}{p.unit ? ` (${p.unit})` : ''}</span>
              <input
                type="number" inputMode="decimal"
                value={params[p.name] ?? ''}
                min={p.min} max={p.max}
                onChange={(e) => setParams((s) => ({ ...s, [p.name]: Number(e.target.value) }))}
                style={inpStyle}
              />
            </label>
          ))}
        </div>
      )}

      <button type="button" onClick={generate} disabled={busy} style={genStyle}>
        {busy ? (ko ? '빌드 중…' : 'Building…') : ko ? '어셈블리 생성' : 'Build assembly'}
      </button>

      {built && (
        <button type="button" onClick={downloadPackage} disabled={pkgBusy} style={{ ...genStyle, marginTop: 6, background: 'var(--nx-panel, #fff)', color: 'var(--nx-accent, #2563eb)', border: '1px solid var(--nx-accent, #2563eb)' }}>
          {pkgBusy ? (ko ? '패키지 생성 중…' : 'Packaging…') : ko ? '📦 설계 패키지 다운로드' : '📦 Download design package'}
        </button>
      )}
      {built && (
        <button
          type="button"
          onClick={() => downloadHtmlReport('/api/nexyfab/drawing/research/', { assembly: built.assembly, domain }, 'related_research.html')}
          style={{ ...rptBtn, width: '100%' }}
        >
          📚 {ko ? '관련 논문 부록 (OpenAlex·Crossref 실인용)' : 'Related papers (real citations)'}
        </button>
      )}

      {msg && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--nx-text-2, #46505e)' }}>{msg}</div>}
      {warnings.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: '#991b1b' }}>
          {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
        </div>
      )}

      {/* 토목 체인 (civil): 옹벽 안정 — 단면=형상 자동 파생(C1), 토질만 입력 */}
      {domain === 'civil' && built && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {ko ? '옹벽 안정 검증' : 'Retaining wall stability'}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {ko ? '단면 자동 파생 · 토질만 입력' : 'section from shape · soil only'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 6 }}>
            {([['gammaBackfill', ko ? '뒤채움 γ kN/m³' : 'γ backfill'], ['phiBackfill', ko ? '내부마찰각 °' : 'φ'], ['baseFriction', ko ? '저면 마찰 μ' : 'μ base'], ['allowableBearing', ko ? '허용지지력 kPa' : 'qAllow']] as Array<[string, string]>).map(([k, lb]) => (
              <label key={k} style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{lb}</span>
                <input type="number" step="0.1" value={cvP[k]} onChange={(e) => setCvP((s) => ({ ...s, [k]: Number(e.target.value) }))} style={inpStyle} />
              </label>
            ))}
          </div>
          <button type="button" onClick={runCivil} disabled={cvBusy} style={{ ...genStyle, background: '#b45309' }}>
            {cvBusy ? (ko ? '검증 중…' : 'Checking…') : ko ? '🧱 옹벽 안정 검증 실행' : '🧱 Run stability check'}
          </button>
          {cv && !cv.ok && <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>{cv.error}</div>}
          {cv?.ok && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              {Object.entries(cv.checks ?? {}).map(([k, c]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{k}{typeof c.FS === 'number' ? ` FS ${c.FS.toFixed(2)}` : ''}</span>
                  <b style={{ color: c.pass ? '#16a34a' : '#dc2626' }}>{c.pass ? 'PASS' : 'FAIL'}</b>
                </div>
              ))}
              <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/verify-domain/', civilBody(), 'retaining_wall_check.html')} style={rptBtn}>
                📄 {ko ? '리포트 HTML' : 'Report HTML'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 인테리어 체인 (interior · Wave A I2+I3): 보행거리 BFS + 피난폭 + 마감 물량 */}
      {domain === 'interior' && built && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {ko ? '피난·마감 검증' : 'Egress & finish check'}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {ko ? '보행거리 BFS 실측 · 문폭 형상 파생' : 'travel BFS · door width from shape'}
            </span>
          </div>
          <button type="button" onClick={runInterior} disabled={intBusy} style={{ ...genStyle, background: '#7c3aed' }}>
            {intBusy ? (ko ? '검증 중…' : 'Checking…') : ko ? '🚪 피난·마감 검증 실행' : '🚪 Run egress & finish check'}
          </button>
          {intR && !intR.ok && <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>{intR.error}</div>}
          {intR?.ok && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                <span>{ko ? '최원점 보행거리' : 'Max travel'} {intR.travel?.maxTravelM}m / {intR.travel?.limitM}m{intR.travel && intR.travel.unreachableM2 > 0 ? ` · ⚠${ko ? '미도달' : 'unreachable'} ${intR.travel.unreachableM2}m²` : ''}</span>
                <b style={{ color: intR.travel?.pass ? '#16a34a' : '#dc2626' }}>{intR.travel?.pass ? 'PASS' : 'FAIL'}</b>
              </div>
              {intR.egress && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{ko ? '수용·피난폭' : 'Occupancy/egress'} <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{ko ? '문폭합' : 'doors'} {intR.egress.derived?.doorWidthSumMm}mm · {ko ? '좌석' : 'seats'} {intR.egress.derived?.seatCount}</span></span>
                  <b style={{ color: intR.egress.verdict === 'PASS' ? '#16a34a' : '#dc2626' }}>{intR.egress.verdict}</b>
                </div>
              )}
              {intR.finishes && (
                <div style={{ padding: '2px 0', color: 'var(--nx-text-2, #46505e)' }}>
                  {ko ? '마감' : 'Finish'}: {ko ? '바닥' : 'floor'} {intR.finishes.floorM2} · {ko ? '벽' : 'wall'} {intR.finishes.wallM2} · {ko ? '천장' : 'ceiling'} {intR.finishes.ceilingM2} m²
                </div>
              )}
              <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/interior-check/', { assembly: built?.assembly, params: {} }, 'egress_finish_check.html')} style={rptBtn}>
                📄 {ko ? '리포트 HTML' : 'Report HTML'}
              </button>
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{intR.disclaimer}</div>
            </div>
          )}
        </div>
      )}

      {/* 조경 체인 (landscape · Wave A L1+L2): 목재 부재 검토 + 풍하중 전도 */}
      {domain === 'landscape' && built && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {ko ? '목재 부재·풍하중 검증' : 'Timber member & wind check'}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {ko ? 'KDS 41 50 10 허용응력 · 단면·스팬 형상 파생' : 'KDS allowable stress · section from shape'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 6 }}>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{ko ? '수종군' : 'Species'}</span>
              <select value={String(lsP.species)} onChange={(e) => setLsP((s) => ({ ...s, species: e.target.value }))} style={selStyle}>
                <option value="larch">{ko ? '낙엽송류' : 'Larch'}</option>
                <option value="pine">{ko ? '소나무류' : 'Pine'}</option>
                <option value="koreanpine">{ko ? '잣나무류' : 'Korean pine'}</option>
                <option value="cedar">{ko ? '삼나무류' : 'Cedar'}</option>
              </select>
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{ko ? '등급' : 'Grade'}</span>
              <select value={String(lsP.grade)} onChange={(e) => setLsP((s) => ({ ...s, grade: Number(e.target.value) }))} style={selStyle}>
                {[1, 2, 3].map((g) => <option key={g} value={g}>{g}{ko ? '등급' : ''}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{ko ? '용도(데크 활하중)' : 'Usage (deck live)'}</span>
              <select value={String(lsP.usage)} onChange={(e) => setLsP((s) => ({ ...s, usage: e.target.value }))} style={selStyle}>
                <option value="residence_living">{ko ? '주거 2.0' : 'Residential 2.0'}</option>
                <option value="roof_garden">{ko ? '정원·집회 5.0' : 'Garden/assembly 5.0'}</option>
                <option value="assembly_moving">{ko ? '집회(이동석) 5.0' : 'Assembly 5.0'}</option>
              </select>
            </label>
            <label style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{ko ? '풍압 kN/m² (0=생략)' : 'Wind kN/m² (0=skip)'}</span>
              <input type="number" step="0.1" value={lsP.windPressure as number} onChange={(e) => setLsP((s) => ({ ...s, windPressure: Number(e.target.value) }))} style={inpStyle} />
            </label>
          </div>
          <button type="button" onClick={runLandscape} disabled={lsBusy} style={{ ...genStyle, background: '#15803d' }}>
            {lsBusy ? (ko ? '검증 중…' : 'Checking…') : ko ? '🌳 부재·풍하중 검증 실행' : '🌳 Run timber & wind check'}
          </button>
          {ls && !ls.ok && <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>{ls.error}</div>}
          {ls?.ok && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              {ls.member && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{ko ? '장선/서까래' : 'Joist'} {ls.member.section} L{ls.member.spanMm}@{ls.member.spacingMm} <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>w {ls.member.load?.total_kNm}kN/m</span></span>
                  <b style={{ color: ls.member.verdict === 'PASS' ? '#16a34a' : '#dc2626' }}>{ls.member.verdict}</b>
                </div>
              )}
              {ls.wind && !ls.wind.skipped && (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                  <span>{ko ? '전도' : 'Tip-over'} FS {ls.wind.FS} ({ls.wind.worst}){!ls.wind.pass && ls.wind.anchorUpliftPerPost_kN ? ` — ${ko ? '앵커' : 'anchor'} ${ls.wind.anchorUpliftPerPost_kN}kN/${ko ? '본' : 'post'}` : ''}</span>
                  <b style={{ color: ls.wind.pass ? '#16a34a' : '#dc2626' }}>{ls.wind.pass ? 'PASS' : 'FAIL'}</b>
                </div>
              )}
              {ls.wind?.skipped && <div style={{ color: 'var(--nx-text-3, #6b7684)' }}>{ls.wind.note}</div>}
              <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/landscape-check/', lsBody(), 'timber_wind_check.html')} style={rptBtn}>
                📄 {ko ? '리포트 HTML' : 'Report HTML'}
              </button>
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{ls.disclaimer}</div>
            </div>
          )}
        </div>
      )}

      {/* 하중경로 자동 체인 (building · Wave A B1): 슬래브 자중+활하중 → 보 → 기둥 → 기초 */}
      {domain === 'building' && built && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--nx-border, #dfe3e8)' }}>
          <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4 }}>
            {ko ? '하중경로 검증' : 'Load-path check'}
            <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: 'var(--nx-text-3, #6b7684)' }}>
              {ko ? '자중(형상)+활하중(KDS 표 3.2-1) → 보→기둥→기초' : 'dead(shape)+live(KDS) → beam→column→footing'}
            </span>
          </div>
          <label style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{ko ? '용도(활하중)' : 'Usage (live load)'}</span>
            <select value={String(chainP.usage)} onChange={(e) => setChainP((s) => ({ ...s, usage: e.target.value }))} style={selStyle}>
              {(usages.length ? usages : [{ key: 'office', kNm2: 2.5, label: '일반 사무실' }]).map((u) => (
                <option key={u.key} value={u.key}>{u.label} — {u.kNm2} kN/m²</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5, marginBottom: 6 }}>
            {([
              ['fck', 'fck MPa'], ['fy', 'fy MPa'], ['beamAs', ko ? '보 As mm²' : 'beam As'],
              ['beamAv', ko ? '스터럽 Av' : 'stirrup Av'], ['beamS', ko ? '간격 s' : 'spacing s'], ['colAst', ko ? '기둥 Ast' : 'col Ast'],
              ['fB', ko ? '기초 B' : 'ftg B'], ['fL', ko ? '기초 L' : 'ftg L'], ['qAllow', ko ? '지지력 kPa' : 'qAllow'],
            ] as Array<[string, string]>).map(([k, lb]) => (
              <label key={k} style={{ fontSize: 10.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ color: 'var(--nx-text-2, #46505e)' }}>{lb}</span>
                <input type="number" value={chainP[k] as number} onChange={(e) => setChainP((s) => ({ ...s, [k]: Number(e.target.value) }))} style={inpStyle} />
              </label>
            ))}
          </div>
          <button type="button" onClick={runChain} disabled={chainBusy} style={{ ...genStyle, background: '#0e7490' }}>
            {chainBusy ? (ko ? '체인 검증 중…' : 'Checking…') : ko ? '⛓ 하중경로 검증 실행' : '⛓ Run load-path check'}
          </button>
          {chain && !chain.ok && <div style={{ marginTop: 5, fontSize: 11, color: '#991b1b' }}>{chain.error}</div>}
          {chain?.ok && (
            <div style={{ marginTop: 6, fontSize: 11 }}>
              <div style={{ color: 'var(--nx-text-2, #46505e)', marginBottom: 3 }}>
                {ko ? '슬래브' : 'Slab'}: D {chain.loads?.slab.D_kN}kN · L {chain.loads?.slab.L_kN}kN ({chain.loads?.usage.label} {chain.loads?.usage.live_kNm2}kN/m²) · {chain.loads?.slab.finishNote}
              </div>
              {[...(chain.beams ?? []).map((b) => ({ nm: `${b.id} (${b.section})`, dt: `Mu ${b.Mu_kNm}kN·m · ${b.combo}`, v: b.verdict })),
                ...(chain.columns ?? []).map((c) => ({ nm: `${c.id}`, dt: `Pu ${c.Pu_kN}kN`, v: c.verdict })),
                { nm: ko ? '기초' : 'Footing', dt: chain.footing?.needInputs ? (ko ? '입력 필요' : 'inputs needed') : '', v: chain.footing?.verdict }]
                .map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', borderBottom: '1px solid var(--nx-border, #eef1f4)' }}>
                    <span>{r.nm} <span style={{ color: 'var(--nx-text-3, #6b7684)' }}>{r.dt}</span></span>
                    <b style={{ color: r.v === 'PASS' ? '#16a34a' : r.v === 'FAIL' ? '#dc2626' : '#d97706' }}>{r.v}</b>
                  </div>
                ))}
              <button type="button" onClick={() => downloadHtmlReport('/api/nexyfab/drawing/load-path/', chainBody(), 'load_path_check.html')} style={rptBtn}>
                📄 {ko ? '리포트 HTML' : 'Report HTML'}
              </button>
              <div style={{ marginTop: 4, fontSize: 10, color: 'var(--nx-text-3, #6b7684)' }}>{chain.disclaimer}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const selStyle: React.CSSProperties = {
  width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12,
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)',
};
const inpStyle: React.CSSProperties = {
  padding: '5px 7px', borderRadius: 6, fontSize: 12, border: '1px solid var(--nx-border, #dfe3e8)',
  background: 'var(--nx-panel, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
};
const genStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', borderRadius: 7, border: 'none',
  background: 'var(--nx-accent, #2563eb)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const rptBtn: React.CSSProperties = {
  marginTop: 5, padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer',
  border: '1px solid var(--nx-border, #dfe3e8)', background: 'var(--nx-panel, #fff)', color: 'var(--nx-text, #1a2230)',
};
