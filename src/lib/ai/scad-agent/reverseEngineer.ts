/**
 * reverseEngineer.ts — Scanned STL → proposed IntentInput (heuristic v1).
 *
 * Pure shape classifier that consumes the existing faceInspection helpers
 * (topology, surface area, hole detection, dihedrals) and emits the most
 * likely IntentInput(s) the user may have meant when they imported a part
 * with no source CAD. No AI call — the rules below are deterministic and
 * cheap enough to run inline.
 *
 * Coverage v1:
 *   - box / sphere / cylinder / pipe / disk / washer
 *   - hole feature per detected axis-aligned cylinder peak (box only — for
 *     cylinder/pipe the central bore is already part of the shape)
 *   - fillet vs chamfer secondary signature when sharpEdgeCount is suppressed
 *
 * Out-of-scope (X-track follow-ups): multi-body assemblies (short-circuit
 * "assembly" candidate), B-rep face fits (NURBS / curved-surface ID),
 * oriented bounding box (only axis-aligned bbox is considered here).
 *
 * Output contract:
 *   reverseEngineerFromGeometry({ geometry })
 *     → { candidates: ProposedIntent[≤3], observedStats }
 *   Candidates are sorted by confidence DESC. Rule 6 guarantees at least
 *   one candidate (even if low-confidence fallback).
 */
import type * as THREE from 'three';
import type { IntentInput, IntentFeature } from '../../openscad-render/intentToScad';
import {
  computeMeshTopology,
  computeSurfaceArea,
  computeMinWallThickness,
  computeDihedralStats,
  detectAllAxisAlignedHoles,
  type DetectedHole,
} from './faceInspection';

export interface ProposedIntent {
  intent: IntentInput;
  /** 0..100 confidence the heuristic places on this match. */
  confidence: number;
  /** Headline summary shown in the UI. */
  summary: string;
  /** Per-rule notes that contributed (positive evidence). */
  evidence: string[];
  /** Per-rule notes against this candidate (negative evidence). */
  counterEvidence: string[];
}

export interface ReverseEngineerInput {
  /** Pre-parsed mesh. The shape classifier only consumes derived stats. */
  geometry: THREE.BufferGeometry;
  /** Override default min wall thickness sample cap (slow on huge meshes). */
  maxWallSamples?: number;
}

export interface ObservedStats {
  bbox: { wMm: number; hMm: number; dMm: number };
  volumeMm3: number;
  surfaceAreaMm2: number;
  genus: number | null;
  componentCount: number;
  holeCount: number;
  sharpEdgeCount: number;
  chamferEdgeCount: number;
  curvedEdgeCount: number;
  minWallMm: number | null;
}

export interface ReverseEngineerResult {
  /** Top candidates sorted by confidence descending. v1 returns up to 3. */
  candidates: ProposedIntent[];
  /** Diagnostic stats the classifier saw (for debug / UI). */
  observedStats: ObservedStats;
}

/**
 * Compute mesh volume via the signed-tetrahedron sum (same as tools.ts'
 * computeMeshVolume but local so the helper has no agent-side deps).
 * Cost O(F). Returns the absolute value so winding-order doesn't flip
 * the sign on us.
 */
function meshVolumeMm3(geometry: THREE.BufferGeometry): number {
  const positions = geometry.attributes.position;
  if (!positions) return 0;
  const posArr = positions.array as ArrayLike<number>;
  const indexAttr = geometry.index;
  const triCount = indexAttr
    ? Math.floor(indexAttr.count / 3)
    : Math.floor(posArr.length / 9);
  let sum = 0;
  for (let t = 0; t < triCount; t++) {
    let i0: number, i1: number, i2: number;
    if (indexAttr) {
      const idxArr = indexAttr.array as ArrayLike<number>;
      i0 = idxArr[t * 3 + 0]! * 3;
      i1 = idxArr[t * 3 + 1]! * 3;
      i2 = idxArr[t * 3 + 2]! * 3;
    } else {
      i0 = t * 9;
      i1 = t * 9 + 3;
      i2 = t * 9 + 6;
    }
    const ax = posArr[i0]!,     ay = posArr[i0 + 1]!, az = posArr[i0 + 2]!;
    const bx = posArr[i1]!,     by = posArr[i1 + 1]!, bz = posArr[i1 + 2]!;
    const cx = posArr[i2]!,     cy = posArr[i2 + 1]!, cz = posArr[i2 + 2]!;
    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;
    sum += (ax * crossX + ay * crossY + az * crossZ) / 6;
  }
  return Math.abs(sum);
}

