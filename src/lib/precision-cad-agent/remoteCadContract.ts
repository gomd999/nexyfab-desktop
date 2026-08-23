/**
 * Browser-to-server contract for remote Precision CAD turns.
 *
 * This module is deliberately pure. Route handlers still own authentication,
 * project ACL checks, database reads, queueing, and object-store access. These
 * helpers make it difficult for those handlers to accidentally accept a stale
 * project, an arbitrary tool/scope, or an object key outside the project
 * namespace.
 */

export const REMOTE_PRECISION_CAD_CONTRACT_VERSION = 'nexyfab.remote-precision-cad.v1' as const;

export const REMOTE_PRECISION_CAD_LIMITS = {
  maxInstructionsBytes: 32 * 1024,
  maxInputItems: 40,
  maxInputContentBytes: 96 * 1024,
  maxTools: 8,
  maxToolDescriptionBytes: 4 * 1024,
  maxToolSchemaBytes: 24 * 1024,
  maxToolCalls: 1,
  maxToolArgumentsBytes: 64 * 1024,
  maxAssistantTextBytes: 128 * 1024,
  maxArtifacts: 32,
  maxObjectKeyLength: 512,
  maxArtifactFilenameLength: 255,
  maxArtifactBytes: 500 * 1024 * 1024,
} as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MEDIA_TYPE = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,126}$/;

export type RemotePrecisionCadProvider = 'openai' | 'anthropic';
export type RemotePrecisionCadScope = 'read' | 'propose' | 'apply' | 'export';
export type RemotePrecisionCadToolName = keyof typeof REMOTE_PRECISION_CAD_TOOL_SCOPES;

/** The native installer catalog is the only remote catalog in this phase. */
export const REMOTE_PRECISION_CAD_TOOL_SCOPES = {
  list_domains: 'read',
  build_assembly: 'apply',
  analyze_dfm: 'read',
  fab_estimate: 'propose',
  resolve_constraints: 'propose',
  render_preview: 'propose',
  blade_ring: 'apply',
  loft_part: 'apply',
} as const satisfies Record<string, RemotePrecisionCadScope>;

export type RemotePrecisionCadProjectBinding = {
  projectId: string;
  /** Append-only CAD revision from nf_cad_workspace_revisions. */
  revision: number;
  /** nf_projects.updated_at CAS token for the cloud project row. */
  updatedAt: number;
};

export type RemotePrecisionCadToolDefinition = {
  name: RemotePrecisionCadToolName;
  description: string;
  parameters: Record<string, unknown>;
  scope: RemotePrecisionCadScope;
};

export type RemotePrecisionCadInputItem = {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  callId?: string;
  name?: RemotePrecisionCadToolName;
  isError?: boolean;
};

export type RemotePrecisionCadTurnRequest = {
  contractVersion: typeof REMOTE_PRECISION_CAD_CONTRACT_VERSION;
  runId: string;
  binding: RemotePrecisionCadProjectBinding;
  provider: RemotePrecisionCadProvider;
  model: string;
  instructions: string;
  input: RemotePrecisionCadInputItem[];
  tools: RemotePrecisionCadToolDefinition[];
  scope: RemotePrecisionCadScope;
  /** Client-generated key for the first provider turn. It must be reused for
   * a network retry; continuation turns use their signed continuationId. */
  idempotencyKey?: string;
};

export type RemotePrecisionCadToolCall = {
  callId: string;
  name: RemotePrecisionCadToolName;
  arguments: Record<string, unknown>;
  scope: RemotePrecisionCadScope;
};

export type RemotePrecisionCadArtifactKind = 'model' | 'preview' | 'report';

export type RemotePrecisionCadArtifact = {
  artifactId: string;
  projectId: string;
  revision: number;
  kind: RemotePrecisionCadArtifactKind;
  objectKey: string;
  filename: string;
  mediaType: string;
  format: string;
  byteLength: number;
  contentSha256: string;
  immutabilityState: 'IMMUTABLE';
};

