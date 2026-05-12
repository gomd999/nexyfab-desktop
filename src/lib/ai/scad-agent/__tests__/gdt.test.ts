/**
 * P — GD&T frame tool tests.
 */
import { describe, it, expect } from 'vitest';
import { makeTools, renderGdtFrameText } from '../tools';
import type { AgentSession } from '../types';

function blankSession(): AgentSession {
  return {
    id: 's',
    scadSource: '', modules: {}, composition: null, designPlan: null,
    checkpoints: [], brepEntries: [], sketches: {}, mates: [], gdtFrames: [], docRefs: [], history: [],
    render: { ok: null, errors: [] }, geometry: {},
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

function host() {
  return {
    render: async () => ({ ok: true as const, errors: [], stlBytes: 0, triangles: 0, ts: 0 }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

describe('renderGdtFrameText', () => {
  it('position with diameter + datums + modifier', () => {
    expect(renderGdtFrameText({
      id: 'g1', featureRef: 'hole_1', symbol: 'position',
      tolerance: 0.05, diameter: true, modifier: 'M',
      datums: [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }],
    })).toBe('⌖ ⌀0.05 M | A | B | C');
  });

  it('flatness without datums or modifier', () => {
    expect(renderGdtFrameText({
      id: 'g2', featureRef: 'face_top', symbol: 'flatness', tolerance: 0.02,
    })).toBe('⏥ 0.02');
  });

  it('perpendicularity to single datum', () => {
    expect(renderGdtFrameText({
      id: 'g3', featureRef: 'face_side', symbol: 'perpendicularity',
      tolerance: 0.1, datums: [{ letter: 'A' }],
    })).toBe('⊥ 0.1 | A');
  });

  it('cylindricity uses ⌭ symbol', () => {
    expect(renderGdtFrameText({
      id: 'g4', featureRef: 'shaft', symbol: 'cylindricity', tolerance: 0.01,
    })).toBe('⌭ 0.01');
  });
});

describe('add_gdt_frame', () => {
  it('rejects bad args', async () => {
    const tools = makeTools(host());
    const r = await tools.add_gdt_frame!({}, blankSession());
    expect(r.ok).toBe(false);
  });

  it('rejects out-of-range tolerance', async () => {
    const tools = makeTools(host());
    const session = blankSession();
    const r1 = await tools.add_gdt_frame!({ featureRef: 'h', symbol: 'position', tolerance: 0 }, session);
    expect(r1.ok).toBe(false);
    const r2 = await tools.add_gdt_frame!({ featureRef: 'h', symbol: 'position', tolerance: 100 }, session);
    expect(r2.ok).toBe(false);
  });

  it('adds frame to session and returns rendered text', async () => {
    const tools = makeTools(host());
    const session = blankSession();
    const r = await tools.add_gdt_frame!({
      featureRef: 'top_face', symbol: 'flatness', tolerance: 0.02,
    }, session);
    expect(r.ok).toBe(true);
    expect(session.gdtFrames.length).toBe(1);
    expect(session.gdtFrames[0].symbol).toBe('flatness');
    if (r.ok) expect(r.output).toContain('⏥');
  });

  it('multiple frames with correct ids', async () => {
    const tools = makeTools(host());
    const session = blankSession();
    await tools.add_gdt_frame!({ featureRef: 'a', symbol: 'flatness', tolerance: 0.02 }, session);
    await tools.add_gdt_frame!({ featureRef: 'b', symbol: 'position', tolerance: 0.05, datums: [{ letter: 'A' }] }, session);
    expect(session.gdtFrames.map(f => f.id)).toEqual(['gdt_1', 'gdt_2']);
  });
});

describe('list_gdt_frames', () => {
  it('returns empty hint when no frames', async () => {
    const tools = makeTools(host());
    const r = await tools.list_gdt_frames!({}, blankSession());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toMatch(/No GD&T/);
  });

  it('lists frames with rendered text', async () => {
    const tools = makeTools(host());
    const session = blankSession();
    await tools.add_gdt_frame!({ featureRef: 'h1', symbol: 'position', tolerance: 0.05, diameter: true, datums: [{ letter: 'A' }] }, session);
    const r = await tools.list_gdt_frames!({}, session);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.output).toContain('1 frame(s)');
      expect(r.output).toContain('⌖');
      expect(r.output).toContain('| A');
    }
  });
});
