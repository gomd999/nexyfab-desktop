import { describe, it, expect } from 'vitest';
import {
  analyzeFleet,
  jobLevelCost,
  pickReplacementCandidates,
  summarize,
  type JobRecord,
} from './toolAverageWear';

function rec(jobId: string, toolId: string, cutMin: number, wear: number, cost: number, abnormal?: boolean): JobRecord {
  const r: JobRecord = { jobId, toolId, cuttingMin: cutMin, wearFraction: wear, costUsd: cost };
  if (abnormal !== undefined) r.abnormal = abnormal;
  return r;
}

describe('analyzeFleet', () => {
  it('empty records → empty result', () => {
    const r = analyzeFleet([]);
    expect(r.toolStates).toEqual([]);
    expect(r.totalToolingCostUsd).toBe(0);
  });

  it('per-tool wear accumulates', () => {
    const records = [
      rec('J1', 'T1', 10, 0.2, 5),
      rec('J2', 'T1', 5, 0.1, 3),
    ];
    const r = analyzeFleet(records);
    const t1 = r.toolStates.find(s => s.toolId === 'T1')!;
    expect(t1.totalCuttingMin).toBe(15);
    expect(t1.totalWearFraction).toBeCloseTo(0.3, 5);
  });

  it('average wear rate = totalWear / totalMin', () => {
    const records = [rec('J1', 'T1', 10, 0.2, 1)];
    const r = analyzeFleet(records);
    expect(r.toolStates[0]!.averageWearRate).toBeCloseTo(0.02, 5);
  });

  it('remainingMin computed from wear rate', () => {
    const records = [rec('J1', 'T1', 10, 0.5, 1)]; // 50% used over 10 min, 50% remaining at same rate = 10 min.
    const r = analyzeFleet(records);
    expect(r.toolStates[0]!.remainingMin).toBeCloseTo(10, 1);
  });

  it('needsReplacement when wear ≥ 1.0', () => {
    const records = [rec('J1', 'T1', 10, 1.1, 5)];
    const r = analyzeFleet(records);
    expect(r.toolStates[0]!.needsReplacement).toBe(true);
  });

  it('replacementSchedule sorted by remaining ascending', () => {
    const records = [
      rec('J1', 'T1', 10, 0.9, 1),
      rec('J2', 'T2', 10, 0.5, 1),
    ];
    const r = analyzeFleet(records);
    expect(r.replacementSchedule[0]!.toolId).toBe('T1');
  });

  it('outlier flagged when wear rate > 2× fleet average', () => {
    const records = [
      rec('J1', 'T1', 10, 0.05, 1),
      rec('J2', 'T2', 10, 0.05, 1),
      rec('J3', 'T3', 10, 0.05, 1),
      rec('J4', 'BAD', 10, 0.5, 1), // 10× the others
    ];
    const r = analyzeFleet(records);
    expect(r.outlierToolIds).toContain('BAD');
  });

  it('total tooling cost = sum', () => {
    const records = [
      rec('J1', 'T1', 1, 0.1, 5),
      rec('J2', 'T2', 1, 0.1, 7),
    ];
    expect(analyzeFleet(records).totalToolingCostUsd).toBe(12);
  });

  it('counts unique jobs', () => {
    const records = [
      rec('J1', 'T1', 1, 0.1, 1),
      rec('J1', 'T2', 1, 0.1, 1),
      rec('J2', 'T1', 1, 0.1, 1),
    ];
    expect(analyzeFleet(records).totalJobCount).toBe(2);
  });
});

describe('jobLevelCost', () => {
  it('groups by job', () => {
    const records = [
      rec('J1', 'T1', 1, 0.1, 5),
      rec('J1', 'T2', 1, 0.1, 7),
      rec('J2', 'T1', 1, 0.1, 3),
    ];
    const out = jobLevelCost(records);
    expect(out).toHaveLength(2);
  });

  it('sorted by cost desc', () => {
    const records = [
      rec('cheap', 'T1', 1, 0.1, 1),
      rec('expensive', 'T2', 1, 0.1, 100),
    ];
    const out = jobLevelCost(records);
    expect(out[0]!.jobId).toBe('expensive');
  });

  it('counts abnormal runs', () => {
    const records = [
      rec('J1', 'T1', 1, 0.1, 5, true),
      rec('J1', 'T2', 1, 0.1, 5, false),
    ];
    expect(jobLevelCost(records)[0]!.abnormalRunCount).toBe(1);
  });
});

describe('pickReplacementCandidates', () => {
  it('returns N tools needing soonest replacement', () => {
    const records = [
      rec('J1', 'T1', 10, 0.9, 1),
      rec('J2', 'T2', 10, 0.5, 1),
      rec('J3', 'T3', 10, 0.1, 1),
    ];
    const r = analyzeFleet(records);
    const candidates = pickReplacementCandidates(r, 2);
    expect(candidates).toHaveLength(2);
    expect(candidates[0]!.toolId).toBe('T1');
  });
});

describe('summarize', () => {
  it('reports tool count, job count, replace count', () => {
    const records = [
      rec('J1', 'T1', 10, 1.0, 1),
      rec('J2', 'T2', 10, 0.5, 1),
    ];
    const s = summarize(analyzeFleet(records));
    expect(s.toolCount).toBe(2);
    expect(s.jobCount).toBe(2);
    expect(s.toolsNeedingReplacement).toBe(1);
  });

  it('shortestRemainingMin reported', () => {
    const records = [rec('J1', 'T1', 10, 0.9, 1)];
    const s = summarize(analyzeFleet(records));
    expect(s.shortestRemainingMin).toBeGreaterThan(0);
    expect(s.shortestRemainingMin).toBeLessThan(Infinity);
  });
});
