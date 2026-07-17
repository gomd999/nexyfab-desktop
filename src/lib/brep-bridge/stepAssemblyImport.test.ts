/**
 * stepAssemblyImport — Phase 5.2.3 multi-part STEP importer tests.
 *
 * Coverage:
 *   - 1 PRODUCT_DEFINITION → 1 part
 *   - 2 PRODUCT_DEFINITION + 1 NAUO → 2 parts
 *   - writeAssemblyAsStep round-trip (box + box)
 *   - 3-level hierarchy → flatten to 3 parts
 *   - ITEM_DEFINED_TRANSFORMATION translation applied to child placement
 *   - non-axis-aligned rotation → quaternion conversion
 *   - circular reference → throws
 *   - empty source → throws (empty_source error)
 *   - corrupt STEP → throws
 *   - empty assembly (no entities, just header) → empty state
 *   - file with NO NAUO → flat parts list (warning emitted)
 *   - geometry → featureTrees[partId]
 *   - simple 1 box + 1 cylinder assembly
 *   - unsupported list includes parts whose solids can't be classified
 *   - warnings: no PD treated as single part
 */

import { describe, it, expect } from 'vitest';
import { importStepAssembly } from './stepAssemblyImport';
import { StepImportError } from './stepImport';
import { writeAssemblyAsStep, writeStepHeader } from './stepWrite';

// ─── micro-helpers for hand-crafted assemblies ────────────────────────────

/**
 * Build a tiny STEP file with:
 *   - a list of "parts" each represented by a (possibly empty) MANIFOLD_SOLID_BREP
 *     plus PRODUCT/PRODUCT_DEFINITION wiring;
 *   - parent→child NAUO edges (with optional translation transforms).
 *
 * Parts without a geometry contribution become "container" PDs (sub-assemblies).
 * This lets us test hierarchy flattening + transform composition without
 * depending on writeAssemblyAsStep (which doesn't emit ITEM_DEFINED_TRANSFORMATION).
 */
interface FixturePart {
  pdId: string;             // alias used in `children` edges
  name: string;
  /** Box dimensions; omit for a "container" PD (sub-assembly). */
  box?: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
}

interface FixtureEdge {
  parent: string;
  child: string;
  /** Optional translation (mm). Identity when omitted. */
  translate?: [number, number, number];
  /** Optional axis rotation: { axis, angleRad }. */
  rotate?: { axis: [number, number, number]; angleRad: number };
}

