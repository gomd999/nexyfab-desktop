/**
 * gate2d.test.ts — proves the 2D drawing gate READS a drawing faithfully (round-trip PASS) and
 * CATCHES a wrong interpretation (tampered dimension / missing circle / wrong entity count), and
 * returns `unavailable` — never a fabricated pass — when the drawing carries no measurable evidence.
 *
 * Fixtures are self-authored ASCII DXF (no third-party CAD binaries): a rectangular plate
 * (100 x 60 mm, 4 LINEs) with 2 circles (r 5) and 2 DIMENSION entities (100, 60).
 */

import { describe, it, expect } from 'vitest';
import { dxfToIr2d, roundTripVerify2d } from './ingestDxf2d';
import { verify2dReconstruction } from './gate2d';
import { normalizeIr2d, type Ir2d } from './schema2d';

const g = (code: number, val: string | number) => `${code}\n${val}\n`;

/** A rectangular plate: 100x60 mm, 2 circles r5, 2 dimensions. Declares mm + 3 layers. */
function platteDxf(): string {
  let s = '';
  s += g(0, 'SECTION') + g(2, 'HEADER') + g(9, '$ACADVER') + g(1, 'AC1009') + g(9, '$INSUNITS') + g(70, 4) + g(0, 'ENDSEC');
  s += g(0, 'SECTION') + g(2, 'TABLES') + g(0, 'TABLE') + g(2, 'LAYER') + g(70, 3);
  for (const n of ['PLATE', 'HOLES', 'DIM']) s += g(0, 'LAYER') + g(2, n) + g(70, 0) + g(62, 7) + g(6, 'CONTINUOUS');
  s += g(0, 'ENDTAB') + g(0, 'ENDSEC');
  let e = '';
  // rectangle 0,0 -> 100,60 as 4 LINEs
  const c: Array<[number, number]> = [[0, 0], [100, 0], [100, 60], [0, 60]];
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = c[i]; const [x2, y2] = c[(i + 1) % 4];
    e += g(0, 'LINE') + g(8, 'PLATE') + g(10, x1) + g(20, y1) + g(30, 0) + g(11, x2) + g(21, y2) + g(31, 0);
  }
  // 2 holes r5
  e += g(0, 'CIRCLE') + g(8, 'HOLES') + g(10, 25) + g(20, 30) + g(30, 0) + g(40, 5);
  e += g(0, 'CIRCLE') + g(8, 'HOLES') + g(10, 75) + g(20, 30) + g(30, 0) + g(40, 5);
  // 2 dimensions (horizontal 100, vertical 60)
  e += g(0, 'DIMENSION') + g(8, 'DIM') + g(70, 0) + g(50, 0) + g(42, 100) + g(1, '100');
  e += g(0, 'DIMENSION') + g(8, 'DIM') + g(70, 0) + g(50, 90) + g(42, 60) + g(1, '60');
  s += g(0, 'SECTION') + g(2, 'ENTITIES') + e + g(0, 'ENDSEC') + g(0, 'EOF');
  return s;
}

/** A drawing with no dimensions, no circles, no bounded geometry — only a TEXT note. */
function noEvidenceDxf(): string {
  let s = '';
  s += g(0, 'SECTION') + g(2, 'HEADER') + g(0, 'ENDSEC');
  s += g(0, 'SECTION') + g(2, 'ENTITIES');
  s += g(0, 'TEXT') + g(8, '0') + g(1, 'GENERAL NOTES: WELD ALL SEAMS');
  s += g(0, 'ENDSEC') + g(0, 'EOF');
  return s;
}

