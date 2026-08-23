import { createHash } from 'node:crypto';
import {
  hashArchitectureInteriorEvidenceV2,
  validateArchitectureInteriorWorkspaceV2,
  type ArchitectureInteriorWorkspaceV2,
} from '@/lib/ai/architectureInteriorWorkspace';
import {
  ARCHITECTURE_INTERIOR_TOOL_CATALOG,
  validateArchitectureInteriorToolArguments,
  type ArchitectureInteriorToolScope,
} from './architectureInteriorToolCatalog';
import {
  executeArchitectureInteriorTool,
  type ArchitectureInteriorExecutorResult,
} from './architectureInteriorToolExecutor';

/**
 * Server-side boundary for the browser architecture/interior agent.
 *
 * The browser supplies only a structured call. The session and workspace are
 * loaded by the server before this function is called; there is intentionally
 * no provider, path, URL, credential, or client-authority field here.
 */
export const ARCHITECTURE_INTERIOR_BROWSER_GATEWAY_VERSION = 'nexyfab.architecture-interior-browser-gateway.v1' as const;
export const ARCHITECTURE_INTERIOR_SERVER_PROFILE = 'architecture-interior' as const;
export const ARCHITECTURE_INTERIOR_SERVER_DOMAIN = 'architecture-interior' as const;

export type ArchitectureInteriorBrowserRole = 'owner' | 'editor' | 'viewer';
export type ArchitectureInteriorBrowserSession = {
  sessionId: string;
  userId: string;
  role: ArchitectureInteriorBrowserRole;
  projectId: string;
  revision: number;
  contentHash: string;
  /** Loaded from the server-side revision store, never selected by the client. */
  workspace: ArchitectureInteriorWorkspaceV2;
  /** Action hashes recorded by the server after an explicit user approval. */
  approvedActionHashes?: readonly string[];
};

export type ArchitectureInteriorBrowserToolCall = {
  tool: string;
  arguments: unknown;
  requestedScope?: unknown;
  /** These fields are mismatch checks only; they never select a profile. */
  requestedProfile?: unknown;
  requestedDomain?: unknown;
  approval?: {
    approved: boolean;
    receiptHash?: string;
  };
};

export type ArchitectureInteriorBrowserErrorCode =
  | 'INVALID_SESSION'
  | 'INVALID_CALL'
  | 'INVALID_WORKSPACE'
  | 'PROJECT_BINDING_MISMATCH'
  | 'REVISION_STALE'
  | 'CONTENT_HASH_MISMATCH'
  | 'DOMAIN_MISMATCH'
  | 'PROFILE_MISMATCH'
  | 'TOOL_NOT_FOUND'
  | 'SCOPE_MISMATCH'
  | 'ARGUMENTS_INVALID'
  | 'CONTRACT_ONLY_TOOL'
  | 'EDITOR_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_INVALID'
  | 'TOOL_FAILED'
  | 'RESULT_TOO_LARGE';

export type ArchitectureInteriorBrowserAudit = {
  schema: typeof ARCHITECTURE_INTERIOR_BROWSER_GATEWAY_VERSION;
  auditId: string;
  receiptHash: string;
  sessionId: string;
  userId: string;
  projectId: string;
  revision: number;
  profile: typeof ARCHITECTURE_INTERIOR_SERVER_PROFILE;
  domain: typeof ARCHITECTURE_INTERIOR_SERVER_DOMAIN;
  tool: string;
  scope?: ArchitectureInteriorToolScope;
  status: 'completed' | 'rejected';
  code?: ArchitectureInteriorBrowserErrorCode;
  argumentsHash: string;
  workspaceHash: string;
  resultHash?: string;
};

export type ArchitectureInteriorBrowserFailure = {
  ok: false;
  code: ArchitectureInteriorBrowserErrorCode;
  statusKey: `architectureInterior.agent.${string}`;
  messageKey: `architectureInterior.agent.${string}`;
  audit: ArchitectureInteriorBrowserAudit;
};

export type ArchitectureInteriorBrowserSuccess = {
  ok: true;
  profile: typeof ARCHITECTURE_INTERIOR_SERVER_PROFILE;
  domain: typeof ARCHITECTURE_INTERIOR_SERVER_DOMAIN;
  tool: string;
  scope: ArchitectureInteriorToolScope;
  result: unknown;
  workspace?: ArchitectureInteriorWorkspaceV2;
  audit: ArchitectureInteriorBrowserAudit;
};

