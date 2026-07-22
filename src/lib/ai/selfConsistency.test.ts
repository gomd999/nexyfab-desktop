/**
 * selfConsistency.test — lever B wrapper. Deterministic: `runOnce` is a mock
 * that returns controlled variations (no live LLM, no cost). Pins the honesty
 * contract: agreement = confidence, disagreement is surfaced (low confidence),
 * never averaged into a false consensus; runs=1 is a strict no-op.
 */
import { describe, it, expect, vi } from 'vitest';
import { runSelfConsistent } from './selfConsistency';

interface Shape {
  shapeId: string;
  width: number;
  height: number;
}

const project = (s: Shape) => ({ shapeId: s.shapeId, width: s.width, height: s.height });

/** A mock that returns the queued results in order, one per call. */
function scriptedRunner<T>(...results: T[]): () => Promise<T> {
  let i = 0;
  return async () => {
    const r = results[Math.min(i, results.length - 1)];
    i++;
    return r;
  };
}

describe('runSelfConsistent — runs=1 is a strict no-op', () => {
  it('calls runOnce exactly once, confidence 1 for every field, no low-confidence, value passed through', async () => {
    const runOnce = vi.fn(scriptedRunner<Shape>({ shapeId: 'box', width: 50, height: 20 }));
    const res = await runSelfConsistent(runOnce, { project }); // runs defaults to 1

    expect(runOnce).toHaveBeenCalledTimes(1); // zero extra cost
    expect(res.runsUsed).toBe(1);
    expect(res.value).toEqual({ shapeId: 'box', width: 50, height: 20 });
    expect(res.confidence).toEqual({ shapeId: 1, width: 1, height: 1 });
    expect(res.lowConfidenceFields).toEqual([]);
  });

  it('runs=0 or negative is clamped to a single no-op call', async () => {
    const runOnce = vi.fn(scriptedRunner<Shape>({ shapeId: 'box', width: 1, height: 2 }));
    const res = await runSelfConsistent(runOnce, { project, runs: 0 });
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(res.runsUsed).toBe(1);
  });
});

describe('runSelfConsistent — full agreement', () => {
  it('3 identical runs => every field confidence 1, the agreed value is chosen', async () => {
    const runOnce = vi.fn(
      scriptedRunner<Shape>(
        { shapeId: 'box', width: 50, height: 20 },
        { shapeId: 'box', width: 50, height: 20 },
        { shapeId: 'box', width: 50, height: 20 },
      ),
    );
    const res = await runSelfConsistent(runOnce, { project, runs: 3 });

    expect(runOnce).toHaveBeenCalledTimes(3);
    expect(res.runsUsed).toBe(3);
    expect(res.confidence).toEqual({ shapeId: 1, width: 1, height: 1 });
    expect(res.lowConfidenceFields).toEqual([]);
    expect(res.value).toEqual({ shapeId: 'box', width: 50, height: 20 });
  });
});

describe('runSelfConsistent — one field disagrees', () => {
  it('the stable fields stay high-confidence; the disagreeing field is flagged low-confidence with its ratio, majority value chosen', async () => {
    const runOnce = scriptedRunner<Shape>(
      { shapeId: 'box', width: 50, height: 20 },
      { shapeId: 'box', width: 50, height: 20 },
      { shapeId: 'box', width: 50, height: 99 }, // height disagrees
    );
    const res = await runSelfConsistent(runOnce, { project, runs: 3, agreement: 0.8 });

    expect(res.confidence.shapeId).toBe(1);
    expect(res.confidence.width).toBe(1);
    expect(res.confidence.height).toBeCloseTo(2 / 3, 10); // 2 of 3 agree
    expect(res.lowConfidenceFields).toEqual(['height']);
    // medoid = a run in the majority on the most fields => the height=20 majority
    expect(res.value.height).toBe(20);
  });

  it('a totally split enum field (all different) => confidence 1/3, flagged', async () => {
    const runOnce = scriptedRunner<Shape>(
      { shapeId: 'box', width: 1, height: 1 },
      { shapeId: 'cyl', width: 1, height: 1 },
      { shapeId: 'cone', width: 1, height: 1 },
    );
    const res = await runSelfConsistent(runOnce, { project, runs: 3 });
    expect(res.confidence.shapeId).toBeCloseTo(1 / 3, 10);
    expect(res.lowConfidenceFields).toContain('shapeId');
    // earliest-wins tie-break => first run is the medoid
    expect(res.value.shapeId).toBe('box');
  });
});

describe('runSelfConsistent — numeric tolerance', () => {
  it('49.9 vs 50.1 (0.4% apart) count as agreement under the default 1% tolerance', async () => {
    const runOnce = scriptedRunner<Shape>(
      { shapeId: 'box', width: 49.9, height: 10 },
      { shapeId: 'box', width: 50.1, height: 10 },
      { shapeId: 'box', width: 50.0, height: 10 },
    );
    const res = await runSelfConsistent(runOnce, { project, runs: 3 });
    expect(res.confidence.width).toBe(1); // all within tolerance => full agreement
    expect(res.lowConfidenceFields).toEqual([]);
  });

  it('50 vs 60 (20% apart) do NOT agree — flagged low-confidence', async () => {
    const runOnce = scriptedRunner<Shape>(
      { shapeId: 'box', width: 50, height: 10 },
      { shapeId: 'box', width: 60, height: 10 },
    );
    const res = await runSelfConsistent(runOnce, { project, runs: 2, agreement: 0.8 });
    expect(res.confidence.width).toBe(0.5);
    expect(res.lowConfidenceFields).toContain('width');
  });

  it('tolerance is configurable — a 5% gap agrees when tolerance is raised to 10%', async () => {
    const runOnce = scriptedRunner<Shape>(
      { shapeId: 'box', width: 100, height: 10 },
      { shapeId: 'box', width: 105, height: 10 },
    );
    const res = await runSelfConsistent(runOnce, { project, runs: 2, numericTolerance: 0.1 });
    expect(res.confidence.width).toBe(1);
  });
});

describe('runSelfConsistent — present vs absent is a disagreement', () => {
  it('a field present in some runs and missing in others is flagged', async () => {
    const runOnce = scriptedRunner<Record<string, unknown>>(
      { a: 1, b: 2 },
      { a: 1 }, // b absent
      { a: 1, b: 2 },
    );
    const res = await runSelfConsistent(runOnce, {
      runs: 3,
      project: (v) => v as Record<string, string | number | null>,
    });
    expect(res.confidence.a).toBe(1);
    expect(res.confidence.b).toBeCloseTo(2 / 3, 10);
    expect(res.lowConfidenceFields).toEqual(['b']);
  });
});

describe('runSelfConsistent — keyFields restricts the comparison', () => {
  it('only the named fields are scored', async () => {
    const runOnce = scriptedRunner<Shape>(
      { shapeId: 'box', width: 50, height: 20 },
      { shapeId: 'box', width: 50, height: 99 },
    );
    const res = await runSelfConsistent(runOnce, { project, runs: 2, keyFields: ['shapeId', 'width'] });
    expect(Object.keys(res.confidence).sort()).toEqual(['shapeId', 'width']);
    expect(res.confidence.height).toBeUndefined();
    expect(res.lowConfidenceFields).toEqual([]);
  });
});
