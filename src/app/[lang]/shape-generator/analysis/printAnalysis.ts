import * as THREE from 'three';

/* ─── Types ──────────────────────────────────────────────────────────────── */

export interface PrintIssue {
  type: 'overhang' | 'thin_wall' | 'bridging' | 'small_feature';
  severity: 'warning' | 'error';
  description: string;
  faceIndices?: number[];
}

export interface PrintAnalysisResult {
  overhangFaces: number[];        // indices of faces with angle > threshold
  overhangAngles: Float32Array;   // per-face angle from build direction (degrees)
  supportVolume: number;           // estimated support material volume (cm³)
  printTime: number;               // estimated print time (minutes)
  layerCount: number;              // number of layers
  materialUsage: number;           // effective filament/resin usage (cm³)
  issues: PrintIssue[];
  boundingBox: { min: THREE.Vector3; max: THREE.Vector3 };
  buildHeight: number;             // mm
  /** Detailed cost breakdown (when settings provided) */
  costBreakdown?: PrintCostBreakdown;
  /** The process used for the estimate */
  process?: PrintProcess;
}

/* ─── Process-specific physical/cost constants ───────────────────────────── */
// All densities g/cm³, cost USD/kg, speed factors are multipliers vs FDM baseline.
const PROCESS_PARAMS: Record<PrintProcess, {
  density: number;         // g/cm³
  costPerKg: number;       // USD/kg
  machineRate: number;     // USD/hr
  perimeterShells: number; // wall layers (volume contribution beyond infill)
  speedFactor: number;     // relative print speed vs FDM
  infillUsable: boolean;   // SLA/SLS effectively print fully solid
}> = {
  fdm: { density: 1.24, costPerKg: 25,  machineRate: 3,  perimeterShells: 2, speedFactor: 1.0,  infillUsable: true  },
  sla: { density: 1.10, costPerKg: 90,  machineRate: 6,  perimeterShells: 0, speedFactor: 0.55, infillUsable: false },
  sls: { density: 1.01, costPerKg: 110, machineRate: 12, perimeterShells: 0, speedFactor: 0.30, infillUsable: false },
};

export interface PrintAnalysisOptions {
  buildDirection?: [number, number, number]; // default [0, 1, 0] (Y-up)
  overhangAngle?: number;    // degrees, default 45
  layerHeight?: number;      // mm, default 0.2
  minWallThickness?: number; // mm, default 0.8
  /** Infill percentage (0–100). Default 20. */
  infillPercent?: number;
  /** Nozzle/print speed in mm/s. Default 60. */
  printSpeed?: number;
  /** Process: 'fdm' | 'sla' | 'sls'. Default 'fdm'. */
  process?: PrintProcess;
}

export type PrintProcess = 'fdm' | 'sla' | 'sls';

