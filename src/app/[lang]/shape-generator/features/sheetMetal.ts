import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';
import {
  type SheetMetalMaterial,
  SHEET_METAL_MATERIALS,
  DEFAULT_MATERIAL,
  getKFactor,
  bendAllowance as tableBendAllowance,
  bendDeduction,
  validateBend,
  type SheetMetalBendWarning,
} from './sheetMetalTables';

// Numeric material indices match the order in SHEET_METAL_MATERIAL_ORDER so we
// can expose a single `material` slider param without plumbing strings through
// the feature registry. Keep this in sync with sheetMetalTables.
export const SHEET_METAL_MATERIAL_ORDER: SheetMetalMaterial[] = [
  'mildSteel',
  'stainless304',
  'aluminum5052',
  'aluminum6061',
  'galvanized',
  'brass',
  'copper',
];

function materialFromIndex(i: number): SheetMetalMaterial {
  const idx = Math.max(0, Math.min(SHEET_METAL_MATERIAL_ORDER.length - 1, Math.round(i)));
  return SHEET_METAL_MATERIAL_ORDER[idx] ?? DEFAULT_MATERIAL;
}

// ─── Sheet Metal Feature Types ─────────────────────────────────────────────────

export interface BendParams {
  angle: number;       // degrees (0-180)
  radius: number;      // inner bend radius mm
  position: number;    // 0-1 along the edge
  direction: 'up' | 'down';
}

export interface FlangeParams {
  height: number;
  angle: number;
  radius: number;
  edgeIndex: number;
}

// ─── Bend Allowance Calculation ────────────────────────────────────────────────

/**
 * K-factor based bend allowance:
 *   BA = π · (R + K · T) · A / 180
 *
 * Kept as a thin wrapper for call sites that already have a known K. For
 * material-aware callers, prefer `tableBendAllowance` + `getKFactor` from
 * sheetMetalTables.
 */
export function calculateBendAllowance(
  angle: number,
  radius: number,
  thickness: number,
  kFactor: number = 0.44,
): number {
  return tableBendAllowance(angle, radius, thickness, kFactor);
}

// ─── Apply Bend ────────────────────────────────────────────────────────────────

/**
 * Bend a flat plate along a line at the given position (0-1 fraction along the
 * longest horizontal axis). Vertices beyond the bend line are rotated about it.
 */
export function applyBend(
  geometry: THREE.BufferGeometry,
  params: BendParams,
): THREE.BufferGeometry {
  const { angle, radius, position, direction } = params;
  const geo = geometry.clone();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;

  // Determine primary axis (longest horizontal extent)
  const sizeX = bb.max.x - bb.min.x;
  const sizeZ = bb.max.z - bb.min.z;
  const bendAlongX = sizeZ >= sizeX; // bend line is parallel to X when Z is longest
  const primarySize = bendAlongX ? sizeZ : sizeX;
  const primaryMin = bendAlongX ? bb.min.z : bb.min.x;

  const bendLinePos = primaryMin + primarySize * Math.max(0, Math.min(1, position));
  const angleRad = (angle * Math.PI) / 180;
  const sign = direction === 'up' ? 1 : -1;

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const primaryCoord = bendAlongX ? z : x;
    const dist = primaryCoord - bendLinePos;

    if (dist > 0) {
      // Arc region: vertices within the bend zone get rotated
      const bendArcLen = radius * angleRad;
      if (dist <= bendArcLen && radius > 0) {
        // Within the arc region
        const fraction = dist / bendArcLen;
        const theta = fraction * angleRad * sign;
        const localY = y - bb.min.y;
        const newPrimary = bendLinePos + (radius + localY) * Math.sin(theta);
        const newY = bb.min.y + (radius + localY) * (1 - Math.cos(theta)) * sign + localY * Math.cos(theta);

        if (bendAlongX) {
          pos.setZ(i, newPrimary);
        } else {
          pos.setX(i, newPrimary);
        }
        pos.setY(i, newY);
      } else {
        // Beyond the arc: rotate rigidly
        const localY = y - bb.min.y;
        const beyondDist = dist - bendArcLen;
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        const arcEndPrimary = bendLinePos + (radius + localY) * Math.sin(angleRad * sign);
        const arcEndY = bb.min.y + (radius + localY) * (1 - Math.cos(angleRad)) * sign + localY * Math.cos(angleRad);

        const newPrimary = arcEndPrimary + beyondDist * cosA;
        const newY = arcEndY + beyondDist * sinA * sign;

        if (bendAlongX) {
          pos.setZ(i, newPrimary);
        } else {
          pos.setX(i, newPrimary);
        }
        pos.setY(i, newY);
      }
    }
  }

  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();

  // Record this bend in the history so a downstream flatPattern feature can
  // unfold the stack correctly. We copy the parent's history (if any) rather
  // than mutating the source geometry's userData.
  const parentHistory =
    (geometry.userData as { __bendHistory?: BendParams[] } | undefined)?.__bendHistory ?? [];
  geo.userData = {
    ...(geo.userData ?? {}),
    __bendHistory: [...parentHistory, { ...params }],
  };
  return geo;
}

