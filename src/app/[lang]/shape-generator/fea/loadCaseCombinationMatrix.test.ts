import { describe, it, expect } from 'vitest';
import {
  buildMatrix,
  evaluateCombination,
  summarize,
  type BaseLoadCase,
} from './loadCaseCombinationMatrix';

const dl: BaseLoadCase = { id: 'DL1', kind: 'dead', magnitude: 100 };
const ll: BaseLoadCase = { id: 'LL1', kind: 'live', magnitude: 50 };
const wind: BaseLoadCase = { id: 'W1', kind: 'wind', magnitude: 30 };
const snow: BaseLoadCase = { id: 'SN1', kind: 'snow', magnitude: 20 };
const seismic: BaseLoadCase = { id: 'EQ1', kind: 'seismic', magnitude: 40 };
const press: BaseLoadCase = { id: 'P1', kind: 'pressure', magnitude: 200 };

describe('buildMatrix', () => {
  it('eurocode-uls with DL+LL → at least one row', () => {
    const m = buildMatrix([dl, ll], 'eurocode-uls');
    expect(m.rows.length).toBeGreaterThan(0);
    expect(m.rows.every(r => r.state === 'ULS')).toBe(true);
  });

  it('factor 1.35 for DL in eurocode-uls', () => {
    const m = buildMatrix([dl, ll], 'eurocode-uls');
    const row1 = m.rows.find(r => r.id === 'EC-ULS-1')!;
    expect(row1.factors['DL1']).toBeCloseTo(1.35, 3);
  });

  it('aisc-lrfd 1.4·DL only when DL alone', () => {
    const m = buildMatrix([dl], 'aisc-lrfd');
    expect(m.rows.some(r => r.id === 'LRFD-1')).toBe(true);
  });

  it('aisc-lrfd 1.2DL+1.6LL combination', () => {
    const m = buildMatrix([dl, ll], 'aisc-lrfd');
    const row = m.rows.find(r => r.id === 'LRFD-2')!;
    expect(row.factors['DL1']).toBeCloseTo(1.2, 3);
    expect(row.factors['LL1']).toBeCloseTo(1.6, 3);
  });

  it('aisc-lrfd wind combination present', () => {
    const m = buildMatrix([dl, ll, wind], 'aisc-lrfd');
    expect(m.rows.some(r => r.id === 'LRFD-3')).toBe(true);
  });

  it('aisc-lrfd seismic combination present', () => {
    const m = buildMatrix([dl, seismic], 'aisc-lrfd');
    expect(m.rows.some(r => r.id === 'LRFD-4')).toBe(true);
  });

  it('eurocode-sls has SLS state', () => {
    const m = buildMatrix([dl, ll], 'eurocode-sls');
    expect(m.rows.every(r => r.state === 'SLS')).toBe(true);
  });

  it('eurocode-uls snow combination', () => {
    const m = buildMatrix([dl, snow], 'eurocode-uls');
    expect(m.rows.some(r => r.id === 'EC-ULS-3')).toBe(true);
  });

  it('aisc-asd uses allowable state', () => {
    const m = buildMatrix([dl, ll], 'aisc-asd');
    expect(m.rows.every(r => r.state === 'allowable')).toBe(true);
  });

  it('asme-allowable for DL + pressure', () => {
    const m = buildMatrix([dl, press], 'asme-allowable');
    expect(m.rows.some(r => r.id === 'ASME-1')).toBe(true);
  });

  it('empty cases → empty rows', () => {
    const m = buildMatrix([], 'eurocode-uls');
    expect(m.rows).toEqual([]);
  });
});

describe('evaluateCombination', () => {
  it('1.35·100 + 1.5·50 = 210', () => {
    const m = buildMatrix([dl, ll], 'eurocode-uls');
    const value = evaluateCombination(m, 'EC-ULS-1');
    expect(value).toBeCloseTo(1.35 * 100 + 1.5 * 50, 3);
  });

  it('unknown combination → 0', () => {
    const m = buildMatrix([dl], 'aisc-lrfd');
    expect(evaluateCombination(m, 'BOGUS')).toBe(0);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const m = buildMatrix([dl, ll, wind], 'eurocode-uls');
    const s = summarize(m);
    expect(s.baseCaseCount).toBe(3);
    expect(s.combinationCount).toBe(m.rows.length);
    expect(s.ulsCount).toBe(m.rows.length);
  });

  it('SLS count tracked', () => {
    const m = buildMatrix([dl, ll], 'eurocode-sls');
    expect(summarize(m).slsCount).toBeGreaterThan(0);
  });
});
