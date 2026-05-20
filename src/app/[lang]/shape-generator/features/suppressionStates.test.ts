import { describe, it, expect } from 'vitest';
import {
  SuppressionManager,
  summarize,
} from './suppressionStates';

describe('SuppressionManager — CRUD', () => {
  it('createConfig + getConfig', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'c1', name: 'Default' });
    expect(m.getConfig('c1')?.name).toBe('Default');
  });

  it('deleteConfig removes + reparents children', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'parent', name: 'Parent' });
    m.createConfig({ id: 'child', name: 'Child', inheritsFrom: 'parent' });
    m.deleteConfig('parent');
    expect(m.getConfig('parent')).toBeNull();
    expect(m.getConfig('child')?.inheritsFrom).toBeNull();
  });
});

describe('default suppression', () => {
  it('feature suppression defaults to false', () => {
    const m = new SuppressionManager();
    expect(m.resolve(null, 'feat1').suppressed).toBe(false);
  });

  it('setDefaultSuppression honored when no override', () => {
    const m = new SuppressionManager();
    m.setDefaultSuppression('feat1', true);
    expect(m.resolve(null, 'feat1').suppressed).toBe(true);
  });
});

describe('per-config overrides', () => {
  it('override beats default', () => {
    const m = new SuppressionManager();
    m.setDefaultSuppression('feat1', false);
    m.createConfig({ id: 'c1', name: 'A' });
    m.setOverride('c1', 'feat1', true);
    expect(m.resolve('c1', 'feat1').suppressed).toBe(true);
    expect(m.resolve('c1', 'feat1').source).toBe('override');
  });

  it('clearOverride falls back to default', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'c1', name: 'A' });
    m.setOverride('c1', 'feat1', true);
    m.clearOverride('c1', 'feat1');
    expect(m.resolve('c1', 'feat1').suppressed).toBe(false);
  });
});

describe('inheritance', () => {
  it('child config inherits parent overrides', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'parent', name: 'P' });
    m.setOverride('parent', 'feat1', true);
    m.createConfig({ id: 'child', name: 'C', inheritsFrom: 'parent' });
    expect(m.resolve('child', 'feat1').suppressed).toBe(true);
  });

  it('child override beats parent', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'parent', name: 'P' });
    m.setOverride('parent', 'feat1', true);
    m.createConfig({ id: 'child', name: 'C', inheritsFrom: 'parent' });
    m.setOverride('child', 'feat1', false);
    expect(m.resolve('child', 'feat1').suppressed).toBe(false);
  });

  it('grandchild walks chain', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'root', name: 'R' });
    m.setOverride('root', 'feat1', true);
    m.createConfig({ id: 'mid', name: 'M', inheritsFrom: 'root' });
    m.createConfig({ id: 'leaf', name: 'L', inheritsFrom: 'mid' });
    expect(m.resolve('leaf', 'feat1').suppressed).toBe(true);
  });
});

describe('activeFeatures', () => {
  it('skips suppressed features', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'c1', name: 'A' });
    m.setOverride('c1', 'b', true);
    const active = m.activeFeatures('c1', ['a', 'b', 'c']);
    expect(active).toEqual(['a', 'c']);
  });
});

describe('tag-based suppression', () => {
  it('suppressByTag affects tagged features only', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'c1', name: 'A' });
    m.tagFeature('f1', 'decorative');
    m.tagFeature('f2', 'decorative');
    m.tagFeature('f3', 'structural');
    const count = m.suppressByTag('c1', 'decorative', true);
    expect(count).toBe(2);
    expect(m.resolve('c1', 'f1').suppressed).toBe(true);
    expect(m.resolve('c1', 'f3').suppressed).toBe(false);
  });
});

describe('diff', () => {
  it('reports onlyInA/onlyInB/bothActive/bothSuppressed', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'a', name: 'A' });
    m.createConfig({ id: 'b', name: 'B' });
    m.setOverride('a', 'f1', false);  // active in A
    m.setOverride('b', 'f1', true);   // suppressed in B
    m.setOverride('a', 'f2', false);
    m.setOverride('b', 'f2', false);
    const d = m.diff('a', 'b', ['f1', 'f2', 'f3']);
    expect(d.onlyInA).toContain('f1');
    expect(d.bothActive).toContain('f2');
    expect(d.bothActive).toContain('f3');
  });
});

describe('serialization', () => {
  it('round-trips', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'c1', name: 'A' });
    m.setOverride('c1', 'f1', true);
    m.setDefaultSuppression('f2', true);
    m.tagFeature('f1', 'tag1');
    const json = m.serialize();
    const m2 = new SuppressionManager();
    m2.load(json);
    expect(m2.resolve('c1', 'f1').suppressed).toBe(true);
    expect(m2.resolve(null, 'f2').suppressed).toBe(true);
  });

  it('rejects unknown version', () => {
    const m = new SuppressionManager();
    expect(() => m.load({ version: 99, defaults: [], configs: [], tags: [] })).toThrow();
  });
});

describe('summarize', () => {
  it('reports inheritance depth', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'a', name: 'A' });
    m.createConfig({ id: 'b', name: 'B', inheritsFrom: 'a' });
    m.createConfig({ id: 'c', name: 'C', inheritsFrom: 'b' });
    expect(summarize(m).inheritanceDepth).toBe(2);
  });

  it('counts configs + overrides', () => {
    const m = new SuppressionManager();
    m.createConfig({ id: 'c1', name: 'A' });
    m.setOverride('c1', 'f1', true);
    m.setOverride('c1', 'f2', false);
    const s = summarize(m);
    expect(s.configCount).toBe(1);
    expect(s.totalOverrides).toBe(2);
  });
});