export type ArchitectureInteriorBrowserGatewayResult = ArchitectureInteriorBrowserSuccess | ArchitectureInteriorBrowserFailure;

const SHA256 = /^[a-f0-9]{64}$/;
const EXECUTABLE_READ_TOOLS = new Set(['get_project_context', 'list_storeys_spaces', 'inspect_element', 'verify_architecture', 'verify_interior', 'verify_space']);
const EXECUTABLE_CONCEPT_EDIT_TOOLS = new Set(['create_storey', 'edit_storey', 'create_wall', 'create_space', 'create_opening', 'create_grid', 'create_stair', 'create_shaft', 'create_elevator', 'create_service_opening', 'create_furniture', 'create_light', 'create_finish', 'create_millwork', 'create_ceiling_system', 'edit_wall', 'edit_space', 'edit_slab', 'edit_opening', 'edit_grid', 'edit_stair', 'edit_shaft', 'edit_elevator', 'edit_service_opening', 'edit_ceiling', 'edit_furniture', 'edit_light', 'edit_finish', 'edit_millwork', 'edit_ceiling_system']);
const MAX_RESULT_BYTES = 512 * 1024;
const MAX_WORKSPACE_RESULT_BYTES = 8 * 1024 * 1024;
const FORBIDDEN_KEY = /(?:api[-_]?key|credential|password|secret|token|provider|model|base64)/i;
const FORBIDDEN_VALUE = /(?:^[a-z]:[\\/]|^[\\/]{1,2}|^~[\\/]|^\\\\|\u0000|\b(?:https?|file|data):\/\/)/i;

function stableJson(value: unknown): string | null {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : json;
  } catch {
    return null;
  }
}

function hash(value: unknown): string {
  try { return hashArchitectureInteriorEvidenceV2(value); } catch { return createHash('sha256').update('invalid').digest('hex'); }
}

function containsForbiddenClientValue(value: unknown, key = '', seen = new Set<object>()): boolean {
  if (FORBIDDEN_KEY.test(key)) return true;
  if (typeof value === 'string') return FORBIDDEN_VALUE.test(value);
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return true;
  seen.add(value);
  const found = Array.isArray(value)
    ? value.some(item => containsForbiddenClientValue(item, key, seen))
    : Object.entries(value).some(([childKey, child]) => containsForbiddenClientValue(child, childKey, seen));
  seen.delete(value);
  return found;
}

function keyFor(code: ArchitectureInteriorBrowserErrorCode): `architectureInterior.agent.${string}` {
  return `architectureInterior.agent.${code.toLowerCase()}`;
}

/** Deterministic action hash stored server-side after explicit user approval. */
export function hashArchitectureInteriorBrowserApproval(input: {
  sessionId: string;
  userId: string;
  projectId: string;
  revision: number;
  contentHash: string;
  tool: string;
  arguments: unknown;
}): string {
  return hash({ schema: ARCHITECTURE_INTERIOR_BROWSER_GATEWAY_VERSION, purpose: 'approval', ...input, argumentsHash: hashArchitectureInteriorEvidenceV2(input.arguments) });
}

function makeAudit(input: {
  session: ArchitectureInteriorBrowserSession;
  call: ArchitectureInteriorBrowserToolCall;
  status: 'completed' | 'rejected';
  code?: ArchitectureInteriorBrowserErrorCode;
  scope?: ArchitectureInteriorToolScope;
  result?: unknown;
}): ArchitectureInteriorBrowserAudit {
  const base = {
    schema: ARCHITECTURE_INTERIOR_BROWSER_GATEWAY_VERSION,
    sessionId: input.session.sessionId,
    userId: input.session.userId,
    projectId: input.session.projectId,
    revision: input.session.revision,
    profile: ARCHITECTURE_INTERIOR_SERVER_PROFILE,
    domain: ARCHITECTURE_INTERIOR_SERVER_DOMAIN,
    tool: input.call.tool,
    ...(input.scope ? { scope: input.scope } : {}),
    status: input.status,
    ...(input.code ? { code: input.code } : {}),
    argumentsHash: hash(input.call.arguments),
    workspaceHash: input.session.contentHash,
    ...(input.result === undefined ? {} : { resultHash: hash(input.result) }),
  } satisfies Omit<ArchitectureInteriorBrowserAudit, 'auditId' | 'receiptHash'>;
  const receiptHash = hash(base);
  return { ...base, auditId: `architecture_interior_${receiptHash.slice(0, 24)}`, receiptHash };
}

