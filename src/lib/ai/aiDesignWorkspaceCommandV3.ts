import {
  validateProductStructureGraph,
  type ProductStructureGraphV1,
} from './aiDesignProductStructureGraph';
import {
  validateAiDesignCrossDomainConstraintGraph,
  type AiDesignCrossDomainConstraintGraphV1,
} from './aiDesignCrossDomainConstraintGraph';
import {
  AI_DESIGN_INTENT_RESOLUTION_COMMAND_SCHEMA,
  validateAiDesignIntentResolutionCommand,
  type AiDesignResolutionSelection,
} from './aiDesignIntentResolution';
import { serverEvidenceSha256 } from './serverEvidence';
import type { GraphPartitionDefinition } from './aiDesignHierarchicalCandidatePartition';
import type { AiDesignAssemblyGaugeBindingV1, AiDesignStructureConstraintBindingV1 } from './aiDesignComplexWorkspaceViewModel';

export const AI_DESIGN_WORKSPACE_COMMAND_V3_SCHEMA = 'nexyfab.ai-design-workspace-command.v3' as const;
export const AI_DESIGN_WORKSPACE_SERVER_COMMAND_V3_SCHEMA = 'nexyfab.ai-design-workspace-server-command.v3' as const;
export const AI_DESIGN_WORKSPACE_COMMAND_V3_MAX_BYTES = 4 * 1024 * 1024;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_TEXT = 4_000;
const MAX_SCOPE_IDS = 256;

export interface AiDesignWorkspaceCommandEnvelopeV3 {
  schema: typeof AI_DESIGN_WORKSPACE_COMMAND_V3_SCHEMA;
  commandId: string;
  projectId: string;
  sessionId: string;
  expectedRuntimeRevision: number;
  expectedComplexRevision: number;
  issuedAt: string;
}

export interface AiDesignResolveIntentPayloadV3 {
  expectedGraphRevision: number;
  graphContentHash: string;
  targetNodeId: string;
  selection: AiDesignResolutionSelection;
  rationale: string;
  provenance: { sourceIds: string[]; sourceHashes: string[] };
}

export type AiDesignWorkspaceClientCommandV3 = AiDesignWorkspaceCommandEnvelopeV3 & (
  | { type: 'ATTACH_PRODUCT_STRUCTURE'; payload: { productStructure: ProductStructureGraphV1; partitionDefinitions?: GraphPartitionDefinition[]; gaugeBindings?: AiDesignAssemblyGaugeBindingV1[] } }
  | { type: 'ATTACH_CROSS_DOMAIN_GRAPH'; payload: { crossDomainGraph: AiDesignCrossDomainConstraintGraphV1; constraintBindings?: AiDesignStructureConstraintBindingV1[] } }
  | { type: 'RESOLVE_INTENT_CONFLICT'; payload: AiDesignResolveIntentPayloadV3 }
  | { type: 'RUN_COMPLEX_CRITICS'; payload: { candidateIds?: string[] } }
  | { type: 'REQUEST_PRECISION_VERIFICATION'; payload: {
    structureNodeIds: string[];
    interfaceIds: string[];
    partitionIds: string[];
    gaugeIds: string[];
  } }
);

export type AiDesignWorkspaceServerCommandV3 = {
  schema: typeof AI_DESIGN_WORKSPACE_SERVER_COMMAND_V3_SCHEMA;
  source: 'server';
  commandId: string;
  projectId: string;
  sessionId: string;
  expectedRuntimeRevision: number;
  expectedComplexRevision: number;
  issuedAt: string;
  type: 'RECORD_PRECISION_RECEIPT';
  payload: { receiptId: string; receiptDigest: string };
};

export type ParsedAiDesignWorkspaceClientCommandV3 =
  | { ok: true; command: AiDesignWorkspaceClientCommandV3 }
  | { ok: false; issues: readonly string[] };

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function noUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validIds(value: unknown, max = MAX_SCOPE_IDS): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(validId) && new Set(value).size === value.length;
}

