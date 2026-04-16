import * as THREE from 'three';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type ManufacturingProcess = 'cnc_milling' | 'cnc_turning' | 'injection_molding' | 'sheet_metal' | 'casting' | '3d_printing';

export interface DFMIssue {
  id: string;
  process: ManufacturingProcess;
  type: 'undercut' | 'thin_wall' | 'deep_pocket' | 'sharp_corner' | 'draft_angle' | 'uniform_wall' | 'tool_access' | 'aspect_ratio' | 'overhang' | 'bridge' | 'support_volume';
  severity: 'error' | 'warning' | 'info';
  description: string;
  suggestion: string;
  faceIndices?: number[];
  location?: [number, number, number];
}

export interface DFMResult {
  process: ManufacturingProcess;
  score: number;          // 0-100 manufacturability score
  issues: DFMIssue[];
  feasible: boolean;
  estimatedDifficulty: 'easy' | 'moderate' | 'difficult' | 'infeasible';
}

export interface DFMOptions {
  minWallThickness?: number;  // mm, default 1.0
  minDraftAngle?: number;     // degrees, default 1.0
  maxAspectRatio?: number;    // default 4.0
}

/* ─── Constants ──────────────────────────────────────────────────────────── */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;
const EPSILON = 1e-5;

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function triangleNormal(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  return ab.cross(ac).normalize();
}

function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  return ab.cross(ac).length() * 0.5;
}

function triangleCentroid(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3().add(a).add(b).add(c).divideScalar(3);
}

function vertKey(v: THREE.Vector3): string {
  return `${Math.round(v.x / EPSILON)}_${Math.round(v.y / EPSILON)}_${Math.round(v.z / EPSILON)}`;
}

function edgeKeyOf(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface TriData {
  normal: THREE.Vector3;
  centroid: THREE.Vector3;
  area: number;
  v0: THREE.Vector3;
  v1: THREE.Vector3;
  v2: THREE.Vector3;
}

function extractTriangles(geometry: THREE.BufferGeometry): TriData[] {
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = nonIndexed.attributes.position;
  const triCount = Math.floor(pos.count / 3);
  const tris: TriData[] = [];

  for (let i = 0; i < triCount; i++) {
    const v0 = new THREE.Vector3().fromBufferAttribute(pos, i * 3);
    const v1 = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 1);
    const v2 = new THREE.Vector3().fromBufferAttribute(pos, i * 3 + 2);
    const normal = triangleNormal(v0, v1, v2);
    const area = triangleArea(v0, v1, v2);
    if (area < 1e-10) continue;
    tris.push({ normal, centroid: triangleCentroid(v0, v1, v2), area, v0, v1, v2 });
  }
  return tris;
}

interface EdgeInfo {
  faces: number[];
  normals: THREE.Vector3[];
  midpoint: THREE.Vector3;
}

function buildEdgeMap(tris: TriData[]): Map<string, EdgeInfo> {
  const edgeMap = new Map<string, EdgeInfo>();

  for (let i = 0; i < tris.length; i++) {
    const { normal, v0, v1, v2 } = tris[i];
    const k0 = vertKey(v0), k1 = vertKey(v1), k2 = vertKey(v2);
    const edgePairs: [string, string, THREE.Vector3, THREE.Vector3][] = [
      [k0, k1, v0, v1],
      [k1, k2, v1, v2],
      [k2, k0, v2, v0],
    ];

    for (const [ka, kb, va, vb] of edgePairs) {
      const ek = edgeKeyOf(ka, kb);
      let entry = edgeMap.get(ek);
      if (!entry) {
        entry = { faces: [], normals: [], midpoint: new THREE.Vector3().addVectors(va, vb).multiplyScalar(0.5) };
        edgeMap.set(ek, entry);
      }
      entry.faces.push(i);
      entry.normals.push(normal.clone());
    }
  }
  return edgeMap;
}

function computeBBoxDimensions(geometry: THREE.BufferGeometry): THREE.Vector3 {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  return new THREE.Vector3().subVectors(bb.max, bb.min);
}

/* ─── Wall thickness raycasting ─────────────────────────────────────────── */

/**
 * Measure wall thickness at sampled surface points using inward raycasting.
 * For each sampled vertex, casts a ray inward along -normal.
 * Returns an array of { position, thickness, normalDir } for vertices thinner
 * than maxThickness.
 *
 * @param geometry    BufferGeometry (non-indexed, with computed normals)
 * @param maxThickness  Only return measurements below this value (mm)
 * @param sampleRate  Fraction of vertices to sample (0.0–1.0), default 0.05
 */
