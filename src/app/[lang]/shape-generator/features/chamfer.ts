import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import {
  occtChamferBox,
  hostBoxFromGeometry,
  resolveBrepHostHandle,
  resolveBrepHostHandleAsync,
  type ReplicadEdgeFinder,
} from './occtEngine';
import { wantsOcctEngine, shouldUseOcctEngine } from './engineSelection';
import { stampFaceFeatureIdAll, propagateFeatureIdMap } from './faceProvenance';
import { configureEvaluatorAttributes } from './meshMerge';
import { assertRoundingApplied } from './roundingGuard';
import { classifyMeshDowngrade, makeReducedNotice, stampDowngrade, clearStaleBrepHandle } from './downgradeNotice';
import { captureKernelFailure } from './kernelCorpus';
import { tryMeshChamfer } from './meshRounding';
import {
  buildEdgeFinderFromSelection,
  buildEdgeFinderFromMultiSelection,
  buildEdgeFinderForLoop,
  resolveEdgeRefDual,
  makeReferenceLostNotice,
  type EdgeRefResolution,
} from './topologyEdgeFinder';
import { requireValidBrepResult } from './kernelOperationQuality';

function stampReducedChamfer(
  geometry: THREE.BufferGeometry,
  requested: number,
  applied: number,
  featureId?: string,
): THREE.BufferGeometry {
  if (applied === requested) return geometry;
  stampDowngrade(geometry, makeReducedNotice({
    op: 'Chamfer',
    featureId,
    requested: { distance: requested },
    applied: { distance: applied },
    detail: `distance ${requested} → ${applied} mm`,
  }));
  return geometry;
}

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

function currentBboxOf(geometry: THREE.BufferGeometry):
  { min: [number, number, number]; max: [number, number, number] } | undefined {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return undefined;
  return { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] };
}

/** A finder, or an explicit "the stored reference is gone" verdict. */
type FinderOutcome =
  | { finder: ReplicadEdgeFinder | null; lost?: undefined }
  | { finder: null; lost: Extract<EdgeRefResolution, { status: 'lost' }> };

/** ⚠ When the signature matcher explicitly LOSES the reference we return that
 *  verdict rather than dropping to the click-point finder — the stale point is
 *  less informed than the signature just rejected, so using it would chamfer a
 *  guessed edge silently (ADR-017 §D1). */
async function buildBestEdgeFinder(
  ctx?: FeatureApplyContext,
  geometry?: THREE.BufferGeometry,
): Promise<FinderOutcome> {
  const sels = ctx?.edgeSelections;
  if (!sels || sels.length === 0) return { finder: null };
  const currentBbox = geometry ? currentBboxOf(geometry) : undefined;
  if (sels.length >= 2) {
    const loop = await buildEdgeFinderForLoop(sels, { currentBbox });
    if (loop) return { finder: loop };
    return { finder: await buildEdgeFinderFromMultiSelection(sels, { currentBbox }) };
  }
  // Primary (topology-tolerant): K7-S4 공용 이중화 해석(A안 이름 우선, B안 서명
  // 폴백+대조군) — resolveEdgeRefDual 단일 소스.
  const handle = geometry?.userData?.occtHandle as string | undefined;
  if (handle) {
    const res = await resolveEdgeRefDual(sels[0]!, handle, currentBbox, 'chamfer');
    if (res.status === 'matched') return { finder: res.finder };
    if (res.status === 'lost') return { finder: null, lost: res };
    // 'unavailable' — nothing was ruled out, so the click-point path is fair game.
  }
  return { finder: await buildEdgeFinderFromSelection(sels[0]!, { currentBbox }) };
}

