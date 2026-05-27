import { describe, it, expect } from 'vitest';
import {
  generateMacros,
  emitWcsUpdate,
  summarize,
  type FeatureSpec,
} from './probeMacroGenerator';

function feature(cycle: FeatureSpec['cycle'], size?: number, tol: number = 0.05): FeatureSpec {
  const f: FeatureSpec = {
    cycle,
    point: { x: 0, y: 0, z: 0 },
    toleranceMm: tol,
  };
  if (size !== undefined) f.sizeMm = size;
  return f;
}

describe('generateMacros (renishaw)', () => {
  it('empty input → empty output', () => {
    expect(generateMacros([])).toEqual([]);
  });

  it('face-z emits G65 P9811 Z', () => {
    const r = generateMacros([feature('face-z')]);
    expect(r[0]!.gcode[0]).toMatch(/G65 P9811 Z/);
  });

  it('bore-3point emits G65 P9814', () => {
    const r = generateMacros([feature('bore-3point', 25)]);
    expect(r[0]!.gcode[0]).toMatch(/G65 P9814 D25/);
  });

  it('boss-3point emits G65 P9823', () => {
    const r = generateMacros([feature('boss-3point', 30)]);
    expect(r[0]!.gcode[0]).toMatch(/G65 P9823/);
  });

  it('pocket-4point emits G65 P9812', () => {
    const r = generateMacros([feature('pocket-4point', 40)]);
    expect(r[0]!.gcode[0]).toMatch(/G65 P9812/);
  });

  it('corner-2point emits G65 P9815', () => {
    const r = generateMacros([feature('corner-2point')]);
    expect(r[0]!.gcode[0]).toMatch(/G65 P9815/);
  });

  it('result vars populated', () => {
    const r = generateMacros([feature('bore-3point', 25)]);
    expect(r[0]!.resultVars.length).toBeGreaterThan(0);
  });
});

describe('generateMacros (heidenhain)', () => {
  it('face-z emits TCH PROBE 412', () => {
    const r = generateMacros([feature('face-z')], { dialect: 'heidenhain', approachFeed: 1000, touchFeed: 100, clearanceMm: 3 });
    expect(r[0]!.gcode[0]).toMatch(/TCH PROBE 412/);
  });

  it('bore emits TCH PROBE 421', () => {
    const r = generateMacros([feature('bore-3point', 25)], { dialect: 'heidenhain', approachFeed: 1000, touchFeed: 100, clearanceMm: 3 });
    expect(r[0]!.gcode.join('\n')).toMatch(/TCH PROBE 421/);
  });

  it('result vars Q### populated', () => {
    const r = generateMacros([feature('bore-3point', 25)], { dialect: 'heidenhain', approachFeed: 1000, touchFeed: 100, clearanceMm: 3 });
    expect(r[0]!.resultVars[0]).toMatch(/^Q/);
  });
});

describe('generateMacros (mazak)', () => {
  it('emits Mazak comment + Renishaw body', () => {
    const r = generateMacros([feature('face-z')], { dialect: 'mazak', approachFeed: 1000, touchFeed: 100, clearanceMm: 3 });
    expect(r[0]!.gcode[0]).toMatch(/MAZAK/);
    expect(r[0]!.gcode[1]).toMatch(/G65 P9811/);
  });
});

describe('emitWcsUpdate', () => {
  it('no wcs offset → no lines', () => {
    expect(emitWcsUpdate(feature('face-z'), '#138')).toEqual([]);
  });

  it('G54 → P1', () => {
    const lines = emitWcsUpdate({ ...feature('face-z'), wcsOffset: 'G54' }, '#138');
    expect(lines[0]).toContain('P1');
  });

  it('G56 → P3', () => {
    const lines = emitWcsUpdate({ ...feature('face-z'), wcsOffset: 'G56' }, '#138');
    expect(lines[0]).toContain('P3');
  });
});

describe('summarize', () => {
  it('counts by cycle', () => {
    const blocks = generateMacros([feature('face-z'), feature('bore-3point', 10)]);
    const s = summarize(blocks);
    expect(s.byCycle['face-z']).toBe(1);
    expect(s.byCycle['bore-3point']).toBe(1);
  });

  it('total line count', () => {
    const blocks = generateMacros([feature('face-z'), feature('bore-3point', 10)]);
    expect(summarize(blocks).totalLineCount).toBeGreaterThan(0);
  });
});