export function measureWallThickness(
  geometry: THREE.BufferGeometry,
  maxThickness: number = 3.0,
  sampleRate: number = 0.05,
): Array<{ position: THREE.Vector3; thickness: number; normalDir: THREE.Vector3 }> {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const nor = geometry.attributes.normal as THREE.BufferAttribute;
  if (!pos || !nor) return [];

  const results: Array<{ position: THREE.Vector3; thickness: number; normalDir: THREE.Vector3 }> = [];

  // Build a temporary mesh for raycasting
  const tempMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const raycaster = new THREE.Raycaster();
  raycaster.params.Mesh = { threshold: 0 };

  const stride = Math.max(1, Math.floor(1 / sampleRate));
  const vertCount = pos.count;

  for (let i = 0; i < vertCount; i += stride) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nLen < 0.01) continue;

    // Offset origin slightly outward to avoid self-intersection
    const origin = new THREE.Vector3(
      vx + (nx / nLen) * 0.1,
      vy + (ny / nLen) * 0.1,
      vz + (nz / nLen) * 0.1,
    );
    const direction = new THREE.Vector3(-nx / nLen, -ny / nLen, -nz / nLen); // inward

    raycaster.set(origin, direction);
    const hits = raycaster.intersectObject(tempMesh, false);

    if (hits.length >= 2) {
      // First hit is entry surface, second hit is the opposite wall
      const thickness = hits[1].distance + 0.1; // +0.1 for the origin offset
      if (thickness < maxThickness) {
        results.push({
          position: new THREE.Vector3(vx, vy, vz),
          thickness,
          normalDir: new THREE.Vector3(nx / nLen, ny / nLen, nz / nLen),
        });
      }
    } else if (hits.length === 1) {
      // Single hit — measure from origin to the one visible wall
      const thickness = hits[0].distance + 0.1;
      if (thickness < maxThickness) {
        results.push({
          position: new THREE.Vector3(vx, vy, vz),
          thickness,
          normalDir: new THREE.Vector3(nx / nLen, ny / nLen, nz / nLen),
        });
      }
    }
  }

  // Dispose temp material (geometry is owned by the caller)
  (tempMesh.material as THREE.Material).dispose();

  return results;
}

/* ─── Per-process analyzers ──────────────────────────────────────────────── */

let issueCounter = 0;
function nextId(process: ManufacturingProcess): string {
  return `${process}_${++issueCounter}`;
}

