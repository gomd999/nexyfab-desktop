import {
  evaluateArtifactRelease,
} from './designArtifactGraph';
import type { DomainEvidenceAxis } from './domainProfile';
import type { DomainAccuracyAssertionResult } from './domainAccuracyEvidence';
import type { ComplexProductAssessment } from './complexProductAccuracy';
import type { ManufacturingGateReport } from './manufacturingGates';
import type { NativeMotionVerificationCertificate } from './nativeMotionVerificationCertificate';
import type { ProductAssemblyCertificate } from './productAssemblyCertificate';
import {
  hashCadPayload,
  validateCadWorkspaceEnvelope,
  type CadWorkspaceEnvelopeInput,
} from '@/lib/cad/workspaceRevisionStore';

export type MechanicalEvidenceStatus = 'pass' | 'fail' | 'not_run';

export interface BoundMechanicalEvidence<T> {
  workspaceRevision: number;
  modelContentHash: string;
  contentHash: string;
  payload: T;
}

export interface MechanicalCoordinateUnitEvidence {
  status: MechanicalEvidenceStatus;
  linearUnit: 'mm';
  angularUnit: 'deg';
  handedness: 'right';
  upAxis: 'z';
  issues: string[];
  artifactHashes: string[];
}

export interface MechanicalToleranceEvidence {
  status: MechanicalEvidenceStatus;
  requirements: number;
  verified: number;
  worstExcessMm: number;
  issues: string[];
  artifactHashes: string[];
}

export interface MechanicalDrawingEvidence {
  status: MechanicalEvidenceStatus;
  requiredSheets: number;
  verifiedSheets: number;
  expectedBomRows: number;
  verifiedBomRows: number;
  requiredDimensions: number;
  verifiedDimensions: number;
  requiredToleranceCallouts: number;
  verifiedToleranceCallouts: number;
  issues: string[];
  artifactHashes: string[];
}

export interface MechanicalReleaseCertificateInput {
  workspace: CadWorkspaceEnvelopeInput;
  coordinateUnits?: BoundMechanicalEvidence<MechanicalCoordinateUnitEvidence>;
  complexProduct?: BoundMechanicalEvidence<ComplexProductAssessment>;
  assembly?: BoundMechanicalEvidence<ProductAssemblyCertificate>;
  motion?: BoundMechanicalEvidence<NativeMotionVerificationCertificate>;
  manufacturing?: BoundMechanicalEvidence<ManufacturingGateReport>;
  tolerance?: BoundMechanicalEvidence<MechanicalToleranceEvidence>;
  drawing?: BoundMechanicalEvidence<MechanicalDrawingEvidence>;
}

export interface MechanicalReleaseCertificate {
  schema: 'nexyfab.mechanical-release-certificate.v1';
  workspaceRevision: number;
  modelContentHash: string;
  status: MechanicalEvidenceStatus;
  releaseReady: boolean;
  assertions: DomainAccuracyAssertionResult[];
  issues: string[];
}

const SHA256 = /^[a-f0-9]{64}$/;
const rank: Record<MechanicalEvidenceStatus, number> = { pass: 0, not_run: 1, fail: 2 };

function assertion(
  axis: DomainEvidenceAxis,
  status: MechanicalEvidenceStatus,
  reason: string,
): DomainAccuracyAssertionResult {
  return { axis, status, reason };
}

function mergeAssertions(values: readonly DomainAccuracyAssertionResult[]): DomainAccuracyAssertionResult[] {
  const grouped = new Map<DomainEvidenceAxis, DomainAccuracyAssertionResult[]>();
  for (const value of values) grouped.set(value.axis, [...(grouped.get(value.axis) ?? []), value]);
  return [...grouped.entries()].map(([axis, items]) => ({
    axis,
    status: items.reduce<MechanicalEvidenceStatus>(
      (worst, item) => rank[item.status] > rank[worst] ? item.status : worst,
      'pass',
    ),
    reason: items.map(item => item.reason).join(' | '),
  }));
}

