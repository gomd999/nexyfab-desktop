/**
 * design-driver/curvedGate — WB-6: 곡면(OCCT) 필렛 게이트.
 *
 * Consumption vs self-implementation (보고 의무 — 명세):
 *
 *   CONSUMED — the REAL OCCT kernel (occt/nodeOcctBridge + nodeOcctLoader):
 *   `buildFromExtrude` builds the extrude prism as a B-rep solid, `fillet`
 *   applies BRepFilletAPI_MakeFillet to the selected edges, and `volumeOf`
 *   (BRepGProp) REAL-measures the resulting solid volume. `exportSTEP` emits the
 *   B-rep as the deliverable. This is the kernel doing the geometry — no mesh
 *   approximation of the curved surface.
 *
 *   SELF-IMPLEMENTED — the gate verdict: the fillet must SUCCEED in the kernel
 *   (a radius too large for an edge → kernel IsDone=false → fail, not a wrong
 *   solid), must REMOVE material (a convex-edge round shrinks the box), and —
 *   when the plan gives one — the real volume must match the expected cross-check.
 *
 * 근사 명시: bodies[0] must be an EXTRUDE solid (the kernel path this bridge
 * builds). 'shell' (hollow-out) needs an open-surface thicken path not wired
 * here → declared shell is refused, not faked. If the OCCT wasm is unavailable
 * at runtime, a DECLARED curved op is REFUSED (패키지 미산출) — never silently
 * passed (the kernel to verify it isn't there).
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import { loadOcctNode } from '@/lib/occt/nodeOcctLoader';
import { createNodeOcctBridge } from '@/lib/occt/nodeOcctBridge';
import type { OcctShape } from '@/lib/occt/types';
import type { CurvedKind, CurvedSpec, GateResult, PlanPart } from './types';

const DEFAULT_TOL_REL = 1e-6;

export interface CurvedArtifact {
  ok: boolean;
  kind: CurvedKind;
  sizeMm: number;
  baseVolumeMm3: number;
  resultVolumeMm3: number;
  deltaVolumeMm3: number;
  step?: string;
  /** Present iff !ok — the refusal reason. */
  reason?: string;
  /** True iff the OCCT kernel could not be loaded (distinct from a kernel op failure). */
  kernelUnavailable?: boolean;
}

function fail(kind: CurvedKind, sizeMm: number, reason: string, kernelUnavailable = false): CurvedArtifact {
  return { ok: false, kind, sizeMm, baseVolumeMm3: 0, resultVolumeMm3: 0, deltaVolumeMm3: 0, reason, kernelUnavailable };
}

/**
 * Build the curved artifact by running the REAL OCCT kernel. Returns null when
 * the part declares no curved op. Async (the kernel load is ~700 ms, cached).
 */
