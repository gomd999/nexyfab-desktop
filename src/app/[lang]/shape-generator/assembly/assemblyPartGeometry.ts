/**
 * assemblyPartGeometry — Phase 5.2.3.x bridge for "Infer mates" in the
 * AssemblyBrowserModal.
 *
 * The mate-inference module (`stepAssemblyMateInference.ts`) consumes a
 * `Record<string, FaceData[]>` + `Record<string, AxisData[]>` keyed by
 * partId, where each entry holds WORLD-frame face / axis geometry. The
 * STEP-import path produces that data by walking ADVANCED_FACE entities
 * via `extractFaceDataFromSolid` + `extractAxisDataFromSolid`.
 *
 * The own-CAD path (FeatureTree) doesn't have OCCT yet — Phase 1 of this
 * bridge derives a coarse approximation:
 *   - Every `extrude` node contributes 6 axis-aligned PLANE faces of an
 *     AABB sized to the loop bounding box + extrude depth. The faces are
 *     produced in local frame, then transformed to world frame using the
 *     PartInstance's `position` + `orientation` (quaternion rotation).
 *   - Every `revolve` node contributes 1 axis. The axis direction is the
 *     world-frame +Y (the canonical axis after `buildRevolveFromLoop`
 *     normalises the sketch into Y-up). Origin = (0,0,0) in local frame,
 *     transformed to world.
 *
 * What this is NOT:
 *   - A real B-rep face evaluator. Box faces are AABB-only; we do not
 *     consider draft angle, non-rectangular profiles, or cuts.
 *   - A precise hole / cylinder feature scanner. Holes contribute nothing
 *     in this pass (Phase 2 wishlist).
 *   - A surface-bound check. Two AABB faces that happen to be coplanar
 *     within tolerance get a coincident suggestion even if the parts
 *     don't overlap in the other 2 axes — exactly the false-positive
 *     scenario the inference module's docstring warns about.
 *
 * Phase 2 wishlist (real OCCT geometry):
 *   - Run replayTree → OCCT face extraction → world-frame transforms.
 *   - Include hole axes (already in FeatureTree as `hole_axis_N`).
 *   - Add cylindrical surface faces from revolve nodes.
 *   - Respect cut features (subtract face from outer).
 *   - Tighter loop-bbox: include all non-suppressed extrudes per part, not
 *     just the first one (multi-feature parts).
 *
 * The export surface is intentionally small + sync so the modal can
 * compute on-click without an async boundary, matching the task spec.
 */

import type { FeatureTree } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { PartInstance, Quat } from '@/lib/assembly/assemblyState';
import type { Vec3 } from '@/lib/sketch/sketchPlane';
import type { FaceData, AxisData } from '@/lib/brep-bridge/stepAssemblyMateInference';

// ─── quaternion rotation ─────────────────────────────────────────────────

/**
 * Rotate a 3D vector by a unit quaternion. Standard formula:
 *   v' = q * v * q⁻¹  →  v' = v + 2 * q.xyz × (q.xyz × v + q.w * v)
 *
 * Identity quaternion → returns the input unchanged.
 */
export function rotateVecByQuat(v: Vec3, q: Quat): Vec3 {
  // tx = 2 * (qy*vz - qz*vy)
  // ty = 2 * (qz*vx - qx*vz)
  // tz = 2 * (qx*vy - qy*vx)
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  // result = v + q.w * t + (q.xyz × t)
  const rx = v.x + q.w * tx + (q.y * tz - q.z * ty);
  const ry = v.y + q.w * ty + (q.z * tx - q.x * tz);
  const rz = v.z + q.w * tz + (q.x * ty - q.y * tx);
  return { x: rx, y: ry, z: rz };
}

/** Transform a local-frame point to world frame using part placement. */
function pointLocalToWorld(local: Vec3, part: PartInstance): Vec3 {
  const rotated = rotateVecByQuat(local, part.orientation);
  return {
    x: rotated.x + part.position.x,
    y: rotated.y + part.position.y,
    z: rotated.z + part.position.z,
  };
}

/** Transform a local-frame direction (origin-free) to world frame. */
function dirLocalToWorld(local: Vec3, part: PartInstance): Vec3 {
  return rotateVecByQuat(local, part.orientation);
}

// ─── extrude → 6 PLANE faces (AABB approx) ───────────────────────────────

