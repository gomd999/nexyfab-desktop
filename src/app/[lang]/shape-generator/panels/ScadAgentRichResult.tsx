'use client';

// W1 — Per-tool rich result rendering for the SCAD agent panel.
//
// Each agent tool has different output meta. Rather than dumping raw
// text, we pick the bits that matter for that tool and render them as
// compact visual cards. Falls back to the plain text summary when meta
// shape is unfamiliar (e.g. new tool added without a card here yet).
//
// Cards are intentionally small (≤120px tall) — the agent thread can
// have many entries, and we want to keep scannable density high.

import React from 'react';

interface ToolResultMeta {
  // Common
  handle?: string;
  bytes?: number;
  // Render
  renderOk?: boolean;
  triangleCount?: number;
  // GD&T
  frameText?: string;
  // Kinematics
  collides?: boolean;
  overlap?: { x: number; y: number; z: number; volume: number };
  ok?: boolean;
  idealCenterDistanceMm?: number;
  errorMm?: number;
  gearRatio?: number;
  // FEA
  maxStressMPa?: number;
  safetyFactor?: number;
  locationMm?: [number, number, number];
  converged?: boolean;
  iterations?: number;
  studyId?: string;
  // Sheet metal
  bendAllowanceMm?: number;
  bendDeductionMm?: number;
  flatLength?: number;
  flatWidth?: number;
  flatLengthMm?: number;
  widthMm?: number;
  perBend?: { positionMm: number; angleDeg: number; allowanceMm: number; flatPositionMm: number }[];
  // Drawing
  lineCount?: { visible: number; hidden: number; center: number };
  dimensionCount?: number;
  sheetSize?: { w: number; h: number };
  // brep_export_drawing — uses common bytes/svg/viewBox above
  svg?: string;
  viewBox?: { x?: number; y?: number; w: number; h: number };
  // Vision
  pngBytes?: number;
  viewCount?: number;
  // Doc refs
  brepHandle?: string;
  format?: string;
  id?: string;
  // Composition
  warnings?: string[];
  // T3 — Σ simulation results (each sim_* tool wraps its output in
  // meta.result, plus a jobId for traceability).
  result?: SimResultUnion;
  jobId?: string;
}

type SimResultUnion =
  | SimCfdResult
  | SimMbdResult
  | SimCamResult
  | SimMoldFillResult
  | SimOpticsResult
  | SimThermalResult
  | Record<string, unknown>;

interface SimCfdResult {
  reynolds?: number;
  regime?: 'laminar' | 'transitional' | 'turbulent';
  dragCoefficient?: number;
  pressureDropPa?: number;
  notes?: string;
}
interface SimMbdResult {
  finalState?: Record<string, { positionM: [number, number, number] }>;
  steps?: number;
  energyJ?: number;
  notes?: string;
}
interface SimCamResult {
  toolpathSegments?: number;
  estimatedTimeMin?: number;
  preview?: Array<[number, number, number]>;
  notes?: string;
}
interface SimMoldFillResult {
  fillTimeS?: number;
  shotWeightG?: number;
  warningHotspots?: Array<{ severity: 'low' | 'medium' | 'high'; note: string }>;
  notes?: string;
}
interface SimOpticsResult {
  imagePlaneZMm?: number;
  magnification?: number;
  notes?: string;
}
interface SimThermalResult {
  steadyStateTempC?: number;
  thermalResistanceKW?: number;
  notes?: string;
}

export interface RichResultProps {
  toolName: string;
  output: string;
  meta?: ToolResultMeta;
  ok: boolean;
  /** W6 — when present, B-rep tool result cards show a "Show in canvas" button. */
  onShowBrepHandle?: (handle: string) => void | Promise<void>;
}