export async function buildCurvedArtifact(part: PlanPart): Promise<CurvedArtifact | null> {
  const spec = part.curved;
  if (!spec) return null;
  const kind = spec.kind;

  if (kind === 'shell') {
    // Shell (hollow-out) needs a face-removal thicken path this bridge does not
    // expose; refuse honestly rather than approximate.
    return fail('shell', spec.wallMm ?? 0, 'shell op not wired (OCCT thicken needs an open-surface path) — WB-6 supports fillet');
  }

  const sizeMm = spec.radiusMm ?? 0;
  if (!(sizeMm > 0)) return fail(kind, sizeMm, `fillet radius must be positive, got ${spec.radiusMm}`);

  const body = part.bodies[0];
  if (!body || body.feature.kind !== 'extrude') {
    return fail(kind, sizeMm, `curved fillet requires bodies[0] to be an extrude solid (got ${body?.feature.kind ?? 'none'})`);
  }
  const feature = body.feature as ExtrudeFeature;

  const load = await loadOcctNode();
  if (!load.ok || !load.oc) {
    return fail(kind, sizeMm, `OCCT kernel unavailable: ${load.reason ?? 'unknown'} — cannot verify declared curved geometry`, true);
  }
  const bridge = createNodeOcctBridge(load.oc);

  const toRelease: OcctShape[] = [];
  try {
    const base = await bridge.buildFromExtrude(feature);
    if (!base.ok || !base.shape) return fail(kind, sizeMm, `base extrude build failed: ${base.error ?? 'no shape'}`);
    const baseShape = base.shape;
    toRelease.push(baseShape);
    const baseVolumeMm3 = baseShape.volume ?? NaN;

    const edges = spec.edges && spec.edges.length > 0 ? spec.edges : ['sel:all'];
    const res = await bridge.fillet(baseShape, edges, sizeMm);
    if (!res.ok || !res.shape) return fail(kind, sizeMm, `fillet failed: ${res.error ?? 'no shape'}`);
    const resultShape = res.shape;
    toRelease.push(resultShape);
    const resultVolumeMm3 = resultShape.volume ?? NaN;

    let step: string | undefined;
    try {
      step = await bridge.exportSTEP(resultShape);
    } catch {
      step = undefined; // STEP I/O is best-effort; the measured volume is the proof.
    }

    return {
      ok: true,
      kind,
      sizeMm,
      baseVolumeMm3,
      resultVolumeMm3,
      deltaVolumeMm3: resultVolumeMm3 - baseVolumeMm3,
      ...(step ? { step } : {}),
    };
  } catch (e) {
    return fail(kind, sizeMm, `curved op threw: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    for (const s of toRelease) {
      try { bridge.release(s); } catch { /* best-effort */ }
    }
  }
}

/**
 * Curved gate. Fails (패키지 미산출) when the OCCT op could not be built/verified
 * (kernel unavailable, op failed, non-extrude base, unsupported shell), when a
 * fillet did NOT remove material, or when the real volume misses the plan's
 * expected cross-check. Kernel volumes are restated as metrics.
 */
export function curvedGate(part: PlanPart, artifact: CurvedArtifact | null): GateResult {
  const id = `curved:${part.partId}`;
  const spec = part.curved as CurvedSpec | undefined;
  const notes: string[] = [
    'occt/nodeOcctBridge 소비: buildFromExtrude→BRepFilletAPI_MakeFillet 실커널→BRepGProp 부피 실측·STEP 산출',
    '곡면은 커널 B-rep(메시 근사 아님). bodies[0]=extrude 솔리드 전제·shell(속파기)은 미배선(열린 표면 thicken 경로 필요)',
    'OCCT wasm 미가용 시 선언된 곡면은 거부(패키지 미산출) — 무음 통과 없음(검증 커널 부재)',
  ];
  const metrics: Record<string, number> = {};

  if (!spec) {
    return { id, kind: 'curved', pass: false, metrics, reason: 'curved gate invoked on a part with no curved spec', notes };
  }
  if (!artifact) {
    return { id, kind: 'curved', pass: false, metrics, reason: 'curved op produced no artifact (build failed)', notes };
  }

  if (!artifact.ok) {
    if (artifact.kernelUnavailable) {
      notes.push('OCCT 커널 미로드 — 선언된 곡면 검증 불가');
    }
    return { id, kind: 'curved', pass: false, metrics, reason: artifact.reason ?? 'curved op failed', notes };
  }

  metrics.baseVolumeMm3 = artifact.baseVolumeMm3;
  metrics.resultVolumeMm3 = artifact.resultVolumeMm3;
  metrics.deltaVolumeMm3 = artifact.deltaVolumeMm3;
  metrics.sizeMm = artifact.sizeMm;
  metrics.hasStep = artifact.step ? 1 : 0;

  const reasons: string[] = [];
  if (!Number.isFinite(artifact.resultVolumeMm3) || artifact.resultVolumeMm3 <= 0) {
    reasons.push(`kernel produced a non-positive result volume ${artifact.resultVolumeMm3}`);
  } else if (artifact.kind === 'fillet' && artifact.deltaVolumeMm3 >= 0) {
    // Rounding convex edges of a prism must remove material.
    reasons.push(`fillet did not remove material (Δvol ${artifact.deltaVolumeMm3.toFixed(4)} mm³ ≥ 0) — unexpected`);
  }

  if (spec.expectedVolumeMm3 !== undefined) {
    const tol = (spec.tolRel ?? DEFAULT_TOL_REL) * Math.abs(spec.expectedVolumeMm3);
    const deviation = Math.abs(artifact.resultVolumeMm3 - spec.expectedVolumeMm3);
    metrics.expectedVolumeMm3 = spec.expectedVolumeMm3;
    metrics.volumeDeviationMm3 = deviation;
    if (deviation > tol) {
      reasons.push(
        `result volume ${artifact.resultVolumeMm3.toFixed(3)} mm³ deviates from expected ` +
          `${spec.expectedVolumeMm3} mm³ by ${deviation.toFixed(3)} (> tol ${tol.toExponential(2)})`,
      );
    }
  }

  return {
    id,
    kind: 'curved',
    pass: reasons.length === 0,
    metrics,
    ...(reasons.length > 0 ? { reason: reasons.join('; ') } : {}),
    notes,
  };
}