function failure(session: ArchitectureInteriorBrowserSession, call: ArchitectureInteriorBrowserToolCall, code: ArchitectureInteriorBrowserErrorCode, scope?: ArchitectureInteriorToolScope): ArchitectureInteriorBrowserFailure {
  return { ok: false, code, statusKey: keyFor(code), messageKey: keyFor(code), audit: makeAudit({ session, call, status: 'rejected', code, scope }) };
}

function validSession(value: unknown): value is ArchitectureInteriorBrowserSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const session = value as Partial<ArchitectureInteriorBrowserSession>;
  return typeof session.sessionId === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(session.sessionId)
    && typeof session.userId === 'string' && /^[A-Za-z0-9_.:@-]{1,160}$/.test(session.userId)
    && ['owner', 'editor', 'viewer'].includes(String(session.role))
    && typeof session.projectId === 'string' && session.projectId.length > 0 && session.projectId.length <= 160
    && Number.isSafeInteger(session.revision) && (session.revision ?? -1) >= 0
    && typeof session.contentHash === 'string' && SHA256.test(session.contentHash)
    && (session.approvedActionHashes === undefined || (Array.isArray(session.approvedActionHashes) && session.approvedActionHashes.length <= 64 && session.approvedActionHashes.every(item => typeof item === 'string' && SHA256.test(item))))
    && Boolean(session.workspace && typeof session.workspace === 'object');
}

function validCall(value: unknown): value is ArchitectureInteriorBrowserToolCall {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const call = value as Partial<ArchitectureInteriorBrowserToolCall>;
  return typeof call.tool === 'string' && /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(call.tool)
    && call.arguments !== undefined && !containsForbiddenClientValue(call.arguments)
    && (call.approval === undefined || (typeof call.approval === 'object' && call.approval !== null && typeof call.approval.approved === 'boolean' && (call.approval.receiptHash === undefined || (typeof call.approval.receiptHash === 'string' && SHA256.test(call.approval.receiptHash)))));
}

function executorError(result: Extract<ArchitectureInteriorExecutorResult, { ok: false }>): ArchitectureInteriorBrowserErrorCode {
  switch (result.code) {
    case 'approval_required': return 'APPROVAL_REQUIRED';
    case 'workspace_invalid': return 'INVALID_WORKSPACE';
    case 'project_binding_mismatch': return 'PROJECT_BINDING_MISMATCH';
    case 'stale_revision': return 'REVISION_STALE';
    case 'content_hash_mismatch': return 'CONTENT_HASH_MISMATCH';
    case 'invalid_arguments': return 'ARGUMENTS_INVALID';
    case 'tool_not_executable': return 'CONTRACT_ONLY_TOOL';
    case 'edit_failed': return 'TOOL_FAILED';
    default: return 'TOOL_FAILED';
  }
}

/**
 * Execute one browser call against a server-owned architecture/interior
 * session. Exact/release and contract-only catalog entries are rejected before
 * the executor is reached, so this function cannot turn the catalog into an
 * unreviewed remote CAD adapter.
 */
