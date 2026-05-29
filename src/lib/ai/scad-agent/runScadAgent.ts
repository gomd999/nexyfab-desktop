/**
 * SCAD agent main loop.
 *
 * Orchestrates: model call → parse tool_calls → execute tools → append
 * results → loop until model has no more tool_calls or budget/wedge trips.
 *
 * Pluggable AI client + tool executors keep this file framework-free —
 * `runScadAgent` is testable end-to-end with a deterministic mock model.
 */
import type {
  AgentSession,
  AgentRunOptions,
  AgentEvent,
  AgentMessage,
  AiClient,
  ToolCall,
  ToolExecutor,
  ToolExecutorMap,
  ToolResult,
} from './types';
import { SCAD_AGENT_SYSTEM_PROMPT } from './systemPrompt';
import {
  makeInitialBudget,
  checkBudget,
  isWedged,
  recordTurn,
  recordToolCall,
  recordRenderResult,
  BUDGET_DEFAULTS,
} from './budget';
import { parseToolCalls } from './parseToolCalls';

let sessionIdCounter = 0;
function newSessionId(): string {
  return `agent_${Date.now().toString(36)}_${(++sessionIdCounter).toString(36)}`;
}

/**
 * Maximum bytes of conversation history to keep in a session. Long
 * sessions can balloon fast (each tool_result echoes the SCAD source), so
 * we cap and truncate from the front (oldest messages) when exceeded.
 * The system prompt is always preserved.
 */
const MAX_HISTORY_BYTES = 1_500_000; // ~1.5 MB
const MAX_HISTORY_MESSAGES = 200;

function truncateHistoryIfNeeded(history: AgentSession['history']): AgentSession['history'] {
  if (history.length <= MAX_HISTORY_MESSAGES) {
    const bytes = approxBytes(history);
    if (bytes <= MAX_HISTORY_BYTES) return history;
  }
  // Keep system prompt (always index 0) + last N messages that fit.
  const systemMsg = history[0]?.role === 'system' ? [history[0]] : [];
  const rest = history.slice(systemMsg.length);
  const out = systemMsg.slice();
  let bytes = approxBytes(out);
  // Walk backward, only push messages that fit. Reverse at end.
  const reverseKept: typeof rest = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const m = rest[i];
    const mb = approxBytes([m]);
    if (bytes + mb > MAX_HISTORY_BYTES || (out.length + reverseKept.length) >= MAX_HISTORY_MESSAGES) {
      break;
    }
    reverseKept.push(m);
    bytes += mb;
  }
  return [...out, ...reverseKept.reverse()];
}

function approxBytes(messages: AgentSession['history']): number {
  let n = 0;
  for (const m of messages) {
    if (m.role === 'tool_result') {
      n += 100 + (m.result.ok ? m.result.output.length : m.result.error.length);
    } else {
      n += 100 + m.content.length;
      if (m.role === 'assistant' && m.toolCalls) {
        for (const tc of m.toolCalls) n += JSON.stringify(tc).length;
      }
    }
  }
  return n;
}

function makeFreshSession(opts: AgentRunOptions): AgentSession {
  return {
    id: newSessionId(),
    scadSource: '',
    modules: {},
    composition: null,
    designPlan: null,
    checkpoints: [],
    brepEntries: [],
    sketches: {},
    mates: [],
    gdtFrames: [],
    docRefs: [],
    history: [{ role: 'system', content: SCAD_AGENT_SYSTEM_PROMPT }],
    render: { ok: null, errors: [] },
    geometry: {},
    budget: makeInitialBudget({
      tokensCap: opts.tokensCap,
      turnsCap: opts.turnsCap,
      toolCallsCap: opts.toolCallsCap,
      visionCallsCap: opts.visionCallsCap,
    }),
    status: 'idle',
  };
}

// effectiveScadSource lives in ./composeSource to avoid a cycle when
// tools.ts imports it.
export { effectiveScadSource } from './composeSource';

function toProviderMessages(history: AgentMessage[]) {
  // Translate AgentMessage → ChatMessage. Tool envelopes get rendered as
  // assistant / user text since the underlying providers don't all
  // implement native tool calling.
  return history.map(m => {
    if (m.role === 'tool_result') {
      const resultBody = m.result.ok
        ? `[tool_result id=${m.toolCallId}] OK\n${m.result.output}`
        : `[tool_result id=${m.toolCallId}] ERROR (${m.result.code ?? 'unknown'})\n${m.result.error}`;
      return { role: 'user' as const, content: resultBody };
    }
    if (m.role === 'assistant') {
      // Re-render tool calls as code-fenced JSON so the model's own output
      // protocol stays intact across turns.
      const tcText = (m.toolCalls ?? [])
        .map(tc => '```tool_call\n' + JSON.stringify({ id: tc.id, name: tc.name, args: tc.args }) + '\n```')
        .join('\n');
      const body = [m.content, tcText].filter(Boolean).join('\n\n');
      return { role: 'assistant' as const, content: body };
    }
    return { role: m.role, content: m.content };
  });
}