export type RemotePrecisionCadTurnResult = {
  contractVersion: typeof REMOTE_PRECISION_CAD_CONTRACT_VERSION;
  runId: string;
  binding: RemotePrecisionCadProjectBinding;
  assistantText: string;
  toolCalls: RemotePrecisionCadToolCall[];
  artifacts: RemotePrecisionCadArtifact[];
  previewArtifactId?: string;
  continuationId?: string;
  finishStatus: 'completed' | 'tool_call' | 'failed';
};

export type RemotePrecisionCadErrorCode =
  | 'AUTH_REQUIRED'
  | 'PROJECT_NOT_FOUND'
  | 'PROJECT_ACCESS_DENIED'
  | 'REVISION_STALE'
  | 'CATALOG_INVALID'
  | 'TOOL_NOT_ALLOWED'
  | 'SCOPE_NOT_ALLOWED'
  | 'ARTIFACT_NOT_FOUND'
  | 'ARTIFACT_BINDING_MISMATCH'
  | 'QUEUE_UNAVAILABLE'
  | 'WORKER_FAILED'
  | 'RESULT_INVALID'
  | 'CANCELLED'
  | 'REMOTE_EXECUTION_FAILED';

export type RemotePrecisionCadError = {
  code: RemotePrecisionCadErrorCode;
  retryable: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasUnsafeControl(value: string): boolean {
  // Permit ordinary multiline CAD instructions, but reject NUL, DEL, and
  // non-whitespace C0 controls that can corrupt logs, headers, or object keys.
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function hasAnyControl(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validText(value: unknown, maxBytes: number, allowEmpty = false): value is string {
  return typeof value === 'string'
    && (allowEmpty || value.trim().length > 0)
    && !hasUnsafeControl(value)
    && utf8Bytes(value) <= maxBytes;
}

function boundedJson(value: unknown, maxBytes: number, maxDepth = 8): boolean {
  const seen = new Set<object>();
  let nodes = 0;
  const walk = (candidate: unknown, depth: number): boolean => {
    nodes += 1;
    if (nodes > 1_000 || depth > maxDepth) return false;
    if (candidate === null || typeof candidate === 'boolean') return true;
    if (typeof candidate === 'number') return Number.isFinite(candidate);
    if (typeof candidate === 'string') return !hasUnsafeControl(candidate) && utf8Bytes(candidate) <= maxBytes;
    if (typeof candidate !== 'object') return false;
    if (seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      if (candidate.length > 128 || !candidate.every(item => walk(item, depth + 1))) return false;
    } else {
      const entries = Object.entries(candidate);
      if (entries.length > 128 || entries.some(([key, item]) => !validText(key, 128) || !walk(item, depth + 1))) return false;
    }
    seen.delete(candidate);
    return true;
  };
  if (!walk(value, 0)) return false;
  try { return utf8Bytes(JSON.stringify(value)) <= maxBytes; } catch { return false; }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value);
}

function validOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_OPAQUE_ID.test(value);
}

function validRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function validateRemotePrecisionCadBinding(value: unknown): string[] {
  if (!isRecord(value)) return ['binding_invalid'];
  const issues: string[] = [];
  if (!validId(value.projectId)) issues.push('project_id_invalid');
  if (!validRevision(value.revision)) issues.push('revision_invalid');
  if (typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt <= 0) issues.push('updated_at_invalid');
  return issues;
}

export function compareRemotePrecisionCadBinding(
  expected: RemotePrecisionCadProjectBinding,
  actual: RemotePrecisionCadProjectBinding,
): string[] {
  const issues = [...validateRemotePrecisionCadBinding(expected), ...validateRemotePrecisionCadBinding(actual)];
  if (issues.length) return [...new Set(issues)];
  if (expected.projectId !== actual.projectId) issues.push('project_binding_mismatch');
  if (expected.revision !== actual.revision) issues.push('revision_stale');
  if (expected.updatedAt !== actual.updatedAt) issues.push('updated_at_stale');
  return [...new Set(issues)];
}

export function canonicalRemotePrecisionCadScope(
  name: unknown,
  args?: unknown,
): RemotePrecisionCadScope | null {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(REMOTE_PRECISION_CAD_TOOL_SCOPES, name)) return null;
  if (name === 'render_preview' && isRecord(args) && typeof args.outDir === 'string' && args.outDir.trim()) return 'export';
  return REMOTE_PRECISION_CAD_TOOL_SCOPES[name as RemotePrecisionCadToolName];
}

