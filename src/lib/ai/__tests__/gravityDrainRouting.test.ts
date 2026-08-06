import { describe, expect, it } from 'vitest';
import { routeGravityDrain } from '../gravityDrainRouting';

describe('governed gravity drain routing', () => {
  it('routes around projected obstacles and assigns one continuous downward slope', () => {
    const result = routeGravityDrain({ id: 'drain', startMm: [0, 0, 1000], endMm: [10000, 0, 800], gridMm: 500, clearanceMm: 100, minimumSlopePercent: 1, maximumSlopePercent: 3, obstacles: [{ id: 'footing', minMm: [4000, -500, 0], maxMm: [6000, 500, 2000] }] });
    expect(result.status).toBe('routed'); expect(result.pathMm.length).toBeGreaterThan(2); expect(result.slopePercent).toBeGreaterThanOrEqual(1); expect(result.slopePercent).toBeLessThanOrEqual(3);
    expect(result.pathMm.every((point, index) => index === 0 || point[2] < result.pathMm[index - 1]![2])).toBe(true);
  });
  it('fails when available drop cannot satisfy governed slope', () => {
    const result = routeGravityDrain({ id: 'drain', startMm: [0, 0, 1000], endMm: [10000, 0, 980], gridMm: 500, clearanceMm: 0, minimumSlopePercent: 1, maximumSlopePercent: 3, obstacles: [] });
    expect(result).toMatchObject({ status: 'failed', slopePercent: 0.2 });
  });
  it('rejects an endpoint that is not lower than the source', () => expect(routeGravityDrain({ id: 'drain', startMm: [0, 0, 1000], endMm: [1000, 0, 1000], gridMm: 100, clearanceMm: 0, minimumSlopePercent: 1, maximumSlopePercent: 3, obstacles: [] }).status).toBe('failed'));
});
