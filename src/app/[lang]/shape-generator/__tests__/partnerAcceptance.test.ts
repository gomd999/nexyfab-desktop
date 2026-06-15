/**
 * partnerAcceptance — end-to-end "design-partner happy path" smoke suite.
 *
 * Encodes the workflows a first design partner runs, so a regression in any one
 * link (shape gen → features → export → NL/CAD) fails CI BEFORE the partner hits
 * it. Uses the production functions directly on the mesh path (headless-safe; the
 * OCCT B-rep variants are covered by the RUN_OCCT_FEASIBILITY suite). Purely
 * additive — no product code changes.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SHAPE_MAP } from '../shapes';
import type { ShapeConfig } from '../shapes/index';
import { FEATURE_MAP } from '../features/index';

// Look the shapes up through the barrel registry (SHAPE_MAP) — importing the
// individual shape files directly trips a box.ts↔shapes/index.ts import cycle.
const boxShape = SHAPE_MAP['box'];
const cylinderShape = SHAPE_MAP['cylinder'];
const gearShape = SHAPE_MAP['gear'];
const flangeShape = SHAPE_MAP['flange'];
import type { FeatureType } from '../features/types';
import { buildBinaryStl } from '../io/stlEncode';
import { intentToScad } from '@/lib/openscad-render/intentToScad';

/** Build a param object from a shape/feature definition's own defaults. */
function defaults(params: ReadonlyArray<{ key: string; default: number }>): Record<string, number> {
  return Object.fromEntries(params.map((p) => [p.key, p.default]));
}

function vertexCount(g: THREE.BufferGeometry): number {
  return g.attributes.position?.count ?? 0;
}

function applyFeature(type: FeatureType, geo: THREE.BufferGeometry, overrides: Record<string, number> = {}): THREE.BufferGeometry {
  const def = FEATURE_MAP[type as keyof typeof FEATURE_MAP];
  if (!def) throw new Error(`feature ${type} not in FEATURE_MAP`);
  return def.apply(geo, { ...defaults(def.params), ...overrides });
}

describe('partner acceptance · model → feature → export', () => {
  it('models a bracket plate (box → hole) and exports a valid binary STL', () => {
    // 1. Base plate. 2. Drill a hole (mesh CSG path — headless-safe). Precise
    // fillet/chamfer need the OCCT engine and are covered by the
    // RUN_OCCT_FEASIBILITY suite; the mesh fillet honestly BLOCKS an
    // all-convex round rather than emitting a silent unrounded result.
    const base = boxShape.generate({ width: 80, height: 40, depth: 10 });
    expect(vertexCount(base.geometry)).toBeGreaterThan(0);
    const holed = applyFeature('hole', base.geometry, { diameter: 12 });
    expect(vertexCount(holed)).toBeGreaterThan(0);

    // 3. Export → valid binary STL (80-byte header + uint32 count + 50/tri).
    const stl = buildBinaryStl(holed);
    expect(stl.byteLength).toBeGreaterThan(84);
    expect((stl.byteLength - 84) % 50).toBe(0);
    const triCount = new DataView(stl).getUint32(80, true);
    expect(triCount).toBe((stl.byteLength - 84) / 50);
    expect(triCount).toBeGreaterThan(0);
  });

  it('composes a multi-feature part (box → chamfer → mirror) without breaking the chain', () => {
    let g: THREE.BufferGeometry = boxShape.generate({ width: 50, height: 50, depth: 50 }).geometry;
    for (const f of ['chamfer', 'mirror'] as FeatureType[]) {
      g = applyFeature(f, g);
      expect(vertexCount(g)).toBeGreaterThan(0);
    }
  });
});

describe('partner acceptance · parametric part library', () => {
  const parts: Array<{ name: string; shape: ShapeConfig }> = [
    { name: 'box', shape: boxShape },
    { name: 'cylinder', shape: cylinderShape },
    { name: 'gear', shape: gearShape },
    { name: 'flange', shape: flangeShape },
  ];

  for (const { name, shape } of parts) {
    it(`generates a ${name} with its default params (mesh + positive volume)`, () => {
      const r = shape.generate(defaults(shape.params));
      expect(vertexCount(r.geometry)).toBeGreaterThan(0);
      expect(r.volume_cm3).toBeGreaterThan(0);
      // exportable
      expect(buildBinaryStl(r.geometry).byteLength).toBeGreaterThan(84);
    });
  }
});

describe('partner acceptance · natural-language → CAD', () => {
  it('turns a box intent into renderable OpenSCAD', () => {
    const r = intentToScad({ shapeId: 'box', params: { width: 50, height: 50, depth: 50 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scad).toMatch(/cube/);
  });

  it('turns a cylinder intent into renderable OpenSCAD', () => {
    const r = intentToScad({ shapeId: 'cylinder', params: { diameter: 20, height: 50 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scad).toMatch(/cylinder/);
  });

  it('a box with a hole feature emits a difference()', () => {
    const r = intentToScad({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 50 },
      features: [{ type: 'hole', params: { diameter: 10 } }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scad).toMatch(/difference/);
  });
});