export function validateRemotePrecisionCadToolCall(value: unknown): string[] {
  if (!isRecord(value)) return ['tool_call_invalid'];
  const issues: string[] = [];
  const canonical = canonicalRemotePrecisionCadScope(value.name, value.arguments);
  if (!canonical) issues.push('tool_not_allowed');
  if (!isRecord(value.arguments) || !boundedJson(value.arguments, REMOTE_PRECISION_CAD_LIMITS.maxToolArgumentsBytes)) issues.push('tool_arguments_invalid');
  if (!validOpaqueId(value.callId)) issues.push('tool_call_id_invalid');
  if (value.scope !== canonical) issues.push(canonical === 'export' ? 'export_scope_required' : 'scope_mismatch');
  return [...new Set(issues)];
}

export function validateRemotePrecisionCadToolDefinitions(value: unknown): string[] {
  if (!Array.isArray(value) || value.length !== REMOTE_PRECISION_CAD_LIMITS.maxTools) return ['catalog_tool_count_invalid'];
  const names = new Set<string>();
  const issues: string[] = [];
  for (const item of value) {
    if (!isRecord(item)) { issues.push('catalog_tool_invalid'); continue; }
    const name = item.name;
    if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(REMOTE_PRECISION_CAD_TOOL_SCOPES, name) || names.has(name)) issues.push('catalog_tool_not_allowed');
    if (typeof name === 'string') names.add(name);
    const expected = typeof name === 'string' && Object.prototype.hasOwnProperty.call(REMOTE_PRECISION_CAD_TOOL_SCOPES, name)
      ? REMOTE_PRECISION_CAD_TOOL_SCOPES[name as RemotePrecisionCadToolName]
      : null;
    if (item.scope !== expected) issues.push('catalog_scope_mismatch');
    if (!validText(item.description, REMOTE_PRECISION_CAD_LIMITS.maxToolDescriptionBytes)) issues.push('catalog_description_invalid');
    if (!isRecord(item.parameters) || item.parameters.type !== 'object' || !boundedJson(item.parameters, REMOTE_PRECISION_CAD_LIMITS.maxToolSchemaBytes)) issues.push('catalog_schema_invalid');
  }
  for (const name of Object.keys(REMOTE_PRECISION_CAD_TOOL_SCOPES)) if (!names.has(name)) issues.push('catalog_tool_missing');
  return [...new Set(issues)];
}

function validateInputItem(value: unknown): string[] {
  if (!isRecord(value)) return ['input_item_invalid'];
  const issues: string[] = [];
  if (!['user', 'assistant', 'tool'].includes(String(value.role))) issues.push('input_role_invalid');
  if (!validText(value.content, REMOTE_PRECISION_CAD_LIMITS.maxInputContentBytes)) issues.push('input_content_invalid');
  if (value.callId !== undefined && !validOpaqueId(value.callId)) issues.push('input_call_id_invalid');
  if (value.name !== undefined && (typeof value.name !== 'string' || !Object.prototype.hasOwnProperty.call(REMOTE_PRECISION_CAD_TOOL_SCOPES, value.name))) issues.push('input_tool_not_allowed');
  if (value.role === 'tool' && (!validOpaqueId(value.callId) || typeof value.name !== 'string' || !Object.prototype.hasOwnProperty.call(REMOTE_PRECISION_CAD_TOOL_SCOPES, value.name))) issues.push('tool_input_binding_invalid');
  if (value.isError !== undefined && typeof value.isError !== 'boolean') issues.push('input_error_flag_invalid');
  return [...new Set(issues)];
}

