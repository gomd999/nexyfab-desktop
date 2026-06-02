/**
 * featureTreeAssistantLlm — multi-turn conversation memory tests (Phase 6.3).
 *
 * Companion to featureTreeAssistantLlm.test.ts. Mirror of
 * sketchAssistantLlm.history.test.ts — same 8 cases, applied to
 * TreeAssistantRequest + FeatureTree fixtures. Focused on:
 *   - history pass-through to the chatFn message array
 *   - MAX_HISTORY_TURNS pair cap (older messages dropped)
 *   - appendToHistory convenience contract (re-exported)
 *   - history is ignored when useStub:true
 *   - empty/missing history degrades to single-turn behavior
 *   - LLM failure with history still falls back to stub
 */
import { describe, it, expect, vi } from 'vitest';
import {
  interpretTreeCommandLlm,
  appendToHistory,
  MAX_HISTORY_TURNS,
  type ChatTurn,
} from './featureTreeAssistantLlm';
import type { FeatureTree, FeatureNode } from '@/lib/cad/featureTree';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

type CapturedMessages = Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;

function ex(id: string, name: string, depth = 5): FeatureNode {
  const payload: ExtrudeFeature = {
    kind: 'extrude',
    loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }],
    depth, direction: 'one_sided', mode: 'add',
  };
  return { id, name, dependencies: [], payload };
}

function makeSpyChat(text: string) {
  const calls: Array<{ messages: CapturedMessages }> = [];
  const fn = vi.fn(async (r: { messages: CapturedMessages }) => {
    calls.push({ messages: r.messages });
    return { text };
  });
  return { fn, calls };
}

const VALID_RESPONSE = JSON.stringify([
  {
    op: { type: 'remove_node', nodeId: 'e1' },
    confidence: 0.7,
    rationale: 'delete first node',
  },
]);

