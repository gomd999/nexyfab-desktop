/**
 * Deterministic dimension reconcile on the AGENT path.
 *
 * add_feature_intent runs the SAME reconcileIntent(extractDimensions(prompt))
 * correction the scad-intent-from-nl route uses — so a wrong-number secondary
 * feature the LLM proposes (e.g. a hole with the wrong Ø) is snapped back to
 * the number the user STATED, in BOTH the generated SCAD and the stored
 * lastIntent the spec gate reads. It is a no-op when the prompt states no such
 * number, and skipped entirely when no source prompt is on the session.
 *
 * These exercise the tool wire-up only — the extractor/reconciler math is
 * covered in dimensionExtractor's own tests.
 */

import { describe, it, expect } from 'vitest';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AgentSession, ToolResult, ToolExecutor } from '../types';
import type { IntentInput, IntentFeature } from '../../../openscad-render/intentToScad';

function blankSession(reconcilePrompt?: string): AgentSession {
  return {
    id: 's',
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
    reconcilePrompt,
    history: [],
    render: { ok: null, errors: [] },
    geometry: {},
    budget: {
      tokensUsed: 0, tokensCap: 1_000_000,
      turnsUsed: 0, turnsCap: 50,
      toolCallsUsed: 0, toolCallsCap: 200,
      visionCallsUsed: 0, visionCallsCap: 3,
      consecutiveRenderFails: 0,
    },
    status: 'idle',
  };
}

function noopHost(): ToolHostAdapters {
  return {
    render: async () => ({ ok: true, errors: [], stlBytes: 100, triangles: 12, ts: Date.now() }),
    geometry: async () => ({ triangleCount: 12 }),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

function tool(tools: ReturnType<typeof makeTools>, name: 'add_feature_intent'): ToolExecutor {
  return tools[name]!;
}

function asOk(r: ToolResult): { ok: true; output: string; meta?: Record<string, unknown> } {
  if (!r.ok) throw new Error(`expected ok result, got: ${r.error}`);
  return r;
}

/** Diameter of the first hole feature on the stored intent (or undefined). */
function holeDia(intent: IntentInput | undefined): number | undefined {
  const f = (intent?.features ?? []).find((x: IntentFeature) => x.type === 'hole');
  const p = f?.params ?? {};
  const d = (p as Record<string, unknown>).diameter;
  return typeof d === 'number' ? d : undefined;
}

describe('add_feature_intent deterministic dimension reconcile', () => {
  it('corrects a wrong-Ø hole when the prompt states Ø10', async () => {
    const tools = makeTools(noopHost());
    // Prompt clearly says a 10mm hole; the LLM proposed a 6mm hole.
    const session = blankSession('a 50 mm cube with a 10 mm hole through the center');
    const out = asOk(await tool(tools, 'add_feature_intent')(
      {
        intent: {
          shapeId: 'box',
          params: { width: 50, height: 50, depth: 50 },
          features: [{ type: 'hole', params: { diameter: 6 } }],
        },
      },
      session,
    ));
    // The stored intent (what the spec gate reads) carries the corrected Ø.
    expect(holeDia(session.lastIntent)).toBe(10);
    // And the correction is surfaced honestly in the tool result meta.
    const notes = out.meta?.reconcile as string[] | undefined;
    expect(Array.isArray(notes) && notes.length).toBeGreaterThan(0);
    expect(notes!.some((n) => /hole\.diameter/.test(n) && /-> 10/.test(n))).toBe(true);
  });

  it('is a no-op on the easy tier (prompt states no hole)', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession('a 50 mm cube');
    const out = asOk(await tool(tools, 'add_feature_intent')(
      { intent: { shapeId: 'box', params: { width: 50, height: 50, depth: 50 } } },
      session,
    ));
    const notes = out.meta?.reconcile as string[] | undefined;
    expect(notes ?? []).toEqual([]);
    // No holes invented, envelope untouched.
    expect((session.lastIntent?.features ?? []).length).toBe(0);
  });

  it('does nothing when the session has no source prompt', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession(undefined);
    await tool(tools, 'add_feature_intent')(
      {
        intent: {
          shapeId: 'box',
          params: { width: 50, height: 50, depth: 50 },
          features: [{ type: 'hole', params: { diameter: 6 } }],
        },
      },
      session,
    );
    // Without a prompt to read, the LLM's number stands untouched.
    expect(holeDia(session.lastIntent)).toBe(6);
  });
});
