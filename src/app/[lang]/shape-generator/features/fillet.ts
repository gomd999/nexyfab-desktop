import * as THREE from 'three';
import { Evaluator, Brush, INTERSECTION } from 'three-bvh-csg';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { isOcctReady, isOcctGlobalMode, occtFilletBox, occtEdgeSignatures, hostBoxFromGeometry, type ReplicadEdgeFinder } from './occtEngine';
import { stampFaceFeatureIdAll, configureEvaluatorForProvenance, propagateFeatureIdMap } from './faceProvenance';
import { assertRoundingApplied } from './roundingGuard';
import { tryMeshFillet } from './meshRounding';
import {
  buildEdgeFinderFromSelection,
  buildEdgeFinderFromMultiSelection,
  buildEdgeFinderForLoop,
  buildEdgeFinderBySignature,
} from './topologyEdgeFinder';
import { serverFillet, type ServerFilletParams } from '@/lib/occt-server-client';
import { tryServerOp, getSourceR2Key, type ServerOpts } from './serverOcctHelper';

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

/** Build the most-specific EdgeFinder for a selection set.
 *  Priority: loop (axis-aligned cluster) → multi → single → null. */
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
    return rounded;
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
    configureEvaluatorForProvenance(evaluator, runningGeo, intermediate);
    resultBrush = evaluator.evaluate(resultBrush, makeBrush(intermediate), INTERSECTION);
    propagateFeatureIdMap(resultBrush.geometry, runningGeo, intermediate);
    runningGeo = resultBrush.geometry;
  }
  if (guardNoOp) assertRoundingApplied(geometry, resultBrush.geometry, 'Fillet');
  return resultBrush.geometry;
}

function applyFilletOcct(
  geometry: THREE.BufferGeometry,
  radius: number,
  edgeFinder: ReplicadEdgeFinder | null,
): THREE.BufferGeometry | null {
  try {
    const upstreamHandle = (geometry.userData?.occtHandle as string | undefined) ?? null;
    const host = hostBoxFromGeometry(geometry);
    const result = occtFilletBox(host, radius, {}, upstreamHandle, edgeFinder ?? undefined);
    if (result.handle) result.geometry.userData.occtHandle = result.handle;
    return result.geometry;
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
  const wantedOcct = engine === 1 || isOcctGlobalMode();
  if (wantedOcct && isOcctReady()) {
    const out = applyFilletOcct(geometry, radius, null);
    if (out) return out;
  }
  // Reaching the mesh path with wantedOcct=true is a silent downgrade — guard
  // against shipping an unrounded part. Explicit engine=0 keeps the placeholder.
  return applyFilletMeshCsg(geometry, radius, segments, ctx, wantedOcct);
}

async function applyFilletWithEdgeFinder(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
): Promise<THREE.BufferGeometry> {
  const radius = params.radius!;
  const segments = Math.round(params.segments!);
  const engine = Math.round(params.engine ?? 0);
  const wantedOcct = engine === 1 || isOcctGlobalMode();
  if (wantedOcct && isOcctReady()) {
    const edgeFinder = await buildBestEdgeFinder(ctx, geometry);
    const out = applyFilletOcct(geometry, radius, edgeFinder);
    if (out) return out;
  }
  return applyFilletMeshCsg(geometry, radius, segments, ctx, wantedOcct);
}

/** W17 server-fallback variant. Tries nexyfab-occt-worker first when
 *  `serverOpts.jwtToken` is set + host volume > threshold; falls
 *  through to the existing OCCT/mesh chain otherwise. Non-breaking
 *  superset of applyFilletWithEdgeFinder.
 *
 *  Chained input: if `geometry.userData.serverStepR2Key` is set
 *  (previous op's output), we pass it as `sourceR2Key` so the worker
 *  imports the prior shape instead of building a fresh box host. */
export async function applyFilletAsyncWithServer(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  ctx?: FeatureApplyContext,
  serverOpts?: ServerOpts,
): Promise<THREE.BufferGeometry> {
  // W17 — respect engine=0 (mesh-csg) choice; server is OCCT, so
  // routing there would override the user's explicit "mesh, please"
  // setting. Same gate as the local OCCT path uses below.
  const engine = Math.round(params.engine ?? 0);
  const wantsOcct = engine === 1 || isOcctGlobalMode();

  if (wantsOcct && serverOpts?.jwtToken) {
    const radius = params.radius!;
    const sourceR2Key = getSourceR2Key(geometry);
    const serverParams: ServerFilletParams = sourceR2Key
      ? { sourceR2Key, radius, edges: 'all' }
      : { host: hostBoxFromGeometry(geometry), radius, edges: 'all' };
    const result = await tryServerOp(
      'fillet',
      geometry,
      (opts) => serverFillet(serverParams, opts),
      serverOpts,
    );
    if (result) return result;
  }
  return applyFilletWithEdgeFinder(geometry, params, ctx);
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