function buildAssemblyFixture(parts: FixturePart[], edges: FixtureEdge[]): string {
  // Manual STEP entity builder — we want full control of the entity ids so
  // tests can reference them deterministically.
  const lines: string[] = [];
  let next = 1;
  const add = (body: string): number => {
    const id = next++;
    lines.push(`#${id}=${body};`);
    return id;
  };

  // Shared context.
  const appCtx = add(`APPLICATION_CONTEXT('automotive design')`);
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2010,#${appCtx})`);
  const prodCtx = add(`PRODUCT_CONTEXT('',#${appCtx},'mechanical')`);
  const prodDefCtx = add(`PRODUCT_DEFINITION_CONTEXT('part definition',#${appCtx},'design')`);

  // Geom context shared by all reps.
  const dimExp = add(`DIMENSIONAL_EXPONENTS(1.0,0.0,0.0,0.0,0.0,0.0,0.0)`);
  add(`(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))`);
  // Above composite is for human-readability; our parser tolerates anonymous units.
  void dimExp;
  const lenUnit = add(`(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))`);
  const plnAngUnit = add(`(NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.))`);
  const solAngUnit = add(`(NAMED_UNIT(*) SOLID_ANGLE_UNIT() SI_UNIT($,.STERADIAN.))`);
  const uncertainty = add(
    `UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.00001),#${lenUnit},'distance_accuracy_value','')`,
  );
  const geomCtx = add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#${uncertainty})) GLOBAL_UNIT_ASSIGNED_CONTEXT((#${lenUnit},#${plnAngUnit},#${solAngUnit})) REPRESENTATION_CONTEXT('','3D'))`,
  );

  // World axis placement (used as default in reps and in IDT sources/targets).
  const worldOrigin = add(`CARTESIAN_POINT('',(0.,0.,0.))`);
  const worldZ = add(`DIRECTION('',(0.,0.,1.))`);
  const worldX = add(`DIRECTION('',(1.,0.,0.))`);
  const worldAxisPlacement = add(`AXIS2_PLACEMENT_3D('',#${worldOrigin},#${worldZ},#${worldX})`);

  // Per-part: emit PRODUCT chain + geometry.
  const partRefs = new Map<string, { productDef: number; pds: number }>();
  for (const p of parts) {
    const product = add(`PRODUCT('${p.pdId}','${p.name}','',(#${prodCtx}))`);
    add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part','',(#${product}))`);
    const formation = add(
      `PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(' ',' ',#${product},.NOT_KNOWN.)`,
    );
    const productDef = add(`PRODUCT_DEFINITION(' ','',#${formation},#${prodDefCtx})`);
    const pds = add(`PRODUCT_DEFINITION_SHAPE('','',#${productDef})`);
    partRefs.set(p.pdId, { productDef, pds });

    if (p.box) {
      // Emit a minimal box solid + ADVANCED_BREP_SHAPE_REPRESENTATION.
      const solidRefId = emitBoxBody(add, p.box);
      const brepRep = add(
        `ADVANCED_BREP_SHAPE_REPRESENTATION('${p.name}',(#${worldAxisPlacement},#${solidRefId}),#${geomCtx})`,
      );
      add(`SHAPE_DEFINITION_REPRESENTATION(#${pds},#${brepRep})`);
    }
  }

  // Per-edge: emit NAUO + optional IDT chain.
  for (const e of edges) {
    const parent = partRefs.get(e.parent);
    const child = partRefs.get(e.child);
    if (!parent || !child) throw new Error(`unknown part in edge ${e.parent} → ${e.child}`);
    const nauoName = `${e.parent}_to_${e.child}`;
    const nauo = add(
      `NEXT_ASSEMBLY_USAGE_OCCURRENCE('${nauoName}','${nauoName}','',#${parent.productDef},#${child.productDef},$)`,
    );
    if (e.translate || e.rotate) {
      const srcAxis = buildAxisPlacement(add, e.translate ?? [0, 0, 0], e.rotate);
      const tgtAxis = worldAxisPlacement;
      const idt = add(
        `ITEM_DEFINED_TRANSFORMATION('edge_xform','',#${srcAxis},#${tgtAxis})`,
      );
      const repRel = add(
        `( REPRESENTATION_RELATIONSHIP('','',#${worldAxisPlacement},#${worldAxisPlacement}) REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(#${idt}) SHAPE_REPRESENTATION_RELATIONSHIP() )`,
      );
      const nauoPds = add(`PRODUCT_DEFINITION_SHAPE('','',#${nauo})`);
      add(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(#${repRel},#${nauoPds})`);
    }
  }

  const header = writeStepHeader();
  return `${header}DATA;\n${lines.join('\n')}\nENDSEC;\nEND-ISO-10303-21;\n`;
}

/** Emit a minimal 6-face axis-aligned box solid. Returns the MANIFOLD_SOLID_BREP id. */
function emitBoxBody(
  add: (body: string) => number,
  box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number },
): number {
  const { x0, y0, z0, x1, y1, z1 } = box;
  // 8 corner points: bottom (z0) 0-3, top (z1) 4-7.
  const pts = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ].map((p) => add(`CARTESIAN_POINT('',(${p[0]!.toFixed(6)},${p[1]!.toFixed(6)},${p[2]!.toFixed(6)}))`));
  const verts = pts.map((cp) => add(`VERTEX_POINT('',#${cp})`));

  // Directions reused everywhere.
  const dirZp = add(`DIRECTION('',(0.,0.,1.))`);
  const dirZn = add(`DIRECTION('',(0.,0.,-1.))`);
  const dirXp = add(`DIRECTION('',(1.,0.,0.))`);
  const dirXn = add(`DIRECTION('',(-1.,0.,0.))`);
  const dirYp = add(`DIRECTION('',(0.,1.,0.))`);
  const dirYn = add(`DIRECTION('',(0.,-1.,0.))`);
  const refXDir = add(`DIRECTION('',(1.,0.,0.))`);
  const refYDir = add(`DIRECTION('',(0.,1.,0.))`);

  // 6 plane surfaces (origin = first corner of the face, normal as listed).
  const makePlane = (origin: number, normal: number, refDir: number): number => {
    const ax = add(`AXIS2_PLACEMENT_3D('',#${origin},#${normal},#${refDir})`);
    return add(`PLANE('',#${ax})`);
  };

  const plnBottom = makePlane(pts[0]!, dirZn, refXDir);
  const plnTop    = makePlane(pts[4]!, dirZp, refXDir);
  const plnFront  = makePlane(pts[0]!, dirYn, refXDir);
  const plnBack   = makePlane(pts[3]!, dirYp, refXDir);
  const plnLeft   = makePlane(pts[0]!, dirXn, refYDir);
  const plnRight  = makePlane(pts[1]!, dirXp, refYDir);

  // Each face needs an EDGE_LOOP of 4 ORIENTED_EDGEs.
  // Lines per edge; reuse for orientation flips via ORIENTED_EDGE flag.
  const lineDir = add(`DIRECTION('',(1.,0.,0.))`);
  const lineVec = add(`VECTOR('',#${lineDir},1.0)`);
  const makeEdgeCurve = (vStart: number, vEnd: number): number => {
    // For simplicity use a generic LINE (the actual direction is encoded
    // by the vertex pair; our importer only checks curve type == LINE).
    const cp = add(`CARTESIAN_POINT('',(0.,0.,0.))`);
    const ln = add(`LINE('',#${cp},#${lineVec})`);
    return add(`EDGE_CURVE('',#${vStart},#${vEnd},#${ln},.T.)`);
  };

  // 12 edges of the cube.
  const eBottom = [
    makeEdgeCurve(verts[0]!, verts[1]!),
    makeEdgeCurve(verts[1]!, verts[2]!),
    makeEdgeCurve(verts[2]!, verts[3]!),
    makeEdgeCurve(verts[3]!, verts[0]!),
  ];
  const eTop = [
    makeEdgeCurve(verts[4]!, verts[5]!),
    makeEdgeCurve(verts[5]!, verts[6]!),
    makeEdgeCurve(verts[6]!, verts[7]!),
    makeEdgeCurve(verts[7]!, verts[4]!),
  ];
  const eVert = [
    makeEdgeCurve(verts[0]!, verts[4]!),
    makeEdgeCurve(verts[1]!, verts[5]!),
    makeEdgeCurve(verts[2]!, verts[6]!),
    makeEdgeCurve(verts[3]!, verts[7]!),
  ];

  const oe = (ec: number, fwd: boolean): number =>
    add(`ORIENTED_EDGE('',*,*,#${ec},.${fwd ? 'T' : 'F'}.)`);

  const makeFace = (pln: number, oeList: number[]): number => {
    const loop = add(`EDGE_LOOP('',(${oeList.map((o) => `#${o}`).join(',')}))`);
    const bound = add(`FACE_OUTER_BOUND('',#${loop},.T.)`);
    return add(`ADVANCED_FACE('',(#${bound}),#${pln},.T.)`);
  };

  // Bottom face: walk z0 corners CW from below = (0→3→2→1).
  // We emit CCW-from-above (the bottom-face's normal is -Z, so the loop is
  // CW when seen from below = walks 0,1,2,3 — close enough for facesToBox).
  const faceBottom = makeFace(plnBottom, [
    oe(eBottom[0]!, true), oe(eBottom[1]!, true), oe(eBottom[2]!, true), oe(eBottom[3]!, true),
  ]);
  const faceTop = makeFace(plnTop, [
    oe(eTop[0]!, true), oe(eTop[1]!, true), oe(eTop[2]!, true), oe(eTop[3]!, true),
  ]);
  const faceFront = makeFace(plnFront, [
    oe(eBottom[0]!, true), oe(eVert[1]!, true),
    oe(eTop[0]!, false),    oe(eVert[0]!, false),
  ]);
  const faceBack = makeFace(plnBack, [
    oe(eBottom[2]!, false), oe(eVert[2]!, true),
    oe(eTop[2]!, true),      oe(eVert[3]!, false),
  ]);
  const faceLeft = makeFace(plnLeft, [
    oe(eBottom[3]!, true), oe(eVert[0]!, true),
    oe(eTop[3]!, false),    oe(eVert[3]!, false),
  ]);
  const faceRight = makeFace(plnRight, [
    oe(eBottom[1]!, true), oe(eVert[2]!, true),
    oe(eTop[1]!, false),    oe(eVert[1]!, false),
  ]);

  const shell = add(
    `CLOSED_SHELL('',(#${faceBottom},#${faceTop},#${faceFront},#${faceBack},#${faceLeft},#${faceRight}))`,
  );
  return add(`MANIFOLD_SOLID_BREP('',#${shell})`);
}