interface Bbox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function loopBbox2D(loop: ReadonlyArray<{ x: number; y: number }>): Bbox2D | null {
  if (loop.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  if (maxX - minX < 1e-9 || maxY - minY < 1e-9) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Approximate the 6 axis-aligned PLANE faces of an extrude as the AABB of
 * its loop swept along +Z by `depth`. The local frame matches OpenSCAD's
 * convention: loop in XY at z=0, extrude direction +Z.
 *
 * Returned faces use the namespace `extrude_<nodeId>_<side>` so different
 * extrude nodes within the same part don't collide.
 */
function extrudeFacesLocal(
  ext: ExtrudeFeature,
  nodeId: string,
): FaceData[] {
  const bb = loopBbox2D(ext.loop);
  if (!bb) return [];
  const depth = ext.depth;
  if (!Number.isFinite(depth) || depth <= 0) return [];
  // We treat the extrude as one-sided +Z regardless of `direction` for
  // the Phase 1 approximation — the inference module just needs face
  // centroids close to the touching surface, and a 5mm offset in Z for
  // a two-sided extrude doesn't change which mates get suggested.
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const cz = depth / 2;
  const faces: FaceData[] = [
    // top  (+Z, normal +Z, origin at top centroid)
    {
      id: `extrude_${nodeId}_top`,
      origin: { x: cx, y: cy, z: depth },
      normal: { x: 0, y: 0, z: 1 },
    },
    // bottom (-Z)
    {
      id: `extrude_${nodeId}_bottom`,
      origin: { x: cx, y: cy, z: 0 },
      normal: { x: 0, y: 0, z: -1 },
    },
    // front (-Y)
    {
      id: `extrude_${nodeId}_front`,
      origin: { x: cx, y: bb.minY, z: cz },
      normal: { x: 0, y: -1, z: 0 },
    },
    // back (+Y)
    {
      id: `extrude_${nodeId}_back`,
      origin: { x: cx, y: bb.maxY, z: cz },
      normal: { x: 0, y: 1, z: 0 },
    },
    // left (-X)
    {
      id: `extrude_${nodeId}_left`,
      origin: { x: bb.minX, y: cy, z: cz },
      normal: { x: -1, y: 0, z: 0 },
    },
    // right (+X)
    {
      id: `extrude_${nodeId}_right`,
      origin: { x: bb.maxX, y: cy, z: cz },
      normal: { x: 1, y: 0, z: 0 },
    },
  ];
  return faces;
}

/**
 * Derive a single axis from a revolve node. `buildRevolveFromLoop` rotates
 * the sketch into a canonical Y-up frame, so the local-frame axis is +Y
 * passing through origin. (We don't read the original AxisLine2D — the
 * canonical frame is the persisted contract.)
 */
function revolveAxisLocal(
  _rev: RevolveFeature,
  nodeId: string,
): AxisData {
  return {
    id: `revolve_${nodeId}_axis`,
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 0, y: 1, z: 0 },
  };
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Derive world-frame face data for a single part from its FeatureTree.
 * When the tree is undefined the part contributes no faces (the inference
 * module treats this as an empty list and emits no suggestions for that
 * part).
 *
 * Multiple extrude nodes contribute multiple sets of 6 faces — the
 * inference module will dedup pairs within the same part by its mateDedupKey.
 */
export function deriveFaceDataForPart(
  part: PartInstance,
  tree: FeatureTree | undefined,
): FaceData[] {
  if (!tree) return [];
  const localFaces: FaceData[] = [];
  for (const node of tree.nodes) {
    if (node.suppressed) continue;
    const payload = node.payload;
    if (payload.kind === 'extrude') {
      localFaces.push(...extrudeFacesLocal(payload, node.id));
    }
  }
  // World-frame transform.
  return localFaces.map((f) => ({
    id: f.id,
    origin: pointLocalToWorld(f.origin, part),
    normal: dirLocalToWorld(f.normal, part),
  }));
}

/**
 * Derive world-frame axis data for a single part from its FeatureTree.
 * Currently only revolve features contribute (Phase 1 scope — holes will
 * follow once the inference module gains hole-axis pairing).
 */
export function deriveAxisDataForPart(
  part: PartInstance,
  tree: FeatureTree | undefined,
): AxisData[] {
  if (!tree) return [];
  const localAxes: AxisData[] = [];
  for (const node of tree.nodes) {
    if (node.suppressed) continue;
    const payload = node.payload;
    if (payload.kind === 'revolve') {
      localAxes.push(revolveAxisLocal(payload, node.id));
    }
  }
  return localAxes.map((a) => ({
    id: a.id,
    origin: pointLocalToWorld(a.origin, part),
    direction: dirLocalToWorld(a.direction, part),
  }));
}

/**
 * Bulk-derive partFaces + partAxes records for an entire assembly. Output
 * is keyed by PartInstance.id and ready to pass to
 * `inferMatesFromPlacements(state, faces, axes)`.
 *
 * Parts without a matching FeatureTree entry contribute empty arrays. The
 * inference module treats those as "no geometry" parts.
 */
export function derivePartGeometryForAssembly(
  parts: ReadonlyArray<PartInstance>,
  trees: Record<string, FeatureTree>,
): {
  partFaces: Record<string, FaceData[]>;
  partAxes: Record<string, AxisData[]>;
} {
  const partFaces: Record<string, FaceData[]> = {};
  const partAxes: Record<string, AxisData[]> = {};
  for (const part of parts) {
    const tree = trees[part.id];
    partFaces[part.id] = deriveFaceDataForPart(part, tree);
    partAxes[part.id] = deriveAxisDataForPart(part, tree);
  }
  return { partFaces, partAxes };
}
