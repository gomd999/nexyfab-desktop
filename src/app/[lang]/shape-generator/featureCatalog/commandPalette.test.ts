import { describe, it, expect } from 'vitest';
import {
  fuzzyMatch,
  FrecencyTracker,
  searchPalette,
  initPaletteNav,
  navUp,
  navDown,
  getCurrentHit,
} from './commandPalette';

describe('fuzzyMatch', () => {
  it('exact substring → score 0.1', () => {
    expect(fuzzyMatch('Topology Optimization', 'optim')).toBe(0.1);
  });

  it('exact match → score 0', () => {
    expect(fuzzyMatch('lattice', 'lattice')).toBe(0);
  });

  it('characters in order, with gaps → positive score', () => {
    const r = fuzzyMatch('Trochoidal Adaptive Clearing', 'trclr');
    expect(r).toBeGreaterThan(0);
  });

  it('characters out of order → no match', () => {
    expect(fuzzyMatch('abc', 'cba')).toBe(-1);
  });

  it('empty needle → 0', () => {
    expect(fuzzyMatch('anything', '')).toBe(0);
  });

  it('case-insensitive', () => {
    expect(fuzzyMatch('LATTICE', 'lattice')).toBe(0);
  });
});

describe('FrecencyTracker', () => {
  it('records + scores recent picks', () => {
    const t = new FrecencyTracker();
    const now = Date.now();
    t.record('A', now);
    t.record('A', now);
    t.record('B', now);
    expect(t.score('A', now)).toBeGreaterThan(t.score('B', now));
  });

  it('older events decay', () => {
    const t = new FrecencyTracker(1000);
    const now = Date.now();
    t.record('A', now - 800);
    const old = t.score('A', now);
    t.record('A', now);
    const recent = t.score('A', now);
    expect(recent).toBeGreaterThan(old);
  });

  it('topN returns most-frequent ids first', () => {
    const t = new FrecencyTracker();
    const now = Date.now();
    for (let i = 0; i < 3; i++) t.record('A', now);
    t.record('B', now);
    expect(t.topN(2)[0]).toBe('A');
  });

  it('GC drops events outside window', () => {
    const t = new FrecencyTracker(100); // 100ms window
    const now = Date.now();
    t.record('A', now - 500);
    t.record('B', now);
    expect(t.score('A', now)).toBe(0);
  });
});

describe('searchPalette', () => {
  it('finds lattice for "lattice" query', () => {
    const hits = searchPalette('lattice');
    expect(hits[0]?.entry.id).toContain('lattice');
  });

  it('respects userTier filter', () => {
    const all = searchPalette('lattice', { userTier: 'free' });
    expect(all.every(h => h.entry.license === 'free')).toBe(true);
  });

  it('empty query with no frecency → top entries', () => {
    const hits = searchPalette('', { maxResults: 3 });
    expect(hits.length).toBe(3);
  });

  it('empty query + frecency → recent items first', () => {
    const t = new FrecencyTracker();
    t.record('drawing.auto-views');
    const hits = searchPalette('', { frecency: t });
    expect(hits[0]?.entry.id).toBe('drawing.auto-views');
  });

  it('respects maxResults', () => {
    const hits = searchPalette('a', { maxResults: 5 });
    expect(hits.length).toBeLessThanOrEqual(5);
  });

  it('frecency boosts ranking on tied scores', () => {
    const tracker = new FrecencyTracker();
    for (let i = 0; i < 5; i++) tracker.record('fea.buckling');
    const withBoost = searchPalette('fea', { frecency: tracker });
    expect(withBoost[0]?.entry.id).toBe('fea.buckling');
  });

  it('matchedField identifies which field hit', () => {
    const hits = searchPalette('gyroid', { maxResults: 1 });
    expect(hits[0]?.matchedField).toBeDefined();
  });
});

describe('keyboard navigation', () => {
  it('initial focused index is 0', () => {
    const state = initPaletteNav(searchPalette('lattice'));
    expect(state.focusedIndex).toBe(0);
  });

  it('navDown advances focus', () => {
    const state = initPaletteNav(searchPalette('a'));
    const next = navDown(state);
    expect(next.focusedIndex).toBe(1);
  });

  it('navDown wraps to first after last', () => {
    const hits = searchPalette('a').slice(0, 2);
    let state = initPaletteNav(hits);
    state = navDown(state);
    state = navDown(state);
    expect(state.focusedIndex).toBe(0);
  });

  it('navUp wraps to last from first', () => {
    const hits = searchPalette('a').slice(0, 3);
    let state = initPaletteNav(hits);
    state = navUp(state);
    expect(state.focusedIndex).toBe(hits.length - 1);
  });

  it('getCurrentHit returns focused entry', () => {
    const hits = searchPalette('lattice');
    const state = initPaletteNav(hits);
    expect(getCurrentHit(state)).toBe(hits[0]);
  });

  it('empty hits → navDown is no-op', () => {
    const state = initPaletteNav([]);
    expect(navDown(state).focusedIndex).toBe(0);
  });
});