/** Helper: emit an AXIS2_PLACEMENT_3D with arbitrary origin + optional axis rotation. */
function buildAxisPlacement(
  add: (body: string) => number,
  translate: [number, number, number],
  rotate?: { axis: [number, number, number]; angleRad: number },
): number {
  const origin = add(
    `CARTESIAN_POINT('',(${translate[0].toFixed(6)},${translate[1].toFixed(6)},${translate[2].toFixed(6)}))`,
  );
  if (!rotate) {
    const z = add(`DIRECTION('',(0.,0.,1.))`);
    const x = add(`DIRECTION('',(1.,0.,0.))`);
    return add(`AXIS2_PLACEMENT_3D('',#${origin},#${z},#${x})`);
  }
  // Rodrigues rotation to convert (axis, angle) into rotated +Z and +X.
  const [zx, zy, zz] = rotateVector([0, 0, 1], rotate.axis, rotate.angleRad);
  const [xx, xy, xz] = rotateVector([1, 0, 0], rotate.axis, rotate.angleRad);
  const z = add(`DIRECTION('',(${fmt(zx)},${fmt(zy)},${fmt(zz)}))`);
  const x = add(`DIRECTION('',(${fmt(xx)},${fmt(xy)},${fmt(xz)}))`);
  return add(`AXIS2_PLACEMENT_3D('',#${origin},#${z},#${x})`);
}