function analyzeCNCMilling(
  tris: TriData[],
  edgeMap: Map<string, EdgeInfo>,
  dims: THREE.Vector3,
  opts: Required<DFMOptions>,
  nonIndexed: THREE.BufferGeometry,
): DFMIssue[] {
  const issues: DFMIssue[] = [];
  const toolDir = new THREE.Vector3(0, 1, 0); // tool approaches from top (Y+)

  // Undercut detection: faces whose normal points opposite to tool access (Y-)
  const undercutFaces: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    const dot = tris[i].normal.dot(toolDir);
    if (dot < -0.15) {
      undercutFaces.push(i);
    }
  }
  if (undercutFaces.length > 0) {
    const avgLoc = new THREE.Vector3();
    for (const fi of undercutFaces) avgLoc.add(tris[fi].centroid);
    avgLoc.divideScalar(undercutFaces.length);
    issues.push({
      id: nextId('cnc_milling'),
      process: 'cnc_milling',
      type: 'undercut',
      severity: undercutFaces.length > tris.length * 0.1 ? 'error' : 'warning',
      description: `${undercutFaces.length} faces not accessible from tool direction (undercuts)`,
      suggestion: 'Reorient part, use multi-axis machining, or redesign to eliminate undercuts',
      faceIndices: undercutFaces,
      location: [avgLoc.x, avgLoc.y, avgLoc.z],
    });
  }

  // Deep pocket detection: check aspect ratio of bounding box
  // Heuristic — if any two dims form a pocket deeper than 4x the narrower dimension
  const sortedDims = [dims.x, dims.y, dims.z].sort((a, b) => a - b);
  const pocketRatio = sortedDims[2] / Math.max(sortedDims[0], 0.01);
  if (pocketRatio > opts.maxAspectRatio) {
    issues.push({
      id: nextId('cnc_milling'),
      process: 'cnc_milling',
      type: 'deep_pocket',
      severity: pocketRatio > opts.maxAspectRatio * 2 ? 'error' : 'warning',
      description: `Aspect ratio ${pocketRatio.toFixed(1)}:1 exceeds limit (${opts.maxAspectRatio}:1) — possible deep pocket`,
      suggestion: 'Reduce pocket depth or widen the opening. Use step-down machining for deep features',
    });
  }

  // Sharp internal corners: edges where adjacent face normals form a small dihedral angle
  const sharpCornerFaces = new Set<number>();
  const sharpLocs: THREE.Vector3[] = [];
  for (const [, info] of edgeMap) {
    if (info.faces.length === 2) {
      const dot = info.normals[0].dot(info.normals[1]);
      // dihedral angle between faces: if normals point inward with sharp angle
      if (dot < -0.5 && dot > -1.0) {
        // This is an internal concave corner
        const cross = new THREE.Vector3().crossVectors(info.normals[0], info.normals[1]);
        const dihedralAngle = Math.acos(Math.max(-1, Math.min(1, dot))) * RAD2DEG;
        if (dihedralAngle > 120) {
          info.faces.forEach(f => sharpCornerFaces.add(f));
          sharpLocs.push(info.midpoint.clone());
        }
      }
    }
  }
  if (sharpCornerFaces.size > 0) {
    const avgLoc = new THREE.Vector3();
    sharpLocs.forEach(l => avgLoc.add(l));
    avgLoc.divideScalar(sharpLocs.length);
    issues.push({
      id: nextId('cnc_milling'),
      process: 'cnc_milling',
      type: 'sharp_corner',
      severity: 'warning',
      description: `${sharpCornerFaces.size} faces near sharp internal corners (tool radius limitation)`,
      suggestion: 'Add fillet radius >= tool radius at internal corners. Typical min radius: 1-3mm',
      faceIndices: [...sharpCornerFaces],
      location: [avgLoc.x, avgLoc.y, avgLoc.z],
    });
  }

  // Thin wall check (fast voxel-based pass)
  const thinWallFaces = detectThinWalls(tris, edgeMap, opts.minWallThickness);
  if (thinWallFaces.length > 0) {
    issues.push({
      id: nextId('cnc_milling'),
      process: 'cnc_milling',
      type: 'thin_wall',
      severity: 'warning',
      description: `${thinWallFaces.length} faces in thin wall regions (< ${opts.minWallThickness}mm)`,
      suggestion: `Increase wall thickness to at least ${opts.minWallThickness}mm for CNC stability`,
      faceIndices: thinWallFaces,
    });
  }

  // Precise wall thickness measurement via raycasting
  const minWallCNC = 1.5;
  const thinMeasurementsCNC = measureWallThickness(nonIndexed, minWallCNC * 3, 0.03);
  if (thinMeasurementsCNC.length > 0) {
    const thinnestCNC = thinMeasurementsCNC.reduce((a, b) => a.thickness < b.thickness ? a : b);
    issues.push({
      id: nextId('cnc_milling'),
      process: 'cnc_milling',
      type: 'thin_wall',
      severity: thinnestCNC.thickness < minWallCNC ? 'error' : 'warning',
      description: `Minimum wall thickness: ${thinnestCNC.thickness.toFixed(2)}mm (recommended ≥${minWallCNC}mm for CNC)`,
      suggestion: `Increase wall thickness to at least ${minWallCNC}mm for CNC stability`,
      location: [thinnestCNC.position.x, thinnestCNC.position.y, thinnestCNC.position.z],
    });
  }

  return issues;
}

function analyzeCNCTurning(
  tris: TriData[],
  _edgeMap: Map<string, EdgeInfo>,
  dims: THREE.Vector3,
  opts: Required<DFMOptions>,
  _nonIndexed: THREE.BufferGeometry,
): DFMIssue[] {
  const issues: DFMIssue[] = [];
  const latheAxis = new THREE.Vector3(0, 1, 0); // turning axis along Y

  // Check axial symmetry: for each face, the normal should be roughly radial or axial
  const nonSymFaces: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    const { centroid, normal } = tris[i];
    // Project centroid onto XZ plane (perpendicular to lathe axis)
    const radialDir = new THREE.Vector3(centroid.x, 0, centroid.z);
    const radialLen = radialDir.length();
    if (radialLen < 0.01) continue; // on axis, fine
    radialDir.normalize();

    // Normal should be mostly radial or axial
    const axialComponent = Math.abs(normal.dot(latheAxis));
    const radialComponent = Math.abs(normal.dot(radialDir));
    const tangentialComponent = Math.sqrt(Math.max(0, 1 - axialComponent * axialComponent - radialComponent * radialComponent));

    if (tangentialComponent > 0.5) {
      nonSymFaces.push(i);
    }
  }

  if (nonSymFaces.length > tris.length * 0.15) {
    issues.push({
      id: nextId('cnc_turning'),
      process: 'cnc_turning',
      type: 'tool_access',
      severity: 'error',
      description: `${nonSymFaces.length} faces break axial symmetry — not suitable for turning`,
      suggestion: 'Part should be rotationally symmetric about the turning axis. Redesign non-symmetric features',
      faceIndices: nonSymFaces,
    });
  } else if (nonSymFaces.length > 0) {
    issues.push({
      id: nextId('cnc_turning'),
      process: 'cnc_turning',
      type: 'tool_access',
      severity: 'warning',
      description: `${nonSymFaces.length} faces slightly off-axis — may need secondary operations`,
      suggestion: 'Consider post-machining or milling for non-axisymmetric features',
      faceIndices: nonSymFaces,
    });
  }

  // Aspect ratio: long thin parts are hard to turn
  const maxDim = Math.max(dims.x, dims.y, dims.z);
  const minDim = Math.min(dims.x, dims.y, dims.z);
  const ar = maxDim / Math.max(minDim, 0.01);
  if (ar > 10) {
    issues.push({
      id: nextId('cnc_turning'),
      process: 'cnc_turning',
      type: 'aspect_ratio',
      severity: ar > 20 ? 'error' : 'warning',
      description: `Length-to-diameter ratio ${ar.toFixed(1)}:1 — may cause deflection/vibration`,
      suggestion: 'Use tailstock support for L/D > 4. Consider steady rest for very long parts',
    });
  }

  return issues;
}

