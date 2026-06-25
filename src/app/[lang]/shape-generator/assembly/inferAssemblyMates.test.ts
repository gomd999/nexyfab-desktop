import { describe, it, expect } from 'vitest';
import { inferAssemblyMates, type InferMatePart } from './inferAssemblyMates';

const part = (id: string, shapeId: string, position: [number, number, number]): InferMatePart =>
  ({ id, shapeId, params: {}, position });

describe('inferAssemblyMates', () => {
  it('infers concentric for a bolt coaxial with a centred hole-bearing plate', () => {
    // bolt and plate share x,z (=0), differ in y → coaxial on y.
    const mates = inferAssemblyMates([
      part('plate', 'box', [0, 0, 0]),
      part('bolt', 'bolt', [0, 9, 0]),
    ]);
    const conc = mates.find((m) => m.type === 'concentric');
    expect(conc).toBeTruthy();
    expect(conc!.axis).toBe('y');
    expect(new Set([conc!.partA, conc!.partB])).toEqual(new Set(['plate', 'bolt']));
  });

  it('infers a distance mate for two stacked plates with a gap', () => {
    const mates = inferAssemblyMates([
      part('bottom', 'box', [0, 0, 0]),
      part('top', 'box', [0, 9, 0]),
    ]);
    const dist = mates.find((m) => m.type === 'distance');
    expect(dist).toBeTruthy();
    expect(dist!.value).toBe(9);
    expect(dist!.axis).toBe('y');
  });

  it('does NOT mate off-axis corner legs (no coaxial relationship → no collapse)', () => {
    // 4 legs at the corners of a plate — none share 2 axes with each other or
    // the plate, so no mates (parts keep their corner positions).
    const mates = inferAssemblyMates([
      part('plate', 'box', [0, 0, 0]),
      part('leg1', 'cylinder', [30, -22, 30]),
      part('leg2', 'cylinder', [-30, -22, 30]),
      part('leg3', 'cylinder', [30, -22, -30]),
      part('leg4', 'cylinder', [-30, -22, -30]),
    ]);
    // legs share y (=-22) but differ in BOTH x and z from each other and the
    // plate → not lined up on any single axis → no concentric collapse.
    expect(mates.filter((m) => m.type === 'concentric')).toHaveLength(0);
  });

  it('a screw lined up with a cylinder gets concentric (fastener through part)', () => {
    const mates = inferAssemblyMates([
      part('boss', 'cylinder', [0, 0, 0]),
      part('screw', 'screw', [0, 0, 40]),
    ]);
    expect(mates.some((m) => m.type === 'concentric' && m.axis === 'z')).toBe(true);
    const dist = mates.find((m) => m.type === 'distance');
    expect(dist!.value).toBe(40);
  });

  it('two plain coaxial cylinders do NOT get a (guessed) concentric — needs axis info', () => {
    const mates = inferAssemblyMates([
      part('c1', 'cylinder', [0, 0, 0]),
      part('c2', 'cylinder', [0, 0, 40]),
    ]);
    expect(mates.filter((m) => m.type === 'concentric')).toHaveLength(0);
  });

  it('two boxes side-by-side (not lined up) → no mates', () => {
    const mates = inferAssemblyMates([
      part('a', 'box', [0, 0, 0]),
      part('b', 'box', [50, 0, 30]),
    ]);
    // differ in both x and z → not coaxial on any axis.
    expect(mates).toHaveLength(0);
  });

  it('is deterministic and pure (same input → same output)', () => {
    const parts = [part('a', 'cylinder', [0, 0, 0]), part('b', 'bolt', [0, 0, 10])];
    expect(inferAssemblyMates(parts)).toEqual(inferAssemblyMates(parts));
  });
});
