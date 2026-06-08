/**
 * pluginCompat — plugin SDK ecosystem hardening: API-version compatibility,
 * manifest validation, and dependency ordering. Pure validators + the registry
 * gate. Headless (no React).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  isApiCompatible,
  validateManifest,
  PLUGIN_API_VERSION,
  type PluginManifest,
  type PluginContext,
} from '../PluginAPI';
import { pluginRegistry } from '../PluginRegistry';

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'acme.gadget',
    name: 'Gadget',
    version: '1.0.0',
    author: 'ACME',
    description: 'a test plugin',
    apiVersion: PLUGIN_API_VERSION,
    ...over,
  };
}

const noopCtx = (): PluginContext => ({
  getSelectedShape: () => '',
  getParams: () => ({}),
  getGeometry: () => null,
  setParam: () => {},
  addFeature: () => {},
  showToast: () => {},
  registerToolbarButton: () => {},
  registerPanel: () => {},
  registerShape: () => {},
});

describe('isApiCompatible', () => {
  it('same major + required minor ≤ host minor → compatible', () => {
    expect(isApiCompatible('1.0.0', '1.0.0')).toBe(true);
    expect(isApiCompatible('1.0.0', '1.4.0')).toBe(true); // host added minor features
  });
  it('different major → incompatible (breaking host change)', () => {
    expect(isApiCompatible('2.0.0', '1.0.0')).toBe(false);
    expect(isApiCompatible('0.9.0', '1.0.0')).toBe(false);
  });
  it('required minor > host minor → incompatible (needs newer host)', () => {
    expect(isApiCompatible('1.5.0', '1.2.0')).toBe(false);
  });
  it('malformed version → incompatible', () => {
    expect(isApiCompatible('garbage', '1.0.0')).toBe(false);
  });
});

describe('validateManifest', () => {
  it('accepts a well-formed, compatible manifest', () => {
    expect(validateManifest(manifest())).toEqual({ ok: true });
  });
  it('rejects an invalid id', () => {
    expect(validateManifest(manifest({ id: 'has spaces!' })).ok).toBe(false);
  });
  it('rejects a missing apiVersion', () => {
    expect(validateManifest(manifest({ apiVersion: '' })).reason).toMatch(/apiVersion is required/);
  });
  it('rejects an incompatible apiVersion', () => {
    expect(validateManifest(manifest({ apiVersion: '2.0.0' })).reason).toMatch(/incompatible/);
  });
});

describe('pluginRegistry registration gate', () => {
  beforeEach(() => pluginRegistry.clear());

  it('registers a valid plugin', () => {
    expect(pluginRegistry.registerPlugin(manifest(), () => {}, noopCtx)).toBe(true);
    expect(pluginRegistry.getPlugin('acme.gadget')).toBeDefined();
  });

  it('rejects an API-incompatible plugin', () => {
    const m = manifest({ id: 'acme.future', apiVersion: '2.0.0' });
    expect(pluginRegistry.canRegister(m).reason).toMatch(/incompatible/);
    expect(pluginRegistry.registerPlugin(m, () => {}, noopCtx)).toBe(false);
  });

  it('rejects a plugin whose dependency is not registered', () => {
    const m = manifest({ id: 'acme.addon', dependencies: ['acme.base'] });
    expect(pluginRegistry.canRegister(m).reason).toMatch(/missing dependency/);
    expect(pluginRegistry.registerPlugin(m, () => {}, noopCtx)).toBe(false);
  });

  it('registers a dependent plugin once its dependency is present', () => {
    pluginRegistry.registerPlugin(manifest({ id: 'acme.base' }), () => {}, noopCtx);
    const m = manifest({ id: 'acme.addon', dependencies: ['acme.base'] });
    expect(pluginRegistry.canRegister(m)).toEqual({ ok: true });
    expect(pluginRegistry.registerPlugin(m, () => {}, noopCtx)).toBe(true);
  });

  it('rejects a duplicate id', () => {
    pluginRegistry.registerPlugin(manifest(), () => {}, noopCtx);
    expect(pluginRegistry.registerPlugin(manifest(), () => {}, noopCtx)).toBe(false);
  });
});
