/**
 * STEP Reverse Engineering Pipeline
 *
 * Analyses an imported STEP/mesh geometry and attempts to reconstruct a
 * human-editable feature tree by:
 *
 *  1. Extracting geometric primitives from bounding-box proportions
 *     (box, cylinder, sphere) when the mesh fits a known shape within tolerance.
 *  2. Detecting likely manufacturing features (holes, pockets, fillets, chamfers)
 *     by scanning concave face groups in the topological map.
 *  3. Inferring parametric dimensions (width, height, depth, radius, etc.) in mm.
 *  4. Producing a `ReconstructedFeatureTree` that the caller can apply to the
 *     existing feature stack via `addFeature` / `addSketchFeature`.
 *
 * Limitations (phase 1):
 *  - Primitive detection only (box + cylinders). Freeform NURBS surfaces are
 *    identified as "imported mesh" features until a B-Rep solver is available.
 *  - Hole detection is heuristic: a cylindrical concavity with aspect ratio > 1
 *    is assumed to be a drilled hole.
 *
 * Usage:
 *   const tree = await reverseEngineerStep(geometry, topoMap);
 *   tree.features.forEach(f => addFeature(f.type, f.params));
 */

import * as THREE from 'three';
import type { TopologicalMap, StableFace } from '../topology/TopologicalNaming';
import { findFacesByTag as _findFacesByTag } from '../topology/TopologicalNaming';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PrimitiveType = 'box' | 'cylinder' | 'sphere' | 'imported_mesh';

export interface DetectedPrimitive {
  type: PrimitiveType;
  confidence: number; // 0–1
  params: Record<string, number>;
  label: string;
}

export interface DetectedFeature {
  type: 'hole' | 'pocket' | 'fillet' | 'chamfer' | 'boss' | 'rib';
  label: string;
  params: Record<string, number>;
  faceIds: string[]; // stable IDs of faces involved
  confidence: number;
}

export interface BoundingParams {
  width: number;   // X extent (mm)
  height: number;  // Y extent (mm)
  depth: number;   // Z extent (mm)
  cx: number;
  cy: number;
  cz: number;
  /** Equivalent sphere radius */
  sphereRadius: number;
  /** Cylinder estimate: max radius of circular cross-section and dominant height */
  cylinderRadius: number;
  cylinderHeight: number;
  /** Aspect ratio of bounding box */
  aspectXY: number;
  aspectXZ: number;
  aspectYZ: number;
}