function analyzeInjectionMolding(
  tris: TriData[],
  edgeMap: Map<string, EdgeInfo>,
  dims: THREE.Vector3,
  opts: Required<DFMOptions>,
  nonIndexed: THREE.BufferGeometry,
): DFMIssue[] {
  const issues: DFMIssue[] = [];
  const pullDir = new THREE.Vector3(0, 1, 0); // mold pull direction (Y+)

  // Draft angle check: faces nearly parallel to pull direction need draft
  const lowDraftFaces: number[] = [];
  const zeroDraftFaces: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    const normal = tris[i].normal;
    // Angle between face normal and pull direction
    const cosAngle = Math.abs(normal.dot(pullDir));
    // Angle between face plane and pull direction
    const faceAngleFromPull = Math.acos(Math.max(0, Math.min(1, cosAngle))) * RAD2DEG;
    // We care about faces that are nearly parallel to pull direction (angle close to 90)
    const draftAngle = 90 - faceAngleFromPull;

    if (draftAngle < 0.5 && faceAngleFromPull > 85) {
      zeroDraftFaces.push(i);
    } else if (draftAngle < opts.minDraftAngle && faceAngleFromPull > 80) {
      lowDraftFaces.push(i);
    }
  }

  if (zeroDraftFaces.length > 0) {
    issues.push({
      id: nextId('injection_molding'),
      process: 'injection_molding',
      type: 'draft_angle',
      severity: 'error',
      description: `${zeroDraftFaces.length} faces with zero draft angle — part will stick in mold`,
      suggestion: `Add minimum ${opts.minDraftAngle}deg draft angle to all vertical faces. Standard: 1-3deg`,
      faceIndices: zeroDraftFaces,
    });
  }
  if (lowDraftFaces.length > 0) {
    issues.push({
      id: nextId('injection_molding'),
      process: 'injection_molding',
      type: 'draft_angle',
      severity: 'warning',
      description: `${lowDraftFaces.length} faces with insufficient draft (< ${opts.minDraftAngle}deg)`,
      suggestion: 'Increase draft angle for easier mold release and reduced ejection marks',
      faceIndices: lowDraftFaces,
    });
  }

  // Undercut detection
  const undercutFaces: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    const dot = tris[i].normal.dot(pullDir);
    // Face normal perpendicular to pull and facing inward = undercut
    if (dot < -0.1 && Math.abs(tris[i].normal.x) + Math.abs(tris[i].normal.z) > 0.5) {
      undercutFaces.push(i);
    }
  }
  if (undercutFaces.length > 0) {
    issues.push({
      id: nextId('injection_molding'),
      process: 'injection_molding',
      type: 'undercut',
      severity: undercutFaces.length > tris.length * 0.05 ? 'error' : 'warning',
      description: `${undercutFaces.length} faces create undercuts — requires side actions or lifters`,
      suggestion: 'Eliminate undercuts by redesigning features or plan for side-action mold cores',
      faceIndices: undercutFaces,
    });
  }

  // Uniform wall thickness (fast voxel-based pass)
  const thinWalls = detectThinWalls(tris, edgeMap, opts.minWallThickness);
  if (thinWalls.length > 0) {
    issues.push({
      id: nextId('injection_molding'),
      process: 'injection_molding',
      type: 'uniform_wall',
      severity: 'warning',
      description: `${thinWalls.length} faces in thin/non-uniform wall regions`,
      suggestion: 'Maintain uniform wall thickness (typically 1-4mm). Vary gradually to avoid sink marks',
      faceIndices: thinWalls,
    });
  }

  // Precise wall thickness measurement via raycasting
  const minWallIM = 1.0;
  const thinMeasurementsIM = measureWallThickness(nonIndexed, minWallIM * 3, 0.03);
  if (thinMeasurementsIM.length > 0) {
    const thinnestIM = thinMeasurementsIM.reduce((a, b) => a.thickness < b.thickness ? a : b);
    issues.push({
      id: nextId('injection_molding'),
      process: 'injection_molding',
      type: 'thin_wall',
      severity: thinnestIM.thickness < minWallIM ? 'error' : 'warning',
      description: `Minimum wall thickness: ${thinnestIM.thickness.toFixed(2)}mm (recommended ≥${minWallIM}mm for injection molding)`,
      suggestion: `Increase wall thickness to at least ${minWallIM}mm to ensure proper mold fill`,
      location: [thinnestIM.position.x, thinnestIM.position.y, thinnestIM.position.z],
    });
  }

  // Sharp corners in mold
  const sharpFaces = new Set<number>();
  for (const [, info] of edgeMap) {
    if (info.faces.length === 2) {
      const dot = info.normals[0].dot(info.normals[1]);
      if (dot < -0.7) {
        info.faces.forEach(f => sharpFaces.add(f));
      }
    }
  }
  if (sharpFaces.size > 0) {
    issues.push({
      id: nextId('injection_molding'),
      process: 'injection_molding',
      type: 'sharp_corner',
      severity: 'info',
      description: `${sharpFaces.size} faces at sharp corners — stress concentration risk`,
      suggestion: 'Add radii to all corners (min 0.5mm). This improves flow, strength, and mold life',
      faceIndices: [...sharpFaces],
    });
  }

  return issues;
}

