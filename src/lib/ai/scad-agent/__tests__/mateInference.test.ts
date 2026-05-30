/**
 * Mate inference tests — pure helper + tool wire-up.
 *
 * Validates the 5 v1 heuristics (face_touch, face_offset, concentric,
 * hole_pattern_align, axis_align, mirror) and the tool wrapper shape
 * (BAD_ARGS on missing fingerprint inputs, meta.suggestions populated
 * on ok).
 *
 * Mirrors materialRecommendation.test.ts in style — same blankSession /
 * noopHost scaffolding, same find/asOk/asErr helpers so the agent test
 * suite reads uniformly across the suggester family.
 */

import { describe, it, expect } from 'vitest';
import {
  suggestMatesForPair,
  formatMateSuggestions,
  type PartFingerprint,
  type SuggestedMate,
} from '../mateInference';
import { makeTools, type ToolHostAdapters } from '../tools';
import type { AgentSession, ToolResult, ToolExecutor } from '../types';
import type { IntentInput } from '../../../openscad-render/intentToScad';

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

function noopHost(): ToolHostAdapters {
  return {
    render: async () => ({ ok: true, errors: [], stlBytes: 0, triangles: 0, ts: 0 }),
    geometry: async () => ({}),
    dfm: async () => ({ summary: '', issuesCount: 0 }),
  };
}

function tool(tools: ReturnType<typeof makeTools>, name: 'suggest_mates'): ToolExecutor {
  return tools[name]!;
}

function asOk(r: ToolResult): { ok: true; output: string; meta?: Record<string, unknown> } {
  if (!r.ok) throw new Error(`expected ok result, got: ${r.error}`);
  return r;
}
function asErr(r: ToolResult): { ok: false; error: string; code?: string } {
  if (r.ok) throw new Error('expected error result');
  return r;
}

/** Build a simple box fingerprint at a translation. Bbox is centered at
 *  `position` with `size`. */
function boxFp(
  position: [number, number, number],
  size: [number, number, number],
  intentOverride?: Partial<IntentInput>,
): PartFingerprint {
  const [px, py, pz] = position;
  const [w, h, d] = size;
  return {
    intent: {
      shapeId: 'box',
      params: { width: w, height: h, depth: d },
      ...intentOverride,
    } as IntentInput,
    bbox: {
      min: [px - w / 2, py - h / 2, pz - d / 2],
      max: [px + w / 2, py + h / 2, pz + d / 2],
    },
  };
}

/** Build a cylinder fingerprint (axis along Z, centered at position). */
function cylFp(
  position: [number, number, number],
  diameter: number,
  height: number,
): PartFingerprint {
  const [px, py, pz] = position;
  const r = diameter / 2;
  return {
    intent: {
      shapeId: 'cylinder',
      params: { diameter, height },
    } as IntentInput,
    bbox: {
      min: [px - r, py - r, pz - height / 2],
      max: [px + r, py + r, pz + height / 2],
    },
  };
}

function findByType(s: SuggestedMate[], t: SuggestedMate['type']): SuggestedMate | undefined {
  return s.find(x => x.type === t);
}