// ─── Apply Flange ──────────────────────────────────────────────────────────────

/**
 * Add an edge flange (bent tab) to a selected edge of the geometry.
 * Generates new geometry for the flange and merges it with the original.
 */
export function applyFlange(
  geometry: THREE.BufferGeometry,
  params: FlangeParams,
): THREE.BufferGeometry {
  const { height, angle, radius, edgeIndex } = params;
  const geo = geometry.clone();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;

  const sizeX = bb.max.x - bb.min.x;
  const sizeZ = bb.max.z - bb.min.z;
  const thickness = bb.max.y - bb.min.y;

  // Determine edge position and width based on edgeIndex (0=+Z, 1=-Z, 2=+X, 3=-X)
  let flangeWidth: number;
  let edgePos: THREE.Vector3;
  let edgeDir: THREE.Vector3; // along the edge
  let outDir: THREE.Vector3;  // outward from edge

  switch (edgeIndex) {
    case 0: // +Z edge
      flangeWidth = sizeX;
      edgePos = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y, bb.max.z);
      edgeDir = new THREE.Vector3(1, 0, 0);
      outDir = new THREE.Vector3(0, 0, 1);
      break;
    case 1: // -Z edge
      flangeWidth = sizeX;
      edgePos = new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.min.y, bb.min.z);
      edgeDir = new THREE.Vector3(1, 0, 0);
      outDir = new THREE.Vector3(0, 0, -1);
      break;
    case 2: // +X edge
      flangeWidth = sizeZ;
      edgePos = new THREE.Vector3(bb.max.x, bb.min.y, (bb.min.z + bb.max.z) / 2);
      edgeDir = new THREE.Vector3(0, 0, 1);
      outDir = new THREE.Vector3(1, 0, 0);
      break;
    case 3: // -X edge
      flangeWidth = sizeZ;
      edgePos = new THREE.Vector3(bb.min.x, bb.min.y, (bb.min.z + bb.max.z) / 2);
      edgeDir = new THREE.Vector3(0, 0, 1);
      outDir = new THREE.Vector3(-1, 0, 0);
      break;
    default:
      throw new Error(`Invalid edgeIndex: ${edgeIndex}`);
  }

  const angleRad = (angle * Math.PI) / 180;
  const segments = 8;
  const flangeLen = Math.max(0, height - radius);

  // Build arc + flange plate vertices
  const verts: number[] = [];
  const indices: number[] = [];

  // Generate arc cross-section
  const up = new THREE.Vector3(0, 1, 0);
  for (let s = 0; s <= segments; s++) {
    const frac = s / segments;
    const theta = frac * angleRad;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // Inner and outer arc points
    const rInner = radius;
    const rOuter = radius + thickness;

    // Direction after rotation: blend from outDir to up
    const dirY = sinT;
    const dirOut = cosT;

    for (let w = 0; w <= 1; w++) {
      const widthOffset = (w - 0.5) * flangeWidth;
      const basePos = edgePos.clone().add(edgeDir.clone().multiplyScalar(widthOffset));

      // Inner point
      const innerPos = basePos.clone()
        .add(outDir.clone().multiplyScalar(rInner * dirOut))
        .add(up.clone().multiplyScalar(rInner * dirY));
      verts.push(innerPos.x, innerPos.y, innerPos.z);

      // Outer point
      const outerPos = basePos.clone()
        .add(outDir.clone().multiplyScalar(rOuter * dirOut))
        .add(up.clone().multiplyScalar(rOuter * dirY));
      verts.push(outerPos.x, outerPos.y, outerPos.z);
    }

    if (s < segments) {
      const base = s * 4;
      const next = base + 4;
      // Quad faces (two triangles each)
      // Inner face
      indices.push(base, next, next + 2, base, next + 2, base + 2);
      // Outer face
      indices.push(base + 1, base + 3, next + 3, base + 1, next + 3, next + 1);
      // Side faces
      indices.push(base, base + 1, next + 1, base, next + 1, next);
      indices.push(base + 2, next + 2, next + 3, base + 2, next + 3, base + 3);
    }
  }

  // Extend with straight flange plate if flangeLen > 0
  if (flangeLen > 0) {
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const plateSteps = 2;

    const arcEndIdx = (segments + 1) * 4;

    for (let p = 1; p <= plateSteps; p++) {
      const t = (p / plateSteps) * flangeLen;

      for (let w = 0; w <= 1; w++) {
        const widthOffset = (w - 0.5) * flangeWidth;
        const basePos = edgePos.clone().add(edgeDir.clone().multiplyScalar(widthOffset));

        const innerPos = basePos.clone()
          .add(outDir.clone().multiplyScalar(radius * cosA + t * cosA))
          .add(up.clone().multiplyScalar(radius * sinA + t * sinA));
        verts.push(innerPos.x, innerPos.y, innerPos.z);

        const outerPos = basePos.clone()
          .add(outDir.clone().multiplyScalar((radius + thickness) * cosA + t * cosA))
          .add(up.clone().multiplyScalar((radius + thickness) * sinA + t * sinA));
        verts.push(outerPos.x, outerPos.y, outerPos.z);
      }

      const prevBase = arcEndIdx + (p - 2) * 4;
      const currBase = arcEndIdx + (p - 1) * 4;
      const pb = p === 1 ? segments * 4 : prevBase;

      indices.push(pb, currBase, currBase + 2, pb, currBase + 2, pb + 2);
      indices.push(pb + 1, pb + 3, currBase + 3, pb + 1, currBase + 3, currBase + 1);
      indices.push(pb, pb + 1, currBase + 1, pb, currBase + 1, currBase);
      indices.push(pb + 2, currBase + 2, currBase + 3, pb + 2, currBase + 3, pb + 3);
    }
  }

  const flangeGeo = new THREE.BufferGeometry();
  flangeGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  flangeGeo.setIndex(indices);
  flangeGeo.computeVertexNormals();

  // Merge original geometry with the flange
  const merged = mergeGeometries([geo, flangeGeo]);
  if (!merged) throw new Error('Failed to merge flange geometry');
  merged.computeVertexNormals();
  return merged;
}

