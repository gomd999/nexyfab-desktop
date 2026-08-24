import type { AiDesignInputEvent } from './aiDesignInputAdapter';
import type { AiDesignWorkspaceRuntimeAction } from './aiDesignWorkspaceRuntime';
import type { GaugeStepMode } from './aiDesignComparisonGaugeUx';
import type { ModelSelectionMode, ModelSelectionRisk, ModelSelectionCapability } from './modelSelectionPolicy';

export const AI_DESIGN_WORKSPACE_COMMAND_V2_SCHEMA = 'nexyfab.ai-design-workspace-command.v2' as const;
export const AI_DESIGN_WORKSPACE_SERVER_COMMAND_V2_SCHEMA = 'nexyfab.ai-design-workspace-server-command.v2' as const;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_COMMAND_BYTES = 256 * 1024;
const MAX_INPUTS = 20;
const FORBIDDEN_KEY = /(evidence|receipt|artifact|geometry|provider|runtime|deployment|validation|signature|secret|token|credential|raw)/i;

export interface WorkspaceCommandEnvelopeV2 {
  schema: typeof AI_DESIGN_WORKSPACE_COMMAND_V2_SCHEMA;
  commandId: string;
  projectId: string;
  sessionId: string;
  expectedRuntimeRevision: number;
  issuedAt: string;
}

export interface PublicModelSelectionV2 {
  mode: ModelSelectionMode;
  /** Public catalog identifier only. It is not a provider deployment name. */
  modelId?: string | null;
  task?: { kind?: string; complexity?: 'simple' | 'moderate' | 'complex'; requiredCapabilities?: readonly ModelSelectionCapability[]; requiresVision?: boolean };
  input?: { kind?: 'text' | 'structured' | 'image' | 'mixed'; hasImage?: boolean; requiresVision?: boolean };
  risk?: ModelSelectionRisk;
  capabilities?: readonly ModelSelectionCapability[];
  constraints?: { requiredTier?: 'free' | 'pro' | 'enterprise'; maxLatencyClass?: 'fast' | 'standard' };
}

export type AiDesignWorkspaceClientCommandV2 = WorkspaceCommandEnvelopeV2 & (
  | { type: 'REQUEST_UNDERSTANDING_CONFIRMATION'; payload: { acknowledged: boolean } }
  | { type: 'INGEST_INPUTS'; payload: { inputs: readonly AiDesignInputEvent[] } }
  | { type: 'START_GENERATION_REQUEST'; payload: { runId: string; modelSelection: PublicModelSelectionV2 } }
  | { type: 'RETRY_GENERATION_REQUEST'; payload: { allowModelFallback: boolean } }
  | { type: 'RUN_GENERATION_STAGE_REQUEST'; payload: Record<string, never> }
  | { type: 'SELECT_CANDIDATE'; payload: { candidateId: string } }
  | { type: 'BEGIN_PARAMETRIC_EDIT'; payload: Record<string, never> }
  | { type: 'ADJUST_GAUGE'; payload: { gaugeId: string; mode: GaugeStepMode; direction: 1 | -1 } }
  | { type: 'REQUEST_PRECISION'; payload: Record<string, never> }
  | { type: 'CANCEL'; payload: { reason?: string } }
  | { type: 'RESUME'; payload: Record<string, never> }
);

/** Server-only completions. These are never accepted by parseAiDesignWorkspaceClientCommandV2. */
export type AiDesignWorkspaceServerCommandV2 = {
  schema: typeof AI_DESIGN_WORKSPACE_SERVER_COMMAND_V2_SCHEMA;
  source: 'server';
  commandId: string;
  projectId: string;
  sessionId: string;
  expectedRuntimeRevision: number;
  issuedAt: string;
} & (
  | { type: 'UNDERSTANDING_CONFIRMED'; payload: { receiptId: string; evidenceDigest: string; missingInput: boolean } }
  | { type: 'GENERATION_STAGE_COMPLETED'; payload: { runId: string; stage: string; outputDigest: string; source: string } }
  | { type: 'GENERATION_STAGE_FAILED'; payload: { runId: string; stage: string; reasonCode: string; retryable: boolean } }
  | { type: 'CANDIDATES_PUBLISHED'; payload: { artifactId: string; artifactDigest: string; evidenceDigest: string } }
  | { type: 'PRECISION_RECEIPT_RECORDED'; payload: { receiptId: string; receiptDigest: string } }
);

export type ParsedClientCommandV2 = { ok: true; command: AiDesignWorkspaceClientCommandV2 } | { ok: false; issues: readonly string[] };

