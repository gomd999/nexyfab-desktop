import { describe, it, expect } from 'vitest';
import {
  planBendSequence,
  detectCollision,
  bendDeduction,
  summarizeSetups,
  type Bend,
} from './bendSequence';

function bend(id: string, pos: number, opts: Partial<Bend> = {}): Bend {
  return {
    id,
    positionMm: pos,
    angleDeg: 90,
    direction: 'up',
    toolId: 't1',
    flangeLengthMm: 20,
    ...opts,
  };
}

describe('planBendSequence', () => {
  it('empty input → empty output', () => {
    const r = planBendSequence([]);
    expect(r.order).toEqual([]);
    expect(r.toolChangeCount).toBe(0);
  });

  it('orders short flanges first', () => {
    const bends = [
      bend('long', 100, { flangeLengthMm: 80 }),
      bend('short', 0, { flangeLengthMm: 10 }),
    ];
    const r = planBendSequence(bends);
    expect(r.order[0]).toBe('short');
  });

  it('respects precedence (drill before tap)', () => {
    const bends = [
      bend('B2', 50, { afterIds: ['B1'] }),
      bend('B1', 0),
    ];
    const r = planBendSequence(bends);
    expect(r.order.indexOf('B1')).toBeLessThan(r.order.indexOf('B2'));
    expect(r.precedenceSatisfied).toBe(true);
  });

  it('clusters same-tool bends', () => {
    const bends = [
      bend('a', 0, { toolId: 't1' }),
      bend('b', 10, { toolId: 't2' }),
      bend('c', 20, { toolId: 't1' }),
    ];
    const r = planBendSequence(bends);
    const tools = r.order.map(id => bends.find(b => b.id === id)!.toolId);
    // Same-tool bends should be contiguous.
    const t1Pos = tools.map((t, i) => t === 't1' ? i : -1).filter(i => i >= 0);
    expect(t1Pos[1]! - t1Pos[0]!).toBe(1);
  });

  it('returns all bends', () => {
    const bends = [bend('a', 0), bend('b', 10), bend('c', 20)];
    expect(planBendSequence(bends).order).toHaveLength(3);
  });
});

describe('detectCollision', () => {
  it('long flange that reaches another bend → collision', () => {
    const prev = bend('p1', 0, { flangeLengthMm: 50, angleDeg: 90, direction: 'up' });
    const cand = bend('p2', 10, { direction: 'up' });
    const r = detectCollision(cand, [prev], { punchClearanceMm: 25, dieOpeningMm: 8, toolClusterWeight: 0 });
    expect(r).not.toBeNull();
  });

  it('opposite-direction bends do not collide', () => {
    const prev = bend('p1', 0, { flangeLengthMm: 50, direction: 'up' });
    const cand = bend('p2', 10, { direction: 'down' });
    const r = detectCollision(cand, [prev], { punchClearanceMm: 25, dieOpeningMm: 8, toolClusterWeight: 0 });
    expect(r).toBeNull();
  });

  it('distant bend → no collision', () => {
    const prev = bend('p1', 0, { flangeLengthMm: 5 });
    const cand = bend('p2', 200);
    expect(detectCollision(cand, [prev], { punchClearanceMm: 25, dieOpeningMm: 8, toolClusterWeight: 0 })).toBeNull();
  });

  it('empty history → no collision', () => {
    expect(detectCollision(bend('a', 0), [], { punchClearanceMm: 25, dieOpeningMm: 8, toolClusterWeight: 0 })).toBeNull();
  });
});

describe('bendDeduction', () => {
  it('90° bend in 2mm material returns finite value', () => {
    const r = bendDeduction(2, 90);
    expect(isFinite(r)).toBe(true);
  });

  it('larger angle → larger deduction', () => {
    const small = bendDeduction(2, 30);
    const large = bendDeduction(2, 120);
    expect(Math.abs(large)).toBeGreaterThan(Math.abs(small));
  });
});

describe('summarizeSetups', () => {
  it('groups consecutive same-tool bends', () => {
    const bends = [
      bend('a', 0, { toolId: 't1' }),
      bend('b', 10, { toolId: 't1' }),
      bend('c', 20, { toolId: 't2' }),
      bend('d', 30, { toolId: 't1' }),
    ];
    const r = summarizeSetups(['a', 'b', 'c', 'd'], bends);
    expect(r.setupCount).toBe(3);
    expect(r.setupGroups[0]!.bendIds).toEqual(['a', 'b']);
  });

  it('single-tool job has setupCount = 1', () => {
    const bends = [bend('a', 0), bend('b', 10), bend('c', 20)];
    const r = summarizeSetups(['a', 'b', 'c'], bends);
    expect(r.setupCount).toBe(1);
  });
});