function boundStatus<T>(
  name: string,
  value: BoundMechanicalEvidence<T> | undefined,
  workspace: CadWorkspaceEnvelopeInput,
): { status: MechanicalEvidenceStatus; reason: string; payload?: T } {
  if (!value) return { status: 'not_run', reason: `${name}: evidence was not supplied.` };
  const issues: string[] = [];
  if (value.workspaceRevision !== workspace.workspace.revision) issues.push('workspace_revision_mismatch');
  if (value.modelContentHash !== workspace.geometry.contentHash) issues.push('model_content_hash_mismatch');
  if (!SHA256.test(value.contentHash) || value.contentHash !== hashCadPayload(value.payload)) issues.push('payload_hash_mismatch');
  return issues.length
    ? { status: 'fail', reason: `${name}: ${issues.join(',')}` }
    : { status: 'pass', reason: `${name}: hash and workspace revision are bound.`, payload: value.payload };
}

function certificateGate(
  source: string,
  binding: ReturnType<typeof boundStatus>,
  status: MechanicalEvidenceStatus | undefined,
  details: readonly string[] = [],
): { status: MechanicalEvidenceStatus; reason: string } {
  if (binding.status !== 'pass') return binding;
  if (!status) return { status: 'not_run', reason: `${source}: gate was not present.` };
  return {
    status,
    reason: `${source}: ${details.length ? details.join(',') : status}`,
  };
}

function worstStatus(values: readonly MechanicalEvidenceStatus[]): MechanicalEvidenceStatus {
  return values.reduce((worst, value) => rank[value] > rank[worst] ? value : worst, 'pass');
}

function partGateStatus(
  assembly: ProductAssemblyCertificate | undefined,
): MechanicalEvidenceStatus | undefined {
  if (!assembly) return undefined;
  const gates = assembly.gates.find(item => item.gate === 'part_certificates');
  if (gates?.status !== 'pass') return gates?.status;
  // The assembly certificate has already verified every definition-level part certificate.
  // Preserve the stricter per-part gate result when it exists.
  return assembly.status === 'pass' ? 'pass' : assembly.status;
}

function manufacturingStatus(
  report: ManufacturingGateReport | undefined,
  ids: readonly string[],
): { status?: MechanicalEvidenceStatus; details: string[] } {
  if (!report) return { details: [] };
  const selected = report.gates.filter(gate => ids.includes(gate.id));
  if (selected.length !== ids.length) return { status: 'not_run', details: ['required_gate_missing'] };
  return {
    status: worstStatus(selected.map(gate => gate.status === 'passed' ? 'pass' : gate.status === 'failed' ? 'fail' : 'not_run')),
    details: selected.flatMap(gate => [`${gate.id}:${gate.status}`, ...gate.failures]),
  };
}

function explicitStatus(
  name: string,
  binding: ReturnType<typeof boundStatus>,
  value: { status: MechanicalEvidenceStatus; issues: string[]; artifactHashes: string[] } | undefined,
  numericValid: boolean,
): { status: MechanicalEvidenceStatus; reason: string } {
  if (binding.status !== 'pass') return binding;
  if (!value) return { status: 'not_run', reason: `${name}: evidence was not supplied.` };
  const invalidHashes = value.artifactHashes.length === 0 || value.artifactHashes.some(hash => !SHA256.test(hash));
  const structuralFailure = !numericValid || invalidHashes;
  const declared = structuralFailure ? 'fail' : value.status;
  return {
    status: declared,
    reason: `${name}: ${[
      ...(structuralFailure ? ['invalid_structured_evidence'] : []),
      ...value.issues,
      `artifacts:${value.artifactHashes.length}`,
    ].join(',')}`,
  };
}

/**
 * Combines real, revision-bound mechanical certificates into all 24 release axes.
 * Missing evidence remains `not_run`; a detached/tampered certificate is `fail`.
 */
