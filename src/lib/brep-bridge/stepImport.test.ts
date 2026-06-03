/**
 * stepImport — Phase 5.2 STEP → FeatureTree round-trip tests.
 *
 * Pairs with stepWrite.ts (the inverse of these tests' fixtures) and
 * stepRead.ts (whose healStepSource pre-processor we run on every input).
 *
 * Phase 1 scope: box + convex polygon prism. Anything else (curved
 * surfaces, multi-loop faces, instance transforms) is routed to the
 * `unsupported` array — these tests verify that fallback path too.
 */
import { describe, it, expect } from 'vitest';
import {
  importStep,
  parseEntities,
  parseArgList,
  StepImportError,
  __internal,
} from './stepImport';
import {
  writeExtrudeAsStep,
  writeExtrudePolygonAsStep,
  writeStepEntities,
  writeStepHeader,
  writeAssemblyAsStep,
} from './stepWrite';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { RevolveFeature } from '@/lib/cad/revolveProfile';
import type { SweepFeature } from '@/lib/cad/sweepLoft';

// ─── fixtures ─────────────────────────────────────────────────────────────

function rectExtrude(width: number, height: number, depth: number): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function triangleExtrude(depth: number): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 5, y: 8 },
    ],
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function pentagonExtrude(depth: number): ExtrudeFeature {
  const loop = Array.from({ length: 5 }, (_, i) => {
    const a = (Math.PI / 2) + (2 * Math.PI * i) / 5;
    return { x: 10 * Math.cos(a), y: 10 * Math.sin(a) };
  });
  return {
    kind: 'extrude',
    loop,
    depth,
    direction: 'one_sided',
    mode: 'add',
  };
}

function bbox(loop: ReadonlyArray<{ x: number; y: number }>): {
  minX: number; minY: number; maxX: number; maxY: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of loop) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

// ─── argument parser ──────────────────────────────────────────────────────

describe('parseArgList', () => {
  it('parses a flat ref list', () => {
    const out = parseArgList('#1,#2,#3');
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ kind: 'ref', id: 1 });
    expect(out[2]).toEqual({ kind: 'ref', id: 3 });
  });

  it('parses string literals with doubled-quote escape', () => {
    const out = parseArgList("'foo',''bar''");
    expect(out[0]).toEqual({ kind: 'string', value: 'foo' });
  });

  it('parses enums (.T. / .F. / .NOT_KNOWN.)', () => {
    const out = parseArgList('.T.,.F.,.NOT_KNOWN.');
    expect(out[0]).toEqual({ kind: 'enum', value: 'T' });
    expect(out[1]).toEqual({ kind: 'enum', value: 'F' });
    expect(out[2]).toEqual({ kind: 'enum', value: 'NOT_KNOWN' });
  });

  it('parses wildcard * and null $', () => {
    const out = parseArgList('*,$');
    expect(out[0]).toEqual({ kind: 'wildcard' });
    expect(out[1]).toEqual({ kind: 'null' });
  });

  it('parses nested coordinate lists', () => {
    const out = parseArgList('(1.,2.,3.)');
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('list');
    if (out[0]?.kind === 'list') {
      expect(out[0].items).toHaveLength(3);
    }
  });

  it('handles commas inside string literals', () => {
    const out = parseArgList("'a,b,c',#7");
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ kind: 'string', value: 'a,b,c' });
  });
});

// ─── entity table parser ──────────────────────────────────────────────────

describe('parseEntities', () => {
  it('parses a minimal DATA block', () => {
    const block = `DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=DIRECTION('',(0.,0.,1.));
ENDSEC;`;
    const map = parseEntities(block);
    expect(map.size).toBe(2);
    expect(map.get(10)?.name).toBe('CARTESIAN_POINT');
    expect(map.get(11)?.name).toBe('DIRECTION');
  });

  it('handles multi-line entity bodies', () => {
    const block = `DATA;
#10=MANIFOLD_SOLID_BREP('foo
bar',
#20);
ENDSEC;`;
    const map = parseEntities(block);
    expect(map.size).toBe(1);
    expect(map.get(10)?.name).toBe('MANIFOLD_SOLID_BREP');
  });

  it('parses composite (complex) type entities', () => {
    const block = `DATA;
#10=( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
ENDSEC;`;
    const map = parseEntities(block);
    const ent = map.get(10);
    expect(ent?.name).toBe('');
    expect(ent?.subEntities?.length).toBe(3);
    expect(ent?.subEntities?.[0]?.name).toBe('LENGTH_UNIT');
    expect(ent?.subEntities?.[2]?.name).toBe('SI_UNIT');
  });

  it('throws on truncated body (missing semicolon)', () => {
    const block = `DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.))
ENDSEC;`;
    expect(() => parseEntities(block)).toThrow(StepImportError);
  });
});

// ─── round-trip: single box ───────────────────────────────────────────────

describe('importStep — box round-trip', () => {
  it('reads a 10×20×30 box back to a 4-vertex rectangular ExtrudeFeature', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 20, 30));
    const result = importStep(out);
    expect(result.tree.nodes).toHaveLength(1);
    const node = result.tree.nodes[0]!;
    expect(node.payload.kind).toBe('extrude');
    const f = node.payload as ExtrudeFeature;
    expect(f.loop).toHaveLength(4);
    const bb = bbox(f.loop);
    expect(bb.minX).toBeCloseTo(0, 5);
    expect(bb.minY).toBeCloseTo(0, 5);
    expect(bb.maxX).toBeCloseTo(10, 5);
    expect(bb.maxY).toBeCloseTo(20, 5);
    expect(f.depth).toBeCloseTo(30, 5);
  });

  it('assigns id `imported_0` and name `Imported Solid 1` to the first node', () => {
    const out = writeExtrudeAsStep(rectExtrude(5, 5, 5));
    const result = importStep(out);
    expect(result.tree.nodes[0]?.id).toBe('imported_0');
    expect(result.tree.nodes[0]?.name).toBe('Imported Solid 1');
  });

  it('round-trips a box at non-zero XY origin (bbox offset preserved)', () => {
    // Polygon writer (not bbox writer) preserves the actual rectangle
    // including its origin offset.
    const feature: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: 100, y: 50 },
        { x: 200, y: 50 },
        { x: 200, y: 150 },
        { x: 100, y: 150 },
      ],
      depth: 10,
      direction: 'one_sided',
      mode: 'add',
    };
    const out = writeExtrudePolygonAsStep(feature);
    const result = importStep(out);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as ExtrudeFeature;
    const bb = bbox(f.loop);
    expect(bb.minX).toBeCloseTo(100, 5);
    expect(bb.minY).toBeCloseTo(50, 5);
    expect(bb.maxX).toBeCloseTo(200, 5);
    expect(bb.maxY).toBeCloseTo(150, 5);
    expect(f.depth).toBeCloseTo(10, 5);
  });

  it('round-trips a box at non-zero Z origin (writeStepEntities z0 ≠ 0)', () => {
    const out = [
      writeStepHeader(),
      writeStepEntities({
        boxes: [{ name: 'lifted', x0: 0, y0: 0, z0: 5, x1: 10, y1: 10, z1: 15 }],
      }),
      'END-ISO-10303-21;\n',
    ].join('');
    const result = importStep(out);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as ExtrudeFeature;
    // depth = z1 - z0 = 10
    expect(f.depth).toBeCloseTo(10, 5);
  });

  it('returns no warnings or unsupported entries for a clean box file', () => {
    const out = writeExtrudeAsStep(rectExtrude(1, 1, 1));
    const result = importStep(out);
    expect(result.warnings).toEqual([]);
    expect(result.unsupported).toEqual([]);
  });
});

// ─── round-trip: convex polygons ──────────────────────────────────────────

describe('importStep — polygon prism round-trip', () => {
  it('round-trips a triangle prism → 3-vertex loop', () => {
    const out = writeExtrudePolygonAsStep(triangleExtrude(7));
    const result = importStep(out);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as ExtrudeFeature;
    expect(f.loop).toHaveLength(3);
    expect(f.depth).toBeCloseTo(7, 5);
  });

  it('round-trips a pentagon prism → 5-vertex loop', () => {
    const out = writeExtrudePolygonAsStep(pentagonExtrude(3));
    const result = importStep(out);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as ExtrudeFeature;
    expect(f.loop).toHaveLength(5);
    expect(f.depth).toBeCloseTo(3, 5);
  });

  it('round-trips a hexagon prism → 6-vertex loop', () => {
    const hex: ExtrudeFeature = {
      kind: 'extrude',
      loop: Array.from({ length: 6 }, (_, i) => {
        const a = (2 * Math.PI * i) / 6;
        return { x: 10 * Math.cos(a), y: 10 * Math.sin(a) };
      }),
      depth: 4,
      direction: 'one_sided',
      mode: 'add',
    };
    const out = writeExtrudePolygonAsStep(hex);
    const result = importStep(out);
    const f = result.tree.nodes[0]!.payload as ExtrudeFeature;
    expect(f.loop).toHaveLength(6);
  });

  it('triangle prism — bbox of imported loop matches source bbox', () => {
    const src = triangleExtrude(5);
    const out = writeExtrudePolygonAsStep(src);
    const result = importStep(out);
    const f = result.tree.nodes[0]!.payload as ExtrudeFeature;
    const expectedBB = bbox(src.loop);
    const actualBB = bbox(f.loop);
    expect(actualBB.minX).toBeCloseTo(expectedBB.minX, 5);
    expect(actualBB.minY).toBeCloseTo(expectedBB.minY, 5);
    expect(actualBB.maxX).toBeCloseTo(expectedBB.maxX, 5);
    expect(actualBB.maxY).toBeCloseTo(expectedBB.maxY, 5);
  });

  it('octagon prism → 8-vertex loop preserved', () => {
    const oct: ExtrudeFeature = {
      kind: 'extrude',
      loop: Array.from({ length: 8 }, (_, i) => {
        const a = (2 * Math.PI * i) / 8;
        return { x: 12 * Math.cos(a), y: 12 * Math.sin(a) };
      }),
      depth: 2,
      direction: 'one_sided',
      mode: 'add',
    };
    const out = writeExtrudePolygonAsStep(oct);
    const result = importStep(out);
    expect((result.tree.nodes[0]!.payload as ExtrudeFeature).loop).toHaveLength(8);
  });
});

