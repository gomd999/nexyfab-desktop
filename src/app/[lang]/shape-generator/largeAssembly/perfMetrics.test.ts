import { describe, it, expect } from 'vitest';
import {
  classifyViolations,
  PerfTracker,
  DEFAULT_BUDGET,
  type PerformanceMetrics,
} from './perfMetrics';

function sample(frameMs: number, drawCalls = 100, vertexCount = 100_000): PerformanceMetrics {
  return { frameMs, drawCalls, vertexCount, triangleCount: vertexCount / 2, timestamp: 0 };
}

describe('classifyViolations', () => {
  it('returns empty for within-budget sample', () => {
    expect(classifyViolations(sample(16))).toEqual([]);
  });

  it('flags frame-ms violation', () => {
    const v = classifyViolations(sample(50));
    expect(v.some(x => x.code === 'frame-ms')).toBe(true);
  });

  it('flags draw-calls violation', () => {
    const v = classifyViolations(sample(10, 3000));
    expect(v.some(x => x.code === 'draw-calls')).toBe(true);
  });

  it('flags vertices violation', () => {
    const v = classifyViolations(sample(10, 100, 10_000_000));
    expect(v.some(x => x.code === 'vertices')).toBe(true);
  });

  it('reports excess fraction relative to budget', () => {
    const v = classifyViolations(sample(66));
    const frameV = v.find(x => x.code === 'frame-ms');
    expect(frameV?.excess).toBeCloseTo(66 / DEFAULT_BUDGET.maxFrameMs, 2);
  });
});

describe('PerfTracker · rolling stats', () => {
  it('EMA frame time approaches the supplied values', () => {
    const t = new PerfTracker(10);
    for (let i = 0; i < 100; i++) t.push(sample(20));
    expect(t.stats().emaFrameMs).toBeCloseTo(20, 1);
  });

  it('tracks max frame time across the session', () => {
    const t = new PerfTracker();
    t.push(sample(10));
    t.push(sample(50));
    t.push(sample(15));
    expect(t.stats().maxFrameMs).toBe(50);
  });

  it('count grows with every push', () => {
    const t = new PerfTracker();
    expect(t.stats().count).toBe(0);
    t.push(sample(10));
    t.push(sample(15));
    expect(t.stats().count).toBe(2);
  });

  it('reset clears the window', () => {
    const t = new PerfTracker();
    t.push(sample(20));
    t.push(sample(40));
    t.reset();
    expect(t.stats().count).toBe(0);
    expect(t.stats().maxFrameMs).toBe(0);
  });
});

describe('PerfTracker · over-budget detection', () => {
  it('isOverBudget returns false when all samples are under budget', () => {
    const t = new PerfTracker();
    for (let i = 0; i < 10; i++) t.push(sample(16));
    expect(t.isOverBudget(5)).toBe(false);
  });

  it('isOverBudget returns true within lookback window', () => {
    const t = new PerfTracker();
    for (let i = 0; i < 4; i++) t.push(sample(16));
    t.push(sample(50)); // last one over budget
    expect(t.isOverBudget(5)).toBe(true);
  });

  it('isOverBudget ignores violations outside lookback', () => {
    const t = new PerfTracker();
    t.push(sample(50)); // very old
    for (let i = 0; i < 10; i++) t.push(sample(16));
    expect(t.isOverBudget(5)).toBe(false);
  });

  it('lastViolations updates with the most recent push', () => {
    const t = new PerfTracker();
    t.push(sample(20));
    expect(t.lastViolations).toHaveLength(0);
    t.push(sample(50));
    expect(t.lastViolations.length).toBeGreaterThan(0);
  });
});

describe('PerfTracker · custom budget', () => {
  it('respects per-tracker budget override', () => {
    const tight = new PerfTracker(60, { ...DEFAULT_BUDGET, maxFrameMs: 10 });
    tight.push(sample(15));
    expect(tight.lastViolations[0]?.code).toBe('frame-ms');
  });
});