// ─── Generate Flat Pattern ─────────────────────────────────────────────────────

/**
 * Describes one bend line in the resulting flat pattern. Positions are measured
 * along the length axis (Z in the flat-pattern local frame) from the start of
 * the blank. The press-brake operator reads this directly — angle, radius,
 * direction, and where on the blank to place the bend line.
 */
export interface BendTableEntry {
  index: number;
  /** Distance (mm) along the blank length axis where the bend line sits */
  position: number;
  /** Bend angle in degrees */
  angle: number;
  /** Inner bend radius in mm */
  radius: number;
  /** 'up' (mountain fold, positive Y) or 'down' (valley fold) */
  direction: 'up' | 'down';
  /** Bend allowance used for this bend */
  bendAllowance: number;
  /** Bend deduction used for this bend */
  bendDeduction: number;
  /** K-factor used (material-specific) */
  kFactor: number;
}

export interface FlatPatternResult {
  /** 3D box geometry of the unfolded blank (for preview in the viewport) */
  geometry: THREE.BufferGeometry;
  /** Flat blank width (mm) — perpendicular to the bend lines */
  width: number;
  /** Flat blank length (mm) — summed straight segments + bend allowances */
  length: number;
  /** Sheet thickness (mm) */
  thickness: number;
  /** Material selected for this flat pattern */
  material: SheetMetalMaterial;
  /** Per-bend table in order along the length axis */
  bendTable: BendTableEntry[];
  /** Validation warnings collected while unfolding */
  warnings: SheetMetalBendWarning[];
}

/**
 * Unfold a stack of bends into a flat blank. Each straight panel keeps its
 * original length and each bend contributes its bend allowance to the flat
 * length. The bend table records where every bend line lands on the blank so
 * downstream code (DXF export, press-brake setup) can draw or schedule them.
 *
 * The input `bends` array is interpreted in order: the first bend's
 * `position` is a fraction (0–1) of the segment starting from Z_min of the
 * input geometry, the second is relative to the remaining panel after the
 * first bend, etc. This matches how a press-brake operator walks down the
 * blank stamping bends sequentially.
 */