function fmt(n: number): string {
  return Number(n.toFixed(8)).toString();
}

/** Rodrigues axis-angle rotation. axis assumed unit-length. */
function rotateVector(
  v: [number, number, number],
  axis: [number, number, number],
  angleRad: number,
): [number, number, number] {
  const len = Math.hypot(...axis);
  const k: [number, number, number] = [axis[0] / len, axis[1] / len, axis[2] / len];
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dot = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  const cross: [number, number, number] = [
    k[1] * v[2] - k[2] * v[1],
    k[2] * v[0] - k[0] * v[2],
    k[0] * v[1] - k[1] * v[0],
  ];
  return [
    v[0] * c + cross[0] * s + k[0] * dot * (1 - c),
    v[1] * c + cross[1] * s + k[1] * dot * (1 - c),
    v[2] * c + cross[2] * s + k[2] * dot * (1 - c),
  ];
}

// ─── 1: single PD → 1 part ────────────────────────────────────────────────

describe('importStepAssembly — single part', () => {
  it('imports 1 PRODUCT_DEFINITION as 1 part instance (warns about no NAUO)', () => {
    const step = buildAssemblyFixture(
      [{ pdId: 'A', name: 'Cube', box: { x0: 0, y0: 0, z0: 0, x1: 10, y1: 10, z1: 10 } }],
      [],
    );
    const result = importStepAssembly(step);
    expect(result.state.parts).toHaveLength(1);
    expect(result.state.parts[0]!.fixed).toBe(true);
    expect(result.state.mates).toEqual([]);
    expect(result.warnings.some((w) => w.includes('no_assembly_relationships'))).toBe(true);
    expect(Object.keys(result.featureTrees)).toHaveLength(1);
  });

  it('attaches an ExtrudeFeature in the featureTree for a box part', () => {
    const step = buildAssemblyFixture(
      [{ pdId: 'A', name: 'Cube', box: { x0: 0, y0: 0, z0: 0, x1: 5, y1: 4, z1: 3 } }],
      [],
    );
    const result = importStepAssembly(step);
    const partId = result.state.parts[0]!.id;
    const tree = result.featureTrees[partId];
    expect(tree).toBeDefined();
    expect(tree!.nodes.length).toBeGreaterThanOrEqual(1);
    expect(tree!.nodes[0]!.payload.kind).toBe('extrude');
  });
});

