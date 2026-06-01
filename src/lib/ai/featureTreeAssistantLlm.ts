/**
 * featureTreeAssistantLlm — Phase 6.2 LLM wrapper for the feature-tree
 * assistant. Mirror of sketchAssistantLlm.ts for FeatureTree edit ops.
 *
 * Same architecture:
 *   - useStub:true → deterministic rule-based stub (Phase 6 stub)
 *   - otherwise → chatCompletion provider chain (DeepSeek → OpenAI → local)
 *   - any failure (no provider, throw, invalid JSON, non-array) → falls
 *     back to the stub gracefully
 *
 * Output `Suggestion` shape matches the stub exactly — call sites are
 * interchangeable.
 */

import {
  interpretTreeCommand,
  type SuggestedTreeOp,
  type TreeAssistantRequest,
  type TreeAssistantResponse,
} from './featureTreeAssistant';
import type { EditOp } from '@/lib/cad/featureTreeEdit';

export interface TreeLlmAssistantOptions {
  useStub?: boolean;
  chatFn?: (req: { messages: Array<{ role: 'system' | 'user'; content: string }>; maxTokens?: number; task?: string }) => Promise<{ text: string }>;
}

export async function interpretTreeCommandLlm(
  req: TreeAssistantRequest,
  opts: TreeLlmAssistantOptions = {},
): Promise<TreeAssistantResponse> {
  if (opts.useStub) return interpretTreeCommand(req);

  let chat = opts.chatFn;
  if (!chat) {
    try {
      const { chatCompletion } = await import('./index');
      chat = (r) => chatCompletion({
        messages: r.messages,
        maxTokens: r.maxTokens,
        task: r.task ?? 'pro-tree-assistant',
      }).then((res) => ({ text: res.text }));
    } catch {
      return interpretTreeCommand(req);
    }
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(req);
  let raw: string;
  try {
    const res = await chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 1000,
      task: 'pro-tree-assistant',
    });
    raw = res.text;
  } catch {
    return interpretTreeCommand(req);
  }

  const parsed = parseSuggestions(raw);
  if (parsed === null) return interpretTreeCommand(req);
  return { suggestions: parsed, matched: parsed.length > 0 };
}

// ─── prompt construction ─────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    'You are an AI assistant for a parametric CAD feature tree. Convert the user\'s natural-language',
    'command into a JSON array of SuggestedTreeOp objects. Output ONLY the JSON array, no commentary.',
    '',
    'EditOp variants (use the "type" discriminator) — wrapped inside { op: EditOp, confidence, rationale }:',
    '  { "type": "set_payload", "nodeId": string, "payload": <feature-IR object> }',
    '  { "type": "set_name", "nodeId": string, "name": string }',
    '  { "type": "set_suppressed", "nodeId": string, "suppressed": boolean }',
    '  { "type": "set_dependencies", "nodeId": string, "dependencies": string[] }',
    '  { "type": "insert_node", "node": <FeatureNode>, "atIndex"?: number }',
    '  { "type": "remove_node", "nodeId": string }',
    '  { "type": "move_node", "nodeId": string, "toIndex": number }',
    '',
    'For set_payload on an extrude node, payload schema:',
    '  { "kind": "extrude", "loop": [{"x":n,"y":n}, ...], "depth": n, "direction": "one_sided"|"two_sided"|"midplane", "mode": "add"|"cut", "draftDegrees"?: n }',
    '',
    'Wrap each op with { "op": <op>, "confidence": 0..1, "rationale": "short string" }.',
    'Return the top-level JSON as an array. If you don\'t understand, return [].',
  ].join('\n');
}

function buildUserPrompt(req: TreeAssistantRequest): string {
  const nodeSummary = req.tree.nodes
    .map((n) => {
      const sup = n.suppressed ? ' [suppressed]' : '';
      const deps = n.dependencies.length > 0 ? ` deps=[${n.dependencies.join(',')}]` : '';
      return `  - id=${n.id} name='${n.name}' kind=${n.payload.kind}${sup}${deps}`;
    })
    .join('\n');
  const tree = req.tree.nodes.length > 0 ? nodeSummary : '  (empty)';
  return `Current feature tree (${req.tree.nodes.length} nodes):\n${tree}\n\nUser command: ${req.prompt}`;
}

// ─── JSON parsing ────────────────────────────────────────────────────────

function parseSuggestions(raw: string): SuggestedTreeOp[] | null {
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
  const out: SuggestedTreeOp[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    const op = obj.op as EditOp | undefined;
    if (!op || typeof op !== 'object' || typeof (op as { type?: unknown }).type !== 'string') continue;
    if (!isValidOpType((op as { type: string }).type)) continue;
    const confidence = typeof obj.confidence === 'number' ? obj.confidence : 0.5;
    const rationale = typeof obj.rationale === 'string' ? obj.rationale : '';
    out.push({ op, confidence, rationale });
  }
  return out;
}

const VALID_EDIT_OP_TYPES = new Set<string>([
  'set_payload', 'set_name', 'set_suppressed', 'set_dependencies',
  'insert_node', 'remove_node', 'move_node',
]);

function isValidOpType(type: string): boolean {
  return VALID_EDIT_OP_TYPES.has(type);
}
