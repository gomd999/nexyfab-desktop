import type { CadFailureCode } from '@/lib/reference/cadFailureTaxonomy';
import { isRuntimeIssuedRepairScopeVerification, type RepairScopeVerification } from './repairScopeVerification';

export type ProductComplexityClass = 'standard' | 'complex' | 'very_complex';

export interface ComplexProductEvidence {
  definitions: number;
  instances: number;
  maxAssemblyDepth: number;
  interfacesRequired: number;
  interfacesVerified: number;
  exactPartsVerified: number;
  expectedStepOccurrences: number;
  measuredStepOccurrences: number;
  movingInstances: number;
  repairIsolation?: {
    applicable: boolean;
    failedPartIds: string[];
    regeneratedPartIds: string[];
    preservedVerifiedPartIds: string[];
    upstreamIntentChanged: boolean;
    /** Must be the in-process result returned by verifyRepairScope, never a client boolean. */
    verification?: RepairScopeVerification;
  };
}

export interface ComplexProductGate {
  id: 'decomposition' | 'part-evidence' | 'interfaces' | 'assembly-depth' | 'step-occurrences' | 'repair-isolation';
  passed: boolean;
  reason: string;
  failureCode: CadFailureCode;
}

export interface ComplexProductAssessment {
  complexity: ProductComplexityClass;
  releaseReady: boolean;
  gates: ComplexProductGate[];
}

const whole = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function classifyProductComplexity(input: Pick<ComplexProductEvidence, 'definitions' | 'instances' | 'maxAssemblyDepth' | 'interfacesRequired' | 'movingInstances'>): ProductComplexityClass {
  if (input.instances >= 100 || input.definitions >= 40 || input.maxAssemblyDepth >= 5 || input.interfacesRequired >= 100 || input.movingInstances >= 20) return 'very_complex';
  if (input.instances >= 10 || input.definitions >= 8 || input.maxAssemblyDepth >= 3 || input.interfacesRequired >= 12 || input.movingInstances >= 3) return 'complex';
  return 'standard';
}

/** Fail-closed evidence gate for deep assemblies and complex products. */
export function assessComplexProductAccuracy(input: ComplexProductEvidence): ComplexProductAssessment {
  const numeric = [input.definitions, input.instances, input.maxAssemblyDepth, input.interfacesRequired, input.interfacesVerified,
    input.exactPartsVerified, input.expectedStepOccurrences, input.measuredStepOccurrences, input.movingInstances];
  if (!numeric.every(whole)) throw new TypeError('Complex-product counts must be non-negative safe integers.');
  const complexity = classifyProductComplexity(input);
  const gates: ComplexProductGate[] = [];
  const add = (id: ComplexProductGate['id'], passed: boolean, reason: string, failureCode: CadFailureCode) => gates.push({ id, passed, reason, failureCode });

  add('decomposition', input.definitions > 0 && input.instances >= input.definitions,
    'Every component definition must have at least one independent occurrence.', 'SEMANTIC_MAPPING_UNAVAILABLE');
  add('part-evidence', input.exactPartsVerified === input.definitions,
    `Exact per-definition B-rep evidence ${input.exactPartsVerified}/${input.definitions}.`, 'GEOMETRY_INCOMPLETE');
  add('interfaces', input.interfacesVerified === input.interfacesRequired,
    `Verified interfaces ${input.interfacesVerified}/${input.interfacesRequired}.`, 'GEOMETRY_INCOMPLETE');
  add('assembly-depth', complexity === 'standard' || input.maxAssemblyDepth >= 2,
    complexity === 'standard' ? 'Nested hierarchy is not required for a standard product.' : `Complex product preserves assembly depth ${input.maxAssemblyDepth}.`, 'SEMANTIC_MAPPING_UNAVAILABLE');
  add('step-occurrences', input.measuredStepOccurrences === input.expectedStepOccurrences && input.expectedStepOccurrences === input.instances,
    `STEP occurrences ${input.measuredStepOccurrences}/${input.expectedStepOccurrences}; expected instances ${input.instances}.`, 'MISSING_TRANSFORM');

  const repair = input.repairIsolation;
  const repairPassed = !repair?.applicable || (!repair.upstreamIntentChanged
    && isRuntimeIssuedRepairScopeVerification(repair.verification)
    && repair.verification.passed
    && sameIds(repair.verification.permittedPartIds, repair.failedPartIds)
    && sameIds(repair.verification.changedPartIds, repair.regeneratedPartIds)
    && new Set(repair.failedPartIds).size === repair.failedPartIds.length
    && new Set(repair.regeneratedPartIds).size === repair.regeneratedPartIds.length
    && repair.regeneratedPartIds.length === repair.failedPartIds.length
    && repair.regeneratedPartIds.every(id => repair.failedPartIds.includes(id))
    && repair.preservedVerifiedPartIds.every(id => !repair.regeneratedPartIds.includes(id)));
  add('repair-isolation', repairPassed,
    repairPassed ? 'Repair is absent or limited to failed parts while verified parts remain preserved.' : 'Repair regenerated unrelated verified geometry or changed upstream intent.', 'GEOMETRY_INCOMPLETE');
  return { complexity, gates, releaseReady: gates.every(gate => gate.passed) };
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().every((id, index) => id === [...b].sort()[index]);
}
