import { describe, it, expect } from 'vitest';
import { findRoutes, OP_LIBRARY } from './multiStepRouting';

describe('findRoutes', () => {
  it('returns at least one route for a basic CNC part', () => {
    const r = findRoutes({
      toleranceUm: 100,
      surfaceFinish: 'fine',
    });
    expect(r.length).toBeGreaterThan(0);
  });

  it('every returned route satisfies the tolerance requirement', () => {
    const target = 25;
    const r = findRoutes({
      toleranceUm: target,
      surfaceFinish: 'fine',
    });
    expect(r.length).toBeGreaterThan(0);
    // Walking the steps, final tolerance must be ≤ target.
    for (const route of r) {
      const finalTol = route.steps.reduce(
        (acc, s) => Math.min(acc, s.produces.toleranceUm ?? acc),
        1000,
      );
      expect(finalTol).toBeLessThanOrEqual(target);
    }
  });

  it('produces routes ending in required coating', () => {
    const r = findRoutes({
      toleranceUm: 100,
      surfaceFinish: 'fine',
      requiredCoatings: ['anodize'],
    });
    expect(r.length).toBeGreaterThan(0);
    for (const route of r) {
      const lastStepWithCoat = route.steps.find(s => s.produces.coatings?.includes('anodize'));
      expect(lastStepWithCoat).toBeDefined();
    }
  });

  it('cumulative risk strictly less than 1', () => {
    const r = findRoutes({ toleranceUm: 100, surfaceFinish: 'fine' });
    for (const route of r) {
      expect(route.cumulativeRisk).toBeLessThan(1);
      expect(route.cumulativeRisk).toBeGreaterThanOrEqual(0);
    }
  });

  it('total cost > 0 + emitted in USD', () => {
    const r = findRoutes({ toleranceUm: 100, surfaceFinish: 'fine' });
    expect(r[0]!.totalCostUsd).toBeGreaterThan(0);
  });

  it('respects maxDepth', () => {
    const r = findRoutes({ toleranceUm: 25, surfaceFinish: 'polished' }, OP_LIBRARY, 3, 100);
    for (const route of r) {
      expect(route.steps.length).toBeLessThanOrEqual(3);
    }
  });

  it('best route has highest weighted score', () => {
    const r = findRoutes({ toleranceUm: 100, surfaceFinish: 'fine' });
    expect(r.length).toBeGreaterThanOrEqual(2);
    // First route's weighted-component should be ≥ second's.
    const score = (a: typeof r[0]) =>
      a.dimensions.cost * 0.3 + a.dimensions.time * 0.2
      + a.dimensions.quality * 0.3 + a.dimensions.risk * 0.2;
    expect(score(r[0]!)).toBeGreaterThanOrEqual(score(r[1]!));
  });

  it('wire-EDM does not directly follow painting (cannotFollow rule)', () => {
    const r = findRoutes({
      toleranceUm: 5,
      surfaceFinish: 'fine',
      requiredCoatings: ['paint'],
    });
    for (const route of r) {
      for (let i = 1; i < route.steps.length; i++) {
        const prev = route.steps[i - 1]!;
        const cur = route.steps[i]!;
        if (cur.kind === 'wire-edm') {
          expect(prev.kind).not.toBe('painting');
        }
      }
    }
  });

  it('emits dimension scores in 0..100 range', () => {
    const r = findRoutes({ toleranceUm: 100, surfaceFinish: 'fine' });
    for (const route of r) {
      expect(route.dimensions.cost).toBeGreaterThanOrEqual(0);
      expect(route.dimensions.cost).toBeLessThanOrEqual(100);
      expect(route.dimensions.quality).toBeGreaterThanOrEqual(0);
      expect(route.dimensions.quality).toBeLessThanOrEqual(100);
    }
  });
});