/** Pull axis-aligned bbox in world dimensions, computing on a clone so we
 *  never mutate the caller's geometry. Returns zeros for an empty mesh. */
function bboxDims(geometry: THREE.BufferGeometry): { wMm: number; hMm: number; dMm: number } {
  const positions = geometry.attributes.position;
  if (!positions || positions.count === 0) return { wMm: 0, hMm: 0, dMm: 0 };
  const cloned = geometry.clone();
  cloned.computeBoundingBox();
  const b = cloned.boundingBox;
  if (!b) return { wMm: 0, hMm: 0, dMm: 0 };
  return {
    wMm: Math.max(0, b.max.x - b.min.x),
    hMm: Math.max(0, b.max.y - b.min.y),
    dMm: Math.max(0, b.max.z - b.min.z),
  };
}

/** Snap a value into [min,max]. */
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** Map a measured fullness onto a 0..1 closeness against a target band. The
 *  closer to the target the higher the result; outside the band returns 0. */
function bandFit(value: number, target: number, half: number): number {
  const delta = Math.abs(value - target);
  if (delta >= half) return 0;
  return 1 - delta / half;
}

/**
 * Sort the bbox dimensions DESC and remember which world axis each came
 * from. We need the original axis so cylinder/pipe candidates can re-emit
 * height along the right world axis when intentToScad eventually renders.
 */
type AxisLabel = 'x' | 'y' | 'z';
function sortedAxes(bbox: { wMm: number; hMm: number; dMm: number }): Array<{ axis: AxisLabel; mm: number }> {
  const dims: Array<{ axis: AxisLabel; mm: number }> = [
    { axis: 'x', mm: bbox.wMm },
    { axis: 'y', mm: bbox.hMm },
    { axis: 'z', mm: bbox.dMm },
  ];
  dims.sort((a, b) => b.mm - a.mm);
  return dims;
}

/** Round a millimetre dimension so emitted intents are clean (no 49.9876…). */
function r(mm: number): number {
  if (!Number.isFinite(mm)) return 0;
  return Math.round(mm * 100) / 100;
}

/**
 * Build the "box" candidate (rule 1). The fullness and curvature numbers
 * gate the score: a real box hits ~1.0 fullness and ~0.0 curvature. We add
 * one hole feature per detected axis-aligned hole peak so the proposed
 * intent round-trips to a SCAD model with the same drilled features.
 */
