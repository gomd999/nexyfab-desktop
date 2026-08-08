import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { type ReplicadEdgeFinder } from './occtEngine';
import { wantsOcctEngine, shouldUseOcctEngine } from './engineSelection';
import { stampFaceFeatureIdAll, propagateFeatureIdMap } from './faceProvenance';
import { configureEvaluatorAttributes } from './meshMerge';
import { assertRoundingApplied } from './roundingGuard';
import { classifyMeshDowngrade, stampDowngrade, makeReducedNotice, clearStaleBrepHandle } from './downgradeNotice';
import { tryMeshFillet } from './meshRounding';
import {
  occtFilletWithAvoidanceSync,
  occtFilletWithAvoidanceAsync,
  type FilletAvoidanceResult,
} from './occtFilletAvoidance';
import {
  buildEdgeFinderFromSelection,
  buildEdgeFinderFromMultiSelection,
  buildEdgeFinderForLoop,
  resolveEdgeRefDual,
  makeReferenceLostNotice,
  type EdgeRefResolution,
} from './topologyEdgeFinder';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

/** World bbox of the current solid, so the finder can remap a stored click
 *  point through a dimension change (scale-aware edge re-resolution). */
function currentBboxOf(geometry: THREE.BufferGeometry):
  { min: [number, number, number]; max: [number, number, number] } | undefined {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return undefined;
  return { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] };
}

/** A finder, or an explicit "the stored reference is gone" verdict. `lost` is
 *  never accompanied by a finder — see EdgeRefResolution. */
type FinderOutcome =
  | { finder: ReplicadEdgeFinder | null; lost?: undefined }
  | { finder: null; lost: Extract<EdgeRefResolution, { status: 'lost' }> };

/** Build the most-specific EdgeFinder for a selection set.
 *  Priority: loop (axis-aligned cluster) → multi → single → null.
 *
 *  ⚠ When the signature matcher explicitly LOSES the reference we return that
 *  verdict instead of dropping to the click-point finder. The stale click point
 *  is less informed than the signature the matcher just rejected, so using it
 *  would fillet a guessed edge and tell the user nothing (ADR-017 §D1). */
export async function buildBestEdgeFinder(
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
  // Primary (topology-tolerant): K7-S4 공용 이중화 해석 — A안(생성-이력 이름)
  // 우선, B안(서명) 폴백+대조군. 로직은 topologyEdgeFinder.resolveEdgeRefDual
  // 단일 소스(S3에서 이 파일 인라인으로 검증 후 추출).
  const handle = geometry?.userData?.occtHandle as string | undefined;
  if (handle) {
    const res = await resolveEdgeRefDual(sels[0]!, handle, currentBbox, 'fillet');
    if (res.status === 'matched') return { finder: res.finder };
    if (res.status === 'lost') return { finder: null, lost: res };
    // 'unavailable' — nothing was ruled out, so the click-point path is fair game.
  }
  return { finder: await buildEdgeFinderFromSelection(sels[0]!, { currentBbox }) };
}

/** Refuse the feature with a reason the UI can show. Returns the input solid
 *  unchanged (cloned so the notice never leaks onto the upstream geometry). */