function validPartitionDefinitions(value: unknown): value is GraphPartitionDefinition[] {
  return Array.isArray(value) && value.length <= 256 && value.every(item => record(item) && noUnknownKeys(item, ['partitionId', 'artifactId', 'nodeIds', 'boundaryNodeIds'])
    && validId(item.partitionId) && validId(item.artifactId) && validIds(item.nodeIds, 2_000) && item.nodeIds.length > 0
    && (item.boundaryNodeIds === undefined || validIds(item.boundaryNodeIds, 2_000)));
}

function validGaugeBindings(value: unknown): value is AiDesignAssemblyGaugeBindingV1[] {
  return Array.isArray(value) && value.length <= 2_000 && value.every(item => record(item) && noUnknownKeys(item, ['bindingId', 'gaugeId', 'structureNodeId', 'parameterId', 'scope', 'interfaceId', 'affectedNodeIds'])
    && validId(item.bindingId) && validId(item.gaugeId) && validId(item.structureNodeId) && validId(item.parameterId)
    && ['component', 'subtree', 'interface'].includes(String(item.scope)) && (item.interfaceId === null || validId(item.interfaceId)) && validIds(item.affectedNodeIds, 2_000));
}

function validConstraintBindings(value: unknown): value is AiDesignStructureConstraintBindingV1[] {
  return Array.isArray(value) && value.length <= 2_000 && value.every(item => record(item) && noUnknownKeys(item, ['crossDomainNodeId', 'structureNodeIds'])
    && validId(item.crossDomainNodeId) && validIds(item.structureNodeIds, 2_000));
}

function serializedSize(value: unknown): number {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
  catch { return Number.POSITIVE_INFINITY; }
}

function envelopeIssues(value: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (value.schema !== AI_DESIGN_WORKSPACE_COMMAND_V3_SCHEMA) issues.push('schema_invalid');
  if (!validId(value.commandId)) issues.push('command_id_invalid');
  if (!validId(value.projectId)) issues.push('project_id_invalid');
  if (!validId(value.sessionId)) issues.push('session_id_invalid');
  if (!validRevision(value.expectedRuntimeRevision)) issues.push('runtime_revision_invalid');
  if (!validRevision(value.expectedComplexRevision)) issues.push('complex_revision_invalid');
  if (typeof value.issuedAt !== 'string' || !Number.isFinite(Date.parse(value.issuedAt))) issues.push('issued_at_invalid');
  if (!noUnknownKeys(value, ['schema', 'commandId', 'projectId', 'sessionId', 'expectedRuntimeRevision', 'expectedComplexRevision', 'issuedAt', 'type', 'payload'])) issues.push('unknown_command_key');
  if (serializedSize(value) > AI_DESIGN_WORKSPACE_COMMAND_V3_MAX_BYTES) issues.push('command_too_large');
  return issues;
}

function conceptOnlyStructure(value: ProductStructureGraphV1): boolean {
  return value.interfaces.every(item => item.exactGeometryStatus === 'not_run' && item.manufacturingStatus === 'not_run');
}

function validResolutionPayload(
  value: Record<string, unknown>,
  envelope: Record<string, unknown>,
): boolean {
  if (!noUnknownKeys(value, ['expectedGraphRevision', 'graphContentHash', 'targetNodeId', 'selection', 'rationale', 'provenance'])) return false;
  return validateAiDesignIntentResolutionCommand({
    schema: AI_DESIGN_INTENT_RESOLUTION_COMMAND_SCHEMA,
    commandId: envelope.commandId,
    projectId: envelope.projectId,
    sessionId: envelope.sessionId,
    expectedGraphRevision: value.expectedGraphRevision,
    graphContentHash: value.graphContentHash,
    targetNodeId: value.targetNodeId,
    selection: value.selection,
    rationale: value.rationale,
    provenance: value.provenance,
  }).length === 0;
}