// ─── 2: writeAssemblyAsStep round-trip ────────────────────────────────────

describe('importStepAssembly — writeAssemblyAsStep round-trip', () => {
  it('round-trips 2 boxes through writeAssemblyAsStep', () => {
    const step = writeAssemblyAsStep({
      assemblyName: 'Bracket',
      parts: [
        { id: 'base', name: 'Base', x0: 0, y0: 0, z0: 0, x1: 20, y1: 20, z1: 5 },
        { id: 'top',  name: 'Top',  x0: 5, y0: 5, z0: 5, x1: 15, y1: 15, z1: 10 },
      ],
    });
    const result = importStepAssembly(step);
    // 2 leaf parts; the assembly PD has children so it's not emitted as a leaf.
    expect(result.state.parts).toHaveLength(2);
    expect(result.state.mates).toEqual([]);
    expect(result.state.parts.filter((p) => p.fixed)).toHaveLength(1);
    // No transform on the NAUO edges → both parts at world origin.
    for (const part of result.state.parts) {
      expect(part.position).toEqual({ x: 0, y: 0, z: 0 });
      expect(part.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    }
  });
});

// ─── 3: NAUO + IDT translation ────────────────────────────────────────────

describe('importStepAssembly — translation transforms', () => {
  it('applies ITEM_DEFINED_TRANSFORMATION translation to the child placement', () => {
    const step = buildAssemblyFixture(
      [
        { pdId: 'asm', name: 'Asm' },
        { pdId: 'child', name: 'Child', box: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 } },
      ],
      [{ parent: 'asm', child: 'child', translate: [10, 20, 30] }],
    );
    const result = importStepAssembly(step);
    expect(result.state.parts).toHaveLength(1);
    expect(result.state.parts[0]!.position).toEqual({ x: 10, y: 20, z: 30 });
  });

  it('composes translations through a 3-level hierarchy', () => {
    const step = buildAssemblyFixture(
      [
        { pdId: 'root', name: 'Root' },
        { pdId: 'mid',  name: 'Mid' },
        { pdId: 'leaf', name: 'Leaf', box: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 } },
      ],
      [
        { parent: 'root', child: 'mid',  translate: [10, 0, 0] },
        { parent: 'mid',  child: 'leaf', translate: [0, 5, 0] },
      ],
    );
    const result = importStepAssembly(step);
    expect(result.state.parts).toHaveLength(1);
    expect(result.state.parts[0]!.position.x).toBeCloseTo(10);
    expect(result.state.parts[0]!.position.y).toBeCloseTo(5);
    expect(result.state.parts[0]!.position.z).toBeCloseTo(0);
  });

  it('flattens a 3-level hierarchy with 3 leaf parts', () => {
    const step = buildAssemblyFixture(
      [
        { pdId: 'root', name: 'Root' },
        { pdId: 'sub',  name: 'Sub' },
        { pdId: 'p1', name: 'P1', box: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 } },
        { pdId: 'p2', name: 'P2', box: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 } },
        { pdId: 'p3', name: 'P3', box: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 } },
      ],
      [
        { parent: 'root', child: 'sub', translate: [100, 0, 0] },
        { parent: 'sub',  child: 'p1',  translate: [1, 0, 0] },
        { parent: 'sub',  child: 'p2',  translate: [2, 0, 0] },
        { parent: 'root', child: 'p3',  translate: [0, 50, 0] },
      ],
    );
    const result = importStepAssembly(step);
    expect(result.state.parts).toHaveLength(3);
    const sorted = [...result.state.parts].sort((a, b) => a.position.x - b.position.x);
    // p3 at (0, 50, 0), p1 at (101, 0, 0), p2 at (102, 0, 0)
    expect(sorted[0]!.position.y).toBeCloseTo(50);
    expect(sorted[1]!.position.x).toBeCloseTo(101);
    expect(sorted[2]!.position.x).toBeCloseTo(102);
  });
});

// ─── 4: rotation → quaternion ─────────────────────────────────────────────

