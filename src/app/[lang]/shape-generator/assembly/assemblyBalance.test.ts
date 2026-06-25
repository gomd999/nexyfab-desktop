import { describe, it, expect } from 'vitest';
import type { PlacedPart } from './PartPlacementPanel';
import { computeAssemblyBalance } from './assemblyBalance';

const part = (over: Partial<PlacedPart>): PlacedPart => ({
  id: 'p', name: 'p', shapeId: 'box', params: { width: 20, height: 20, depth: 20 },
  qty: 1, position: [0, 0, 0], rotation: [0, 0, 0], ...over,
});

describe('computeAssemblyBalance', () => {
  it('combined CoM is the mass-weighted mean of two equal parts', () => {
    const b = computeAssemblyBalance([
      part({ id: 'a', position: [-30, 0, 0] }),
      part({ id: 'b', position: [30, 0, 0] }),
    ]);
    // identical boxes at ±30 → CoM at x≈0
    expect(b.centerOfMass[0]).toBeCloseTo(0, 1);
    expect(b.perPart).toHaveLength(2);
    expect(b.totalMassG).toBeGreaterThan(0);
  });

  it('a heavier (denser) part pulls the CoM toward it', () => {
    const b = computeAssemblyBalance([
      part({ id: 'light', position: [-30, 0, 0], materialId: 'al-6061-t6' }), // 2700
      part({ id: 'heavy', position: [30, 0, 0], materialId: 'steel-1018' }),  // 7870
    ]);
    expect(b.centerOfMass[0]).toBeGreaterThan(5); // biased toward the steel side
  });

  it('mass uses material density (steel ≈ 7.85 g/cm³)', () => {
    // 20×20×20 = 8000 mm³ = 8 cm³ → steel ≈ 62.8 g
    const b = computeAssemblyBalance([part({ materialId: 'steel-1018' })]);
    expect(b.totalMassG).toBeGreaterThan(60);
    expect(b.totalMassG).toBeLessThan(66);
  });

  it('flags a stable stack (CoM over a wide base)', () => {
    const b = computeAssemblyBalance([
      part({ id: 'base', shapeId: 'box', params: { width: 100, height: 5, depth: 100 }, position: [0, 0, 0] }),
      part({ id: 'top', shapeId: 'box', params: { width: 20, height: 20, depth: 20 }, position: [0, 12.5, 0] }),
    ]);
    expect(b.stable).toBe(true);
    expect(b.marginMm).toBeGreaterThan(0);
  });

  it('flags TIPPING when the CoM hangs past the base footprint', () => {
    // A tall mass shoved far off the edge of a small base → CoM outside support.
    const b = computeAssemblyBalance([
      part({ id: 'base', shapeId: 'box', params: { width: 20, height: 4, depth: 20 }, position: [0, 0, 0] }),
      part({ id: 'mass', shapeId: 'box', params: { width: 10, height: 80, depth: 10 }, position: [60, 42, 0], materialId: 'steel-1018' }),
    ]);
    expect(b.stable).toBe(false);
    expect(b.marginMm).toBeLessThan(0);
  });

  it('empty assembly → not stable, zero mass', () => {
    const b = computeAssemblyBalance([]);
    expect(b.totalMassG).toBe(0);
    expect(b.stable).toBe(false);
  });
});