function refuseWithLostReference(
  geometry: THREE.BufferGeometry,
  lost: Extract<EdgeRefResolution, { status: 'lost' }>,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry {
  const out = geometry.clone();
  out.userData = { ...geometry.userData };
  console.warn(`[fillet] edge reference lost (${lost.reason}) — not applying to a guessed edge`);
  stampDowngrade(out, makeReferenceLostNotice('Fillet', lost.reason, ctx?.featureId));
  return out;
}

function applyFilletMeshCsg(
  geometry: THREE.BufferGeometry,
  radius: number,
  segments: number,
  ctx?: FeatureApplyContext,
  guardNoOp = false,
): THREE.BufferGeometry {
  // Real rounding for box-like solids (no OCCT needed). Non-box ⇒ null, then
  // the legacy approximation runs and (if a silent downgrade) the guard fires.
  const rounded = tryMeshFillet(geometry, radius);
  if (rounded) {
    if (ctx?.featureId) stampFaceFeatureIdAll(rounded, ctx.featureId);
    return clearStaleBrepHandle(rounded);
  }
  if (!geometry.index) {
    throw new Error('Fillet requires indexed (manifold) geometry');
  }
  if (geometry.attributes.position.count < 4) {
    throw new Error('Fillet requires geometry with at least 4 vertices');
  }
  const evaluator = new Evaluator();
  let resultBrush = makeBrush(geometry.clone());
  let runningGeo = resultBrush.geometry;

  for (let s = 1; s <= segments; s++) {
    const t = s / (segments + 1);
    const offset = radius * (1 - Math.cos((t * Math.PI) / 2));
    const intermediate = geometry.clone();
    intermediate.computeVertexNormals();
    const iPos = intermediate.attributes.position;
    const iNor = intermediate.attributes.normal;
    for (let i = 0; i < iPos.count; i++) {
      iPos.setX(i, iPos.getX(i) + iNor.getX(i) * offset);
      iPos.setY(i, iPos.getY(i) + iNor.getY(i) * offset);
      iPos.setZ(i, iPos.getZ(i) + iNor.getZ(i) * offset);
    }
    iPos.needsUpdate = true;
    if (ctx?.featureId) {
      stampFaceFeatureIdAll(intermediate, ctx.featureId, { avoidIdsFrom: runningGeo });
    }
    configureEvaluatorAttributes(evaluator, runningGeo, intermediate);
    resultBrush = evaluator.evaluate(resultBrush, makeBrush(intermediate), INTERSECTION);
    propagateFeatureIdMap(resultBrush.geometry, runningGeo, intermediate);
    runningGeo = resultBrush.geometry;
  }
  if (guardNoOp) {
    // No-op against B-rep intent → throw (blocked). Past that, the mesh CSG DID
    // round but it is a faceted approximation, not exact B-rep — stamp a soft,
    // non-fatal downgrade notice so the UI stops shipping it silently.
    assertRoundingApplied(geometry, resultBrush.geometry, 'Fillet');
    stampDowngrade(
      resultBrush.geometry,
      classifyMeshDowngrade({
        op: 'Fillet',
        featureId: ctx?.featureId,
        wantedOcct: true,
        occtRan: false,
        isNoOp: false,
      }),
    );
  }
  // Mesh approximation output must never carry the upstream B-rep handle.
  return clearStaleBrepHandle(resultBrush.geometry);
}

/** Retry the mesh fillet at progressively smaller radii. A radius too large for
 *  the solid collapses the CSG / fails the no-op guard; fit the largest bevel
 *  that works instead of erroring the whole feature (mirrors chamfer). The OCCT
 *  path already has its own reduced-radius ladder — this guards the mesh path. */
function meshFilletWithRetry(
  geometry: THREE.BufferGeometry,
  radius: number,
  segments: number,
  ctx?: FeatureApplyContext,
  guardNoOp = false,
): THREE.BufferGeometry {
  const candidates: number[] = [radius];
  for (const f of [0.5, 0.25, 0.1]) {
    const d = Math.round(radius * f * 1000) / 1000;
    if (d >= 0.1 && !candidates.includes(d)) candidates.push(d);
  }
  let lastErr: unknown = null;
  for (let i = 0; i < candidates.length; i++) {
    try {
      const out = applyFilletMeshCsg(geometry, candidates[i]!, segments, ctx, guardNoOp);
      if (candidates[i] !== radius) console.warn(`[fillet] reduced ${radius}→${candidates[i]}mm to fit the solid`);
      return out;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('Fillet produced no geometry');
}

/**
 * Materialize an avoidance outcome: attach the B-rep handle and — when the
 * kernel applied something other than what was requested — stamp a 'reduced'
 * downgrade notice so the UI shows requested vs applied (never silent).
 */
function materializeFilletOutcome(
  out: FilletAvoidanceResult,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry {
  if (out.handle) out.geometry.userData.occtHandle = out.handle;
  if (out.strategy === 'reduced-radius') {
    stampDowngrade(out.geometry, makeReducedNotice({
      op: 'Fillet',
      featureId: ctx?.featureId,
      requested: { radius: out.requestedRadius },
      applied: { radius: out.appliedRadius },
      detail: `R ${out.requestedRadius} → ${out.appliedRadius} mm`,
    }));
  } else if (out.strategy === 'partial-edges') {
    stampDowngrade(out.geometry, makeReducedNotice({
      op: 'Fillet',
      featureId: ctx?.featureId,
      requested: { radius: out.requestedRadius, edges: out.edgesRequested ?? 0 },
      applied: { radius: out.appliedRadius, edges: out.edgesApplied ?? 0 },
      detail: `${out.edgesApplied}/${out.edgesRequested} edges @ R ${out.appliedRadius} mm`,
    }));
  }
  return out.geometry;
}

function applyFilletOcct(
  geometry: THREE.BufferGeometry,
  radius: number,
  edgeFinder: ReplicadEdgeFinder | null,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry | null {
  try {
    const out = occtFilletWithAvoidanceSync(geometry, radius, edgeFinder, { featureId: ctx?.featureId });
    if (!out) {
      console.warn('[fillet] OCCT path failed (avoidance exhausted), falling back to mesh approximator');
      return null;
    }
    return materializeFilletOutcome(out, ctx);
  } catch (err) {
    console.warn('[fillet] OCCT path failed, falling back to mesh approximator:', err);
    return null;
  }
}

function applyFilletSync(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry {
  const radius = params.radius!;
  const segments = Math.round(params.segments!);
  const engine = Math.round(params.engine ?? 0);
  // Sync path: no EdgeFinder (can't await dynamic replicad import).
  // OCCT still runs globally if engine === 1.
  const wantedOcct = wantsOcctEngine(engine);
  if (shouldUseOcctEngine(engine)) {
    const out = applyFilletOcct(geometry, radius, null, ctx);
    if (out) return out;
  }
  // Reaching the mesh path with wantedOcct=true is a silent downgrade — guard
  // against shipping an unrounded part. Explicit engine=0 keeps the placeholder.
  return meshFilletWithRetry(geometry, radius, segments, ctx, wantedOcct);
}

async function applyFilletWithEdgeFinder(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): Promise<THREE.BufferGeometry> {
  const radius = params.radius!;
  const segments = Math.round(params.segments!);
  const engine = Math.round(params.engine ?? 0);
  const wantedOcct = wantsOcctEngine(engine);
  if (shouldUseOcctEngine(engine)) {
    const outcome = await buildBestEdgeFinder(ctx, geometry);
    // Reference lost → refuse with a reason. Do NOT fall through: a null finder
    // would fillet EVERY edge, which is a louder version of the same guess.
    if (outcome.lost) return refuseWithLostReference(geometry, outcome.lost, ctx);
    const edgeFinder = outcome.finder;
    try {
      // Async avoidance: reduced-radius ladder + per-edge subset fallback
      // (the latter only when the user picked ≥2 edges).
      const out = await occtFilletWithAvoidanceAsync(geometry, radius, edgeFinder, {
        featureId: ctx?.featureId,
        edgeSelections: ctx?.edgeSelections,
      });
      if (out) return materializeFilletOutcome(out, ctx);
      console.warn('[fillet] OCCT path failed (avoidance exhausted), falling back to mesh approximator');
    } catch (err) {
      console.warn('[fillet] OCCT path failed, falling back to mesh approximator:', err);
    }
  }
  return meshFilletWithRetry(geometry, radius, segments, ctx, wantedOcct);
}

export const filletFeature: FeatureDefinition = {
  type: 'fillet',
  icon: '⭕',
  params: [
    { key: 'radius', labelKey: 'paramFilletRadius', default: 3, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    { key: 'segments', labelKey: 'paramFilletSegments', default: 3, min: 1, max: 5, step: 1, unit: '' },
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
  applyAsync: applyFilletWithEdgeFinder,
  apply: applyFilletSync,
};
