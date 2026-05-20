import { describe, it, expect } from 'vitest';
import {
  brepBoolean,
  collectPlanarFacePairs,
  planePlaneIntersect,
  shellVolume,
  pointInShell,
  validateBooleanResult,
} from './brepBoolean';
import {
  BrepModel,
  createVertex,
  createEdgePair,
  createFace,
} from './halfEdgeBrep';

/** Build a single planar square face shell at z=0 with given size, centered at origin. */
function buildSquareShell(size = 1, z = 0) {
  const m = new BrepModel();
  const s = m.newShell();
  const v0 = createVertex(m, s, [-size, -size, z]);
  const v1 = createVertex(m, s, [size, -size, z]);
  const v2 = createVertex(m, s, [size, size, z]);
  const v3 = createVertex(m, s, [-size, size, z]);
  const e01 = createEdgePair(m, s, v0, v1);
  const e12 = createEdgePair(m, s, v1, v2);
  const e23 = createEdgePair(m, s, v2, v3);
  const e30 = createEdgePair(m, s, v3, v0);
  e01.next = e12; e12.prev = e01;
  e12.next = e23; e23.prev = e12;
  e23.next = e30; e30.prev = e23;
  e30.next = e01; e01.prev = e30;
  const face = createFace(m, s, e01);
  face.normal = [0, 0, 1];
  face.surfaceKind = 'planar';
  return { model: m, shell: s };
}

describe('planePlaneIntersect', () => {
  it('two perpendicular planes share a line along z axis', () => {
    const r = planePlaneIntersect(
      { normal: [1, 0, 0], point: [0, 0, 0] },
      { normal: [0, 1, 0], point: [0, 0, 0] },
    );
    expect(r).not.toBeNull();
    expect(Math.abs(r!.direction[2])).toBeCloseTo(1, 6);
  });

  it('parallel planes → null', () => {
    const r = planePlaneIntersect(
      { normal: [0, 0, 1], point: [0, 0, 0] },
      { normal: [0, 0, 1], point: [0, 0, 5] },
    );
    expect(r).toBeNull();
  });

  it('direction is unit length', () => {
    const r = planePlaneIntersect(
      { normal: [1, 0, 0], point: [0, 0, 0] },
      { normal: [0, 1, 0], point: [0, 0, 0] },
    );
    expect(Math.hypot(...r!.direction)).toBeCloseTo(1, 6);
  });
});

describe('collectPlanarFacePairs', () => {
  it('returns one pair per cross-face combination', () => {
    const a = buildSquareShell(1, 0).shell;
    const b = buildSquareShell(1, 5).shell;
    const pairs = collectPlanarFacePairs(a, b);
    expect(pairs).toHaveLength(1);
  });

  it('parallel planes → null intersection line', () => {
    const a = buildSquareShell(1, 0).shell;
    const b = buildSquareShell(1, 5).shell;
    const pairs = collectPlanarFacePairs(a, b);
    expect(pairs[0]!.line).toBeNull();
  });
});

describe('brepBoolean', () => {
  it('union tags all output faces as fromA or fromB', () => {
    const a = buildSquareShell(1, 0).shell;
    const b = buildSquareShell(1, 5).shell;
    const r = brepBoolean(a, b, 'union');
    const origins = [...r.faceProvenance.values()].map(p => p.kind);
    expect(origins.filter(k => k === 'fromA').length).toBe(1);
    expect(origins.filter(k => k === 'fromB').length).toBe(1);
  });

  it('subtract flips B faces (normal inverted)', () => {
    const a = buildSquareShell(1, 0).shell;
    const b = buildSquareShell(1, 5).shell;
    const r = brepBoolean(a, b, 'subtract');
    const outShell = r.model.shells[0]!;
    // The B face's normal should be [0, 0, -1] (flipped from [0, 0, 1]).
    const faces = [...outShell.faces.values()];
    const flippedFace = faces.find(f => f.normal?.[2] === -1);
    expect(flippedFace).toBeDefined();
  });

  it('intersect produces a model', () => {
    const a = buildSquareShell(1, 0).shell;
    const b = buildSquareShell(1, 0).shell;
    const r = brepBoolean(a, b, 'intersect');
    expect(r.model.shells.length).toBeGreaterThan(0);
  });

  it('warns when face pair has no intersection line', () => {
    const a = buildSquareShell(1, 0).shell;
    const b = buildSquareShell(1, 5).shell;
    const r = brepBoolean(a, b, 'union');
    expect(r.warnings.some(w => w.includes('No intersection'))).toBe(true);
  });
});

describe('shellVolume', () => {
  it('signed volume defined for any closed-ish shell', () => {
    const { shell } = buildSquareShell(1, 0);
    const v = shellVolume(shell);
    expect(typeof v).toBe('number');
    expect(isFinite(v)).toBe(true);
  });
});

describe('pointInShell', () => {
  it('point far away returns false', () => {
    const { shell } = buildSquareShell(1, 0);
    expect(pointInShell([100, 100, 100], shell)).toBe(false);
  });
});

describe('validateBooleanResult', () => {
  it('reports warnings as issues', () => {
    const a = buildSquareShell(1, 0).shell;
    const b = buildSquareShell(1, 5).shell;
    const r = brepBoolean(a, b, 'union');
    const v = validateBooleanResult(r);
    // Warnings present → issues > 0.
    expect(v.issues.length).toBeGreaterThan(0);
  });
});
