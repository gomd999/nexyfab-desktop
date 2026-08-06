export type PartGateStatus = 'pass' | 'fail' | 'not_run';
export type PartReleaseTarget = 'preview' | 'manufacturing';
export type PartArtifactClass = 'mesh_preview' | 'mesh_manufacturing' | 'faceted_brep' | 'analytic_brep' | 'native_parametric';

export type PartIntent =
  | 'machined_prismatic'
  | 'turned'
  | 'sheet_metal'
  | 'pressure_boundary'
  | 'turbomachinery_blade'
  | 'structural_member'
  | 'architectural_component'
  | 'general';

export interface PartDimensionRequirement {
  id: string;
  expected: number;
  tolerance: number;
  unit: 'mm' | 'deg' | 'count';
}

export interface PartFeatureRequirement {
  id: string;
  kind: string;
  expectedCount: number;
}

export interface PartGenerationIntent {
  partId: string;
  intent: PartIntent;
  bodyPolicy: 'single_body' | 'multi_body';
  expectedBodies: number | null;
  dimensions: PartDimensionRequirement[];
  features: PartFeatureRequirement[];
  /** Defaults to manufacturing; preview must be explicitly requested. */
  releaseTarget?: PartReleaseTarget;
}

export interface PartKernelEvidence {
  available: boolean;
  valid: boolean | null;
  source: 'native_brep' | 'native_mesh' | 'analytic_kernel';
  artifactClass?: PartArtifactClass;
  artifactHash: string;
}

export interface PartTopologyEvidence {
  solidCount: number;
  watertight: boolean;
  nonManifoldEdges: number;
  degenerateFaces: number;
}

export interface PartDimensionEvidence {
  id: string;
  actual: number;
  source: 'native_measurement' | 'authoritative_pmi';
}

export interface PartFeatureEvidence {
  id: string;
  kind: string;
  actualCount: number;
  source: 'native_topology' | 'feature_history';
}

export interface PartGenerationEvidence {
  kernel?: PartKernelEvidence;
  topology?: PartTopologyEvidence;
  dimensions?: PartDimensionEvidence[];
  features?: PartFeatureEvidence[];
}

export interface PartGateResult {
  gate: 'kernel' | 'topology' | 'dimensions' | 'features';
  status: PartGateStatus;
  codes: string[];
}

