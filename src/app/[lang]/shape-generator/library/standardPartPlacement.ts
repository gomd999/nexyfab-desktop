/**
 * Standard Part Auto-Placement Engine
 *
 * When a standard part is dropped onto a face in the 3D viewport via
 * StandardPartDropHandler, this module:
 *
 *  1. Reads the part definition from STANDARD_PARTS_MAP.
 *  2. Generates the part geometry with default (or previously set) params.
 *  3. Computes an automatic snap transform:
 *      – Aligns the part's natural contact axis to the target face normal.
 *      – Translates so the part rests on the face (no interpenetration).
 *  4. Registers the placed part in the assembly's `placedParts` list.
 *  5. Optionally infers the best mate type from the part category:
 *      – Fasteners on a flat face → Coincident + Concentric (bolt-hole).
 *      – Bearings on a bore face → Concentric.
 *      – Structural parts → Coincident.
 *  6. Returns a `PlacedStandardPart` descriptor the caller can persist.
 *
 * All geometry math is framework-free (no React) for testability.
 */

import * as THREE from 'three';
import { STANDARD_PARTS_MAP } from './standardParts';
import type { StandardPart } from './standardParts';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StandardPartParams {
  [key: string]: number;
}

export interface PlacedStandardPart {
  /** Unique placement ID */
  id: string;
  /** Part definition ID (maps to STANDARD_PARTS_MAP) */
  partId: string;
  /** Human-readable label */
  label: string;
  /** Parameter values used to generate geometry */
  params: StandardPartParams;
  /** World-space transform applied to the part geometry */
  transform: THREE.Matrix4;
  /** World position of the contact point */
  contactPoint: THREE.Vector3;
  /** Face normal at contact point */
  contactNormal: THREE.Vector3;
  /** ID of the host assembly body this part is mated to */
  hostBodyId?: string;
  /** Auto-inferred mate type */
  autoMateType: 'coincident' | 'concentric' | 'none';
  /** Timestamp of placement */
  placedAt: number;
}

export interface AutoPlacementResult {
  placed: PlacedStandardPart;
  /** Geometry ready for viewport display */
  geometry: THREE.BufferGeometry;
  /** Whether the auto-mate inferred a meaningful constraint */
  hasMate: boolean;
}

// ─── Contact axis table ───────────────────────────────────────────────────────
// Each category has a "natural" axis the part aligns along when placed.
// e.g. fasteners point along +Y (shaft down toward –Y), bearings rotate around Y.

const CATEGORY_CONTACT_AXIS: Record<string, THREE.Vector3> = {
  fastener: new THREE.Vector3(0, -1, 0), // shaft points down
  bearing:  new THREE.Vector3(0,  1, 0), // bore axis up
  structural: new THREE.Vector3(0, 1, 0), // rests on bottom face
  connector: new THREE.Vector3(0, -1, 0),
};

const CATEGORY_MATE_TYPE: Record<string, 'coincident' | 'concentric' | 'none'> = {
  fastener:   'concentric', // bolt aligns to hole
  bearing:    'concentric',
  structural: 'coincident',
  connector:  'coincident',
};

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Compute the bounding box bottom center — used as the contact point on the part.
 */
function getContactOffset(geo: THREE.BufferGeometry, axis: THREE.Vector3): THREE.Vector3 {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const center = new THREE.Vector3();
  bb.getCenter(center);
  // The contact point is at the "bottom" along the natural axis direction
  const extent = bb.getSize(new THREE.Vector3());
  const axisExtent = Math.abs(
    axis.x * extent.x + axis.y * extent.y + axis.z * extent.z
  ) / 2;
  return center.clone().addScaledVector(axis, -axisExtent);
}

/**
 * Build a Matrix4 that aligns `fromAxis` to `toAxis` around the origin.
 */
