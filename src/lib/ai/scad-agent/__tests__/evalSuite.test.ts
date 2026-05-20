import { describe, it, expect } from 'vitest';
import { evalCase, runEvalSuite, SEED_CASES, type EvalCase } from '../evalSuite';
import type { IntentInput } from '@/lib/openscad-render/intentToScad';

const sampleCase: EvalCase = {
  id: 'box-with-hole',
  prompt: 'block 50x30x20 with 8mm hole',
  expected: {
    shapeId: 'box',
    params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
    features: [{ type: 'hole', params: { diameter_mm: 8 } }],
  },
};

describe('evalCase · classification', () => {
  it('returns exact when actual matches expected exactly', () => {
    const r = evalCase(sampleCase, sampleCase.expected);
    expect(r.matchLevel).toBe('exact');
    expect(r.details).toEqual([]);
  });

  it('returns structural when feature params drift outside tolerance but shape + types match', () => {
    const c: EvalCase = {
      id: 'feat-drift',
      prompt: 'box with rounded corners',
      expected: {
        shapeId: 'box',
        params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
        features: [{ type: 'fillet', params: { radius_mm: 2 } }],
      },
    };
    const actual: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'fillet', params: { radius_mm: 5 } }],
    };
    const r = evalCase(c, actual);
    // Top params exact, feature type matches, only value drift → structural or directional.
    expect(['structural', 'directional']).toContain(r.matchLevel);
    expect(r.details.some(d => d.includes('radius_mm'))).toBe(true);
  });

  it('returns directional when params drift beyond tolerance but features match', () => {
    const actual: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 70, height_mm: 30, depth_mm: 20 }, // 20mm off
      features: [{ type: 'hole', params: { diameter_mm: 8 } }],
    };
    const r = evalCase(sampleCase, actual);
    expect(r.matchLevel).toBe('directional');
  });

  it('returns mismatch when shapeId differs', () => {
    const actual: IntentInput = {
      shapeId: 'sphere',
      params: { diameter_mm: 50 },
    };
    const r = evalCase(sampleCase, actual);
    expect(r.matchLevel).toBe('mismatch');
    expect(r.details[0]).toMatch(/shapeId/);
  });

  it('counts missing features as directional when half still match', () => {
    const c: EvalCase = {
      id: 'multi',
      prompt: 'box with hole and fillet',
      expected: {
        shapeId: 'box',
        params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
        features: [
          { type: 'hole', params: { diameter_mm: 8 } },
          { type: 'fillet', params: { radius_mm: 2 } },
        ],
      },
    };
    const actual: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'hole', params: { diameter_mm: 8 } }], // missed fillet
    };
    const r = evalCase(c, actual);
    expect(r.matchLevel).toBe('directional'); // 1/2 features
  });

  it('classifies as mismatch when no features overlap', () => {
    const c: EvalCase = {
      id: 'multi',
      prompt: 'two features',
      expected: {
        shapeId: 'box',
        params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
        features: [
          { type: 'hole' }, { type: 'fillet' },
        ],
      },
    };
    const actual: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'shell' }, { type: 'chamfer' }],
    };
    const r = evalCase(c, actual);
    expect(r.matchLevel).toBe('mismatch');
  });

  it('respects custom paramTolerance', () => {
    const tightCase: EvalCase = {
      ...sampleCase,
      paramTolerance: 0.01,
    };
    const actual: IntentInput = {
      shapeId: 'box',
      params: { width_mm: 50.05, height_mm: 30, depth_mm: 20 },
      features: [{ type: 'hole', params: { diameter_mm: 8 } }],
    };
    expect(evalCase(tightCase, actual).matchLevel).not.toBe('exact');
    // Loose tolerance accepts the same actual as exact.
    const looseCase: EvalCase = { ...sampleCase, paramTolerance: 1 };
    expect(evalCase(looseCase, actual).matchLevel).toBe('exact');
  });
});

describe('runEvalSuite · aggregation', () => {
  it('aggregates per-case results and computes pass rate', async () => {
    const cases: EvalCase[] = [
      sampleCase,
      { id: 'c2', prompt: 'sphere', expected: { shapeId: 'sphere', params: { diameter_mm: 30 } } },
    ];
    const generate = (prompt: string) => {
      if (prompt.includes('sphere')) {
        return { shapeId: 'sphere', params: { diameter_mm: 30 } };
      }
      return sampleCase.expected;
    };
    const r = await runEvalSuite(cases, generate);
    expect(r.total).toBe(2);
    expect(r.exactCount).toBe(2);
    expect(r.passRate).toBe(1);
  });

  it('passRate = mix of exact + structural + directional', async () => {
    const cases: EvalCase[] = [
      sampleCase,
      sampleCase,
      sampleCase,
    ];
    let n = 0;
    const generate = (): IntentInput => {
      n++;
      if (n === 1) return sampleCase.expected; // exact
      if (n === 2) {                            // directional (param drift beyond tolerance)
        return {
          shapeId: 'box',
          params: { width_mm: 60, height_mm: 30, depth_mm: 20 },
          features: [{ type: 'hole', params: { diameter_mm: 8 } }],
        };
      }
      return { shapeId: 'sphere', params: { diameter_mm: 30 } }; // mismatch
    };
    const r = await runEvalSuite(cases, generate);
    expect(r.exactCount).toBe(1);
    expect(r.directionalCount + r.structuralCount).toBe(1);
    expect(r.mismatchCount).toBe(1);
    expect(r.passRate).toBeCloseTo(2 / 3, 2);
  });

  it('handles a generator that returns null (records as mismatch)', async () => {
    const r = await runEvalSuite([sampleCase], () => null);
    expect(r.mismatchCount).toBe(1);
    expect(r.results[0].details[0]).toMatch(/null/);
  });

  it('handles an async generator', async () => {
    const r = await runEvalSuite(
      [sampleCase],
      async () => sampleCase.expected,
    );
    expect(r.exactCount).toBe(1);
  });

  it('passRate is 1 for an empty case list', async () => {
    const r = await runEvalSuite([], () => null);
    expect(r.passRate).toBe(1);
    expect(r.total).toBe(0);
  });
});

describe('SEED_CASES', () => {
  it('ships the canonical seed cases (box, cylinder, sphere, rounded)', () => {
    expect(SEED_CASES.length).toBeGreaterThanOrEqual(4);
    const ids = SEED_CASES.map(c => c.id);
    expect(ids).toContain('seed.box-with-hole');
    expect(ids).toContain('seed.cylinder-rod');
    expect(ids).toContain('seed.sphere');
  });

  it('every seed case has a non-empty prompt and a parseable expected intent', () => {
    for (const c of SEED_CASES) {
      expect(c.prompt.length).toBeGreaterThan(0);
      expect(c.expected.shapeId.length).toBeGreaterThan(0);
      expect(Object.keys(c.expected.params).length).toBeGreaterThan(0);
    }
  });
});
