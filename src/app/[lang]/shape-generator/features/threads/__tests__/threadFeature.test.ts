/**
 * threadFeature.test.ts — Wave 2 Phase 2 Track D5 (W5).
 *
 * Type construction + callout formatting per series.
 */

import { describe, it, expect } from 'vitest';
import {
  makeThreadFeature,
  formatThreadCallout,
  type ThreadFeature,
} from '../threadFeature';
import { findThreadRow } from '../threadCatalog';

describe('makeThreadFeature — construction + defaults', () => {
  it('builds a minimal cosmetic M8 feature with sensible defaults', () => {
    const f = makeThreadFeature({
      id: 'feat_thread_1',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
    });
    expect(f.featureType).toBe('thread');
    expect(f.threadKind).toBe('internal');
    expect(f.mode).toBe('cosmetic');
    expect(f.threadDirection).toBe('right_hand');
    expect(f.class).toBe('6H'); // default per ISO 965 internal
    expect(f.startOffset).toBe(0);
    expect(f.length).toBe(20);
  });

  it('honours an explicit class when valid', () => {
    const f = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 10,
      class: '7H',
    });
    expect(f.class).toBe('7H');
  });

  it('throws when designation is not in the catalog', () => {
    expect(() =>
      makeThreadFeature({
        id: 'f',
        threadRef: { series: 'ISO_M_COARSE', designation: 'M-bogus' },
        length: 5,
      }),
    ).toThrow(/unknown thread/i);
  });

  it('throws when class is not in classCandidates for the series', () => {
    expect(() =>
      makeThreadFeature({
        id: 'f',
        threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
        length: 5,
        class: '2B', // 2B is a UTS class — invalid for ISO M
      }),
    ).toThrow(/class "2B" is not valid/);
  });

  it('throws when length is negative or non-finite', () => {
    expect(() =>
      makeThreadFeature({
        id: 'f',
        threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
        length: -1,
      }),
    ).toThrow(/length/);
    expect(() =>
      makeThreadFeature({
        id: 'f',
        threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
        length: Infinity,
      }),
    ).toThrow(/length/);
  });

  it('preserves parentFeatureId when supplied', () => {
    const f = makeThreadFeature({
      id: 'f',
      parentFeatureId: 'feat_hole_42',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 10,
    });
    expect(f.parentFeatureId).toBe('feat_hole_42');
  });
});

describe('formatThreadCallout — ISO 6410-1 / ASME Y14.6 conventions', () => {
  function f(
    series: ThreadFeature['threadRef']['series'],
    designation: string,
    overrides: Partial<ThreadFeature> = {},
  ): ThreadFeature {
    return makeThreadFeature({
      id: 'f',
      threadRef: { series, designation },
      length: overrides.length ?? 20,
      class: overrides.class,
      threadDirection: overrides.threadDirection,
    });
  }

  it('ISO M coarse suppresses pitch — "M8-6H ↧ 20"', () => {
    expect(formatThreadCallout(f('ISO_M_COARSE', 'M8'))).toBe('M8-6H ↧ 20');
  });

  it('ISO M fine prints the pitch — "M10×1.25-6H ↧ 15"', () => {
    expect(formatThreadCallout(f('ISO_M_FINE', 'M10×1.25', { length: 15 }))).toBe('M10×1.25-6H ↧ 15');
  });

  it('UNC keeps the series tag — "1/4-20 UNC-2B ↧ 20"', () => {
    expect(formatThreadCallout(f('UNC', '1/4-20 UNC'))).toBe('1/4-20 UNC-2B ↧ 20');
  });

  it('UNF keeps the series tag — "1/4-28 UNF-2B ↧ 20"', () => {
    expect(formatThreadCallout(f('UNF', '1/4-28 UNF'))).toBe('1/4-28 UNF-2B ↧ 20');
  });

  it('NPT omits class by default — "NPT 1/2 ↧ 20"', () => {
    expect(formatThreadCallout(f('NPT', 'NPT 1/2'))).toBe('NPT 1/2 ↧ 20');
  });

  it('NPT can include class on request — "NPT 1/2-A ↧ 20"', () => {
    const row = findThreadRow('NPT', 'NPT 1/2');
    expect(formatThreadCallout(f('NPT', 'NPT 1/2'), row, { includeClassForNpt: true })).toBe(
      'NPT 1/2-A ↧ 20',
    );
  });

  it('BSP_PARALLEL includes class — "G 1/4-B ↧ 20"', () => {
    expect(formatThreadCallout(f('BSP_PARALLEL', 'G 1/4'))).toBe('G 1/4-B ↧ 20');
  });

  it('BSP_TAPERED omits class by default — "Rc 1/4 ↧ 20"', () => {
    expect(formatThreadCallout(f('BSP_TAPERED', 'Rc 1/4'))).toBe('Rc 1/4 ↧ 20');
  });

  it('left-hand threads append "LH" before the depth suffix', () => {
    const feature = f('ISO_M_COARSE', 'M8', { threadDirection: 'left_hand' });
    expect(formatThreadCallout(feature)).toBe('M8-6H LH ↧ 20');
  });

  it('length=0 (annotation-only) suppresses the depth suffix', () => {
    const feature = f('ISO_M_COARSE', 'M8', { length: 0 });
    expect(formatThreadCallout(feature)).toBe('M8-6H');
  });

  it('falls back to bare designation when row is not in the catalog', () => {
    const bad: ThreadFeature = {
      id: 'x',
      featureType: 'thread',
      threadKind: 'internal',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M-bogus' },
      class: '6H',
      mode: 'cosmetic',
      threadDirection: 'right_hand',
      length: 10,
      startOffset: 0,
    };
    expect(formatThreadCallout(bad)).toBe('M-bogus');
  });
});
