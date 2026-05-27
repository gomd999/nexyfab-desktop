import { describe, it, expect } from 'vitest';
import {
  buildRouteRibbon,
  buildAllRibbons,
  multiRouteFeatures,
  primaryRoute,
  suggestNext,
} from './routeBindings';
import { findById } from './registry';

describe('buildRouteRibbon', () => {
  it('drawing route ribbon has View + Annotate tabs', () => {
    const r = buildRouteRibbon('drawing');
    const tabIds = r.tabs.map(t => t.id);
    expect(tabIds).toContain('view');
    expect(tabIds).toContain('annotate');
  });

  it('cam route has Mill + EDM tabs', () => {
    const r = buildRouteRibbon('cam');
    expect(r.tabs.map(t => t.id)).toContain('mill');
    expect(r.tabs.map(t => t.id)).toContain('edm');
  });

  it('every tab has at least one group', () => {
    const r = buildRouteRibbon('modeling');
    for (const t of r.tabs) {
      expect(t.groups.length).toBeGreaterThan(0);
    }
  });

  it('groups carry their entries', () => {
    const r = buildRouteRibbon('drawing');
    const viewTab = r.tabs.find(t => t.id === 'view')!;
    const totalEntries = viewTab.groups.reduce((s, g) => s + g.entries.length, 0);
    expect(totalEntries).toBeGreaterThan(0);
  });
});

describe('buildAllRibbons', () => {
  it('builds for every route', () => {
    const all = buildAllRibbons();
    expect(all.modeling).toBeDefined();
    expect(all.drawing).toBeDefined();
    expect(all.cam).toBeDefined();
    expect(all.plant).toBeDefined();
  });
});

describe('multiRouteFeatures', () => {
  it('finds features with multiple routes', () => {
    const r = multiRouteFeatures();
    expect(r.length).toBeGreaterThan(0);
    expect(r.every(m => m.routes.length > 1)).toBe(true);
  });

  it('surface flatten appears in both modeling + sheet-metal', () => {
    const r = multiRouteFeatures();
    const flatten = r.find(m => m.entry.id === 'modeling.surface-flatten');
    expect(flatten?.routes).toContain('modeling');
    expect(flatten?.routes).toContain('sheet-metal');
  });
});

describe('primaryRoute', () => {
  it('returns first route in entry.routes', () => {
    const entry = findById('drawing.auto-views')!;
    expect(primaryRoute(entry)).toBe('drawing');
  });
});

describe('suggestNext', () => {
  it('returns route entries when no history', () => {
    const r = suggestNext([], 'modeling', 5);
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(5);
  });

  it('boosts category match in suggestions', () => {
    // Used 1 simulation feature → next suggestions in modeling
    // should rank other simulation features higher.
    const r = suggestNext(['fea.buckling'], 'modeling', 5);
    const topCategories = r.slice(0, 3).map(s => s.entry.category);
    // Should include at least one simulation-adjacent.
    expect(topCategories.some(c => c === 'simulation' || c === 'dynamic' || c === 'composite')).toBe(true);
  });

  it('excludes recently-used features from suggestions', () => {
    const r = suggestNext(['drawing.auto-views'], 'drawing', 5);
    expect(r.every(s => s.entry.id !== 'drawing.auto-views')).toBe(true);
  });

  it('respects maxResults', () => {
    const r = suggestNext([], 'modeling', 3);
    expect(r.length).toBeLessThanOrEqual(3);
  });
});
