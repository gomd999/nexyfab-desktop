/**
 * threadStepIo.test.ts — Wave 2 Phase 2 Track D Week 8 (D8).
 *
 * STEP round-trip + parsing-robustness coverage. The fixture
 * `tests/fixtures/F-THREAD-STEP-01.json` is the golden case.
 */

import { describe, it, expect } from 'vitest';
import {
  threadFeatureToStepMetadata,
  threadStepMetadataToBlob,
  parseThreadStepBlob,
  parseThreadStepMetadata,
  roundTripThreadStep,
  THREAD_STEP_METADATA_VERSION,
} from '../threadStepIo';
import { makeThreadFeature, type ThreadFeature } from '../threadFeature';

import fixture from '../../../../../../../tests/fixtures/F-THREAD-STEP-01.json';

function basicM8(): ThreadFeature {
  return makeThreadFeature({
    id: 'feat_thread_x',
    parentFeatureId: 'feat_hole_y',
    threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
    length: 20,
  });
}

describe('threadFeatureToStepMetadata', () => {
  it('produces a stable kind="thread" v1 block for a basic M8', () => {
    const f = basicM8();
    const meta = threadFeatureToStepMetadata(f);
    expect(meta.kind).toBe('thread');
    expect(meta.version).toBe(THREAD_STEP_METADATA_VERSION);
    expect(meta.designation).toBe('M8');
    expect(meta.series).toBe('ISO_M_COARSE');
    expect(meta.class).toBe('6H');
    expect(meta.length).toBe(20);
  });

  it('emits derived numerics from the catalog row', () => {
    const f = basicM8();
    const meta = threadFeatureToStepMetadata(f);
    expect(meta.derived).toBeDefined();
    expect(meta.derived!.majorDiameterMm).toBe(8);
    expect(meta.derived!.pitchMm).toBe(1.25);
    expect(meta.derived!.tapDrillMm).toBe(6.8);
  });

  it('omits an empty parentFeatureId for a parentless feature as empty string', () => {
    const f = makeThreadFeature({
      id: 'orphan',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 10,
    });
    const meta = threadFeatureToStepMetadata(f);
    expect(meta.parentFeatureId).toBe('');
  });
});

describe('threadStepMetadataToBlob', () => {
  it('uses the NEXYFAB_THREAD_V1: prefix', () => {
    const f = basicM8();
    const blob = threadStepMetadataToBlob(threadFeatureToStepMetadata(f));
    expect(blob.startsWith('NEXYFAB_THREAD_V1:')).toBe(true);
  });

  it('embeds valid JSON after the prefix', () => {
    const f = basicM8();
    const blob = threadStepMetadataToBlob(threadFeatureToStepMetadata(f));
    const json = blob.slice('NEXYFAB_THREAD_V1:'.length);
    const parsed = JSON.parse(json);
    expect(parsed.kind).toBe('thread');
    expect(parsed.designation).toBe('M8');
  });
});

describe('parseThreadStepBlob — happy paths', () => {
  it('round-trips a prefixed blob', () => {
    const f = basicM8();
    const blob = threadStepMetadataToBlob(threadFeatureToStepMetadata(f));
    const parsed = parseThreadStepBlob(blob);
    expect(parsed).not.toBeNull();
    expect(parsed!.designation).toBe('M8');
    expect(parsed!.length).toBe(20);
  });

  it('accepts a bare-JSON blob (no prefix) as a fallback', () => {
    const f = basicM8();
    const meta = threadFeatureToStepMetadata(f);
    const bareJson = JSON.stringify(meta);
    const parsed = parseThreadStepBlob(bareJson);
    expect(parsed).not.toBeNull();
    expect(parsed!.designation).toBe('M8');
  });
});