export function generateFlatPattern(
  geometry: THREE.BufferGeometry,
  bends: BendParams[],
  thickness: number = 2,
  materialOrK: SheetMetalMaterial | number = DEFAULT_MATERIAL,
): FlatPatternResult {
  const geo = geometry.clone();
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;

  const sizeX = bb.max.x - bb.min.x;
  const sizeZ = bb.max.z - bb.min.z;

  const material: SheetMetalMaterial =
    typeof materialOrK === 'number' ? DEFAULT_MATERIAL : materialOrK;
  // If caller passed a literal K-factor we still honour it; the numeric path
  // is only used by legacy call sites.
  const forcedK = typeof materialOrK === 'number' ? materialOrK : null;

  const warnings: SheetMetalBendWarning[] = [];

  // Sort bends by position along Z to get them in walking order along the blank.
  const sortedBends = [...bends].sort((a, b) => a.position - b.position);

  // Walk the bend list, accumulating the flat length segment by segment.
  // Each bend's `position` fraction references the ORIGINAL geometry's Z range,
  // so we turn it into an absolute distance in the 3D part then accumulate.
  const bendTable: BendTableEntry[] = [];
  let cumulativeFlat = 0;
  let prevZ3D = bb.min.z;

  for (let i = 0; i < sortedBends.length; i++) {
    const b = sortedBends[i];
    const clampedPos = Math.max(0, Math.min(1, b.position));
    const absoluteZ = bb.min.z + sizeZ * clampedPos;
    const straight = absoluteZ - prevZ3D;
    cumulativeFlat += straight;

    const k = forcedK ?? getKFactor(material, b.radius, thickness);
    const ba = tableBendAllowance(b.angle, b.radius, thickness, k);
    const bd = bendDeduction(b.angle, b.radius, thickness, k);

    warnings.push(...validateBend(material, thickness, b.radius, b.angle));

    bendTable.push({
      index: i,
      position: cumulativeFlat, // bend line sits at the start of the BA segment
      angle: b.angle,
      radius: b.radius,
      direction: b.direction,
      bendAllowance: ba,
      bendDeduction: bd,
      kFactor: k,
    });

    // Advance past the bend allowance on the flat, and past the arc length on
    // the 3D part. The arc length is how much of the original Z was consumed
    // inside the bend region — the remaining straight segment continues after.
    cumulativeFlat += ba;
    prevZ3D = absoluteZ; // bends are treated as point events in Z for this
                         // simplified feature-pipeline geometry
  }
  // Trailing straight segment after the last bend
  cumulativeFlat += bb.max.z - prevZ3D;
  const totalLength = cumulativeFlat;

  // Build a thin box geometry so the viewport can still render a preview.
  const flatGeo = new THREE.BufferGeometry();
  const hw = sizeX / 2;
  const hl = totalLength / 2;
  const ht = thickness / 2;

  const positions = new Float32Array([
    // Top face
    -hw, ht, -hl,  hw, ht, -hl,  hw, ht, hl,
    -hw, ht, -hl,  hw, ht, hl,  -hw, ht, hl,
    // Bottom face
    -hw, -ht, hl,  hw, -ht, hl,  hw, -ht, -hl,
    -hw, -ht, hl,  hw, -ht, -hl,  -hw, -ht, -hl,
    // Front face (+Z)
    -hw, -ht, hl,  hw, -ht, hl,  hw, ht, hl,
    -hw, -ht, hl,  hw, ht, hl,  -hw, ht, hl,
    // Back face (-Z)
    hw, -ht, -hl,  -hw, -ht, -hl,  -hw, ht, -hl,
    hw, -ht, -hl,  -hw, ht, -hl,  hw, ht, -hl,
    // Right face (+X)
    hw, -ht, -hl,  hw, ht, -hl,  hw, ht, hl,
    hw, -ht, -hl,  hw, ht, hl,  hw, -ht, hl,
    // Left face (-X)
    -hw, -ht, hl,  -hw, ht, hl,  -hw, ht, -hl,
    -hw, -ht, hl,  -hw, ht, -hl,  -hw, -ht, -hl,
  ]);

  flatGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  flatGeo.computeVertexNormals();
  flatGeo.computeBoundingBox();
  // Stash the pattern metadata on userData so the DXF exporter / UI can pick
  // it up from a plain BufferGeometry without plumbing a second return value
  // through the feature pipeline.
  flatGeo.userData = {
    ...(flatGeo.userData ?? {}),
    sheetMetal: {
      width: sizeX,
      length: totalLength,
      thickness,
      material,
      bendTable,
      warnings,
    } satisfies Omit<FlatPatternResult, 'geometry'>,
  };

  return {
    geometry: flatGeo,
    width: sizeX,
    length: totalLength,
    thickness,
    material,
    bendTable,
    warnings,
  };
}

