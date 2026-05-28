/**
 * migrateFromV1.test.ts — A3 hot-swap helper coverage.
 *
 * Verifies that legacy `NfabConfigurationV1[]` arrays load into a
 * fresh `ConfigurationTable` with the documented mapping:
 *   - featureEnabled: false → suppressed: true
 *   - params (number) → expressionVars
 *   - paramExpressions (string) → expressionVars
 *   - activeId honoured when present
 */

import { describe, it, expect } from 'vitest';
import { migrateFromV1 } from '../migrateFromV1';
import type { NfabConfigurationV1 } from '../../io/nfabFormat';
import type { FeatureInstance } from '../../features/types';

function feat(id: string, params: Record<string, number>): FeatureInstance {
  return {
    id,
    type: 'fillet' as unknown as FeatureInstance['type'],
    params,
    enabled: true,
  };
}

describe('migrateFromV1 — empty / null input', () => {
  it('returns a fresh empty table for empty array', () => {
    const t = migrateFromV1([]);
    expect(t.list()).toEqual([]);
    expect(t.getActiveId()).toBeNull();
  });

  it('returns a fresh empty table for undefined input', () => {
    const t = migrateFromV1(undefined);
    expect(t.list()).toEqual([]);
    expect(t.getActiveId()).toBeNull();
  });
});

describe('migrateFromV1 — single config', () => {
  it('maps id + name verbatim', () => {
    const v1: NfabConfigurationV1[] = [
      { id: 'm3', name: 'M3', params: {}, featureEnabled: {} },
    ];
    const t = migrateFromV1(v1);
    const e = t.get('m3');
    expect(e?.name).toBe('M3');
    expect(e?.id).toBe('m3');
    expect(e?.parentId).toBeUndefined();
  });

  it('does not auto-activate when no activeId passed (master is default)', () => {
    const v1: NfabConfigurationV1[] = [
      { id: 'm3', name: 'M3', params: {}, featureEnabled: {} },
    ];
    const t = migrateFromV1(v1);
    expect(t.getActiveId()).toBeNull();
  });

  it('activates the requested config when activeId resolves', () => {
    const v1: NfabConfigurationV1[] = [
      { id: 'm3', name: 'M3', params: {}, featureEnabled: {} },
    ];
    const t = migrateFromV1(v1, 'm3');
    expect(t.getActiveId()).toBe('m3');
  });

  it('falls back to master when activeId is unknown', () => {
    const v1: NfabConfigurationV1[] = [
      { id: 'm3', name: 'M3', params: {}, featureEnabled: {} },
    ];
    const t = migrateFromV1(v1, 'm999');
    expect(t.getActiveId()).toBeNull();
  });
});

describe('migrateFromV1 — multi-config', () => {
  it('preserves order + ids of multiple entries', () => {
    const v1: NfabConfigurationV1[] = [
      { id: 'm3', name: 'M3', params: {}, featureEnabled: {} },
      { id: 'm4', name: 'M4', params: {}, featureEnabled: {} },
      { id: 'm5', name: 'M5', params: {}, featureEnabled: {} },
    ];
    const t = migrateFromV1(v1, 'm4');
    expect(t.ids()).toEqual(['m3', 'm4', 'm5']);
    expect(t.getActiveId()).toBe('m4');
  });

  it('skips malformed entries', () => {
    const v1 = [
      { id: 'm3', name: 'M3', params: {}, featureEnabled: {} },
      // Missing id — should be dropped.
      { name: 'broken', params: {}, featureEnabled: {} } as unknown as NfabConfigurationV1,
      null as unknown as NfabConfigurationV1,
      { id: 'm5', name: 'M5', params: {}, featureEnabled: {} },
    ];
    const t = migrateFromV1(v1);
    expect(t.ids()).toEqual(['m3', 'm5']);
  });
});