export function parseAiDesignWorkspaceClientCommandV3(value: unknown): ParsedAiDesignWorkspaceClientCommandV3 {
  if (!record(value)) return { ok: false, issues: ['command_not_object'] };
  const issues = envelopeIssues(value);
  if (!record(value.payload)) issues.push('payload_invalid');
  if (issues.length) return { ok: false, issues: [...new Set(issues)] };
  const payload = value.payload as Record<string, unknown>;
  let valid = false;
  switch (value.type) {
    case 'ATTACH_PRODUCT_STRUCTURE': {
      valid = noUnknownKeys(payload, ['productStructure', 'partitionDefinitions', 'gaugeBindings'])
        && validateProductStructureGraph(payload.productStructure).length === 0
        && conceptOnlyStructure(payload.productStructure as ProductStructureGraphV1)
        && (payload.partitionDefinitions === undefined || validPartitionDefinitions(payload.partitionDefinitions))
        && (payload.gaugeBindings === undefined || validGaugeBindings(payload.gaugeBindings));
      break;
    }
    case 'ATTACH_CROSS_DOMAIN_GRAPH': {
      valid = noUnknownKeys(payload, ['crossDomainGraph', 'constraintBindings'])
        && validateAiDesignCrossDomainConstraintGraph(payload.crossDomainGraph).length === 0
        && (payload.constraintBindings === undefined || validConstraintBindings(payload.constraintBindings));
      break;
    }
    case 'RESOLVE_INTENT_CONFLICT':
      valid = validResolutionPayload(payload, value);
      break;
    case 'RUN_COMPLEX_CRITICS':
      valid = noUnknownKeys(payload, ['candidateIds'])
        && (payload.candidateIds === undefined || (validIds(payload.candidateIds) && payload.candidateIds.length <= 3));
      break;
    case 'REQUEST_PRECISION_VERIFICATION':
      valid = noUnknownKeys(payload, ['structureNodeIds', 'interfaceIds', 'partitionIds', 'gaugeIds'])
        && validIds(payload.structureNodeIds) && validIds(payload.interfaceIds)
        && validIds(payload.partitionIds) && validIds(payload.gaugeIds)
        && (payload.structureNodeIds.length + payload.interfaceIds.length + payload.partitionIds.length + payload.gaugeIds.length > 0);
      break;
    default:
      return { ok: false, issues: ['client_command_type_not_allowed'] };
  }
  if (!valid) return { ok: false, issues: ['payload_schema_invalid'] };
  return { ok: true, command: structuredClone(value) as unknown as AiDesignWorkspaceClientCommandV3 };
}

export function isAiDesignWorkspaceClientCommandV3(value: unknown): value is AiDesignWorkspaceClientCommandV3 {
  return parseAiDesignWorkspaceClientCommandV3(value).ok;
}

export function aiDesignWorkspaceCommandV3Digest(command: AiDesignWorkspaceClientCommandV3): string {
  return serverEvidenceSha256(command);
}

export function resolutionCommandFromWorkspaceCommandV3(command: Extract<AiDesignWorkspaceClientCommandV3, { type: 'RESOLVE_INTENT_CONFLICT' }>) {
  return {
    schema: AI_DESIGN_INTENT_RESOLUTION_COMMAND_SCHEMA,
    commandId: command.commandId,
    projectId: command.projectId,
    sessionId: command.sessionId,
    ...structuredClone(command.payload),
  } as const;
}

export function isAiDesignWorkspaceServerCommandV3(value: unknown): value is AiDesignWorkspaceServerCommandV3 {
  if (!record(value) || value.schema !== AI_DESIGN_WORKSPACE_SERVER_COMMAND_V3_SCHEMA || value.source !== 'server' || value.type !== 'RECORD_PRECISION_RECEIPT') return false;
  if (!validId(value.commandId) || !validId(value.projectId) || !validId(value.sessionId) || !validRevision(value.expectedRuntimeRevision) || !validRevision(value.expectedComplexRevision)) return false;
  if (typeof value.issuedAt !== 'string' || !Number.isFinite(Date.parse(value.issuedAt)) || !record(value.payload)) return false;
  return noUnknownKeys(value.payload, ['receiptId', 'receiptDigest']) && validId(value.payload.receiptId) && typeof value.payload.receiptDigest === 'string' && SHA256.test(value.payload.receiptDigest);
}