export interface PrintCostBreakdown {
  /** Solid mesh volume (cm³) */
  meshVolume: number;
  /** Effective filament/resin volume after infill + walls (cm³) */
  effectiveVolume: number;
  /** Material weight (grams) */
  materialWeight: number;
  /** Material cost (USD) */
  materialCost: number;
  /** Machine time cost (USD) */
  machineCost: number;
  /** Total cost (USD) */
  totalCost: number;
  /** Confidence band ±% */
  confidencePct: number;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function triangleArea(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  return ab.cross(ac).length() * 0.5;
}

function triangleNormal(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): THREE.Vector3 {
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  return ab.cross(ac).normalize();
}

/* ─── Main analysis function ─────────────────────────────────────────────── */

export function analyzePrintability(
  geometry: THREE.BufferGeometry,
  options: PrintAnalysisOptions = {},
): PrintAnalysisResult {
  const {
    buildDirection = [0, 1, 0],
    overhangAngle = 45,
    layerHeight = 0.2,
    minWallThickness = 0.8,
    infillPercent = 20,
    printSpeed = 60,
    process = 'fdm',
  } = options;

  const buildDir = new THREE.Vector3(...buildDirection).normalize();
  // "down" direction is opposite of build direction
  const downDir = buildDir.clone().negate();

  // Work with non-indexed geometry for per-face iteration
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = nonIndexed.attributes.position;
  const vertCount = pos.count;
  const triCount = Math.floor(vertCount / 3);

  const overhangFaces: number[] = [];
  const overhangAngles = new Float32Array(triCount);
  const issues: PrintIssue[] = [];

  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();

  // Bounding box along build direction
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const bbMin = bb.min.clone();
  const bbMax = bb.max.clone();

  // Build height is the extent along the build direction
  const allCorners = [
    new THREE.Vector3(bb.min.x, bb.min.y, bb.min.z),
    new THREE.Vector3(bb.max.x, bb.min.y, bb.min.z),
    new THREE.Vector3(bb.min.x, bb.max.y, bb.min.z),
    new THREE.Vector3(bb.min.x, bb.min.y, bb.max.z),
    new THREE.Vector3(bb.max.x, bb.max.y, bb.min.z),
    new THREE.Vector3(bb.max.x, bb.min.y, bb.max.z),
    new THREE.Vector3(bb.min.x, bb.max.y, bb.max.z),
    new THREE.Vector3(bb.max.x, bb.max.y, bb.max.z),
  ];
  let minProj = Infinity, maxProj = -Infinity;
  for (const c of allCorners) {
    const p = c.dot(buildDir);
    if (p < minProj) minProj = p;
    if (p > maxProj) maxProj = p;
  }
  const buildHeight = maxProj - minProj;
  const layerCount = Math.max(1, Math.ceil(buildHeight / layerHeight));

  // Per-face analysis
  let totalSupportArea = 0;
  const overhangThreshold = overhangAngle; // angle from vertical beyond which support is needed
  const severeOverhangFaces: number[] = [];
  const moderateOverhangFaces: number[] = [];

  for (let i = 0; i < triCount; i++) {
    v0.fromBufferAttribute(pos, i * 3);
    v1.fromBufferAttribute(pos, i * 3 + 1);
    v2.fromBufferAttribute(pos, i * 3 + 2);

    const normal = triangleNormal(v0, v1, v2);
    const area = triangleArea(v0, v1, v2);

    if (area < 1e-10) {
      overhangAngles[i] = 0;
      continue;
    }

    // Angle between face normal and the downward direction
    // If the face normal points downward, it's an overhang
    const cosAngle = normal.dot(downDir);
    // Angle from vertical = angle between normal and down direction
    // 0 = facing straight down (worst overhang)
    // 90 = horizontal face normal (vertical wall)
    // 180 = facing up (no overhang)
    const angleFromDown = Math.acos(Math.max(-1, Math.min(1, cosAngle))) * RAD2DEG;

    // Convert to "overhang angle": 0 = facing down, 90 = vertical wall
    // We want faces where the normal points somewhat downward
    // angleFromDown < 90 means normal has a downward component
    const overhangDeg = angleFromDown < 90 ? (90 - angleFromDown) : 0;
    overhangAngles[i] = overhangDeg;

    if (cosAngle > 0 && angleFromDown < (90 - overhangThreshold + 90)) {
      // Face has downward-facing component
      // Check if the overhang angle exceeds threshold
      if (overhangDeg > overhangThreshold) {
        overhangFaces.push(i);
        // Estimate support: project face area downward
        const centroid = new THREE.Vector3().add(v0).add(v1).add(v2).divideScalar(3);
        const heightAbovePlate = centroid.dot(buildDir) - minProj;
        totalSupportArea += area;

        if (overhangDeg > 70) {
          severeOverhangFaces.push(i);
        } else {
          moderateOverhangFaces.push(i);
        }
      }
    }
  }

  // Estimate support volume (rough): support area * average height * density factor
  // Support structures are typically 10-20% fill, so multiply by ~0.15
  const avgHeight = buildHeight * 0.5; // rough average
  const supportVolume = (totalSupportArea * avgHeight * 0.15) / 1000; // convert mm³ to cm³

  // Material usage: mesh volume (from bounding box estimate or geometry volume)
  const size = bb.getSize(new THREE.Vector3());
  // Use divergence theorem for volume
  let meshVolume = 0;
  for (let i = 0; i < triCount; i++) {
    v0.fromBufferAttribute(pos, i * 3);
    v1.fromBufferAttribute(pos, i * 3 + 1);
    v2.fromBufferAttribute(pos, i * 3 + 2);
    meshVolume += (
      v0.x * (v1.y * v2.z - v1.z * v2.y) +
      v1.x * (v2.y * v0.z - v2.z * v0.y) +
      v2.x * (v0.y * v1.z - v0.z * v1.y)
    );
  }
  meshVolume = Math.abs(meshVolume / 6);
  const meshVolumeCm3 = meshVolume / 1000; // mm³ → cm³

  // ── Effective material volume ──
  // FDM: shell + infill model. Approximate shell as (surface area × wall thickness)
  // and bound it to never exceed the solid volume.
  const proc = PROCESS_PARAMS[process];
  let surfaceAreaMm2 = 0;
  for (let i = 0; i < triCount; i++) {
    v0.fromBufferAttribute(pos, i * 3);
    v1.fromBufferAttribute(pos, i * 3 + 1);
    v2.fromBufferAttribute(pos, i * 3 + 2);
    surfaceAreaMm2 += triangleArea(v0, v1, v2);
  }
  const wallThicknessMm = proc.perimeterShells * Math.max(0.4, layerHeight * 2);
  const shellVolumeCm3 = Math.min(meshVolumeCm3, (surfaceAreaMm2 * wallThicknessMm) / 1000);
  const interiorCm3 = Math.max(0, meshVolumeCm3 - shellVolumeCm3);
  const infillFraction = proc.infillUsable
    ? Math.max(0, Math.min(1, infillPercent / 100))
    : 1.0;
  const effectiveVolumeCm3 = shellVolumeCm3 + interiorCm3 * infillFraction + supportVolume;
  const materialUsage = effectiveVolumeCm3;

  // ── Print time ──
  // Linear model: deposition rate = nozzleArea × speed.
  // FDM: ~(0.4 mm × layerHeight × printSpeed) mm³/s.
  // SLA/SLS scale by speedFactor (slower per layer).
  const lineWidthMm = 0.4;
  const depositionRateMm3PerSec = lineWidthMm * layerHeight * printSpeed * proc.speedFactor;
  const effectiveVolMm3 = effectiveVolumeCm3 * 1000;
  // Travel/setup overhead: ~8s per layer (retract, travel, layer change)
  const overheadSec = layerCount * 8;
  const depositionSec = depositionRateMm3PerSec > 0
    ? effectiveVolMm3 / depositionRateMm3PerSec
    : 0;
  const printTime = (depositionSec + overheadSec) / 60; // minutes

  // ── Cost breakdown ──
  const materialWeight = effectiveVolumeCm3 * proc.density;        // grams
  const materialCost = (materialWeight / 1000) * proc.costPerKg;    // USD
  const machineCost = (printTime / 60) * proc.machineRate;          // USD
  const totalCost = materialCost + machineCost;
  const costBreakdown: PrintCostBreakdown = {
    meshVolume: meshVolumeCm3,
    effectiveVolume: effectiveVolumeCm3,
    materialWeight,
    materialCost,
    machineCost,
    totalCost,
    confidencePct: 15,
  };

  // ── Thin wall detection ──
  // Build edge map: for each edge, track adjacent face normals
  const edgeMap = new Map<string, { faces: number[]; normals: THREE.Vector3[] }>();
  const EPSILON = 1e-5;

  function vertKey(v: THREE.Vector3): string {
    return `${Math.round(v.x / EPSILON)}_${Math.round(v.y / EPSILON)}_${Math.round(v.z / EPSILON)}`;
  }

  function edgeKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  const thinWallFaces: number[] = [];

  for (let i = 0; i < triCount; i++) {
    v0.fromBufferAttribute(pos, i * 3);
    v1.fromBufferAttribute(pos, i * 3 + 1);
    v2.fromBufferAttribute(pos, i * 3 + 2);

    const normal = triangleNormal(v0, v1, v2);
    const k0 = vertKey(v0), k1 = vertKey(v1), k2 = vertKey(v2);
    const edges = [edgeKey(k0, k1), edgeKey(k1, k2), edgeKey(k2, k0)];

    for (const ek of edges) {
      let entry = edgeMap.get(ek);
      if (!entry) {
        entry = { faces: [], normals: [] };
        edgeMap.set(ek, entry);
      }
      entry.faces.push(i);
      entry.normals.push(normal.clone());
    }
  }

  // Find edges where adjacent normals are nearly opposite (thin wall indicator)
  for (const [, entry] of edgeMap) {
    if (entry.faces.length === 2) {
      const dot = entry.normals[0].dot(entry.normals[1]);
      if (dot < -0.85) {
        // Nearly opposite normals — potential thin wall
        thinWallFaces.push(...entry.faces);
      }
    }
  }

  const uniqueThinWall = [...new Set(thinWallFaces)];

  // ── Build issues list ──
  if (severeOverhangFaces.length > 0) {
    issues.push({
      type: 'overhang',
      severity: 'error',
      description: `${severeOverhangFaces.length} faces with severe overhang (>70°) — support required`,
      faceIndices: severeOverhangFaces,
    });
  }
  if (moderateOverhangFaces.length > 0) {
    issues.push({
      type: 'overhang',
      severity: 'warning',
      description: `${moderateOverhangFaces.length} faces with moderate overhang (${overhangThreshold}°–70°)`,
      faceIndices: moderateOverhangFaces,
    });
  }
  if (uniqueThinWall.length > 0) {
    issues.push({
      type: 'thin_wall',
      severity: 'warning',
      description: `${uniqueThinWall.length} faces in potential thin-wall regions (<${minWallThickness}mm)`,
      faceIndices: uniqueThinWall,
    });
  }

  // Bridging detection: horizontal overhang faces that span unsupported gaps
  const bridgingFaces = overhangFaces.filter(fi => {
    const ang = overhangAngles[fi];
    return ang > 80; // nearly horizontal downward faces
  });
  if (bridgingFaces.length > 0) {
    issues.push({
      type: 'bridging',
      severity: 'warning',
      description: `${bridgingFaces.length} faces may require bridging support`,
      faceIndices: bridgingFaces,
    });
  }

  // Small feature detection: triangles with very small area
  const smallFeatureFaces: number[] = [];
  for (let i = 0; i < triCount; i++) {
    v0.fromBufferAttribute(pos, i * 3);
    v1.fromBufferAttribute(pos, i * 3 + 1);
    v2.fromBufferAttribute(pos, i * 3 + 2);
    const area = triangleArea(v0, v1, v2);
    // Very small triangles might indicate fine detail that won't print well
    if (area > 0 && area < layerHeight * layerHeight * 0.5) {
      smallFeatureFaces.push(i);
    }
  }
  if (smallFeatureFaces.length > 10) {
    issues.push({
      type: 'small_feature',
      severity: 'warning',
      description: `${smallFeatureFaces.length} very small triangles — fine detail may not print accurately`,
      faceIndices: smallFeatureFaces,
    });
  }

  if (issues.length === 0) {
    issues.push({
      type: 'overhang',
      severity: 'warning',
      description: 'No significant printability issues detected',
    });
  }

  return {
    overhangFaces,
    overhangAngles,
    supportVolume,
    printTime,
    layerCount,
    materialUsage,
    issues,
    boundingBox: { min: bbMin, max: bbMax },
    buildHeight,
    costBreakdown,
    process,
  };
}

/* ─── Auto orientation optimizer ─────────────────────────────────────────── */

export interface OrientationCandidate {
  /** Build direction (the "up" axis after rotation) — one of ±X / ±Y / ±Z */
  buildDirection: [number, number, number];
  /** Human-readable label, e.g. "+Y (default)" */
  label: string;
  /** Total downward-face area exceeding the overhang threshold (mm²) */
  supportArea: number;
  /** Number of overhang faces */
  overhangCount: number;
  /** Build height along this direction (mm) */
  buildHeight: number;
  /** Footprint area on the build plate (mm²) — larger = more stable */
  footprintArea: number;
  /** Combined score (lower = better). Weighs support area heavily. */
  score: number;
}

export interface OrientationOptimizationResult {
  candidates: OrientationCandidate[];
  /** Index of the best candidate within `candidates` */
  bestIndex: number;
  /** Index of the user's current orientation (for delta display) */
  currentIndex: number;
}

const SIX_AXES: Array<{ dir: [number, number, number]; label: string }> = [
  { dir: [0,  1, 0], label: '+Y' },
  { dir: [0, -1, 0], label: '-Y' },
  { dir: [1,  0, 0], label: '+X' },
  { dir: [-1, 0, 0], label: '-X' },
  { dir: [0, 0,  1], label: '+Z' },
  { dir: [0, 0, -1], label: '-Z' },
];

/**
 * Test all 6 axis-aligned build directions and rank them by support area,
 * build height, and footprint stability. The lowest-score candidate is
 * returned as `bestIndex`.
 *
 * Algorithm: lightweight per-triangle scan (no full analyzePrintability
 * call per candidate) — O(6·n) instead of O(6·n) with allocations.
 */
export function findOptimalOrientation(
  geometry: THREE.BufferGeometry,
  options: { overhangAngle?: number; currentDirection?: [number, number, number] } = {},
): OrientationOptimizationResult {
  const overhangAngle = options.overhangAngle ?? 45;
  const currentDir = options.currentDirection ?? [0, 1, 0];

  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry;
  const pos = nonIndexed.attributes.position;
  const triCount = Math.floor(pos.count / 3);

  // Pre-compute triangle normals + areas + centroids once.
  const normals = new Float32Array(triCount * 3);
  const areas = new Float32Array(triCount);

  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const cross = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    va.fromBufferAttribute(pos, i * 3);
    vb.fromBufferAttribute(pos, i * 3 + 1);
    vc.fromBufferAttribute(pos, i * 3 + 2);
    ab.subVectors(vb, va);
    ac.subVectors(vc, va);
    cross.crossVectors(ab, ac);
    const len = cross.length();
    areas[i] = len * 0.5;
    if (len > 1e-12) {
      normals[i * 3]     = cross.x / len;
      normals[i * 3 + 1] = cross.y / len;
      normals[i * 3 + 2] = cross.z / len;
    }
  }

