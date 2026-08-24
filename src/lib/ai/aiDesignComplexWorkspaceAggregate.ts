import { serverEvidenceSha256 } from './serverEvidence';

export const AI_DESIGN_COMPLEX_WORKSPACE_AGGREGATE_SCHEMA = 'nexyfab.ai-design-complex-workspace-aggregate.v1' as const;

export interface AiDesignComplexArtifactRefV1 {
  artifactId: string;
  artifactDigest: string;
  contentDigest: string;
}

export interface AiDesignAppliedComplexCommandV1 {
  commandId: string;
  commandDigest: string;
  resultingRevision: number;
  appliedAt: string;
}

export interface AiDesignComplexWorkspaceAggregateV1 {
  schema: typeof AI_DESIGN_COMPLEX_WORKSPACE_AGGREGATE_SCHEMA;
  projectId: string;
  sessionId: string;
  complexRevision: number;
  boundRuntimeRevision: number;
  productStructure: AiDesignComplexArtifactRefV1 | null;
  crossDomainGraph: AiDesignComplexArtifactRefV1 | null;
  partitions: readonly AiDesignComplexArtifactRefV1[];
  gaugeBindings: AiDesignComplexArtifactRefV1 | null;
  constraintBindings: AiDesignComplexArtifactRefV1 | null;
  resolutions: readonly AiDesignComplexArtifactRefV1[];
  criticBundles: readonly AiDesignComplexArtifactRefV1[];
  precisionRequests: readonly AiDesignComplexArtifactRefV1[];
  precisionReceipts: readonly AiDesignComplexArtifactRefV1[];
  exactCadStatus: 'NOT_RUN' | 'PASS' | 'FAIL' | 'STALE';
  appliedCommands: readonly AiDesignAppliedComplexCommandV1[];
  createdAt: string;
  updatedAt: string;
  aggregateDigest: string;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_HISTORY = 2_048;
const MAX_REFS = 2_048;

function material(value: Omit<AiDesignComplexWorkspaceAggregateV1, 'aggregateDigest'> | AiDesignComplexWorkspaceAggregateV1) {
  const { aggregateDigest: _aggregateDigest, ...rest } = value as AiDesignComplexWorkspaceAggregateV1;
  return rest;
}

function seal(value: Omit<AiDesignComplexWorkspaceAggregateV1, 'aggregateDigest'>): AiDesignComplexWorkspaceAggregateV1 {
  return Object.freeze({ ...value, aggregateDigest: serverEvidenceSha256(value) });
}

function validRef(value: AiDesignComplexArtifactRefV1): boolean {
  return !!value && ID.test(value.artifactId ?? '') && SHA256.test(value.artifactDigest ?? '') && SHA256.test(value.contentDigest ?? '');
}

function uniqueRefs(values: readonly AiDesignComplexArtifactRefV1[]): boolean {
  return new Set(values.map(item => item.artifactId)).size === values.length;
}

export function createAiDesignComplexWorkspaceAggregate(input: {
  projectId: string;
  sessionId: string;
  runtimeRevision: number;
  now?: string;
}): AiDesignComplexWorkspaceAggregateV1 {
  const now = input.now ?? new Date().toISOString();
  const aggregate = seal({
    schema: AI_DESIGN_COMPLEX_WORKSPACE_AGGREGATE_SCHEMA,
    projectId: input.projectId,
    sessionId: input.sessionId,
    complexRevision: 0,
    boundRuntimeRevision: input.runtimeRevision,
    productStructure: null,
    crossDomainGraph: null,
    partitions: [],
    gaugeBindings: null,
    constraintBindings: null,
    resolutions: [],
    criticBundles: [],
    precisionRequests: [],
    precisionReceipts: [],
    exactCadStatus: 'NOT_RUN',
    appliedCommands: [],
    createdAt: now,
    updatedAt: now,
  });
  const issues = validateAiDesignComplexWorkspaceAggregate(aggregate);
  if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_AGGREGATE_INVALID:${issues.join(',')}`);
  return aggregate;
}

export function advanceAiDesignComplexWorkspaceAggregate(
  current: AiDesignComplexWorkspaceAggregateV1,
  input: {
    commandId: string;
    commandDigest: string;
    expectedComplexRevision: number;
    runtimeRevision: number;
    now: string;
    patch: Partial<Pick<AiDesignComplexWorkspaceAggregateV1,
      'productStructure' | 'crossDomainGraph' | 'partitions' | 'gaugeBindings' | 'constraintBindings' | 'resolutions' | 'criticBundles'
      | 'precisionRequests' | 'precisionReceipts' | 'exactCadStatus'>>;
  },
): AiDesignComplexWorkspaceAggregateV1 {
  const issues = validateAiDesignComplexWorkspaceAggregate(current);
  if (issues.length) throw new Error(`AI_DESIGN_COMPLEX_AGGREGATE_INVALID:${issues.join(',')}`);
  if (current.complexRevision !== input.expectedComplexRevision) throw new Error('AI_DESIGN_COMPLEX_REVISION_CONFLICT');
  if (!ID.test(input.commandId) || !SHA256.test(input.commandDigest) || !Number.isSafeInteger(input.runtimeRevision) || input.runtimeRevision < 0 || !Number.isFinite(Date.parse(input.now))) throw new Error('AI_DESIGN_COMPLEX_TRANSITION_INVALID');
  const prior = current.appliedCommands.find(item => item.commandId === input.commandId);
  if (prior) {
    if (prior.commandDigest !== input.commandDigest) throw new Error('AI_DESIGN_COMPLEX_COMMAND_REPLAY_CONFLICT');
    return current;
  }
  if (current.appliedCommands.length >= MAX_HISTORY) throw new Error('AI_DESIGN_COMPLEX_COMMAND_HISTORY_FULL');
  const nextRevision = current.complexRevision + 1;
  const { aggregateDigest: _priorDigest, ...currentMaterial } = structuredClone(current);
  const next = seal({
    ...currentMaterial,
    ...structuredClone(input.patch),
    complexRevision: nextRevision,
    boundRuntimeRevision: input.runtimeRevision,
    appliedCommands: [...current.appliedCommands, {
      commandId: input.commandId,
      commandDigest: input.commandDigest,
      resultingRevision: nextRevision,
      appliedAt: input.now,
    }],
    updatedAt: input.now,
  });
  const nextIssues = validateAiDesignComplexWorkspaceAggregate(next);
  if (nextIssues.length) throw new Error(`AI_DESIGN_COMPLEX_AGGREGATE_INVALID:${nextIssues.join(',')}`);
  return next;
}

export function validateAiDesignComplexWorkspaceAggregate(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['complex_aggregate_not_object'];
  const aggregate = value as AiDesignComplexWorkspaceAggregateV1;
  const issues: string[] = [];
  if (aggregate.schema !== AI_DESIGN_COMPLEX_WORKSPACE_AGGREGATE_SCHEMA || !ID.test(aggregate.projectId ?? '') || !ID.test(aggregate.sessionId ?? '')) issues.push('complex_aggregate_binding_invalid');
  if (!Number.isSafeInteger(aggregate.complexRevision) || aggregate.complexRevision < 0 || !Number.isSafeInteger(aggregate.boundRuntimeRevision) || aggregate.boundRuntimeRevision < 0) issues.push('complex_aggregate_revision_invalid');
  if (aggregate.productStructure !== null && !validRef(aggregate.productStructure)) issues.push('complex_aggregate_structure_ref_invalid');
  if (aggregate.crossDomainGraph !== null && !validRef(aggregate.crossDomainGraph)) issues.push('complex_aggregate_constraint_ref_invalid');
  if (aggregate.gaugeBindings !== null && !validRef(aggregate.gaugeBindings)) issues.push('complex_aggregate_gauge_bindings_ref_invalid');
  if (aggregate.constraintBindings !== null && !validRef(aggregate.constraintBindings)) issues.push('complex_aggregate_constraint_bindings_ref_invalid');
  for (const [name, refs] of [['partitions', aggregate.partitions], ['resolutions', aggregate.resolutions], ['criticBundles', aggregate.criticBundles], ['precisionRequests', aggregate.precisionRequests], ['precisionReceipts', aggregate.precisionReceipts]] as const) {
    if (!Array.isArray(refs) || refs.length > MAX_REFS || !uniqueRefs(refs) || refs.some(item => !validRef(item))) issues.push(`complex_aggregate_${name}_invalid`);
  }
  if (!['NOT_RUN', 'PASS', 'FAIL', 'STALE'].includes(aggregate.exactCadStatus)) issues.push('complex_aggregate_exact_status_invalid');
  if (!Array.isArray(aggregate.appliedCommands) || aggregate.appliedCommands.length > MAX_HISTORY) issues.push('complex_aggregate_history_invalid');
  else {
    const ids = new Set<string>();
    for (const command of aggregate.appliedCommands) {
      if (!ID.test(command.commandId ?? '') || ids.has(command.commandId) || !SHA256.test(command.commandDigest ?? '') || !Number.isSafeInteger(command.resultingRevision) || command.resultingRevision < 1 || !Number.isFinite(Date.parse(command.appliedAt))) issues.push('complex_aggregate_command_invalid');
      ids.add(command.commandId);
    }
  }
  if (!Number.isFinite(Date.parse(aggregate.createdAt)) || !Number.isFinite(Date.parse(aggregate.updatedAt)) || !SHA256.test(aggregate.aggregateDigest ?? '')) issues.push('complex_aggregate_metadata_invalid');
  if (issues.length === 0 && aggregate.aggregateDigest !== serverEvidenceSha256(material(aggregate))) issues.push('complex_aggregate_digest_mismatch');
  return [...new Set(issues)];
}

export function findAppliedAiDesignComplexCommand(aggregate: AiDesignComplexWorkspaceAggregateV1, commandId: string): AiDesignAppliedComplexCommandV1 | undefined {
  return aggregate.appliedCommands.find(item => item.commandId === commandId);
}
