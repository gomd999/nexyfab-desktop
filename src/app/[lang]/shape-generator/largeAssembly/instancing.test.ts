import { describe, it, expect } from 'vitest';
import {
  buildInstanceGroups,
  nonInstancedParts,
  drawCallSavings,
  type PartInstance,
} from './instancing';

function bolt(i: number): PartInstance {
  return {
    id: `bolt-${i}`,
    geometryHash: 'h-bolt-m6',
    transform: Array.from({ length: 16 }, (_, k) => k === 0 || k === 5 || k === 10 || k === 15 ? 1 : 0),
  };
}

describe('buildInstanceGroups', () => {
  it('groups parts with identical geometry hash', () => {
    const parts = [bolt(0), bolt(1), bolt(2), bolt(3), bolt(4)];
    const g = buildInstanceGroups(parts);
    expect(g).toHaveLength(1);
    expect(g[0].instanceIds).toHaveLength(5);
  });

  it('filters out groups below minGroupSize', () => {
    const parts = [bolt(0), bolt(1), bolt(2)]; // 3 < default 4
    expect(buildInstanceGroups(parts)).toHaveLength(0);
  });

  it('respects custom minGroupSize', () => {
    const parts = [bolt(0), bolt(1)];
    expect(buildInstanceGroups(parts, { minGroupSize: 2 })).toHaveLength(1);
    expect(buildInstanceGroups(parts, { minGroupSize: 3 })).toHaveLength(0);
  });

  it('sorts groups by size descending', () => {
    const parts: PartInstance[] = [
      { ...bolt(0), geometryHash: 'small' },
      { ...bolt(1), geometryHash: 'small' },
      { ...bolt(2), geometryHash: 'small' },
      { ...bolt(3), geometryHash: 'small' },
      { ...bolt(4), geometryHash: 'big' },
      { ...bolt(5), geometryHash: 'big' },
      { ...bolt(6), geometryHash: 'big' },
      { ...bolt(7), geometryHash: 'big' },
      { ...bolt(8), geometryHash: 'big' },
      { ...bolt(9), geometryHash: 'big' },
    ];
    const g = buildInstanceGroups(parts);
    expect(g[0].instanceIds.length).toBeGreaterThanOrEqual(g[1].instanceIds.length);
    expect(g[0].geometryHash).toBe('big');
  });
});

describe('nonInstancedParts', () => {
  it('returns parts not covered by any group', () => {
    const parts = [
      bolt(0), bolt(1), bolt(2), bolt(3), bolt(4),  // group
      { ...bolt(99), geometryHash: 'unique' },
    ];
    const groups = buildInstanceGroups(parts);
    const remaining = nonInstancedParts(parts, groups);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('bolt-99');
  });
});

describe('drawCallSavings', () => {
  it('reports (count − 1) per group', () => {
    const parts = [bolt(0), bolt(1), bolt(2), bolt(3), bolt(4), bolt(5)];
    const groups = buildInstanceGroups(parts);
    // 6 instances collapse to 1 call → save 5.
    expect(drawCallSavings(groups)).toBe(5);
  });

  it('zero when no groups exist', () => {
    expect(drawCallSavings([])).toBe(0);
  });
});
