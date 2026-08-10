/**
 * geometryResolver — Phase 4 tests for the FeatureTree → world-frame
 * mate-ref resolver.
 *
 * Covers:
 *   - the always-on registry (origin + 3 axes + 3 planes) for an empty tree
 *   - world-frame transform: part position offset propagates to point/axis/plane
 *   - world-frame transform: part orientation rotates axes + plane normals
 *   - resolver returns null for unknown refs (part missing OR ref missing)
 *   - feature-derived refs: extrude → sketch_plane + extrude_axis (only on
 *     the FIRST extrude)
 *   - feature-derived refs: hole → indexed hole_axis_${i} + hole_top_${i}
 *   - feature-derived refs: revolve → indexed revolve_axis_${i}
 */
import { describe, it, expect } from 'vitest';
import {
  featureTreeGeometryResolver,
  buildPartRefRegistry,
  listPartRefs,
} from './geometryResolver';
import type { FeatureTree } from '@/lib/cad/featureTree';
import { partInstance, IDENTITY_QUAT, type PartInstance } from './assemblyState';
import type { MateRef, MateRefKind } from './mate';
import { vec3 } from '@/lib/sketch/sketchPlane';

// ─── helpers ─────────────────────────────────────────────────────────────

function part(
  id: string,
  opts: { position?: { x: number; y: number; z: number }; orientation?: PartInstance['orientation']; fixed?: boolean } = {},
): PartInstance {
  return partInstance({
    id,
    name: id,
    partTemplateId: 'tpl',
    position: opts.position ?? vec3(0, 0, 0),
    orientation: opts.orientation ?? IDENTITY_QUAT,
    fixed: opts.fixed,
  });
}

function ref(partId: string, refId: string, refKind: MateRefKind): MateRef {
  return { partId, refId, refKind };
}

const EMPTY_TREE: FeatureTree = { nodes: [] };

function expectClose(actual: number, expected: number, tol = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThan(tol);
}

// ─── 1. always-on refs ────────────────────────────────────────────────────