export function executeArchitectureInteriorBrowserTool(input: {
  session: ArchitectureInteriorBrowserSession;
  call: ArchitectureInteriorBrowserToolCall;
}): ArchitectureInteriorBrowserGatewayResult {
  const { session, call } = input;
  if (!validSession(session)) {
    const safeSession = session && typeof session === 'object' ? session : ({ sessionId: 'invalid', userId: 'invalid', projectId: 'invalid', revision: 0, contentHash: '0'.repeat(64) } as ArchitectureInteriorBrowserSession);
    return failure(safeSession, validCall(call) ? call : { tool: 'invalid', arguments: {} }, 'INVALID_SESSION');
  }
  if (!validCall(call)) return failure(session, { tool: 'invalid', arguments: {} }, 'INVALID_CALL');
  const workspaceIssues = validateArchitectureInteriorWorkspaceV2(session.workspace);
  if (workspaceIssues.length) return failure(session, call, 'INVALID_WORKSPACE');
  if (session.workspace.projectId !== session.projectId || session.workspace.workspace.projectId !== session.projectId) return failure(session, call, 'PROJECT_BINDING_MISMATCH');
  if (session.workspace.workspace.revision !== session.revision) return failure(session, call, 'REVISION_STALE');
  if (session.workspace.contentHash !== session.contentHash || session.workspace.workspace.contentHash !== session.contentHash) return failure(session, call, 'CONTENT_HASH_MISMATCH');
  if (call.requestedProfile !== undefined && call.requestedProfile !== ARCHITECTURE_INTERIOR_SERVER_PROFILE) return failure(session, call, 'PROFILE_MISMATCH');
  if (call.requestedDomain !== undefined && call.requestedDomain !== 'building' && call.requestedDomain !== 'interior' && call.requestedDomain !== ARCHITECTURE_INTERIOR_SERVER_DOMAIN) return failure(session, call, 'DOMAIN_MISMATCH');

  const definition = ARCHITECTURE_INTERIOR_TOOL_CATALOG.find(item => item.name === call.tool);
  if (!definition) return failure(session, call, 'TOOL_NOT_FOUND');
  if (call.requestedScope !== undefined && call.requestedScope !== definition.scope) return failure(session, call, 'SCOPE_MISMATCH', definition.scope);
  const argumentIssues = validateArchitectureInteriorToolArguments(call.tool, call.arguments);
  if (argumentIssues.length) return failure(session, call, 'ARGUMENTS_INVALID', definition.scope);

  const isRead = definition.scope === 'read' && EXECUTABLE_READ_TOOLS.has(call.tool);
  const isConceptEdit = definition.scope === 'apply' && EXECUTABLE_CONCEPT_EDIT_TOOLS.has(call.tool)
    && session.workspace.workspace.track === 'ai_design' && session.workspace.workspace.maturity === 'concept';
  if (!isRead && !isConceptEdit) return failure(session, call, 'CONTRACT_ONLY_TOOL', definition.scope);
  if (isConceptEdit && session.role === 'viewer') return failure(session, call, 'EDITOR_REQUIRED', definition.scope);
  if (isConceptEdit) {
    if (call.approval?.approved !== true) return failure(session, call, 'APPROVAL_REQUIRED', definition.scope);
    const expected = hashArchitectureInteriorBrowserApproval({ sessionId: session.sessionId, userId: session.userId, projectId: session.projectId, revision: session.revision, contentHash: session.contentHash, tool: call.tool, arguments: call.arguments });
    if (call.approval.receiptHash !== expected || !session.approvedActionHashes?.includes(expected)) return failure(session, call, 'APPROVAL_INVALID', definition.scope);
  }

  const result = executeArchitectureInteriorTool({
    workspace: session.workspace,
    binding: { projectId: session.projectId, revision: session.revision, contentHash: session.contentHash },
    tool: call.tool,
    arguments: call.arguments,
    approved: isConceptEdit,
  });
  if (!result.ok) {
    const code = executorError(result);
    return failure(session, call, code, definition.scope);
  }
  const resultJson = stableJson(result.result);
  if (!resultJson || Buffer.byteLength(resultJson, 'utf8') > MAX_RESULT_BYTES) return failure(session, call, 'RESULT_TOO_LARGE', definition.scope);
  if (result.workspace) {
    const workspaceJson = stableJson(result.workspace);
    if (!workspaceJson || Buffer.byteLength(workspaceJson, 'utf8') > MAX_WORKSPACE_RESULT_BYTES) return failure(session, call, 'RESULT_TOO_LARGE', definition.scope);
  }
  const auditResult = { result: result.result, outputWorkspaceHash: result.workspace?.contentHash };
  const audit = makeAudit({ session, call, status: 'completed', scope: result.scope, result: auditResult });
  return { ok: true, profile: ARCHITECTURE_INTERIOR_SERVER_PROFILE, domain: ARCHITECTURE_INTERIOR_SERVER_DOMAIN, tool: result.tool, scope: result.scope, result: result.result, ...(result.workspace ? { workspace: result.workspace } : {}), audit };
}
