import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { isOcctReady, isOcctGlobalMode, occtChamferBox, hostBoxFromGeometry, type ReplicadEdgeFinder } from './occtEngine';
import { stampFaceFeatureIdAll, configureEvaluatorForProvenance, propagateFeatureIdMap } from './faceProvenance';
import { assertRoundingApplied } from './roundingGuard';
import { tryMeshChamfer } from './meshRounding';
import {
  buildEdgeFinderFromSelection,
  buildEdgeFinderFromMultiSelection,
  buildEdgeFinderForLoop,
} from './topologyEdgeFinder';

function makeBrush(geo: THREE.BufferGeometry): Brush {
  return new Brush(geo, new THREE.MeshStandardMaterial());
}

async function buildBestEdgeFinder(
  ctx?: FeatureApplyContext,
): Promise<ReplicadEdgeFinder | null> {
  const sels = ctx?.edgeSelections;
  if (!sels || sels.length === 0) return null;
  if (sels.length >= 2) {
    const loop = await buildEdgeFinderForLoop(sels);
    if (loop) return loop;
    return buildEdgeFinderFromMultiSelection(sels);
  }
  return buildEdgeFinderFromSelection(sels[0]!);
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
  if (guardNoOp) assertRoundingApplied(geometry, result.geometry, 'Chamfer');
  return result.geometry;
}

function applyChamferSync(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): THREE.BufferGeometry {
  const dist = params.distance!;
  const engine = Math.round(params.engine ?? 0);
  const wantedOcct = engine === 1 || isOcctGlobalMode();
  if (wantedOcct && isOcctReady()) {
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
  const wantedOcct = engine === 1 || isOcctGlobalMode();
  if (wantedOcct && isOcctReady()) {
    const edgeFinder = await buildBestEdgeFinder(ctx);
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