function alignAxis(fromAxis: THREE.Vector3, toAxis: THREE.Vector3): THREE.Matrix4 {
  const from = fromAxis.clone().normalize();
  const to = toAxis.clone().normalize();
  const dot = from.dot(to);
  const m = new THREE.Matrix4();

  if (Math.abs(dot + 1) < 1e-6) {
    // Anti-parallel: rotate 180° around any perpendicular axis
    const perp = Math.abs(from.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const axis = perp.clone().cross(from).normalize();
    m.makeRotationAxis(axis, Math.PI);
  } else if (Math.abs(dot - 1) < 1e-6) {
    // Already aligned
  } else {
    const axis = from.clone().cross(to).normalize();
    const angle = Math.acos(THREE.MathUtils.clamp(dot, -1, 1));
    m.makeRotationAxis(axis, angle);
  }
  return m;
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Auto-place a standard part on a face.
 *
 * @param partId        ID from STANDARD_PARTS_MAP
 * @param contactPoint  World position where the part was dropped
 * @param faceNormal    World-space normal of the target face
 * @param params        Optional override params (defaults used if absent)
 * @param hostBodyId    Optional ID of the host assembly body
 */
export function autoPlaceStandardPart(
  partId: string,
  contactPoint: THREE.Vector3,
  faceNormal: THREE.Vector3,
  params?: StandardPartParams,
  hostBodyId?: string,
): AutoPlacementResult {
  const partDef: StandardPart | undefined = STANDARD_PARTS_MAP[partId];
  if (!partDef) {
    throw new Error(`Unknown standard part: ${partId}`);
  }

  // Resolve params (defaults + overrides)
  const resolvedParams: StandardPartParams = {};
  for (const p of partDef.params) {
    resolvedParams[p.key] = params?.[p.key] ?? p.default;
  }

  // Generate geometry
  const result = partDef.generate(resolvedParams);
  const geo = result.geometry;

  // Determine natural axis and contact point on the part
  const naturalAxis = CATEGORY_CONTACT_AXIS[partDef.category] ?? new THREE.Vector3(0, 1, 0);
  const partContactOffset = getContactOffset(geo, naturalAxis);

  // Build transform:
  //  1. Rotate so natural axis aligns with face normal (part "sits" on face)
  //  2. Translate so part contact point meets world contact point
  const rotMat = alignAxis(naturalAxis, faceNormal.clone().normalize());

  // After rotation, where does the part contact offset land?
  const rotatedOffset = partContactOffset.clone().applyMatrix4(rotMat);
  const translation = contactPoint.clone().sub(rotatedOffset);
  const transMat = new THREE.Matrix4().makeTranslation(translation.x, translation.y, translation.z);

  const transform = new THREE.Matrix4().multiplyMatrices(transMat, rotMat);

  // Build placed part descriptor
  const placed: PlacedStandardPart = {
    id: `stdpart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    partId,
    label: `${partDef.standard} (${partId})`,
    params: resolvedParams,
    transform,
    contactPoint: contactPoint.clone(),
    contactNormal: faceNormal.clone().normalize(),
    hostBodyId,
    autoMateType: CATEGORY_MATE_TYPE[partDef.category] ?? 'none',
    placedAt: Date.now(),
  };

  // Apply transform to geometry for display
  const displayGeo = geo.clone().applyMatrix4(transform);

  return {
    placed,
    geometry: displayGeo,
    hasMate: placed.autoMateType !== 'none',
  };
}

/**
 * Update params on an existing placed part and re-generate geometry.
 */
export function updatePlacedPartParams(
  placed: PlacedStandardPart,
  newParams: Partial<StandardPartParams>,
): AutoPlacementResult {
  const merged: StandardPartParams = { ...placed.params };
  for (const [k, v] of Object.entries(newParams)) {
    if (v !== undefined) merged[k] = v;
  }
  return autoPlaceStandardPart(
    placed.partId,
    placed.contactPoint,
    placed.contactNormal,
    merged,
    placed.hostBodyId,
  );
}

/**
 * Serialize a placed part to a plain object for persistence.
 */
export function serialisePlacedPart(placed: PlacedStandardPart): Record<string, unknown> {
  return {
    id: placed.id,
    partId: placed.partId,
    label: placed.label,
    params: placed.params,
    transform: placed.transform.elements,
    contactPoint: placed.contactPoint.toArray(),
    contactNormal: placed.contactNormal.toArray(),
    hostBodyId: placed.hostBodyId,
    autoMateType: placed.autoMateType,
    placedAt: placed.placedAt,
  };
}

/**
 * Deserialize a placed part from a persisted object.
 */
export function deserialisePlacedPart(data: Record<string, unknown>): PlacedStandardPart {
  const t = new THREE.Matrix4();
  const el = data.transform as number[];
  if (Array.isArray(el) && el.length >= 16) t.fromArray(el);
  return {
    id: data.id as string,
    partId: data.partId as string,
    label: data.label as string,
    params: data.params as StandardPartParams,
    transform: t,
    contactPoint: new THREE.Vector3(...(data.contactPoint as [number, number, number])),
    contactNormal: new THREE.Vector3(...(data.contactNormal as [number, number, number])),
    hostBodyId: data.hostBodyId as string | undefined,
    autoMateType: data.autoMateType as 'coincident' | 'concentric' | 'none',
    placedAt: data.placedAt as number,
  };
}

/**
 * Get all placed parts that are mated to a specific host body.
 */
export function getPartsOnHost(
  parts: PlacedStandardPart[],
  hostBodyId: string,
): PlacedStandardPart[] {
  return parts.filter(p => p.hostBodyId === hostBodyId);
}

/**
 * Find the closest standard part to a world position.
 */
export function findNearestPlacedPart(
  parts: PlacedStandardPart[],
  worldPos: THREE.Vector3,
  maxDist = 100,
): PlacedStandardPart | null {
  let nearest: PlacedStandardPart | null = null;
  let nearestDist = maxDist;
  for (const p of parts) {
    const d = p.contactPoint.distanceTo(worldPos);
    if (d < nearestDist) { nearestDist = d; nearest = p; }
  }
  return nearest;
}
