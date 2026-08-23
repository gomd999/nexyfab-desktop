export type ManufacturingHandoffGateStatus = 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN';

export interface ManufacturingHandoffReadinessInput {
  revisionId: string;
  solver: ManufacturingHandoffGateStatus;
  featureTrees: ManufacturingHandoffGateStatus;
  exactStep: ManufacturingHandoffGateStatus;
  drawing: ManufacturingHandoffGateStatus;
  bom: ManufacturingHandoffGateStatus;
  gdtPmi: ManufacturingHandoffGateStatus;
  releaseDecision: ManufacturingHandoffGateStatus;
}

export interface ManufacturingHandoffReadiness {
  revisionId: string;
  status: 'PASS' | 'BLOCKED';
  blockers: string[];
}

/**
 * Dependency-free revision gate for the drawing shell. The full
 * manufacturing package imports Three.js, STL and ZIP writers, which must
 * not enter the route's initial bundle just to render a readiness label.
 */
export function assessManufacturingHandoffReadiness(
  input: ManufacturingHandoffReadinessInput,
): ManufacturingHandoffReadiness {
  const requirements: ReadonlyArray<[
    keyof Omit<ManufacturingHandoffReadinessInput, 'revisionId'>,
    string,
  ]> = [
    ['solver', 'exact-assembly-solve-not-passed'],
    ['featureTrees', 'editable-feature-trees-not-passed'],
    ['exactStep', 'exact-brep-step-not-passed'],
    ['drawing', 'revision-bound-drawing-not-passed'],
    ['bom', 'revision-bound-bom-not-passed'],
    ['gdtPmi', 'gdt-pmi-not-verified'],
    ['releaseDecision', 'manufacturing-release-decision-not-passed'],
  ];
  const blockers = requirements
    .filter(([field]) => input[field] !== 'PASS')
    .map(([, blocker]) => blocker);
  return {
    revisionId: input.revisionId,
    status: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    blockers,
  };
}
