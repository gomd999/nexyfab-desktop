import { describe, it, expect } from 'vitest';
import { applyRefinement, applyRefinements, revertTo } from '../multiTurn';
import type { IntentInput } from '@/lib/openscad-render/intentToScad';

const baseBox: IntentInput = {
  shapeId: 'box',
  params: { width_mm: 50, height_mm: 30, depth_mm: 20 },
  features: [
    { type: 'hole', params: { diameter_mm: 8 } },
    { type: 'fillet', params: { radius_mm: 2 } },
  ],
};

describe('applyRefinement · set-param', () => {
  it('updates an existing param', () => {
    const r = applyRefinement(baseBox, { kind: 'set-param', key: 'height_mm', value: 100 });
    expect(r.ok).toBe(true);
    expect(r.intent.params.height_mm).toBe(100);
    expect(r.intent.params.width_mm).toBe(50); // others untouched
  });

  it('adds a new param if not present', () => {
    const r = applyRefinement(baseBox, { kind: 'set-param', key: 'newKey', value: 42 });
    expect(r.intent.params.newKey).toBe(42);
  });

  it('rejects non-finite values', () => {
    const r = applyRefinement(baseBox, { kind: 'set-param', key: 'height_mm', value: NaN });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/finite/);
  });

  it('does not mutate the input intent', () => {
    applyRefinement(baseBox, { kind: 'set-param', key: 'height_mm', value: 100 });
    expect(baseBox.params.height_mm).toBe(30);
  });
});

describe('applyRefinement · scale-param', () => {
  it('multiplies the existing value by the factor', () => {
    const r = applyRefinement(baseBox, { kind: 'scale-param', key: 'height_mm', factor: 2 });
    expect(r.intent.params.height_mm).toBe(60);
  });

  it('rejects zero / negative factors', () => {
    expect(applyRefinement(baseBox, { kind: 'scale-param', key: 'height_mm', factor: 0 }).ok).toBe(false);
    expect(applyRefinement(baseBox, { kind: 'scale-param', key: 'height_mm', factor: -1 }).ok).toBe(false);
  });

  it('rejects missing param key', () => {
    const r = applyRefinement(baseBox, { kind: 'scale-param', key: 'ghost', factor: 2 });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/not set/);
  });
});

describe('applyRefinement · feature ops', () => {
  it('adds a new feature to the end of the list', () => {
    const r = applyRefinement(baseBox, {
      kind: 'add-feature', type: 'chamfer', params: { size_mm: 1 },
    });
    expect(r.intent.features).toHaveLength(3);
    expect(r.intent.features?.[2].type).toBe('chamfer');
  });

  it('initialises the features array when absent', () => {
    const bare: IntentInput = { shapeId: 'sphere', params: { diameter_mm: 30 } };
    const r = applyRefinement(bare, { kind: 'add-feature', type: 'shell' });
    expect(r.intent.features).toEqual([{ type: 'shell', params: undefined }]);
  });

  it('removes a feature at the given index', () => {
    const r = applyRefinement(baseBox, { kind: 'remove-feature', index: 0 });
    expect(r.intent.features).toHaveLength(1);
    expect(r.intent.features?.[0].type).toBe('fillet');
  });

  it('rejects out-of-range remove-feature index', () => {
    expect(applyRefinement(baseBox, { kind: 'remove-feature', index: 99 }).ok).toBe(false);
    expect(applyRefinement(baseBox, { kind: 'remove-feature', index: -1 }).ok).toBe(false);
  });

  it('updates a single feature param', () => {
    const r = applyRefinement(baseBox, {
      kind: 'update-feature-param', index: 0, key: 'diameter_mm', value: 12,
    });
    expect(r.intent.features?.[0].params?.diameter_mm).toBe(12);
  });

  it('toggle-feature flips the enabled flag (defaults to true → false)', () => {
    const r = applyRefinement(baseBox, { kind: 'toggle-feature', index: 0 });
    expect(r.intent.features?.[0].enabled).toBe(false);
    const r2 = applyRefinement(r.intent, { kind: 'toggle-feature', index: 0 });
    expect(r2.intent.features?.[0].enabled).toBe(true);
  });
});

describe('applyRefinement · change-shape', () => {
  it('swaps shapeId while preserving params', () => {
    const r = applyRefinement(baseBox, { kind: 'change-shape', shapeId: 'sphere' });
    expect(r.intent.shapeId).toBe('sphere');
    expect(r.intent.params).toEqual(baseBox.params);
  });

  it('rejects empty shapeId', () => {
    const r = applyRefinement(baseBox, { kind: 'change-shape', shapeId: '' });
    expect(r.ok).toBe(false);
  });
});

describe('applyRefinements · batch', () => {
  it('chains ops and produces a history entry per op', () => {
    let n = 0;
    const r = applyRefinements(baseBox, [
      { kind: 'set-param', key: 'height_mm', value: 100 },
      { kind: 'scale-param', key: 'width_mm', factor: 2 },
      { kind: 'add-feature', type: 'shell', params: { thickness_mm: 1 } },
    ], () => ++n);
    expect(r.intent.params.height_mm).toBe(100);
    expect(r.intent.params.width_mm).toBe(100);
    expect(r.intent.features).toHaveLength(3);
    expect(r.history).toHaveLength(3);
    expect(r.history[0].appliedAt).toBe(1);
    expect(r.history[2].appliedAt).toBe(3);
    expect(r.errors).toHaveLength(0);
  });

  it('continues past failed ops, accumulating errors', () => {
    const r = applyRefinements(baseBox, [
      { kind: 'set-param', key: 'height_mm', value: 100 },
      { kind: 'remove-feature', index: 999 },             // fails
      { kind: 'scale-param', key: 'height_mm', factor: 2 }, // applies on top
    ]);
    expect(r.intent.params.height_mm).toBe(200);
    expect(r.errors.length).toBe(1);
  });
});

describe('revertTo', () => {
  it('returns the base intent when index ≤ 0', () => {
    const r = applyRefinements(baseBox, [
      { kind: 'set-param', key: 'height_mm', value: 100 },
    ]);
    const reverted = revertTo(baseBox, r.history, 0);
    expect(reverted.params.height_mm).toBe(30);
  });

  it('returns the snapshot at the given history index', () => {
    const r = applyRefinements(baseBox, [
      { kind: 'set-param', key: 'height_mm', value: 100 },
      { kind: 'set-param', key: 'height_mm', value: 200 },
    ]);
    const reverted = revertTo(baseBox, r.history, 1);
    expect(reverted.params.height_mm).toBe(100);
  });

  it('clamps over-large indices to the most recent snapshot', () => {
    const r = applyRefinements(baseBox, [
      { kind: 'set-param', key: 'height_mm', value: 100 },
    ]);
    const reverted = revertTo(baseBox, r.history, 99);
    expect(reverted.params.height_mm).toBe(100);
  });
});