function proposeBox(
  stats: ObservedStats,
  detectedHoles: DetectedHole[],
): ProposedIntent | null {
  const { bbox } = stats;
  if (bbox.wMm <= 0 || bbox.hMm <= 0 || bbox.dMm <= 0) return null;

  const axes = sortedAxes(bbox);
  const aspectMax = axes[1]!.mm > 0 ? axes[0]!.mm / axes[1]!.mm : Infinity;
  const aspectMid = axes[2]!.mm > 0 ? axes[1]!.mm / axes[2]!.mm : Infinity;
  const volBox = bbox.wMm * bbox.hMm * bbox.dMm;
  const fullness = volBox > 0 ? stats.volumeMm3 / volBox : 0;
  const curvature = stats.curvedEdgeCount > 0 && stats.sharpEdgeCount + stats.curvedEdgeCount > 0
    ? stats.curvedEdgeCount / (stats.sharpEdgeCount + stats.curvedEdgeCount)
    : 0;

  const evidence: string[] = [];
  const counterEvidence: string[] = [];

  // Hard gate — box wants near-equal aspect ratios and high fullness.
  if (aspectMax > 1.5) counterEvidence.push(`aspectMax=${aspectMax.toFixed(2)} > 1.5`);
  if (aspectMid > 1.5) counterEvidence.push(`aspectMid=${aspectMid.toFixed(2)} > 1.5`);
  if (fullness < 0.85) counterEvidence.push(`fullness=${fullness.toFixed(2)} < 0.85`);
  if (curvature > 0.3) counterEvidence.push(`curvatureFrac=${curvature.toFixed(2)} > 0.3`);

  if (counterEvidence.length > 0) return null;

  evidence.push(`bbox aspect ${aspectMax.toFixed(2)}/${aspectMid.toFixed(2)} ≤ 1.5`);
  evidence.push(`fullness ${fullness.toFixed(2)} ≥ 0.85`);
  evidence.push(`curvature ${curvature.toFixed(2)} ≤ 0.3`);

  // Score blends curvature penalty + fullness penalty (anchored at 100).
  const score = clamp(100 - 20 * (curvature / 0.3) - 10 * (1 - fullness), 0, 100);

  // Hole features — emit one per detected peak. Per the intent emitter
  // convention, axis defaults to 'z'; for x/y peaks we set axis explicitly.
  const features: IntentFeature[] = [];
  for (const h of detectedHoles) {
    const featParams: Record<string, number> = { diameter: r(h.diameter) };
    if (h.axis === 'z') {
      featParams.x = r(h.cx);
      featParams.y = r(h.cy);
    } else if (h.axis === 'x') {
      featParams.y = r(h.cx);
      featParams.z = r(h.cy);
    } else {
      featParams.x = r(h.cx);
      featParams.z = r(h.cy);
    }
    features.push({ type: 'hole', params: featParams });
  }
  if (features.length > 0) {
    evidence.push(`${features.length} hole peak(s) detected`);
  }

  const intent: IntentInput = {
    shapeId: 'box',
    params: { width: r(bbox.wMm), height: r(bbox.hMm), depth: r(bbox.dMm) },
    features,
  };
  return {
    intent,
    confidence: score,
    summary: `box ${r(bbox.wMm)} × ${r(bbox.hMm)} × ${r(bbox.dMm)} mm${features.length > 0 ? ` with ${features.length} hole(s)` : ''}`,
    evidence,
    counterEvidence,
  };
}

/**
 * Sphere candidate (rule 2). All three axes within 5% AND high curvature
 * AND fullness near π/6 (the volume-to-bbox ratio of a sphere).
 */
function proposeSphere(stats: ObservedStats): ProposedIntent | null {
  const { bbox } = stats;
  if (bbox.wMm <= 0) return null;
  const meanDim = (bbox.wMm + bbox.hMm + bbox.dMm) / 3;
  const maxDelta = Math.max(
    Math.abs(bbox.wMm - meanDim),
    Math.abs(bbox.hMm - meanDim),
    Math.abs(bbox.dMm - meanDim),
  );
  const equality = meanDim > 0 ? maxDelta / meanDim : Infinity;
  const totalCurvable = stats.curvedEdgeCount + stats.sharpEdgeCount;
  const curvature = totalCurvable > 0 ? stats.curvedEdgeCount / totalCurvable : 0;
  const volBox = bbox.wMm * bbox.hMm * bbox.dMm;
  const fullness = volBox > 0 ? stats.volumeMm3 / volBox : 0;
  const targetFullness = Math.PI / 6; // ≈ 0.5236

  const evidence: string[] = [];
  const counterEvidence: string[] = [];
  if (equality > 0.05) counterEvidence.push(`axis equality off by ${(equality * 100).toFixed(1)}%`);
  if (curvature < 0.95) counterEvidence.push(`curvature ${curvature.toFixed(2)} < 0.95`);
  const fullnessFit = bandFit(fullness, targetFullness, 0.05);
  if (fullnessFit === 0) counterEvidence.push(`fullness ${fullness.toFixed(3)} far from π/6 (${targetFullness.toFixed(3)})`);

  if (counterEvidence.length > 0) return null;

  evidence.push('all 3 axes equal within 5%');
  evidence.push(`curvature ${curvature.toFixed(2)} ≥ 0.95`);
  evidence.push(`fullness ${fullness.toFixed(3)} ≈ π/6`);
  const score = clamp(70 + 30 * fullnessFit, 0, 100);
  const intent: IntentInput = {
    shapeId: 'sphere',
    params: { diameter: r(meanDim) },
    features: [],
  };
  return {
    intent,
    confidence: score,
    summary: `sphere Ø${r(meanDim)} mm`,
    evidence,
    counterEvidence,
  };
}

