/**
 * Tests for sketchDxfImport — DXF → SketchEntities parsing + export round-trip.
 *
 * Mirrors the structure of sketchDxfExport.test.ts and sketchSvgImport.test.ts:
 * each public-facing behavior gets a small focused case, plus a handful of
 * end-to-end round-trip exercises that pin down the contract with the exporter.
 *
 * DXF is a line-pair format; building fixtures by string concat is more
 * legible than threading group-code constants through every test, so we
 * use small inline helpers (`mk*` builders) to assemble valid pairs.
 */
import { describe, it, expect } from 'vitest';
import { importSketchFromDxf } from './sketchDxfImport';
import { exportSketchToDxf, type SketchEntities } from './sketchDxfExport';

/**
 * Round a number to 4 decimals so floating-point noise from deg↔rad
 * conversion doesn't make round-trip assertions fragile. Mirrors the
 * helper in sketchSvgImport.test.ts.
 */
const r4 = (n: number): number => {
  const v = Math.round(n * 1e4) / 1e4;
  return Object.is(v, -0) ? 0 : v;
};

/** Build a DXF document with the supplied ENTITIES body and optional units. */
function mkDxf(
  entitiesBody: string,
  opts: { units?: 'mm' | 'inch' } = {},
): string {
  const headerUnits = opts.units === undefined
    ? ''
    : `9\n$INSUNITS\n70\n${opts.units === 'mm' ? 4 : 1}\n`;
  return (
    '0\nSECTION\n2\nHEADER\n' +
    headerUnits +
    '0\nENDSEC\n' +
    '0\nSECTION\n2\nENTITIES\n' +
    entitiesBody +
    '0\nENDSEC\n' +
    '0\nEOF\n'
  );
}

const empty: SketchEntities = { points: [], lines: [], circles: [], arcs: [] };

// ─── input validation ───────────────────────────────────────────────────

describe('importSketchFromDxf — input validation', () => {
  it('rejects empty input', () => {
    const r = importSketchFromDxf('');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/);
    expect(r.entities).toBeUndefined();
  });

  it('rejects whitespace-only input', () => {
    const r = importSketchFromDxf('   \n\t  ');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/empty/);
  });

  it('rejects input too short to contain any pair', () => {
    const r = importSketchFromDxf('0');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/too short|no valid group/);
  });

  it('rejects input with no parseable group records', () => {
    // Every "code" line is non-integer — no valid pairs at all.
    const r = importSketchFromDxf('abc\ndef\nghi\njkl\n');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no valid group/);
  });
});

// ─── empty entities ─────────────────────────────────────────────────────

describe('importSketchFromDxf — empty entities', () => {
  it('empty ENTITIES section yields empty entity arrays', () => {
    const dxf = mkDxf('');
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities).toEqual(empty);
  });

  it('absent ENTITIES section yields ok=true with empty entities + warning', () => {
    const dxf =
      '0\nSECTION\n2\nHEADER\n0\nENDSEC\n' +
      '0\nEOF\n';
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities).toEqual(empty);
    expect(r.warnings.some((w) => /no ENTITIES section/i.test(w))).toBe(true);
  });
});

// ─── POINT ──────────────────────────────────────────────────────────────

describe('importSketchFromDxf — POINT', () => {
  it('parses a single POINT', () => {
    const dxf = mkDxf('0\nPOINT\n8\n0\n10\n3.5\n20\n-4.5\n30\n0.0\n');
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(1);
    expect(r.entities?.points[0]).toMatchObject({ x: 3.5, y: -4.5 });
  });

  it('synthesizes a non-empty id for the point', () => {
    const dxf = mkDxf('0\nPOINT\n10\n1\n20\n2\n');
    const r = importSketchFromDxf(dxf);
    expect(r.entities?.points[0].id).toMatch(/\S+/);
  });

  it('warns and skips a POINT missing required coords', () => {
    const dxf = mkDxf('0\nPOINT\n8\n0\n10\n3.0\n'); // 20 missing
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(0);
    expect(r.warnings.some((w) => /POINT/.test(w))).toBe(true);
  });
});

