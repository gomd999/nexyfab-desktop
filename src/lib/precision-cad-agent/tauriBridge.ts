import { argumentsHash, type AgentProvider, type AgentToolCall, type AgentToolScope } from './runState';

export type ExternalAgentProvider = Exclude<AgentProvider, 'local'>;

export type AiAgentInputItem = {
  role: 'user' | 'assistant' | 'system' | 'developer' | 'tool';
  content: string;
  call_id?: string;
  name?: string;
  is_error?: boolean;
};

export type CadToolDefinition = {
  name: string;
  description: string;
  parameters: Readonly<Record<string, unknown>>;
  scope: AgentToolScope;
};

export type ProviderState = {
  /** Opaque native handle; provider response history never crosses into the web layer. */
  handle: string;
};

/** Exact camel-to-snake serializable contract accepted by Rust ai_agent_turn. */
export type AiAgentTurnInput = {
  provider: ExternalAgentProvider;
  model: string;
  instructions: string;
  input: readonly AiAgentInputItem[];
  tools: readonly CadToolDefinition[];
  prior_provider_state?: ProviderState;
};

export type NormalizedToolCall = {
  call_id: string;
  name: string;
  arguments: Readonly<Record<string, unknown>>;
};

export type AiAgentTurnOutput = {
  assistant_text: string;
  tool_calls: readonly NormalizedToolCall[];
  provider_continuation_id?: string;
  provider_state?: ProviderState;
  finish_status: 'completed' | 'tool_calls' | 'incomplete' | 'unknown';
};

export type AgentToolCallInput = {
  runId: string;
  call: AgentToolCall;
  projectRoot: string;
  locale: string;
  approvalBinding?: string;
};

export type AgentToolCallOutput = {
  runId: string;
  callId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type AgentToolCatalog = readonly CadToolDefinition[];

type NativeAgentToolResult = {
  ok: boolean;
  tool: string;
  scope: string;
  profile: 'installer-core';
  result?: unknown;
  error_code?: string;
};

export type TauriInvoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

const SENSITIVE_KEY = /(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|private[-_]?key|secret|password|authorization|bearer|credential)/i;

function assertSecretFree(value: unknown, path = 'input'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${path}[${index}]`));
    return;
  }
  Object.entries(value).forEach(([key, child]) => {
    if (SENSITIVE_KEY.test(key)) throw new Error(`Secret-like field '${path}.${key}' is not accepted by the agent bridge.`);
    assertSecretFree(child, `${path}.${key}`);
  });
}

async function defaultInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(command, args);
}

/** Executes one provider turn. Credentials remain inside the native keyring bridge. */
export async function invokeAiAgentTurn(input: AiAgentTurnInput, invoke: TauriInvoke = defaultInvoke): Promise<AiAgentTurnOutput> {
  assertSecretFree(input);
  if (!input.model.trim() || !input.instructions.trim() || input.input.length === 0) throw new Error('model, instructions, and input are required.');
  if (input.provider !== 'openai' && input.provider !== 'anthropic') throw new Error('A desktop provider is required.');
  const request = {
    ...input,
    tools: input.tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
  };
  return invoke<AiAgentTurnOutput>('ai_agent_turn', { request });
}

/**
 * Executes one installer-core call. Approval is recomputed from the immutable
 * state-machine binding; an arbitrary truthy token is never converted to
 * native `approved: true`.
 */
export async function invokeAgentToolCall(input: AgentToolCallInput, invoke: TauriInvoke = defaultInvoke): Promise<AgentToolCallOutput> {
  assertSecretFree(input);
  if (!input.runId || !input.call.callId || !input.call.toolName || !input.projectRoot.trim()) throw new Error('run, tool call, and project root are required.');
  const needsApproval = input.call.scope === 'apply' || input.call.scope === 'export';
  const expectedToken = `${input.runId}:${input.call.callId}:${argumentsHash(input.call.arguments)}`;
  if (needsApproval && input.approvalBinding !== expectedToken) throw new Error('A matching approval token is required for apply/export calls.');
  const native = await invoke<NativeAgentToolResult>('agent_tool_call', {
    tool: input.call.toolName,
    args: input.call.arguments,
    projectRoot: input.projectRoot,
    scope: input.call.scope,
    approved: needsApproval,
    locale: input.locale,
  });
  return {
    runId: input.runId,
    callId: input.call.callId,
    ok: native.ok,
    result: native.result,
    error: native.error_code,
  };
}

/** Returns the native installer-core catalog already constrained to projectRoot. */
export async function invokeAgentToolCatalog(projectRoot: string, invoke: TauriInvoke = defaultInvoke): Promise<AgentToolCatalog> {
  assertSecretFree({ projectRoot });
  if (!projectRoot.trim()) throw new Error('project root is required.');
  return invoke<AgentToolCatalog>('agent_tool_catalog', { projectRoot });
}

export function isAgentBridgeInputSecretFree(value: unknown): boolean {
  try { assertSecretFree(value); return true; } catch { return false; }
}