function analyzeSheetMetal(
  tris: TriData[],
  edgeMap: Map<string, EdgeInfo>,
  dims: THREE.Vector3,
  opts: Required<DFMOptions>,
  nonIndexed: THREE.BufferGeometry,
): DFMIssue[] {
  const issues: DFMIssue[] = [];

  // Bend radius checks: sharp bends (very acute dihedral angles between adjacent faces)
  const sharpBendFaces = new Set<number>();
  const sharpBendLocs: THREE.Vector3[] = [];
  for (const [, info] of edgeMap) {
    if (info.faces.length === 2) {
      const dot = info.normals[0].dot(info.normals[1]);
      const dihedralAngle = Math.acos(Math.max(-1, Math.min(1, dot))) * RAD2DEG;
      // Sharp bend: dihedral angle between 30-150 degrees (not flat, not folded back)
      if (dihedralAngle > 20 && dihedralAngle < 160) {
        info.faces.forEach(f => sharpBendFaces.add(f));
        sharpBendLocs.push(info.midpoint.clone());
      }
    }
  }
  if (sharpBendFaces.size > 0) {
    issues.push({
      id: nextId('sheet_metal'),
      process: 'sheet_metal',
      type: 'sharp_corner',
      severity: 'warning',
      description: `${sharpBendFaces.size} faces at bend locations — verify bend radius`,
      suggestion: 'Minimum bend radius should be >= material thickness. Use relief cuts at corners',
      faceIndices: [...sharpBendFaces],
    });
  }

  // Minimum flange length: short dimensions relative to thickness
  const minDim = Math.min(dims.x, dims.y, dims.z);
  if (minDim < opts.minWallThickness * 3) {
    issues.push({
      id: nextId('sheet_metal'),
      process: 'sheet_metal',
      type: 'aspect_ratio',
      severity: 'warning',
      description: `Minimum dimension ${minDim.toFixed(1)}mm may be too short for flange`,
      suggestion: 'Minimum flange length should be >= 3x material thickness for proper bending',
    });
  }

  // Thin wall / material thickness check (fast voxel-based pass)
  const thinWalls = detectThinWalls(tris, edgeMap, opts.minWallThickness * 0.5);
  if (thinWalls.length > 0) {
    issues.push({
      id: nextId('sheet_metal'),
      process: 'sheet_metal',
      type: 'thin_wall',
      severity: 'warning',
      description: `${thinWalls.length} faces in very thin regions`,
      suggestion: 'Ensure sheet gauge is consistent. Standard gauges: 0.5mm - 6mm for most metals',
      faceIndices: thinWalls,
    });
  }

  // Precise wall thickness measurement via raycasting
  const minWallSM = 0.5;
  const thinMeasurementsSM = measureWallThickness(nonIndexed, minWallSM * 3, 0.03);
  if (thinMeasurementsSM.length > 0) {
    const thinnestSM = thinMeasurementsSM.reduce((a, b) => a.thickness < b.thickness ? a : b);
    issues.push({
      id: nextId('sheet_metal'),
      process: 'sheet_metal',
      type: 'thin_wall',
      severity: thinnestSM.thickness < minWallSM ? 'error' : 'warning',
      description: `Minimum wall thickness: ${thinnestSM.thickness.toFixed(2)}mm (recommended ≥${minWallSM}mm for sheet metal)`,
      suggestion: `Ensure sheet gauge is at least ${minWallSM}mm. Standard gauges: 0.5mm – 6mm`,
      location: [thinnestSM.position.x, thinnestSM.position.y, thinnestSM.position.z],
    });
  }

  return issues;
}