// ─── LINE ───────────────────────────────────────────────────────────────

describe('importSketchFromDxf — LINE', () => {
  it('parses a single LINE with 10/20 start and 11/21 end', () => {
    const dxf = mkDxf(
      '0\nLINE\n8\n0\n10\n1.0\n20\n2.0\n30\n0.0\n11\n3.0\n21\n4.0\n31\n0.0\n',
    );
    const r = importSketchFromDxf(dxf);
    expect(r.entities?.lines).toHaveLength(1);
    expect(r.entities?.lines[0]).toMatchObject({ x1: 1, y1: 2, x2: 3, y2: 4 });
  });

  it('LINE gets synthesized p1/p2 placeholder ids', () => {
    const dxf = mkDxf(
      '0\nLINE\n10\n0\n20\n0\n11\n1\n21\n1\n',
    );
    const r = importSketchFromDxf(dxf);
    const ln = r.entities?.lines[0];
    expect(ln?.p1).toBe(`${ln?.id}.p1`);
    expect(ln?.p2).toBe(`${ln?.id}.p2`);
  });
});

// ─── CIRCLE ─────────────────────────────────────────────────────────────

describe('importSketchFromDxf — CIRCLE', () => {
  it('parses a single CIRCLE with center + radius', () => {
    const dxf = mkDxf('0\nCIRCLE\n8\n0\n10\n5\n20\n-2\n40\n7.25\n');
    const r = importSketchFromDxf(dxf);
    expect(r.entities?.circles).toHaveLength(1);
    expect(r.entities?.circles[0]).toMatchObject({ cx: 5, cy: -2, radius: 7.25 });
  });

  it('warns and skips a CIRCLE with non-positive radius', () => {
    const dxf = mkDxf('0\nCIRCLE\n10\n0\n20\n0\n40\n0\n');
    const r = importSketchFromDxf(dxf);
    expect(r.entities?.circles).toHaveLength(0);
    expect(r.warnings.some((w) => /radius/.test(w))).toBe(true);
  });
});

// ─── ARC (deg → rad) ────────────────────────────────────────────────────

describe('importSketchFromDxf — ARC', () => {
  it('converts degrees → radians for start/end angles', () => {
    // start=0°, end=90° → 0, π/2
    const dxf = mkDxf(
      '0\nARC\n8\n0\n10\n0\n20\n0\n40\n10\n50\n0\n51\n90\n',
    );
    const r = importSketchFromDxf(dxf);
    expect(r.entities?.arcs).toHaveLength(1);
    const arc = r.entities!.arcs[0];
    expect(r4(arc.startAngle)).toBe(0);
    expect(r4(arc.endAngle)).toBe(r4(Math.PI / 2));
    expect(arc.radius).toBe(10);
  });

  it('handles 270° start (wraps from the exporter normalization)', () => {
    // Exporter writes -π/2 rad → 270°. Importer should read 270° → 3π/2 rad.
    const dxf = mkDxf(
      '0\nARC\n10\n0\n20\n0\n40\n1\n50\n270\n51\n0\n',
    );
    const r = importSketchFromDxf(dxf);
    const arc = r.entities!.arcs[0];
    expect(r4(arc.startAngle)).toBe(r4((3 * Math.PI) / 2));
    expect(r4(arc.endAngle)).toBe(0);
  });

  it('warns and skips an ARC missing the radius', () => {
    const dxf = mkDxf('0\nARC\n10\n0\n20\n0\n50\n0\n51\n90\n');
    const r = importSketchFromDxf(dxf);
    expect(r.entities?.arcs).toHaveLength(0);
    expect(r.warnings.some((w) => /ARC/.test(w))).toBe(true);
  });
});

// ─── $INSUNITS ──────────────────────────────────────────────────────────