export function validateRemotePrecisionCadTurnRequest(value: unknown): string[] {
  if (!isRecord(value)) return ['request_invalid'];
  const issues: string[] = [];
  if (value.contractVersion !== REMOTE_PRECISION_CAD_CONTRACT_VERSION) issues.push('contract_version_invalid');
  if (!validOpaqueId(value.runId)) issues.push('run_id_invalid');
  issues.push(...validateRemotePrecisionCadBinding(value.binding));
  if (value.provider !== 'openai' && value.provider !== 'anthropic') issues.push('provider_not_allowed');
  if (!validText(value.model, 256)) issues.push('model_invalid');
  if (!validText(value.instructions, REMOTE_PRECISION_CAD_LIMITS.maxInstructionsBytes)) issues.push('instructions_invalid');
  if (!Array.isArray(value.input) || value.input.length < 1 || value.input.length > REMOTE_PRECISION_CAD_LIMITS.maxInputItems) issues.push('input_count_invalid');
  else value.input.forEach(item => issues.push(...validateInputItem(item)));
  issues.push(...validateRemotePrecisionCadToolDefinitions(value.tools));
  if (!['read', 'propose', 'apply', 'export'].includes(String(value.scope))) issues.push('scope_not_allowed');
  if (value.idempotencyKey !== undefined && !validOpaqueId(value.idempotencyKey)) issues.push('idempotency_key_invalid');
  return [...new Set(issues)];
}

function validObjectKeyForProject(objectKey: unknown, projectId: string): boolean {
  if (typeof objectKey !== 'string' || objectKey.length > REMOTE_PRECISION_CAD_LIMITS.maxObjectKeyLength) return false;
  if (!objectKey.startsWith('private/') || hasAnyControl(objectKey) || objectKey.includes('\\')) return false;
  const segments = objectKey.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return false;
  const projectIndex = segments.indexOf('projects');
  return projectIndex >= 0 && segments[projectIndex + 1] === projectId;
}

function validateArtifact(value: unknown, binding: RemotePrecisionCadProjectBinding): string[] {
  if (!isRecord(value)) return ['artifact_invalid'];
  const issues: string[] = [];
  if (!validId(value.artifactId)) issues.push('artifact_id_invalid');
  if (value.projectId !== binding.projectId || !validId(value.projectId)) issues.push('artifact_project_mismatch');
  if (value.revision !== binding.revision) issues.push('artifact_revision_mismatch');
  if (!['model', 'preview', 'report'].includes(String(value.kind))) issues.push('artifact_kind_invalid');
  if (!validObjectKeyForProject(value.objectKey, binding.projectId)) issues.push('artifact_object_key_invalid');
  if (!validText(value.filename, REMOTE_PRECISION_CAD_LIMITS.maxArtifactFilenameLength) || hasAnyControl(String(value.filename)) || /[\\/]/.test(String(value.filename)) || String(value.filename).includes('..')) issues.push('artifact_filename_invalid');
  if (typeof value.mediaType !== 'string' || !MEDIA_TYPE.test(value.mediaType)) issues.push('artifact_media_type_invalid');
  if (!validText(value.format, 32)) issues.push('artifact_format_invalid');
  if (typeof value.byteLength !== 'number' || !Number.isSafeInteger(value.byteLength) || value.byteLength <= 0 || value.byteLength > REMOTE_PRECISION_CAD_LIMITS.maxArtifactBytes) issues.push('artifact_size_invalid');
  if (typeof value.contentSha256 !== 'string' || !SHA256.test(value.contentSha256)) issues.push('artifact_hash_invalid');
  if (value.immutabilityState !== 'IMMUTABLE') issues.push('artifact_not_immutable');
  return [...new Set(issues)];
}