describe('geometryResolver — always-on refs', () => {
  it('resolves origin as a point at the part position (default placement)', () => {
    const resolver = featureTreeGeometryResolver(new Map([['p', EMPTY_TREE]]));
    const g = resolver(ref('p', 'origin', 'point'), part('p'));
    expect(g).not.toBeNull();
    expect(g!.kind).toBe('point');
    if (!g || g.kind !== 'point') throw new Error('kind mismatch');
    expect(g.world).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('resolves x_axis / y_axis / z_axis as world axes at origin', () => {
    const resolver = featureTreeGeometryResolver(new Map([['p', EMPTY_TREE]]));
    const x = resolver(ref('p', 'x_axis', 'axis'), part('p'));
    const y = resolver(ref('p', 'y_axis', 'axis'), part('p'));
    const z = resolver(ref('p', 'z_axis', 'axis'), part('p'));
    expect(x?.kind).toBe('axis');
    expect(y?.kind).toBe('axis');
    expect(z?.kind).toBe('axis');
    if (x?.kind !== 'axis' || y?.kind !== 'axis' || z?.kind !== 'axis') {
      throw new Error('axes missing');
    }
    expect(x.world.direction).toEqual({ x: 1, y: 0, z: 0 });
    expect(y.world.direction).toEqual({ x: 0, y: 1, z: 0 });
    expect(z.world.direction).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('resolves xy_plane / yz_plane / xz_plane with correct normals', () => {
    const resolver = featureTreeGeometryResolver(new Map([['p', EMPTY_TREE]]));
    const xy = resolver(ref('p', 'xy_plane', 'plane'), part('p'));
    const yz = resolver(ref('p', 'yz_plane', 'plane'), part('p'));
    const xz = resolver(ref('p', 'xz_plane', 'plane'), part('p'));
    if (xy?.kind !== 'plane' || yz?.kind !== 'plane' || xz?.kind !== 'plane') {
      throw new Error('planes missing');
    }
    expect(xy.world.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(yz.world.normal).toEqual({ x: 1, y: 0, z: 0 });
    expect(xz.world.normal).toEqual({ x: 0, y: 1, z: 0 });
  });
});

// ─── 2. world-frame transform: position ──────────────────────────────────

describe('geometryResolver — placement transform', () => {
  it('applies position offset to point refs', () => {
    const resolver = featureTreeGeometryResolver(new Map([['p', EMPTY_TREE]]));
    const g = resolver(ref('p', 'origin', 'point'), part('p', { position: vec3(3, 4, 5) }));
    if (g?.kind !== 'point') throw new Error();
    expect(g.world).toEqual({ x: 3, y: 4, z: 5 });
  });

  it('applies position offset to axis origin (axis direction unchanged)', () => {
    const resolver = featureTreeGeometryResolver(new Map([['p', EMPTY_TREE]]));
    const g = resolver(ref('p', 'z_axis', 'axis'), part('p', { position: vec3(1, 2, 3) }));
    if (g?.kind !== 'axis') throw new Error();
    expect(g.world.origin).toEqual({ x: 1, y: 2, z: 3 });
    expect(g.world.direction).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('applies orientation rotation to axis direction (90° around Z maps X→Y)', () => {
    const resolver = featureTreeGeometryResolver(new Map([['p', EMPTY_TREE]]));
    // 90° rotation around Z: q = (0, 0, sin(45°), cos(45°))
    const s = Math.sin(Math.PI / 4);
    const c = Math.cos(Math.PI / 4);
    const rotZ90 = { x: 0, y: 0, z: s, w: c };
    const g = resolver(ref('p', 'x_axis', 'axis'), part('p', { orientation: rotZ90 }));
    if (g?.kind !== 'axis') throw new Error();
    expectClose(g.world.direction.x, 0);
    expectClose(g.world.direction.y, 1);
    expectClose(g.world.direction.z, 0);
  });

  it('applies orientation rotation to plane normal', () => {
    const resolver = featureTreeGeometryResolver(new Map([['p', EMPTY_TREE]]));
    // 90° around Y maps Z → X.
    const s = Math.sin(Math.PI / 4);
    const c = Math.cos(Math.PI / 4);
    const rotY90 = { x: 0, y: s, z: 0, w: c };
    const g = resolver(ref('p', 'xy_plane', 'plane'), part('p', { orientation: rotY90 }));
    if (g?.kind !== 'plane') throw new Error();
    expectClose(g.world.normal.x, 1);
    expectClose(g.world.normal.y, 0);
    expectClose(g.world.normal.z, 0);
  });
});

// ─── 3. unknown / missing refs ───────────────────────────────────────────

describe('geometryResolver — null cases', () => {
  it('returns null for unknown refId on a known part', () => {
    const resolver = featureTreeGeometryResolver(new Map([['p', EMPTY_TREE]]));
    expect(resolver(ref('p', 'no_such_ref', 'axis'), part('p'))).toBeNull();
  });

  it('returns null for an unknown partId (no FeatureTree provided)', () => {
    const resolver = featureTreeGeometryResolver(new Map());
    expect(resolver(ref('ghost', 'origin', 'point'), part('ghost'))).toBeNull();
  });
});

// ─── 4. extrude refs ─────────────────────────────────────────────────────

describe('geometryResolver — extrude refs', () => {
  it('extracts sketch_plane + extrude_axis from a single-extrude tree', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'e1',
          name: 'Extrude 1',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
            depth: 5,
            direction: 'one_sided',
            mode: 'add',
          },
        },
      ],
    };
    const resolver = featureTreeGeometryResolver(new Map([['p', tree]]));
    const sp = resolver(ref('p', 'sketch_plane', 'plane'), part('p'));
    const ea = resolver(ref('p', 'extrude_axis', 'axis'), part('p'));
    if (sp?.kind !== 'plane') throw new Error();
    if (ea?.kind !== 'axis') throw new Error();
    expect(sp.world.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(ea.world.direction).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('exposes indexed sketch_plane_0 alongside the canonical alias', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'e1',
          name: 'Extrude 1',
          dependencies: [],
          payload: {
            kind: 'extrude',
            loop: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 1 },
            ],
            depth: 2,
            direction: 'one_sided',
            mode: 'add',
          },
        },
      ],
    };
    const names = listPartRefs(tree);
    expect(names).toContain('sketch_plane');
    expect(names).toContain('sketch_plane_0');
    expect(names).toContain('extrude_axis');
    expect(names).toContain('extrude_axis_0');
  });
});

// ─── 5. hole refs ────────────────────────────────────────────────────────