/** Pull the stashed flat pattern metadata off a geometry produced by
 *  `generateFlatPattern`, if present. Returns null if the geometry didn't come
 *  from the flat-pattern feature. */
export function getFlatPatternMetadata(
  geo: THREE.BufferGeometry,
): Omit<FlatPatternResult, 'geometry'> | null {
  const meta = (geo.userData as { sheetMetal?: Omit<FlatPatternResult, 'geometry'> } | undefined)?.sheetMetal;
  return meta ?? null;
}

// ─── Feature Definitions for the pipeline ──────────────────────────────────────

export const bendFeature: FeatureDefinition = {
  type: 'bend',
  icon: '↩',
  params: [
    { key: 'angle', labelKey: 'paramBendAngle', default: 90, min: 1, max: 180, step: 1, unit: 'deg' },
    { key: 'radius', labelKey: 'paramBendRadius', default: 3, min: 0.5, max: 50, step: 0.5, unit: 'mm' },
    { key: 'position', labelKey: 'paramBendPosition', default: 50, min: 1, max: 99, step: 1, unit: '%' },
    { key: 'direction', labelKey: 'paramBendDirection', default: 0, min: 0, max: 1, step: 1, unit: '', options: [{ value: 0, labelKey: 'featureOpt_upward' }, { value: 1, labelKey: 'featureOpt_downward' }] },
  ],
  apply(geometry, params) {
    return applyBend(geometry, {
      angle: params.angle,
      radius: params.radius,
      position: params.position / 100,
      direction: params.direction === 0 ? 'up' : 'down',
    });
  },
};

export const flangeFeature: FeatureDefinition = {
  type: 'flange',
  icon: '⌐',
  params: [
    { key: 'height', labelKey: 'paramFlangeHeight', default: 20, min: 1, max: 200, step: 1, unit: 'mm' },
    { key: 'angle', labelKey: 'paramFlangeAngle', default: 90, min: 1, max: 180, step: 1, unit: 'deg' },
    { key: 'radius', labelKey: 'paramFlangeRadius', default: 3, min: 0.5, max: 50, step: 0.5, unit: 'mm' },
    { key: 'edgeIndex', labelKey: 'paramFlangeEdge', default: 0, min: 0, max: 3, step: 1, unit: '', options: [{ value: 0, labelKey: 'featureOpt_edgePlusZ' }, { value: 1, labelKey: 'featureOpt_edgeMinusZ' }, { value: 2, labelKey: 'featureOpt_edgePlusX' }, { value: 3, labelKey: 'featureOpt_edgeMinusX' }] },
  ],
  apply(geometry, params) {
    return applyFlange(geometry, {
      height: params.height,
      angle: params.angle,
      radius: params.radius,
      edgeIndex: Math.round(params.edgeIndex),
    });
  },
};

export const flatPatternFeature: FeatureDefinition = {
  type: 'flatPattern',
  icon: '📐',
  params: [
    { key: 'thickness', labelKey: 'paramSheetThickness', default: 2, min: 0.5, max: 20, step: 0.5, unit: 'mm' },
    {
      key: 'material',
      labelKey: 'paramSheetMaterial',
      default: 0,
      min: 0,
      max: SHEET_METAL_MATERIAL_ORDER.length - 1,
      step: 1,
      unit: '',
      options: SHEET_METAL_MATERIAL_ORDER.map((id, idx) => ({
        value: idx,
        // labelKey follows the material id so i18n can key off it; fall back to
        // the built-in English label at render time if the key isn't defined.
        labelKey: `sheetMetalMat_${id}`,
      })),
    },
  ],
  apply(geometry, params) {
    const material = materialFromIndex(params.material ?? 0);
    // Prior bends in the feature stack would ideally be passed in here, but
    // the feature-pipeline contract is (geometry, params) → geometry. For now
    // the flat pattern uses any bend history the upstream bend feature stashed
    // into userData.__bendHistory, falling back to empty.
    const history = (geometry.userData as { __bendHistory?: BendParams[] } | undefined)?.__bendHistory ?? [];
    return generateFlatPattern(geometry, history, params.thickness, material).geometry;
  },
};