/**
 * Cylinder / pipe / disk / washer family (rules 3 + 4).
 * Two axes near-equal (the circular cross-section), the third is the
 * height. Fullness near π/4 (= 0.7854) is the cylinder signature.
 *
 * Sub-rules:
 *   - genus = 1 (torus topology) → pipe / washer variant
 *   - height < 0.2 × diameter   → disk / washer variant
 */
function proposeCylinderFamily(stats: ObservedStats): ProposedIntent[] {
  const { bbox } = stats;
  if (bbox.wMm <= 0 || bbox.hMm <= 0 || bbox.dMm <= 0) return [];

  const axes = sortedAxes(bbox);
  // Find the two near-equal axes and treat the OUTLIER as the height.
  // Cylinder may be oriented along any world axis; we search all 3 pairings.
  const pairings: Array<{ height: number; diameter: number }> = [
    { height: bbox.wMm, diameter: (bbox.hMm + bbox.dMm) / 2 },
    { height: bbox.hMm, diameter: (bbox.wMm + bbox.dMm) / 2 },
    { height: bbox.dMm, diameter: (bbox.wMm + bbox.hMm) / 2 },
  ];
  // Pick whichever pairing has the smallest in-pair spread (the two non-height
  // dims should be within 15% of each other for cylinder/disk).
  const pairSpread = [
    Math.abs(bbox.hMm - bbox.dMm),
    Math.abs(bbox.wMm - bbox.dMm),
    Math.abs(bbox.wMm - bbox.hMm),
  ];
  let bestIdx = 0;
  for (let i = 1; i < 3; i++) {
    if (pairSpread[i]! < pairSpread[bestIdx]!) bestIdx = i;
  }
  const { height, diameter } = pairings[bestIdx]!;
  if (height <= 0 || diameter <= 0) return [];
  const inPairRatio = diameter > 0 ? pairSpread[bestIdx]! / diameter : Infinity;
  if (inPairRatio > 0.15) return []; // two "equal" axes are not equal enough

  const volBox = bbox.wMm * bbox.hMm * bbox.dMm;
  const fullness = volBox > 0 ? stats.volumeMm3 / volBox : 0;
  const totalCurvable = stats.curvedEdgeCount + stats.sharpEdgeCount;
  // Cylinder curvature threshold: tessellated cylinders end up with sharpEdgeCount
  // ≈ 2 × radialSegments (end-cap rims) and curvedEdgeCount ≈ radialSegments
  // (between adjacent wall quads). Ratio of curved-to-total bottoms out around
  // 0.33 for a 64-segment cylinder. We accept ≥ 0.25 so finely tessellated
  // cylinders aren't rejected by the rule that's supposed to catch them.
  const curvature = totalCurvable > 0 ? stats.curvedEdgeCount / totalCurvable : 0;
  // A torus has fullness near 0.45 (annular cross-section), while a solid cylinder
  // sits near π/4 ≈ 0.785. We accept both via a wider band when genus = 1.
  const isHollow = stats.genus === 1;
  if (curvature < 0.25 && !isHollow) return []; // not enough curved edges
  const targetFullness = Math.PI / 4; // ≈ 0.7854
  // Wide band so disks (whose facet count slightly under-counts volume) and
  // hollow toroidal shapes (lower fullness) still register.
  const fullnessFit = isHollow
    ? Math.max(bandFit(fullness, 0.5, 0.3), bandFit(fullness, targetFullness, 0.12))
    : bandFit(fullness, targetFullness, 0.12);
  if (fullnessFit === 0) return [];

  const isThin = height < 0.2 * Math.max(diameter, axes[0]!.mm);

  const evidence: string[] = [
    `two axes equal within ${(inPairRatio * 100).toFixed(1)}%`,
    `curvature ${curvature.toFixed(2)} ≥ 0.25`,
    `fullness ${fullness.toFixed(3)} ≈ ${isHollow ? '0.45 (annular)' : 'π/4'}`,
  ];

  const baseScore = clamp(60 + 40 * fullnessFit, 0, 100);
  const candidates: ProposedIntent[] = [];

  if (isHollow && !isThin) {
    // Pipe — outer diameter from bbox, inner diameter estimated from the
    // "missing" volume between a solid cylinder and the measured.
    const solidVol = Math.PI * (diameter / 2) ** 2 * height;
    const missing = Math.max(0, solidVol - stats.volumeMm3);
    const innerRadiusSq = missing / (Math.PI * height);
    const innerDiameter = innerRadiusSq > 0 ? 2 * Math.sqrt(innerRadiusSq) : diameter * 0.5;
    const safeInner = clamp(innerDiameter, 0.1 * diameter, 0.95 * diameter);
    candidates.push({
      intent: {
        shapeId: 'pipe',
        params: {
          outerDiameter: r(diameter),
          innerDiameter: r(safeInner),
          length: r(height),
        },
        features: [],
      },
      confidence: baseScore,
      summary: `pipe Ø${r(diameter)} / Ø${r(safeInner)} mm × ${r(height)} mm`,
      evidence: [...evidence, 'genus = 1 → hollow body'],
      counterEvidence: [],
    });
  } else if (isThin && isHollow) {
    // Washer — thin disk with a through hole.
    const solidVol = Math.PI * (diameter / 2) ** 2 * height;
    const missing = Math.max(0, solidVol - stats.volumeMm3);
    const innerRadiusSq = missing / (Math.PI * height);
    const innerDiameter = innerRadiusSq > 0 ? 2 * Math.sqrt(innerRadiusSq) : diameter * 0.4;
    const safeInner = clamp(innerDiameter, 0.1 * diameter, 0.9 * diameter);
    candidates.push({
      intent: {
        shapeId: 'washer',
        params: {
          outerDiameter: r(diameter),
          innerDiameter: r(safeInner),
          thickness: r(height),
        },
        features: [],
      },
      confidence: baseScore - 5,
      summary: `washer Ø${r(diameter)} / Ø${r(safeInner)} mm × ${r(height)} mm`,
      evidence: [...evidence, `thin (h ${r(height)} < 0.2 × Ø ${r(diameter)})`, 'genus = 1 → hollow'],
      counterEvidence: [],
    });
  } else if (isThin) {
    // Disk — thin solid cylinder.
    candidates.push({
      intent: {
        shapeId: 'disk',
        params: { diameter: r(diameter), thickness: r(height) },
        features: [],
      },
      confidence: baseScore,
      summary: `disk Ø${r(diameter)} mm × ${r(height)} mm`,
      evidence: [...evidence, `thin (h ${r(height)} < 0.2 × Ø ${r(diameter)})`],
      counterEvidence: [],
    });
  } else {
    // Solid cylinder.
    candidates.push({
      intent: {
        shapeId: 'cylinder',
        params: { diameter: r(diameter), height: r(height) },
        features: [],
      },
      confidence: baseScore,
      summary: `cylinder Ø${r(diameter)} mm × ${r(height)} mm`,
      evidence,
      counterEvidence: [],
    });
  }

  return candidates;
}