function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function boundedString(value: unknown, max = 200): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function noUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function hasForbiddenKey(value: unknown, depth = 0): boolean {
  if (depth > 8) return true;
  if (Array.isArray(value)) return value.some(child => hasForbiddenKey(child, depth + 1));
  if (!record(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || hasForbiddenKey(child, depth + 1));
}
function commandBase(value: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (value.schema !== AI_DESIGN_WORKSPACE_COMMAND_V2_SCHEMA) issues.push('schema_invalid');
  if (!boundedString(value.commandId) || !ID.test(String(value.commandId))) issues.push('command_id_invalid');
  if (!boundedString(value.projectId) || !ID.test(String(value.projectId))) issues.push('project_id_invalid');
  if (!boundedString(value.sessionId) || !ID.test(String(value.sessionId))) issues.push('session_id_invalid');
  if (!Number.isSafeInteger(value.expectedRuntimeRevision) || Number(value.expectedRuntimeRevision) < 0) issues.push('runtime_revision_invalid');
  if (!boundedString(value.issuedAt) || !Number.isFinite(Date.parse(String(value.issuedAt)))) issues.push('issued_at_invalid');
  // The envelope itself intentionally contains expectedRuntimeRevision. Only
  // user-controlled payload fields are scanned for authority claims.
  if (hasForbiddenKey(value.payload)) issues.push('forbidden_authority_field');
  return issues;
}
function safeText(value: unknown, max = 200): value is string { return typeof value === 'string' && value.length <= max; }
function publicModel(value: unknown): value is PublicModelSelectionV2 {
  if (!record(value) || !noUnknownKeys(value, ['mode', 'modelId', 'task', 'input', 'risk', 'capabilities', 'constraints'])) return false;
  if (!['auto', 'quality', 'balanced', 'fast', 'manual'].includes(String(value.mode))) return false;
  if (value.modelId !== undefined && value.modelId !== null && (!boundedString(value.modelId) || !ID.test(value.modelId))) return false;
  if (value.risk !== undefined && !['low', 'medium', 'high', 'critical'].includes(String(value.risk))) return false;
  if (value.capabilities !== undefined && (!Array.isArray(value.capabilities) || value.capabilities.length > 6 || value.capabilities.some(item => !['vision', 'reasoning', 'precision-intent', 'structured-output'].includes(String(item))))) return false;
  for (const [key, allowed] of [['task', ['kind', 'complexity', 'requiredCapabilities', 'requiresVision']], ['input', ['kind', 'hasImage', 'requiresVision']], ['constraints', ['requiredTier', 'maxLatencyClass']]] as const) {
    const child = value[key];
    if (child !== undefined && (!record(child) || !noUnknownKeys(child, allowed))) return false;
  }
  if (record(value.task) && value.task.complexity !== undefined && !['simple', 'moderate', 'complex'].includes(String(value.task.complexity))) return false;
  if (record(value.task) && value.task.kind !== undefined && (!safeText(value.task.kind, 128) || !value.task.kind.trim())) return false;
  if (record(value.task) && value.task.requiresVision !== undefined && typeof value.task.requiresVision !== 'boolean') return false;
  if (record(value.task) && value.task.requiredCapabilities !== undefined && (!Array.isArray(value.task.requiredCapabilities) || value.task.requiredCapabilities.length > 6 || value.task.requiredCapabilities.some(item => !['vision', 'reasoning', 'precision-intent', 'structured-output'].includes(String(item))))) return false;
  if (record(value.input) && value.input.kind !== undefined && !['text', 'structured', 'image', 'mixed'].includes(String(value.input.kind))) return false;
  if (record(value.input) && value.input.hasImage !== undefined && typeof value.input.hasImage !== 'boolean') return false;
  if (record(value.input) && value.input.requiresVision !== undefined && typeof value.input.requiresVision !== 'boolean') return false;
  if (record(value.constraints) && (value.constraints.requiredTier !== undefined && !['free', 'pro', 'enterprise'].includes(String(value.constraints.requiredTier)))) return false;
  if (record(value.constraints) && value.constraints.maxLatencyClass !== undefined && !['fast', 'standard'].includes(String(value.constraints.maxLatencyClass))) return false;
  return true;
}

export function parseAiDesignWorkspaceClientCommandV2(value: unknown): ParsedClientCommandV2 {
  if (!record(value)) return { ok: false, issues: ['command_not_object'] };
  const issues = commandBase(value);
  if (!noUnknownKeys(value, ['schema', 'commandId', 'projectId', 'sessionId', 'expectedRuntimeRevision', 'issuedAt', 'type', 'payload'])) issues.push('unknown_command_key');
  if (!boundedString(value.type)) issues.push('command_type_invalid');
  const payload = value.payload;
  if (!record(payload)) return { ok: false, issues: [...new Set([...issues, 'payload_invalid'])] };
  if (issues.length) return { ok: false, issues: [...new Set(issues)] };
  let valid = false;
  switch (value.type) {
    case 'REQUEST_UNDERSTANDING_CONFIRMATION': valid = noUnknownKeys(payload, ['acknowledged']) && typeof payload.acknowledged === 'boolean'; break;
    case 'INGEST_INPUTS': valid = noUnknownKeys(payload, ['inputs']) && Array.isArray(payload.inputs) && payload.inputs.length > 0 && payload.inputs.length <= MAX_INPUTS; break;
    case 'START_GENERATION_REQUEST': valid = noUnknownKeys(payload, ['runId', 'modelSelection']) && boundedString(payload.runId) && ID.test(payload.runId) && publicModel(payload.modelSelection); break;
    case 'RETRY_GENERATION_REQUEST': valid = noUnknownKeys(payload, ['allowModelFallback']) && typeof payload.allowModelFallback === 'boolean'; break;
    case 'SELECT_CANDIDATE': valid = noUnknownKeys(payload, ['candidateId']) && boundedString(payload.candidateId) && ID.test(payload.candidateId); break;
    case 'BEGIN_PARAMETRIC_EDIT': case 'REQUEST_PRECISION': case 'RESUME': case 'RUN_GENERATION_STAGE_REQUEST': valid = noUnknownKeys(payload, []); break;
    case 'ADJUST_GAUGE': valid = noUnknownKeys(payload, ['gaugeId', 'mode', 'direction']) && boundedString(payload.gaugeId) && ID.test(payload.gaugeId) && ['fine', 'coarse'].includes(String(payload.mode)) && (payload.direction === 1 || payload.direction === -1); break;
    case 'CANCEL': valid = noUnknownKeys(payload, ['reason']) && (payload.reason === undefined || safeText(payload.reason, 500)); break;
    default: return { ok: false, issues: ['client_command_type_not_allowed'] };
  }
  if (!valid) return { ok: false, issues: ['payload_schema_invalid'] };
  return { ok: true, command: value as unknown as AiDesignWorkspaceClientCommandV2 };
}

export function isAiDesignWorkspaceClientCommandV2(value: unknown): value is AiDesignWorkspaceClientCommandV2 { return parseAiDesignWorkspaceClientCommandV2(value).ok; }
export function isAiDesignWorkspaceServerCommandV2(value: unknown): value is AiDesignWorkspaceServerCommandV2 {
  return record(value) && value.schema === AI_DESIGN_WORKSPACE_SERVER_COMMAND_V2_SCHEMA && value.source === 'server' && boundedString(value.commandId) && boundedString(value.projectId) && boundedString(value.sessionId);
}

/** Maps only commands whose payload is a user request into existing runtime actions. Server completions need trusted receipts and are intentionally excluded. */
export function clientCommandToRuntimeAction(command: AiDesignWorkspaceClientCommandV2): AiDesignWorkspaceRuntimeAction | null {
  const base = { actionId: command.commandId, expectedRevision: command.expectedRuntimeRevision };
  switch (command.type) {
    case 'SELECT_CANDIDATE': return { ...base, type: 'SELECT_CANDIDATE', candidateId: command.payload.candidateId };
    case 'BEGIN_PARAMETRIC_EDIT': return { ...base, type: 'BEGIN_PARAMETRIC_EDIT' };
    case 'ADJUST_GAUGE': return { ...base, type: 'ADJUST_GAUGE', ...command.payload };
    case 'REQUEST_PRECISION': return { ...base, type: 'REQUEST_PRECISION' };
    case 'CANCEL': return { ...base, type: 'CANCEL', reason: command.payload.reason };
    case 'RESUME': return { ...base, type: 'RESUME' };
    default: return null;
  }
}

export const AI_DESIGN_WORKSPACE_COMMAND_MAX_BYTES = MAX_COMMAND_BYTES;
export const aiDesignWorkspaceCommandV2 = { parse: parseAiDesignWorkspaceClientCommandV2, isClient: isAiDesignWorkspaceClientCommandV2, isServer: isAiDesignWorkspaceServerCommandV2, toRuntimeAction: clientCommandToRuntimeAction };