export function validateRemotePrecisionCadTurnResult(
  value: unknown,
  expected: { runId: string; binding: RemotePrecisionCadProjectBinding },
): string[] {
  if (!isRecord(value)) return ['result_invalid'];
  const issues: string[] = [];
  if (value.contractVersion !== REMOTE_PRECISION_CAD_CONTRACT_VERSION) issues.push('contract_version_invalid');
  if (value.runId !== expected.runId) issues.push('run_id_mismatch');
  issues.push(...compareRemotePrecisionCadBinding(expected.binding, value.binding as RemotePrecisionCadProjectBinding));
  if (!validText(value.assistantText, REMOTE_PRECISION_CAD_LIMITS.maxAssistantTextBytes, true)) issues.push('assistant_text_invalid');
  if (!Array.isArray(value.toolCalls) || value.toolCalls.length > REMOTE_PRECISION_CAD_LIMITS.maxToolCalls) issues.push('tool_call_count_invalid');
  else value.toolCalls.forEach(call => issues.push(...validateRemotePrecisionCadToolCall(call)));
  if (!Array.isArray(value.artifacts) || value.artifacts.length > REMOTE_PRECISION_CAD_LIMITS.maxArtifacts) issues.push('artifact_count_invalid');
  else {
    const ids = new Set<string>();
    const keys = new Set<string>();
    for (const artifact of value.artifacts) {
      issues.push(...validateArtifact(artifact, expected.binding));
      if (isRecord(artifact)) {
        if (ids.has(String(artifact.artifactId))) issues.push('duplicate_artifact_id');
        if (keys.has(String(artifact.objectKey))) issues.push('duplicate_artifact_object_key');
        ids.add(String(artifact.artifactId));
        keys.add(String(artifact.objectKey));
      }
    }
    if (value.previewArtifactId !== undefined && (!validId(value.previewArtifactId) || !value.artifacts.some(item => isRecord(item) && item.artifactId === value.previewArtifactId && item.kind === 'preview'))) issues.push('preview_artifact_invalid');
  }
  if (value.continuationId !== undefined && !validOpaqueId(value.continuationId)) issues.push('continuation_id_invalid');
  if (!['completed', 'tool_call', 'failed'].includes(String(value.finishStatus))) issues.push('finish_status_invalid');
  return [...new Set(issues)];
}

export function validateRemotePrecisionCadApply(
  input: { binding: RemotePrecisionCadProjectBinding; current: RemotePrecisionCadProjectBinding; scope: unknown; result: unknown },
): string[] {
  const issues = compareRemotePrecisionCadBinding(input.binding, input.current);
  if (input.scope !== 'apply' && input.scope !== 'export') issues.push('apply_scope_not_allowed');
  issues.push(...validateRemotePrecisionCadTurnResult(input.result, { runId: isRecord(input.result) && typeof input.result.runId === 'string' ? input.result.runId : '', binding: input.binding }));
  return [...new Set(issues)];
}

const ERROR_RETRYABLE: Record<RemotePrecisionCadErrorCode, boolean> = {
  AUTH_REQUIRED: false,
  PROJECT_NOT_FOUND: false,
  PROJECT_ACCESS_DENIED: false,
  REVISION_STALE: false,
  CATALOG_INVALID: false,
  TOOL_NOT_ALLOWED: false,
  SCOPE_NOT_ALLOWED: false,
  ARTIFACT_NOT_FOUND: false,
  ARTIFACT_BINDING_MISMATCH: false,
  QUEUE_UNAVAILABLE: true,
  WORKER_FAILED: true,
  RESULT_INVALID: false,
  CANCELLED: false,
  REMOTE_EXECUTION_FAILED: true,
};

export function normalizeRemotePrecisionCadError(value: unknown): RemotePrecisionCadError {
  const code = isRecord(value) && typeof value.code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_RETRYABLE, value.code)
    ? value.code as RemotePrecisionCadErrorCode
    : 'REMOTE_EXECUTION_FAILED';
  return { code, retryable: ERROR_RETRYABLE[code] };
}
