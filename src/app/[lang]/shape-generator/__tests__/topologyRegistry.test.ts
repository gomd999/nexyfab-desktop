import { describe, it, expect } from 'vitest';
import { TopologyNamer, reconcileEdges, type NamedEdge } from '../features/topologyRegistry';
import type { EdgeSig } from '../features/edgeCorrespondence';

// A small helper to make a vertical (±Z) edge signature at (x,y).
const vEdge = (x: number, y: number, len = 20, midZ = 0): EdgeSig => ({
  mid: [x, y, midZ], dir: [0, 0, 1], length: len,
});

describe('topologyRegistry — persistent edge naming across rebuilds', () => {
  it('keeps an edge id stable when a dimension changes (edge moves a little)', () => {
    const namer = new TopologyNamer();
    const a = [vEdge(10, 10), vEdge(-10, 10), vEdge(10, -10), vEdge(-10, -10)];
    const ids0 = namer.update(a);
    expect(new Set(ids0).size).toBe(4); // 4 distinct ids

    // Box grew: each edge moved outward, lengths a bit longer.
    const b = [vEdge(15, 15, 24), vEdge(-15, 15, 24), vEdge(15, -15, 24), vEdge(-15, -15, 24)];
    const ids1 = namer.update(b);
    // Same 4 ids, same per-edge mapping (order preserved here).
    expect(ids1).toEqual(ids0);
  });

  it('mints new ids for added topology while existing edges keep theirs', () => {
    const namer = new TopologyNamer();
    const base = [vEdge(10, 10), vEdge(-10, 10), vEdge(10, -10), vEdge(-10, -10)];
    const ids0 = namer.update(base);

    // A hole added → 2 new vertical edges appear; the 4 originals persist.
    const withHole = [
      vEdge(10, 10), vEdge(-10, 10), vEdge(10, -10), vEdge(-10, -10),
      vEdge(2, 0, 10), vEdge(-2, 0, 10),
    ];
    const ids1 = namer.update(withHole);
    expect(ids1.slice(0, 4)).toEqual(ids0);        // originals unchanged
    expect(new Set(ids1).size).toBe(6);            // 6 distinct ids now
    expect(ids1.slice(4).every(id => !ids0.includes(id))).toBe(true); // 2 are new
  });

  it('retires ids for removed topology and can report presence', () => {
    const namer = new TopologyNamer();
    const ids0 = namer.update([vEdge(10, 10), vEdge(-10, 10), vEdge(10, -10)]);
    const removedId = ids0[2]!; // the (10,-10) edge

    // That edge is gone (feature suppressed).
    const ids1 = namer.update([vEdge(10, 10), vEdge(-10, 10)]);
    expect(ids1).toEqual(ids0.slice(0, 2)); // survivors keep ids
    expect(namer.indexOf(removedId)).toBe(-1); // retired id no longer present
    expect(namer.indexOf(ids0[0]!)).toBe(0);   // a survivor still resolves
  });

  it('reconcileEdges is a pure 1:1 carry-forward (no double-claim)', () => {
    const prev: NamedEdge[] = [
      { id: 'e0', sig: vEdge(10, 10) },
      { id: 'e1', sig: vEdge(-10, 10) },
    ];
    let n = 100;
    const out = reconcileEdges(prev, [vEdge(10, 10), vEdge(-10, 10)], () => `new${n++}`);
    expect(out.map(o => o.id)).toEqual(['e0', 'e1']); // each inherits its own, not the same
  });
});