describe('parseThreadStepBlob — failure modes (returns null, never throws)', () => {
  it('returns null on non-JSON garbage', () => {
    expect(parseThreadStepBlob('NEXYFAB_THREAD_V1:not-json')).toBeNull();
  });

  it('returns null on JSON without kind="thread"', () => {
    expect(parseThreadStepBlob('NEXYFAB_THREAD_V1:{"kind":"other"}')).toBeNull();
  });

  it('returns null on missing required fields', () => {
    expect(
      parseThreadStepBlob('NEXYFAB_THREAD_V1:{"kind":"thread","id":"x"}'),
    ).toBeNull();
  });

  it('returns null on invalid series', () => {
    const f = basicM8();
    const meta = threadFeatureToStepMetadata(f);
    const blob = `NEXYFAB_THREAD_V1:${JSON.stringify({ ...meta, series: 'BOGUS' })}`;
    expect(parseThreadStepBlob(blob)).toBeNull();
  });

  it('returns null for a non-string input', () => {
    // The signature is typed as string but real-world JSON imports may
    // hand us non-strings. The parser must defend.
    expect(parseThreadStepBlob(42 as unknown as string)).toBeNull();
  });
});

describe('parseThreadStepMetadata — feature reconstruction', () => {
  it('lifts a valid blob back into a fully-typed ThreadFeature', () => {
    const f = basicM8();
    const blob = threadStepMetadataToBlob(threadFeatureToStepMetadata(f));
    const restored = parseThreadStepMetadata(blob);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(f.id);
    expect(restored!.threadRef).toEqual(f.threadRef);
    expect(restored!.length).toBe(f.length);
    expect(restored!.class).toBe(f.class);
  });

  it('returns null when the lifted feature would fail validation (unknown designation)', () => {
    const blob = `NEXYFAB_THREAD_V1:${JSON.stringify({
      kind: 'thread',
      version: 1,
      id: 'x',
      parentFeatureId: '',
      threadKind: 'internal',
      series: 'ISO_M_COARSE',
      designation: 'M-bogus',
      class: '6H',
      mode: 'cosmetic',
      threadDirection: 'right_hand',
      length: 10,
      startOffset: 0,
    })}`;
    expect(parseThreadStepMetadata(blob)).toBeNull();
  });
});

describe('roundTripThreadStep — golden test against fixture', () => {
  it('F-THREAD-STEP-01: feature → blob → feature preserves every field', () => {
    const original = makeThreadFeature({
      id: fixture.feature.id,
      parentFeatureId: fixture.feature.parentFeatureId,
      threadKind: fixture.feature.threadKind as 'internal',
      threadRef: {
        series: fixture.feature.threadRef.series as 'ISO_M_COARSE',
        designation: fixture.feature.threadRef.designation,
      },
      class: fixture.feature.class,
      mode: fixture.feature.mode as 'cosmetic',
      threadDirection: fixture.feature.threadDirection as 'right_hand',
      length: fixture.feature.length,
      startOffset: fixture.feature.startOffset,
    });
    const restored = roundTripThreadStep(original);
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe(original.id);
    expect(restored!.parentFeatureId).toBe(original.parentFeatureId);
    expect(restored!.threadRef).toEqual(original.threadRef);
    expect(restored!.class).toBe(original.class);
    expect(restored!.length).toBe(original.length);
    expect(restored!.startOffset).toBe(original.startOffset);
    expect(restored!.threadKind).toBe(original.threadKind);
    expect(restored!.mode).toBe(original.mode);
    expect(restored!.threadDirection).toBe(original.threadDirection);
  });

  it('F-THREAD-STEP-01: blob matches the golden fixture string', () => {
    const original = makeThreadFeature({
      id: fixture.feature.id,
      parentFeatureId: fixture.feature.parentFeatureId,
      threadKind: fixture.feature.threadKind as 'internal',
      threadRef: {
        series: fixture.feature.threadRef.series as 'ISO_M_COARSE',
        designation: fixture.feature.threadRef.designation,
      },
      class: fixture.feature.class,
      mode: fixture.feature.mode as 'cosmetic',
      threadDirection: fixture.feature.threadDirection as 'right_hand',
      length: fixture.feature.length,
      startOffset: fixture.feature.startOffset,
    });
    const blob = threadStepMetadataToBlob(threadFeatureToStepMetadata(original));
    expect(blob).toBe(fixture.expectedBlob);
  });
});