function analyzeCasting(
  tris: TriData[],
  edgeMap: Map<string, EdgeInfo>,
  dims: THREE.Vector3,
  opts: Required<DFMOptions>,
  _nonIndexed: THREE.BufferGeometry,
): DFMIssue[] {
  const issues: DFMIssue[] = [];
  const pullDir = new THREE.Vector3(0, 1, 0);

  // Draft angles for mold extraction
  const lowDraftFaces: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    const cosAngle = Math.abs(tris[i].normal.dot(pullDir));
    const faceAngleFromPull = Math.acos(Math.max(0, Math.min(1, cosAngle))) * RAD2DEG;
    const draftAngle = 90 - faceAngleFromPull;
    if (draftAngle < opts.minDraftAngle * 1.5 && faceAngleFromPull > 80) {
      lowDraftFaces.push(i);
    }
  }
  if (lowDraftFaces.length > 0) {
    issues.push({
      id: nextId('casting'),
      process: 'casting',
      type: 'draft_angle',
      severity: 'warning',
      description: `${lowDraftFaces.length} faces with insufficient draft for casting extraction`,
      suggestion: 'Casting typically needs 1-3deg draft. Sand casting may need 3-5deg',
      faceIndices: lowDraftFaces,
    });
  }

  // Sharp transitions: edges with abrupt normal changes = stress concentrators in castings
  const sharpTransFaces = new Set<number>();
  for (const [, info] of edgeMap) {
    if (info.faces.length === 2) {
      const dot = info.normals[0].dot(info.normals[1]);
      if (dot < -0.6) {
        info.faces.forEach(f => sharpTransFaces.add(f));
      }
    }
  }
  if (sharpTransFaces.size > 0) {
    issues.push({
      id: nextId('casting'),
      process: 'casting',
      type: 'sharp_corner',
      severity: 'warning',
      description: `${sharpTransFaces.size} faces at sharp transitions — porosity/crack risk`,
      suggestion: 'Use generous fillets at all junctions (min 2-3mm). Gradual section changes reduce defects',
      faceIndices: [...sharpTransFaces],
    });
  }

  // Uniform sections: thin walls for castings
  const thinWalls = detectThinWalls(tris, edgeMap, opts.minWallThickness * 1.5);
  if (thinWalls.length > 0) {
    issues.push({
      id: nextId('casting'),
      process: 'casting',
      type: 'uniform_wall',
      severity: 'warning',
      description: `${thinWalls.length} faces in thin sections — may not fill properly`,
      suggestion: 'Minimum wall thickness for casting: 3-6mm (depends on material). Keep sections uniform',
      faceIndices: thinWalls,
    });
  }

  // Undercuts
  const undercutFaces: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    if (tris[i].normal.dot(pullDir) < -0.2) {
      undercutFaces.push(i);
    }
  }
  if (undercutFaces.length > tris.length * 0.15) {
    issues.push({
      id: nextId('casting'),
      process: 'casting',
      type: 'undercut',
      severity: 'error',
      description: `${undercutFaces.length} faces form undercuts — complex coring required`,
      suggestion: 'Simplify undercuts or use cores/side-pulls. Investment casting allows more complexity',
      faceIndices: undercutFaces,
    });
  }

  return issues;
}

/* ─── 3D Printing (FDM/SLA/SLS) analyzer ────────────────────────────────── */