describe('geometryResolver — hole refs', () => {
  it('extracts hole_axis_0 and hole_axis_1 from a tree with two holes', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'h1',
          name: 'Hole 1',
          dependencies: [],
          payload: {
            kind: 'hole',
            center: { x: 5, y: 0 },
            holeType: 'drilled',
            diameter: 3,
            depth: 10,
          },
        },
        {
          id: 'h2',
          name: 'Hole 2',
          dependencies: [],
          payload: {
            kind: 'hole',
            center: { x: -5, y: 0 },
            holeType: 'drilled',
            diameter: 3,
            depth: 10,
          },
        },
      ],
    };
    const resolver = featureTreeGeometryResolver(new Map([['p', tree]]));
    const h0 = resolver(ref('p', 'hole_axis_0', 'axis'), part('p'));
    const h1 = resolver(ref('p', 'hole_axis_1', 'axis'), part('p'));
    if (h0?.kind !== 'axis' || h1?.kind !== 'axis') throw new Error();
    expect(h0.world.origin).toEqual({ x: 5, y: 0, z: 0 });
    expect(h1.world.origin).toEqual({ x: -5, y: 0, z: 0 });
    expect(h0.world.direction).toEqual({ x: 0, y: 0, z: 1 });
    expect(h1.world.direction).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('hole_top_0 returns a point at the (cx, cy, 0) center in part frame', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'h',
          name: 'Hole',
          dependencies: [],
          payload: {
            kind: 'hole',
            center: { x: 2, y: 3 },
            holeType: 'drilled',
            diameter: 1,
            depth: 4,
          },
        },
      ],
    };
    const resolver = featureTreeGeometryResolver(new Map([['p', tree]]));
    const g = resolver(ref('p', 'hole_top_0', 'point'), part('p', { position: vec3(10, 0, 0) }));
    if (g?.kind !== 'point') throw new Error();
    expect(g.world).toEqual({ x: 12, y: 3, z: 0 });
  });
});

// ─── 6. revolve refs ─────────────────────────────────────────────────────

describe('geometryResolver — revolve refs', () => {
  it('extracts revolve_axis_0 from a single-revolve tree', () => {
    const tree: FeatureTree = {
      nodes: [
        {
          id: 'r1',
          name: 'Revolve 1',
          dependencies: [],
          payload: {
            kind: 'revolve',
            loop: [
              { x: 1, y: 0 },
              { x: 2, y: 0 },
              { x: 2, y: 5 },
              { x: 1, y: 5 },
            ],
            angleDegrees: 360,
            mode: 'add',
          },
        },
      ],
    };
    const resolver = featureTreeGeometryResolver(new Map([['p', tree]]));
    const g = resolver(ref('p', 'revolve_axis_0', 'axis'), part('p'));
    if (g?.kind !== 'axis') throw new Error();
    // canonical Y axis at origin
    expect(g.world.direction).toEqual({ x: 0, y: 1, z: 0 });
    expect(g.world.origin).toEqual({ x: 0, y: 0, z: 0 });
  });
});

// ─── 7. registry sanity ──────────────────────────────────────────────────

describe('geometryResolver — registry sanity', () => {
  it('empty-tree registry has exactly the 7 always-on refs', () => {
    const names = [...listPartRefs(EMPTY_TREE)].sort();
    expect(names).toEqual(
      ['origin', 'x_axis', 'xy_plane', 'xz_plane', 'y_axis', 'yz_plane', 'z_axis'].sort(),
    );
  });

  it('buildPartRefRegistry returns the same kinds the resolver dispatches on', () => {
    const reg = buildPartRefRegistry(EMPTY_TREE);
    expect(reg.get('origin')?.kind).toBe('point');
    expect(reg.get('x_axis')?.kind).toBe('axis');
    expect(reg.get('xy_plane')?.kind).toBe('plane');
  });

  it('exposes stable bottom and top axes for an extruded part', () => {
    const tree: FeatureTree = { nodes: [{ id: 'body', name: 'body', dependencies: [], payload: { kind: 'extrude', loop: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], depth: 25, direction: 'one_sided', mode: 'add' } }] };
    const resolver = featureTreeGeometryResolver(new Map([['p', tree]]));
    const bottom = resolver(ref('p', 'bbox_axis_z_min', 'axis'), part('p', { position: vec3(1, 2, 3) }));
    const top = resolver(ref('p', 'bbox_axis_z_max', 'axis'), part('p', { position: vec3(1, 2, 3) }));
    expect(bottom?.kind === 'axis' ? bottom.world.origin : null).toEqual({ x: 1, y: 2, z: 3 });
    expect(top?.kind === 'axis' ? top.world.origin : null).toEqual({ x: 1, y: 2, z: 28 });
  });
});
