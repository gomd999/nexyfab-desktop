import { describe, it, expect } from 'vitest';
import { computeExplodedView, type AssemblyPart, type AssemblyMate } from './explodedView';

const parts3: AssemblyPart[] = [
  { id: 'a', position: [0, 0, 0], extentMm: 10 },
  { id: 'b', position: [0, 0, 10], extentMm: 10 },
  { id: 'c', position: [0, 0, 20], extentMm: 10 },
];

const matesZ: AssemblyMate[] = [
  { parts: ['a', 'b'], axis: [0, 0, 1] },
  { parts: ['b', 'c'], axis: [0, 0, 1] },
];

describe('computeExplodedView', () => {
  it('derives Z axis from coaxial mates', () => {
    const r = computeExplodedView(parts3, matesZ);
    expect(r.axis).toEqual([0, 0, 1]);
  });

  it('produces an offset for every part', () => {
    const r = computeExplodedView(parts3, matesZ);
    expect(r.offsets.size).toBe(3);
    for (const p of parts3) expect(r.offsets.has(p.id)).toBe(true);
  });

  it('first part along axis has zero offset', () => {
    const r = computeExplodedView(parts3, matesZ);
    expect(r.offsets.get('a')).toEqual([0, 0, 0]);
  });

  it('later parts get progressively larger offsets', () => {
    const r = computeExplodedView(parts3, matesZ);
    const oa = r.offsets.get('a')![2];
    const ob = r.offsets.get('b')![2];
    const oc = r.offsets.get('c')![2];
    expect(ob).toBeGreaterThan(oa);
    expect(oc).toBeGreaterThan(ob);
  });

  it('factor scales the gap', () => {
    const sparse = computeExplodedView(parts3, matesZ, { factor: 3 });
    const dense = computeExplodedView(parts3, matesZ, { factor: 1 });
    expect(sparse.offsets.get('c')![2]).toBeGreaterThan(dense.offsets.get('c')![2]);
  });

  it('honors explicit axis override', () => {
    const r = computeExplodedView(parts3, [], { axis: 'x' });
    expect(r.axis).toEqual([1, 0, 0]);
    expect(r.offsets.get('c')![0]).toBeGreaterThan(0);
  });

  it('trail endpoints match offset deltas', () => {
    const r = computeExplodedView(parts3, matesZ);
    const trailC = r.trails.find(t => t.partId === 'c')!;
    const offsetC = r.offsets.get('c')!;
    expect(trailC.toMm[2] - trailC.fromMm[2]).toBeCloseTo(offsetC[2], 6);
  });

  it('handles empty mates with default Z axis', () => {
    const r = computeExplodedView(parts3, []);
    expect(r.axis).toEqual([0, 0, 1]);
  });
});
