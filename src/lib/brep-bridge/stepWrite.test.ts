/**
 * stepWrite — header / DATA section / ExtrudeFeature roundtrip tests.
 *
 * Phase 1 BOX-only writer (see ./stepWrite.ts module JSDoc for limits).
 */
import { describe, it, expect } from 'vitest';
import {
  writeStepHeader,
  writeStepEntities,
  writeExtrudeAsStep,
} from './stepWrite';
import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';

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

describe('writeStepHeader', () => {
  it('starts with ISO-10303-21; marker', () => {
    const out = writeStepHeader();
    expect(out.startsWith('ISO-10303-21;')).toBe(true);
  });

  it('contains a HEADER section terminated by ENDSEC', () => {
    const out = writeStepHeader();
    expect(out).toContain('HEADER;');
    expect(out).toContain('ENDSEC;');
    // HEADER must appear before its closing ENDSEC.
    expect(out.indexOf('HEADER;')).toBeLessThan(out.indexOf('ENDSEC;'));
  });

  it('embeds FILE_DESCRIPTION / FILE_NAME / FILE_SCHEMA records', () => {
    const out = writeStepHeader();
    expect(out).toContain('FILE_DESCRIPTION(');
    expect(out).toContain('FILE_NAME(');
    expect(out).toContain('FILE_SCHEMA(');
  });

  it('uses the NEXYFAB-PRO application string', () => {
    const out = writeStepHeader();
    expect(out).toContain('NEXYFAB-PRO');
  });

  it('respects authorName / organization / description / filename / timestamp', () => {
    const out = writeStepHeader({
      authorName: 'Ada Lovelace',
      organization: 'NexyFab QA',
      description: 'Phase 5 minimal box export',
      filename: 'cube.step',
      timestamp: '2026-06-01T00:00:00Z',
    });
    expect(out).toContain('Ada Lovelace');
    expect(out).toContain('NexyFab QA');
    expect(out).toContain('Phase 5 minimal box export');
    expect(out).toContain('cube.step');
    expect(out).toContain('2026-06-01T00:00:00Z');
  });

  it('escapes single quotes in caller-supplied strings', () => {
    const out = writeStepHeader({ authorName: "O'Reilly" });
    // STEP doubles single quotes inside literals.
    expect(out).toContain("O''Reilly");
  });
});

