/**
 * A3 — list_face_tags returns canonical role tags per primitive kind.
 *
 * Confirms the contract the system prompt advertises: cube has 6 tags,
 * cylinder has 3, sphere has 1, and unknown kinds (boolean/fillet/etc)
 * return an empty list with a hint to use faceA/faceB indices.
 */

import { describe, it, expect } from 'vitest';
import { makeTools } from '../tools';
import type { AgentSession, ToolName } from '../types';

function makeSession(): AgentSession {
  return {
    id: 'test-session',
    scadSource: '',
    modules: {}, composition: null, designPlan: null,
    checkpoints: [],
    brepEntries: [
      { handle: 'h:cube',     kind: 'cube(20)',                ts: 0 },
      { handle: 'h:cyl',      kind: 'cylinder(r=5,h=10)',      ts: 0 },
      { handle: 'h:sph',      kind: 'sphere(r=3)',             ts: 0 },
      { handle: 'h:bool',     kind: 'boolean(subtract)',       ts: 0 },
      { handle: 'h:fil',      kind: 'fillet(r=1)',             ts: 0 },
    ],
    sketches: {}, mates: [], gdtFrames: [], docRefs: [],
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

const tools = makeTools({
  render: async () => ({ ok: true as const, errors: [], stlBytes: 0, triangles: 0, ts: Date.now() }),
  geometry: async () => ({}),
  dfm: async () => ({ summary: '', issuesCount: 0 }),
});
const list_face_tags = tools.list_face_tags!;

async function call(handle: string | undefined) {
  return list_face_tags({ hostHandle: handle as string }, makeSession());
}

describe('list_face_tags', () => {
  it('rejects missing hostHandle', async () => {
    const r = await call(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('BAD_ARGS');
  });

  it('returns NOT_FOUND for unknown handle', async () => {
    const r = await call('h:does-not-exist');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });

  it('cube → 6 axis-aligned tags', async () => {
    const r = await call('h:cube');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const tags = (r.meta as { tags: string[] }).tags;
      expect(tags).toEqual(['x+', 'x-', 'y+', 'y-', 'z+', 'z-']);
    }
  });

  it('cylinder → top/bottom/side', async () => {
    const r = await call('h:cyl');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const tags = (r.meta as { tags: string[] }).tags;
      expect(tags).toEqual(['top', 'bottom', 'side']);
    }
  });

  it('sphere → single surface', async () => {
    const r = await call('h:sph');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const tags = (r.meta as { tags: string[] }).tags;
      expect(tags).toEqual(['surf']);
    }
  });

  it('boolean result has no canonical tags — caller must use faceA/faceB', async () => {
    const r = await call('h:bool');
    expect(r.ok).toBe(true);
    if (r.ok) {
      const tags = (r.meta as { tags: string[] }).tags;
      expect(tags).toEqual([]);
      expect(r.output).toMatch(/no canonical face tags/i);
    }
  });

  it('list_face_tags is registered in the tool surface', () => {
    expect(typeof tools.list_face_tags).toBe('function');
    const names = Object.keys(tools) as ToolName[];
    expect(names).toContain('list_face_tags');
  });
});