/**
 * Rule 5 — fillet / chamfer secondary feature. Independent of the host
 * shape. We bias toward chamfer when chamferEdgeCount dominates curved;
 * otherwise fillet wins. Radius / distance defaults derived from
 * minWallMm × 0.5 (clamped to a sensible range).
 */
function fillet_or_chamfer_feature(stats: ObservedStats): IntentFeature | null {
  // A part with intentional rounding has very few sharp 90° edges. We trip
  // the rule only when sharp == 0 (clean rounded part) and there ARE
  // curved/chamfer dihedrals to learn from.
  if (stats.sharpEdgeCount > 0) return null;
  if (stats.curvedEdgeCount === 0 && stats.chamferEdgeCount === 0) return null;
  const wall = stats.minWallMm;
  const radius = wall && wall > 0 ? clamp(wall * 0.5, 0.5, 5) : 1.0;
  if (stats.chamferEdgeCount > stats.curvedEdgeCount) {
    return { type: 'chamfer', params: { distance: r(radius) } };
  }
  return { type: 'fillet', params: { radius: r(radius) } };
}

/**
 * Rule 0 — multi-body short-circuit.
 *
 * v1 doesn't try to decompose assemblies; it just flags the situation
 * and returns a low-confidence placeholder so the user sees what we saw.
 */
