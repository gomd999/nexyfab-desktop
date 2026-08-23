/**
 * Precision CAD capability boundary for the first single-part slice.
 *
 * The implementation remains in the legacy library until the OCCT runtime is
 * moved behind a worker. Keeping this adapter stable lets the script and the
 * future job worker share the same fail-closed source contract.
 */
export {
  MECHANICAL_SINGLE_PART_CANDIDATE_RECEIPT_SCHEMA,
  MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA,
  MECHANICAL_SINGLE_PART_REQUIRED_AXES,
  evaluateMechanicalSinglePartSourceRuns,
  mechanicalSinglePartDimensionsMm,
} from '../../../src/lib/cad/mechanicalSinglePartCandidate';

export type {
  MechanicalSinglePartAxis,
  MechanicalSinglePartSourceRun,
  MechanicalSinglePartSourceVerdict,
} from '../../../src/lib/cad/mechanicalSinglePartCandidate';
