import { describe, it, expect } from 'vitest';
import {
  planGrainOrientation,
  summarize,
  type BendLine,
} from './grainDirectionPlanner';

function bend(id: string, dx: number, dy: number, criticality: BendLine['criticality'] = 'standard'): BendLine {
  return { id, direction: { x: dx, y: dy }, criticality };
}

describe('planGrainOrientation', () => {
  it('empty input → empty result', () => {
    const r = planGrainOrientation([]);
    expect(r.classifications).toEqual([]);
    expect(r.suggestedRotationDeg).toBe(0);
  });

  it('bend perpendicular to grain → favorable', () => {
    // Grain along X, bend along Y → perpendicular.
    const r = planGrainOrientation([bend('b1', 0, 1)], { grainDirection: { x: 1, y: 0 } });
    expect(r.classifications[0]!.rating).toBe('favorable');
  });

  it('bend parallel to grain → unfavorable', () => {
    const r = planGrainOrientation([bend('b1', 1, 0)], { grainDirection: { x: 1, y: 0 } });
    expect(r.classifications[0]!.rating).toBe('unfavorable');
  });

  it('bend 45° to grain → marginal', () => {
    const r = planGrainOrientation([bend('b1', 1, 1)], { grainDirection: { x: 1, y: 0 } });
    expect(r.classifications[0]!.rating).toBe('marginal');
  });

  it('riskFlag set for critical + unfavorable', () => {
    const r = planGrainOrientation([bend('b1', 1, 0, 'critical')], { grainDirection: { x: 1, y: 0 } });
    expect(r.classifications[0]!.riskFlag).toBe(true);
  });

  it('no risk for standard + unfavorable', () => {
    const r = planGrainOrientation([bend('b1', 1, 0, 'standard')], { grainDirection: { x: 1, y: 0 } });
    expect(r.classifications[0]!.riskFlag).toBe(false);
  });

  it('angle within [0, 90]', () => {
    const bends = [bend('a', 1, 1), bend('b', -1, 1), bend('c', 0, 1)];
    const r = planGrainOrientation(bends);
    for (const c of r.classifications) {
      expect(c.angleToGrainDeg).toBeGreaterThanOrEqual(0);
      expect(c.angleToGrainDeg).toBeLessThanOrEqual(90);
    }
  });

  it('suggested rotation rotates critical bends to favorable', () => {
    const bends = [bend('crit', 1, 0, 'critical')];
    const r = planGrainOrientation(bends, { grainDirection: { x: 1, y: 0 } });
    expect(r.suggestedRotationDeg).not.toBe(0);
  });

  it('optimality score in [0, 1]', () => {
    const bends = [bend('a', 0, 1, 'critical'), bend('b', 1, 0)];
    const r = planGrainOrientation(bends);
    expect(r.optimalityScore).toBeGreaterThanOrEqual(0);
    expect(r.optimalityScore).toBeLessThanOrEqual(1);
  });
});

describe('summarize', () => {
  it('empty', () => {
    const s = summarize({ classifications: [], suggestedRotationDeg: 0, optimalityScore: 0 });
    expect(s.bendCount).toBe(0);
  });

  it('counts each rating', () => {
    const bends = [
      bend('p', 0, 1), // favorable
      bend('p2', 0, 1), // favorable
      bend('a', 1, 0), // unfavorable
      bend('m', 1, 1), // marginal
    ];
    const r = planGrainOrientation(bends);
    const s = summarize(r);
    expect(s.favorableCount).toBe(2);
    expect(s.unfavorableCount).toBe(1);
    expect(s.marginalCount).toBe(1);
  });

  it('counts critical-at-risk', () => {
    const bends = [bend('crit', 1, 0, 'critical')];
    const r = planGrainOrientation(bends);
    const s = summarize(r);
    expect(s.criticalAtRiskCount).toBe(1);
  });
});