describe('importSketchFromDxf — $INSUNITS', () => {
  it('recovers mm from $INSUNITS=4', () => {
    const dxf = mkDxf('', { units: 'mm' });
    const r = importSketchFromDxf(dxf);
    expect(r.units).toBe('mm');
  });

  it('recovers inch from $INSUNITS=1', () => {
    const dxf = mkDxf('', { units: 'inch' });
    const r = importSketchFromDxf(dxf);
    expect(r.units).toBe('inch');
  });

  it('leaves units undefined when header omits $INSUNITS', () => {
    const dxf = mkDxf('');
    const r = importSketchFromDxf(dxf);
    expect(r.units).toBeUndefined();
  });

  it('warns and leaves units undefined for unknown $INSUNITS code', () => {
    // 6 = meters — not supported in our pipeline.
    const dxf =
      '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n' +
      '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n' +
      '0\nEOF\n';
    const r = importSketchFromDxf(dxf);
    expect(r.units).toBeUndefined();
    expect(r.warnings.some((w) => /\$INSUNITS=6|not supported/.test(w))).toBe(true);
  });
});

// ─── unsupported entities ───────────────────────────────────────────────

describe('importSketchFromDxf — unsupported entities', () => {
  it('LWPOLYLINE produces a warning, no entity', () => {
    const dxf = mkDxf('0\nLWPOLYLINE\n8\n0\n70\n0\n10\n0\n20\n0\n10\n1\n20\n1\n');
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities?.lines).toHaveLength(0);
    expect(r.warnings.some((w) => /LWPOLYLINE/.test(w))).toBe(true);
  });

  it('SPLINE produces a warning', () => {
    const dxf = mkDxf('0\nSPLINE\n8\n0\n');
    const r = importSketchFromDxf(dxf);
    expect(r.warnings.some((w) => /SPLINE/.test(w))).toBe(true);
  });

  it('ELLIPSE produces a warning', () => {
    const dxf = mkDxf('0\nELLIPSE\n8\n0\n');
    const r = importSketchFromDxf(dxf);
    expect(r.warnings.some((w) => /ELLIPSE/.test(w))).toBe(true);
  });

  it('TEXT produces a warning', () => {
    const dxf = mkDxf('0\nTEXT\n1\nhello\n');
    const r = importSketchFromDxf(dxf);
    expect(r.warnings.some((w) => /TEXT/.test(w))).toBe(true);
  });

  it('unknown entity type produces a generic warning', () => {
    const dxf = mkDxf('0\nFOOBAR\n8\n0\n');
    const r = importSketchFromDxf(dxf);
    expect(r.warnings.some((w) => /FOOBAR|unknown/.test(w))).toBe(true);
  });
});

// ─── tolerance ─────────────────────────────────────────────────────────

describe('importSketchFromDxf — tolerance', () => {
  it('accepts CRLF line endings', () => {
    const dxf = mkDxf('0\nPOINT\n10\n1\n20\n2\n').replace(/\n/g, '\r\n');
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(1);
  });

  it('accepts CR-only line endings (classic Mac legacy)', () => {
    const dxf = mkDxf('0\nPOINT\n10\n1\n20\n2\n').replace(/\n/g, '\r');
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(1);
  });

  it('strips leading whitespace from group code columns', () => {
    // Some legacy exporters left-pad codes to 3 columns for visual alignment.
    const dxf =
      '  0\nSECTION\n  2\nENTITIES\n' +
      '  0\nPOINT\n 10\n5\n 20\n6\n' +
      '  0\nENDSEC\n  0\nEOF\n';
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities?.points[0]).toMatchObject({ x: 5, y: 6 });
  });

  it('warns about a malformed group code but continues parsing', () => {
    const dxf =
      '0\nSECTION\n2\nENTITIES\n' +
      'NOTACODE\nGARBAGE\n' + // bad pair: 'NOTACODE' isn't a number
      '0\nPOINT\n10\n7\n20\n8\n' +
      '0\nENDSEC\n0\nEOF\n';
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(1);
    expect(r.entities?.points[0]).toMatchObject({ x: 7, y: 8 });
    expect(r.warnings.some((w) => /malformed/i.test(w))).toBe(true);
  });

  it('tolerates missing ENDSEC at EOF (recovers entities)', () => {
    // Unterminated ENTITIES section.
    const dxf =
      '0\nSECTION\n2\nENTITIES\n' +
      '0\nPOINT\n10\n1\n20\n2\n' +
      '0\nEOF\n';
    const r = importSketchFromDxf(dxf);
    expect(r.ok).toBe(true);
    expect(r.entities?.points).toHaveLength(1);
  });
});

