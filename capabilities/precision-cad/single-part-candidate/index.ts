/**
 * Precision CAD capability boundary for the first single-part slice.
 *
 * The fail-closed source contract is executable from this isolated slice. The
 * expensive OCCT inspector remains in the legacy runtime until it is moved
 * behind the Exact CAD and Job Control boundary.
 */
export {
  MECHANICAL_SINGLE_PART_CANDIDATE_RECEIPT_SCHEMA,
  MECHANICAL_SINGLE_PART_CANDIDATE_SCHEMA,
  MECHANICAL_SINGLE_PART_REQUIRED_AXES,
  evaluateMechanicalSinglePartSourceRuns,
  mechanicalSinglePartDimensionsMm,
} from './src/contract.mjs';

export type {
  MechanicalSinglePartAxis,
  MechanicalSinglePartSourceRun,
  MechanicalSinglePartSourceVerdict,
} from '../../../src/lib/cad/mechanicalSinglePartCandidate';
