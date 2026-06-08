import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { occtChamferBox, occtEdgeSignatures, hostBoxFromGeometry, type ReplicadEdgeFinder } from './occtEngine';
import { wantsOcctEngine, shouldUseOcctEngine } from './engineSelection';
import { stampFaceFeatureIdAll, configureEvaluatorForProvenance, propagateFeatureIdMap } from './faceProvenance';
import { assertRoundingApplied } from './roundingGuard';
import { classifyMeshDowngrade, stampDowngrade } from './downgradeNotice';
import { tryMeshChamfer } from './meshRounding';
import {
  buildEdgeFinderFromSelection,
  buildEdgeFinderFromMultiSelection,
  buildEdgeFinderForLoop,
  buildEdgeFinderBySignature,
} from './topologyEdgeFinder';

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

async function buildBestEdgeFinder(
  ctx?: FeatureApplyContext,
  geometry?: THREE.BufferGeometry,
): Promise<ReplicadEdgeFinder | null> {
  const sels = ctx?.edgeSelections;
  if (!sels || sels.length === 0) return null;
  const currentBbox = geometry ? currentBboxOf(geometry) : undefined;
  if (sels.length >= 2) {
    const loop = await buildEdgeFinderForLoop(sels, { currentBbox });
    if (loop) return loop;
    return buildEdgeFinderFromMultiSelection(sels, { currentBbox });
  }
  // Primary (topology-tolerant): re-anchor to a real current edge by signature.
  const handle = geometry?.userData?.occtHandle as string | undefined;
  if (handle) {
    const bySig = await buildEdgeFinderBySignature(sels[0]!, occtEdgeSignatures(handle), currentBbox);
    if (bySig) return bySig;
  }
  return buildEdgeFinderFromSelection(sels[0]!, { currentBbox });
}

function applyChamferOcct(
  geometry: THREE.BufferGeometry,
  dist: number,
  edgeFinder: ReplicadEdgeFinder | null,
): THREE.BufferGeometry | null {
  try {
    const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
    const host = hostBoxFromGeometry(geometry);
    const result = occtChamferBox(host, dist, {}, upstreamHandle, edgeFinder ?? undefined);
    if (result.handle) result.geometry.userData.occtHandle = result.handle;
    return result.geometry;
  } catch (err) {
    console.warn('[chamfer] OCCT path failed, falling back to mesh approximator:', err);
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
    return beveled;
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
  configureEvaluatorForProvenance(evaluator, expanded, geometry);
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
  return result.geometry;
}

function applyChamferSync(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry {
  const dist = params.distance!;
  const engine = Math.round(params.engine ?? 0);
  const wantedOcct = wantsOcctEngine(engine);
  if (shouldUseOcctEngine(engine)) {
    const out = applyChamferOcct(geometry, dist, null);
    if (out) return out;
  }
  return applyChamferMeshCsg(geometry, dist, ctx, wantedOcct);
}

async function applyChamferWithEdgeFinder(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): Promise<THREE.BufferGeometry> {
  const dist = params.distance!;
  const engine = Math.round(params.engine ?? 0);
  const wantedOcct = wantsOcctEngine(engine);
  if (shouldUseOcctEngine(engine)) {
    const edgeFinder = await buildBestEdgeFinder(ctx, geometry);
    const out = applyChamferOcct(geometry, dist, edgeFinder);
    if (out) return out;
  }
  return applyChamferMeshCsg(geometry, dist, ctx, wantedOcct);
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