// ─── mixed entities & ordering ─────────────────────────────────────────

describe('importSketchFromDxf — mixed entities', () => {
  it('parses all four entity types in one document', () => {
    const body =
      '0\nCIRCLE\n10\n0\n20\n0\n40\n3\n' +
      '0\nARC\n10\n0\n20\n0\n40\n4\n50\n0\n51\n180\n' +
      '0\nLINE\n10\n0\n20\n0\n11\n5\n21\n5\n' +
      '0\nPOINT\n10\n1\n20\n2\n';
    const r = importSketchFromDxf(mkDxf(body));
    expect(r.entities?.circles).toHaveLength(1);
    expect(r.entities?.arcs).toHaveLength(1);
    expect(r.entities?.lines).toHaveLength(1);
    expect(r.entities?.points).toHaveLength(1);
  });

  it('ignores entities outside the ENTITIES section', () => {
    // POINT records inside HEADER must be ignored entirely.
    const dxf =
      '0\nSECTION\n2\nHEADER\n0\nPOINT\n10\n99\n20\n99\n0\nENDSEC\n' +
      '0\nSECTION\n2\nENTITIES\n0\nPOINT\n10\n1\n20\n2\n0\nENDSEC\n' +
      '0\nEOF\n';
    const r = importSketchFromDxf(dxf);
    expect(r.entities?.points).toHaveLength(1);
    expect(r.entities?.points[0]).toMatchObject({ x: 1, y: 2 });
  });

  it('ignores entities inside the TABLES section', () => {
    const dxf =
      '0\nSECTION\n2\nTABLES\n' +
      '0\nTABLE\n2\nLAYER\n70\n1\n0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n0\nENDTAB\n' +
      '0\nENDSEC\n' +
      '0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n10\n0\n20\n0\n40\n1\n0\nENDSEC\n' +
      '0\nEOF\n';
    const r = importSketchFromDxf(dxf);
    // LAYER records inside TABLES should NOT show up as entities.
    expect(r.entities?.points).toHaveLength(0);
    expect(r.entities?.lines).toHaveLength(0);
    expect(r.entities?.circles).toHaveLength(1);
  });
});

// ─── round-trip ────────────────────────────────────────────────────────

