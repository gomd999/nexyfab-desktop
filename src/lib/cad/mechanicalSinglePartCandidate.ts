/**
 * Legacy import adapter. The isolated capability owns the versioned runtime
 * contract; existing CAD callers keep this path until integration moves the
 * contract into a shared package.
 */
export {
  MECHANICAL_SINGLE_PART_CANDIDATE_RECEIPT_SCHEMA,
  MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA,
  MECHANICAL_SINGLE_PART_REQUIRED_AXES,
  evaluateMechanicalSinglePartSourceRuns,
  mechanicalSinglePartDimensionsMm,
} from '../../../capabilities/precision-cad/single-part-candidate/src/contract.mjs';

export type {
  MechanicalSinglePartAxis,
  MechanicalSinglePartSourceRun,
  MechanicalSinglePartSourceVerdict,
} from '../../../capabilities/precision-cad/single-part-candidate/src/contract.mjs';
