export const MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA: 'nexyfab.mechanical-single-part-candidate.v1';
export const MECHANICAL_SINGLE_PART_CANDIDATE_RECEIPT_SCHEMA: 'nexyfab.mechanical-single-part-candidate-receipt.v1';
export const MECHANICAL_SINGLE_PART_REQUIRED_AXES: readonly ['create', 'edit', 'regenerate', 'save_reopen', 'undo', 'export', 'drawing'];

export type MechanicalSinglePartAxis = (typeof MECHANICAL_SINGLE_PART_REQUIRED_AXES)[number];

export interface MechanicalSinglePartSourceRun {
  feature: string;
  axis: string;
  status: 'PASS' | 'FAIL' | 'NOT_RUN' | string;
}

export interface MechanicalSinglePartSourceVerdict {
  eligible: boolean;
  reasons: string[];
}

export function evaluateMechanicalSinglePartSourceRuns(
  feature: string,
  runs: readonly MechanicalSinglePartSourceRun[],
): MechanicalSinglePartSourceVerdict;

export function mechanicalSinglePartDimensionsMm(
  boundsMm: readonly [readonly [number, number, number], readonly [number, number, number]],
): { x: number; y: number; z: number };