describe('importSketchFromDxf ↔ exportSketchToDxf round-trip', () => {
  it('round-trips a single point', () => {
    const original: SketchEntities = {
      points: [{ id: 'p1', x: 3.25, y: -7.5 }],
      lines: [], circles: [], arcs: [],
    };
    const dxf = exportSketchToDxf(original);
    const back = importSketchFromDxf(dxf);
    expect(back.ok).toBe(true);
    expect(back.entities?.points).toHaveLength(1);
    expect(back.entities?.points[0]).toMatchObject({ x: 3.25, y: -7.5 });
  });

  it('round-trips a single line', () => {
    const original: SketchEntities = {
      points: [],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 10, y2: 20 }],
      circles: [], arcs: [],
    };
    const dxf = exportSketchToDxf(original);
    const back = importSketchFromDxf(dxf);
    expect(back.entities?.lines).toHaveLength(1);
    expect(back.entities?.lines[0]).toMatchObject({ x1: 0, y1: 0, x2: 10, y2: 20 });
  });

  it('round-trips a single circle', () => {
    const original: SketchEntities = {
      points: [], lines: [],
      circles: [{ id: 'c1', cx: 5, cy: -2, radius: 7.25 }],
      arcs: [],
    };
    const dxf = exportSketchToDxf(original);
    const back = importSketchFromDxf(dxf);
    expect(back.entities?.circles).toHaveLength(1);
    expect(back.entities?.circles[0]).toMatchObject({ cx: 5, cy: -2, radius: 7.25 });
  });

  it('round-trips a single arc (rad → deg → rad)', () => {
    // Use angles in [0, 2π) so the exporter's normalize-to-[0,360°) is a no-op.
    const original: SketchEntities = {
      points: [], lines: [], circles: [],
      arcs: [{
        id: 'a1', cx: 0, cy: 0, radius: 10,
        startAngle: 0, endAngle: Math.PI / 2,
      }],
    };
    const dxf = exportSketchToDxf(original);
    const back = importSketchFromDxf(dxf);
    expect(back.entities?.arcs).toHaveLength(1);
    const arc = back.entities!.arcs[0];
    expect(r4(arc.startAngle)).toBe(0);
    expect(r4(arc.endAngle)).toBe(r4(Math.PI / 2));
    expect(arc.cx).toBe(0);
    expect(arc.cy).toBe(0);
    expect(arc.radius).toBe(10);
  });

  it('round-trips a mixed sketch with all four entity types', () => {
    const original: SketchEntities = {
      points: [
        { id: 'p1', x: 0, y: 0 },
        { id: 'p2', x: 10, y: 10 },
      ],
      lines: [
        { id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 10, y2: 10 },
      ],
      circles: [
        { id: 'c1', cx: 5, cy: 5, radius: 2.5 },
      ],
      arcs: [
        { id: 'a1', cx: 0, cy: 0, radius: 3, startAngle: 0, endAngle: Math.PI },
      ],
    };
    const dxf = exportSketchToDxf(original);
    const back = importSketchFromDxf(dxf);
    expect(back.ok).toBe(true);
    expect(back.entities?.points).toHaveLength(2);
    expect(back.entities?.lines).toHaveLength(1);
    expect(back.entities?.circles).toHaveLength(1);
    expect(back.entities?.arcs).toHaveLength(1);
    // Coordinates preserved exactly (exporter rounds to 6 decimals, we
    // re-parse the strings as floats — no further loss).
    expect(back.entities?.points[0]).toMatchObject({ x: 0, y: 0 });
    expect(back.entities?.points[1]).toMatchObject({ x: 10, y: 10 });
    expect(back.entities?.circles[0]).toMatchObject({ cx: 5, cy: 5, radius: 2.5 });
  });

  it('round-trip preserves units when emitted as mm', () => {
    const dxf = exportSketchToDxf(empty, { units: 'mm' });
    const back = importSketchFromDxf(dxf);
    expect(back.units).toBe('mm');
  });

  it('round-trip preserves units when emitted as inch', () => {
    const dxf = exportSketchToDxf(empty, { units: 'inch' });
    const back = importSketchFromDxf(dxf);
    expect(back.units).toBe('inch');
  });

  it('round-trip yields no warnings for clean exporter output', () => {
    const original: SketchEntities = {
      points: [{ id: 'p1', x: 1, y: 2 }],
      lines: [{ id: 'l1', p1: 'p1', p2: 'p2', x1: 0, y1: 0, x2: 5, y2: 5 }],
      circles: [{ id: 'c1', cx: 0, cy: 0, radius: 3 }],
      arcs: [{ id: 'a1', cx: 0, cy: 0, radius: 4, startAngle: 0, endAngle: 1 }],
    };
    const dxf = exportSketchToDxf(original);
    const back = importSketchFromDxf(dxf);
    expect(back.warnings).toEqual([]);
  });

  it('round-trip preserves coordinate precision to 6 decimals (exporter rounding)', () => {
    const original: SketchEntities = {
      points: [{ id: 'p1', x: 1.234567, y: -9.876543 }],
      lines: [], circles: [], arcs: [],
    };
    const dxf = exportSketchToDxf(original);
    const back = importSketchFromDxf(dxf);
    const p = back.entities!.points[0];
    expect(Math.abs(p.x - 1.234567)).toBeLessThan(1e-6);
    expect(Math.abs(p.y - (-9.876543))).toBeLessThan(1e-6);
  });
});
