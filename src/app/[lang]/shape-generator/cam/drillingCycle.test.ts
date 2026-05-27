import { describe, it, expect } from 'vitest';
import { buildDrillingCycle, type HoleSpec, type DrillingParams } from './drillingCycle';

const params: DrillingParams = { diameter: 5, topZ: 0, safeClearance: 5 };

describe('buildDrillingCycle · G81 (single plunge)', () => {
  it('reports cycle = G81 when peckDepth is 0 / unset', () => {
    const r = buildDrillingCycle([{ x: 0, y: 0, depth: 10 }], params);
    expect(r.cycle).toBe('G81');
  });

  it('emits 1 plunge per hole and rapid retract', () => {
    const r = buildDrillingCycle([{ x: 0, y: 0, depth: 10 }], params);
    const plunges = r.segments.filter(s => s.kind === 'plunge');
    expect(plunges).toHaveLength(1);
    expect(plunges[0].end[2]).toBe(-10);
  });

  it('rapid length includes the position-above-hole + final retract', () => {
    const r = buildDrillingCycle([{ x: 50, y: 30, depth: 5 }], params);
    expect(r.rapidLengthMm).toBeGreaterThan(0);
  });
});

describe('buildDrillingCycle · G83 (peck-and-retract)', () => {
  it('reports cycle = G83 when peckDepth > 0', () => {
    const r = buildDrillingCycle([{ x: 0, y: 0, depth: 10 }], { ...params, peckDepth: 2 });
    expect(r.cycle).toBe('G83');
  });

  it('emits multiple plunge segments for a deep hole', () => {
    const r = buildDrillingCycle([{ x: 0, y: 0, depth: 10 }], { ...params, peckDepth: 2 });
    const plunges = r.segments.filter(s => s.kind === 'plunge');
    expect(plunges.length).toBeGreaterThan(1);
  });

  it('total plunge depth sums to hole depth', () => {
    const r = buildDrillingCycle([{ x: 0, y: 0, depth: 10 }], { ...params, peckDepth: 2 });
    const totalPlungeDepth = r.segments
      .filter(s => s.kind === 'plunge')
      .reduce((acc, s) => acc + (s.start[2] - s.end[2]), 0);
    expect(totalPlungeDepth).toBeCloseTo(10, 2);
  });
});

describe('buildDrillingCycle · multi-hole', () => {
  it('processes holes in supplied order', () => {
    const holes: HoleSpec[] = [
      { x: 0, y: 0, depth: 5 },
      { x: 50, y: 0, depth: 5 },
    ];
    const r = buildDrillingCycle(holes, params);
    // Each hole adds at least: rapid-position + plunge + rapid-retract = 3 segs.
    expect(r.segments.length).toBeGreaterThanOrEqual(6);
  });

  it('reports zero-length output for empty hole list', () => {
    const r = buildDrillingCycle([], params);
    expect(r.segments).toHaveLength(0);
    expect(r.cutLengthMm).toBe(0);
  });
});

describe('buildDrillingCycle · safe Z', () => {
  it('rapid moves go to topZ + safeClearance', () => {
    const r = buildDrillingCycle([{ x: 0, y: 0, depth: 5 }], { ...params, safeClearance: 10 });
    const lastRapid = r.segments.findLast(s => s.kind === 'rapid');
    expect(lastRapid?.end[2]).toBe(10);
  });
});