/** Refuse the feature with a reason the UI can show, leaving the solid as-is. */
function refuseWithLostReference(
  geometry: THREE.BufferGeometry,
  lost: Extract<EdgeRefResolution, { status: 'lost' }>,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry {
  const out = geometry.clone();
  out.userData = { ...geometry.userData };
  console.warn(`[chamfer] edge reference lost (${lost.reason}) — not applying to a guessed edge`);
  stampDowngrade(out, makeReferenceLostNotice('Chamfer', lost.reason, ctx?.featureId));
  return out;
}

function applyChamferOcct(
  geometry: THREE.BufferGeometry,
  dist: number,
  edgeFinder: ReplicadEdgeFinder | null,
  hostHandle?: string | null,
): THREE.BufferGeometry | null {
  try {
    // Fail-clean host contract: registered handle, or null only for a
    // verifiably-box mesh; otherwise resolveBrepHostHandle throws and we fall
    // to the mesh path below — never a bounding-box stand-in. Async callers
    // pre-bridge via resolveBrepHostHandleAsync and pass the handle in.
    const upstreamHandle = hostHandle !== undefined ? hostHandle : resolveBrepHostHandle(geometry);
    const host = hostBoxFromGeometry(geometry);
    const result = requireValidBrepResult(occtChamferBox(host, dist, {}, upstreamHandle, edgeFinder ?? undefined));
    return result.geometry;
  } catch (err) {
    console.warn('[chamfer] OCCT path failed, falling back to mesh approximator:', err);
    captureKernelFailure({
      op: 'chamfer',
      params: { distance: dist },
      geometry,
      error: err,
      resolution: { strategy: 'mesh-fallback', requested: { distance: dist } },
    });
    return null;
  }
}

function applyChamferMeshCsg(
  geometry: THREE.BufferGeometry,
  dist: number,
  ctx?: FeatureApplyContext,
  guardNoOp = false,
): THREE.BufferGeometry {
  // Real bevel for box-like solids (no OCCT needed). Non-box ⇒ null, then the
  // legacy approximation runs and (if a silent downgrade) the guard fires.
  const beveled = tryMeshChamfer(geometry, dist);
  if (beveled) {
    if (ctx?.featureId) stampFaceFeatureIdAll(beveled, ctx.featureId);
    return clearStaleBrepHandle(beveled);
  }
  if (!geometry.index) {
    throw new Error('Chamfer requires indexed (manifold) geometry');
  }
  if (geometry.attributes.position.count < 4) {
    throw new Error('Chamfer requires geometry with at least 4 vertices');
  }
  const expanded = geometry.clone();
  expanded.computeVertexNormals();
  const pos = expanded.attributes.position;
  const nor = expanded.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) + nor.getX(i) * dist);
    pos.setY(i, pos.getY(i) + nor.getY(i) * dist);
    pos.setZ(i, pos.getZ(i) + nor.getZ(i) * dist);
  }
  pos.needsUpdate = true;
  if (ctx?.featureId) {
    stampFaceFeatureIdAll(expanded, ctx.featureId, { avoidIdsFrom: geometry });
  }
  const evaluator = new Evaluator();
  configureEvaluatorAttributes(evaluator, expanded, geometry);
  const result = evaluator.evaluate(makeBrush(expanded), makeBrush(geometry), INTERSECTION);
  propagateFeatureIdMap(result.geometry, expanded, geometry);
  // Guard a degenerate CSG result rather than returning an empty solid. A large
  // distance can self-intersect the offset shell so the intersection collapses;
  // block it with a structured error instead of silently destroying the part.
  if (!result.geometry.attributes.position || result.geometry.attributes.position.count === 0) {
    throw new Error(`Chamfer distance ${dist.toFixed(2)} is too large for this solid — the bevel produced no geometry`);
  }
  if (guardNoOp) {
    // No-op against B-rep intent → throw (blocked). Past that, the mesh CSG DID
    // bevel but it is a faceted approximation, not exact B-rep — stamp a soft,
    // non-fatal downgrade notice so the UI stops shipping it silently.
    assertRoundingApplied(geometry, result.geometry, 'Chamfer');
    stampDowngrade(
      result.geometry,
      classifyMeshDowngrade({
        op: 'Chamfer',
        featureId: ctx?.featureId,
        wantedOcct: true,
        occtRan: false,
        isNoOp: false,
      }),
    );
  }
  // Mesh approximation output must never carry the upstream B-rep handle.
  return clearStaleBrepHandle(result.geometry);
}

