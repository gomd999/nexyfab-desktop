/**
 * validateModel.test.ts — sanity checks for ConfigurationTable
 * against the master feature tree.
 */
import { describe, it, expect } from 'vitest';
import { ConfigurationTable } from '../ConfigurationTable';
import { validateModel } from '../validateModel';
import type { FeatureInstance } from '../../features/types';

function feat(id: string): FeatureInstance {
  return {
    id,
    type: 'fillet' as unknown as FeatureInstance['type'],
    params: { r: 1 },
    enabled: true,
  };
}

const masters: FeatureInstance[] = [feat('f1'), feat('f2'), feat('f3')];

describe('validateModel', () => {
  it('returns ok for an empty table', () => {
    const t = new ConfigurationTable();
    expect(validateModel(t, masters)).toEqual({ ok: true });
  });

  it('returns ok for valid configs', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.setOverride('a', 'f1', 'r', 5);
    expect(validateModel(t, masters)).toEqual({ ok: true });
  });

  it('flags unknown_feature override', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.setOverride('a', 'ghost-feature', 'r', 5);
    const r = validateModel(t, masters);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({ configId: 'a', kind: 'unknown_feature' }),
      );
    }
  });

  it('fromJSON drops dangling parentId so validateModel stays clean (codec-cleanup)', () => {
    // Note: the unknown_parent error kind is wired but unreachable via
    // setParent (rejected) or fromJSON (cleaned). It remains for future
    // ingest paths (e.g. CRDT merge race in A5) that may skip cleanup.
    const t = ConfigurationTable.fromJSON({
      configs: [
        { id: 'a', name: 'A', parentId: 'gone', overrides: {}, expressionVars: {} },
      ],
      activeConfigId: null,
      globalVars: {},
    });
    expect(t.get('a')!.parentId).toBeUndefined();
    expect(validateModel(t, masters)).toEqual({ ok: true });
  });

  it('flags parent_cycle', () => {
    // We have to construct a cycle that bypasses setParent's check.
    // Use direct snapshot: fromJSON does not check cycles (only
    // dangling parents), so a hand-built loop survives ingest.
    const t = ConfigurationTable.fromJSON({
      configs: [
        { id: 'a', name: 'A', parentId: 'b', overrides: {}, expressionVars: {} },
        { id: 'b', name: 'B', parentId: 'a', overrides: {}, expressionVars: {} },
      ],
      activeConfigId: null,
      globalVars: {},
    });
    const r = validateModel(t, masters);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const cycleErrors = r.errors.filter(e => e.kind === 'parent_cycle');
      expect(cycleErrors.length).toBeGreaterThanOrEqual(2);  // both a and b flagged
      expect(cycleErrors.map(e => e.configId).sort()).toEqual(['a', 'b']);
    }
  });

  it('flags undefined_var in expressionVars', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.setExpressionVar('a', 'derived', 'bolt_d * 2');  // bolt_d not defined
    const r = validateModel(t, masters);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({
          configId: 'a',
          kind: 'undefined_var',
          detail: expect.stringContaining('bolt_d'),
        }),
      );
    }
  });

  it('flags undefined_var in per-feature override', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.setOverride('a', 'f1', 'r', 'mystery_var + 1');
    const r = validateModel(t, masters);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toContainEqual(
        expect.objectContaining({
          configId: 'a',
          kind: 'undefined_var',
          detail: expect.stringContaining('mystery_var'),
        }),
      );
    }
  });

  it('undefined_var is suppressed when var is defined as globalVar', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.setGlobalVar('bolt_d', 4);
    t.setOverride('a', 'f1', 'r', 'bolt_d * 2');
    expect(validateModel(t, masters)).toEqual({ ok: true });
  });

  it('undefined_var is suppressed when var is defined in config expressionVars', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.setExpressionVar('a', 'local_d', 5);
    t.setOverride('a', 'f1', 'r', 'local_d / 2');
    expect(validateModel(t, masters)).toEqual({ ok: true });
  });

  it('expressionVars from parent chain count as in-scope', () => {
    const t = new ConfigurationTable();
    t.add('Parent', { id: 'p' });
    t.add('Child', { id: 'c', parentId: 'p' });
    t.setExpressionVar('p', 'bolt_d', 4);
    t.setOverride('c', 'f1', 'r', 'bolt_d * 0.5');
    expect(validateModel(t, masters)).toEqual({ ok: true });
  });

  it('known function names (sin, cos, pow, ...) are not flagged', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.setGlobalVar('angle', 30);
    t.setOverride('a', 'f1', 'r', 'sin(angle) * 2 + pow(2, 3)');
    expect(validateModel(t, masters)).toEqual({ ok: true });
  });

  it('numeric literals (5, 3.14) are not flagged', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.setOverride('a', 'f1', 'r', '5 * 3.14 + 2');
    expect(validateModel(t, masters)).toEqual({ ok: true });
  });

  it('aggregates multiple errors in one pass', () => {
    const t = new ConfigurationTable();
    t.add('A', { id: 'a' });
    t.setOverride('a', 'ghost', 'r', 5);  // unknown_feature
    t.setExpressionVar('a', 'd', 'unknown_var + 1');  // undefined_var
    t.setOverride('a', 'f1', 'r', 'another_missing');  // undefined_var
    const r = validateModel(t, masters);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const kinds = new Set(r.errors.map(e => e.kind));
      expect(kinds.has('unknown_feature')).toBe(true);
      expect(kinds.has('undefined_var')).toBe(true);
      expect(r.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('cycle members are not also flagged for undefined_var (avoids noise)', () => {
    const t = ConfigurationTable.fromJSON({
      configs: [
        {
          id: 'a',
          name: 'A',
          parentId: 'b',
          overrides: { f1: { params: { r: 'mystery + 1' } } },
          expressionVars: {},
        },
        { id: 'b', name: 'B', parentId: 'a', overrides: {}, expressionVars: {} },
      ],
      activeConfigId: null,
      globalVars: {},
    });
    const r = validateModel(t, masters);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // a has a cycle error AND no undefined_var (because we skip
      // scope checks for cycle members).
      const aErrors = r.errors.filter(e => e.configId === 'a');
      expect(aErrors.some(e => e.kind === 'parent_cycle')).toBe(true);
      expect(aErrors.some(e => e.kind === 'undefined_var')).toBe(false);
    }
  });
});
