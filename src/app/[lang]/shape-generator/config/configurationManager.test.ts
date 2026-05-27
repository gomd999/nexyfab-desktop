import { describe, it, expect } from 'vitest';
import { ConfigurationManager } from './configurationManager';
import type { FeatureInstance } from '../features/types';

const baseFeatures: FeatureInstance[] = [
  { id: 'f1', type: 'fillet', params: { radius: 3 }, enabled: true },
  { id: 'f2', type: 'shell', params: { thickness: 2 }, enabled: true },
];

describe('ConfigurationManager', () => {
  it('adds + activates first config automatically', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'small', name: 'Small' });
    expect(m.active()?.id).toBe('small');
  });

  it('rejects duplicate ids', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'small', name: 'Small' });
    expect(() => m.add({ id: 'small', name: 'Another' })).toThrow();
  });

  it('removes config + reassigns active', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'a', name: 'A' });
    m.add({ id: 'b', name: 'B' });
    m.remove('a');
    expect(m.active()?.id).toBe('b');
  });

  it('switches active config', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'a', name: 'A' });
    m.add({ id: 'b', name: 'B' });
    m.activate('b');
    expect(m.active()?.id).toBe('b');
  });

  it('applies overrides to base features', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'large', name: 'Large' });
    m.setOverride('large', 'f1', 'radius', 10);
    const out = m.applyConfig(baseFeatures);
    expect(out[0]!.params.radius).toBe(10);
    expect(out[1]!.params.thickness).toBe(2); // untouched
  });

  it('suppresses features in a config', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'minimal', name: 'Minimal' });
    m.setSuppressed('minimal', 'f2', true);
    const out = m.applyConfig(baseFeatures);
    expect(out.find(f => f.id === 'f2')).toBeUndefined();
  });

  it('inherits parent overrides', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'base', name: 'Base' });
    m.setOverride('base', 'f1', 'radius', 5);
    m.add({ id: 'derived', name: 'Derived', parentId: 'base' });
    m.activate('derived');
    const out = m.applyConfig(baseFeatures);
    expect(out[0]!.params.radius).toBe(5);
  });

  it('child override wins over parent', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'base', name: 'Base' });
    m.setOverride('base', 'f1', 'radius', 5);
    m.add({ id: 'derived', name: 'Derived', parentId: 'base' });
    m.setOverride('derived', 'f1', 'radius', 8);
    m.activate('derived');
    const out = m.applyConfig(baseFeatures);
    expect(out[0]!.params.radius).toBe(8);
  });

  it('clearOverride removes an entry', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'a', name: 'A' });
    m.setOverride('a', 'f1', 'radius', 5);
    m.clearOverride('a', 'f1', 'radius');
    const out = m.applyConfig(baseFeatures);
    expect(out[0]!.params.radius).toBe(3); // default
  });

  it('detects cycles in parent chain without infinite loop', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'a', name: 'A' });
    m.add({ id: 'b', name: 'B', parentId: 'a' });
    // Force a cycle by retroactively setting a.parentId = 'b'.
    const a = m.list().find(c => c.id === 'a')!;
    (a as { parentId?: string }).parentId = 'b';
    // resolveOverrides should not hang.
    expect(() => m.resolveOverrides('a')).not.toThrow();
  });

  it('list returns all configurations', () => {
    const m = new ConfigurationManager();
    m.add({ id: 'a', name: 'A' });
    m.add({ id: 'b', name: 'B' });
    expect(m.list()).toHaveLength(2);
  });
});
