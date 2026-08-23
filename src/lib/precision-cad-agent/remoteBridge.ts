import {
  isAgentBridgeInputSecretFree,
  type AgentToolCallInput,
  type AgentToolCallOutput,
  type AgentToolCatalog,
  type AiAgentTurnInput,
  type AiAgentTurnOutput,
} from './tauriBridge';
import {
  REMOTE_PRECISION_CAD_CONTRACT_VERSION,
  validateRemotePrecisionCadToolDefinitions,
  type RemotePrecisionCadProjectBinding,
} from './remoteCadContract';
import type { PrecisionCadAgentExecutor, PrecisionCadExecutionContext } from './executor';

const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = 320 * 1024;
const ROOT = '/api/nexyfab/projects';
const AGENT_PATH = 'precision-cad-agent';

export type RemotePrecisionCadErrorCode =
  | 'PROJECT_BINDING_REQUIRED'
  | 'REMOTE_INPUT_REJECTED'
  | 'REMOTE_AUTH_REQUIRED'
  | 'REMOTE_REVISION_CONFLICT'
  | 'REMOTE_RATE_LIMIT'
  | 'REMOTE_REQUEST_FAILED'
  | 'REMOTE_INVALID_RESPONSE';

export class RemotePrecisionCadError extends Error {
  readonly code: RemotePrecisionCadErrorCode;

  constructor(code: RemotePrecisionCadErrorCode) {
    super(code);
    this.name = 'RemotePrecisionCadError';
    this.code = code;
  }
}

export type RemoteFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type RemoteEnvelope = { ok?: unknown; tools?: unknown; assistant_text?: unknown; tool_calls?: unknown; provider_state?: unknown; finish_status?: unknown; tool?: unknown; scope?: unknown; result?: unknown; error?: unknown; approvalToken?: unknown };

function bindingOf(context: PrecisionCadExecutionContext): RemotePrecisionCadProjectBinding {
  const binding = context.binding;
  if (!binding || !binding.projectId?.trim() || !Number.isSafeInteger(binding.revision) || binding.revision < 0 || !Number.isSafeInteger(binding.updatedAt) || binding.updatedAt <= 0) {
    throw new RemotePrecisionCadError('PROJECT_BINDING_REQUIRED');
  }
  return { projectId: binding.projectId.trim(), revision: binding.revision, updatedAt: binding.updatedAt };
}

function route(binding: RemotePrecisionCadProjectBinding, operation: 'catalog' | 'turn' | 'call'): string {
  const projectId = encodeURIComponent(binding.projectId);
  return `${ROOT}/${projectId}/${AGENT_PATH}/${operation}`;
}

function httpCode(response: Response): RemotePrecisionCadErrorCode {
  if (response.status === 401 || response.status === 403) return 'REMOTE_AUTH_REQUIRED';
  if (response.status === 409) return 'REMOTE_REVISION_CONFLICT';
  if (response.status === 429) return 'REMOTE_RATE_LIMIT';
  return 'REMOTE_REQUEST_FAILED';
}

async function parseEnvelope(response: Response): Promise<RemoteEnvelope> {
  let text: string;
  try { text = await response.text(); } catch { throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE'); }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE');
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE'); }
  if (!parsed || typeof parsed !== 'object') throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE');
  return parsed as RemoteEnvelope;
}

async function readEnvelope(response: Response): Promise<RemoteEnvelope> {
  if (!response.ok) throw new RemotePrecisionCadError(httpCode(response));
  const envelope = await parseEnvelope(response);
  if (envelope.ok !== true) throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE');
  return envelope;
}

function secretFreeBody(body: Record<string, unknown>, allowApprovalToken: boolean): boolean {
  if (!allowApprovalToken) return isAgentBridgeInputSecretFree(body);
  const { approvalToken, ...publicBody } = body;
  return typeof approvalToken === 'string'
    && /^[A-Za-z0-9_-]{32,128}$/.test(approvalToken)
    && isAgentBridgeInputSecretFree(publicBody);
}

async function requestRemote(
  url: string,
  body: Record<string, unknown>,
  fetcher: RemoteFetch,
  allowApprovalToken = false,
): Promise<{ response: Response; envelope: RemoteEnvelope }> {
  if (!secretFreeBody(body, allowApprovalToken)) throw new RemotePrecisionCadError('REMOTE_INPUT_REJECTED');
  let serialized: string;
  try { serialized = JSON.stringify(body); } catch { throw new RemotePrecisionCadError('REMOTE_INPUT_REJECTED'); }
  if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST_BYTES) throw new RemotePrecisionCadError('REMOTE_INPUT_REJECTED');
  let response: Response;
  try {
    response = await fetcher(url, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: serialized,
    });
  } catch { throw new RemotePrecisionCadError('REMOTE_REQUEST_FAILED'); }
  return { response, envelope: await parseEnvelope(response) };
}

async function postRemote(
  url: string,
  body: Record<string, unknown>,
  fetcher: RemoteFetch,
): Promise<RemoteEnvelope> {
  const { response, envelope } = await requestRemote(url, body, fetcher);
  if (!response.ok) throw new RemotePrecisionCadError(httpCode(response));
  if (envelope.ok !== true) throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE');
  return envelope;
}

function defaultFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

