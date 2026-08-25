export const AGENT_STATES = [
  'idle',
  'planning',
  'running_tool',
  'awaiting_approval',
  'revalidating',
  'queued',
  'completed',
  'failed',
  'cancelled',
] as const;

export type AgentRunState = (typeof AGENT_STATES)[number];
export type AgentProvider = 'openai' | 'anthropic' | 'local';
export type AgentToolScope = 'read' | 'propose' | 'apply' | 'export';

export type AgentRunRequest = {
  request: string;
  provider: AgentProvider;
  model: string;
};

export type AgentToolCall = {
  callId: string;
  toolName: string;
  arguments: Readonly<Record<string, unknown>>;
  scope: AgentToolScope;
};

export type AgentRunEvent = {
  sequence: number;
  at: string;
  type:
    | 'run_created'
    | 'state_changed'
    | 'tool_call_requested'
    | 'approval_requested'
    | 'approval_granted'
    | 'approval_rejected'
    | 'tool_result'
    | 'run_queued'
    | 'run_failed'
    | 'run_cancelled'
    | 'run_resumed'
    | 'run_retried';
  message: string;
  callId?: string;
  data?: Readonly<Record<string, unknown>>;
};

export type AgentApproval = {
  call: AgentToolCall;
  token: string;
  argumentsHash: string;
};

export type AgentRunLimits = {
  maxSteps: number;
  maxToolCalls: number;
};

export const DEFAULT_AGENT_RUN_LIMITS: Readonly<AgentRunLimits> = Object.freeze({
  maxSteps: 24,
  maxToolCalls: 32,
});

export type AgentRun = {
  readonly runId: string;
  readonly state: AgentRunState;
  readonly request: AgentRunRequest;
  readonly limits: Readonly<AgentRunLimits>;
  readonly steps: number;
  readonly toolCalls: number;
  readonly events: readonly AgentRunEvent[];
  readonly pendingApproval?: AgentApproval;
  readonly error?: string;
  readonly result?: unknown;
};

export type RunErrorCode =
  | 'INVALID_TRANSITION'
  | 'MAX_STEPS_EXCEEDED'
  | 'MAX_TOOL_CALLS_EXCEEDED'
  | 'APPROVAL_REQUIRED'
  | 'INVALID_APPROVAL_TOKEN'
  | 'APPROVAL_REJECTED'
  | 'SECRET_INPUT_REJECTED'
  | 'INVALID_ARGUMENTS';

export type RunFailure = { code: RunErrorCode; message: string };
export type RunResult = { ok: true; run: AgentRun } | { ok: false; run: AgentRun; error: RunFailure };

const TERMINAL_STATES = new Set<AgentRunState>(['queued', 'completed', 'failed', 'cancelled']);
const SECRET_KEY = /(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|private[-_]?key|secret|password|authorization|bearer|credential)/i;

function freeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value as Record<string, unknown>).forEach((child) => freeze(child));
  return Object.freeze(value);
}

function copy<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function containsSecretKey(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = containsSecretKey(item);
      if (found) return found;
    }
    return null;
  }
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) return key;
    const found = containsSecretKey(child);
    if (found) return found;
  }
  return null;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