export function buildMechanicalReleaseCertificate(
  input: MechanicalReleaseCertificateInput,
): MechanicalReleaseCertificate {
  const workspaceIssues = validateCadWorkspaceEnvelope(input.workspace);
  if (input.workspace.workspace.domain !== 'mechanical') workspaceIssues.push('workspace_domain_not_mechanical');
  const workspaceStatus: MechanicalEvidenceStatus = workspaceIssues.length ? 'fail' : 'pass';
  const workspaceReason = workspaceIssues.length
    ? `workspace: ${workspaceIssues.join(',')}`
    : 'workspace: exact model, semantics, relations, provenance and revision bindings are valid.';

  const coordinateBinding = boundStatus('coordinate_units', input.coordinateUnits, input.workspace);
  const complexBinding = boundStatus('complex_product', input.complexProduct, input.workspace);
  const assemblyBinding = boundStatus('assembly', input.assembly, input.workspace);
  const motionBinding = boundStatus('motion', input.motion, input.workspace);
  const manufacturingBinding = boundStatus('manufacturing', input.manufacturing, input.workspace);
  const toleranceBinding = boundStatus('tolerance', input.tolerance, input.workspace);
  const drawingBinding = boundStatus('drawing', input.drawing, input.workspace);

  const coordinate = input.coordinateUnits?.payload;
  const complex = input.complexProduct?.payload;
  const assembly = input.assembly?.payload;
  const motion = input.motion?.payload;
  const manufacturing = input.manufacturing?.payload;
  const tolerance = input.tolerance?.payload;
  const drawing = input.drawing?.payload;

  const coordinateResult = explicitStatus(
    'coordinate_units', coordinateBinding, coordinate,
    coordinate?.linearUnit === 'mm' && coordinate.angularUnit === 'deg'
      && coordinate.handedness === 'right' && coordinate.upAxis === 'z',
  );
  const toleranceResult = explicitStatus(
    'tolerance', toleranceBinding, tolerance,
    !!tolerance && Number.isSafeInteger(tolerance.requirements) && tolerance.requirements > 0
      && tolerance?.verified === tolerance.requirements
      && Number.isFinite(tolerance?.worstExcessMm) && tolerance.worstExcessMm <= 0,
  );
  const drawingResult = explicitStatus(
    'drawing', drawingBinding, drawing,
    !!drawing && Number.isSafeInteger(drawing.requiredSheets) && drawing.requiredSheets > 0
      && drawing?.verifiedSheets === drawing.requiredSheets
      && drawing?.expectedBomRows === drawing.verifiedBomRows
      && drawing?.requiredDimensions === drawing.verifiedDimensions
      && drawing?.requiredToleranceCallouts === drawing.verifiedToleranceCallouts,
  );

  const assemblyGate = (name: ProductAssemblyCertificate['gates'][number]['gate']) => {
    const gate = assembly?.gates.find(item => item.gate === name);
    return certificateGate(`assembly.${name}`, assemblyBinding, gate?.status, gate?.codes);
  };
  const complexGate = (id: ComplexProductAssessment['gates'][number]['id']) => {
    const gate = complex?.gates.find(item => item.id === id);
    return certificateGate(`complex_product.${id}`, complexBinding, gate ? (gate.passed ? 'pass' : 'fail') : undefined, gate ? [gate.reason] : []);
  };
  const motionGate = (name: NativeMotionVerificationCertificate['gates'][number]['gate']) => {
    const gate = motion?.gates.find(item => item.gate === name);
    return certificateGate(`motion.${name}`, motionBinding, gate?.status, gate?.codes);
  };
  const manufacturingGate = (ids: readonly string[]) => {
    const selected = manufacturingStatus(manufacturing, ids);
    return certificateGate(`manufacturing.${ids.join('+')}`, manufacturingBinding, selected.status, selected.details);
  };
  const partGate = (name: 'kernel' | 'topology' | 'dimensions' | 'features') =>
    certificateGate(`parts.${name}`, assemblyBinding, partGateStatus(assembly));

  const graphRelease = evaluateArtifactRelease(input.workspace.artifactGraph, ['model', 'drawing', 'quantity']);
  const outputResult = {
    status: workspaceStatus !== 'pass' ? workspaceStatus : graphRelease.releaseReady ? 'pass' as const : 'fail' as const,
    reason: graphRelease.releaseReady
      ? 'artifact_graph: model, drawing and quantity are current, verified and revision-bound.'
      : `artifact_graph: ${[
        ...graphRelease.graphIssues,
        ...graphRelease.missingKinds.map(value => `missing:${value}`),
        ...graphRelease.staleArtifactIds.map(value => `stale:${value}`),
        ...graphRelease.unverifiedArtifactIds.map(value => `unverified:${value}`),
      ].join(',')}`,
  };

  const values: DomainAccuracyAssertionResult[] = [
    assertion('requirements', workspaceStatus, workspaceReason),
    assertion('coordinate_units', coordinateResult.status, coordinateResult.reason),
    assertion('semantic_objects', workspaceStatus, workspaceReason),
    assertion('geometry', workspaceStatus, workspaceReason),
    assertion('geometry', partGate('kernel').status, partGate('kernel').reason),
    assertion('geometry', partGate('topology').status, partGate('topology').reason),
    assertion('relationships', workspaceStatus, workspaceReason),
    assertion('provenance', workspaceStatus, workspaceReason),
    assertion('provenance', manufacturingGate(['G0']).status, manufacturingGate(['G0']).reason),
    assertion('revision_integrity', workspaceStatus, workspaceReason),
    assertion('output_consistency', outputResult.status, outputResult.reason),
    assertion('dimensions', partGate('dimensions').status, partGate('dimensions').reason),
    assertion('features', partGate('features').status, partGate('features').reason),
    assertion('part_definitions', complexGate('decomposition').status, complexGate('decomposition').reason),
    assertion('part_definitions', assemblyGate('architecture').status, assemblyGate('architecture').reason),
    assertion('occurrences', assemblyGate('architecture').status, assemblyGate('architecture').reason),
    assertion('body_membership', assemblyGate('step_body_membership').status, assemblyGate('step_body_membership').reason),
    assertion('hierarchy', complexGate('assembly-depth').status, complexGate('assembly-depth').reason),
    assertion('transforms', assemblyGate('transforms').status, assemblyGate('transforms').reason),
    assertion('joints', assemblyGate('joints').status, assemblyGate('joints').reason),
    assertion('motion', motionGate('planning').status, motionGate('planning').reason),
    assertion('motion', motionGate('solver').status, motionGate('solver').reason),
    assertion('tolerance', toleranceResult.status, toleranceResult.reason),
    assertion('collision_clearance', motionGate('precise_collision').status, motionGate('precise_collision').reason),
    assertion('collision_clearance', motionGate('clearance').status, motionGate('clearance').reason),
    assertion('materials', manufacturingGate(['G7']).status, manufacturingGate(['G7']).reason),
    assertion('manufacturing', manufacturingGate(['G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G9']).status, manufacturingGate(['G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G9']).reason),
    assertion('step_roundtrip', complexGate('step-occurrences').status, complexGate('step-occurrences').reason),
    assertion('step_roundtrip', assemblyGate('step_body_membership').status, assemblyGate('step_body_membership').reason),
    assertion('step_roundtrip', manufacturingGate(['G8']).status, manufacturingGate(['G8']).reason),
    assertion('drawing_consistency', drawingResult.status, drawingResult.reason),
    assertion('repair', complexGate('repair-isolation').status, complexGate('repair-isolation').reason),
  ];
  const assertions = mergeAssertions(values);
  const requiredAxes = new Set<DomainEvidenceAxis>([
    'requirements', 'coordinate_units', 'semantic_objects', 'geometry', 'relationships', 'provenance',
    'revision_integrity', 'output_consistency', 'dimensions', 'features', 'part_definitions', 'occurrences',
    'body_membership', 'hierarchy', 'transforms', 'joints', 'motion', 'tolerance', 'collision_clearance',
    'materials', 'manufacturing', 'step_roundtrip', 'drawing_consistency', 'repair',
  ]);
  const issues = [
    ...workspaceIssues,
    ...assertions.filter(item => item.status !== 'pass').map(item => `${item.axis}:${item.status}`),
  ];
  const complete = assertions.length === requiredAxes.size && assertions.every(item => requiredAxes.has(item.axis));
  const status: MechanicalEvidenceStatus = !complete
    ? 'fail'
    : assertions.some(item => item.status === 'fail')
      ? 'fail'
      : assertions.some(item => item.status === 'not_run')
        ? 'not_run'
        : 'pass';
  return {
    schema: 'nexyfab.mechanical-release-certificate.v1',
    workspaceRevision: input.workspace.workspace.revision,
    modelContentHash: input.workspace.geometry.contentHash,
    status,
    releaseReady: status === 'pass',
    assertions,
    issues,
  };
}
