import type { CadFailureCode } from './cadFailureTaxonomy';

export interface CadHealingMeasurement {
  valid: boolean;
  solidCount: number;
  absoluteVolume: number;
  faceCount: number;
  edgeCount: number;
  maxTolerance: number;
  minEdgeLength: number;
}

export interface CadHealingPolicyInput {
  before: CadHealingMeasurement;
  after: CadHealingMeasurement;
  workingTolerance: number;
  sewingTolerance?: number;
  maxRelativeVolumeChange?: number;
}

export interface CadHealingDecision {
  accepted: boolean;
  classification: 'original-valid' | 'recovered' | 'rejected';
  failureCodes: CadFailureCode[];
  checks: Array<{ id: string; passed: boolean; measured: number | boolean; limit?: number }>;
}

/** Approval policy only; the healing adapter must supply exact before/after kernel measurements. */
export function evaluateCadHealing(input: CadHealingPolicyInput): CadHealingDecision {
  const maxRelativeVolumeChange = input.maxRelativeVolumeChange ?? 0.0001;
  const denominator = Math.max(Math.abs(input.before.absoluteVolume), Number.EPSILON);
  const relativeVolumeChange = Math.abs(input.after.absoluteVolume - input.before.absoluteVolume) / denominator;
  const checks = [
    { id: 'after-valid', passed: input.after.valid, measured: input.after.valid },
    { id: 'after-solid', passed: input.after.solidCount > 0, measured: input.after.solidCount, limit: 1 },
    { id: 'volume-change', passed: Number.isFinite(relativeVolumeChange) && relativeVolumeChange <= maxRelativeVolumeChange, measured: relativeVolumeChange, limit: maxRelativeVolumeChange },
    { id: 'max-tolerance', passed: input.after.maxTolerance <= input.workingTolerance * 10, measured: input.after.maxTolerance, limit: input.workingTolerance * 10 },
    { id: 'sewing-vs-min-edge', passed: input.sewingTolerance === undefined || input.sewingTolerance < input.before.minEdgeLength, measured: input.sewingTolerance ?? 0, limit: input.before.minEdgeLength },
    { id: 'finite-topology', passed: [input.after.faceCount, input.after.edgeCount, input.after.minEdgeLength].every(Number.isFinite), measured: Number.isFinite(input.after.faceCount) && Number.isFinite(input.after.edgeCount) && Number.isFinite(input.after.minEdgeLength) },
  ];
  const accepted = checks.every(check => check.passed);
  const classification = accepted ? input.before.valid && input.before.solidCount > 0 ? 'original-valid' : 'recovered' : 'rejected';
  return { accepted, classification, failureCodes: accepted ? [] : ['HEALING_EXCEEDED_TOLERANCE'], checks };
}
