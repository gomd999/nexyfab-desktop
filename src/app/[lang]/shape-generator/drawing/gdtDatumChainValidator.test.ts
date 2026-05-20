import { describe, it, expect } from 'vitest';
import {
  validateDatumChains,
  datumUsage,
  suggestPriority,
  summarize,
  type DatumFeature,
  type FeatureControlFrame,
} from './gdtDatumChainValidator';

function datum(letter: string, type: DatumFeature['featureType'] = 'plane', declared: boolean = true): DatumFeature {
  return { letter, featureType: type, declared };
}

function fcf(id: string, symbol: string, datums: { letter: string; modifier?: 'MMC' | 'LMC' | 'RFS' }[], appliedToFOS: boolean = true): FeatureControlFrame {
  return { id, symbol, toleranceMm: 0.1, datums, appliedToFOS };
}

describe('validateDatumChains', () => {
  it('empty inputs → empty issues', () => {
    const r = validateDatumChains([], []);
    expect(r.issues).toEqual([]);
  });

  it('full A|B|C frame → 6 DOF', () => {
    const datums = [datum('A'), datum('B'), datum('C')];
    const fcfs = [fcf('f1', 'position', [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }])];
    const r = validateDatumChains(datums, fcfs);
    expect(r.dofPerFcf['f1']).toBe(6);
    expect(r.fullFramePerFcf['f1']).toBe(true);
  });

  it('primary only → 3 DOF', () => {
    const r = validateDatumChains([datum('A')], [fcf('f1', 'perpendicularity', [{ letter: 'A' }])]);
    expect(r.dofPerFcf['f1']).toBe(3);
  });

  it('duplicate datum letter → error', () => {
    const r = validateDatumChains(
      [datum('A')],
      [fcf('f1', 'position', [{ letter: 'A' }, { letter: 'A' }])],
    );
    expect(r.issues.some(i => i.message.includes('twice'))).toBe(true);
  });

  it('undeclared datum → error', () => {
    const r = validateDatumChains(
      [datum('A')],
      [fcf('f1', 'position', [{ letter: 'A' }, { letter: 'X' }])],
    );
    expect(r.issues.some(i => i.message.includes('not declared'))).toBe(true);
  });

  it('material modifier on non-FOS datum → error', () => {
    const r = validateDatumChains(
      [datum('A', 'plane')],
      [fcf('f1', 'position', [{ letter: 'A', modifier: 'MMC' }])],
    );
    expect(r.issues.some(i => i.message.includes('Material modifier'))).toBe(true);
  });

  it('material modifier on FOS datum → OK', () => {
    const r = validateDatumChains(
      [datum('A', 'feature-of-size')],
      [fcf('f1', 'position', [{ letter: 'A', modifier: 'MMC' }])],
    );
    expect(r.issues.filter(i => i.severity === 'error').length).toBe(0);
  });

  it('position with insufficient DOF → warn', () => {
    const r = validateDatumChains(
      [datum('A')],
      [fcf('f1', 'position', [{ letter: 'A' }])],
    );
    expect(r.issues.some(i => i.severity === 'warn' && i.message.includes('DOF'))).toBe(true);
  });
});

describe('datumUsage', () => {
  it('counts primary/secondary/tertiary slots', () => {
    const datums = [datum('A'), datum('B'), datum('C')];
    const fcfs = [
      fcf('f1', 'position', [{ letter: 'A' }, { letter: 'B' }]),
      fcf('f2', 'perpendicularity', [{ letter: 'A' }, { letter: 'C' }]),
    ];
    const usage = datumUsage(datums, fcfs);
    const a = usage.find(u => u.letter === 'A')!;
    expect(a.asPrimary).toBe(2);
    expect(a.total).toBe(2);
  });

  it('empty for unused letters', () => {
    const usage = datumUsage([datum('A')], []);
    expect(usage[0]!.total).toBe(0);
  });
});

describe('suggestPriority', () => {
  it('planes before features of size before axes before points', () => {
    const order = suggestPriority([
      datum('P', 'point'),
      datum('A', 'axis'),
      datum('F', 'feature-of-size'),
      datum('L', 'plane'),
    ]);
    expect(order[0]).toBe('L');
    expect(order[3]).toBe('P');
  });
});

describe('summarize', () => {
  it('counts errors + full frames', () => {
    const datums = [datum('A'), datum('B'), datum('C')];
    const fcfs = [fcf('f1', 'position', [{ letter: 'A' }, { letter: 'B' }, { letter: 'C' }])];
    const r = validateDatumChains(datums, fcfs);
    const s = summarize(r, fcfs.length);
    expect(s.fcfCount).toBe(1);
    expect(s.fullFrameCount).toBe(1);
    expect(s.errorCount).toBe(0);
  });

  it('counts undeclared datums', () => {
    const r = validateDatumChains([datum('A')], [fcf('f1', 'position', [{ letter: 'X' }])]);
    expect(summarize(r, 1).undeclaredDatumCount).toBeGreaterThan(0);
  });
});
