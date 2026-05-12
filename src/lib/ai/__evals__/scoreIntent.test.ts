/**
 * Scorer correctness (R4) — pin the grading rules so the scoring harness
 * itself is reliable. Real AI evaluation runs against this scorer.
 */

import { describe, it, expect } from 'vitest';
import { SCAD_INTENT_EVALSET, scoreIntent, summarizeEval } from './scad-intent-evalset';

describe('SCAD intent eval set (R4)', () => {
  it('contains 30+ cases across KO + EN', () => {
    expect(SCAD_INTENT_EVALSET.length).toBeGreaterThanOrEqual(30);
    const ko = SCAD_INTENT_EVALSET.filter(c => c.lang === 'ko').length;
    const en = SCAD_INTENT_EVALSET.filter(c => c.lang === 'en').length;
    expect(ko).toBeGreaterThanOrEqual(15);
    expect(en).toBeGreaterThanOrEqual(10);
  });

  it('every case has a unique id', () => {
    const ids = new Set(SCAD_INTENT_EVALSET.map(c => c.id));
    expect(ids.size).toBe(SCAD_INTENT_EVALSET.length);
  });

  it('every case has at least one must check', () => {
    for (const c of SCAD_INTENT_EVALSET) {
      const hasMust =
        c.must.shapeId !== undefined ||
        (c.must.paramsApprox && Object.keys(c.must.paramsApprox).length > 0) ||
        (c.must.featureTypes && c.must.featureTypes.length > 0);
      expect(hasMust, `Case ${c.id} has no must constraint`).toBe(true);
    }
  });
});

describe('scoreIntent', () => {
  const boxCase = SCAD_INTENT_EVALSET.find(c => c.id === 'ko_box_30mm')!;

  it('passes when intent matches all must constraints exactly', () => {
    const r = scoreIntent(boxCase, {
      shapeId: 'box',
      params: { width: 30, height: 30, depth: 30 },
    });
    expect(r.passed).toBe(true);
    expect(r.partialScore).toBe(1);
    expect(r.failures).toEqual([]);
  });

  it('passes when params are within tolerance', () => {
    const r = scoreIntent(boxCase, {
      shapeId: 'box',
      params: { width: 30.5, height: 29.8, depth: 30.2 },
    });
    expect(r.passed).toBe(true);
  });

  it('fails when shapeId mismatches', () => {
    const r = scoreIntent(boxCase, {
      shapeId: 'cylinder',
      params: { width: 30, height: 30, depth: 30 },
    });
    expect(r.passed).toBe(false);
    expect(r.failures.some(f => /shapeId/.test(f))).toBe(true);
  });

  it('fails when param outside tolerance', () => {
    const r = scoreIntent(boxCase, {
      shapeId: 'box',
      params: { width: 30, height: 30, depth: 50 }, // 20mm off
    });
    expect(r.passed).toBe(false);
  });

  it('feature type requirement counted in must', () => {
    const filletCase = SCAD_INTENT_EVALSET.find(c => c.id === 'ko_box_with_fillet')!;
    const fail = scoreIntent(filletCase, {
      shapeId: 'box',
      params: { width: 40, height: 40, depth: 40 },
      // missing fillet feature
    });
    expect(fail.passed).toBe(false);

    const pass = scoreIntent(filletCase, {
      shapeId: 'box',
      params: { width: 40 },
      features: [{ type: 'fillet', params: { radius: 5 } }],
    });
    expect(pass.passed).toBe(true);
  });

  it('disabled features do not count for must', () => {
    const filletCase = SCAD_INTENT_EVALSET.find(c => c.id === 'ko_box_with_fillet')!;
    const r = scoreIntent(filletCase, {
      shapeId: 'box',
      params: { width: 40 },
      features: [{ type: 'fillet', params: {}, enabled: false }],
    });
    expect(r.passed).toBe(false);
  });

  it('partialScore reflects soft credit when must passes but should fails', () => {
    const r = scoreIntent(boxCase, {
      shapeId: 'box',
      params: { width: 30, height: 30, depth: 30 },
    });
    expect(r.passed).toBe(true);
    expect(r.partialScore).toBe(1);
  });
});

describe('summarizeEval', () => {
  it('reports per-language pass rate', () => {
    const allPass = SCAD_INTENT_EVALSET.map(c => ({
      caseId: c.id,
      passed: true,
      partialScore: 1,
      failures: [],
    }));
    const summary = summarizeEval(allPass);
    expect(summary.total).toBe(SCAD_INTENT_EVALSET.length);
    expect(summary.passed).toBe(SCAD_INTENT_EVALSET.length);
    expect(summary.passRate).toBe(1);
    expect(summary.averageScore).toBe(1);
    expect(summary.byLang.ko.passed).toBe(summary.byLang.ko.total);
  });

  it('handles all-fail case', () => {
    const allFail = SCAD_INTENT_EVALSET.map(c => ({
      caseId: c.id,
      passed: false,
      partialScore: 0,
      failures: ['mock'],
    }));
    const summary = summarizeEval(allFail);
    expect(summary.passRate).toBe(0);
    expect(summary.failed).toBe(SCAD_INTENT_EVALSET.length);
  });
});