export interface PartGenerationCertificate {
  schema: 'nexyfab.part-generation-certificate.v1';
  partId: string;
  intent: PartIntent;
  status: PartGateStatus;
  releaseReady: boolean;
  releaseTarget: PartReleaseTarget;
  artifactClass: PartArtifactClass | null;
  gates: PartGateResult[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const result = (gate: PartGateResult['gate'], status: PartGateStatus, codes: string[] = []): PartGateResult => ({ gate, status, codes });

const inferredArtifactClass = (kernel: PartKernelEvidence | undefined): PartArtifactClass | null => {
  if (!kernel) return null;
  if (kernel.artifactClass) return kernel.artifactClass;
  return kernel.source === 'native_mesh' ? 'mesh_manufacturing' : 'analytic_brep';
};

function kernelGate(intent: PartGenerationIntent, evidence: PartGenerationEvidence): PartGateResult {
  const value = evidence.kernel;
  if (!value) return result('kernel', 'not_run', ['PART_KERNEL_EVIDENCE_MISSING']);
  if (!value.available) return result('kernel', 'fail', ['PART_KERNEL_UNAVAILABLE']);
  if (!SHA256.test(value.artifactHash)) return result('kernel', 'fail', ['PART_KERNEL_ARTIFACT_HASH_INVALID']);
  const artifactClass = inferredArtifactClass(value)!;
  const sourceMismatch = value.source === 'native_mesh'
    ? !['mesh_preview', 'mesh_manufacturing', 'faceted_brep'].includes(artifactClass)
    : ['mesh_preview', 'mesh_manufacturing'].includes(artifactClass);
  if (sourceMismatch) return result('kernel', 'fail', ['PART_KERNEL_ARTIFACT_CLASS_SOURCE_MISMATCH']);
  if (value.valid === null) return result('kernel', 'not_run', ['PART_KERNEL_VALIDITY_NOT_INSPECTED']);
  if (!value.valid) return result('kernel', 'fail', ['PART_KERNEL_INVALID']);
  const releaseTarget = intent.releaseTarget ?? 'manufacturing';
  if (releaseTarget === 'manufacturing' && !['analytic_brep', 'native_parametric'].includes(artifactClass)) {
    return result('kernel', 'not_run', ['PART_KERNEL_ARTIFACT_CLASS_INSUFFICIENT_FOR_MANUFACTURING']);
  }
  return result('kernel', 'pass');
}

function topologyGate(intent: PartGenerationIntent, evidence: PartGenerationEvidence): PartGateResult {
  const value = evidence.topology;
  if (!value) return result('topology', 'not_run', ['PART_TOPOLOGY_EVIDENCE_MISSING']);
  const codes: string[] = [];
  if (!Number.isInteger(value.solidCount) || value.solidCount < 1) codes.push('PART_SOLID_COUNT_INVALID');
  if (!value.watertight) codes.push('PART_NOT_WATERTIGHT');
  if (value.nonManifoldEdges > 0) codes.push('PART_NON_MANIFOLD');
  if (value.degenerateFaces > 0) codes.push('PART_DEGENERATE_FACES');
  if (intent.bodyPolicy === 'single_body' && value.solidCount !== 1) codes.push('PART_SINGLE_BODY_POLICY_VIOLATION');
  if (intent.expectedBodies !== null && value.solidCount !== intent.expectedBodies) codes.push('PART_EXPECTED_BODY_COUNT_MISMATCH');
  return result('topology', codes.length ? 'fail' : 'pass', codes);
}

function dimensionGate(intent: PartGenerationIntent, evidence: PartGenerationEvidence): PartGateResult {
  if (!intent.dimensions.length) return result('dimensions', 'pass');
  if (!evidence.dimensions) return result('dimensions', 'not_run', ['PART_DIMENSION_EVIDENCE_MISSING']);
  const measured = new Map(evidence.dimensions.map(item => [item.id, item]));
  const codes: string[] = [];
  let missing = false;
  for (const requirement of intent.dimensions) {
    const item = measured.get(requirement.id);
    if (!item) { missing = true; codes.push(`PART_DIMENSION_NOT_MEASURED:${requirement.id}`); continue; }
    if (!Number.isFinite(item.actual) || Math.abs(item.actual - requirement.expected) > requirement.tolerance) codes.push(`PART_DIMENSION_OUT_OF_TOLERANCE:${requirement.id}`);
  }
  if (codes.some(code => code.startsWith('PART_DIMENSION_OUT_OF_TOLERANCE'))) return result('dimensions', 'fail', codes);
  return missing ? result('dimensions', 'not_run', codes) : result('dimensions', 'pass');
}

function featureGate(intent: PartGenerationIntent, evidence: PartGenerationEvidence): PartGateResult {
  if (!intent.features.length) return result('features', 'pass');
  if (!evidence.features) return result('features', 'not_run', ['PART_FEATURE_EVIDENCE_MISSING']);
  const observed = new Map(evidence.features.map(item => [`${item.id}:${item.kind}`, item]));
  const codes: string[] = [];
  let missing = false;
  for (const requirement of intent.features) {
    const item = observed.get(`${requirement.id}:${requirement.kind}`);
    if (!item) { missing = true; codes.push(`PART_FEATURE_NOT_INSPECTED:${requirement.id}`); continue; }
    if (!Number.isInteger(item.actualCount) || item.actualCount !== requirement.expectedCount) codes.push(`PART_FEATURE_COUNT_MISMATCH:${requirement.id}`);
  }
  if (codes.some(code => code.startsWith('PART_FEATURE_COUNT_MISMATCH'))) return result('features', 'fail', codes);
  return missing ? result('features', 'not_run', codes) : result('features', 'pass');
}

export function buildPartGenerationCertificate(intent: PartGenerationIntent, evidence: PartGenerationEvidence): PartGenerationCertificate {
  if (!intent.partId.trim()) throw new Error('part_certificate_part_id_missing');
  if (intent.expectedBodies !== null && (!Number.isInteger(intent.expectedBodies) || intent.expectedBodies < 1)) throw new Error('part_certificate_expected_bodies_invalid');
  const gates = [kernelGate(intent, evidence), topologyGate(intent, evidence), dimensionGate(intent, evidence), featureGate(intent, evidence)];
  const status: PartGateStatus = gates.some(gate => gate.status === 'fail') ? 'fail' : gates.some(gate => gate.status === 'not_run') ? 'not_run' : 'pass';
  return { schema: 'nexyfab.part-generation-certificate.v1', partId: intent.partId, intent: intent.intent, status, releaseReady: status === 'pass', releaseTarget: intent.releaseTarget ?? 'manufacturing', artifactClass: inferredArtifactClass(evidence.kernel), gates };
}
