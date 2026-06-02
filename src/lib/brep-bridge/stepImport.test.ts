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