function catalogValue(envelope: RemoteEnvelope): AgentToolCatalog {
  if (!Array.isArray(envelope.tools)) throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE');
  if (validateRemotePrecisionCadToolDefinitions(envelope.tools).length > 0) throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE');
  return envelope.tools as AgentToolCatalog;
}

function turnValue(envelope: RemoteEnvelope): AiAgentTurnOutput {
  if (typeof envelope.assistant_text !== 'string' || !Array.isArray(envelope.tool_calls) || !envelope.provider_state || typeof envelope.provider_state !== 'object') {
    throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE');
  }
  return {
    assistant_text: envelope.assistant_text,
    tool_calls: envelope.tool_calls as AiAgentTurnOutput['tool_calls'],
    provider_state: envelope.provider_state as AiAgentTurnOutput['provider_state'],
    finish_status: envelope.finish_status === 'tool_calls' ? 'tool_calls' : envelope.finish_status === 'completed' ? 'completed' : 'unknown',
  };
}

function toolValue(input: AgentToolCallInput, envelope: RemoteEnvelope): AgentToolCallOutput {
  if (typeof envelope.tool !== 'string' || typeof envelope.scope !== 'string' || !('result' in envelope)) throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE');
  return { runId: input.runId, callId: input.call.callId, ok: true, result: envelope.result };
}

export function createRemotePrecisionCadExecutor(fetcher: RemoteFetch = defaultFetch): PrecisionCadAgentExecutor {
  return {
    async catalog(context) {
      const binding = bindingOf(context);
      const query = new URLSearchParams({
        contractVersion: REMOTE_PRECISION_CAD_CONTRACT_VERSION,
        revision: String(binding.revision),
        updatedAt: String(binding.updatedAt),
      });
      const url = `${route(binding, 'catalog')}?${query.toString()}`;
      let response: Response;
      try { response = await fetcher(url, { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' } }); }
      catch { throw new RemotePrecisionCadError('REMOTE_REQUEST_FAILED'); }
      return catalogValue(await readEnvelope(response));
    },
    async turn(input: AiAgentTurnInput, context) {
      const binding = bindingOf(context);
      if (!context.runId?.trim()) throw new RemotePrecisionCadError('REMOTE_INPUT_REJECTED');
      const envelope = await postRemote(route(binding, 'turn'), {
        contractVersion: REMOTE_PRECISION_CAD_CONTRACT_VERSION,
        runId: context.runId,
        // The run id is generated once by the controller and remains stable
        // across a network retry. The server binds it to the authenticated
        // user/project/revision and rejects reuse for a different request.
        ...(!input.prior_provider_state ? { idempotencyKey: context.runId } : {}),
        binding,
        provider: input.provider,
        model: input.model,
        instructions: input.instructions,
        input: input.input.map(item => {
          if (item.role === 'system' || item.role === 'developer') throw new RemotePrecisionCadError('REMOTE_INPUT_REJECTED');
          return {
            role: item.role,
            content: item.content,
            ...(item.call_id ? { callId: item.call_id } : {}),
            ...(item.name ? { name: item.name } : {}),
            ...(item.is_error !== undefined ? { isError: item.is_error } : {}),
          };
        }),
        tools: input.tools,
        scope: 'read',
        prior_provider_state: input.prior_provider_state,
      }, fetcher);
      return turnValue(envelope);
    },
    async tool(input, context) {
      const binding = bindingOf(context);
      if (!context.continuationId?.trim()) throw new RemotePrecisionCadError('REMOTE_INPUT_REJECTED');
      const url = route(binding, 'call');
      const baseBody = {
        contractVersion: REMOTE_PRECISION_CAD_CONTRACT_VERSION,
        binding,
        continuationId: context.continuationId,
        call: {
          callId: input.call.callId,
          name: input.call.toolName,
          arguments: input.call.arguments,
          scope: input.call.scope,
        },
      };
      const needsApproval = input.call.scope === 'apply' || input.call.scope === 'export';
      let envelope: RemoteEnvelope;
      if (!needsApproval) {
        envelope = await postRemote(url, { ...baseBody, approved: false }, fetcher);
      } else {
        // The controller's immutable local approval proves that the user
        // clicked Approve. It is never sent as a server credential. Request a
        // short, server-bound HMAC challenge and immediately redeem it for the
        // exact project/revision/tool/arguments tuple.
        if (!input.approvalBinding) throw new RemotePrecisionCadError('REMOTE_INPUT_REJECTED');
        const challenged = await requestRemote(url, { ...baseBody, approved: false }, fetcher);
        const error = challenged.envelope.error as { code?: unknown } | undefined;
        if (challenged.response.status !== 409
          || error?.code !== 'APPROVAL_REQUIRED'
          || typeof challenged.envelope.approvalToken !== 'string') {
          throw new RemotePrecisionCadError(httpCode(challenged.response));
        }
        const redeemed = await requestRemote(url, {
          ...baseBody,
          approved: true,
          approvalToken: challenged.envelope.approvalToken,
        }, fetcher, true);
        if (!redeemed.response.ok) throw new RemotePrecisionCadError(httpCode(redeemed.response));
        if (redeemed.envelope.ok !== true) throw new RemotePrecisionCadError('REMOTE_INVALID_RESPONSE');
        envelope = redeemed.envelope;
      }
      return toolValue(input, envelope);
    },
  };
}