export function RichResult({ toolName, output, meta, ok, onShowBrepHandle }: RichResultProps): React.ReactElement {
  if (!ok) {
    return <Card tone="error" body={output} />;
  }

  switch (toolName) {
    // ─── GD&T frame ──────────────────────────────────────────────────────
    case 'add_gdt_frame':
      return <Card tone="info" body={
        <div style={S.row}>
          <span style={S.bigSymbol}>{(meta?.frameText ?? '⌖').split(' ')[0]}</span>
          <code style={S.frameCode}>{meta?.frameText ?? output}</code>
        </div>
      } />;

    // ─── Kinematics: gear mesh ───────────────────────────────────────────
    case 'check_gear_mesh': {
      const passed = meta?.ok === true;
      return <Card tone={passed ? 'success' : 'warning'} body={
        <div>
          <div style={S.row}>
            <Pill text={passed ? '✓ MESH OK' : '⚠ MESH'} tone={passed ? 'success' : 'warning'} />
            {typeof meta?.gearRatio === 'number' && (
              <span style={S.metric}>{meta.gearRatio.toFixed(2)} : 1</span>
            )}
          </div>
          {typeof meta?.errorMm === 'number' && (
            <div style={S.subText}>error {meta.errorMm >= 0 ? '+' : ''}{meta.errorMm.toFixed(3)}mm
              {typeof meta.idealCenterDistanceMm === 'number' && ` (ideal ${meta.idealCenterDistanceMm.toFixed(2)}mm)`}
            </div>
          )}
        </div>
      } />;
    }

    // ─── Kinematics: AABB interference ───────────────────────────────────
    case 'check_interference': {
      const collides = meta?.collides === true;
      return <Card tone={collides ? 'warning' : 'success'} body={
        <div>
          <Pill text={collides ? '⚠ COLLISION' : '✓ CLEAR'} tone={collides ? 'warning' : 'success'} />
          {meta?.overlap && collides && (
            <div style={S.subText}>
              overlap {meta.overlap.x.toFixed(1)}×{meta.overlap.y.toFixed(1)}×{meta.overlap.z.toFixed(1)}mm
              {' '}({meta.overlap.volume.toFixed(1)}mm³)
            </div>
          )}
        </div>
      } />;
    }

    // ─── FEA stress ──────────────────────────────────────────────────────
    case 'fea_stress': {
      const sf = meta?.safetyFactor;
      const tone = sf === undefined ? 'info' : sf < 1 ? 'error' : sf < 2 ? 'warning' : 'success';
      const label = sf === undefined ? 'STRESS' : sf < 1 ? '⚠ FAIL' : sf < 2 ? '⚠ MARGINAL' : '✓ OK';
      return <Card tone={tone} body={
        <div>
          <div style={S.row}>
            <Pill text={label} tone={tone} />
            {typeof sf === 'number' && <span style={S.metric}>SF {sf.toFixed(2)}</span>}
          </div>
          {typeof meta?.maxStressMPa === 'number' && (
            <div style={S.subText}>
              max {meta.maxStressMPa.toFixed(1)} MPa
              {meta.locationMm && ` at [${meta.locationMm.map(v => v.toFixed(1)).join(', ')}]`}
            </div>
          )}
        </div>
      } />;
    }

    case 'fea_solve': {
      const conv = meta?.converged === true;
      return <Card tone={conv ? 'success' : 'warning'} body={
        <div style={S.row}>
          <Pill text={conv ? '✓ CONVERGED' : '⚠ NO CONVERGE'} tone={conv ? 'success' : 'warning'} />
          {typeof meta?.iterations === 'number' && <span style={S.subText}>{meta.iterations} iters</span>}
        </div>
      } />;
    }

    case 'fea_setup':
      return <Card tone="info" body={output} />;

    // ─── Sheet metal: flat blank ─────────────────────────────────────────
    case 'sheet_metal_box_flat':
    case 'sheet_metal_unfold': {
      const fl = meta?.flatLength ?? meta?.flatLengthMm;
      const fw = meta?.flatWidth ?? meta?.widthMm;
      return <Card tone="info" body={
        <div>
          <div style={S.row}>
            <Pill text="🪒 FLAT BLANK" tone="info" />
            {typeof fl === 'number' && (
              <span style={S.metric}>
                {fl.toFixed(1)} × {typeof fw === 'number' ? fw : '—'} mm
              </span>
            )}
          </div>
          {meta?.perBend && meta.perBend.length > 0 && (
            <div style={S.subText}>
              {meta.perBend.length} bends · BA total {meta.perBend.reduce((s, b) => s + b.allowanceMm, 0).toFixed(2)}mm
            </div>
          )}
        </div>
      } />;
    }

    case 'sheet_metal_bend_allowance':
      return <Card tone="info" body={
        <div>
          <Pill text="🪒 BA" tone="info" />
          <span style={{ ...S.metric, marginLeft: 8 }}>
            {typeof meta?.bendAllowanceMm === 'number' ? meta.bendAllowanceMm.toFixed(3) : '—'}mm
          </span>
          {typeof meta?.bendDeductionMm === 'number' && (
            <span style={S.subText}> · BD {meta.bendDeductionMm.toFixed(3)}mm</span>
          )}
        </div>
      } />;

    // ─── B-rep + handle ──────────────────────────────────────────────────
    case 'brep_primitive':
    case 'brep_boolean':
    case 'brep_fillet':
    case 'brep_chamfer':
    case 'brep_shell':
    case 'brep_sweep':
    case 'brep_loft':
    case 'brep_draft':
    case 'brep_helix':
      return <Card tone="success" body={
        <div style={S.row}>
          <Pill text="✚ B-REP" tone="success" />
          {meta?.handle && <code style={S.frameCode}>{meta.handle}</code>}
          <span style={S.subText}>{toolName.replace('brep_', '')}</span>
          {meta?.handle && onShowBrepHandle && (
            <ShowInCanvasButton handle={meta.handle} onShow={onShowBrepHandle} />
          )}
        </div>
      } />;

    case 'brep_to_mesh':
      return <Card tone="success" body={
        <div style={S.row}>
          <Pill text="🔷 MESH" tone="success" />
          {typeof meta?.triangleCount === 'number' && (
            <span style={S.metric}>{meta.triangleCount.toLocaleString()} tris</span>
          )}
          {meta?.handle && onShowBrepHandle && (
            <ShowInCanvasButton handle={meta.handle} onShow={onShowBrepHandle} />
          )}
        </div>
      } />;

    case 'brep_export_step':
      return <Card tone="success" body={
        <div style={S.row}>
          <Pill text="📦 STEP" tone="success" />
          {typeof meta?.bytes === 'number' && (
            <span style={S.metric}>{(meta.bytes / 1024).toFixed(1)} KB</span>
          )}
          {meta?.handle && <QuoteFromBrepButton handle={meta.handle} />}
        </div>
      } />;

    // ─── Drawing ──────────────────────────────────────────────────────────
    case 'brep_to_drawing':
      return <Card tone="success" body={
        <div>
          <div style={S.row}>
            <Pill text="📐 DRAWING" tone="success" />
            {meta?.sheetSize && (
              <span style={S.metric}>
                {meta.sheetSize.w}×{meta.sheetSize.h}mm
              </span>
            )}
          </div>
          {meta?.lineCount && (
            <div style={S.subText}>
              {meta.lineCount.visible} visible · {meta.lineCount.hidden} hidden
              {typeof meta.dimensionCount === 'number' && ` · ${meta.dimensionCount} dims`}
            </div>
          )}
        </div>
      } />;

    case 'brep_export_drawing':
      return <DrawingSvgCard meta={meta} />;

    // ─── Vision ──────────────────────────────────────────────────────────
    case 'view_render':
      return <Card tone="info" body={
        <div>
          <div style={S.row}>
            <Pill text="👁 VISION" tone="info" />
            {typeof meta?.viewCount === 'number' && (
              <span style={S.metric}>{meta.viewCount} views</span>
            )}
          </div>
          <div style={S.subText}>{output.slice(0, 200)}{output.length > 200 ? '…' : ''}</div>
        </div>
      } />;

    // ─── Doc refs ────────────────────────────────────────────────────────
    case 'import_doc_ref':
      return <Card tone="success" body={
        <div style={S.row}>
          <Pill text="📥 IMPORT" tone="success" />
          {meta?.format && <span style={S.subText}>{meta.format}</span>}
          {meta?.brepHandle && <code style={S.frameCode}>{meta.brepHandle}</code>}
        </div>
      } />;

    // ─── Render ──────────────────────────────────────────────────────────
    case 'render':
      if (meta?.renderOk === false) {
        return <Card tone="error" body={output} />;
      }
      return <Card tone="success" body={output} />;

    // ─── Default fallback ────────────────────────────────────────────────
    // ─── T3 — Σ simulation results ───────────────────────────────────────
    case 'sim_cfd': {
      const r = (meta?.result ?? {}) as SimCfdResult;
      const regimeColor = r.regime === 'turbulent' ? 'var(--nx-error)'
        : r.regime === 'transitional' ? 'var(--nx-warn)' : 'var(--nx-ok)';
      return <Card tone="info" body={
        <div>
          <div style={S.row}>
            <Pill text="💨 CFD" tone="info" />
            <span style={{ ...S.metric, background: `${regimeColor}22`, color: regimeColor, padding: '1px 6px', borderRadius: 6 }}>{r.regime ?? '—'}</span>
          </div>
          <div style={{ ...S.subText, marginTop: 4, display: 'flex', gap: 12 }}>
            <span>Re = {r.reynolds?.toExponential(2) ?? '—'}</span>
            <span>Cd = {r.dragCoefficient?.toFixed(3) ?? '—'}</span>
          </div>
        </div>
      } />;
    }

    case 'sim_mbd': {
      const r = (meta?.result ?? {}) as SimMbdResult;
      const bodies = r.finalState ? Object.entries(r.finalState) : [];
      return <Card tone="info" body={
        <div>
          <div style={S.row}>
            <Pill text="⚙ MBD" tone="info" />
            <span style={S.metric}>{r.steps ?? 0} steps</span>
          </div>
          {bodies.length > 0 && (
            <div style={{ ...S.subText, marginTop: 4 }}>
              {bodies.slice(0, 3).map(([id, st]) => (
                <div key={id}>{id}: [{st.positionM.map(v => v.toFixed(2)).join(', ')}]</div>
              ))}
            </div>
          )}
        </div>
      } />;
    }

    case 'sim_cam': {
      const r = (meta?.result ?? {}) as SimCamResult;
      return <Card tone="info" body={
        <div style={S.row}>
          <Pill text="🛠 CAM" tone="info" />
          <span style={S.metric}>{r.toolpathSegments?.toLocaleString() ?? '—'} segs</span>
          <span style={S.subText}>~{r.estimatedTimeMin?.toFixed(1) ?? '?'} min</span>
        </div>
      } />;
    }

    case 'sim_mold_fill': {
      const r = (meta?.result ?? {}) as SimMoldFillResult;
      const highWarn = (r.warningHotspots ?? []).find(w => w.severity === 'high');
      const tone = highWarn ? 'error' : (r.warningHotspots?.length ?? 0) > 0 ? 'warning' : 'success';
      return <Card tone={tone} body={
        <div>
          <div style={S.row}>
            <Pill text="🟦 MOLD" tone={tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : 'success'} />
            <span style={S.metric}>{r.shotWeightG?.toFixed(1) ?? '—'} g</span>
            <span style={S.subText}>fill {r.fillTimeS?.toFixed(2) ?? '?'}s</span>
          </div>
          {(r.warningHotspots?.length ?? 0) > 0 && (
            <div style={{ ...S.subText, marginTop: 4 }}>
              {r.warningHotspots!.map((w, i) => (
                <div key={i}>⚠ [{w.severity}] {w.note}</div>
              ))}
            </div>
          )}
        </div>
      } />;
    }

    case 'sim_optics': {
      const r = (meta?.result ?? {}) as SimOpticsResult;
      return <Card tone="info" body={
        <div style={S.row}>
          <Pill text="🔭 OPTICS" tone="info" />
          <span style={S.metric}>image z = {r.imagePlaneZMm?.toFixed(2) ?? '—'} mm</span>
          {typeof r.magnification === 'number' && (
            <span style={S.subText}>M = {r.magnification.toFixed(3)}</span>
          )}
        </div>
      } />;
    }

    case 'sim_thermal': {
      const r = (meta?.result ?? {}) as SimThermalResult;
      const tempC = r.steadyStateTempC ?? 0;
      const tone = tempC > 100 ? 'error' : tempC > 70 ? 'warning' : 'success';
      return <Card tone={tone} body={
        <div style={S.row}>
          <Pill text="🔥 THERMAL" tone={tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : 'success'} />
          <span style={S.metric}>{tempC.toFixed(1)} °C</span>
          <span style={S.subText}>R = {r.thermalResistanceKW?.toFixed(2) ?? '—'} K/W</span>
        </div>
      } />;
    }

    default:
      return <Card tone="default" body={output} />;
  }
}