function applyChamferSync(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry {
  const requested = params.distance!;
  const engine = Math.round(params.engine ?? 0);
  const wantedOcct = wantsOcctEngine(engine);
  // Same fit-the-largest-bevel retry as the async path (see notes there).
  const candidates: number[] = [requested];
  for (const f of [0.5, 0.25, 0.1]) {
    const d = Math.round(requested * f * 1000) / 1000;
    if (d >= 0.1 && !candidates.includes(d)) candidates.push(d);
  }
  let lastErr: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    const dist = candidates[i]!;
    try {
      if (shouldUseOcctEngine(engine)) {
        const out = applyChamferOcct(geometry, dist, null);
        if (out) return stampReducedChamfer(out, requested, dist, ctx?.featureId);
      }
      return stampReducedChamfer(applyChamferMeshCsg(geometry, dist, ctx, wantedOcct), requested, dist, ctx?.featureId);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Chamfer produced no geometry');
}

async function applyChamferWithEdgeFinder(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): Promise<THREE.BufferGeometry> {
  const requested = params.distance!;
  const engine = Math.round(params.engine ?? 0);
  const wantedOcct = wantsOcctEngine(engine);

  // A chamfer larger than the part can hold (e.g. 2mm on a 2.5mm plate)
  // collapses the solid and the WHOLE feature errors ("Chamfer 1 실행 실패").
  // Instead of failing outright, fit the largest bevel that actually works:
  // try the requested distance, then progressively smaller ones.
  const candidates: number[] = [requested];
  for (const f of [0.5, 0.25, 0.1]) {
    const d = Math.round(requested * f * 1000) / 1000;
    if (d >= 0.1 && !candidates.includes(d)) candidates.push(d);
  }

  let lastErr: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    const dist = candidates[i]!;
    try {
      if (shouldUseOcctEngine(engine)) {
        try {
          // Async host resolution can bridge a handle-less mesh into a faithful
          // B-rep (importSTL + simplify) before chamfering; throws fail-clean.
          const hostHandle = await resolveBrepHostHandleAsync(geometry);
          const outcome = await buildBestEdgeFinder(ctx, geometry);
          // Reference lost → refuse with a reason. Do NOT fall through: a null
          // finder chamfers EVERY edge, a louder version of the same guess.
          if (outcome.lost) return refuseWithLostReference(geometry, outcome.lost, ctx);
          const out = applyChamferOcct(geometry, dist, outcome.finder, hostHandle);
          if (out) {
            if (dist !== requested) console.warn(`[chamfer] reduced ${requested}→${dist}mm to fit the solid`);
            return stampReducedChamfer(out, requested, dist, ctx?.featureId);
          }
        } catch (err) {
          if (i === 0) {
            console.warn('[chamfer] OCCT host resolution failed, falling back to mesh approximator:', err);
            captureKernelFailure({
              op: 'chamfer',
              stage: 'host-resolve',
              params: { distance: dist },
              geometry,
              error: err,
              resolution: { strategy: 'mesh-fallback', requested: { distance: dist } },
            });
          }
        }
      }
      const out = applyChamferMeshCsg(geometry, dist, ctx, wantedOcct);
      if (dist !== requested) console.warn(`[chamfer] reduced ${requested}→${dist}mm to fit the solid`);
      return stampReducedChamfer(out, requested, dist, ctx?.featureId);
    } catch (err) {
      lastErr = err; // too large at this distance — try a smaller bevel
    }
  }
  throw lastErr ?? new Error('Chamfer produced no geometry');
}

export const chamferFeature: FeatureDefinition = {
  type: 'chamfer',
  icon: '📐',
  params: [
    { key: 'distance', labelKey: 'paramChamferDistance', default: 2, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    {
      key: 'engine',
      labelKey: 'paramBoolEngine',
      default: 1,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'enumEngineMeshCsg' },
        { value: 1, labelKey: 'enumEngineOcct' },
      ],
    },
  ],
  applyAsync: applyChamferWithEdgeFinder,
  apply: applyChamferSync,
};
