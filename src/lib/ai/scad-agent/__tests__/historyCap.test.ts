/**
 * P4 — Session history cap.
 *
 * Verifies that a continuation session arriving with bloated history
 * gets truncated to MAX_HISTORY_MESSAGES + bytes before the next user
 * turn runs. Without this, a malicious or runaway client could blow up
 * the model's context window and our token budget.
 */
import { describe, it, expect } from 'vitest';
import { runScadAgent } from '../runScadAgent';
import { makeTools } from '../tools';
import type { AgentSession, AiClient, RenderState } from '../types';

function noopAi(): AiClient {
  return {
    async complete() {
      return { text: 'done', promptTokens: 50, completionTokens: 5 };
    },
  };
}

function noopHost() {
  const r: RenderState = { ok: true, errors: [], stlBytes: 100, triangles: 12 };
  return {
    render: async () => ({ ...r, ts: Date.now() }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

function makeBloatedSession(messageCount: number, bytesPerMessage: number): AgentSession {
  const fillerContent = 'x'.repeat(bytesPerMessage);
  const history: AgentSession['history'] = [
    { role: 'system', content: 'You are an agent.' },
  ];
  for (let i = 0; i < messageCount; i++) {
    history.push({ role: 'user', content: `Turn ${i}: ${fillerContent}` });
    history.push({ role: 'assistant', content: `Reply ${i}: ${fillerContent}` });
  }
  return {
    id: 'bloated',
    scadSource: 'cube(10);',
    modules: {},
    composition: null,
    designPlan: null,
    checkpoints: [],
    brepEntries: [],
    sketches: {},
    mates: [],
    gdtFrames: [],
    docRefs: [],
    history,
    render: { ok: null, errors: [] },
    geometry: {},
    budget: {
      tokensUsed: 0, tokensCap: 1_000_000,
      turnsUsed: 0, turnsCap: 10,
      toolCallsUsed: 0, toolCallsCap: 50,
      visionCallsUsed: 0, visionCallsCap: 3,
      consecutiveRenderFails: 0,
    },
    status: 'idle',
  };
}

describe('Session history cap (P4)', () => {
  it('truncates history when it exceeds MAX_HISTORY_MESSAGES', async () => {
    // 250 user+assistant pairs = 500 messages, each tiny.
    const session = makeBloatedSession(250, 50);
    expect(session.history.length).toBeGreaterThan(200);

    await runScadAgent({
      userPrompt: 'continue',
      session,
      ai: noopAi(),
      tools: makeTools(noopHost()),
    });

    // After truncation + 1 user + 1 assistant added, length should be ≤ 202.
    expect(session.history.length).toBeLessThanOrEqual(204);
    // System prompt (if present) is preserved at index 0.
    if (session.history[0].role === 'system') {
      expect(session.history[0].content).toMatch(/agent/i);
    }
  });

  it('truncates history when total bytes exceed cap', async () => {
    // 100 messages × 100KB each = 10MB — way over 1.5MB cap.
    const session = makeBloatedSession(50, 100_000);
    const beforeBytes = JSON.stringify(session.history).length;
    expect(beforeBytes).toBeGreaterThan(1_500_000);

    await runScadAgent({
      userPrompt: 'continue',
      session,
      ai: noopAi(),
      tools: makeTools(noopHost()),
    });

    const afterBytes = JSON.stringify(session.history).length;
    // Allow some headroom — cap is 1.5MB plus the new user/assistant turns.
    expect(afterBytes).toBeLessThan(2_000_000);
    expect(afterBytes).toBeLessThan(beforeBytes);
  });

  it('small history is left untouched', async () => {
    const session = makeBloatedSession(3, 100);
    const before = session.history.length;

    await runScadAgent({
      userPrompt: 'continue',
      session,
      ai: noopAi(),
      tools: makeTools(noopHost()),
    });
    // Initial 7 messages + (1 user + 1 assistant) added = 9.
    expect(session.history.length).toBe(before + 2);
  });
});