// ─── B2 — "Get a quote" button after STEP export ───────────────────────────
//
// Stashes the agent's STEP output into the export-to-quote endpoint
// (returns a one-shot token), then opens /quick-quote with the token
// pre-filled so the user lands directly on AI cost analysis.

function QuoteFromBrepButton({ handle }: { handle: string }) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const onClick = React.useCallback(async () => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/nexyfab/scad-agent/export-to-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { ok: boolean; token: string };
      // Open in a new tab so the agent panel state survives.
      const lang = (typeof document !== 'undefined' && document.documentElement.lang)
        || (typeof location !== 'undefined' && location.pathname.split('/')[1])
        || 'ko';
      window.open(`/${lang}/quick-quote?stepToken=${encodeURIComponent(data.token)}`, '_blank');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [busy, handle]);

  return (
    <>
      <button onClick={onClick} disabled={busy} style={quoteBtnStyle} title="Open in NexyFab quote flow">
        {busy ? '⏳' : '💰 견적'}
      </button>
      {err && <span style={{ fontSize: 9, color: '#ffa198' }}>{err}</span>}
    </>
  );
}

const quoteBtnStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '2px 8px',
  fontSize: 10,
  fontFamily: 'inherit',
  borderRadius: 4,
  border: '1px solid var(--nx-warn)',
  background: 'transparent',
  color: '#f0b34c',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

