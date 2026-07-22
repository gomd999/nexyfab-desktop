import { describe, it, expect } from 'vitest';
import { extractDimensions, reconcileIntent } from '../dimensionExtractor';
import type { IntentInput } from '../../openscad-render/intentToScad';

describe('extractDimensions — bounding box', () => {
  it('reads a cube edge → three equal dims', () => {
    const r = extractDimensions('a 50mm cube with a 10mm hole through the center');
    expect(r.dims).toEqual([50, 50, 50]);
    expect(r.isCube).toBe(true);
  });

  it('reads AxBxC', () => {
    expect(extractDimensions('100x100x8 plate with 4 corner holes 8mm').dims).toEqual([100, 100, 8]);
  });

  it('reads "A by B by C"', () => {
    expect(extractDimensions('rectangular box 50 by 30 by 20 millimeters').dims).toEqual([50, 30, 20]);
  });
});

describe('extractDimensions — holes', () => {
  it('cube + centred hole diameter', () => {
    const r = extractDimensions('a 50mm cube with a 10mm hole through the center');
    expect(r.holes).toEqual([{ dia: 10 }]);
  });

  it('does not mistake the bbox thickness for the hole count', () => {
    const r = extractDimensions('100x100x8 plate with 4 corner holes 8mm');
    expect(r.holes).toBeDefined();
    expect(r.holes![0]).toEqual({ dia: 8, count: 4, pattern: 'corner' });
  });

  it('count-only holes on a bolt circle (no diameter stated)', () => {
    const r = extractDimensions('flange OD100 bore60 8 bolt holes on 80mm circle');
    expect(r.holes).toBeDefined();
    expect(r.holes![0].count).toBe(8);
    expect(r.holes![0].pattern).toBe('circular');
    expect(r.holes![0].dia).toBeUndefined();
  });

  it('parses "holes 8mm" (diameter after the word)', () => {
    expect(extractDimensions('plate with holes 8mm').holes).toEqual([{ dia: 8 }]);
  });

  it('parses Ø notation when a hole word is present', () => {
    expect(extractDimensions('a bracket with a Ø6 hole').holes).toEqual([{ dia: 6 }]);
  });
});

describe('extractDimensions — round-part diameters + fasteners', () => {
  it('flange OD / bore / bolt-circle', () => {
    const r = extractDimensions('flange OD100 bore60 8 bolt holes on 80mm circle');
    expect(r.od).toBe(100);
    expect(r.bore).toBe(60);
    expect(r.boltCircle).toBe(80);
  });

  it('PCD phrasing', () => {
    expect(extractDimensions('flange with 6 holes on PCD 70').boltCircle).toBe(70);
  });

  it('hex bolt metric + length', () => {
    const r = extractDimensions('M8 hex bolt 30mm long');
    expect(r.metric).toBe(8);
    expect(r.length).toBe(30);
    expect(r.holes).toBeUndefined(); // "bolt" is not a hole
  });
});

describe('extractDimensions — edge cases (conservative)', () => {
  it('empty prompt → empty result', () => {
    expect(extractDimensions('')).toEqual({});
    expect(extractDimensions('   ')).toEqual({});
  });

  it('no numbers → no holes / dims', () => {
    const r = extractDimensions('make me a nice sphere');
    expect(r.dims).toBeUndefined();
    expect(r.holes).toBeUndefined();
  });

  it('a hole word with no number yields no diameter', () => {
    const r = extractDimensions('a plate with a hole');
    // count/pattern absent, dia absent → nothing actionable
    expect(r.holes).toBeUndefined();
  });
});

describe('reconcileIntent — deterministic wins on explicit numbers', () => {
  it('overrides a wrong hole diameter (LLM Ø8, prompt Ø10)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 8 } }],
    };
    const rec = reconcileIntent(intent, extractDimensions('a 50mm cube with a 10mm hole through the center'));
    expect(rec.intent.features![0].params!.diameter).toBe(10);
    expect(rec.overrides.some(o => o.field === 'hole.diameter' && o.to === 10)).toBe(true);
  });

  it('leaves a correct diameter untouched (no spurious override)', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10 } }],
    };
    const rec = reconcileIntent(intent, extractDimensions('a 50mm cube with a 10mm hole through the center'));
    expect(rec.overrides).toHaveLength(0);
  });

  it('adds the hole the LLM omitted', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 40, height: 5, depth: 40 }, features: [] };
    const rec = reconcileIntent(intent, extractDimensions('40x40x5 plate with a 12mm hole in the middle'));
    const holes = (rec.intent.features ?? []).filter(f => f.type === 'hole');
    expect(holes).toHaveLength(1);
    expect(holes[0].params!.diameter).toBe(12);
  });

  it('rebuilds 4 corner holes at the stated count/diameter, bored through the thin axis', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 100, height: 8, depth: 100 },
      // LLM produced a single mis-placed hole
      features: [{ type: 'hole', params: { diameter: 5, x: 10, y: 0, z: 10 } }],
    };
    const rec = reconcileIntent(intent, extractDimensions('100x100x8 plate with 4 corner holes 8mm'));
    const holes = (rec.intent.features ?? []).filter(f => f.type === 'hole');
    expect(holes).toHaveLength(4);
    for (const h of holes) {
      expect(h.params!.diameter).toBe(8);
      expect(h.params!.axis).toBe(1); // thin axis = height (Y)
    }
    // symmetric corners in the X-Z plane
    const xs = holes.map(h => h.params!.x).sort((a, b) => a! - b!);
    const zs = holes.map(h => h.params!.z).sort((a, b) => a! - b!);
    expect(xs[0]).toBeLessThan(0);
    expect(xs[3]).toBeGreaterThan(0);
    expect(zs[0]).toBeLessThan(0);
    expect(zs[3]).toBeGreaterThan(0);
    expect(Math.abs(xs[0]!)).toBeCloseTo(Math.abs(xs[3]!), 6);
  });

  it('flange: OD / bore / PCD / count from the prompt', () => {
    const intent: IntentInput = {
      shapeId: 'flange',
      // LLM guessed wrong on everything numeric
      params: { outerDiameter: 90, innerDiameter: 40, pcd: 70, boltCount: 4, boltDiameter: 6 },
    };
    const rec = reconcileIntent(intent, extractDimensions('flange OD100 bore60 8 bolt holes on 80mm circle'));
    const p = rec.intent.params;
    expect(p.outerDiameter).toBe(100);
    expect(p.innerDiameter).toBe(60);
    expect(p.pcd).toBe(80);
    expect(p.boltCount).toBe(8);
  });

  it('bolt: metric + length map onto shaft params', () => {
    const intent: IntentInput = { shapeId: 'bolt', params: { shaftDiameter: 6, shaftLength: 20 } };
    const rec = reconcileIntent(intent, extractDimensions('M8 hex bolt 30mm long'));
    expect(rec.intent.params.shaftDiameter).toBe(8);
    expect(rec.intent.params.shaftLength).toBe(30);
  });

  it('is a no-op when the prompt states no reconcilable numbers (easy tier safe)', () => {
    const intent: IntentInput = { shapeId: 'box', params: { width: 30, height: 30, depth: 30 } };
    const rec = reconcileIntent(intent, extractDimensions('30mm cube'));
    expect(rec.overrides).toHaveLength(0);
    expect(rec.intent.features ?? []).toHaveLength(0);
  });

  it('does not mutate the input intent', () => {
    const intent: IntentInput = {
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 8 } }],
    };
    reconcileIntent(intent, extractDimensions('a 50mm cube with a 10mm hole through the center'));
    expect(intent.features![0].params!.diameter).toBe(8); // original unchanged
  });
});