describe('ingestDxf2d — extracts honest 2D evidence', () => {
  it('extracts dims, circles, extents, counts, units, layers', async () => {
    const r = await dxfToIr2d(platteDxf());
    expect(r.ok).toBe(true);
    const ir = r.ir2d!;
    expect(ir.units).toBe('mm');
    expect(ir.dimensions.map((d) => d.value).sort((a, b) => a - b)).toEqual([60, 100]);
    expect(ir.circles.map((c) => c.r)).toEqual([5, 5]);
    expect(ir.extents).toEqual({ w: 100, h: 60 });
    expect(ir.entityCounts).toMatchObject({ LINE: 4, CIRCLE: 2, DIMENSION: 2 });
    expect(ir.layers).toEqual(expect.arrayContaining(['PLATE', 'HOLES', 'DIM']));
  });

  it('records units:null + an approximation when units are undeclared', async () => {
    const r = await dxfToIr2d(noEvidenceDxf());
    expect(r.ok).toBe(true);
    expect(r.ir2d!.units).toBe(null);
    expect(r.ir2d!.approximations.some((a) => a.includes('units undeclared'))).toBe(true);
  });
});

describe('gate2d — faithful round-trip PASSES', () => {
  it('re-emits and re-extracts the plate with zero mismatches', async () => {
    const src = (await dxfToIr2d(platteDxf())).ir2d!;
    const v = await roundTripVerify2d(src);
    expect(v.status).toBe('pass');
    expect(v.mismatches).toBe(0);
    expect(v.score).toBe(1);
    expect(v.checks.find((c) => c.name === 'dimensions')?.passed).toBe(true);
    expect(v.checks.find((c) => c.name === 'circle_radii')?.passed).toBe(true);
    expect(v.checks.find((c) => c.name === 'extents')?.passed).toBe(true);
    expect(v.checks.find((c) => c.name === 'entity_counts')?.passed).toBe(true);
  });
});

describe('gate2d — catches a wrong interpretation', () => {
  let src: Ir2d;
  it('setup', async () => { src = (await dxfToIr2d(platteDxf())).ir2d!; expect(src).toBeTruthy(); });

  it('FAILS a tampered dimension value (100 -> 120) with a dimensions mismatch', async () => {
    src = (await dxfToIr2d(platteDxf())).ir2d!;
    const bad = normalizeIr2d({ ...src, dimensions: [{ value: 120, text: '120' }, { value: 60, text: '60' }] });
    const v = verify2dReconstruction(bad, src);
    expect(v.status).toBe('fail');
    expect(v.checks.find((c) => c.name === 'dimensions')?.passed).toBe(false);
    expect(v.feedback).toContain('Dimension values differ');
  });

  it('FAILS a missing circle (drops one hole) with a circle_radii mismatch', async () => {
    src = (await dxfToIr2d(platteDxf())).ir2d!;
    const bad = normalizeIr2d({ ...src, circles: [{ r: 5 }] });
    const v = verify2dReconstruction(bad, src);
    expect(v.status).toBe('fail');
    expect(v.checks.find((c) => c.name === 'circle_radii')?.passed).toBe(false);
    expect(v.feedback).toContain('Circle radii differ');
  });

  it('FAILS a wrong entity count (claims 6 LINEs) with an entity_counts mismatch', async () => {
    src = (await dxfToIr2d(platteDxf())).ir2d!;
    const bad = normalizeIr2d({ ...src, entityCounts: { ...src.entityCounts, LINE: 6 } });
    const v = verify2dReconstruction(bad, src);
    expect(v.status).toBe('fail');
    expect(v.checks.find((c) => c.name === 'entity_counts')?.passed).toBe(false);
    expect(v.feedback).toContain('Entity-type counts differ');
  });
});

describe('gate2d — no evidence is UNAVAILABLE, not a fake pass', () => {
  it('returns unavailable with a reason when the drawing has no dims/circles/extents', async () => {
    const src = (await dxfToIr2d(noEvidenceDxf())).ir2d!;
    const v = await roundTripVerify2d(src);
    expect(v.status).toBe('unavailable');
    expect(v.status).not.toBe('pass');
    expect(v.reason).toBeTruthy();
    expect(v.feedback).toContain('UNAVAILABLE');
  });
});
