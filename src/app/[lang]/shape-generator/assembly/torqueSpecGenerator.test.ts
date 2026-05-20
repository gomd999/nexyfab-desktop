import { describe, it, expect } from 'vitest';
import {
  generateTorqueSpecs,
  rollup,
  formatNoteTable,
  summarize,
  METRIC_SIZES,
  PROOF_STRENGTH_MPA,
  type FastenerEntry,
} from './torqueSpecGenerator';

function fast(id: string, size: FastenerEntry['size'], cls: FastenerEntry['propertyClass'], count: number = 1, joint: FastenerEntry['joint'] = 'through-bolt', lub: FastenerEntry['lubrication'] = 'dry'): FastenerEntry {
  return { id, size, propertyClass: cls, count, joint, lubrication: lub };
}

describe('METRIC_SIZES', () => {
  it('M6 has 6 mm nominal', () => {
    expect(METRIC_SIZES.M6.nominalDiameterMm).toBe(6);
  });

  it('M10 stress area is 58 mm²', () => {
    expect(METRIC_SIZES.M10.stressAreaMm2).toBeCloseTo(58, 1);
  });
});

describe('PROOF_STRENGTH_MPA', () => {
  it('10.9 > 8.8', () => {
    expect(PROOF_STRENGTH_MPA['10.9']).toBeGreaterThan(PROOF_STRENGTH_MPA['8.8']);
  });
});

describe('generateTorqueSpecs', () => {
  it('M6 8.8 dry → ~10 N·m', () => {
    const s = generateTorqueSpecs([fast('f1', 'M6', '8.8')]);
    expect(s[0]!.torqueNm).toBeGreaterThan(7);
    expect(s[0]!.torqueNm).toBeLessThan(20);
  });

  it('lubricated < dry torque for same preload', () => {
    const dry = generateTorqueSpecs([fast('a', 'M6', '8.8', 1, 'through-bolt', 'dry')]);
    const lub = generateTorqueSpecs([fast('b', 'M6', '8.8', 1, 'through-bolt', 'lubricated')]);
    expect(lub[0]!.torqueNm).toBeLessThan(dry[0]!.torqueNm);
  });

  it('property class scales torque', () => {
    const c88 = generateTorqueSpecs([fast('a', 'M6', '8.8')]);
    const c109 = generateTorqueSpecs([fast('b', 'M6', '10.9')]);
    expect(c109[0]!.torqueNm).toBeGreaterThan(c88[0]!.torqueNm);
  });

  it('larger thread → higher torque', () => {
    const m4 = generateTorqueSpecs([fast('a', 'M4', '8.8')]);
    const m12 = generateTorqueSpecs([fast('b', 'M12', '8.8')]);
    expect(m12[0]!.torqueNm).toBeGreaterThan(m4[0]!.torqueNm);
  });

  it('gasketed joint uses lower preload fraction', () => {
    const std = generateTorqueSpecs([fast('a', 'M8', '8.8', 1, 'through-bolt')]);
    const gasket = generateTorqueSpecs([fast('b', 'M8', '8.8', 1, 'gasketed')]);
    expect(gasket[0]!.preloadFractionOfProof).toBeLessThan(std[0]!.preloadFractionOfProof);
  });

  it('anti-vibration joint uses higher preload fraction', () => {
    const av = generateTorqueSpecs([fast('a', 'M8', '8.8', 1, 'anti-vibration')]);
    expect(av[0]!.preloadFractionOfProof).toBeGreaterThan(0.8);
  });

  it('warns on gasketed dry', () => {
    const s = generateTorqueSpecs([fast('a', 'M8', '8.8', 1, 'gasketed', 'dry')]);
    expect(s[0]!.warning).toBeDefined();
  });

  it('nut factor differs by lubrication', () => {
    const a = generateTorqueSpecs([fast('1', 'M6', '8.8', 1, 'through-bolt', 'dry')]);
    const b = generateTorqueSpecs([fast('2', 'M6', '8.8', 1, 'through-bolt', 'anti-seize')]);
    expect(a[0]!.nutFactor).toBeGreaterThan(b[0]!.nutFactor);
  });
});

describe('rollup', () => {
  it('totals across counts', () => {
    const fs = [fast('a', 'M6', '8.8', 4), fast('b', 'M8', '8.8', 2)];
    const specs = generateTorqueSpecs(fs);
    const r = rollup(fs, specs);
    expect(r.totalFasteners).toBe(6);
    expect(r.bySize.M6).toBe(4);
    expect(r.bySize.M8).toBe(2);
  });

  it('total torque scales with count', () => {
    const fs = [fast('a', 'M6', '8.8', 10)];
    const specs = generateTorqueSpecs(fs);
    const r = rollup(fs, specs);
    expect(r.totalTorqueWorkNm).toBeCloseTo(specs[0]!.torqueNm * 10, 5);
  });
});

describe('formatNoteTable', () => {
  it('has header + N rows', () => {
    const specs = generateTorqueSpecs([fast('a', 'M6', '8.8'), fast('b', 'M8', '8.8')]);
    const lines = formatNoteTable(specs);
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('header includes SIZE', () => {
    const specs = generateTorqueSpecs([fast('a', 'M6', '8.8')]);
    expect(formatNoteTable(specs)[0]).toContain('SIZE');
  });
});

describe('summarize', () => {
  it('reports max and min', () => {
    const specs = generateTorqueSpecs([fast('a', 'M4', '8.8'), fast('b', 'M12', '12.9')]);
    const s = summarize(specs);
    expect(s.maxTorqueNm).toBeGreaterThan(s.minTorqueNm);
  });

  it('empty → zeros', () => {
    const s = summarize([]);
    expect(s.fastenerCount).toBe(0);
    expect(s.maxTorqueNm).toBe(0);
  });

  it('warningCount tallies', () => {
    const specs = generateTorqueSpecs([fast('a', 'M8', '8.8', 1, 'gasketed', 'dry')]);
    expect(summarize(specs).warningCount).toBe(1);
  });
});