// ─── W6 — "Show in canvas" button for B-rep handles ───────────────────────
//
// Triggers /api/nexyfab/scad-agent/brep-mesh fetch via the parent's
// callback. Shows a transient loading state so the user knows the click
// registered (mesh fetch can take a few hundred ms for complex parts).

function ShowInCanvasButton({ handle, onShow }: { handle: string; onShow: (h: string) => void | Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const onClick = React.useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onShow(handle);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } finally {
      setBusy(false);
    }
  }, [busy, handle, onShow]);
  return (
    <button onClick={onClick} disabled={busy} style={showCanvasBtnStyle} title={`Render ${handle} into the main viewport`}>
      {busy ? '…' : done ? '✓' : '↗ canvas'}
    </button>
  );
}

const showCanvasBtnStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '2px 8px',
  fontSize: 10,
  fontFamily: 'inherit',
  borderRadius: 4,
  border: '1px solid #1f6feb',
  background: 'transparent',
  color: 'var(--nx-accent-2)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

// ─── W5 — Inline drawing SVG preview ───────────────────────────────────────
//
// Renders the SVG markup the agent emits directly into the chat. We
// constrain height so a large drawing doesn't push the agent thread off
// screen, and add a "↗ Open full size" button that pops the SVG into a
// new tab via a Blob URL (avoids inflating the DOM document).