describe('interpretTreeCommandLlm — multi-turn history', () => {
  it('passes a single prior turn through to the chatFn message array', async () => {
    const { fn, calls } = makeSpyChat(VALID_RESPONSE);
    const tree: FeatureTree = { nodes: [ex('e1', 'Base')] };
    const history: ChatTurn[] = [
      { role: 'user', content: 'add a base extrude' },
      { role: 'assistant', content: 'Added Base extrude depth 5.' },
    ];
    await interpretTreeCommandLlm(
      { prompt: 'now delete it', tree, history },
      { chatFn: fn },
    );
    expect(fn).toHaveBeenCalledTimes(1);
    const msgs = calls[0]!.messages;
    // [system, user(prior), assistant(prior), user(current)]
    expect(msgs.length).toBe(4);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: 'add a base extrude' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'Added Base extrude depth 5.' });
    expect(msgs[3]!.role).toBe('user');
    expect(msgs[3]!.content).toContain('now delete it');
  });

  it(`caps history at the last ${MAX_HISTORY_TURNS} user/assistant pairs`, async () => {
    const { fn, calls } = makeSpyChat(VALID_RESPONSE);
    const tree: FeatureTree = { nodes: [ex('e1', 'Base')] };
    // Build 5 pairs = 10 messages. Only last 3 pairs (6 msgs) must be sent.
    const history: ChatTurn[] = [];
    for (let i = 1; i <= 5; i++) {
      history.push({ role: 'user', content: `u${i}` });
      history.push({ role: 'assistant', content: `a${i}` });
    }
    await interpretTreeCommandLlm(
      { prompt: 'current cmd', tree, history },
      { chatFn: fn },
    );
    const msgs = calls[0]!.messages;
    // system + (3 pairs = 6) + current user = 8
    expect(msgs.length).toBe(1 + MAX_HISTORY_TURNS * 2 + 1);
    expect(msgs[0]!.role).toBe('system');
    // Verify the *last* 3 pairs are the ones kept (u3..a5), older are dropped.
    expect(msgs[1]).toEqual({ role: 'user', content: 'u3' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'a3' });
    expect(msgs[3]).toEqual({ role: 'user', content: 'u4' });
    expect(msgs[4]).toEqual({ role: 'assistant', content: 'a4' });
    expect(msgs[5]).toEqual({ role: 'user', content: 'u5' });
    expect(msgs[6]).toEqual({ role: 'assistant', content: 'a5' });
    expect(msgs[7]!.role).toBe('user');
    expect(msgs[7]!.content).toContain('current cmd');
    // Older turns (u1/a1/u2/a2) must not appear anywhere.
    const flat = msgs.map((m) => m.content).join('|');
    expect(flat).not.toContain('u1');
    expect(flat).not.toContain('a1');
    expect(flat).not.toContain('u2');
    expect(flat).not.toContain('a2');
  });

  it('appendToHistory adds exactly 2 entries (user + assistant)', () => {
    const initial: ChatTurn[] = [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'earlier reply' },
    ];
    const result = appendToHistory(initial, 'new prompt', 'rationale-A; rationale-B');
    expect(result.length).toBe(initial.length + 2);
    expect(result[result.length - 2]).toEqual({ role: 'user', content: 'new prompt' });
    expect(result[result.length - 1]).toEqual({
      role: 'assistant',
      content: 'rationale-A; rationale-B',
    });
    // Must not mutate the input array.
    expect(initial.length).toBe(2);
  });

  it('appendToHistory works starting from an empty array', () => {
    const result = appendToHistory([], 'first ever', 'first response summary');
    expect(result).toEqual([
      { role: 'user', content: 'first ever' },
      { role: 'assistant', content: 'first response summary' },
    ]);
  });

  it('useStub:true ignores history and still uses the rule-based stub', async () => {
    const { fn } = makeSpyChat(VALID_RESPONSE);
    const tree: FeatureTree = { nodes: [ex('e1', 'Base')] };
    const history: ChatTurn[] = [
      { role: 'user', content: 'ignored-prior' },
      { role: 'assistant', content: 'ignored-reply' },
    ];
    const r = await interpretTreeCommandLlm(
      { prompt: 'delete Base', tree, history },
      { useStub: true, chatFn: fn },
    );
    expect(fn).not.toHaveBeenCalled();
    expect(r.matched).toBe(true);
    expect(r.suggestions[0]!.op.type).toBe('remove_node');
  });

  it('empty history works (degrades to current single-turn behavior)', async () => {
    const { fn, calls } = makeSpyChat(VALID_RESPONSE);
    const tree: FeatureTree = { nodes: [ex('e1', 'Base')] };
    await interpretTreeCommandLlm(
      { prompt: 'delete', tree, history: [] },
      { chatFn: fn },
    );
    const msgs = calls[0]!.messages;
    expect(msgs.length).toBe(2);
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
  });

  it('missing history (undefined) works (degrades to current single-turn behavior)', async () => {
    const { fn, calls } = makeSpyChat(VALID_RESPONSE);
    const tree: FeatureTree = { nodes: [ex('e1', 'Base')] };
    await interpretTreeCommandLlm(
      { prompt: 'delete', tree },
      { chatFn: fn },
    );
    const msgs = calls[0]!.messages;
    expect(msgs.length).toBe(2);
  });

  it('LLM failure with history → falls back to the stub (history does not break recovery)', async () => {
    const tree: FeatureTree = { nodes: [ex('e1', 'Hole')] };
    const history: ChatTurn[] = [
      { role: 'user', content: 'earlier — make Hole' },
      { role: 'assistant', content: 'Hole created.' },
    ];
    const failing = async () => {
      throw new Error('provider down');
    };
    const r = await interpretTreeCommandLlm(
      { prompt: 'suppress Hole', tree, history },
      { chatFn: failing },
    );
    // Stub matches "suppress Hole" → at least one set_suppressed suggestion.
    expect(r.matched).toBe(true);
    expect(r.suggestions.some((s) => s.op.type === 'set_suppressed')).toBe(true);
  });
});