function multiBodyCandidate(stats: ObservedStats): ProposedIntent {
  return {
    intent: {
      shapeId: 'box',
      params: { width: r(stats.bbox.wMm), height: r(stats.bbox.hMm), depth: r(stats.bbox.dMm) },
      features: [],
    },
    confidence: 15,
    summary: `assembly with ${stats.componentCount} bodies (RE not supported for multi-body in v1)`,
    evidence: [`componentCount = ${stats.componentCount}`],
    counterEvidence: ['multi-body reverse-engineering is an X-track follow-up'],
  };
}

/**
 * Rule 6 — fallback. Always returns SOMETHING (a bbox-fitted box) so the
 * UI has an entry to display even when no rule scored ≥ 30.
 */
function fallbackBoxCandidate(stats: ObservedStats): ProposedIntent {
  return {
    intent: {
      shapeId: 'box',
      params: { width: r(stats.bbox.wMm), height: r(stats.bbox.hMm), depth: r(stats.bbox.dMm) },
      features: [],
    },
    confidence: 10,
    summary: `bbox-fitted box ${r(stats.bbox.wMm)} × ${r(stats.bbox.hMm)} × ${r(stats.bbox.dMm)} mm (no rule matched)`,
    evidence: ['fallback: shape did not match any v1 classifier rule'],
    counterEvidence: [],
  };
}

/**
 * Main entry — classify a mesh and return up to 3 candidate intents.
 */
export function reverseEngineerFromGeometry(input: ReverseEngineerInput): ReverseEngineerResult {
  const geometry = input.geometry;
  const positions = geometry.attributes.position;
  // Defensive: empty geometry returns no candidates so callers can show
  // a "couldn't parse" message rather than acting on zero-volume box.
  if (!positions || positions.count === 0) {
    return {
      candidates: [],
      observedStats: {
        bbox: { wMm: 0, hMm: 0, dMm: 0 },
        volumeMm3: 0,
        surfaceAreaMm2: 0,
        genus: null,
        componentCount: 0,
        holeCount: 0,
        sharpEdgeCount: 0,
        chamferEdgeCount: 0,
        curvedEdgeCount: 0,
        minWallMm: null,
      },
    };
  }

  // Stats — same helpers verify_spec uses. computeMinWallThickness is async;
  // we skip it in this sync helper to keep the surface synchronous (caller
  // can decorate observedStats with wall thickness if they need it).
  const topology = computeMeshTopology(geometry);
  const surfaceAreaMm2 = computeSurfaceArea(geometry);
  const dihedral = computeDihedralStats(geometry);
  const volumeMm3 = meshVolumeMm3(geometry);
  const bbox = bboxDims(geometry);
  const detectedHoles = detectAllAxisAlignedHoles(geometry);

  const observedStats: ObservedStats = {
    bbox,
    volumeMm3,
    surfaceAreaMm2,
    genus: topology.totalGenus,
    componentCount: topology.componentCount,
    holeCount: detectedHoles.length,
    sharpEdgeCount: dihedral.sharpEdgeCount,
    chamferEdgeCount: dihedral.chamferEdgeCount,
    curvedEdgeCount: dihedral.curvedEdgeCount,
    minWallMm: null, // sync path skips wall sampling — too slow for inline use
  };

  // Rule 0 — multi-body short-circuit.
  if (topology.componentCount > 1) {
    return { candidates: [multiBodyCandidate(observedStats)], observedStats };
  }

  const candidates: ProposedIntent[] = [];

  // Rule 1 — box.
  const box = proposeBox(observedStats, detectedHoles);
  if (box) candidates.push(box);

  // Rule 2 — sphere.
  const sphere = proposeSphere(observedStats);
  if (sphere) candidates.push(sphere);

  // Rules 3 + 4 — cylinder / pipe / disk / washer family.
  for (const c of proposeCylinderFamily(observedStats)) {
    candidates.push(c);
  }

  // Rule 5 — fillet/chamfer secondary feature. Apply to the highest-scoring
  // host candidate so the proposed intent reflects rounded corners.
  const filletFeature = fillet_or_chamfer_feature(observedStats);
  if (filletFeature && candidates.length > 0) {
    // Sort first so we can attach to the leader.
    candidates.sort((a, b) => b.confidence - a.confidence);
    const leader = candidates[0]!;
    const features = leader.intent.features ? [...leader.intent.features, filletFeature] : [filletFeature];
    candidates[0] = {
      ...leader,
      intent: { ...leader.intent, features },
      evidence: [...leader.evidence, `sharpEdgeCount=0 + ${filletFeature.type}EdgeCount>0 → ${filletFeature.type}`],
    };
  }

  // Rule 6 — fallback. Guarantees at least one candidate.
  const filtered = candidates.filter(c => c.confidence >= 30);
  const finalList = filtered.length > 0 ? filtered : [...candidates, fallbackBoxCandidate(observedStats)];

  // Sort DESC by confidence; cap top 3.
  finalList.sort((a, b) => b.confidence - a.confidence);
  return { candidates: finalList.slice(0, 3), observedStats };
}