describe('writeStepEntities', () => {
  it('emits DATA; opener and ENDSEC; closer', () => {
    const out = writeStepEntities({
      boxes: [{ name: 'unit', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }],
    });
    expect(out).toContain('DATA;');
    expect(out).toContain('ENDSEC;');
    // (Spec uses ENDSEC; for both header and data terminators — we emit it as
    // END_DATA; equivalent by reusing ENDSEC. Verify END-marker for full file
    // via writeExtrudeAsStep / explicit roundtrip below.)
  });

  it('produces a MANIFOLD_SOLID_BREP and CLOSED_SHELL entity', () => {
    const out = writeStepEntities({
      boxes: [{ name: 'unit', x0: 0, y0: 0, z0: 0, x1: 2, y1: 3, z1: 4 }],
    });
    expect(out).toContain('MANIFOLD_SOLID_BREP');
    expect(out).toContain('CLOSED_SHELL');
    expect(out).toContain('ADVANCED_FACE');
    expect(out).toContain('EDGE_LOOP');
    expect(out).toContain('VERTEX_POINT');
    expect(out).toContain('CARTESIAN_POINT');
  });

  it('emits one PRODUCT entity per box', () => {
    const out = writeStepEntities({
      boxes: [
        { name: 'a', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 },
        { name: 'b', x0: 0, y0: 0, z0: 0, x1: 2, y1: 2, z1: 2 },
      ],
    });
    // Each PRODUCT line includes its name in quotes.
    expect(out).toMatch(/PRODUCT\('a','a'/);
    expect(out).toMatch(/PRODUCT\('b','b'/);
  });

  it('assigns unique #N ids to every entity', () => {
    const out = writeStepEntities({
      boxes: [{ name: 'unit', x0: 0, y0: 0, z0: 0, x1: 1, y1: 1, z1: 1 }],
    });
    const ids = Array.from(out.matchAll(/^#(\d+)=/gm)).map((m) => Number(m[1]));
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('throws on a degenerate box (zero or negative extent)', () => {
    expect(() =>
      writeStepEntities({
        boxes: [{ name: 'bad', x0: 0, y0: 0, z0: 0, x1: 0, y1: 1, z1: 1 }],
      }),
    ).toThrow(/degenerate/);
  });

  it('throws on an empty box list', () => {
    expect(() => writeStepEntities({ boxes: [] })).toThrow(/at least one box/);
  });
});

describe('writeExtrudeAsStep', () => {
  it('produces a complete STEP for a 10×5 rect × depth 7', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));

    // Contains the canonical solid entity.
    expect(out).toMatch(/MANIFOLD_SOLID_BREP|ADVANCED_BREP_SHAPE_REPRESENTATION/);

    // BOX-only writer should use both, actually.
    expect(out).toContain('MANIFOLD_SOLID_BREP');
    expect(out).toContain('ADVANCED_BREP_SHAPE_REPRESENTATION');
  });

  it('starts with ISO-10303-21; and ends with END-ISO-10303-21;', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    expect(out.startsWith('ISO-10303-21;')).toBe(true);
    expect(out.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });

  it('embeds the bounding-box dimensions as cartesian coordinates', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    // bbox = (0,0,0) → (10,5,7). Expect those extrema to surface as
    // CARTESIAN_POINT coordinate triples (formatter emits trailing '.').
    expect(out).toContain('(10.,5.,7.)');
    expect(out).toContain('(0.,0.,0.)');
  });

  it('uses the loop bounding box even for non-rectangular profiles', () => {
    const triangleExtrude: ExtrudeFeature = {
      kind: 'extrude',
      loop: [
        { x: -3, y: -2 },
        { x: 5, y: -2 },
        { x: 1, y: 6 },
      ],
      depth: 4,
      direction: 'one_sided',
      mode: 'add',
    };
    const out = writeExtrudeAsStep(triangleExtrude);
    // BBox extrema → CARTESIAN_POINT coords (sign formatting: '-3.' literal).
    expect(out).toContain('(-3.,-2.,0.)');
    expect(out).toContain('(5.,6.,4.)');
  });

  it('forwards header options to the file header', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7), {
      authorName: 'NexyFab CI',
      productName: 'phase5-box',
    });
    expect(out).toContain('NexyFab CI');
    expect(out).toContain("PRODUCT('phase5-box','phase5-box'");
  });

  it('rejects non-extrude feature payloads', () => {
    const bogus = { kind: 'revolve' } as unknown as ExtrudeFeature;
    expect(() => writeExtrudeAsStep(bogus)).toThrow(/expected kind='extrude'/);
  });

  it('rejects loops with fewer than 3 points', () => {
    const bogus: ExtrudeFeature = {
      kind: 'extrude',
      loop: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      depth: 5,
      direction: 'one_sided',
      mode: 'add',
    };
    expect(() => writeExtrudeAsStep(bogus)).toThrow(/at least 3 points/);
  });

  it('rejects non-positive depth', () => {
    const bogus: ExtrudeFeature = {
      ...rectExtrude(10, 5, 7),
      depth: 0,
    };
    expect(() => writeExtrudeAsStep(bogus)).toThrow(/depth must be positive/);
  });
});

describe('roundtrip — regex-parse the writer output', () => {
  it('exposes all four required Part 21 markers in canonical order', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    const iso = out.indexOf('ISO-10303-21;');
    const header = out.indexOf('HEADER;');
    const data = out.indexOf('DATA;');
    const end = out.indexOf('END-ISO-10303-21;');

    expect(iso).toBe(0);
    expect(header).toBeGreaterThan(iso);
    expect(data).toBeGreaterThan(header);
    expect(end).toBeGreaterThan(data);
  });

  it('every #N reference resolves to a defined entity', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    // Collect all entity definitions ("#N=…").
    const defined = new Set<number>();
    for (const m of out.matchAll(/^#(\d+)=/gm)) {
      defined.add(Number(m[1]));
    }
    expect(defined.size).toBeGreaterThan(0);

    // Collect all entity references ("#N" outside definitions).
    const dataSection = out.slice(out.indexOf('DATA;'));
    const refs = new Set<number>();
    for (const m of dataSection.matchAll(/#(\d+)/g)) {
      refs.add(Number(m[1]));
    }
    for (const r of refs) {
      expect(defined.has(r)).toBe(true);
    }
  });

  it('emits exactly one MANIFOLD_SOLID_BREP for a single-feature extrude', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    const matches = out.match(/MANIFOLD_SOLID_BREP/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('emits exactly 6 ADVANCED_FACE entities for a single box', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    const matches = out.match(/ADVANCED_FACE\(/g) ?? [];
    expect(matches.length).toBe(6);
  });

  it('emits exactly 8 VERTEX_POINT entities for a single box', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    const matches = out.match(/VERTEX_POINT\(/g) ?? [];
    expect(matches.length).toBe(8);
  });

  it('emits exactly 12 EDGE_CURVE entities for a single box', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    const matches = out.match(/EDGE_CURVE\(/g) ?? [];
    expect(matches.length).toBe(12);
  });

  it('each ORIENTED_EDGE carries an explicit orientation flag', () => {
    const out = writeExtrudeAsStep(rectExtrude(10, 5, 7));
    const matches = out.match(/ORIENTED_EDGE\([^)]*\.[TF]\.\)/g) ?? [];
    // 6 faces × 4 edges each.
    expect(matches.length).toBe(24);
  });
});