function analyze3DPrinting(
  tris: TriData[],
  edgeMap: Map<string, EdgeInfo>,
  dims: THREE.Vector3,
  opts: Required<DFMOptions>,
  nonIndexed: THREE.BufferGeometry,
): DFMIssue[] {
  const issues: DFMIssue[] = [];
  const buildDir = new THREE.Vector3(0, 1, 0); // build direction = +Y (default)
  const overhangThreshold = Math.cos((45) * DEG2RAD); // faces > 45° from vertical

  // ── Overhang detection ──
  // A face is overhanging when its downward-facing normal exceeds the threshold angle
  const overhangFaces: number[] = [];
  const overhangLocs: THREE.Vector3[] = [];

  for (let i = 0; i < tris.length; i++) {
    const dot = tris[i].normal.dot(buildDir);
    // Downward-facing face (dot < 0) with angle > overhang threshold from vertical
    if (dot < -overhangThreshold) {
      // Only flag if centroid is not at the bottom (i.e. there is nothing below it)
      const yNorm = (tris[i].centroid.y - dims.y * -0.5) / Math.max(dims.y, 0.01);
      if (yNorm > 0.05) {  // not at the base
        overhangFaces.push(i);
        overhangLocs.push(tris[i].centroid.clone());
      }
    }
  }
  if (overhangFaces.length > 0) {
    const avgLoc = new THREE.Vector3();
    overhangLocs.forEach(l => avgLoc.add(l));
    avgLoc.divideScalar(overhangLocs.length);
    const ratio = overhangFaces.length / tris.length;
    issues.push({
      id: nextId('3d_printing'),
      process: '3d_printing',
      type: 'overhang',
      severity: ratio > 0.2 ? 'error' : ratio > 0.08 ? 'warning' : 'info',
      description: `${overhangFaces.length} faces exceed 45° overhang — support structures required (${(ratio * 100).toFixed(1)}% of surface)`,
      suggestion: 'Reorient the part to minimize overhangs. Consider splitting complex overhangs or adding self-supporting angles (≤45°)',
      faceIndices: overhangFaces,
      location: [avgLoc.x, avgLoc.y, avgLoc.z],
    });
  }

  // ── Bridge detection: nearly-horizontal faces at mid-height ──
  const bridgeFaces: number[] = [];
  for (let i = 0; i < tris.length; i++) {
    const dot = tris[i].normal.dot(buildDir);
    const isHorizontalDown = dot < -0.92; // nearly flat ceiling
    if (isHorizontalDown) {
      // centroid in the middle third of part height = bridging candidate
      const yNorm = (tris[i].centroid.y - dims.y * -0.5) / Math.max(dims.y, 0.01);
      if (yNorm > 0.2 && yNorm < 0.8) {
        bridgeFaces.push(i);
      }
    }
  }
  if (bridgeFaces.length > 0) {
    // Estimate bridge span from face extents
    const bb = new THREE.Box3();
    bridgeFaces.forEach(fi => {
      bb.expandByPoint(tris[fi].v0);
      bb.expandByPoint(tris[fi].v1);
      bb.expandByPoint(tris[fi].v2);
    });
    const span = new THREE.Vector3().subVectors(bb.max, bb.min);
    const maxSpan = Math.max(span.x, span.z);
    issues.push({
      id: nextId('3d_printing'),
      process: '3d_printing',
      type: 'bridge',
      severity: maxSpan > 20 ? 'error' : maxSpan > 10 ? 'warning' : 'info',
      description: `Horizontal bridging detected (max span ~${maxSpan.toFixed(1)} mm). FDM bridges sag beyond 10 mm`,
      suggestion: 'Keep bridges under 10 mm for FDM without support. For longer spans, add support or reorient the part',
      faceIndices: bridgeFaces,
    });
  }

  // ── Thin walls: < 0.8 mm for FDM (nozzle diameter limit) — fast voxel pass ──
  const thinWalls = detectThinWalls(tris, edgeMap, Math.max(opts.minWallThickness, 0.8));
  if (thinWalls.length > 0) {
    issues.push({
      id: nextId('3d_printing'),
      process: '3d_printing',
      type: 'thin_wall',
      severity: 'warning',
      description: `${thinWalls.length} faces in regions thinner than ${Math.max(opts.minWallThickness, 0.8).toFixed(1)} mm — may not print reliably`,
      suggestion: 'Minimum wall thickness for FDM: 0.8–1.2 mm (≥ nozzle diameter). SLA/SLS can handle 0.3–0.5 mm',
      faceIndices: thinWalls,
    });
  }

  // ── Precise wall thickness via raycasting ──
  const minWall3DP = 0.8;
  const thinMeasurements3DP = measureWallThickness(nonIndexed, minWall3DP * 3, 0.03);
  if (thinMeasurements3DP.length > 0) {
    const thinnest3DP = thinMeasurements3DP.reduce((a, b) => a.thickness < b.thickness ? a : b);
    issues.push({
      id: nextId('3d_printing'),
      process: '3d_printing',
      type: 'thin_wall',
      severity: thinnest3DP.thickness < minWall3DP ? 'error' : 'warning',
      description: `Minimum wall thickness: ${thinnest3DP.thickness.toFixed(2)}mm (recommended ≥${minWall3DP}mm for FDM)`,
      suggestion: `Increase wall thickness to at least ${minWall3DP}mm. SLA/SLS can handle 0.3–0.5mm`,
      location: [thinnest3DP.position.x, thinnest3DP.position.y, thinnest3DP.position.z],
    });
  }

  // ── Support volume estimation: count overhang + bridge face area ──
  const supportArea = [...overhangFaces, ...bridgeFaces].reduce((sum, fi) => sum + tris[fi].area, 0);
  if (supportArea > 500) {
    issues.push({
      id: nextId('3d_printing'),
      process: '3d_printing',
      type: 'support_volume',
      severity: supportArea > 5000 ? 'warning' : 'info',
      description: `Estimated support contact area: ${(supportArea / 100).toFixed(1)} cm² — significant post-processing required`,
      suggestion: 'Redesign or reorient to reduce support volume. Use tree supports to minimize waste and surface damage',
    });
  }

  // ── Aspect ratio: tall thin parts risk warping / tipping ──
  const sortedDims = [dims.x, dims.y, dims.z].sort((a, b) => a - b);
  const printAspect = sortedDims[2] / Math.max(sortedDims[0], 0.01);
  if (printAspect > 6) {
    issues.push({
      id: nextId('3d_printing'),
      process: '3d_printing',
      type: 'aspect_ratio',
      severity: printAspect > 12 ? 'error' : 'warning',
      description: `High aspect ratio (${printAspect.toFixed(1)}:1) — risk of warping, layer shifting, or part tipping during print`,
      suggestion: 'Print at an angle or add a brim/raft. Consider splitting into multiple parts and assembling',
    });
  }

  return issues;
}

