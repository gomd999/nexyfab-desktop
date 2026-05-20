import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigurationManager } from '../config/configurationManager';
import { EquationManager } from '../equations/equationManager';
import {
  setConfigurationManager,
  getConfigurationManager,
  setEquationManager,
  getEquationManager,
  resetFeatureContext,
  applyFeatureContext,
} from './featureContext';
import type { FeatureInstance } from './types';

beforeEach(() => resetFeatureContext());

describe('featureContext singletons', () => {
  it('starts empty', () => {
    expect(getConfigurationManager()).toBeNull();
    expect(getEquationManager()).toBeNull();
  });

  it('stores and clears managers', () => {
    const cm = new ConfigurationManager();
    const em = new EquationManager();
    setConfigurationManager(cm);
    setEquationManager(em);
    expect(getConfigurationManager()).toBe(cm);
    expect(getEquationManager()).toBe(em);
    resetFeatureContext();
    expect(getConfigurationManager()).toBeNull();
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

  it('applies ConfigurationManager overrides', () => {
    const cm = new ConfigurationManager();
    cm.add({ id: 'small', name: 'Small' });
    cm.setOverride('small', 'a', 'depth', 5);
    cm.activate('small');
    setConfigurationManager(cm);
    const features = [makeFeature('a', { depth: 10 })];
    const r = applyFeatureContext(features);
    expect(r[0]!.params.depth).toBe(5);
  });

  it('resolves EquationManager expressions', () => {
    const em = new EquationManager();
    em.set('thickness', '2.5');
    setEquationManager(em);
    const features = [makeFeature('a', { depth: 'thickness * 4' })];
    const r = applyFeatureContext(features);
    expect(r[0]!.params.depth).toBe(10);
  });

  it('applies config first, equations second (config can reference a const, equations resolve)', () => {
    const cm = new ConfigurationManager();
    const em = new EquationManager();
    cm.add({ id: 'cfg', name: 'X' });
    cm.setOverride('cfg', 'a', 'depth', 7);
    cm.activate('cfg');
    em.set('k', '3');
    setConfigurationManager(cm);
    setEquationManager(em);
    const features = [makeFeature('a', { depth: 10 }), makeFeature('b', { depth: 'k * 2' })];
    const r = applyFeatureContext(features);
    expect(r[0]!.params.depth).toBe(7);  // config override wins
    expect(r[1]!.params.depth).toBe(6);  // equation resolved
  });
});
