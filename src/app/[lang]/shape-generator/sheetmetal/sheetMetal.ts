import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeEdges, meshVolume, meshSurfaceArea } from '../shapes/index';
import type { ShapeResult } from '../shapes/index';

// ─── Sheet Metal Types ──────────────────────────────────────────────────────────

export interface SheetMetalParams {
  thickness: number;     // mm
  bendRadius: number;    // inner bend radius, mm
  kFactor: number;       // 0-1, default 0.44 for steel
}

export interface FlatPatternResult {
  geometry: THREE.BufferGeometry;
  edgeGeometry: THREE.BufferGeometry;
  totalLength: number;   // mm (unfolded length)
  totalWidth: number;    // mm
  bendLines: { start: THREE.Vector2; end: THREE.Vector2; angle: number }[];
}

// ─── Bend Calculations ──────────────────────────────────────────────────────────

/**
 * Standard bend allowance formula.
 * BA = pi * (r + k * t) * (angle / 180)
 * @param angle  bend angle in degrees
 * @param radius inner bend radius in mm
 * @param thickness sheet thickness in mm
 * @param kFactor  k-factor (0-1)
 */
export function calculateBendAllowance(
  angle: number,
  radius: number,
  thickness: number,
  kFactor: number,
): number {
  return Math.PI * (radius + kFactor * thickness) * (angle / 180);
}

/**
 * Bend deduction = 2 * setback - bend allowance.
 * Setback = tan(angle/2) * (radius + thickness)
 */
export function calculateBendDeduction(
  angle: number,
  radius: number,
  thickness: number,
  kFactor: number,
): number {
  const angleRad = (angle * Math.PI) / 180;
  const setback = Math.tan(angleRad / 2) * (radius + thickness);
  const ba = calculateBendAllowance(angle, radius, thickness, kFactor);
  return 2 * setback - ba;
}

// ─── Internal: build a bend arc segment ─────────────────────────────────────────

/**
 * Creates a curved sheet metal bend segment (arc) along the Z axis.
 * The bend curves in the YZ plane, width extends along X.
 */