/**
 * Async sibling that adds the min-wall-thickness probe to observedStats.
 * Use from server contexts where the extra raycast cost is acceptable
 * (verify-spec / route handler). The candidate list itself isn't affected
 * by minWallMm in v1 — it just lights up the diagnostics block.
 */
export async function reverseEngineerWithWallThickness(
  input: ReverseEngineerInput,
): Promise<ReverseEngineerResult> {
  const sync = reverseEngineerFromGeometry(input);
  if (sync.candidates.length === 0) return sync;
  try {
    const wall = await computeMinWallThickness(input.geometry, {
      maxSamples: input.maxWallSamples,
    });
    const minWall = wall.minMm === Infinity ? null : wall.minMm;
    return {
      ...sync,
      observedStats: { ...sync.observedStats, minWallMm: minWall },
    };
  } catch {
    return sync;
  }
}

/**
 * Human-readable formatter the agent tool's `output` returns. The agent
 * reads this back as plain text — the candidates also ride in `meta` so
 * downstream callers can act on the structured form.
 */
export function formatProposedIntents(result: ReverseEngineerResult): string {
  const lines: string[] = [];
  const s = result.observedStats;
  lines.push(
    `Observed: bbox ${r(s.bbox.wMm)}×${r(s.bbox.hMm)}×${r(s.bbox.dMm)} mm, `
      + `volume ${s.volumeMm3.toFixed(0)} mm³, surface ${s.surfaceAreaMm2.toFixed(0)} mm², `
      + `genus ${s.genus ?? '?'} / bodies ${s.componentCount}, `
      + `holes ${s.holeCount}, sharp/curved/chamfer edges ${s.sharpEdgeCount}/${s.curvedEdgeCount}/${s.chamferEdgeCount}`
      + (s.minWallMm !== null ? `, min wall ${s.minWallMm.toFixed(2)} mm` : ''),
  );
  if (result.candidates.length === 0) {
    lines.push('No candidate could be proposed — mesh is empty or unreadable.');
    return lines.join('\n');
  }
  lines.push('');
  lines.push(`Top ${result.candidates.length} candidate(s):`);
  for (let i = 0; i < result.candidates.length; i++) {
    const c = result.candidates[i]!;
    lines.push(`  ${i + 1}. ${c.summary} — confidence ${c.confidence.toFixed(0)}%`);
    if (c.evidence.length > 0) {
      lines.push(`     + ${c.evidence.slice(0, 2).join('; ')}`);
    }
  }
  return lines.join('\n');
}