function DrawingSvgCard({ meta }: { meta?: ToolResultMeta }): React.ReactElement {
  const svg = typeof meta?.svg === 'string' ? meta.svg : null;
  const [popupBlocked, setPopupBlocked] = React.useState(false);
  const onOpenFull = React.useCallback(() => {
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      URL.revokeObjectURL(url);
      setPopupBlocked(true);
      setTimeout(() => setPopupBlocked(false), 4000);
    } else {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }, [svg]);

  return (
    <Card tone="success" body={
      <div>
        <div style={S.row}>
          <Pill text="📐 SVG" tone="success" />
          {typeof meta?.bytes === 'number' && (
            <span style={S.metric}>{(meta.bytes / 1024).toFixed(1)} KB</span>
          )}
          {meta?.viewBox && (
            <span style={S.subText}>
              {meta.viewBox.w.toFixed(0)}×{meta.viewBox.h.toFixed(0)}mm
            </span>
          )}
          {svg && (
            <button onClick={onOpenFull} style={openBtnStyle} title="Open SVG in new tab">↗ open</button>
          )}
        </div>
        {popupBlocked && (
          <div style={{
            marginTop: 4, padding: '4px 8px',
            fontSize: 10, color: '#f0b34c',
            background: 'rgba(210,153,34,0.12)',
            border: '1px solid var(--nx-warn)', borderRadius: 4,
          }}>
            ⚠ 팝업 차단됨 — 브라우저 주소창의 팝업 허용 후 다시 시도하세요.
          </div>
        )}
        {svg && (
          <div
            style={{
              marginTop: 6,
              padding: 4,
              background: '#ffffff',
              borderRadius: 4,
              maxHeight: 240,
              overflow: 'auto',
              display: 'flex', justifyContent: 'center',
            }}
            dangerouslySetInnerHTML={{ __html: sanitizedSvg(svg) }}
          />
        )}
      </div>
    } />
  );
}

