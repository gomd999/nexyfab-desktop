/**
 * sketchAssistantLlm — Phase 6.2 / 6.3 of NexyFab Pro own-CAD (ADR-013).
 *
 * LLM-backed sketch assistant. Wraps the existing chatCompletion provider
 * chain (DeepSeek → OpenAI → local fallback) with a structured prompt
 * that asks the model to emit JSON matching the SuggestedSketchOp schema.
 *
 * Falls back to the deterministic stub (sketchAssistant.ts) when:
 *   - No AI provider is configured (offline / dev without keys).
 *   - The LLM responds but fails JSON validation.
 *   - The caller passes `useStub: true` explicitly.
 *
 * Scope:
 *   - Same input / output types as the stub (interchangeable).
 *   - Phase 6.3: optional multi-turn conversation memory via
 *     `AssistantRequest.history` (capped at MAX_HISTORY_TURNS pairs).
 *     The stub still ignores history (rule-based, single-turn by design).
 *   - 1000-token output cap (suggestions are short).
 *
 * Out of scope (later phases):
 *   - Streaming partial suggestions while the model thinks
 *   - Voice transcription wrapper (Whisper + this module)
 *   - Function-calling / tool-use API (OpenAI / Anthropic native)
 */

import { interpretSketchCommand, type AssistantRequest, type AssistantResponse, type Suggestion, type SuggestedSketchOp } from './sketchAssistant';

/**
 * A single turn of conversation memory passed alongside the current prompt.
 * Callers maintain this list across user requests; the wrapper trims it
 * down to `MAX_HISTORY_TURNS` pairs before sending to the model.
 */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Maximum number of user/assistant *pairs* (i.e. 2 messages each) retained
 * from history. Older turns are dropped to bound token usage.
 */
export const MAX_HISTORY_TURNS = 3;

export interface LlmAssistantOptions {
  /** Force stub mode (skip LLM call). Useful for tests + offline. */
  useStub?: boolean;
  /** Override the chatCompletion entry — injectable for tests. */
  chatFn?: (req: { messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; maxTokens?: number; task?: string }) => Promise<{ text: string }>;
}

export async function interpretSketchCommandLlm(
  req: AssistantRequest,
  opts: LlmAssistantOptions = {},
): Promise<AssistantResponse> {
  if (opts.useStub) return interpretSketchCommand(req);

  // Resolve the chat function. Try the injected one first, then the
  // production chatCompletion. If neither is available, fall back to the
  // stub — keeps the assistant usable in dev environments without keys.
  let chat = opts.chatFn;
  if (!chat) {
    try {
      const { chatCompletion } = await import('./index');
      chat = (r) => chatCompletion({
        messages: r.messages,
        maxTokens: r.maxTokens,
        task: r.task ?? 'pro-sketch-assistant',
      }).then((res) => ({ text: res.text }));
    } catch {
      return interpretSketchCommand(req);
    }
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(req);
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...trimHistory(req.history),
    { role: 'user', content: userPrompt },
  ];
  let raw: string;
  try {
    const res = await chat({
      messages,
      maxTokens: 1000,
      task: 'pro-sketch-assistant',
    });
    raw = res.text;
  } catch {
    return interpretSketchCommand(req);
  }

  const parsed = parseSuggestions(raw);
  if (parsed === null) return interpretSketchCommand(req);
  return { suggestions: parsed, matched: parsed.length > 0 };
}

// ─── history helpers ─────────────────────────────────────────────────────

/**
 * Keep only the last `MAX_HISTORY_TURNS` user/assistant pairs (i.e. up to
 * `MAX_HISTORY_TURNS * 2` messages). If the trimmed window starts on an
 * assistant turn (orphaned), drop that leading message so the conversation
 * still alternates user → assistant → user → ... cleanly.
 */
function trimHistory(history: ReadonlyArray<ChatTurn> | undefined): ChatTurn[] {
  if (!history || history.length === 0) return [];
  const maxMessages = MAX_HISTORY_TURNS * 2;
  const trimmed = history.slice(-maxMessages);
  if (trimmed.length > 0 && trimmed[0]!.role === 'assistant') {
    return trimmed.slice(1);
  }
  return trimmed;
}

/**
 * Convenience for callers maintaining a rolling conversation log. Appends
 * the just-issued user prompt plus a synthesized assistant turn whose
 * content summarizes the suggestion list (joined `rationale` fields).
 *
 * Returns a NEW array — does not mutate the input. Caller is responsible
 * for retaining the result; trimming happens later at send-time.
 */
export function appendToHistory(
  history: ReadonlyArray<ChatTurn>,
  userPrompt: string,
  suggestionsRationaleString: string,
): ChatTurn[] {
  return [
    ...history,
    { role: 'user', content: userPrompt },
    { role: 'assistant', content: suggestionsRationaleString },
  ];
}

// ─── prompt construction ─────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    'You are an AI sketch assistant for a parametric CAD tool. Convert the user\'s natural-language',
    'command into a JSON array of SuggestedSketchOp objects. Output ONLY the JSON array, no commentary.',
    '',
    'SuggestedSketchOp variants (use the "type" discriminator):',
    '  { "type": "add_line", "from": {"x": number, "y": number}, "to": {"x": number, "y": number} }',
    '  { "type": "add_circle", "center": {"x": number, "y": number}, "radius": number }',
    '  { "type": "add_rect", "corner": {"x": number, "y": number}, "width": number, "height": number }',
    '  { "type": "add_constraint_horizontal", "lineId": string }',
    '  { "type": "add_constraint_vertical", "lineId": string }',
    '  { "type": "add_constraint_parallel", "line1": string, "line2": string }',
    '  { "type": "add_constraint_perpendicular", "line1": string, "line2": string }',
    '  { "type": "add_dimension_distance", "p1": string, "p2": string, "distance": number }',
    '  { "type": "delete_last" }',
    '',
    'Wrap each op with { "op": <op>, "confidence": 0..1, "rationale": "short string" }.',
    'Return the top-level JSON as an array of these wrappers. If you don\'t understand, return [].',
  ].join('\n');
}

function buildUserPrompt(req: AssistantRequest): string {
  const stateText = req.state
    ? `Current sketch state:\n  cursor: (${req.state.nextPointAt?.x ?? 0}, ${req.state.nextPointAt?.y ?? 0})\n  line ids: ${JSON.stringify(req.state.lineIds)}\n  last line: ${req.state.lastLineId ?? '(none)'}`
    : 'Current sketch state: (empty)';
  return `${stateText}\n\nUser command: ${req.prompt}`;
}

// ─── JSON parsing ────────────────────────────────────────────────────────

function parseSuggestions(raw: string): Suggestion[] | null {
  // Strip any markdown fences the model may add.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\n?/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: Suggestion[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const op = obj.op as SuggestedSketchOp | undefined;
    if (!op || typeof op !== 'object' || typeof (op as { type?: unknown }).type !== 'string') continue;
    if (!isValidOpType((op as { type: string }).type)) continue;
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0.5;
    const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';
    out.push({ op, confidence, rationale });
  }
  return out;
}

const VALID_OP_TYPES = new Set<string>([
  'add_line', 'add_circle', 'add_rect',
  'add_constraint_horizontal', 'add_constraint_vertical',
  'add_constraint_parallel', 'add_constraint_perpendicular',
  'add_dimension_distance', 'delete_last',
]);

function isValidOpType(type: string): boolean {
  return VALID_OP_TYPES.has(type);
}
