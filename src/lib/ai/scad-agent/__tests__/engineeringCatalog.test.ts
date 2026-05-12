/**
 * Z6 — Engineering catalog query tests.
 *
 * Pin retrieval order so future content edits don't silently change which
 * material/seal the agent picks for a given query.
 */

import { describe, it, expect } from 'vitest';
import { queryCatalog, listTopics, listEntries } from '../engineeringCatalog';

describe('engineeringCatalog', () => {
  it('listTopics covers materials/seals/treatments/fits/fasteners', () => {
    const topics = listTopics();
    expect(topics).toContain('materials');
    expect(topics).toContain('seals');
    expect(topics).toContain('surface_treatments');
    expect(topics).toContain('fits_tolerances');
    expect(topics).toContain('fasteners_guidance');
  });

  it('materials topic has aluminum + steel + plastics', () => {
    const ids = listEntries('materials').map(e => e.id);
    expect(ids).toContain('aluminum_6061_t6');
    expect(ids).toContain('steel_4140');
    expect(ids).toContain('pla');
  });

  it('keyword retrieval finds 6061 for "aluminum frame"', () => {
    const hits = queryCatalog('materials', 'aluminum frame');
    expect(hits[0].id).toBe('aluminum_6061_t6');
  });

  it('"shaft fatigue" picks 4140 over A36', () => {
    const hits = queryCatalog('materials', 'shaft fatigue');
    expect(hits[0].id).toBe('steel_4140');
  });

  it('seals: "rotary shaft" picks lip seal', () => {
    const hits = queryCatalog('seals', 'rotary shaft');
    expect(hits[0].id).toBe('lip_seal_iso6194');
  });

  it('returns top-K when query is empty (default k=3)', () => {
    const hits = queryCatalog('materials', '');
    expect(hits.length).toBe(3);
  });

  it('respects k parameter', () => {
    const hits = queryCatalog('materials', 'steel', 1);
    expect(hits.length).toBeLessThanOrEqual(1);
  });

  it('returns empty when no keywords match', () => {
    const hits = queryCatalog('materials', 'titanium kryptonite');
    expect(hits).toHaveLength(0);
  });

  it('every entry has citation source', () => {
    for (const t of listTopics()) {
      for (const e of listEntries(t)) {
        expect(e.source.length).toBeGreaterThan(3);
      }
    }
  });
});