  // Bounding box for build height + footprint.
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const sizeX = bb.max.x - bb.min.x;
  const sizeY = bb.max.y - bb.min.y;
  const sizeZ = bb.max.z - bb.min.z;

  // cos(threshold) — face is an overhang if normal·(-buildDir) > cosThreshold.
  // overhangDeg > overhangAngle  ⇔  angle(normal, -buildDir) < (90 - overhangAngle)
  const cosThreshold = Math.cos((90 - overhangAngle) * DEG2RAD);

  const candidates: OrientationCandidate[] = SIX_AXES.map(({ dir, label }) => {
    const [bx, by, bz] = dir;
    // Downward = -buildDir
    const dx = -bx, dy = -by, dz = -bz;

    let supportArea = 0;
    let overhangCount = 0;
    for (let i = 0; i < triCount; i++) {
      const nx = normals[i * 3];
      const ny = normals[i * 3 + 1];
      const nz = normals[i * 3 + 2];
      const cosAngle = nx * dx + ny * dy + nz * dz;
      if (cosAngle > cosThreshold) {
        supportArea += areas[i];
        overhangCount++;
      }
    }

    const buildHeight =
      Math.abs(bx) > 0.5 ? sizeX :
      Math.abs(by) > 0.5 ? sizeY : sizeZ;
    const footprintArea =
      Math.abs(bx) > 0.5 ? sizeY * sizeZ :
      Math.abs(by) > 0.5 ? sizeX * sizeZ : sizeX * sizeY;

    // Score: support area is the dominant cost; tall builds and small
    // footprints add small penalties.
    const score =
      supportArea * 1.0 +
      buildHeight * 0.5 +
      Math.max(0, 100 - footprintArea / 100) * 0.3;

    return {
      buildDirection: [bx, by, bz] as [number, number, number],
      label,
      supportArea,
      overhangCount,
      buildHeight,
      footprintArea,
      score,
    };
  });

  let bestIndex = 0;
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].score < candidates[bestIndex].score) bestIndex = i;
  }

  // Find which candidate matches the user's current direction (within tolerance).
  let currentIndex = 0;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i].buildDirection;
    if (Math.abs(c[0] - currentDir[0]) < 0.01 &&
        Math.abs(c[1] - currentDir[1]) < 0.01 &&
        Math.abs(c[2] - currentDir[2]) < 0.01) {
      currentIndex = i;
      break;
    }
  }

  return { candidates, bestIndex, currentIndex };
}
