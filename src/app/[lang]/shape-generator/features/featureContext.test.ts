import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigurationTable } from '../configurations/ConfigurationTable';
import { EquationManager } from '../equations/equationManager';
import {
  setConfigurationTable,
  getConfigurationTable,
  setEquationManager,
  getEquationManager,
  resetFeatureContext,
  applyFeatureContext,
} from './featureContext';
import type { FeatureInstance } from './types';

beforeEach(() => resetFeatureContext());

describe('featureContext singletons', () => {
  it('starts empty', () => {
    expect(getConfigurationTable()).toBeNull();
    expect(getEquationManager()).toBeNull();
  });

  it('stores and clears managers', () => {
    const t = new ConfigurationTable();
    const em = new EquationManager();
    setConfigurationTable(t);
    setEquationManager(em);
    expect(getConfigurationTable()).toBe(t);
    expect(getEquationManager()).toBe(em);
    resetFeatureContext();
    expect(getConfigurationTable()).toBeNull();
    expect(getEquationManager()).toBeNull();
  });
});

describe('applyFeatureContext', () => {
  const makeFeature = (id: string, params: Record<string, number | string>): FeatureInstance => ({
    id,
    type: 'sketchExtrude',
    enabled: true,
    params: params as Record<string, number>,
  });

  it('returns features unchanged when no managers registered', () => {
    const features = [makeFeature('a', { depth: 10 })];
    expect(applyFeatureContext(features)).toEqual(features);
  });

  it('resolves EquationManager expressions', () => {
    const em = new EquationManager();
    em.set('thickness', '2.5');
    setEquationManager(em);
    const features = [makeFeature('a', { depth: 'thickness * 4' })];
    const r = applyFeatureContext(features);
    expect(r[0]!.params.depth).toBe(10);
  });
});

describe('applyFeatureContext — ConfigurationTable (A3)', () => {
  const makeFeature = (id: string, params: Record<string, number | string>): FeatureInstance => ({
    id,
    type: 'sketchExtrude',
    enabled: true,
    params: params as Record<string, number>,
  });

  it('registers and clears a ConfigurationTable slot', () => {
    expect(getConfigurationTable()).toBeNull();
    const t = new ConfigurationTable();
    setConfigurationTable(t);
    expect(getConfigurationTable()).toBe(t);
    setConfigurationTable(null);
    expect(getConfigurationTable()).toBeNull();
  });

  it('applies ConfigurationTable.resolveActive when set and a config is active', () => {
    const t = new ConfigurationTable();
    t.add('Small', { id: 'small' });
    t.setOverride('small', 'a', 'depth', 5);
    t.activate('small');
    setConfigurationTable(t);
    const r = applyFeatureContext([makeFeature('a', { depth: 10 })]);
    expect(r[0]!.params.depth).toBe(5);
  });

  it('passes features through when ConfigurationTable has no active config', () => {
    const t = new ConfigurationTable();
    t.add('Small', { id: 'small' });
    t.setOverride('small', 'a', 'depth', 5);
    t.activate(null);  // master
    setConfigurationTable(t);
    const r = applyFeatureContext([makeFeature('a', { depth: 10 })]);
    expect(r[0]!.params.depth).toBe(10);
  });

  it('chains EquationManager AFTER ConfigurationTable resolution', () => {
    const t = new ConfigurationTable();
    t.add('cfg', { id: 'cfg' });
    // Override 'b'.depth with a literal number — ConfigurationTable
    // resolves first, then equations evaluate any remaining string
    // params on the unaffected features.
    t.setOverride('cfg', 'b', 'depth', 99);
    t.activate('cfg');
    const em = new EquationManager();
    em.set('k', '4');
    setConfigurationTable(t);
    setEquationManager(em);
    const features = [makeFeature('a', { depth: 'k * 2' }), makeFeature('b', { depth: 10 })];
    const r = applyFeatureContext(features);
    expect(r[0]!.params.depth).toBe(8);   // equation resolved
    expect(r[1]!.params.depth).toBe(99);  // config override applied
  });

  it('resetFeatureContext clears the ConfigurationTable slot too', () => {
    const t = new ConfigurationTable();
    setConfigurationTable(t);
    resetFeatureContext();
    expect(getConfigurationTable()).toBeNull();
  });
});