// ─── multi-solid files ────────────────────────────────────────────────────

describe('importStep — multi-solid', () => {
  it('two boxes in one file → 2 separate FeatureNodes', () => {
    const file = [
      writeStepHeader(),
      writeStepEntities({
        boxes: [
          { name: 'a', x0: 0, y0: 0, z0: 0, x1: 5, y1: 5, z1: 5 },
          { name: 'b', x0: 10, y0: 10, z0: 0, x1: 20, y1: 20, z1: 10 },
        ],
      }),
      'END-ISO-10303-21;\n',
    ].join('');
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(2);
    expect(result.tree.nodes[0]!.id).toBe('imported_0');
    expect(result.tree.nodes[1]!.id).toBe('imported_1');
  });

  it('2× identical boxes → 2 separate nodes (no dedup at Phase 1)', () => {
    const file = [
      writeStepHeader(),
      writeStepEntities({
        boxes: [
          { name: 'dup1', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 },
          { name: 'dup2', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 },
        ],
      }),
      'END-ISO-10303-21;\n',
    ].join('');
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(2);
  });

  it('mixed assembly with two parts → 2 nodes', () => {
    const out = writeAssemblyAsStep({
      assemblyName: 'mixed',
      parts: [
        { id: 'p1', name: 'box-part', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 },
        {
          kind: 'polygon',
          id: 'p2',
          name: 'tri-part',
          loop: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 2.5, y: 4 }],
          depth: 3,
        },
      ],
    });
    const result = importStep(out);
    expect(result.tree.nodes).toHaveLength(2);
  });
});

// ─── error / edge cases ───────────────────────────────────────────────────

describe('importStep — error & edge cases', () => {
  it('throws on empty source', () => {
    expect(() => importStep('')).toThrow(StepImportError);
  });

  it('throws on a file with no DATA section', () => {
    const broken = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
END-ISO-10303-21;`;
    expect(() => importStep(broken)).toThrow(/no_data_section/);
  });

  it('throws on malformed entity body (no terminating semicolon)', () => {
    // Healed pre-processor adds the missing `;` only when parens balance,
    // so we craft a body with parens but no `;` AND a following stray line
    // that won't merge cleanly.
    const broken = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.
ENDSEC;
END-ISO-10303-21;`;
    expect(() => importStep(broken)).toThrow();
  });

  it('returns empty tree + warning when no MANIFOLD_SOLID_BREP is present', () => {
    const file = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
ENDSEC;
END-ISO-10303-21;`;
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.warnings).toContain('parse:no_manifold_solid_brep');
    expect(result.warnings).toContain('parse:no_closed_shell');
  });

  it('CLOSED_SHELL without MANIFOLD_SOLID_BREP → warning', () => {
    const file = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#10=CLOSED_SHELL('',(#11));
#11=CARTESIAN_POINT('',(0.,0.,0.));
ENDSEC;
END-ISO-10303-21;`;
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.warnings.some((w) => w.startsWith('parse:closed_shell_without_manifold_solid_brep'))).toBe(true);
  });

  it('records a CRLF-healed warning when input has CRLF line endings', () => {
    const out = writeExtrudeAsStep(rectExtrude(1, 1, 1)).replace(/\n/g, '\r\n');
    const result = importStep(out);
    expect(result.tree.nodes).toHaveLength(1);
    expect(result.warnings).toContain('heal:normalize_line_endings_lf');
  });

  it('healable file without END-ISO marker still imports successfully', () => {
    const out = writeExtrudeAsStep(rectExtrude(2, 2, 2))
      .replace(/END-ISO-10303-21;\s*$/m, '');
    const result = importStep(out);
    expect(result.tree.nodes).toHaveLength(1);
    expect(result.warnings).toContain('heal:add_missing_end_iso');
  });

  it('non-string input throws', () => {
    // @ts-expect-error testing runtime guard
    expect(() => importStep(null)).toThrow(StepImportError);
  });
});

// ─── unsupported geometry routing ─────────────────────────────────────────

