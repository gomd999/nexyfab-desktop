/**
 * applyThreadCosmetic.test.ts — Wave 2 Phase 2 Track D5 (W5).
 *
 * Verifies the cosmetic worker stub returns metadata + unchanged geometry.
 */

import { describe, it, expect } from 'vitest';
import { BufferGeometry, BufferAttribute } from 'three';
import { applyThreadCosmetic } from '../applyThreadCosmetic';
import { makeThreadFeature } from '../threadFeature';

function makeBoxGeometry(): BufferGeometry {
  // Tiny 1-triangle BufferGeometry — content doesn't matter, only reference identity.
  const g = new BufferGeometry();
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  g.setAttribute('position', new BufferAttribute(positions, 3));
  return g;
}

describe('applyThreadCosmetic — geometry is returned unchanged (reference equality)', () => {
  it('result.geometry === parentGeometry (no clone)', () => {
    const parent = makeBoxGeometry();
    const feature = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
    });
    const result = applyThreadCosmetic(parent, feature);
    expect(result.geometry).toBe(parent); // strict reference equality
  });

  it('does not mutate the parent attributes', () => {
    const parent = makeBoxGeometry();
    const positionsBefore = parent.attributes.position;
    const feature = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
    });
    applyThreadCosmetic(parent, feature);
    expect(parent.attributes.position).toBe(positionsBefore);
  });
});

describe('applyThreadCosmetic — metadata payload', () => {
  it('M8 internal cosmetic produces callout "M8-6H ↧ 20"', () => {
    const parent = makeBoxGeometry();
    const feature = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
    });
    const result = applyThreadCosmetic(parent, feature);
    expect(result.metadata.callout).toBe('M8-6H ↧ 20');
    expect(result.metadata.class).toBe('6H');
    expect(result.metadata.direction).toBe('right_hand');
    expect(result.metadata.threadRef.designation).toBe('M8');
    expect(result.metadata.threadRef.nominalDia).toBe(8);
  });

  it('range start/end span the threaded length along +Z by default', () => {
    const parent = makeBoxGeometry();
    const feature = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      startOffset: 3,
    });
    const result = applyThreadCosmetic(parent, feature);
    expect(result.metadata.rangeStart).toEqual([0, 0, 3]);
    expect(result.metadata.rangeEnd).toEqual([0, 0, 23]);
  });

  it('honours custom axis + origin (parent face plane)', () => {
    const parent = makeBoxGeometry();
    const feature = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 10,
      startOffset: 0,
    });
    const result = applyThreadCosmetic(parent, feature, {
      axis: [1, 0, 0],
      origin: [5, 7, 9],
    });
    expect(result.metadata.rangeStart).toEqual([5, 7, 9]);
    expect(result.metadata.rangeEnd).toEqual([15, 7, 9]); // moved +10 along +X
  });

  it('NPT cosmetic callout omits the class — "NPT 1/2 ↧ 13.72"', () => {
    const parent = makeBoxGeometry();
    const feature = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'NPT', designation: 'NPT 1/2' },
      length: 13.72,
    });
    const result = applyThreadCosmetic(parent, feature);
    expect(result.metadata.callout).toBe('NPT 1/2 ↧ 13.72');
  });

  it('left-hand callout includes "LH"', () => {
    const parent = makeBoxGeometry();
    const feature = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M10' },
      length: 15,
      threadDirection: 'left_hand',
    });
    const result = applyThreadCosmetic(parent, feature);
    expect(result.metadata.callout).toBe('M10-6H LH ↧ 15');
  });

  it('UTS callout — "1/4-20 UNC-2B ↧ 12"', () => {
    const parent = makeBoxGeometry();
    const feature = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'UNC', designation: '1/4-20 UNC' },
      length: 12,
    });
    const result = applyThreadCosmetic(parent, feature);
    expect(result.metadata.callout).toBe('1/4-20 UNC-2B ↧ 12');
  });
});

describe('applyThreadCosmetic — guards', () => {
  it('throws when feature.mode is geometric (W7 territory)', () => {
    const parent = makeBoxGeometry();
    const feature = makeThreadFeature({
      id: 'f',
      threadRef: { series: 'ISO_M_COARSE', designation: 'M8' },
      length: 20,
      mode: 'geometric',
    });
    expect(() => applyThreadCosmetic(parent, feature)).toThrow(/cosmetic/);
  });

  it('throws THREAD_DESIGNATION_UNKNOWN when designation absent at apply time', () => {
    const parent = makeBoxGeometry();
    // Construct directly to bypass makeThreadFeature's catalog validation.
    const bad = {
      id: 'f',
      featureType: 'thread' as const,
      threadKind: 'internal' as const,
      threadRef: { series: 'ISO_M_COARSE' as const, designation: 'M-bogus' },
      class: '6H',
      mode: 'cosmetic' as const,
      threadDirection: 'right_hand' as const,
      length: 5,
      startOffset: 0,
    };
    expect(() => applyThreadCosmetic(parent, bad)).toThrow(/THREAD_DESIGNATION_UNKNOWN/);
  });
});
