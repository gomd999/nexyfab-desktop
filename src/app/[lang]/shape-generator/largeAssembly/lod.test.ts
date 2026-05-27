import { describe, it, expect } from 'vitest';
import {
  pickLodTier,
  tierMultiplier,
  targetTriangles,
  assignLodTiers,
  DEFAULT_THRESHOLDS,
  type PartLodInput,
} from './lod';

describe('pickLodTier', () => {
  it('close → tier 0', () => {
    expect(pickLodTier(50)).toBe(0);
  });

  it('far → tier 4 imposter', () => {
    expect(pickLodTier(5000)).toBe(4);
  });

  it('tiers ascend with distance', () => {
    expect(pickLodTier(50)).toBe(0);
    expect(pickLodTier(150)).toBe(1);
    expect(pickLodTier(400)).toBe(2);
    expect(pickLodTier(1000)).toBe(3);
    expect(pickLodTier(3000)).toBe(4);
  });

  it('partSize scales thresholds (large parts stay sharp from farther)', () => {
    // Default tier1At = 100. A 5m part at distance 200 → 200 < 5×100 = 500 → tier 0.
    expect(pickLodTier(200, DEFAULT_THRESHOLDS, 5)).toBe(0);
    // Same distance, 1m part → already tier 1.
    expect(pickLodTier(200, DEFAULT_THRESHOLDS, 1)).toBe(1);
  });
});

describe('tierMultiplier', () => {
  it('decreases monotonically', () => {
    expect(tierMultiplier(0)).toBeGreaterThan(tierMultiplier(1));
    expect(tierMultiplier(1)).toBeGreaterThan(tierMultiplier(2));
    expect(tierMultiplier(2)).toBeGreaterThan(tierMultiplier(3));
    expect(tierMultiplier(3)).toBeGreaterThan(tierMultiplier(4));
  });

  it('tier 0 is 100% (full res)', () => {
    expect(tierMultiplier(0)).toBe(1.0);
  });
});

describe('targetTriangles', () => {
  it('caps at 1 part minimum 8 triangles', () => {
    expect(targetTriangles(2, 4)).toBe(8);
  });

  it('scales raw count by the tier multiplier', () => {
    expect(targetTriangles(1000, 0)).toBe(1000);
    expect(targetTriangles(1000, 1)).toBe(500);
    expect(targetTriangles(1000, 2)).toBe(250);
  });
});

describe('assignLodTiers · distance-based defaults', () => {
  it('assigns one tier per part based on distance', () => {
    const parts: PartLodInput[] = [
      { id: 'near', distance: 50, rawTriCount: 1000, size: 1 },
      { id: 'far',  distance: 1500, rawTriCount: 1000, size: 1 },
    ];
    const a = assignLodTiers(parts);
    expect(a.find(x => x.id === 'near')?.tier).toBe(0);
    expect(a.find(x => x.id === 'far')?.tier).toBe(3);
  });
});

describe('assignLodTiers · budget back-off', () => {
  it('keeps assignment under triangle budget by bumping far parts to higher tier', () => {
    // 100 parts × 1000 tris = 100k raw. Budget = 10k.
    const parts: PartLodInput[] = Array.from({ length: 100 }, (_, i) => ({
      id: `p${i}`,
      distance: i * 5,    // 0..495 — many would be tier 0..2
      rawTriCount: 1000,
      size: 1,
    }));
    const a = assignLodTiers(parts, { triangleBudget: 10_000 });
    const total = a.reduce((s, x) => s + x.targetTris, 0);
    expect(total).toBeLessThanOrEqual(10_000 + 100); // small slack for min-8 floor
  });

  it('no back-off needed when total is below budget', () => {
    const parts: PartLodInput[] = [
      { id: 'a', distance: 10, rawTriCount: 100, size: 1 },
      { id: 'b', distance: 20, rawTriCount: 100, size: 1 },
    ];
    const a = assignLodTiers(parts, { triangleBudget: 10_000 });
    expect(a.every(x => x.tier === 0)).toBe(true);
  });
});
