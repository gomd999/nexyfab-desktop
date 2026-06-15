/**
 * composedTopo — stable edge names inherited across a boolean (K2.2).
 */
import { describe, it, expect } from 'vitest';
import { composeBooleanTopo, fromAnchors, type BooleanInput } from './composedTopo';
import type { Vec3 } from '@/lib/sketch/sketchPlane';

function input(role: string, anchors: Record<string, Vec3>): BooleanInput {
  return {
    role,
    names: Object.keys(anchors),
    anchorOf: (n) => anchors[n] ?? null,
  };
}

describe('composeBooleanTopo', () => {
  const a = input('a', {
    'e.vert.0': { x: 0, y: 0, z: 2.5 },
    'e.vert.1': { x: 10, y: 0, z: 2.5 },
    'e.gone': { x: 5, y: 5, z: 2.5 }, // consumed by the boolean → no result edge
  });
  const b = input('b', {
    'e.top.0-1': { x: 4, y: 5, z: 7 },
  });

  // Result edges: a/e.vert.0, a/e.vert.1, b/e.top.0-1 survive; one new seam.
  const resultMids: Vec3[] = [
    { x: 10, y: 0, z: 2.5 }, // a/e.vert.1
    { x: 4, y: 5, z: 7 },    // b/e.top.0-1
    { x: 5, y: 5, z: 3 },    // seam (no input match)
    { x: 0, y: 0, z: 2.5 },  // a/e.vert.0
  ];

  it('inherits surviving input names with a role prefix', () => {
    const t = composeBooleanTopo([a, b], resultMids);
    expect(t.anchor('a/e.vert.0')).toEqual({ x: 0, y: 0, z: 2.5 });
    expect(t.anchor('a/e.vert.1')).toEqual({ x: 10, y: 0, z: 2.5 });
    expect(t.anchor('b/e.top.0-1')).toEqual({ x: 4, y: 5, z: 7 });
  });

  it('drops names whose edge did not survive the boolean', () => {
    const t = composeBooleanTopo([a, b], resultMids);
    expect(t.anchor('a/e.gone')).toBeNull();
  });

  it('names the leftover intersection edge as a seam', () => {
    const t = composeBooleanTopo([a, b], resultMids);
    expect(t.anchor('seam.0')).toEqual({ x: 5, y: 5, z: 3 });
    // every result edge is named exactly once (bijective coverage)
    expect(t.names()).toHaveLength(resultMids.length);
  });

  it('seam numbering is deterministic by midpoint, not kernel order', () => {
    const noNames: BooleanInput = { role: 'a', names: [], anchorOf: () => null };
    const mids: Vec3[] = [{ x: 9, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const t1 = composeBooleanTopo([noNames], mids);
    const t2 = composeBooleanTopo([noNames], [...mids].reverse());
    // seam.0 is the lexicographically-smallest midpoint regardless of input order
    expect(t1.anchor('seam.0')).toEqual({ x: 1, y: 0, z: 0 });
    expect(t2.anchor('seam.0')).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('fromAnchors exposes a sorted name list', () => {
    const t = fromAnchors(new Map([['z', { x: 0, y: 0, z: 0 }], ['a', { x: 1, y: 1, z: 1 }]]));
    expect(t.names()).toEqual(['a', 'z']);
    expect(t.anchor('missing')).toBeNull();
  });
});