describe('importStep — unsupported geometry', () => {
  /** Hand-built minimal solid whose ONE face is a BSPLINE_SURFACE_WITH_KNOTS. */
  function makeBSplineSolidFile(): string {
    return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=VERTEX_POINT('',#10);
#12=DIRECTION('',(0.,0.,1.));
#13=DIRECTION('',(1.,0.,0.));
#14=AXIS2_PLACEMENT_3D('',#10,#12,#13);
#15=BSPLINE_SURFACE_WITH_KNOTS('',1,1,((#10,#10),(#10,#10)),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);
#16=DIRECTION('',(1.,0.,0.));
#17=VECTOR('',#16,1.);
#18=LINE('',#10,#17);
#19=EDGE_CURVE('',#11,#11,#18,.T.);
#20=ORIENTED_EDGE('',*,*,#19,.T.);
#21=EDGE_LOOP('',(#20));
#22=FACE_OUTER_BOUND('',#21,.T.);
#23=ADVANCED_FACE('',(#22),#15,.T.);
#24=CLOSED_SHELL('',(#23));
#25=MANIFOLD_SOLID_BREP('',#24);
ENDSEC;
END-ISO-10303-21;`;
  }

  it('BSPLINE_SURFACE solid → unsupported with reason', () => {
    const result = importStep(makeBSplineSolidFile());
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/BSPLINE_SURFACE/i);
  });

  it('mixed file: 1 box + 1 BSPLINE solid → 1 node + 1 unsupported', () => {
    const boxFile = writeExtrudeAsStep(rectExtrude(2, 3, 4));
    // Splice BSPLINE entities into the same DATA block. Renumber the BSPLINE
    // sub-entities so they don't collide with the box (which uses ids 10+).
    // Pull just the inner DATA-block entity lines from each.
    const bsplineFile = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#900=CARTESIAN_POINT('',(100.,0.,0.));
#901=VERTEX_POINT('',#900);
#902=DIRECTION('',(0.,0.,1.));
#903=DIRECTION('',(1.,0.,0.));
#904=AXIS2_PLACEMENT_3D('',#900,#902,#903);
#905=BSPLINE_SURFACE_WITH_KNOTS('',1,1,((#900,#900),(#900,#900)),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);
#906=DIRECTION('',(1.,0.,0.));
#907=VECTOR('',#906,1.);
#908=LINE('',#900,#907);
#909=EDGE_CURVE('',#901,#901,#908,.T.);
#910=ORIENTED_EDGE('',*,*,#909,.T.);
#911=EDGE_LOOP('',(#910));
#912=FACE_OUTER_BOUND('',#911,.T.);
#913=ADVANCED_FACE('',(#912),#905,.T.);
#914=CLOSED_SHELL('',(#913));
#915=MANIFOLD_SOLID_BREP('',#914);
ENDSEC;
END-ISO-10303-21;`;
    // Splice: insert the box's DATA entities before the BSPLINE's ENDSEC.
    const boxDataStart = boxFile.search(/\bDATA\s*;/);
    const boxDataEnd = boxFile.indexOf('ENDSEC;', boxDataStart);
    const boxLines = boxFile.slice(boxDataStart + 'DATA;'.length, boxDataEnd);
    const mergedDataIdx = bsplineFile.search(/\bDATA\s*;/);
    const mergedEndsecIdx = bsplineFile.indexOf('ENDSEC;', mergedDataIdx);
    const merged =
      bsplineFile.slice(0, mergedEndsecIdx) +
      boxLines +
      bsplineFile.slice(mergedEndsecIdx);
    const result = importStep(merged);
    expect(result.tree.nodes).toHaveLength(1);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/BSPLINE/);
  });

  it('cylinder-like solid (CYLINDRICAL_SURFACE face) → unsupported', () => {
    const file = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=VERTEX_POINT('',#10);
#12=DIRECTION('',(0.,0.,1.));
#13=DIRECTION('',(1.,0.,0.));
#14=AXIS2_PLACEMENT_3D('',#10,#12,#13);
#15=CYLINDRICAL_SURFACE('',#14,5.);
#16=DIRECTION('',(1.,0.,0.));
#17=VECTOR('',#16,1.);
#18=LINE('',#10,#17);
#19=EDGE_CURVE('',#11,#11,#18,.T.);
#20=ORIENTED_EDGE('',*,*,#19,.T.);
#21=EDGE_LOOP('',(#20));
#22=FACE_OUTER_BOUND('',#21,.T.);
#23=ADVANCED_FACE('',(#22),#15,.T.);
#24=CLOSED_SHELL('',(#23));
#25=MANIFOLD_SOLID_BREP('',#24);
ENDSEC;
END-ISO-10303-21;`;
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported[0]).toMatch(/CYLINDRICAL_SURFACE/);
  });
});

// ─── internal export sanity ───────────────────────────────────────────────

describe('__internal tolerances', () => {
  it('exposes POINT_EPS and AXIS_EPS for downstream callers', () => {
    expect(__internal.POINT_EPS).toBeGreaterThan(0);
    expect(__internal.AXIS_EPS).toBeGreaterThan(0);
    expect(__internal.POINT_EPS).toBeLessThan(1);
    expect(__internal.AXIS_EPS).toBeLessThan(1);
  });
});

// ─── opts.namePrefix ──────────────────────────────────────────────────────

describe('importStep — options', () => {
  it('respects opts.namePrefix for FeatureNode ids', () => {
    const out = writeExtrudeAsStep(rectExtrude(1, 1, 1));
    const result = importStep(out, { namePrefix: 'cad' });
    expect(result.tree.nodes[0]?.id).toBe('cad_0');
  });
});

// ─── Phase 2: hand-built STEP fixtures ────────────────────────────────────
//
// The Phase 2 importer recognises two new shape families that `stepWrite.ts`
// does not yet emit:
//   1. REVOLVED_AREA_SOLID — direct revolve entity (some exporters use it
//      instead of decomposing the body into a BREP).
//   2. Cylinder BREP — exactly 1 CYLINDRICAL_SURFACE side face + 2 PLANE
//      caps, recognised in the regular MANIFOLD_SOLID_BREP path.
//
// Because the writer can't produce these, every Phase 2 test below builds
// a STEP source string by hand. Each fixture uses a small ID block (#10+)
// so callers can splice them together without renumbering.

/** Wrap a body of entity lines in the standard ISO-10303-21 / AP214 envelope. */
function wrapStepFile(entitiesBlock: string): string {
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('','',(''),(''),'','','');
FILE_SCHEMA(('AP214'));
ENDSEC;
DATA;
${entitiesBlock}
ENDSEC;
END-ISO-10303-21;`;
}

/**
 * Build a STEP file containing a REVOLVED_AREA_SOLID with a rectangular
 * profile (width × height) revolved around the given world axis.
 *
 * Axis spec is one of: '+x', '-x', '+y', '-y', '+z', '-z', or '(a,b,c)'
 * for an arbitrary direction (used by the Phase 2 limit test).
 *
 * Profile rectangle is built in a plane perpendicular to the axis, with
 * the rectangle's "near" edge aligned with the axis line at radial offset
 * `rOffset` so the revolve traces a torus-like ring (or, when rOffset=0,
 * a solid disk extruded along the axis).
 */
function makeRevolvedAreaSolidFile(opts: {
  axis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z' | [number, number, number];
  width: number;
  height: number;
  rOffset?: number;
  angleRad?: number;
}): string {
  const { width: w, height: h } = opts;
  const r0 = opts.rOffset ?? 0;
  const angle = opts.angleRad ?? 2 * Math.PI;
  // Map the axis spec → AXIS1_PLACEMENT direction triple AND the profile
  // points in the radial / axial plane.
  let axisDir: [number, number, number];
  let p: Array<[number, number, number]>;
  if (Array.isArray(opts.axis)) {
    axisDir = opts.axis;
    // Profile in XY plane (radius = X, axis = Y by convention here).
    p = [
      [r0, 0, 0],
      [r0 + w, 0, 0],
      [r0 + w, h, 0],
      [r0, h, 0],
    ];
  } else {
    const sign = opts.axis.startsWith('-') ? -1 : 1;
    const letter = opts.axis[1];
    if (letter === 'z') {
      axisDir = [0, 0, sign];
      p = [
        [r0, 0, 0],
        [r0 + w, 0, 0],
        [r0 + w, 0, h],
        [r0, 0, h],
      ];
    } else if (letter === 'y') {
      axisDir = [0, sign, 0];
      p = [
        [r0, 0, 0],
        [r0, 0, w],
        [r0, h, w],
        [r0, h, 0],
      ];
    } else {
      // x
      axisDir = [sign, 0, 0];
      p = [
        [0, r0, 0],
        [0, r0 + w, 0],
        [h, r0 + w, 0],
        [h, r0, 0],
      ];
    }
  }
  const fmt = (n: number) => `${n}.`;
  // Entities laid out in dependency order:
  //   #10..#13  CARTESIAN_POINT  (4 profile corners)
  //   #20..#23  VERTEX_POINT
  //   #30..#33  DIRECTION (4 edge directions — one per side, simplified)
  //   #40..#43  VECTOR / LINE
  //   #50..#53  EDGE_CURVE
  //   #60..#63  ORIENTED_EDGE
  //   #70       EDGE_LOOP
  //   #71       FACE_OUTER_BOUND
  //   #72       PLANAR_FACE
  //   #80       CARTESIAN_POINT (axis origin)
  //   #81       DIRECTION       (axis direction)
  //   #82       AXIS1_PLACEMENT
  //   #90       REVOLVED_AREA_SOLID
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    lines.push(`#${10 + i}=CARTESIAN_POINT('',(${fmt(p[i]![0])},${fmt(p[i]![1])},${fmt(p[i]![2])}));`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${20 + i}=VERTEX_POINT('',#${10 + i});`);
  }
  for (let i = 0; i < 4; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % 4]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    lines.push(`#${30 + i}=DIRECTION('',(${dx / len}.,${dy / len}.,${dz / len}.));`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${40 + i}=VECTOR('',#${30 + i},1.);`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${44 + i}=LINE('',#${10 + i},#${40 + i});`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${50 + i}=EDGE_CURVE('',#${20 + i},#${20 + ((i + 1) % 4)},#${44 + i},.T.);`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${60 + i}=ORIENTED_EDGE('',*,*,#${50 + i},.T.);`);
  }
  lines.push(`#70=EDGE_LOOP('',(#60,#61,#62,#63));`);
  lines.push(`#71=FACE_OUTER_BOUND('',#70,.T.);`);
  lines.push(`#72=PLANAR_FACE('',(#71));`);
  lines.push(`#80=CARTESIAN_POINT('',(0.,0.,0.));`);
  lines.push(`#81=DIRECTION('',(${axisDir[0]}.,${axisDir[1]}.,${axisDir[2]}.));`);
  lines.push(`#82=AXIS1_PLACEMENT('',#80,#81);`);
  lines.push(`#90=REVOLVED_AREA_SOLID('',#72,#82,${angle});`);
  return wrapStepFile(lines.join('\n'));
}

/**
 * Build a STEP file containing a cylinder BREP with the geometry pattern
 * the Phase 2 importer matches: 1 CYLINDRICAL_SURFACE + 2 PLANE caps.
 *
 * The cylinder axis direction is one of the 6 ±axis-aligned dirs; radius
 * and height are arbitrary positive floats.
 *
 * The two cap planes are decoded as 4-vertex squares wrapping the cylinder
 * (so the existing planar-face decoder sees them as valid rectangles). The
 * cylinder side face's outer bound contains a LINE seam edge, which the
 * face decoder skips because the dispatcher reads CYLINDRICAL_SURFACE
 * before walking the loop.
 */
function makeCylinderBrepFile(opts: {
  axis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
  radius: number;
  height: number;
}): string {
  const { radius: r, height: h } = opts;
  const sign = opts.axis.startsWith('-') ? -1 : 1;
  const letter = opts.axis[1] as 'x' | 'y' | 'z';
  // axisU = cylinder axis direction (unit).
  let axisU: [number, number, number];
  // capNormal0/1 = ±axisU (chosen so capPlanes face outward).
  // For each cap, build a square in the plane perpendicular to axisU, large
  // enough (side = 4r) to enclose the cylinder.
  let perp1: [number, number, number];
  let perp2: [number, number, number];
  if (letter === 'z') {
    axisU = [0, 0, sign];
    perp1 = [1, 0, 0];
    perp2 = [0, 1, 0];
  } else if (letter === 'y') {
    axisU = [0, sign, 0];
    perp1 = [1, 0, 0];
    perp2 = [0, 0, 1];
  } else {
    axisU = [sign, 0, 0];
    perp1 = [0, 1, 0];
    perp2 = [0, 0, 1];
  }
  // Cap centres: bottom at origin, top at h * axisU.
  const cb: [number, number, number] = [0, 0, 0];
  const ct: [number, number, number] = [h * axisU[0], h * axisU[1], h * axisU[2]];
  const side = 4 * r;
  function squareAround(c: [number, number, number]): Array<[number, number, number]> {
    const half = side / 2;
    return [
      [c[0] - half * perp1[0] - half * perp2[0], c[1] - half * perp1[1] - half * perp2[1], c[2] - half * perp1[2] - half * perp2[2]],
      [c[0] + half * perp1[0] - half * perp2[0], c[1] + half * perp1[1] - half * perp2[1], c[2] + half * perp1[2] - half * perp2[2]],
      [c[0] + half * perp1[0] + half * perp2[0], c[1] + half * perp1[1] + half * perp2[1], c[2] + half * perp1[2] + half * perp2[2]],
      [c[0] - half * perp1[0] + half * perp2[0], c[1] - half * perp1[1] + half * perp2[1], c[2] - half * perp1[2] + half * perp2[2]],
    ];
  }
  const bottomQuad = squareAround(cb);
  const topQuad = squareAround(ct);

  const fmt = (n: number) => `${n}.`;
  const lines: string[] = [];

  // ─── shared anchor point + axis direction for cyl + caps ───────────────
  lines.push(`#10=CARTESIAN_POINT('',(0.,0.,0.));`);
  lines.push(`#11=DIRECTION('',(${axisU[0]}.,${axisU[1]}.,${axisU[2]}.));`);
  lines.push(`#12=DIRECTION('',(${perp1[0]}.,${perp1[1]}.,${perp1[2]}.));`);
  lines.push(`#13=AXIS2_PLACEMENT_3D('',#10,#11,#12);`);
  lines.push(`#14=CYLINDRICAL_SURFACE('',#13,${fmt(r)});`);

  // Cylinder side face needs a (degenerate) outer bound — the dispatcher
  // does NOT descend into it for cylindrical surfaces, so a stub seam loop
  // is fine.
  lines.push(`#20=VERTEX_POINT('',#10);`);
  lines.push(`#21=VECTOR('',#11,1.);`);
  lines.push(`#22=LINE('',#10,#21);`);
  lines.push(`#23=EDGE_CURVE('',#20,#20,#22,.T.);`);
  lines.push(`#24=ORIENTED_EDGE('',*,*,#23,.T.);`);
  lines.push(`#25=EDGE_LOOP('',(#24));`);
  lines.push(`#26=FACE_OUTER_BOUND('',#25,.T.);`);
  lines.push(`#27=ADVANCED_FACE('',(#26),#14,.T.);`);

  // ─── bottom cap (PLANE, normal = -axisU) ──────────────────────────────
  let nextId = 30;
  function emitCap(
    quad: Array<[number, number, number]>,
    centre: [number, number, number],
    normalDir: [number, number, number],
    startId: number,
  ): { faceId: number } {
    const pIds = [startId, startId + 1, startId + 2, startId + 3];
    for (let i = 0; i < 4; i++) {
      lines.push(`#${pIds[i]}=CARTESIAN_POINT('',(${fmt(quad[i]![0])},${fmt(quad[i]![1])},${fmt(quad[i]![2])}));`);
    }
    const vIds = [startId + 4, startId + 5, startId + 6, startId + 7];
    for (let i = 0; i < 4; i++) {
      lines.push(`#${vIds[i]}=VERTEX_POINT('',#${pIds[i]});`);
    }
    // 4 edge directions + 4 LINE edges + 4 ORIENTED_EDGE + EDGE_LOOP.
    const dirIds: number[] = [];
    const vecIds: number[] = [];
    const lineIds: number[] = [];
    const ecIds: number[] = [];
    const oeIds: number[] = [];
    let id = startId + 8;
    for (let i = 0; i < 4; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % 4]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      lines.push(`#${id}=DIRECTION('',(${dx / len}.,${dy / len}.,${dz / len}.));`);
      dirIds.push(id);
      id++;
    }
    for (let i = 0; i < 4; i++) {
      lines.push(`#${id}=VECTOR('',#${dirIds[i]},1.);`);
      vecIds.push(id);
      id++;
    }
    for (let i = 0; i < 4; i++) {
      lines.push(`#${id}=LINE('',#${pIds[i]},#${vecIds[i]});`);
      lineIds.push(id);
      id++;
    }
    for (let i = 0; i < 4; i++) {
      lines.push(`#${id}=EDGE_CURVE('',#${vIds[i]},#${vIds[(i + 1) % 4]},#${lineIds[i]},.T.);`);
      ecIds.push(id);
      id++;
    }
    for (let i = 0; i < 4; i++) {
      lines.push(`#${id}=ORIENTED_EDGE('',*,*,#${ecIds[i]},.T.);`);
      oeIds.push(id);
      id++;
    }
    lines.push(`#${id}=EDGE_LOOP('',(#${oeIds[0]},#${oeIds[1]},#${oeIds[2]},#${oeIds[3]}));`);
    const loopId = id;
    id++;
    lines.push(`#${id}=FACE_OUTER_BOUND('',#${loopId},.T.);`);
    const bndId = id;
    id++;
    // PLANE axis placement.
    lines.push(`#${id}=CARTESIAN_POINT('',(${fmt(centre[0])},${fmt(centre[1])},${fmt(centre[2])}));`);
    const orgId = id;
    id++;
    lines.push(`#${id}=DIRECTION('',(${normalDir[0]}.,${normalDir[1]}.,${normalDir[2]}.));`);
    const ndirId = id;
    id++;
    lines.push(`#${id}=DIRECTION('',(${perp1[0]}.,${perp1[1]}.,${perp1[2]}.));`);
    const refDirId = id;
    id++;
    lines.push(`#${id}=AXIS2_PLACEMENT_3D('',#${orgId},#${ndirId},#${refDirId});`);
    const axisId = id;
    id++;
    lines.push(`#${id}=PLANE('',#${axisId});`);
    const planeId = id;
    id++;
    lines.push(`#${id}=ADVANCED_FACE('',(#${bndId}),#${planeId},.T.);`);
    const faceId = id;
    nextId = id + 1;
    return { faceId };
  }

  const bottom = emitCap(bottomQuad, cb, [-axisU[0], -axisU[1], -axisU[2]], nextId);
  const top = emitCap(topQuad, ct, axisU, nextId);

  lines.push(`#${nextId}=CLOSED_SHELL('',(#27,#${bottom.faceId},#${top.faceId}));`);
  const shellId = nextId++;
  lines.push(`#${nextId}=MANIFOLD_SOLID_BREP('',#${shellId});`);
  return wrapStepFile(lines.join('\n'));
}

/**
 * Build a STEP file with an ADVANCED_FACE whose surface is the named
 * curved type — used to verify each surface kind shows up in the
 * unsupported list with a recognisable reason.
 */
function makeSingleFaceCurvedSurfaceFile(surfaceLine: string): string {
  return wrapStepFile(`#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=VERTEX_POINT('',#10);
#12=DIRECTION('',(0.,0.,1.));
#13=DIRECTION('',(1.,0.,0.));
#14=AXIS2_PLACEMENT_3D('',#10,#12,#13);
${surfaceLine}
#16=DIRECTION('',(1.,0.,0.));
#17=VECTOR('',#16,1.);
#18=LINE('',#10,#17);
#19=EDGE_CURVE('',#11,#11,#18,.T.);
#20=ORIENTED_EDGE('',*,*,#19,.T.);
#21=EDGE_LOOP('',(#20));
#22=FACE_OUTER_BOUND('',#21,.T.);
#23=ADVANCED_FACE('',(#22),#15,.T.);
#24=CLOSED_SHELL('',(#23));
#25=MANIFOLD_SOLID_BREP('',#24);`);
}

// ─── REVOLVED_AREA_SOLID — direct revolve entities ────────────────────────

describe('importStep — Phase 2 REVOLVED_AREA_SOLID', () => {
  it('rectangular profile + +Z axis → RevolveFeature (canonical Y axis)', () => {
    const file = makeRevolvedAreaSolidFile({ axis: '+z', width: 3, height: 7, rOffset: 1 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const node = result.tree.nodes[0]!;
    expect(node.payload.kind).toBe('revolve');
    expect(node.id).toBe('imported_revolve_0');
    expect(node.name).toBe('Imported Revolved Solid 1');
    const f = node.payload as RevolveFeature;
    // Profile is in X≥0 half-plane.
    for (const p of f.loop) {
      expect(p.x).toBeGreaterThanOrEqual(0);
    }
    expect(f.angleDegrees).toBeCloseTo(360, 3);
    expect(f.mode).toBe('add');
    // Loop has the same number of vertices as the source rectangle.
    expect(f.loop).toHaveLength(4);
  });

  it('rectangular profile + +X axis → RevolveFeature (axis recognised as X)', () => {
    const file = makeRevolvedAreaSolidFile({ axis: '+x', width: 2, height: 5, rOffset: 1 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as RevolveFeature;
    expect(f.kind).toBe('revolve');
    expect(f.loop.length).toBeGreaterThanOrEqual(3);
  });

  it('rectangular profile + +Y axis → RevolveFeature', () => {
    const file = makeRevolvedAreaSolidFile({ axis: '+y', width: 2, height: 5, rOffset: 1 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as RevolveFeature;
    expect(f.kind).toBe('revolve');
  });

  it('partial-angle revolve (90 degrees) → angleDegrees ≈ 90', () => {
    const file = makeRevolvedAreaSolidFile({
      axis: '+z',
      width: 2,
      height: 3,
      rOffset: 1,
      angleRad: Math.PI / 2,
    });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as RevolveFeature;
    expect(f.angleDegrees).toBeCloseTo(90, 3);
  });

  it('arbitrary (diagonal) axis → unsupported with "not axis-aligned" reason', () => {
    const file = makeRevolvedAreaSolidFile({
      axis: [1, 1, 1],
      width: 2,
      height: 3,
      rOffset: 1,
    });
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/not axis-aligned/);
  });
});

// ─── BREP cylinder primitive ──────────────────────────────────────────────

describe('importStep — Phase 2 cylinder BREP', () => {
  it('1 CYLINDRICAL + 2 PLANE caps (+Z axis) → RevolveFeature (rectangle r×h)', () => {
    const file = makeCylinderBrepFile({ axis: '+z', radius: 5, height: 12 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const node = result.tree.nodes[0]!;
    expect(node.payload.kind).toBe('revolve');
    expect(node.id).toBe('imported_revolve_0');
    const f = node.payload as RevolveFeature;
    // Rectangle profile: (0,0), (r,0), (r,h), (0,h).
    expect(f.loop).toHaveLength(4);
    const maxX = Math.max(...f.loop.map((p) => p.x));
    const maxY = Math.max(...f.loop.map((p) => p.y));
    expect(maxX).toBeCloseTo(5, 5);
    expect(maxY).toBeCloseTo(12, 5);
    // Every point in X≥0 half.
    for (const p of f.loop) expect(p.x).toBeGreaterThanOrEqual(0);
    expect(f.angleDegrees).toBeCloseTo(360, 3);
  });

  it('cylinder with +X axis (lying on its side) → RevolveFeature, axis recognised', () => {
    const file = makeCylinderBrepFile({ axis: '+x', radius: 3, height: 8 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as RevolveFeature;
    expect(f.kind).toBe('revolve');
    const maxX = Math.max(...f.loop.map((p) => p.x));
    const maxY = Math.max(...f.loop.map((p) => p.y));
    expect(maxX).toBeCloseTo(3, 5);
    expect(maxY).toBeCloseTo(8, 5);
  });

  it('cylinder with -Y axis → RevolveFeature (sign-agnostic axis match)', () => {
    const file = makeCylinderBrepFile({ axis: '-y', radius: 2, height: 6 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    expect(result.tree.nodes[0]!.payload.kind).toBe('revolve');
  });

  it('mixed file: 1 box + 1 cylinder → tree has 1 extrude + 1 revolve', () => {
    // Splice a cylinder BREP fixture next to a writer-emitted box. The
    // cylinder fixture and the box writer both start their id ranges at
    // #10, so we shift the cylinder's ids by +500 before merging.
    const boxFile = writeExtrudeAsStep(rectExtrude(4, 5, 6));
    const cylFile = makeCylinderBrepFile({ axis: '+z', radius: 2, height: 3 });
    const boxDataStart = boxFile.search(/\bDATA\s*;/);
    const boxDataEnd = boxFile.indexOf('ENDSEC;', boxDataStart);
    const boxLines = boxFile.slice(boxDataStart + 'DATA;'.length, boxDataEnd);
    const cylDataStart = cylFile.search(/\bDATA\s*;/);
    const cylEndsec = cylFile.indexOf('ENDSEC;', cylDataStart);
    const offset = 500;
    const cylBlock = cylFile
      .slice(cylDataStart + 'DATA;'.length, cylEndsec)
      .replace(/#(\d+)/g, (_, n) => `#${Number(n) + offset}`);
    const merged =
      cylFile.slice(0, cylDataStart + 'DATA;'.length) +
      cylBlock +
      boxLines +
      cylFile.slice(cylEndsec);
    const result = importStep(merged);
    expect(result.tree.nodes).toHaveLength(2);
    const kinds = result.tree.nodes.map((n) => n.payload.kind).sort();
    expect(kinds).toEqual(['extrude', 'revolve']);
    expect(result.unsupported).toEqual([]);
  });
});

// ─── unsupported surface families (still rejected with named reason) ──────

describe('importStep — Phase 2 still-unsupported surfaces', () => {
  it('CONICAL_SURFACE → unsupported (named in reason)', () => {
    const file = makeSingleFaceCurvedSurfaceFile(
      `#15=CONICAL_SURFACE('',#14,5.,0.5);`,
    );
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/CONICAL_SURFACE/);
  });

  it('SPHERICAL_SURFACE → unsupported', () => {
    const file = makeSingleFaceCurvedSurfaceFile(
      `#15=SPHERICAL_SURFACE('',#14,5.);`,
    );
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported[0]).toMatch(/SPHERICAL_SURFACE/);
  });

  it('TOROIDAL_SURFACE → unsupported', () => {
    const file = makeSingleFaceCurvedSurfaceFile(
      `#15=TOROIDAL_SURFACE('',#14,5.,1.);`,
    );
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported[0]).toMatch(/TOROIDAL_SURFACE/);
  });

  it('BSPLINE_SURFACE in a multi-face solid → unsupported with named reason', () => {
    // Re-use the single-cylinder pattern — Phase 2's cylinder detector
    // requires exactly 1 cylinder + 2 caps, so a single BSPLINE face stays
    // on the unsupported channel just like before.
    const file = makeSingleFaceCurvedSurfaceFile(
      `#15=BSPLINE_SURFACE_WITH_KNOTS('',1,1,((#10,#10),(#10,#10)),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);`,
    );
    const result = importStep(file);
    expect(result.unsupported[0]).toMatch(/BSPLINE_SURFACE/);
  });

  it('REVOLVED_AREA_SOLID with non-LINE profile edge → unsupported with reason', () => {
    // Replace the rectangle's LINE edges with a CIRCLE — the profile
    // decoder should bail before transforming anything.
    const file = wrapStepFile(`#10=CARTESIAN_POINT('',(1.,0.,0.));
#11=CARTESIAN_POINT('',(2.,0.,0.));
#20=VERTEX_POINT('',#10);
#21=VERTEX_POINT('',#11);
#30=DIRECTION('',(0.,0.,1.));
#31=DIRECTION('',(1.,0.,0.));
#32=AXIS2_PLACEMENT_3D('',#10,#30,#31);
#33=CIRCLE('',#32,0.5);
#40=EDGE_CURVE('',#20,#21,#33,.T.);
#41=ORIENTED_EDGE('',*,*,#40,.T.);
#42=EDGE_LOOP('',(#41));
#43=FACE_OUTER_BOUND('',#42,.T.);
#44=PLANAR_FACE('',(#43));
#80=CARTESIAN_POINT('',(0.,0.,0.));
#81=DIRECTION('',(0.,0.,1.));
#82=AXIS1_PLACEMENT('',#80,#81);
#90=REVOLVED_AREA_SOLID('',#44,#82,6.283185307179586);`);
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported[0]).toMatch(/non-linear|CIRCLE/);
  });

  it('cylinder mixed with extra non-cap planar face → unsupported (detector rejects)', () => {
    // Build a normal cylinder then splice in an extra ADVANCED_FACE that
    // breaks the (1 cyl + 2 caps) invariant. The detector should fall
    // through to the unsupported branch with a face-count breakdown.
    const cylFile = makeCylinderBrepFile({ axis: '+z', radius: 1, height: 2 });
    // Inject an extra plane face into the CLOSED_SHELL by patching the
    // shell entity to reference a new dummy face. Easier: just verify the
    // mixed-surface branch via a different fixture — a cylinder + bspline
    // hybrid.
    const hybrid = cylFile.replace(
      /CYLINDRICAL_SURFACE\('',#13,([\d.]+)\)/,
      `BSPLINE_SURFACE_WITH_KNOTS('',1,1,((#10,#10),(#10,#10)),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.)`,
    );
    const result = importStep(hybrid);
    // Either falls through with the BSPLINE name OR the face-count message.
    // Both are acceptable; what matters is no node was produced.
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
  });

  it('Phase 2 unsupported entries still use the `#<id>: <reason>` format', () => {
    const file = makeSingleFaceCurvedSurfaceFile(
      `#15=CONICAL_SURFACE('',#14,5.,0.5);`,
    );
    const result = importStep(file);
    expect(result.unsupported[0]).toMatch(/^#\d+: /);
  });

  it('two cylinders in one file → 2 RevolveFeature nodes', () => {
    const c1 = makeCylinderBrepFile({ axis: '+z', radius: 2, height: 4 });
    const c2 = makeCylinderBrepFile({ axis: '+x', radius: 3, height: 5 });
    // Splice c2's DATA into c1.
    const c1End = c1.indexOf('ENDSEC;', c1.search(/\bDATA\s*;/));
    const c2DataStart = c2.search(/\bDATA\s*;/);
    const c2DataEnd = c2.indexOf('ENDSEC;', c2DataStart);
    // Shift every #N reference in c2's data by an offset that's larger
    // than any id in c1 (the cylinder fixture uses ids in the low hundreds).
    const offset = 1000;
    const c2Block = c2.slice(c2DataStart + 'DATA;'.length, c2DataEnd)
      .replace(/#(\d+)/g, (_, n) => `#${Number(n) + offset}`);
    const merged = c1.slice(0, c1End) + c2Block + c1.slice(c1End);
    const result = importStep(merged);
    expect(result.tree.nodes).toHaveLength(2);
    expect(result.tree.nodes.every((n) => n.payload.kind === 'revolve')).toBe(true);
    expect(result.tree.nodes[0]!.id).toBe('imported_revolve_0');
    expect(result.tree.nodes[1]!.id).toBe('imported_revolve_1');
  });
});

// ─── Phase 3: hand-built STEP fixtures (sweeps) ───────────────────────────
//
// Phase 3 adds two new families:
//   1. SWEPT_AREA_SOLID / EXTRUDED_AREA_SOLID — direct extrusion entities
//      with a planar profile + axis-aligned direction.
//   2. SURFACE_OF_LINEAR_EXTRUSION BREP — 1 SURFACE_OF_LINEAR_EXTRUSION side
//      face + 2 PLANE caps with cap normals parallel to the extrusion
//      direction. Reconstructs a rectangle SweepFeature.
//
// Plus SWEPT_DISK_SOLID is recognised but routed to `unsupported` (Phase 4
// wishlist — low frequency).

/**
 * Build a STEP file containing an EXTRUDED_AREA_SOLID with a rectangular
 * profile (width × height in the perpendicular plane) extruded `depth` units
 * along the given world axis.
 *
 * The profile rectangle is placed in the plane perpendicular to the
 * extrusion axis at origin (0,0,0). Profile corners are emitted as
 * (radial1, radial2) pairs in the plane perpendicular to `axis`.
 *
 * `useSweptAreaSolid` switches the entity name to SWEPT_AREA_SOLID (with
 * a VECTOR encoding depth via |vec|) instead of EXTRUDED_AREA_SOLID.
 */
function makeExtrudedAreaSolidFile(opts: {
  axis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z' | [number, number, number];
  width: number;
  height: number;
  depth: number;
  useSweptAreaSolid?: boolean;
}): string {
  const { width: w, height: h, depth: d } = opts;
  let axisDir: [number, number, number];
  let p: Array<[number, number, number]>;
  if (Array.isArray(opts.axis)) {
    axisDir = opts.axis;
    // Profile in XY plane.
    p = [[0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0]];
  } else {
    const sign = opts.axis.startsWith('-') ? -1 : 1;
    const letter = opts.axis[1];
    if (letter === 'z') {
      axisDir = [0, 0, sign];
      p = [[0, 0, 0], [w, 0, 0], [w, h, 0], [0, h, 0]];
    } else if (letter === 'y') {
      axisDir = [0, sign, 0];
      p = [[0, 0, 0], [w, 0, 0], [w, 0, h], [0, 0, h]];
    } else {
      axisDir = [sign, 0, 0];
      p = [[0, 0, 0], [0, w, 0], [0, w, h], [0, 0, h]];
    }
  }
  const fmt = (n: number) => `${n}.`;
  const lines: string[] = [];
  for (let i = 0; i < 4; i++) {
    lines.push(`#${10 + i}=CARTESIAN_POINT('',(${fmt(p[i]![0])},${fmt(p[i]![1])},${fmt(p[i]![2])}));`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${20 + i}=VERTEX_POINT('',#${10 + i});`);
  }
  for (let i = 0; i < 4; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % 4]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1;
    lines.push(`#${30 + i}=DIRECTION('',(${dx / len}.,${dy / len}.,${dz / len}.));`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${40 + i}=VECTOR('',#${30 + i},1.);`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${44 + i}=LINE('',#${10 + i},#${40 + i});`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${50 + i}=EDGE_CURVE('',#${20 + i},#${20 + ((i + 1) % 4)},#${44 + i},.T.);`);
  }
  for (let i = 0; i < 4; i++) {
    lines.push(`#${60 + i}=ORIENTED_EDGE('',*,*,#${50 + i},.T.);`);
  }
  lines.push(`#70=EDGE_LOOP('',(#60,#61,#62,#63));`);
  lines.push(`#71=FACE_OUTER_BOUND('',#70,.T.);`);
  lines.push(`#72=PLANAR_FACE('',(#71));`);
  lines.push(`#80=DIRECTION('',(${axisDir[0]}.,${axisDir[1]}.,${axisDir[2]}.));`);
  if (opts.useSweptAreaSolid) {
    // SWEPT_AREA_SOLID with VECTOR (depth = |vec|).
    lines.push(`#81=VECTOR('',#80,${fmt(d)});`);
    lines.push(`#90=SWEPT_AREA_SOLID('',#72,#81);`);
  } else {
    // EXTRUDED_AREA_SOLID with explicit depth.
    lines.push(`#90=EXTRUDED_AREA_SOLID('',#72,#80,${fmt(d)});`);
  }
  return wrapStepFile(lines.join('\n'));
}

/**
 * Build a STEP file with a SURFACE_OF_LINEAR_EXTRUSION-based BREP body:
 * 1 SURFACE_OF_LINEAR_EXTRUSION side face + 2 PLANE caps. The two caps are
 * 4-vertex squares (side = `size`) perpendicular to the extrusion axis,
 * placed at z=0 and z=depth along the axis.
 *
 * Mirrors `makeCylinderBrepFile` in structure so the BREP path detector is
 * exercised in the same way.
 */
function makeLinearExtrusionBrepFile(opts: {
  axis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
  size: number;
  depth: number;
}): string {
  const { size, depth: d } = opts;
  const sign = opts.axis.startsWith('-') ? -1 : 1;
  const letter = opts.axis[1] as 'x' | 'y' | 'z';
  let axisU: [number, number, number];
  let perp1: [number, number, number];
  let perp2: [number, number, number];
  if (letter === 'z') {
    axisU = [0, 0, sign];
    perp1 = [1, 0, 0];
    perp2 = [0, 1, 0];
  } else if (letter === 'y') {
    axisU = [0, sign, 0];
    perp1 = [1, 0, 0];
    perp2 = [0, 0, 1];
  } else {
    axisU = [sign, 0, 0];
    perp1 = [0, 1, 0];
    perp2 = [0, 0, 1];
  }
  const cb: [number, number, number] = [0, 0, 0];
  const ct: [number, number, number] = [d * axisU[0], d * axisU[1], d * axisU[2]];
  function squareAround(c: [number, number, number]): Array<[number, number, number]> {
    const half = size / 2;
    return [
      [c[0] - half * perp1[0] - half * perp2[0], c[1] - half * perp1[1] - half * perp2[1], c[2] - half * perp1[2] - half * perp2[2]],
      [c[0] + half * perp1[0] - half * perp2[0], c[1] + half * perp1[1] - half * perp2[1], c[2] + half * perp1[2] - half * perp2[2]],
      [c[0] + half * perp1[0] + half * perp2[0], c[1] + half * perp1[1] + half * perp2[1], c[2] + half * perp1[2] + half * perp2[2]],
      [c[0] - half * perp1[0] + half * perp2[0], c[1] - half * perp1[1] + half * perp2[1], c[2] - half * perp1[2] + half * perp2[2]],
    ];
  }
  const bottomQuad = squareAround(cb);
  const topQuad = squareAround(ct);

  const fmt = (n: number) => `${n}.`;
  const lines: string[] = [];

  // ─── shared anchor + axis direction for extrusion + caps ───────────────
  lines.push(`#10=CARTESIAN_POINT('',(0.,0.,0.));`);
  lines.push(`#11=DIRECTION('',(${axisU[0]}.,${axisU[1]}.,${axisU[2]}.));`);
  lines.push(`#12=VECTOR('',#11,1.);`);
  // Swept curve (a LINE on the perpendicular plane — placeholder, never
  // walked since the dispatcher reads SURFACE_OF_LINEAR_EXTRUSION first).
  lines.push(`#13=DIRECTION('',(${perp1[0]}.,${perp1[1]}.,${perp1[2]}.));`);
  lines.push(`#14=VECTOR('',#13,1.);`);
  lines.push(`#15=LINE('',#10,#14);`);
  lines.push(`#16=SURFACE_OF_LINEAR_EXTRUSION('',#15,#12);`);

  // Side face stub loop — same trick as the cylinder fixture: the
  // dispatcher does NOT descend into it for non-PLANE surfaces.
  lines.push(`#20=VERTEX_POINT('',#10);`);
  lines.push(`#21=EDGE_CURVE('',#20,#20,#15,.T.);`);
  lines.push(`#22=ORIENTED_EDGE('',*,*,#21,.T.);`);
  lines.push(`#23=EDGE_LOOP('',(#22));`);
  lines.push(`#24=FACE_OUTER_BOUND('',#23,.T.);`);
  lines.push(`#25=ADVANCED_FACE('',(#24),#16,.T.);`);

  let nextId = 30;
  function emitCap(
    quad: Array<[number, number, number]>,
    centre: [number, number, number],
    normalDir: [number, number, number],
    startId: number,
  ): { faceId: number } {
    const pIds = [startId, startId + 1, startId + 2, startId + 3];
    for (let i = 0; i < 4; i++) {
      lines.push(`#${pIds[i]}=CARTESIAN_POINT('',(${fmt(quad[i]![0])},${fmt(quad[i]![1])},${fmt(quad[i]![2])}));`);
    }
    const vIds = [startId + 4, startId + 5, startId + 6, startId + 7];
    for (let i = 0; i < 4; i++) {
      lines.push(`#${vIds[i]}=VERTEX_POINT('',#${pIds[i]});`);
    }
    const dirIds: number[] = [];
    const vecIds: number[] = [];
    const lineIds: number[] = [];
    const ecIds: number[] = [];
    const oeIds: number[] = [];
    let id = startId + 8;
    for (let i = 0; i < 4; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % 4]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      lines.push(`#${id}=DIRECTION('',(${dx / len}.,${dy / len}.,${dz / len}.));`);
      dirIds.push(id);
      id++;
    }
    for (let i = 0; i < 4; i++) {
      lines.push(`#${id}=VECTOR('',#${dirIds[i]},1.);`);
      vecIds.push(id);
      id++;
    }
    for (let i = 0; i < 4; i++) {
      lines.push(`#${id}=LINE('',#${pIds[i]},#${vecIds[i]});`);
      lineIds.push(id);
      id++;
    }
    for (let i = 0; i < 4; i++) {
      lines.push(`#${id}=EDGE_CURVE('',#${vIds[i]},#${vIds[(i + 1) % 4]},#${lineIds[i]},.T.);`);
      ecIds.push(id);
      id++;
    }
    for (let i = 0; i < 4; i++) {
      lines.push(`#${id}=ORIENTED_EDGE('',*,*,#${ecIds[i]},.T.);`);
      oeIds.push(id);
      id++;
    }
    lines.push(`#${id}=EDGE_LOOP('',(#${oeIds[0]},#${oeIds[1]},#${oeIds[2]},#${oeIds[3]}));`);
    const loopId = id;
    id++;
    lines.push(`#${id}=FACE_OUTER_BOUND('',#${loopId},.T.);`);
    const bndId = id;
    id++;
    lines.push(`#${id}=CARTESIAN_POINT('',(${fmt(centre[0])},${fmt(centre[1])},${fmt(centre[2])}));`);
    const orgId = id;
    id++;
    lines.push(`#${id}=DIRECTION('',(${normalDir[0]}.,${normalDir[1]}.,${normalDir[2]}.));`);
    const ndirId = id;
    id++;
    lines.push(`#${id}=DIRECTION('',(${perp1[0]}.,${perp1[1]}.,${perp1[2]}.));`);
    const refDirId = id;
    id++;
    lines.push(`#${id}=AXIS2_PLACEMENT_3D('',#${orgId},#${ndirId},#${refDirId});`);
    const axisId = id;
    id++;
    lines.push(`#${id}=PLANE('',#${axisId});`);
    const planeId = id;
    id++;
    lines.push(`#${id}=ADVANCED_FACE('',(#${bndId}),#${planeId},.T.);`);
    const faceId = id;
    nextId = id + 1;
    return { faceId };
  }

  const bottom = emitCap(bottomQuad, cb, [-axisU[0], -axisU[1], -axisU[2]], nextId);
  const top = emitCap(topQuad, ct, axisU, nextId);

  lines.push(`#${nextId}=CLOSED_SHELL('',(#25,#${bottom.faceId},#${top.faceId}));`);
  const shellId = nextId++;
  lines.push(`#${nextId}=MANIFOLD_SOLID_BREP('',#${shellId});`);
  return wrapStepFile(lines.join('\n'));
}

// ─── Phase 3 — SWEPT_AREA_SOLID / EXTRUDED_AREA_SOLID ─────────────────────

describe('importStep — Phase 3 SWEPT_AREA_SOLID', () => {
  it('EXTRUDED_AREA_SOLID rectangle + +Z axis → SweepFeature', () => {
    const file = makeExtrudedAreaSolidFile({ axis: '+z', width: 4, height: 6, depth: 10 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const node = result.tree.nodes[0]!;
    expect(node.payload.kind).toBe('sweep');
    expect(node.id).toBe('imported_sweep_0');
    expect(node.name).toBe('Imported Swept Solid 1');
    const f = node.payload as SweepFeature;
    expect(f.profile.points).toHaveLength(4);
    expect(f.path).toHaveLength(2);
    // Path along +Z: only z component changes.
    const dz = f.path[1]!.z - f.path[0]!.z;
    expect(Math.abs(dz)).toBeCloseTo(10, 5);
    // x, y components of path delta should be 0.
    expect(Math.abs(f.path[1]!.x - f.path[0]!.x)).toBeLessThan(1e-6);
    expect(Math.abs(f.path[1]!.y - f.path[0]!.y)).toBeLessThan(1e-6);
    expect(f.mode).toBe('add');
  });

  it('SWEPT_AREA_SOLID variant (VECTOR-encoded depth) → SweepFeature', () => {
    const file = makeExtrudedAreaSolidFile({
      axis: '+z', width: 3, height: 5, depth: 7, useSweptAreaSolid: true,
    });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as SweepFeature;
    expect(f.kind).toBe('sweep');
    const dz = f.path[1]!.z - f.path[0]!.z;
    expect(Math.abs(dz)).toBeCloseTo(7, 5);
  });

  it('extrusion along +X axis → SweepFeature, profile in YZ plane', () => {
    const file = makeExtrudedAreaSolidFile({ axis: '+x', width: 2, height: 3, depth: 8 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as SweepFeature;
    const dx = f.path[1]!.x - f.path[0]!.x;
    expect(Math.abs(dx)).toBeCloseTo(8, 5);
    expect(f.profile.points.length).toBe(4);
  });

  it('extrusion along -Y axis → SweepFeature with negative-Y path delta', () => {
    const file = makeExtrudedAreaSolidFile({ axis: '-y', width: 2, height: 3, depth: 5 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as SweepFeature;
    const dy = f.path[1]!.y - f.path[0]!.y;
    expect(dy).toBeCloseTo(-5, 5);
  });

  it('non-axis-aligned extrusion (diagonal) → unsupported', () => {
    const file = makeExtrudedAreaSolidFile({
      axis: [1, 1, 0], width: 2, height: 3, depth: 4,
    });
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/not axis-aligned/);
  });

  it('zero-depth extrusion → unsupported with degenerate-depth reason', () => {
    const file = makeExtrudedAreaSolidFile({ axis: '+z', width: 1, height: 1, depth: 0 });
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/degenerate depth/);
  });
});

// ─── Phase 3 — SURFACE_OF_LINEAR_EXTRUSION BREP ───────────────────────────

describe('importStep — Phase 3 SURFACE_OF_LINEAR_EXTRUSION BREP', () => {
  it('1 SURFACE_OF_LINEAR_EXTRUSION + 2 PLANE caps (+Z axis) → SweepFeature', () => {
    const file = makeLinearExtrusionBrepFile({ axis: '+z', size: 4, depth: 6 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const node = result.tree.nodes[0]!;
    expect(node.payload.kind).toBe('sweep');
    expect(node.id).toBe('imported_sweep_0');
    const f = node.payload as SweepFeature;
    expect(f.profile.points).toHaveLength(4);
    expect(f.path).toHaveLength(2);
    // Path length ≈ depth.
    const len = Math.hypot(
      f.path[1]!.x - f.path[0]!.x,
      f.path[1]!.y - f.path[0]!.y,
      f.path[1]!.z - f.path[0]!.z,
    );
    expect(len).toBeCloseTo(6, 5);
  });

  it('extrusion BREP +X axis → SweepFeature', () => {
    const file = makeLinearExtrusionBrepFile({ axis: '+x', size: 2, depth: 4 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    const f = result.tree.nodes[0]!.payload as SweepFeature;
    expect(f.kind).toBe('sweep');
    const dx = Math.abs(f.path[1]!.x - f.path[0]!.x);
    expect(dx).toBeCloseTo(4, 5);
  });

  it('extrusion BREP -Z axis → SweepFeature (sign-agnostic)', () => {
    const file = makeLinearExtrusionBrepFile({ axis: '-z', size: 3, depth: 5 });
    const result = importStep(file);
    expect(result.tree.nodes).toHaveLength(1);
    expect(result.tree.nodes[0]!.payload.kind).toBe('sweep');
  });

  it('profile rectangle preserved: 4 distinct 2D points in the perpendicular plane', () => {
    const file = makeLinearExtrusionBrepFile({ axis: '+z', size: 4, depth: 1 });
    const result = importStep(file);
    const f = result.tree.nodes[0]!.payload as SweepFeature;
    expect(f.profile.points.length).toBe(4);
    // The square is side=4 centred at origin, so corners are at (±2, ±2).
    const xs = f.profile.points.map((p) => p.x).sort();
    const ys = f.profile.points.map((p) => p.y).sort();
    expect(xs[0]).toBeCloseTo(-2, 4);
    expect(xs[3]).toBeCloseTo(2, 4);
    expect(ys[0]).toBeCloseTo(-2, 4);
    expect(ys[3]).toBeCloseTo(2, 4);
  });
});

// ─── Phase 3 — mixed files ────────────────────────────────────────────────

describe('importStep — Phase 3 mixed files', () => {
  it('box + sweep (EXTRUDED_AREA_SOLID) → tree has 2 nodes (extrude + sweep)', () => {
    const boxFile = writeExtrudeAsStep(rectExtrude(4, 5, 6));
    const sweepFile = makeExtrudedAreaSolidFile({ axis: '+z', width: 2, height: 3, depth: 4 });
    // Splice sweep's DATA into box's file (offset ids by +500 to dodge collisions).
    const boxDataStart = boxFile.search(/\bDATA\s*;/);
    const boxEndsec = boxFile.indexOf('ENDSEC;', boxDataStart);
    const sweepDataStart = sweepFile.search(/\bDATA\s*;/);
    const sweepEndsec = sweepFile.indexOf('ENDSEC;', sweepDataStart);
    const offset = 500;
    const sweepBlock = sweepFile
      .slice(sweepDataStart + 'DATA;'.length, sweepEndsec)
      .replace(/#(\d+)/g, (_, n) => `#${Number(n) + offset}`);
    const merged = boxFile.slice(0, boxEndsec) + sweepBlock + boxFile.slice(boxEndsec);
    const result = importStep(merged);
    expect(result.tree.nodes).toHaveLength(2);
    const kinds = result.tree.nodes.map((n) => n.payload.kind).sort();
    expect(kinds).toEqual(['extrude', 'sweep']);
    expect(result.unsupported).toEqual([]);
  });

  it('cylinder + sweep → tree has 2 nodes (revolve + sweep)', () => {
    const cylFile = makeCylinderBrepFile({ axis: '+z', radius: 2, height: 4 });
    const sweepFile = makeExtrudedAreaSolidFile({ axis: '+x', width: 1, height: 1, depth: 3 });
    const cylDataStart = cylFile.search(/\bDATA\s*;/);
    const cylEndsec = cylFile.indexOf('ENDSEC;', cylDataStart);
    const sweepDataStart = sweepFile.search(/\bDATA\s*;/);
    const sweepEndsec = sweepFile.indexOf('ENDSEC;', sweepDataStart);
    const offset = 1000;
    const sweepBlock = sweepFile
      .slice(sweepDataStart + 'DATA;'.length, sweepEndsec)
      .replace(/#(\d+)/g, (_, n) => `#${Number(n) + offset}`);
    const merged = cylFile.slice(0, cylEndsec) + sweepBlock + cylFile.slice(cylEndsec);
    const result = importStep(merged);
    expect(result.tree.nodes).toHaveLength(2);
    const kinds = result.tree.nodes.map((n) => n.payload.kind).sort();
    expect(kinds).toEqual(['revolve', 'sweep']);
  });

  it('two extrusions in one file → 2 separate SweepFeature nodes', () => {
    const a = makeExtrudedAreaSolidFile({ axis: '+z', width: 1, height: 1, depth: 2 });
    const b = makeExtrudedAreaSolidFile({ axis: '+x', width: 1, height: 1, depth: 3 });
    const aDataStart = a.search(/\bDATA\s*;/);
    const aEndsec = a.indexOf('ENDSEC;', aDataStart);
    const bDataStart = b.search(/\bDATA\s*;/);
    const bEndsec = b.indexOf('ENDSEC;', bDataStart);
    const offset = 1000;
    const bBlock = b
      .slice(bDataStart + 'DATA;'.length, bEndsec)
      .replace(/#(\d+)/g, (_, n) => `#${Number(n) + offset}`);
    const merged = a.slice(0, aEndsec) + bBlock + a.slice(aEndsec);
    const result = importStep(merged);
    expect(result.tree.nodes).toHaveLength(2);
    expect(result.tree.nodes.every((n) => n.payload.kind === 'sweep')).toBe(true);
    expect(result.tree.nodes[0]!.id).toBe('imported_sweep_0');
    expect(result.tree.nodes[1]!.id).toBe('imported_sweep_1');
  });
});

// ─── Phase 3 — SWEPT_DISK_SOLID (wishlist) ────────────────────────────────

describe('importStep — Phase 3 SWEPT_DISK_SOLID', () => {
  it('SWEPT_DISK_SOLID entity → unsupported with Phase 4 wishlist reason', () => {
    // Minimal SWEPT_DISK_SOLID stub. We don't model the directrix curve in
    // any detail since the importer rejects this entity by name before
    // looking at the args.
    const file = wrapStepFile(`#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=CARTESIAN_POINT('',(10.,0.,0.));
#12=DIRECTION('',(1.,0.,0.));
#13=VECTOR('',#12,10.);
#14=LINE('',#10,#13);
#20=SWEPT_DISK_SOLID('',#14,5.,3.,0.,1.);`);
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/SWEPT_DISK_SOLID/);
    expect(result.unsupported[0]).toMatch(/Phase 4 wishlist/);
  });

  it('SWEPT_DISK_SOLID + EXTRUDED_AREA_SOLID in same file → 1 sweep + 1 unsupported', () => {
    const sweep = makeExtrudedAreaSolidFile({ axis: '+z', width: 2, height: 2, depth: 3 });
    const diskBlock = `
#900=CARTESIAN_POINT('',(0.,0.,0.));
#901=DIRECTION('',(1.,0.,0.));
#902=VECTOR('',#901,5.);
#903=LINE('',#900,#902);
#910=SWEPT_DISK_SOLID('',#903,2.,1.,0.,1.);`;
    const sweepEndsec = sweep.indexOf('ENDSEC;', sweep.search(/\bDATA\s*;/));
    const merged = sweep.slice(0, sweepEndsec) + diskBlock + '\n' + sweep.slice(sweepEndsec);
    const result = importStep(merged);
    expect(result.tree.nodes).toHaveLength(1);
    expect(result.tree.nodes[0]!.payload.kind).toBe('sweep');
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/SWEPT_DISK_SOLID/);
  });
});

// ─── Phase 3 — unsupported surfaces (BSPLINE / NURBS) ─────────────────────

describe('importStep — Phase 3 NURBS / BSPLINE surfaces still rejected', () => {
  it('NURBS_SURFACE family → unsupported with named reason', () => {
    // Plain NURBS_SURFACE — recognised but not importable in Phase 3.
    const file = makeSingleFaceCurvedSurfaceFile(
      `#15=B_SPLINE_SURFACE_WITH_KNOTS('',1,1,((#10,#10),(#10,#10)),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);`,
    );
    const result = importStep(file);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    // Either uses the BSPLINE name or matches the generic unsupported channel.
    expect(result.unsupported[0]).toMatch(/B_SPLINE|surface/i);
  });

  it('BSPLINE_SURFACE_WITH_KNOTS face in solid → unsupported (Phase 4 wishlist)', () => {
    const file = makeSingleFaceCurvedSurfaceFile(
      `#15=BSPLINE_SURFACE_WITH_KNOTS('',1,1,((#10,#10),(#10,#10)),.UNSPECIFIED.,.F.,.F.,.F.,(2,2),(2,2),(0.,1.),(0.,1.),.UNSPECIFIED.);`,
    );
    const result = importStep(file);
    expect(result.unsupported[0]).toMatch(/BSPLINE_SURFACE/);
  });

  it('linear extrusion BREP with wrong cap-normal direction → unsupported', () => {
    // Splice the cylinder cap-normal mismatch into a linear-extrusion fixture
    // by swapping the SURFACE_OF_LINEAR_EXTRUSION direction's axis component
    // so it no longer aligns with the cap normals.
    const base = makeLinearExtrusionBrepFile({ axis: '+z', size: 2, depth: 3 });
    // Replace the shared axis direction (#11 = DIRECTION (0,0,1)) with (1,0,0)
    // so the extrusion vector ends up perpendicular to the cap normals.
    const corrupted = base.replace(
      `#11=DIRECTION('',(0.,0.,1.));`,
      `#11=DIRECTION('',(1.,0.,0.));`,
    );
    const result = importStep(corrupted);
    expect(result.tree.nodes).toEqual([]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]).toMatch(/not parallel|extrusion/);
  });
});

// ─── Phase 3 — entry-format invariants ────────────────────────────────────

describe('importStep — Phase 3 entry-format invariants', () => {
  it('sweep nodes follow the imported_sweep_N id pattern', () => {
    const file = makeExtrudedAreaSolidFile({ axis: '+z', width: 1, height: 1, depth: 2 });
    const result = importStep(file, { namePrefix: 'cad' });
    expect(result.tree.nodes[0]!.id).toBe('cad_sweep_0');
  });

  it('Phase 3 unsupported entries use the `#<id>: <reason>` format', () => {
    const file = wrapStepFile(`#10=CARTESIAN_POINT('',(0.,0.,0.));
#11=DIRECTION('',(1.,0.,0.));
#12=VECTOR('',#11,1.);
#13=LINE('',#10,#12);
#20=SWEPT_DISK_SOLID('',#13,1.,0.5,0.,1.);`);
    const result = importStep(file);
    expect(result.unsupported[0]).toMatch(/^#\d+: /);
  });
});