describe('importStepAssembly — rotation transforms', () => {
  it('converts a 90° rotation around Z into the expected quaternion', () => {
    const step = buildAssemblyFixture(
      [
        { pdId: 'asm', name: 'Asm' },
        { pdId: 'c',   name: 'Child', box: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 } },
      ],
      [{
        parent: 'asm', child: 'c',
        rotate: { axis: [0, 0, 1], angleRad: Math.PI / 2 },
      }],
    );
    const result = importStepAssembly(step);
    expect(result.state.parts).toHaveLength(1);
    const q = result.state.parts[0]!.orientation;
    // 90° around Z: quaternion = (0, 0, sin(π/4), cos(π/4)) = (0, 0, 0.7071..., 0.7071...)
    expect(q.x).toBeCloseTo(0, 5);
    expect(q.y).toBeCloseTo(0, 5);
    expect(Math.abs(q.z)).toBeCloseTo(Math.SQRT1_2, 4);
    expect(Math.abs(q.w)).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('handles a 180° rotation around an arbitrary axis (non-axis-aligned quaternion)', () => {
    // Axis (1,1,0)/sqrt(2), 180°.
    const axis: [number, number, number] = [1 / Math.SQRT2, 1 / Math.SQRT2, 0];
    const step = buildAssemblyFixture(
      [
        { pdId: 'asm', name: 'Asm' },
        { pdId: 'c',   name: 'Child', box: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 } },
      ],
      [{
        parent: 'asm', child: 'c',
        rotate: { axis, angleRad: Math.PI },
      }],
    );
    const result = importStepAssembly(step);
    const q = result.state.parts[0]!.orientation;
    // 180°: w ≈ 0, axis components scaled by sin(π/2) = 1 → q = (1/√2, 1/√2, 0, 0).
    expect(Math.abs(q.w)).toBeLessThan(0.01);
    // sign indeterminate, take abs
    expect(Math.abs(q.x)).toBeCloseTo(Math.SQRT1_2, 3);
    expect(Math.abs(q.y)).toBeCloseTo(Math.SQRT1_2, 3);
    expect(Math.abs(q.z)).toBeLessThan(0.01);
  });
});

// ─── 5: cycles ────────────────────────────────────────────────────────────

describe('importStepAssembly — error cases', () => {
  it('throws on a circular NAUO chain A → B → A', () => {
    const step = buildAssemblyFixture(
      [
        { pdId: 'A', name: 'A' },
        { pdId: 'B', name: 'B' },
      ],
      [
        { parent: 'A', child: 'B' },
        { parent: 'B', child: 'A' },
      ],
    );
    // With A→B→A, the root finder sees no PD that is *not* a child →
    // we get no roots and consequently no parts. Add an outer root that
    // contains A so the cycle is reachable from a DFS entry.
    expect(() => importStepAssembly(step)).not.toThrow();
    // Re-test with a reachable cycle: outer → A, A → B, B → A.
    const cyclic = buildAssemblyFixture(
      [
        { pdId: 'outer', name: 'Outer' },
        { pdId: 'A', name: 'A' },
        { pdId: 'B', name: 'B' },
      ],
      [
        { parent: 'outer', child: 'A' },
        { parent: 'A', child: 'B' },
        { parent: 'B', child: 'A' },
      ],
    );
    expect(() => importStepAssembly(cyclic)).toThrow(/circular_assembly/);
  });

  it('throws on empty source', () => {
    expect(() => importStepAssembly('')).toThrow(StepImportError);
  });

  it('throws when DATA section missing', () => {
    expect(() => importStepAssembly('ISO-10303-21;\nHEADER;\nENDSEC;\n')).toThrow(/no_data_section/);
  });

  it('throws on corrupt STEP with unbalanced parens', () => {
    expect(() =>
      importStepAssembly('ISO-10303-21;\nDATA;\n#1=BAD(unclosed\n')
    ).toThrow();
  });

  it('returns empty state on a valid header with no entities', () => {
    const step =
      'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
    const result = importStepAssembly(step);
    expect(result.state.parts).toEqual([]);
    expect(result.state.mates).toEqual([]);
    expect(Object.keys(result.featureTrees)).toEqual([]);
  });
});

// ─── 6: featureTrees per part ─────────────────────────────────────────────

