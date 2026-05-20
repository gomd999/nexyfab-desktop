import { describe, it, expect } from 'vitest';
import {
  planBeadSequence,
  splitBackStep,
  checkHeatBalance,
  summarize,
  type Bead,
} from './beadSequencePlanner';

function bead(id: string, x: number, y: number, len: number, side: Bead['side'], heat: number = 1.0, stiff: Bead['stiffness'] = 'thin'): Bead {
  return { id, centre: { x, y }, lengthMm: len, side, heatKjPerMm: heat, stiffness: stiff };
}

describe('planBeadSequence', () => {
  it('empty list → empty steps', () => {
    const plan = planBeadSequence([]);
    expect(plan.steps).toEqual([]);
    expect(plan.centroid).toEqual({ x: 0, y: 0 });
  });

  it('single bead → 1 step', () => {
    const plan = planBeadSequence([bead('b1', 10, 0, 100, 'right')]);
    expect(plan.steps).toHaveLength(1);
  });

  it('orders symmetric beads to balance moment', () => {
    const beads = [
      bead('left', -10, 0, 100, 'left'),
      bead('right', 10, 0, 100, 'right'),
    ];
    const plan = planBeadSequence(beads);
    // After both, moment should return near zero.
    expect(plan.steps[1]!.cumulativeMoment).toBeLessThan(plan.steps[0]!.cumulativeMoment + 1e-6);
  });

  it('stiffness-first orders stiff bead first', () => {
    const beads = [
      bead('thin', 0, 0, 100, 'centre', 1, 'thin'),
      bead('stiff', 0, 0, 100, 'centre', 1, 'stiff'),
    ];
    const plan = planBeadSequence(beads, { stiffnessFirst: true, maxImbalance: 5000, cooldownSPerKj: 60 });
    expect(plan.steps[0]!.beadId).toBe('stiff');
  });

  it('warning when worst imbalance exceeds threshold', () => {
    const beads = [bead('l', -100, 0, 1000, 'left')];
    const plan = planBeadSequence(beads, { maxImbalance: 100, cooldownSPerKj: 60, stiffnessFirst: true });
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('records cooldown per bead', () => {
    const plan = planBeadSequence([bead('b1', 0, 0, 100, 'centre', 2)]);
    expect(plan.steps[0]!.cooldownAfterSec).toBeGreaterThan(0);
  });

  it('cumulative moment monotone non-decreasing in magnitude is NOT required (back-step)', () => {
    const beads = [
      bead('l1', -10, 0, 100, 'left'),
      bead('r1', 10, 0, 100, 'right'),
      bead('l2', -20, 0, 100, 'left'),
      bead('r2', 20, 0, 100, 'right'),
    ];
    const plan = planBeadSequence(beads);
    expect(plan.steps).toHaveLength(4);
  });
});

describe('splitBackStep', () => {
  it('zero segments → empty', () => {
    expect(splitBackStep('b1', 100, 0)).toEqual([]);
  });

  it('splits into N equal segments', () => {
    const segs = splitBackStep('b1', 100, 4);
    expect(segs).toHaveLength(4);
    expect(segs[0]!.endMm).toBeCloseTo(25, 5);
  });

  it('all segments tagged as back-step direction', () => {
    const segs = splitBackStep('b1', 100, 4);
    expect(segs.every(s => s.direction === -1)).toBe(true);
  });
});

describe('checkHeatBalance', () => {
  it('symmetric → balanced', () => {
    const beads = [
      bead('l', 0, 0, 100, 'left', 1),
      bead('r', 0, 0, 100, 'right', 1),
    ];
    expect(checkHeatBalance(beads).balanced).toBe(true);
  });

  it('asymmetric → not balanced (within 20% tol)', () => {
    const beads = [
      bead('l', 0, 0, 100, 'left', 1),
      bead('r', 0, 0, 50, 'right', 1),
    ];
    expect(checkHeatBalance(beads).balanced).toBe(false);
  });

  it('only centre beads → balanced (no L/R heat)', () => {
    expect(checkHeatBalance([bead('c', 0, 0, 100, 'centre')]).balanced).toBe(true);
  });
});

describe('summarize', () => {
  it('reports bead count + cooldown', () => {
    const plan = planBeadSequence([bead('b1', 0, 0, 100, 'centre', 1), bead('b2', 0, 0, 100, 'centre', 1)]);
    const s = summarize(plan);
    expect(s.beadCount).toBe(2);
    expect(s.totalCooldownSec).toBeGreaterThan(0);
  });

  it('warningCount tracks plan warnings', () => {
    const plan = planBeadSequence([bead('l', -100, 0, 1000, 'left')], { maxImbalance: 100, cooldownSPerKj: 60, stiffnessFirst: true });
    expect(summarize(plan).warningCount).toBeGreaterThan(0);
  });
});
