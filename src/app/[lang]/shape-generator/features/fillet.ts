import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { occtEdgeSignatures, occtTopoNames, occtTopoAnchor, type ReplicadEdgeFinder } from './occtEngine';
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
  resolveEdgeFinderBySignature,
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
  // Primary (topology-tolerant): re-anchor to a real current edge by signature.
  const handle = geometry?.userData?.occtHandle as string | undefined;
  if (handle) {
    const sel = sels[0]!;
    const sigs = occtEdgeSignatures(handle);
    // K7-S3 — A안(생성-이력 이름) 우선 해석. 선택에 topoName 이 저장돼 있고 현재
    // 핸들에 이름표가 있으면: 이름이 실재 → 그 앵커와 일치하는 현재 에지가 곧
    // 정답(정확 서명으로 파인더 구성). 이름표는 있는데 이름이 사라짐 → 명시
    // 상실(추측 적용 금지, ADR-017 D1). 이름표 자체가 없는 핸들(미배선 생산
    // 경로)은 기존 B안 그대로. A가 정하면 B(저장 클릭서명)는 대조군으로 병행
    // 판정만 하고, 다른 에지를 골랐을 때 로그를 남긴다(S5 강등 근거 수집).
    if (sel.topoName && occtTopoNames(handle)) {
      const anchor = occtTopoAnchor(handle, sel.topoName);
      if (!anchor) {
        return { finder: null, lost: { status: 'lost', reason: 'name_gone', suggestion: null } };
      }
      const aIndex = sigs.findIndex(sg =>
        Math.hypot(sg.mid[0] - anchor.x, sg.mid[1] - anchor.y, sg.mid[2] - anchor.z) <= 1e-2);
      if (aIndex >= 0) {
        const target = sigs[aIndex]!;
        const exact = {
          ...sel,
          position: [target.mid[0], target.mid[1], target.mid[2]] as [number, number, number],
          direction: [target.dir[0], target.dir[1], target.dir[2]] as [number, number, number],
          length: target.length,
          bbox: undefined, // 현재 좌표 그대로 — bbox 재사상은 항등이어야 한다
        };
        const resA = await resolveEdgeFinderBySignature(exact, sigs, undefined);
        if (resA.status === 'matched') {
          const resB = await resolveEdgeFinderBySignature(sel, sigs, currentBbox);
          if (resB.status === 'matched' && resB.index !== undefined && resB.index !== aIndex) {
            console.warn('[fillet] K7-S3 A/B mismatch — name picked a different edge than the click signature', {
              topoName: sel.topoName, aIndex, bIndex: resB.index,
            });
          } else if (resB.status === 'lost') {
            console.warn('[fillet] K7-S3 A/B mismatch — name resolved but signature reported lost', {
              topoName: sel.topoName, aIndex, bReason: resB.reason,
            });
          }
          return { finder: resA.finder };
        }
        // A 앵커는 실재하나 파인더 구성 불가(replicad 미가용 등) — 기존 경로 속행.
      }
      // 이름은 있으나 현재 에지와 앵커 불일치(중점 이동) — 커널 히스토리 없는
      // 브라우저 합성의 한계다. 단정하지 않고 기존 B안 판정에 맡긴다.
    }
    const res = await resolveEdgeFinderBySignature(sel, sigs, currentBbox);
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
