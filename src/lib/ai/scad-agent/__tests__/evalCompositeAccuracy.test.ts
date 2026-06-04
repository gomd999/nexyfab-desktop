/**
 * evalCompositeAccuracy — golden composite set self-consistency (W3, ADR-015).
 */
import { describe, it, expect } from 'vitest';
import {
  COMPOSITE_EVAL_CASES,
  evalCompositeCase,
} from '../evalCompositeAccuracy';
import { compositeIntentToScad } from '../compositeIntent';

describe('COMPOSITE_EVAL_CASES · curation', () => {
  it('has unique case ids', () => {
    const ids = COMPOSITE_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every case has a non-empty prompt and ≥ 1 part', () => {
    for (const c of COMPOSITE_EVAL_CASES) {
      expect(c.prompt.trim().length).toBeGreaterThan(0);
      expect(c.parts.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the first part of every case is an ADD (anchors the body)', () => {
    for (const c of COMPOSITE_EVAL_CASES) {
      expect(c.parts[0].op ?? 'add').toBe('add');
    }
  });

  it('every case renders cleanly via compositeIntentToScad', () => {
    for (const c of COMPOSITE_EVAL_CASES) {
      const r = compositeIntentToScad(c.parts);
      if (!r.ok) throw new Error(`${c.id}: ${r.reason}`);
      expect(r.ok).toBe(true);
    }
  });
});

describe('COMPOSITE_EVAL_CASES · self-consistency', () => {
  for (const c of COMPOSITE_EVAL_CASES) {
    it(`${c.id} renders, matches its declared envelope, and verifies`, () => {
      const r = evalCompositeCase(c);
      if (!r.pass) throw new Error(`${c.id} failed: ${r.details.join('; ')}`);
      expect(r.renders).toBe(true);
      expect(r.bboxMatches).toBe(true);
      expect(r.verifies).toBe(true);
    });
  }

  it('a wrong declared envelope is caught (negative control)', () => {
    const good = COMPOSITE_EVAL_CASES[0];
    const r = evalCompositeCase({ ...good, expectedBbox: { wMm: 999, hMm: 1, dMm: 1 } });
    expect(r.bboxMatches).toBe(false);
    expect(r.pass).toBe(false);
  });
});