/** Stable, synchronous digest suitable for binding approval tokens to a call. */
export function argumentsHash(value: unknown): string {
  let hash = 2166136261;
  for (const character of canonical(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function now(): string {
  return new Date().toISOString();
}

function event(run: AgentRun, type: AgentRunEvent['type'], message: string, extra: Partial<AgentRunEvent> = {}): AgentRunEvent {
  return freeze({ sequence: run.events.length, at: now(), type, message, ...extra });
}

function withEvent(run: AgentRun, next: Partial<AgentRun>, type: AgentRunEvent['type'], message: string, extra: Partial<AgentRunEvent> = {}): AgentRun {
  const nextRun = { ...run, ...next, events: [...run.events, event(run, type, message, extra)] };
  return freeze(nextRun);
}

function failure(run: AgentRun, code: RunErrorCode, message: string): RunResult {
  return { ok: false, run, error: { code, message } };
}

function validLimits(limits?: Partial<AgentRunLimits>): AgentRunLimits {
  const maxSteps = Number.isInteger(limits?.maxSteps) && (limits?.maxSteps ?? 0) > 0 ? limits!.maxSteps! : DEFAULT_AGENT_RUN_LIMITS.maxSteps;
  const maxToolCalls = Number.isInteger(limits?.maxToolCalls) && (limits?.maxToolCalls ?? 0) > 0 ? limits!.maxToolCalls! : DEFAULT_AGENT_RUN_LIMITS.maxToolCalls;
  return { maxSteps, maxToolCalls };
}

export function createAgentRun(request: AgentRunRequest, runId = `run-${Date.now().toString(36)}`, limits?: Partial<AgentRunLimits>): AgentRun {
  const secretKey = containsSecretKey(request);
  if (secretKey) throw new Error(`SECRET_INPUT_REJECTED: ${secretKey}`);
  const run: AgentRun = {
    runId,
    state: 'idle',
    request: copy(request),
    limits: validLimits(limits),
    steps: 0,
    toolCalls: 0,
    events: [],
  };
  return withEvent(freeze(run), {}, 'run_created', 'Run created');
}

export function planRun(run: AgentRun): RunResult {
  if (run.state !== 'idle' && run.state !== 'cancelled' && run.state !== 'failed') return failure(run, 'INVALID_TRANSITION', `Cannot plan from ${run.state}.`);
  const type = run.state === 'failed' ? 'run_retried' : run.state === 'cancelled' ? 'run_resumed' : 'state_changed';
  return { ok: true, run: withEvent(run, { state: 'planning', error: undefined, pendingApproval: undefined }, type, type === 'state_changed' ? 'Planning started' : type === 'run_retried' ? 'Run retried' : 'Run resumed') };
}

export function requestToolCall(run: AgentRun, call: AgentToolCall): RunResult {
  if (run.state !== 'planning') return failure(run, 'INVALID_TRANSITION', `Cannot request a tool call from ${run.state}.`);
  const secretKey = containsSecretKey(call.arguments);
  if (secretKey) return failure(run, 'SECRET_INPUT_REJECTED', `Secret-like argument '${secretKey}' is not accepted.`);
  if (!call.callId || !call.toolName || !call.arguments || !call.scope) return failure(run, 'INVALID_ARGUMENTS', 'Tool call requires callId, toolName, arguments, and scope.');
  if (run.steps >= run.limits.maxSteps) return failure(run, 'MAX_STEPS_EXCEEDED', 'Maximum agent steps reached.');
  if (run.toolCalls >= run.limits.maxToolCalls) return failure(run, 'MAX_TOOL_CALLS_EXCEEDED', 'Maximum tool calls reached.');
  const safeCall = freeze({ ...call, arguments: copy(call.arguments) });
  const next = { steps: run.steps + 1, toolCalls: run.toolCalls + 1 };
  if (call.scope === 'apply' || call.scope === 'export') {
    const hash = argumentsHash(call.arguments);
    const approval: AgentApproval = freeze({ call: safeCall, argumentsHash: hash, token: `${run.runId}:${call.callId}:${hash}` });
    return { ok: true, run: withEvent(run, { ...next, state: 'awaiting_approval', pendingApproval: approval }, 'approval_requested', `Approval required for ${call.toolName}.`, { callId: call.callId, data: { toolName: call.toolName, scope: call.scope, argumentsHash: hash } }) };
  }
  return { ok: true, run: withEvent(run, { ...next, state: 'running_tool', pendingApproval: undefined }, 'tool_call_requested', `Running ${call.toolName}.`, { callId: call.callId }) };
}

export function approveToolCall(run: AgentRun, token: string): RunResult {
  if (run.state !== 'awaiting_approval' || !run.pendingApproval) return failure(run, 'INVALID_TRANSITION', `Cannot approve from ${run.state}.`);
  if (token !== run.pendingApproval.token || argumentsHash(run.pendingApproval.call.arguments) !== run.pendingApproval.argumentsHash) return failure(run, 'INVALID_APPROVAL_TOKEN', 'Approval token does not match this run, call, or arguments.');
  return { ok: true, run: withEvent(run, { state: 'running_tool' }, 'approval_granted', `Approved ${run.pendingApproval.call.toolName}.`, { callId: run.pendingApproval.call.callId }) };
}

export function rejectToolCall(run: AgentRun): RunResult {
  if (run.state !== 'awaiting_approval' || !run.pendingApproval) return failure(run, 'INVALID_TRANSITION', `Cannot reject from ${run.state}.`);
  return { ok: true, run: withEvent(run, { state: 'failed', pendingApproval: undefined, error: 'Approval rejected.' }, 'approval_rejected', `Approval rejected for ${run.pendingApproval.call.toolName}.`, { callId: run.pendingApproval.call.callId }) };
}

export function recordToolResult(run: AgentRun, result: unknown): RunResult {
  if (run.state !== 'running_tool') return failure(run, 'INVALID_TRANSITION', `Cannot record a tool result from ${run.state}.`);
  const secretKey = containsSecretKey(result);
  if (secretKey) return failure(run, 'SECRET_INPUT_REJECTED', `Secret-like result field '${secretKey}' is not retained.`);
  return { ok: true, run: withEvent(run, { state: 'planning', result: copy(result), pendingApproval: undefined }, 'tool_result', 'Tool result received') };
}

/** Stops browser continuation while an approved commercial mutation is owned
 * by the durable server queue. A fresh authoritative revision must be loaded
 * before another agent run can begin. */
export function queueRun(run: AgentRun, result: unknown): RunResult {
  if (run.state !== 'running_tool') return failure(run, 'INVALID_TRANSITION', `Cannot queue from ${run.state}.`);
  const secretKey = containsSecretKey(result);
  if (secretKey) return failure(run, 'SECRET_INPUT_REJECTED', `Secret-like result field '${secretKey}' is not retained.`);
  return { ok: true, run: withEvent(run, { state: 'queued', result: copy(result), pendingApproval: undefined }, 'run_queued', 'Commercial execution queued') };
}

export function beginRevalidation(run: AgentRun): RunResult {
  if (run.state !== 'planning') return failure(run, 'INVALID_TRANSITION', `Cannot revalidate from ${run.state}.`);
  return { ok: true, run: withEvent(run, { state: 'revalidating' }, 'state_changed', 'Revalidation started') };
}

export function completeRun(run: AgentRun, result?: unknown): RunResult {
  if (run.state !== 'revalidating') return failure(run, 'INVALID_TRANSITION', `Cannot complete from ${run.state}.`);
  const secretKey = containsSecretKey(result);
  if (secretKey) return failure(run, 'SECRET_INPUT_REJECTED', `Secret-like result field '${secretKey}' is not retained.`);
  return { ok: true, run: withEvent(run, { state: 'completed', result: copy(result), pendingApproval: undefined }, 'state_changed', 'Run completed') };
}

export function failRun(run: AgentRun, message: string): RunResult {
  if (TERMINAL_STATES.has(run.state)) return failure(run, 'INVALID_TRANSITION', `Cannot fail from ${run.state}.`);
  return { ok: true, run: withEvent(run, { state: 'failed', error: message, pendingApproval: undefined }, 'run_failed', message) };
}

export function cancelRun(run: AgentRun): RunResult {
  if (TERMINAL_STATES.has(run.state)) return failure(run, 'INVALID_TRANSITION', `Cannot cancel from ${run.state}.`);
  return { ok: true, run: withEvent(run, { state: 'cancelled', pendingApproval: undefined }, 'run_cancelled', 'Run cancelled') };
}

export function resumeRun(run: AgentRun): RunResult {
  if (run.state !== 'cancelled') return failure(run, 'INVALID_TRANSITION', `Cannot resume from ${run.state}.`);
  return planRun(run);
}

export function retryRun(run: AgentRun): RunResult {
  if (run.state !== 'failed') return failure(run, 'INVALID_TRANSITION', `Cannot retry from ${run.state}.`);
  return planRun(run);
}

export const transitionRun = planRun;