export interface ReconstructedFeatureTree {
  /** Base shape (the dominant primitive) */
  baseShape: DetectedPrimitive;
  /** Secondary machined features (holes, pockets, …) */
  features: DetectedFeature[];
  /** Raw extracted bounding box parameters */
  bbox: BoundingParams;
  /** Original mesh vertex/triangle count */
  meshStats: { vertices: number; triangles: number };
  /** Confidence that this reconstruction is useful (0–1) */
  overallConfidence: number;
  /**
   * 이 복원에서 **돌리지 못한 검출**과 그 사유 (260728).
   *
   * 종전엔 위상맵이 없으면 `detectHoles` 가 조용히 `[]` 를 돌려줬고, 호출자에게는
   * "구멍이 없는 부품"과 **구별되지 않았다.** 실측(참고파일들 STEP 임포트)에서 실물
   * SolidWorks B-rep 의 FeatureTree 가 전부 `nodes:[]` 로 나온 것이 이 경로다 —
   * 커버리지 0% 인데 정직 신호가 없었다.
   *
   * 비어 있으면 "전부 돌렸다"는 뜻이다. 비어 있지 않으면 그 항목은 **판정된 적이 없다**.
   */
  limitations: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function R1(n: number) { return Math.round(n * 10) / 10; }
function R2(n: number) { return Math.round(n * 100) / 100; }

function extractBoundingParams(geo: THREE.BufferGeometry): BoundingParams {
  geo.computeBoundingBox();
  const bb = geo.boundingBox ?? new THREE.Box3();
  const w = bb.max.x - bb.min.x;
  const h = bb.max.y - bb.min.y;
  const d = bb.max.z - bb.min.z;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cy = (bb.min.y + bb.max.y) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  // Estimate equivalent sphere radius from bounding sphere
  const sphereRadius = Math.sqrt(w * w + h * h + d * d) / 2;
  // Cylinder: largest circular face determines radius
  const sortedDims = [w, h, d].sort((a, b) => a - b);
  const cylinderRadius = sortedDims[0] / 2;        // smallest dimension → radius
  const cylinderHeight = sortedDims[2];             // largest → height
  return {
    width: R1(w), height: R1(h), depth: R1(d),
    cx: R2(cx), cy: R2(cy), cz: R2(cz),
    sphereRadius: R1(sphereRadius),
    cylinderRadius: R1(cylinderRadius),
    cylinderHeight: R1(cylinderHeight),
    aspectXY: w > 0 ? h / w : 1,
    aspectXZ: w > 0 ? d / w : 1,
    aspectYZ: h > 0 ? d / h : 1,
  };
}

/**
 * Classify the overall shape as box / cylinder / sphere / mesh
 * based on face normal distribution and bounding box proportions.
 */
function classifyPrimitive(
  geo: THREE.BufferGeometry,
  bp: BoundingParams,
  map?: TopologicalMap,
): DetectedPrimitive {
  const ASPECT_BOX_TOL = 0.15; // how close to cubic ratios we need to be for "box"

  // Count distinct normal clusters from the topo map
  let dominantNormals = 0;
  if (map) {
    const allFaces = Object.values(map.faces);
    const tags = new Set(allFaces.map(f => f.tag));
    dominantNormals = tags.size;
  }

  // BOX test: 6 dominant orthogonal normals (top/bottom/front/back/left/right)
  if (dominantNormals >= 5 && dominantNormals <= 8) {
    // Check if all three aspect ratios are within tolerance of 1 (cube) or reasonable
    const confidence = Math.max(0, 1 - (
      Math.abs(bp.aspectXY - 1) * 0.3 +
      Math.abs(bp.aspectXZ - 1) * 0.3 +
      Math.abs(bp.aspectYZ - 1) * 0.3
    ));
    return {
      type: 'box',
      confidence: Math.min(1, confidence + 0.4), // boost for normal count match
      params: { width: bp.width, height: bp.height, depth: bp.depth },
      label: `Box ${bp.width}×${bp.height}×${bp.depth} mm`,
    };
  }

  // SPHERE test: single face cluster, aspect ratios all ~1
  const spherical = Math.abs(bp.aspectXY - 1) < ASPECT_BOX_TOL
    && Math.abs(bp.aspectXZ - 1) < ASPECT_BOX_TOL
    && Math.abs(bp.aspectYZ - 1) < ASPECT_BOX_TOL;
  if (spherical && dominantNormals <= 3) {
    return {
      type: 'sphere',
      confidence: 0.75,
      params: { radius: bp.sphereRadius },
      label: `Sphere r=${bp.sphereRadius} mm`,
    };
  }

  // CYLINDER test: circular cross-section in one axis → high aspect in one dimension
  const highAspect = bp.aspectXZ > 1.5 || bp.aspectYZ > 1.5 || bp.aspectXY > 1.5;
  if (highAspect && dominantNormals <= 5) {
    return {
      type: 'cylinder',
      confidence: 0.7,
      params: { radius: bp.cylinderRadius, height: bp.cylinderHeight },
      label: `Cylinder r=${bp.cylinderRadius} h=${bp.cylinderHeight} mm`,
    };
  }

  // Fallback: freeform mesh
  return {
    type: 'imported_mesh',
    confidence: 0.3,
    params: { width: bp.width, height: bp.height, depth: bp.depth },
    label: `Imported Mesh (${bp.width}×${bp.height}×${bp.depth} mm)`,
  };
}

/**
 * Scan face groups for concave cylinders (holes) by looking for:
 * - Small circular face groups (normals pointing radially inward, ~circular cross-section)
 * - Aspect ratio > 0.8 (depth/diameter)
 *
 * Returns a list of probable hole features.
 */
function detectHoles(
  geo: THREE.BufferGeometry,
  bp: BoundingParams,
  map?: TopologicalMap,
): { features: DetectedFeature[]; ran: boolean } {
  // ⚠ 위상맵이 없으면 **검출을 돌린 적이 없다.** 종전처럼 빈 배열만 돌려주면 호출자는
  //   "구멍이 없는 부품"으로 읽는다 — 부재가 정상으로 읽히는 전형이다. `ran:false` 로
  //   그 구별을 넘긴다(값을 지어내지 않으면서 침묵하지도 않는 유일한 방법).
  if (!map) return { features: [], ran: false };

  const features: DetectedFeature[] = [];
  const allFaces = Object.values(map.faces);

  // Group faces by their dominant normal to find small lateral groups
  // (Hole walls have normals pointing laterally — not top/bottom/front/back)
  const smallLateralGroups: StableFace[][] = [];
  const mainTags = new Set(['top', 'bottom', 'front', 'back', 'left', 'right']);
  const lateralFaces = allFaces.filter(f => !mainTags.has(f.tag ?? ''));

  if (lateralFaces.length > 0) {
    // Cluster by approximate normal direction
    const clusters: StableFace[][] = [];
    for (const face of lateralFaces) {
      let matched = false;
      for (const cluster of clusters) {
        const rep = cluster[0];
        const dot =
          face.signature.normal[0] * rep.signature.normal[0] +
          face.signature.normal[1] * rep.signature.normal[1] +
          face.signature.normal[2] * rep.signature.normal[2];
        if (Math.abs(dot) < 0.5) {
          cluster.push(face);
          matched = true;
          break;
        }
      }
      if (!matched) clusters.push([face]);
    }

    // Clusters with small area and multiple faces are likely hole walls
    for (const cluster of clusters) {
      if (cluster.length >= 3) {
        const totalArea = cluster.reduce((s, f) => s + f.signature.area, 0);
        const avgArea = totalArea / cluster.length;
        // Estimate hole radius from area (approximating cylindrical wall area = 2πrh)
        // For now use a simpler heuristic: small cluster area → small hole
        if (avgArea < (bp.width * bp.height * 0.05)) {
          smallLateralGroups.push(cluster);
        }
      }
    }
  }

  // Each small lateral group → a candidate hole
  for (const group of smallLateralGroups.slice(0, 8)) { // limit to 8 holes
    const totalArea = group.reduce((s, f) => s + f.signature.area, 0);
    // Rough radius estimate: A = 2πrh → r = A / (2π * h)
    // Use group count as proxy for coverage fraction
    const r = Math.sqrt(totalArea / Math.PI) / 2;
    const roughRadius = Math.max(1, R1(r));

    features.push({
      type: 'hole',
      label: `Hole Ø${(roughRadius * 2).toFixed(1)} mm (estimated)`,
      params: {
        radius: roughRadius,
        diameter: roughRadius * 2,
        depth: R1(Math.min(bp.height, bp.depth) * 0.7),
      },
      faceIds: group.map(f => f.stableId),
      confidence: 0.55,
    });
  }

  return { features, ran: true };
}

// ─── Main API ─────────────────────────────────────────────────────────────────

/**
 * Analyses an imported BufferGeometry and returns a reconstructed feature tree.
 *
 * @param geo     The imported mesh geometry
 * @param map     Optional topological map (improves classification accuracy)
 */
export async function reverseEngineerStep(
  geo: THREE.BufferGeometry,
  map?: TopologicalMap,
): Promise<ReconstructedFeatureTree> {
  // Ensure geometry has normals
  if (!geo.getAttribute('normal')) {
    geo.computeVertexNormals();
  }

  const bp = extractBoundingParams(geo);
  const baseShape = classifyPrimitive(geo, bp, map);
  const holeRun = detectHoles(geo, bp, map);
  const holes = holeRun.features;
  const limitations: string[] = [];
  if (!holeRun.ran) {
    limitations.push(
      '구멍·포켓 검출을 돌리지 못했다(위상맵 없음) — 이 결과의 "가공 피처 0개"는 ' +
      '"구멍이 없다"가 아니라 "확인하지 못했다"이다.',
    );
  }

  // Mesh stats
  const posAttr = geo.getAttribute('position');
  const indexAttr = geo.getIndex();
  const vertices = posAttr ? posAttr.count : 0;
  const triangles = indexAttr ? Math.floor(indexAttr.count / 3) : Math.floor(vertices / 3);

  /**
   * 종합 신뢰도.
   *
   * ⚠ 종전 식은 `baseShape.confidence * (holes.length > 0 ? 0.9 : 1.0)` 이었다 —
   * **구멍을 하나도 못 찾으면 신뢰도가 올라갔다.** 방향이 거꾸로다: 0개는 "정말 없다"와
   * "검출이 실패했다"를 겸하고, 후자일 때 확신이 커지면 안 된다. 그리고 검출을 아예
   * 돌리지 못한 경우(위상맵 없음)는 **가장 낮게** 잡아야 한다.
   */
  const overallConfidence = !holeRun.ran
    ? baseShape.confidence * 0.5   // 피처 검출을 못 돌렸다 — 형상만 본 결과다
    : baseShape.confidence * (holes.length > 0 ? 0.95 : 0.9);

  return {
    baseShape,
    features: holes,
    bbox: bp,
    meshStats: { vertices, triangles },
    overallConfidence,
    limitations,
  };
}

/**
 * Convert a ReconstructedFeatureTree into a human-readable summary string.
 */
export function summariseReconstructedTree(tree: ReconstructedFeatureTree): string {
  const lines = [
    `Base: ${tree.baseShape.label} (conf ${Math.round(tree.baseShape.confidence * 100)}%)`,
    `Mesh: ${tree.meshStats.vertices} verts, ${tree.meshStats.triangles} tris`,
  ];
  if (tree.features.length > 0) {
    lines.push(`Features (${tree.features.length}):`);
    for (const f of tree.features) {
      lines.push(`  ${f.type}: ${f.label} (conf ${Math.round(f.confidence * 100)}%)`);
    }
  } else if (tree.limitations.length === 0) {
    // 검출을 돌렸는데 0개 — 이건 정보다("없다"). 아래 limitations 와 구별해서 적는다.
    lines.push('Features: none detected (detection ran)');
  }
  // 못 돌린 것은 숨기지 않는다 — 빈 결과가 "없음"으로 읽히는 것을 막는 유일한 줄이다.
  for (const l of tree.limitations) lines.push(`⚠ ${l}`);
  return lines.join('\n');
}

/**
 * Map a reconstructed primitive type to a Nexyfab shape ID.
 */
export function primitiveTypeToShapeId(type: PrimitiveType): string {
  const map: Record<PrimitiveType, string> = {
    box: 'box',
    cylinder: 'cylinder',
    sphere: 'sphere',
    imported_mesh: 'box', // fallback
  };
  return map[type];
}
