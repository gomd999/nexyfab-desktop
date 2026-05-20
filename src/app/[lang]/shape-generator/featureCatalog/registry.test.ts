import { describe, it, expect } from 'vitest';
import {
  FEATURE_REGISTRY,
  findByCategory,
  findByRoute,
  findById,
  searchFeatures,
  filterByLicense,
  getRegistryStats,
} from './registry';

describe('FEATURE_REGISTRY', () => {
  it('has ≥ 40 entries (broad coverage)', () => {
    expect(FEATURE_REGISTRY.length).toBeGreaterThanOrEqual(40);
  });

  it('every entry has unique id', () => {
    const ids = FEATURE_REGISTRY.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has at least one route', () => {
    for (const e of FEATURE_REGISTRY) {
      expect(e.routes.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a description', () => {
    for (const e of FEATURE_REGISTRY) {
      expect(e.description.length).toBeGreaterThan(10);
    }
  });
});

describe('findByCategory', () => {
  it('returns FEA entries for "simulation"', () => {
    const r = findByCategory('simulation');
    expect(r.length).toBeGreaterThan(0);
  });

  it('returns drawing entries', () => {
    const r = findByCategory('drawing');
    expect(r.some(e => e.id === 'drawing.auto-views')).toBe(true);
  });
});

describe('findByRoute', () => {
  it('drawing route includes auto-views + balloon + dim-xpert', () => {
    const r = findByRoute('drawing');
    const ids = r.map(e => e.id);
    expect(ids).toContain('drawing.auto-views');
    expect(ids).toContain('drawing.balloon-bom');
    expect(ids).toContain('drawing.dim-xpert');
  });

  it('cam route includes 5-axis + mill-turn + EDM', () => {
    const r = findByRoute('cam');
    const ids = r.map(e => e.id);
    expect(ids).toContain('cam.5-axis');
    expect(ids).toContain('cam.mill-turn');
    expect(ids).toContain('cam.edm');
  });

  it('hub route includes design automation', () => {
    const r = findByRoute('hub');
    expect(r.some(e => e.id === 'automation.driveworks')).toBe(true);
  });
});

describe('findById', () => {
  it('returns entry by id', () => {
    expect(findById('fea.buckling')?.name).toContain('Buckling');
  });

  it('null for unknown id', () => {
    expect(findById('not.exist')).toBeNull();
  });
});

describe('searchFeatures', () => {
  it('finds by name substring', () => {
    const r = searchFeatures('lattice');
    expect(r.some(e => e.id === 'modeling.lattice')).toBe(true);
  });

  it('finds by tag', () => {
    const r = searchFeatures('gyroid');
    expect(r.some(e => e.id === 'modeling.lattice')).toBe(true);
  });

  it('finds by description', () => {
    const r = searchFeatures('rolling-ball');
    expect(r.some(e => e.id.includes('fillet'))).toBe(true);
  });

  it('case-insensitive', () => {
    expect(searchFeatures('LATTICE').length).toBeGreaterThan(0);
  });

  it('empty query returns empty', () => {
    expect(searchFeatures('')).toHaveLength(0);
  });
});

describe('filterByLicense', () => {
  it('free user sees only free entries', () => {
    const all = FEATURE_REGISTRY;
    const free = filterByLicense(all, 'free');
    expect(free.every(e => e.license === 'free')).toBe(true);
  });

  it('pro user sees free + pro entries', () => {
    const all = FEATURE_REGISTRY;
    const pro = filterByLicense(all, 'pro');
    expect(pro.every(e => e.license === 'free' || e.license === 'pro')).toBe(true);
  });

  it('pro-plus sees free + pro + pro-plus', () => {
    const all = FEATURE_REGISTRY;
    const pp = filterByLicense(all, 'pro-plus');
    expect(pp.length).toBeGreaterThan(filterByLicense(all, 'pro').length);
  });
});

describe('getRegistryStats', () => {
  it('totalEntries matches catalog length', () => {
    const s = getRegistryStats();
    expect(s.totalEntries).toBe(FEATURE_REGISTRY.length);
  });

  it('byCategory has multiple buckets', () => {
    const s = getRegistryStats();
    expect(Object.keys(s.byCategory).length).toBeGreaterThan(5);
  });

  it('byLicense sums to totalEntries', () => {
    const s = getRegistryStats();
    const sum = Object.values(s.byLicense).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.totalEntries);
  });
});
