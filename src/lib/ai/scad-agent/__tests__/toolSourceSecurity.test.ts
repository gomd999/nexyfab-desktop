import { describe, expect, it } from 'vitest';
import { makeTools } from '../tools';
import type { AgentSession } from '../types';

function blankSession(): AgentSession {
  return {
    id: 'security', scadSource: 'cube(1);', modules: {}, composition: null,
    designPlan: null, checkpoints: [], brepEntries: [], sketches: {}, mates: [],
    gdtFrames: [], docRefs: [], history: [], render: { ok: null, errors: [] }, geometry: {},
    budget: {
      tokensUsed: 0, tokensCap: 100, turnsUsed: 0, turnsCap: 2,
      toolCallsUsed: 0, toolCallsCap: 2, visionCallsUsed: 0, visionCallsCap: 0,
      consecutiveRenderFails: 0,
    }, status: 'idle',
  };
}

const tools = makeTools({
  render: async () => ({ ok: true, errors: [], stlBytes: 0, triangles: 0 }),
  geometry: async () => ({}),
  dfm: async () => ({ summary: '', issuesCount: 0 }),
});

describe('agent SCAD mutation security', () => {
  it('rejects local file imports before changing the session', async () => {
    const session = blankSession();
    const result = await tools.write_scad!({ code: 'import("C:/secret.stl");' }, session);
    expect(result).toMatchObject({ ok: false, code: 'UNSAFE_SOURCE' });
    expect(session.scadSource).toBe('cube(1);');
  });

  it('rejects unsafe include introduced through a diff', async () => {
    const session = blankSession();
    const result = await tools.apply_diff!({
      diff: '@@ -1,1 +1,2 @@\n+ include <../../secret.scad>\n cube(1);',
    }, session);
    expect(result).toMatchObject({ ok: false, code: 'UNSAFE_SOURCE' });
    expect(session.scadSource).toBe('cube(1);');
  });

  it('allows the pinned BOSL2 include namespace', async () => {
    const session = blankSession();
    const result = await tools.write_scad!({ code: 'include <BOSL2/std.scad>\ncube(1);' }, session);
    expect(result.ok).toBe(true);
  });
});
