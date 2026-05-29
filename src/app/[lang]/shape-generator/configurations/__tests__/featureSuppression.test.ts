/**
 * featureSuppression.test.ts — Phase 5f helper regression.
 *
 * Pure unit tests, no DOM, no pipeline.
 */

import { describe, it, expect } from 'vitest';
import type { FeatureInstance } from '../../features/types';
import {
  applyFeatureEnabledMap,
  applyAndPruneFeatureEnabledMap,
  countSuppressionDelta,
} from '../featureSuppression';

function feat(id: string, enabled = true): FeatureInstance {
  return { id, type: 'extrude' as FeatureInstance['type'], params: {}, enabled };
}

describe('applyFeatureEnabledMap', () => {
  it('undefined enabledMap → returns a shallow copy (no mutations, no flips)', () => {
    const f = [feat('a'), feat('b', false)];
    const r = applyFeatureEnabledMap(f, undefined);
    expect(r).toEqual(f);
    // Each entry is preserved by reference (we only clone on actual flips).
    expect(r[0]).toBe(f[0]);
    expect(r[1]).toBe(f[1]);
  });

  it('null enabledMap → same no-op as undefined', () => {
    const f = [feat('a')];
    expect(applyFeatureEnabledMap(f, null)).toEqual(f);
  });

  it('empty map → identity (all features unchanged)', () => {
    const f = [feat('a'), feat('b', false)];
    const r = applyFeatureEnabledMap(f, {});
    expect(r[0]).toBe(f[0]);
    expect(r[1]).toBe(f[1]);
  });

  it('map says false → enabled flips to false (cloned entry)', () => {
    const f = [feat('a', true), feat('b', true)];
    const r = applyFeatureEnabledMap(f, { a: false });
    expect(r[0].enabled).toBe(false);
    expect(r[0]).not.toBe(f[0]); // cloned
    expect(r[1]).toBe(f[1]);     // unchanged → same ref
  });

  it('map says true on already-disabled → flips back to enabled', () => {
    const f = [feat('a', false)];
    const r = applyFeatureEnabledMap(f, { a: true });
    expect(r[0].enabled).toBe(true);
    expect(r[0]).not.toBe(f[0]);
  });

  it('map entry matches current state → no clone', () => {
    const f = [feat('a', true), feat('b', false)];
    const r = applyFeatureEnabledMap(f, { a: true, b: false });
    expect(r[0]).toBe(f[0]);
    expect(r[1]).toBe(f[1]);
  });

  it('unknown id in map → no effect on existing features', () => {
    const f = [feat('a'), feat('b')];
    const r = applyFeatureEnabledMap(f, { ghost: false });
    expect(r).toEqual(f);
    expect(r[0]).toBe(f[0]);
  });

  it('mixed: one flip + one no-change + one unchanged', () => {
    const f = [feat('a', true), feat('b', true), feat('c', true)];
    const r = applyFeatureEnabledMap(f, { a: false, b: true });
    expect(r[0].enabled).toBe(false); // flipped
    expect(r[1]).toBe(f[1]);          // map=true, current=true → no clone
    expect(r[2]).toBe(f[2]);          // not in map
  });

  it('does not mutate the input array or feature objects', () => {
    const f = [feat('a', true)];
    const before = f.map((x) => ({ ...x }));
    applyFeatureEnabledMap(f, { a: false });
    expect(f).toEqual(before);
  });
});

describe('applyAndPruneFeatureEnabledMap', () => {
  it('drops disabled features after applying the map', () => {
    const f = [feat('a', true), feat('b', true), feat('c', true)];
    const r = applyAndPruneFeatureEnabledMap(f, { a: false });
    expect(r.map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('keeps an already-disabled feature out of the result even when map is silent on it', () => {
    const f = [feat('a', false), feat('b', true)];
    const r = applyAndPruneFeatureEnabledMap(f, undefined);
    expect(r.map((x) => x.id)).toEqual(['b']);
  });
});

describe('countSuppressionDelta', () => {
  it('undefined map → all zero', () => {
    expect(countSuppressionDelta([feat('a')], undefined)).toEqual({
      flipped: 0, suppressed: 0, restored: 0,
    });
  });

  it('counts suppressed + restored separately', () => {
    const f = [feat('a', true), feat('b', false), feat('c', true)];
    const r = countSuppressionDelta(f, { a: false, b: true });
    expect(r).toEqual({ flipped: 2, suppressed: 1, restored: 1 });
  });

  it('no-op map entries (same as current) → not counted', () => {
    const f = [feat('a', true), feat('b', false)];
    const r = countSuppressionDelta(f, { a: true, b: false });
    expect(r).toEqual({ flipped: 0, suppressed: 0, restored: 0 });
  });
});
