/**
 * Ω2 — ML auto-mesh interface (heuristic V1).
 *
 * FEA accuracy depends heavily on mesh quality + element size. Picking
 * those by hand is a common pain point — too coarse → wrong stress, too
 * fine → solver timeout. This module proposes element sizing + refinement
 * zones from the geometry's bbox and feature density, optimized for the
 * caller's accuracy/speed trade-off.
 *
 * Heuristic V1 — no actual ML, just engineering rules of thumb derived
 * from gmsh's auto-sizing defaults + Shigley §6 stress-concentration
 * spacing. Real ML model (trained on solver convergence vs mesh size)
 * is the V2 target — this interface is shaped so the model can drop in
 * without changing callers.
 */

export interface AutoMeshInput {
  /** Bounding box of the part in mm. */
  bboxMm: { w: number; h: number; d: number };
  /** Approximate face count from the B-rep. Higher → finer base size. */
  faceCount: number;
  /** Smallest local feature dimension (hole diameter, fillet radius, etc.). */
  minFeatureMm?: number;
  /** Trade-off goal: 'accuracy' biases finer; 'speed' biases coarser. */
  goal: 'accuracy' | 'balanced' | 'speed';
  /** Optional FEA element type — affects expected count multiplier. */
  elementType?: 'tet4' | 'tet10' | 'hex8' | 'hex20';
}

export interface RefinementZone {
  /** Human-readable reason for refinement. */
  reason: string;
  /** Suggested local element size (mm). */
  sizeMm: number;
  /** Approximate location (mm), or 'global' for the whole-part default. */
  location: [number, number, number] | 'global';
}

export interface AutoMeshOutput {
  /** Base element size for non-refined regions. */
  baseSizeMm: number;
  /** Refinement zones (e.g. small features, stress concentrators). */
  refinement: RefinementZone[];
  /** Expected element count given the base size + refinement. */
  expectedElements: number;
  /** Estimated solve time in seconds (rough; assumes CPU CalculiX). */
  estimatedSolveTimeS: number;
  /** 0..1 quality estimate based on size vs feature ratio. */
  qualityScore: number;
  notes: string;
}

const ELEMENT_COUNT_MULTIPLIER: Record<NonNullable<AutoMeshInput['elementType']>, number> = {
  tet4: 1.0,    // baseline
  tet10: 1.0,   // same count, more DOFs per element
  hex8: 0.6,    // structured = fewer elements for same volume
  hex20: 0.6,
};

const ELEMENT_SOLVE_FACTOR_PER_KILO: Record<NonNullable<AutoMeshInput['elementType']>, number> = {
  tet4: 0.05,   // s per 1000 elements (very rough, CPU CalculiX)
  tet10: 0.20,  // 4x slower (more DOFs)
  hex8: 0.04,
  hex20: 0.18,
};

export function autoMesh(input: AutoMeshInput): AutoMeshOutput {
  const elemType = input.elementType ?? 'tet4';
  const goalFactor = input.goal === 'accuracy' ? 0.6
                   : input.goal === 'speed' ? 1.6
                   : 1.0;  // balanced

  // Heuristic base size: ~min bbox dimension / 30, scaled by goal.
  const minDim = Math.min(input.bboxMm.w, input.bboxMm.h, input.bboxMm.d);
  let baseSizeMm = (minDim / 30) * goalFactor;

  // Refine if the part has many faces (feature dense) or has a small feature.
  if (input.faceCount > 100) baseSizeMm *= 0.7;
  if (input.faceCount > 500) baseSizeMm *= 0.7;

  baseSizeMm = Math.max(0.1, Math.min(50, baseSizeMm));  // sane bounds

  const refinement: RefinementZone[] = [{
    reason: 'global default',
    sizeMm: baseSizeMm,
    location: 'global',
  }];

  if (input.minFeatureMm && input.minFeatureMm > 0) {
    // Local refinement near smallest features: at least 4 elements across
    // the feature for accurate stress capture (Shigley rule of thumb).
    const featureSize = Math.min(baseSizeMm, input.minFeatureMm / 4);
    if (featureSize < baseSizeMm * 0.8) {
      refinement.push({
        reason: `min feature ${input.minFeatureMm}mm needs ≥4 elements across`,
        sizeMm: featureSize,
        location: 'global',  // host doesn't know exact feature location yet
      });
    }
  }

  // Element count: volume / (size³) × type multiplier
  const volumeMm3 = input.bboxMm.w * input.bboxMm.h * input.bboxMm.d;
  const expectedElements = Math.round(
    (volumeMm3 / (baseSizeMm ** 3)) * ELEMENT_COUNT_MULTIPLIER[elemType]
  );

  const estimatedSolveTimeS = (expectedElements / 1000) * ELEMENT_SOLVE_FACTOR_PER_KILO[elemType];

  // Quality: ratio of base size to min feature, clamped 0-1.
  // 1 ≈ "comfortably fine"; 0 ≈ "way too coarse for this feature".
  let qualityScore = 1.0;
  if (input.minFeatureMm) {
    const elementsAcrossFeature = input.minFeatureMm / baseSizeMm;
    qualityScore = Math.max(0, Math.min(1, elementsAcrossFeature / 8));
  }

  const notesParts: string[] = [];
  if (qualityScore < 0.4) notesParts.push('quality flag: too coarse for the smallest feature; expect stress underestimate.');
  if (estimatedSolveTimeS > 300) notesParts.push(`solve estimate ${(estimatedSolveTimeS / 60).toFixed(1)}min — consider 'speed' goal or smaller domain.`);
  if (notesParts.length === 0) notesParts.push('heuristic mesh sizing OK (gmsh-style defaults).');

  return {
    baseSizeMm,
    refinement,
    expectedElements,
    estimatedSolveTimeS,
    qualityScore,
    notes: notesParts.join(' '),
  };
}