/** Strip <script>/event handlers from SVG before injecting. The agent
 *  produces the SVG itself but B-rep export paths could pull in untrusted
 *  text from doc refs, so we defense-in-depth strip the same patterns
 *  the rest of the app forbids. */
function sanitizedSvg(svg: string): string {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

const openBtnStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '2px 8px',
  fontSize: 10,
  fontFamily: 'inherit',
  borderRadius: 4,
  border: '1px solid #238636',
  background: 'transparent',
  color: 'var(--nx-ok)',
  cursor: 'pointer',
};

// ─── Small shared widgets ──────────────────────────────────────────────────

function Card({ tone, body }: { tone: 'success' | 'error' | 'warning' | 'info' | 'default'; body: React.ReactNode }) {
  const palette = {
    success: { bg: 'rgba(35,134,54,0.12)', border: '#238636', text: 'var(--nx-ok)' },
    error:   { bg: 'rgba(248,81,73,0.12)', border: 'var(--nx-error)', text: '#ffa198' },
    warning: { bg: 'rgba(210,153,34,0.12)', border: 'var(--nx-warn)', text: '#f0b34c' },
    info:    { bg: 'rgba(31,111,235,0.12)', border: '#1f6feb', text: 'var(--nx-accent-2)' },
    default: { bg: 'var(--nx-panel)', border: 'var(--nx-border)', text: 'var(--nx-text)' },
  }[tone];
  return (
    <div style={{
      padding: '6px 10px',
      borderRadius: 6,
      background: palette.bg,
      border: `1px solid ${palette.border}`,
      color: palette.text,
      fontSize: 11,
      fontFamily: 'monospace',
      maxWidth: '100%',
      overflow: 'hidden',
    }}>
      {typeof body === 'string'
        ? <span style={{ wordBreak: 'break-word' }}>{body.length > 200 ? body.slice(0, 197) + '…' : body}</span>
        : body}
    </div>
  );
}

function Pill({ text, tone }: { text: string; tone: 'success' | 'error' | 'warning' | 'info' }) {
  const palette = {
    success: { bg: '#238636', fg: 'var(--nx-text)' },
    error:   { bg: 'var(--nx-error)', fg: 'var(--nx-text)' },
    warning: { bg: 'var(--nx-warn)', fg: '#000' },
    info:    { bg: '#1f6feb', fg: 'var(--nx-text)' },
  }[tone];
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 8px',
      borderRadius: 999,
      background: palette.bg,
      color: palette.fg,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 0.5,
    }}>
      {text}
    </span>
  );
}

const S: Record<string, React.CSSProperties> = {
  row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  metric: { fontSize: 12, fontWeight: 700, fontFamily: 'monospace' },
  subText: { marginTop: 2, fontSize: 10, opacity: 0.85 },
  bigSymbol: { fontSize: 16 },
  frameCode: { fontSize: 11, opacity: 0.95 },
};