/* ─── Shared helper: thin wall detection ─────────────────────────────────── */

function detectThinWalls(
  tris: TriData[],
  edgeMap: Map<string, EdgeInfo>,
  minThickness: number,
): number[] {
  const thinFaces: number[] = [];
  // Use edge adjacency: if two adjacent faces have nearly opposite normals, the wall is thin
  for (const [, info] of edgeMap) {
    if (info.faces.length === 2) {
      const dot = info.normals[0].dot(info.normals[1]);
      if (dot < -0.85) {
        // Nearly opposite normals - check if the faces are close together
        const c0 = tris[info.faces[0]].centroid;
        const c1 = tris[info.faces[1]].centroid;
        const dist = c0.distanceTo(c1);
        if (dist < minThickness) {
          thinFaces.push(info.faces[0], info.faces[1]);
        }
      }
    }
  }
  return [...new Set(thinFaces)];
}

/* ─── Score computation ──────────────────────────────────────────────────── */

function computeScore(issues: DFMIssue[]): number {
  let score = 100;
  for (const issue of issues) {
    switch (issue.severity) {
      case 'error': score -= 25; break;
      case 'warning': score -= 10; break;
      case 'info': score -= 3; break;
    }
  }
  return Math.max(0, Math.min(100, score));
}

function difficultyFromScore(score: number): DFMResult['estimatedDifficulty'] {
  if (score >= 80) return 'easy';
  if (score >= 55) return 'moderate';
  if (score >= 25) return 'difficult';
  return 'infeasible';
}

/* ─── Main analysis function ─────────────────────────────────────────────── */

export function analyzeDFM(
  geometry: THREE.BufferGeometry,
  processes: ManufacturingProcess[],
  options?: DFMOptions,
): DFMResult[] {
  issueCounter = 0;

  const opts: Required<DFMOptions> = {
    minWallThickness: options?.minWallThickness ?? 1.0,
    minDraftAngle: options?.minDraftAngle ?? 1.0,
    maxAspectRatio: options?.maxAspectRatio ?? 4.0,
  };

  // Build non-indexed geometry once; used both for triangle extraction and raycasting
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  nonIndexed.computeVertexNormals();

  const tris = extractTriangles(geometry);
  const edgeMap = buildEdgeMap(tris);
  const dims = computeBBoxDimensions(geometry);

  type AnalyzerFn = (t: TriData[], e: Map<string, EdgeInfo>, d: THREE.Vector3, o: Required<DFMOptions>, geo: THREE.BufferGeometry) => DFMIssue[];
  const analyzerMap: Record<ManufacturingProcess, AnalyzerFn> = {
    cnc_milling: analyzeCNCMilling,
    cnc_turning: analyzeCNCTurning,
    injection_molding: analyzeInjectionMolding,
    sheet_metal: analyzeSheetMetal,
    casting: analyzeCasting,
    '3d_printing': analyze3DPrinting,
  };

  return processes.map(process => {
    const analyze = analyzerMap[process];
    const issues = analyze(tris, edgeMap, dims, opts, nonIndexed);
    const score = computeScore(issues);
    return {
      process,
      score,
      issues,
      feasible: score >= 25,
      estimatedDifficulty: difficultyFromScore(score),
    };
  });
}
