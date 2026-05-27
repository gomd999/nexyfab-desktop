import { describe, it, expect } from 'vitest';
import {
  computeClearance,
  checkToolReach,
  summarize,
  type ClearanceInput,
} from './clearancePlaneCalculator';

function baseInput(): ClearanceInput {
  return {
    partTopZ: 20,
    partBottomZ: 0,
    stockTopZ: 25,
    stockBottomZ: -2,
    fixtures: [],
  };
}

describe('computeClearance', () => {
  it('clearance plane sits above stock and fixtures', () => {
    const r = computeClearance(baseInput(), { clearancePlaneMm: 10 });
    expect(r.clearancePlaneZ).toBeGreaterThan(25);
  });

  it('feed plane is above stock', () => {
    const r = computeClearance(baseInput(), { feedPlaneMm: 2 });
    expect(r.feedPlaneZ).toBe(27);
  });

  it('cut start is below part top by offset', () => {
    const r = computeClearance(baseInput(), { cutStartOffsetMm: 0.5 });
    expect(r.cutStartZ).toBe(19.5);
  });

  it('cut end is above part bottom by offset', () => {
    const r = computeClearance(baseInput(), { cutEndOffsetMm: 0.5 });
    expect(r.cutEndZ).toBe(0.5);
  });

  it('cutting depth is the difference between cut start and end', () => {
    const r = computeClearance(baseInput());
    expect(r.cuttingDepthMm).toBeCloseTo(19, 5);
  });

  it('fixture above clearance triggers warning', () => {
    const input: ClearanceInput = { ...baseInput(), fixtures: [{ id: 'clamp', topZ: 40 }] };
    const r = computeClearance(input, { clearancePlaneMm: 5 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('uses tallest fixture', () => {
    const input: ClearanceInput = {
      ...baseInput(),
      fixtures: [{ id: 'a', topZ: 30 }, { id: 'b', topZ: 50 }],
    };
    const r = computeClearance(input);
    expect(r.worstFixtureZ).toBe(50);
  });

  it('no fixtures → null worst fixture', () => {
    const r = computeClearance(baseInput());
    expect(r.worstFixtureZ).toBeNull();
  });

  it('stock thinner than part triggers warning', () => {
    const input: ClearanceInput = { ...baseInput(), stockBottomZ: 5 };
    const r = computeClearance(input);
    expect(r.warnings.some(w => w.includes('Stock bottom'))).toBe(true);
  });

  it('cut start ≤ cut end triggers warning', () => {
    const input: ClearanceInput = { ...baseInput(), partTopZ: 0, partBottomZ: 10 };
    const r = computeClearance(input);
    expect(r.warnings.some(w => w.includes('Cut start'))).toBe(true);
  });
});

describe('checkToolReach', () => {
  it('reports tip reach Z = spindle - tool length', () => {
    const r = computeClearance(baseInput());
    const tool = { toolLengthMm: 50, holderLengthMm: 25 };
    const tr = checkToolReach(r, tool, 60);
    expect(tr.tipReachableZ).toBe(10);
  });

  it('reachesAllCuts true when tip below cutEndZ', () => {
    const r = computeClearance(baseInput());
    const tool = { toolLengthMm: 100, holderLengthMm: 25 };
    const tr = checkToolReach(r, tool, 60);
    expect(tr.reachesAllCuts).toBe(true);
  });

  it('reachesAllCuts false when tip stays above cutEndZ', () => {
    const r = computeClearance(baseInput());
    const tool = { toolLengthMm: 10, holderLengthMm: 5 };
    const tr = checkToolReach(r, tool, 60);
    expect(tr.reachesAllCuts).toBe(false);
  });

  it('holder crash risk flagged when holder near cut end', () => {
    const r = computeClearance(baseInput());
    const tool = { toolLengthMm: 60, holderLengthMm: 60 };
    const tr = checkToolReach(r, tool, 60);
    expect(tr.holderCrashRisk).toBe(true);
  });
});

describe('summarize', () => {
  it('reports cutting depth', () => {
    const r = computeClearance(baseInput());
    const s = summarize(r);
    expect(s.cuttingDepthMm).toBeCloseTo(19, 5);
  });

  it('total air space is clearance - feed', () => {
    const r = computeClearance(baseInput(), { clearancePlaneMm: 10, feedPlaneMm: 2 });
    const s = summarize(r);
    expect(s.totalAirSpaceMm).toBeCloseTo(8, 5);
  });

  it('detects fixture warning', () => {
    const input: ClearanceInput = { ...baseInput(), fixtures: [{ id: 'c', topZ: 100 }] };
    const r = computeClearance(input, { clearancePlaneMm: 5 });
    const s = summarize(r);
    expect(s.hasFixtureWarning).toBe(true);
  });

  it('counts warnings', () => {
    const input: ClearanceInput = { ...baseInput(), partTopZ: 0, partBottomZ: 10 };
    const r = computeClearance(input);
    const s = summarize(r);
    expect(s.warningCount).toBeGreaterThan(0);
  });
});