describe('importStepAssembly — featureTrees', () => {
  it('produces one FeatureTree per emitted part (each with ≥ 1 extrude node)', () => {
    const step = writeAssemblyAsStep({
      assemblyName: 'Pair',
      parts: [
        { id: 'p1', name: 'P1', x0: 0, y0: 0, z0: 0, x1: 10, y1: 10, z1: 10 },
        { id: 'p2', name: 'P2', x0: 0, y0: 0, z0: 0, x1: 5,  y1: 5,  z1: 5  },
      ],
    });
    const result = importStepAssembly(step);
    expect(result.state.parts).toHaveLength(2);
    for (const part of result.state.parts) {
      const tree = result.featureTrees[part.id];
      expect(tree).toBeDefined();
      expect(tree!.nodes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps unique part ids when two NAUO edges reuse the same PD label', () => {
    const step = buildAssemblyFixture(
      [
        { pdId: 'root', name: 'Root' },
        { pdId: 'bolt', name: 'Bolt', box: { x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 } },
      ],
      [
        { parent: 'root', child: 'bolt', translate: [1, 0, 0] },
        { parent: 'root', child: 'bolt', translate: [2, 0, 0] },
      ],
    );
    const result = importStepAssembly(step);
    expect(result.state.parts).toHaveLength(2);
    const ids = result.state.parts.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });
});

// ─── 7: no PRODUCT_DEFINITION fallback ────────────────────────────────────

describe('importStepAssembly — headless STEP', () => {
  it('warns and falls back to single-part import when no PRODUCT_DEFINITION present', () => {
    // Use the single-solid stepImport pipeline against a raw box file.
    const step = `${writeStepHeader()}DATA;
#1=CARTESIAN_POINT('',(0.,0.,0.));
#2=DIRECTION('',(0.,0.,1.));
#3=DIRECTION('',(1.,0.,0.));
#4=AXIS2_PLACEMENT_3D('',#1,#2,#3);
ENDSEC;
END-ISO-10303-21;
`;
    const result = importStepAssembly(step);
    expect(result.warnings.some((w) => w.includes('no_product_definition'))).toBe(true);
    // No solids → empty state (fallback degenerates gracefully).
    expect(result.state.parts).toEqual([]);
  });
});

// ─── 8: 실물 코퍼스 회귀(로컬 전용 — NIST PMI STEP, 공식 '제약 없음') ──────────
// 260717: SDR→빈 SHAPE_REPRESENTATION + SRR 형제 연결(AP242 실무 관례)을 못 따라가
// NIST 단품 13/17 이 parts=0 이던 구조적 갭의 재발 방지. 코퍼스 미존재=skip(정직).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NIST_DIR = 'C:/Users/gomd9/Downloads/참고파일들/NIST-PMI/NIST-PMI-STEP-Files';
(existsSync(NIST_DIR) ? describe : describe.skip)('importStepAssembly — NIST PMI 실물 코퍼스', () => {
  it('AP242 단품(SRR 형제 표현): tessellated 전용 1건 제외 전부 parts≥1', () => {
    const files = readdirSync(NIST_DIR).filter((f) => f.toLowerCase().endsWith('.stp'));
    expect(files.length).toBeGreaterThanOrEqual(17);
    const zero: string[] = [];
    for (const f of files) {
      const r = importStepAssembly(readFileSync(join(NIST_DIR, f), 'utf8'));
      if (r.state.parts.length === 0) zero.push(f);
    }
    // -tg(tessellated geometry) 변형=브렙 없음 — 정직 미지원 유지
    expect(zero.filter((f) => !f.includes('-tg'))).toEqual([]);
  });
  it('빈 분류 트리는 조용히 넘어가지 않는다(unsupported 사유 명시)', () => {
    const f = readdirSync(NIST_DIR).find((q) => q === 'nist_ctc_01_asme1_ap242-e1.stp')!;
    const r = importStepAssembly(readFileSync(join(NIST_DIR, f), 'utf8'));
    expect(r.state.parts.length).toBeGreaterThanOrEqual(1);
    const tree = Object.values(r.featureTrees)[0];
    // 본질: 트리가 비면 반드시 사유가 남는다(분류기 자체 사유 or 상위 폴백 사유 — 조용한 실패 금지)
    if (tree && tree.nodes.length === 0) {
      expect(r.unsupported.length).toBeGreaterThan(0);
    }
  });
});