describe('suggestMatesForPair — heuristic rules', () => {
  it('two stacked boxes (A.max.z = B.min.z) → face_touch on Z is the top suggestion', () => {
    // Box A at z=0, size 20x20x20 → spans z [-10,10].
    // Box B at z=20, size 20x20x20 → spans z [10,30]. A.max.z == B.min.z.
    const A = boxFp([0, 0, 0], [20, 20, 20]);
    const B = boxFp([0, 0, 20], [20, 20, 20]);
    const suggestions = suggestMatesForPair({ partA: A, partB: B });
    expect(suggestions.length).toBeGreaterThan(0);
    const top = suggestions[0]!;
    // Z-touch should be the highest-confidence face suggestion.
    expect(top.type === 'face_touch' || top.type === 'face_offset').toBe(true);
    const zTouch = suggestions.find(s => s.type === 'face_touch' && s.hint.axis === 'z');
    expect(zTouch).toBeDefined();
    expect(zTouch!.confidence).toBe(75);
  });

  it('two boxes with 5mm gap on X → face_offset { axis: x, distanceMm: ~5 }', () => {
    // A: spans x [-5, 5], B: spans x [10, 20] → gap = 5mm.
    const A = boxFp([0, 0, 0], [10, 10, 10]);
    const B = boxFp([15, 0, 0], [10, 10, 10]);
    const suggestions = suggestMatesForPair({ partA: A, partB: B });
    const xOffset = suggestions.find(s => s.type === 'face_offset' && s.hint.axis === 'x');
    expect(xOffset).toBeDefined();
    expect(xOffset!.hint.distanceMm as number).toBeCloseTo(5, 1);
  });

  it('two cylinders with matching XY centers → concentric, confidence ≥ 85', () => {
    // Both at (10, 10, *) with Ø8.
    const A = cylFp([10, 10, 0], 8, 20);
    const B = cylFp([10, 10, 30], 8, 10);
    const suggestions = suggestMatesForPair({ partA: A, partB: B });
    const conc = findByType(suggestions, 'concentric');
    expect(conc).toBeDefined();
    expect(conc!.confidence).toBeGreaterThanOrEqual(85);
    expect(conc!.hint.x as number).toBeCloseTo(10, 1);
    expect(conc!.hint.y as number).toBeCloseTo(10, 1);
    expect(conc!.hint.diameter as number).toBeCloseTo(8, 1);
  });

  it('2 parts each with 4-hole pattern matching after translation → hole_pattern_align', () => {
    // Each part has 4 holes at the corners of a 30x30 square, on Z axis.
    const A: PartFingerprint = {
      intent: { shapeId: 'box', params: { width: 40, height: 40, depth: 10 } } as IntentInput,
      bbox: { min: [-20, -20, -5], max: [20, 20, 5] },
      holes: [
        { axis: 'z', cx: -15, cy: -15, diameter: 5 },
        { axis: 'z', cx: 15, cy: -15, diameter: 5 },
        { axis: 'z', cx: -15, cy: 15, diameter: 5 },
        { axis: 'z', cx: 15, cy: 15, diameter: 5 },
      ],
    };
    // B is the same pattern shifted by (+50, +5).
    const B: PartFingerprint = {
      intent: { shapeId: 'box', params: { width: 40, height: 40, depth: 10 } } as IntentInput,
      bbox: { min: [30, -15, -5], max: [70, 25, 5] },
      holes: [
        { axis: 'z', cx: 35, cy: -10, diameter: 5 },
        { axis: 'z', cx: 65, cy: -10, diameter: 5 },
        { axis: 'z', cx: 35, cy: 20, diameter: 5 },
        { axis: 'z', cx: 65, cy: 20, diameter: 5 },
      ],
    };
    const suggestions = suggestMatesForPair({ partA: A, partB: B });
    const pat = suggestions.find(s => s.type === 'hole_pattern_align' && s.blockers.length === 0);
    expect(pat).toBeDefined();
    expect(pat!.confidence).toBeGreaterThanOrEqual(85);
    const t = pat!.hint.translationMm as number[];
    expect(t[0]).toBeCloseTo(-50, 1);
    expect(t[1]).toBeCloseTo(-5, 1);
  });

  it('2 parts where hole sets DON\'T align → hole_pattern_align blocker', () => {
    const A: PartFingerprint = {
      intent: { shapeId: 'box', params: { width: 40, height: 40, depth: 10 } } as IntentInput,
      bbox: { min: [-20, -20, -5], max: [20, 20, 5] },
      holes: [
        { axis: 'z', cx: -15, cy: -15, diameter: 5 },
        { axis: 'z', cx: 15, cy: 15, diameter: 5 },
      ],
    };
    // B has holes at totally different relative spacing → no translation works.
    const B: PartFingerprint = {
      intent: { shapeId: 'box', params: { width: 40, height: 40, depth: 10 } } as IntentInput,
      bbox: { min: [-20, -20, -5], max: [20, 20, 5] },
      holes: [
        { axis: 'z', cx: 0, cy: 0, diameter: 5 },
        { axis: 'z', cx: 30, cy: 0, diameter: 5 }, // diff X-spacing than A
      ],
    };
    const suggestions = suggestMatesForPair({ partA: A, partB: B });
    const pat = suggestions.find(s => s.type === 'hole_pattern_align');
    expect(pat).toBeDefined();
    expect(pat!.blockers.length).toBeGreaterThan(0);
    expect(pat!.confidence).toBe(0);
  });

  it('stacked cylinders along Z, same XY center → axis_align suggested', () => {
    const A = cylFp([5, 5, 0], 10, 20);  // z [-10, 10]
    const B = cylFp([5, 5, 20], 12, 20); // z [10, 30] → stacked
    const suggestions = suggestMatesForPair({ partA: A, partB: B });
    const ax = findByType(suggestions, 'axis_align');
    expect(ax).toBeDefined();
    expect(ax!.hint.axis).toBe('z');
    expect(ax!.hint.shaftDiameter as number).toBeCloseTo(12, 1);
  });

  it('mirror case (partB at [-50, 0, 0]) → mirror suggested', () => {
    const A = boxFp([0, 0, 0], [20, 30, 10]);
    const B = boxFp([-50, 0, 0], [20, 30, 10]);
    const suggestions = suggestMatesForPair({
      partA: A,
      partB: B,
      relativePositionMm: [-50, 0, 0],
    });
    const mir = findByType(suggestions, 'mirror');
    expect(mir).toBeDefined();
    expect(mir!.hint.axis).toBe('x');
    expect(mir!.hint.offsetMm as number).toBeCloseTo(-50, 1);
  });

  it('suggestions sorted by confidence descending', () => {
    const A = boxFp([0, 0, 0], [10, 10, 10]);
    const B = boxFp([0, 0, 10], [10, 10, 10]); // Z-touch
    const suggestions = suggestMatesForPair({ partA: A, partB: B });
    for (let i = 1; i < suggestions.length; i++) {
      expect(suggestions[i - 1]!.confidence).toBeGreaterThanOrEqual(suggestions[i]!.confidence);
    }
  });

  it('formatMateSuggestions returns ranked text with type + confidence + hint', () => {
    const A = boxFp([0, 0, 0], [10, 10, 10]);
    const B = boxFp([0, 0, 10], [10, 10, 10]);
    const text = formatMateSuggestions(suggestMatesForPair({ partA: A, partB: B }));
    expect(text).toMatch(/Mate suggestions/);
    expect(text).toMatch(/face_touch|face_offset/);
    expect(text).toMatch(/confidence \d+/);
  });
});