describe('migrateFromV1 — paramExpressions / expressionVars', () => {
  it('maps numeric params into expressionVars', () => {
    const v1: NfabConfigurationV1[] = [
      {
        id: 'cfg-a',
        name: 'A',
        params: { thickness: 5, radius: 10 },
        featureEnabled: {},
      },
    ];
    const t = migrateFromV1(v1);
    const e = t.get('cfg-a');
    expect(e?.expressionVars).toEqual({ thickness: 5, radius: 10 });
  });

  it('maps string paramExpressions into expressionVars', () => {
    const v1: NfabConfigurationV1[] = [
      {
        id: 'cfg-a',
        name: 'A',
        params: { thickness: 5 },
        paramExpressions: { depth: 'thickness * 4' },
        featureEnabled: {},
      },
    ];
    const t = migrateFromV1(v1);
    const e = t.get('cfg-a');
    expect(e?.expressionVars.thickness).toBe(5);
    expect(e?.expressionVars.depth).toBe('thickness * 4');
  });

  it('ignores non-finite numeric params (NaN / Infinity)', () => {
    const v1: NfabConfigurationV1[] = [
      {
        id: 'cfg-a',
        name: 'A',
        params: { good: 5, bad: NaN, infi: Infinity },
        featureEnabled: {},
      },
    ];
    const t = migrateFromV1(v1);
    const e = t.get('cfg-a');
    expect(e?.expressionVars).toEqual({ good: 5 });
  });
});

describe('migrateFromV1 — featureEnabled → suppress overrides', () => {
  it('translates enabled: false → suppressed: true', () => {
    const v1: NfabConfigurationV1[] = [
      {
        id: 'open',
        name: 'Open',
        params: {},
        featureEnabled: { 'jaw-rotation': false, 'base-extrude': true },
      },
    ];
    const t = migrateFromV1(v1);

    // Resolution test: suppressed feature is dropped from the
    // resolved list when this config is active.
    t.activate('open');
    const features = [
      feat('jaw-rotation', { angle: 30 }),
      feat('base-extrude', { depth: 10 }),
    ];
    const resolved = t.resolveActive(features);
    expect(resolved.map(f => f.id)).toEqual(['base-extrude']);
  });

  it('parent inheritance is intentionally NOT carried over (V1 had no parents)', () => {
    // V1's featureEnabled is a flat map per config; there's no
    // implicit parent. Migrating two configs that look "similar"
    // does NOT establish a parent link.
    const v1: NfabConfigurationV1[] = [
      {
        id: 'open',
        name: 'Open',
        params: {},
        featureEnabled: { 'jaw-rotation': false },
      },
      {
        id: 'open-wide',
        name: 'Open Wide',
        params: {},
        // Same suppress as 'open', different name. V1 had no parent
        // field; migration leaves both at parentId=undefined and the
        // user can re-parent via A4 UI.
        featureEnabled: { 'jaw-rotation': false },
      },
    ];
    const t = migrateFromV1(v1);
    expect(t.get('open')?.parentId).toBeUndefined();
    expect(t.get('open-wide')?.parentId).toBeUndefined();
  });
});

describe('migrateFromV1 — resolution behaviour after migration', () => {
  it('resolved feature list matches V1 semantics for a simple config', () => {
    // Master has 3 features. Config 'm4' has thickness param + one
    // suppressed feature. Resolution should drop the suppressed one
    // and pass the rest through (params handled by EquationManager
    // when wired, not by ConfigurationTable's number coercion).
    const v1: NfabConfigurationV1[] = [
      {
        id: 'm4',
        name: 'M4',
        params: { thickness: 4 },
        featureEnabled: { 'old-chamfer': false },
      },
    ];
    const t = migrateFromV1(v1, 'm4');
    const features = [
      feat('base', { depth: 10 }),
      feat('old-chamfer', { radius: 2 }),
      feat('thread', { pitch: 0.7 }),
    ];
    const resolved = t.resolveActive(features);
    expect(resolved.map(f => f.id)).toEqual(['base', 'thread']);
    // expressionVars are NOT applied to feature params by ConfigurationTable
    // directly — that's EquationManager's job in applyFeatureContext.
    expect(resolved[0]!.params.depth).toBe(10);
  });
});