async function executeToolCall(
  call: ToolCall,
  tools: ToolExecutorMap,
  session: AgentSession,
): Promise<ToolResult> {
  const fn: ToolExecutor | undefined = tools[call.name];
  if (!fn) {
    return {
      ok: false,
      error: `Unknown tool "${call.name}". Valid: write_scad, apply_diff, render, get_geometry, add_feature_intent, verify_spec, search_bosl2, read_dfm.`,
      code: 'UNKNOWN_TOOL',
    };
  }
  try {
    return await fn(call.args, session);
  } catch (e) {
    return {
      ok: false,
      error: `Tool "${call.name}" threw: ${(e as Error).message}`,
      code: 'TOOL_THREW',
    };
  }
}

/**
 * Main loop — run a single user turn through the agent.
 *
 * Idempotent: callers pass back `result.session` to continue the
 * conversation. The session is mutated in place during the run; if you
 * need a snapshot of pre-run state, structuredClone before calling.
 */
export async function runScadAgent(opts: AgentRunOptions): Promise<{
  session: AgentSession;
  events: AgentEvent[];
}> {
  if (!opts.ai) throw new Error('AI client is required (opts.ai)');
  if (!opts.tools) throw new Error('Tool executors are required (opts.tools)');

  const session = opts.session ?? makeFreshSession(opts);
  const events: AgentEvent[] = [];
  const emit = (ev: AgentEvent) => {
    events.push(ev);
    opts.onEvent?.(ev);
  };

  // Append the user prompt to history. B3 — try compression first
  // (preserves structural memory); truncate is the floor when even
  // compression isn't enough.
  {
    const { compressHistory } = await import('./historyCompression');
    const c = compressHistory(session.history);
    if (c.compressed) session.history = c.history;
  }
  session.history = truncateHistoryIfNeeded(session.history);
  session.history.push({ role: 'user', content: opts.userPrompt });
  session.status = 'running';
  let warnedBudget = false;

  // B1 — Fast-path: if the prompt matches a deterministic catalog entry
  // exactly, skip the LLM entirely and synthesize a one-shot response
  // that uses add_feature_intent + render. Saves $0.005–0.02 per call
  // and shaves ~5s off latency. Falls through silently when prompt
  // doesn't match any pattern.
  if (opts.fastPath !== false && session.budget.turnsUsed === 0) {
    const { classifyFastPath } = await import('./fastPath');
    const hit = classifyFastPath(opts.userPrompt);
    if (hit) {
      const synthCalls: ToolCall[] = [
        { id: 'fp_intent', name: 'add_feature_intent', args: { intent: hit.intent } },
        { id: 'fp_render', name: 'render', args: {} },
      ];
      session.history.push({
        role: 'assistant',
        content: `[fast-path: ${hit.reason}] Using deterministic catalog — no LLM call needed.`,
        toolCalls: synthCalls,
      });
      emit({
        type: 'model_response',
        text: `[fast-path: ${hit.reason}]`,
        toolCalls: synthCalls,
        tokens: 0,
      });
      // Execute the two synthetic tool calls directly.
      for (const call of synthCalls) {
        emit({ type: 'tool_call', call });
        const result = await executeToolCall(call, opts.tools, session);
        session.budget = recordToolCall(session.budget);
        if (call.name === 'render') {
          const renderOk = result.ok && session.render.ok === true;
          session.budget = recordRenderResult(session.budget, renderOk);
        }
        session.history.push({ role: 'tool_result', toolCallId: call.id, result });
        emit({ type: 'tool_result', result, callId: call.id });
      }
      session.status = 'done';
      emit({ type: 'done', session });
      return { session, events };
    }
  }

  while (true) {
    // Budget check before model call.
    const bc = checkBudget(session.budget);
    if (bc.exhausted) {
      session.status = 'budget';
      emit({ type: 'error', message: `budget exhausted: ${bc.reason}` });
      break;
    }
    if (!warnedBudget && bc.remainingPct < BUDGET_DEFAULTS.warnAtRemainingPct) {
      warnedBudget = true;
      emit({ type: 'budget_warn', remainingPct: bc.remainingPct });
    }

    if (isWedged(session.budget)) {
      session.status = 'wedged';
      emit({ type: 'wedge_detected' });
      break;
    }

    emit({ type: 'turn_start', turn: session.budget.turnsUsed });

    // Call the model.
    const messages = toProviderMessages(session.history);

    // Y3 — Prepend user preferences (if any) as a system note so the
    // model honors long-term preferences ("always mm", "default to 3D
    // printing process") without the user re-stating them each turn.
    if (session.userPrefs && Object.keys(session.userPrefs).length > 0) {
      const prefLines = Object.entries(session.userPrefs).map(([k, v]) => `  - ${k}: ${v}`);
      messages.push({
        role: 'system',
        content: `[user preferences — apply by default unless explicitly overridden in this turn]\n${prefLines.join('\n')}`,
      });
    }

    // Stage 1 — surface the recorded design plan + module roster on every
    // turn so the agent can keep its bearings in long multi-module runs.
    if (session.designPlan || Object.keys(session.modules).length > 0) {
      const moduleNames = Object.keys(session.modules);
      const noteLines = ['[design context]'];
      if (session.designPlan) noteLines.push(`Plan: ${session.designPlan}`);
      if (moduleNames.length > 0) noteLines.push(`Modules so far: ${moduleNames.join(', ')}`);
      if (session.composition) noteLines.push(`Composition: SET (${session.composition.length} bytes)`);
      else if (moduleNames.length > 0) noteLines.push(`Composition: not yet set — call compose_assembly when modules are ready`);
      messages.push({ role: 'user', content: noteLines.join('\n') });
    }
    // Bail out before paying for another provider call if the caller has
     // since aborted (e.g. SSE client disconnected mid-turn).
    if (opts.signal?.aborted) {
      emit({ type: 'error', message: 'aborted' });
      return { session, events };
    }
    const aiResp = await callAi(opts.ai, messages, opts.signal);
    const tokens = (aiResp.promptTokens ?? 0) + (aiResp.completionTokens ?? 0);
    session.budget = recordTurn(session.budget, tokens);

    // Parse tool calls + narration.
    const { narration, toolCalls } = parseToolCalls(aiResp.text);

    session.history.push({
      role: 'assistant',
      content: narration,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    });

    emit({
      type: 'model_response',
      text: narration,
      toolCalls,
      tokens,
    });

    // No tool calls → model is handing back to user.
    if (toolCalls.length === 0) {
      session.status = 'done';
      emit({ type: 'done', session });
      return { session, events };
    }

    // Execute each tool call in order.
    for (const call of toolCalls) {
      // Per-call budget check (defensive — could be set by big tool sweeps).
      const bc2 = checkBudget(session.budget);
      if (bc2.exhausted) {
        session.status = 'budget';
        emit({ type: 'error', message: `budget exhausted mid-tool: ${bc2.reason}` });
        return { session, events };
      }

      emit({ type: 'tool_call', call });
      const result = await executeToolCall(call, opts.tools, session);

      session.budget = recordToolCall(session.budget);
      if (call.name === 'render') {
        const renderOk = result.ok && session.render.ok === true;
        session.budget = recordRenderResult(session.budget, renderOk);
      }

      session.history.push({
        role: 'tool_result',
        toolCallId: call.id,
        result,
      });
      emit({ type: 'tool_result', result, callId: call.id });

      // Y1 — ask_user pauses the loop. The tool sets status='awaiting_user';
      // we surface a dedicated event so the UI can render a quick-reply
      // prompt, then return so the next user message can resume. Status
      // mutation happens inside the tool which TS can't see, so we read
      // through a widened reference.
      if ((session.status as string) === 'awaiting_user') {
        const meta = result.ok ? (result.meta as { question?: string; options?: string[] } | undefined) : undefined;
        emit({
          type: 'awaiting_user',
          question: meta?.question ?? '',
          options: meta?.options,
          session,
        });
        return { session, events };
      }
    }
    // Apply history cap after each round so a long session stays bounded.
    // Compress first, then truncate as fallback.
    {
      const { compressHistory } = await import('./historyCompression');
      const c = compressHistory(session.history);
      if (c.compressed) session.history = c.history;
    }
    session.history = truncateHistoryIfNeeded(session.history);
    // Loop — model gets another turn with the tool results in history.
  }

  emit({ type: 'done', session });
  return { session, events };
}

async function callAi(
  ai: AiClient,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  signal?: AbortSignal,
): Promise<{ text: string; promptTokens?: number; completionTokens?: number }> {
  return ai.complete(messages, signal ? { signal } : undefined);
}

// ─── Real AI client adapter ────────────────────────────────────────────────

/**
 * Builds an AiClient backed by the existing `chatCompletion` provider chain.
 * Server-side use only — `chatCompletion` reads env vars / API keys.
 */
export function makeServerAiClient(opts: { task?: string; temperature?: number; maxTokens?: number } = {}): AiClient {
  return {
    async complete(messages, callOpts) {
      const { chatCompletion } = await import('../index');
      const resp = await chatCompletion({
        messages,
        task: opts.task ?? 'scad-agent',
        temperature: opts.temperature ?? 0.2,
        maxTokens: opts.maxTokens ?? 2048,
        signal: callOpts?.signal,
      });
      return {
        text: resp.text,
        promptTokens: resp.promptTokens,
        completionTokens: resp.completionTokens,
      };
    },
  };
}