describe('suggest_mates — tool executor wire', () => {
  it('returns BAD_ARGS when partA.intent missing', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asErr(await tool(tools, 'suggest_mates')(
      { partA: { bbox: { min: [0, 0, 0], max: [10, 10, 10] } }, partB: { intent: { shapeId: 'box' }, bbox: { min: [0, 0, 0], max: [10, 10, 10] } } },
      session,
    ));
    expect(res.code).toBe('BAD_ARGS');
    expect(res.error).toMatch(/intent/i);
  });

  it('returns BAD_ARGS when partB.bbox missing', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asErr(await tool(tools, 'suggest_mates')(
      {
        partA: { intent: { shapeId: 'box' }, bbox: { min: [0, 0, 0], max: [10, 10, 10] } },
        partB: { intent: { shapeId: 'box' } },
      },
      session,
    ));
    expect(res.code).toBe('BAD_ARGS');
  });

  it('returns ok with formatted output + meta.suggestions for a valid pair', async () => {
    const tools = makeTools(noopHost());
    const session = blankSession();
    const res = asOk(await tool(tools, 'suggest_mates')(
      {
        partA: {
          intent: { shapeId: 'box', params: { width: 10, height: 10, depth: 10 } },
          bbox: { min: [-5, -5, -5], max: [5, 5, 5] },
        },
        partB: {
          intent: { shapeId: 'box', params: { width: 10, height: 10, depth: 10 } },
          bbox: { min: [-5, -5, 5], max: [5, 5, 15] },
        },
      },
      session,
    ));
    const suggestions = res.meta!.suggestions as SuggestedMate[];
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(res.output).toMatch(/Mate suggestions/);
  });
});
