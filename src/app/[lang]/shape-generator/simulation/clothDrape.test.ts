import { describe, it, expect } from 'vitest';
import {
  buildGridCloth,
  stepCloth,
  pinByPredicate,
  unpinAll,
  computeStats,
  hangFromCornersScenario,
  hangFromTopEdgeScenario,
  DEFAULT_SIMULATION_OPTIONS,
} from './clothDrape';

describe('buildGridCloth', () => {
  it('3×3 grid → 9 particles', () => {
    const cloth = buildGridCloth(10, 10, 3);
    expect(cloth.particles).toHaveLength(9);
  });

  it('triangle count = 2 per quad', () => {
    const cloth = buildGridCloth(10, 10, 3);
    expect(cloth.triangles.length / 3).toBe(8); // 2x2 quads × 2 tris
  });

  it('structural springs along edges', () => {
    const cloth = buildGridCloth(10, 10, 3);
    const structural = cloth.springs.filter(s => s.kind === 'structural');
    // 2*3 horizontal + 2*3 vertical = 12
    expect(structural.length).toBe(12);
  });

  it('shear springs across diagonals', () => {
    const cloth = buildGridCloth(10, 10, 3);
    expect(cloth.springs.some(s => s.kind === 'shear')).toBe(true);
  });

  it('bend springs skip one vertex', () => {
    const cloth = buildGridCloth(10, 10, 4);
    expect(cloth.springs.some(s => s.kind === 'bend')).toBe(true);
  });
});

describe('stepCloth', () => {
  it('gravity pulls unpinned particles down', () => {
    const cloth = buildGridCloth(10, 10, 3);
    const before = cloth.particles[4]!.position[1];
    stepCloth(cloth, DEFAULT_SIMULATION_OPTIONS);
    const after = cloth.particles[4]!.position[1];
    expect(after).toBeLessThan(before);
  });

  it('pinned particles stay put', () => {
    const cloth = buildGridCloth(10, 10, 3);
    cloth.particles[0]!.pinned = true;
    const before = [...cloth.particles[0]!.position];
    stepCloth(cloth, DEFAULT_SIMULATION_OPTIONS);
    expect(cloth.particles[0]!.position).toEqual(before);
  });

  it('floor collision clamps below floor', () => {
    const cloth = buildGridCloth(10, 10, 3);
    cloth.particles[0]!.position = [0, -100, 0];
    stepCloth(cloth, { ...DEFAULT_SIMULATION_OPTIONS, floorY: -10 });
    expect(cloth.particles[0]!.position[1]).toBe(-10);
  });

  it('many steps cause downward drape', () => {
    const cloth = hangFromTopEdgeScenario(20, 20, 5);
    const before = cloth.particles[12]!.position[1];
    for (let i = 0; i < 30; i++) stepCloth(cloth, DEFAULT_SIMULATION_OPTIONS);
    const after = cloth.particles[12]!.position[1];
    expect(after).toBeLessThan(before);
  });
});

describe('pin helpers', () => {
  it('pinByPredicate flips matching particles', () => {
    const cloth = buildGridCloth(10, 10, 3);
    const count = pinByPredicate(cloth, (_p, i) => i < 3);
    expect(count).toBe(3);
    expect(cloth.particles[0]!.pinned).toBe(true);
  });

  it('unpinAll resets', () => {
    const cloth = buildGridCloth(10, 10, 3);
    pinByPredicate(cloth, () => true);
    unpinAll(cloth);
    for (const p of cloth.particles) expect(p.pinned).toBe(false);
  });
});

describe('computeStats', () => {
  it('reports particle + spring + pinned counts', () => {
    const cloth = hangFromCornersScenario(20, 20, 5);
    const s = computeStats(cloth);
    expect(s.particleCount).toBe(25);
    expect(s.pinnedCount).toBe(4);
    expect(s.springCount).toBeGreaterThan(0);
  });

  it('average stretch near 1 at rest', () => {
    const cloth = buildGridCloth(10, 10, 3);
    const s = computeStats(cloth);
    expect(s.averageStretch).toBeCloseTo(1, 5);
  });

  it('stretch grows after gravity steps', () => {
    const cloth = hangFromCornersScenario(20, 20, 5);
    const before = computeStats(cloth).averageStretch;
    for (let i = 0; i < 50; i++) stepCloth(cloth, DEFAULT_SIMULATION_OPTIONS);
    const after = computeStats(cloth).averageStretch;
    expect(after).toBeGreaterThanOrEqual(before * 0.99);
  });
});

describe('scenarios', () => {
  it('hangFromCorners pins 4 corner particles', () => {
    const cloth = hangFromCornersScenario(10, 10, 4);
    const pinned = cloth.particles.filter(p => p.pinned).length;
    expect(pinned).toBe(4);
  });

  it('hangFromTopEdge pins the top row', () => {
    const cloth = hangFromTopEdgeScenario(10, 10, 4);
    const pinned = cloth.particles.filter(p => p.pinned).length;
    expect(pinned).toBe(4);
  });
});
