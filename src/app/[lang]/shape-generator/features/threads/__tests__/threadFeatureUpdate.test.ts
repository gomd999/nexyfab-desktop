/**
 * threads/__tests__/threadFeatureUpdate.test.ts — Wave 2 Phase 2 Track D6.
 *
 * Pure unit tests for the `updateThreadFeature` helper (spec §10.3 edit
 * in-place + validation policy). No React, no jsdom.
 */

import { describe, it, expect } from 'vitest';
import { makeThreadFeature } from '../threadFeature';
import {
  updateThreadFeature,
  updateThreadFeatureOrThrow,
} from '../threadFeatureUpdate';

function baseFeature() {
  return makeThreadFeature({
    id: 'feat_thread_test_1',
    threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
    length: 20,
    startOffset: 0,
  });
}

describe('updateThreadFeature — happy paths', () => {
  it('returns the same reference when the patch is empty', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, {});
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feature).toBe(f);
  });

  it('patches length to a new valid value', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { length: 30 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.feature.length).toBe(30);
      expect(r.feature.id).toBe(f.id);
      expect(r.feature).not.toBe(f); // fresh object
    }
  });

  it('patches direction LH→RH', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { threadDirection: 'left_hand' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feature.threadDirection).toBe('left_hand');
  });

  it('patches startOffset', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { startOffset: 2 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feature.startOffset).toBe(2);
  });

  it('patches threadKind (internal → external)', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { threadKind: 'external' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feature.threadKind).toBe('external');
  });

  it('patches class to a valid candidate', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { class: '7H' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feature.class).toBe('7H');
  });

  it('swaps the threadRef and snaps class to series default when old class is incompatible', () => {
    const f = baseFeature(); // class = '6H' (ISO)
    const r = updateThreadFeature(f, {
      threadRef: { series: 'UNC', designation: '1/4-20 UNC' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.feature.threadRef.series).toBe('UNC');
      expect(r.feature.threadRef.designation).toBe('1/4-20 UNC');
      // 6H is not a UNC class — must snap to default '2B'.
      expect(r.feature.class).toBe('2B');
    }
  });

  it('patches the parentFeatureId', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { parentFeatureId: 'feat_hole_42' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feature.parentFeatureId).toBe('feat_hole_42');
  });
});

describe('updateThreadFeature — validation rejects', () => {
  it('rejects unknown designation', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, {
      threadRef: { series: 'ISO_M_COARSE', designation: 'M-bogus' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unknown_designation');
  });

  it('rejects invalid class for current series', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { class: '2B' }); // UTS class on ISO
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid_class');
  });

  it('rejects negative length', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { length: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('length_range');
  });

  it('rejects NaN length', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { length: Number.NaN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('length_range');
  });

  it('rejects Infinity length', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { length: Number.POSITIVE_INFINITY });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('length_range');
  });

  it('rejects negative startOffset', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { startOffset: -0.5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('startoffset_negative');
  });

  it('rejects mode=geometric (W6 cosmetic-only)', () => {
    const f = baseFeature();
    const r = updateThreadFeature(f, { mode: 'geometric' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('geometric_unavailable');
  });
});

describe('updateThreadFeatureOrThrow', () => {
  it('returns the new feature on success', () => {
    const f = baseFeature();
    const next = updateThreadFeatureOrThrow(f, { length: 25 });
    expect(next.length).toBe(25);
  });

  it('throws on validation failure', () => {
    const f = baseFeature();
    expect(() => updateThreadFeatureOrThrow(f, { length: -1 })).toThrow();
  });
});

describe('label patch semantics (explicit `undefined` clears the label)', () => {
  it('clearing the label propagates the undefined', () => {
    const f = makeThreadFeature({
      id: 'feat_thread_label',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 10,
      label: 'foo',
    });
    const r = updateThreadFeature(f, { label: undefined });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feature.label).toBeUndefined();
  });

  it('omitting the label preserves it', () => {
    const f = makeThreadFeature({
      id: 'feat_thread_label_2',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 10,
      label: 'foo',
    });
    const r = updateThreadFeature(f, { length: 15 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feature.label).toBe('foo');
  });
});
