import { describe, it, expect } from 'vitest';
import type { PlacedPart } from './PartPlacementPanel';
import { simulateAssembly } from './assemblySimulation';

const part = (over: Partial<PlacedPart>): PlacedPart => ({
  id: 'p', name: 'p', shapeId: 'box', params: { width: 20, height: 20, depth: 20 },
  qty: 1, position: [0, 0, 0], rotation: [0, 0, 0], ...over,
});

describe('simulateAssembly', () => {
  it('a stable, non-overlapping assembly passes (ok)', () => {
    const r = simulateAssembly([
      part({ id: 'base', shapeId: 'box', params: { width: 100, height: 5, depth: 100 }, position: [0, 0, 0] }),
      part({ id: 'top', shapeId: 'box', params: { width: 20, height: 20, depth: 20 }, position: [0, 12.5, 0] }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.stable).toBe(true);
    expect(r.hasInterference).toBe(false);
    expect(r.issues).toHaveLength(0);
  });

  it('detects interference when two parts occupy the same space', () => {
    const r = simulateAssembly([
      part({ id: 'a', position: [0, 0, 0] }),
      part({ id: 'b', position: [5, 0, 0] }), // two 20mm boxes 5mm apart → overlap
    ]);
    expect(r.hasInterference).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.kind === 'interference')).toBe(true);
  });

  it('detects tipping (CoM past the support)', () => {
    const r = simulateAssembly([
      part({ id: 'base', shapeId: 'box', params: { width: 20, height: 4, depth: 20 }, position: [0, 0, 0] }),
      part({ id: 'mass', shapeId: 'box', params: { width: 10, height: 80, depth: 10 }, position: [60, 42, 0], materialId: 'steel-1018' }),
    ]);
    expect(r.stable).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.kind === 'tipping')).toBe(true);
  });

  it('empty assembly → not ok, warns', () => {
    const r = simulateAssembly([]);
    expect(r.ok).toBe(false);
    expect(r.issues.some(i => i.kind === 'empty')).toBe(true);
  });

  it('changing a part (denser material) is reflected in the balance', () => {
    const light = simulateAssembly([part({ materialId: 'al-6061-t6' })]);
    const heavy = simulateAssembly([part({ materialId: 'steel-1018' })]);
    expect(heavy.balance.totalMassG).toBeGreaterThan(light.balance.totalMassG);
  });
});