function buildBendArc(
  width: number,
  angleDeg: number,
  params: SheetMetalParams,
  segments = 16,
): THREE.BufferGeometry {
  const { thickness, bendRadius } = params;
  const angleRad = (angleDeg * Math.PI) / 180;
  const rInner = bendRadius;
  const rOuter = bendRadius + thickness;

  const vertices: number[] = [];
  const indices: number[] = [];

  // Build arc cross-section rings at each segment step
  for (let i = 0; i <= segments; i++) {
    const frac = i / segments;
    const a = frac * angleRad;
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);

    // Inner and outer points at -width/2 and +width/2
    // Inner bottom-left, inner bottom-right, outer bottom-left, outer bottom-right
    const yIn = rInner * (1 - cosA);
    const zIn = rInner * sinA;
    const yOut = rOuter * (1 - cosA);
    const zOut = rOuter * sinA;

    // idx base for this ring: 4 vertices per ring
    const base = i * 4;
    // 0: inner left, 1: inner right, 2: outer left, 3: outer right
    vertices.push(-width / 2, yIn, zIn);   // inner left
    vertices.push(width / 2, yIn, zIn);    // inner right
    vertices.push(-width / 2, yOut, zOut);  // outer left
    vertices.push(width / 2, yOut, zOut);   // outer right

    if (i < segments) {
      const n = base + 4; // next ring base
      // Inner face (0,1 -> n+0, n+1)
      indices.push(base, n, n + 1, base, n + 1, base + 1);
      // Outer face (2,3 -> n+2, n+3) — reversed winding
      indices.push(base + 2, base + 3, n + 3, base + 2, n + 3, n + 2);
      // Left side (0,2 -> n+0, n+2)
      indices.push(base, base + 2, n + 2, base, n + 2, n);
      // Right side (1,3 -> n+1, n+3)
      indices.push(base + 1, n + 1, n + 3, base + 1, n + 3, base + 3);
    }
  }

  // Cap start (i=0)
  indices.push(0, 1, 3, 0, 3, 2);
  // Cap end (i=segments)
  const last = segments * 4;
  indices.push(last, last + 2, last + 3, last, last + 3, last + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ─── createSheetMetalBox ────────────────────────────────────────────────────────

/**
 * Creates an open-top box (tray) from bent sheet metal with bend radii at corners.
 * The base sits on the XZ plane, walls extend upward.
 */
export function createSheetMetalBox(
  width: number,
  height: number,
  depth: number,
  params: SheetMetalParams,
): ShapeResult {
  const { thickness, bendRadius } = params;
  const bendSegs = 8;

  // Base plate (flat, on XZ plane)
  const baseW = width - 2 * (bendRadius + thickness);
  const baseD = depth - 2 * (bendRadius + thickness);
  const base = new THREE.BoxGeometry(baseW, thickness, baseD);
  base.translate(0, thickness / 2, 0);

  const parts: THREE.BufferGeometry[] = [base];

  // Wall height (excluding bend arc contribution)
  const wallH = height - bendRadius;

  // 4 bends + 4 walls
  const sides = [
    { axis: 'z-', tx: 0, tz: -baseD / 2, rotY: 0 },
    { axis: 'z+', tx: 0, tz: baseD / 2, rotY: Math.PI },
    { axis: 'x-', tx: -baseW / 2, tz: 0, rotY: Math.PI / 2 },
    { axis: 'x+', tx: baseW / 2, tz: 0, rotY: -Math.PI / 2 },
  ];

  for (const side of sides) {
    const sideWidth = side.axis.startsWith('z') ? baseW : baseD;

    // Bend arc (90 degrees)
    const arc = buildBendArc(sideWidth, 90, params, bendSegs);
    // The arc starts at y=0, z=0 and bends upward
    // Position it at the edge of the base plate
    const m = new THREE.Matrix4()
      .makeRotationY(side.rotY)
      .setPosition(side.tx, thickness, side.tz);
    arc.applyMatrix4(m);
    parts.push(arc);

    // Wall plate extending upward from end of bend arc
    if (wallH > 0) {
      const wall = new THREE.BoxGeometry(sideWidth, wallH, thickness);
      // The wall starts at the top of the bend arc
      const wallOffset = bendRadius + thickness;
      const wallMat = new THREE.Matrix4();

      // Position: after the 90-degree bend, the wall goes upward
      // Bend arc ends at y = thickness + bendRadius, and offset outward by bendRadius + thickness
      const outwardDist = side.axis.startsWith('z')
        ? (side.tz < 0 ? -(bendRadius + thickness / 2) : (bendRadius + thickness / 2))
        : (side.tx < 0 ? -(bendRadius + thickness / 2) : (bendRadius + thickness / 2));

      if (side.axis.startsWith('z')) {
        wall.translate(0, thickness + bendRadius + wallH / 2, side.tz + (side.tz < 0 ? -bendRadius - thickness / 2 : bendRadius + thickness / 2));
      } else {
        wall.translate(side.tx + (side.tx < 0 ? -bendRadius - thickness / 2 : bendRadius + thickness / 2), thickness + bendRadius + wallH / 2, 0);
      }
      parts.push(wall);
    }
  }

  const geometry = mergeGeometries(parts);
  if (!geometry) throw new Error('Failed to merge sheet metal box geometries');
  geometry.computeVertexNormals();

  const edgeGeometry = makeEdges(geometry);
  const volume_cm3 = meshVolume(geometry) / 1000;
  const surface_area_cm2 = meshSurfaceArea(geometry) / 100;

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const bbox = {
    w: Math.round(bb.max.x - bb.min.x),
    h: Math.round(bb.max.y - bb.min.y),
    d: Math.round(bb.max.z - bb.min.z),
  };

  return { geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
}

// ─── createBend ─────────────────────────────────────────────────────────────────

/**
 * Apply a bend to a flat sheet geometry at the specified position.
 * Splits the sheet at bendPosition, inserts a bend arc, and repositions the far segment.
 *
 * @param sheetGeo    source flat sheet geometry
 * @param bendAngle   bend angle in degrees
 * @param bendPosition distance along the sheet (Z axis) where the bend occurs
 * @param bendAxis    axis of the bend ('x' or 'z')
 * @param params      sheet metal parameters
 */
export function createBend(
  sheetGeo: THREE.BufferGeometry,
  bendAngle: number,
  bendPosition: number,
  bendAxis: 'x' | 'z',
  params: SheetMetalParams,
): THREE.BufferGeometry {
  const { thickness, bendRadius } = params;

  // Compute bounding box of the source to get width
  sheetGeo.computeBoundingBox();
  const bb = sheetGeo.boundingBox!;
  const sheetWidth = bb.max.x - bb.min.x;
  const sheetLength = bb.max.z - bb.min.z;

  const width = bendAxis === 'x' ? sheetLength : sheetWidth;

  // First segment: from start to bend position
  const seg1 = new THREE.BoxGeometry(
    bendAxis === 'z' ? sheetWidth : bendPosition,
    thickness,
    bendAxis === 'z' ? bendPosition : sheetLength,
  );
  seg1.translate(
    bendAxis === 'z' ? 0 : bendPosition / 2,
    0,
    bendAxis === 'z' ? bendPosition / 2 : 0,
  );

  // Bend arc
  const arc = buildBendArc(width, bendAngle, params);
  const angleRad = (bendAngle * Math.PI) / 180;

  if (bendAxis === 'z') {
    // Bend along Z: arc bends in YZ plane
    arc.translate(0, 0, bendPosition);
  } else {
    // Bend along X: rotate arc to bend in XY plane
    const rotMat = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
    arc.applyMatrix4(rotMat);
    arc.translate(bendPosition, 0, 0);
  }

  // Second segment: remaining length after bend
  const remainingLength = (bendAxis === 'z' ? sheetLength : sheetWidth) - bendPosition;
  if (remainingLength <= 0) {
    const merged = mergeGeometries([seg1, arc]);
    if (!merged) throw new Error('Failed to merge bend geometries');
    merged.computeVertexNormals();
    return merged;
  }

  const seg2 = new THREE.BoxGeometry(
    bendAxis === 'z' ? sheetWidth : remainingLength,
    thickness,
    bendAxis === 'z' ? remainingLength : sheetLength,
  );

  // Position second segment at the end of the bend arc
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);
  const arcEndY = bendRadius * (1 - cosA);
  const arcEndZ = bendRadius * sinA;

  if (bendAxis === 'z') {
    // After bend, the second segment extends along the bend direction
    seg2.translate(0, arcEndY + thickness / 2, bendPosition + arcEndZ + (remainingLength / 2) * cosA);
    const rotMat = new THREE.Matrix4().makeRotationX(-angleRad);
    seg2.applyMatrix4(
      new THREE.Matrix4().makeTranslation(0, arcEndY, bendPosition + arcEndZ),
    );
  } else {
    seg2.translate(bendPosition + arcEndZ + (remainingLength / 2) * cosA, arcEndY + thickness / 2, 0);
  }

  const merged = mergeGeometries([seg1, arc, seg2]);
  if (!merged) throw new Error('Failed to merge bend geometries');
  merged.computeVertexNormals();
  return merged;
}

// ─── createFlange ───────────────────────────────────────────────────────────────

/**
 * Add a flange (bent extension) at an edge of the sheet.
 *
 * @param sheetGeo  source sheet geometry
 * @param edgeIndex 0=+Z, 1=-Z, 2=+X, 3=-X edge
 * @param height    flange height in mm
 * @param angle     flange angle in degrees (90 for standard L-flange)
 * @param params    sheet metal parameters
 */
export function createFlange(
  sheetGeo: THREE.BufferGeometry,
  edgeIndex: number,
  height: number,
  angle: number,
  params: SheetMetalParams,
): THREE.BufferGeometry {
  const { thickness, bendRadius } = params;

  sheetGeo.computeBoundingBox();
  const bb = sheetGeo.boundingBox!;
  const sheetW = bb.max.x - bb.min.x;
  const sheetD = bb.max.z - bb.min.z;

  // Determine flange width and attachment position based on edge
  let flangeWidth: number;
  let attachPos: THREE.Vector3;
  let rotY: number;

  switch (edgeIndex) {
    case 0: // +Z edge
      flangeWidth = sheetW;
      attachPos = new THREE.Vector3(0, bb.min.y, bb.max.z);
      rotY = 0;
      break;
    case 1: // -Z edge
      flangeWidth = sheetW;
      attachPos = new THREE.Vector3(0, bb.min.y, bb.min.z);
      rotY = Math.PI;
      break;
    case 2: // +X edge
      flangeWidth = sheetD;
      attachPos = new THREE.Vector3(bb.max.x, bb.min.y, 0);
      rotY = -Math.PI / 2;
      break;
    case 3: // -X edge
      flangeWidth = sheetD;
      attachPos = new THREE.Vector3(bb.min.x, bb.min.y, 0);
      rotY = Math.PI / 2;
      break;
    default:
      throw new Error(`Invalid edgeIndex: ${edgeIndex}`);
  }

  // Build bend arc at the edge
  const arc = buildBendArc(flangeWidth, angle, params, 8);

  // Build the flange plate extending after the bend
  const flangeLen = height - bendRadius;
  const parts: THREE.BufferGeometry[] = [sheetGeo.clone(), arc];

  if (flangeLen > 0) {
    const angleRad = (angle * Math.PI) / 180;
    const flangePlate = new THREE.BoxGeometry(flangeWidth, thickness, flangeLen);
    // Position flange at end of arc
    const arcEndY = bendRadius * (1 - Math.cos(angleRad));
    const arcEndZ = bendRadius * Math.sin(angleRad);
    flangePlate.translate(0, arcEndY, arcEndZ + flangeLen / 2);
    // Rotate the flange to continue along the bend direction
    const rotMat = new THREE.Matrix4().makeRotationX(-angleRad);
    // We keep the simple positioning — the flange extends from the arc end
    parts.push(flangePlate);
  }

  // Rotate and translate arc + flange to the correct edge
  const transform = new THREE.Matrix4()
    .makeRotationY(rotY)
    .setPosition(attachPos.x, attachPos.y, attachPos.z);

  // Apply transform only to non-sheet parts (arc and flange plate)
  for (let i = 1; i < parts.length; i++) {
    parts[i].applyMatrix4(transform);
  }

  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Failed to merge flange geometries');
  merged.computeVertexNormals();
  return merged;
}

// ─── createHem ──────────────────────────────────────────────────────────────────

/**
 * Fold an edge back on itself.
 *
 * @param sheetGeo  source sheet geometry
 * @param edgeIndex 0=+Z, 1=-Z, 2=+X, 3=-X edge
 * @param type      hem type: 'closed' (flat fold), 'open' (gap), 'teardrop' (rounded)
 * @param params    sheet metal parameters
 */
export function createHem(
  sheetGeo: THREE.BufferGeometry,
  edgeIndex: number,
  type: 'closed' | 'open' | 'teardrop',
  params: SheetMetalParams,
): THREE.BufferGeometry {
  const { thickness, bendRadius } = params;

  sheetGeo.computeBoundingBox();
  const bb = sheetGeo.boundingBox!;
  const sheetW = bb.max.x - bb.min.x;
  const sheetD = bb.max.z - bb.min.z;

  let flangeWidth: number;
  let attachPos: THREE.Vector3;
  let rotY: number;

  switch (edgeIndex) {
    case 0:
      flangeWidth = sheetW;
      attachPos = new THREE.Vector3(0, bb.min.y, bb.max.z);
      rotY = 0;
      break;
    case 1:
      flangeWidth = sheetW;
      attachPos = new THREE.Vector3(0, bb.min.y, bb.min.z);
      rotY = Math.PI;
      break;
    case 2:
      flangeWidth = sheetD;
      attachPos = new THREE.Vector3(bb.max.x, bb.min.y, 0);
      rotY = -Math.PI / 2;
      break;
    case 3:
      flangeWidth = sheetD;
      attachPos = new THREE.Vector3(bb.min.x, bb.min.y, 0);
      rotY = Math.PI / 2;
      break;
    default:
      throw new Error(`Invalid edgeIndex: ${edgeIndex}`);
  }

  let hemAngle: number;
  let hemRadius: number;
  let hemLength: number;

  switch (type) {
    case 'closed':
      hemAngle = 180;
      hemRadius = bendRadius;
      hemLength = bendRadius * 2 + thickness; // fold flat against sheet
      break;
    case 'open':
      hemAngle = 180;
      hemRadius = bendRadius + thickness; // leaves a gap
      hemLength = bendRadius * 2 + thickness * 2;
      break;
    case 'teardrop':
      hemAngle = 180;
      hemRadius = bendRadius * 1.5; // larger radius for teardrop shape
      hemLength = bendRadius * 3 + thickness;
      break;
  }

  // Build the hem: a 180-degree bend arc
  const arc = buildBendArc(flangeWidth, hemAngle, { ...params, bendRadius: hemRadius }, 12);

  // For closed hem, add a flat return plate
  const parts: THREE.BufferGeometry[] = [sheetGeo.clone(), arc];

  if (type === 'closed') {
    // Add the flat return portion that lies against the sheet
    const returnPlate = new THREE.BoxGeometry(flangeWidth, thickness, bendRadius * 2);
    const arcDiameter = hemRadius * 2 + thickness;
    returnPlate.translate(0, -arcDiameter, -bendRadius);
    parts.push(returnPlate);
  }

  // Transform hem parts to the correct edge
  const transform = new THREE.Matrix4()
    .makeRotationY(rotY)
    .setPosition(attachPos.x, attachPos.y, attachPos.z);

  for (let i = 1; i < parts.length; i++) {
    parts[i].applyMatrix4(transform);
  }

  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Failed to merge hem geometries');
  merged.computeVertexNormals();
  return merged;
}

// ─── unfold ─────────────────────────────────────────────────────────────────────

/**
 * Compute flat pattern from a bent sheet metal geometry.
 * Analyzes the geometry for bend regions and computes the unfolded (flat) layout
 * with bend line markings.
 *
 * @param sheetGeo  the bent sheet metal geometry
 * @param params    sheet metal parameters
 */
export function unfold(
  sheetGeo: THREE.BufferGeometry,
  params: SheetMetalParams,
): FlatPatternResult {
  const { thickness, bendRadius, kFactor } = params;

  sheetGeo.computeBoundingBox();
  const bb = sheetGeo.boundingBox!;

  const totalW = bb.max.x - bb.min.x;
  const totalH = bb.max.y - bb.min.y;
  const totalD = bb.max.z - bb.min.z;

  // Estimate number of bends from the bounding box and geometry complexity
  // For a simple analysis, we estimate flat dimensions using bend allowance
  // A more sophisticated implementation would trace the neutral axis

  // Heuristic: count approximate 90-degree bends from height changes
  const estimatedBends = Math.max(0, Math.round(totalH / (bendRadius + thickness)) - 1);
  const bendAngle = 90; // assume standard 90-degree bends for estimation

  // Calculate bend allowance per bend
  const ba = calculateBendAllowance(bendAngle, bendRadius, thickness, kFactor);

  // Unfolded length: sum of flat segments + bend allowances
  // Flat segments approximate: total perimeter path along the neutral axis
  const unfoldedLength = totalD + totalH * 2 + estimatedBends * (ba - bendRadius);
  const unfoldedWidth = totalW;

  // Create flat pattern geometry
  const flatGeo = new THREE.BoxGeometry(unfoldedWidth, thickness, unfoldedLength);
  flatGeo.translate(0, thickness / 2, unfoldedLength / 2);
  flatGeo.computeVertexNormals();

  const edgeGeo = makeEdges(flatGeo);

  // Generate bend lines
  const bendLines: FlatPatternResult['bendLines'] = [];
  let zPos = 0;

  // Place bend lines at estimated positions along the unfolded length
  if (estimatedBends > 0) {
    const segLength = unfoldedLength / (estimatedBends + 1);
    for (let i = 0; i < estimatedBends; i++) {
      zPos += segLength;
      bendLines.push({
        start: new THREE.Vector2(-unfoldedWidth / 2, zPos),
        end: new THREE.Vector2(unfoldedWidth / 2, zPos),
        angle: bendAngle,
      });
    }
  }

  return {
    geometry: flatGeo,
    edgeGeometry: edgeGeo,
    totalLength: unfoldedLength,
    totalWidth: unfoldedWidth,
    bendLines,
  };
}

// ─── createSheetFromProfile ─────────────────────────────────────────────────────

/**
 * Create a sheet metal part from a 2D cross-section profile.
 * The profile is defined as a series of 2D points (in the XY plane)
 * and extruded along the Z axis with the specified thickness.
 *
 * @param points    2D cross-section points defining the sheet profile
 * @param thickness extrusion depth along the Z axis, mm
 * @param params    sheet metal parameters (thickness from params used for wall thickness)
 */
export function createSheetFromProfile(
  points: THREE.Vector2[],
  thickness: number,
  params: SheetMetalParams,
): THREE.BufferGeometry {
  if (points.length < 2) {
    throw new Error('Profile must have at least 2 points');
  }

  const wallThickness = params.thickness;
  const parts: THREE.BufferGeometry[] = [];

  // Build the sheet metal part by extruding each profile segment as a thin plate
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];

    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);

    if (segLen < 0.001) continue;

    // Create a plate for this segment
    const plate = new THREE.BoxGeometry(segLen, wallThickness, thickness);

    // Compute segment angle
    const angle = Math.atan2(dy, dx);

    // Center the plate at the midpoint of the segment
    const mx = (p0.x + p1.x) / 2;
    const my = (p0.y + p1.y) / 2;

    const mat = new THREE.Matrix4()
      .makeRotationZ(angle)
      .setPosition(mx, my, thickness / 2);
    plate.applyMatrix4(mat);

    parts.push(plate);

    // Add bend arcs between consecutive segments (if there's a next segment)
    if (i < points.length - 2) {
      const p2 = points[i + 2];
      const dx2 = p2.x - p1.x;
      const dy2 = p2.y - p1.y;
      const angle2 = Math.atan2(dy2, dx2);

      const bendAngleDeg = ((angle2 - angle) * 180) / Math.PI;
      if (Math.abs(bendAngleDeg) > 0.1) {
        // Insert a small connecting arc at the joint
        const arc = buildBendArc(thickness, Math.abs(bendAngleDeg), params, 4);
        const arcTransform = new THREE.Matrix4()
          .makeRotationZ(angle)
          .setPosition(p1.x, p1.y, 0);
        arc.applyMatrix4(arcTransform);
        parts.push(arc);
      }
    }
  }

  if (parts.length === 0) {
    throw new Error('Profile produced no geometry segments');
  }

  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('Failed to merge profile sheet geometries');
  merged.computeVertexNormals();
  return merged;
}
