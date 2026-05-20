import { describe, it, expect } from 'vitest';
import {
  formatHoleCallout,
  generateDimensions,
  recognizeFeatures,
  type RecognizedFeature,
  type DimXpertOptions,
} from './dimXpert';

const options: DimXpertOptions = {
  layoutStyle: 'chain',
  sheetBbox: { minX: 0, minY: 0, maxX: 297, maxY: 210 },
  sheetScale: 1,
};

describe('formatHoleCallout', () => {
  it('simple drilled: ⌀<dia>', () => {
    const r = formatHoleCallout({
      id: 'F1', kind: 'hole', positionMm: [0, 0, 0], primarySizeMm: 6.5,
    });
    expect(r).toBe('⌀6.5');
  });

  it('with depth: ⌀<dia> ▽ <depth>', () => {
    const r = formatHoleCallout({
      id: 'F1', kind: 'hole', positionMm: [0, 0, 0], primarySizeMm: 5, secondarySizeMm: 12,
    });
    expect(r).toContain('▽ 12');
  });

  it('with counterbore: includes ⌴', () => {
    const r = formatHoleCallout({
      id: 'F1', kind: 'hole', positionMm: [0, 0, 0],
      primarySizeMm: 5, secondarySizeMm: 12, tertiarySizeMm: 8,
    });
    expect(r).toContain('⌴⌀8');
  });
});

describe('generateDimensions', () => {
  it('hole produces 3 dims (callout + 2 location)', () => {
    const features: RecognizedFeature[] = [
      { id: 'F1', kind: 'hole', positionMm: [10, 20, 0], primarySizeMm: 5, secondarySizeMm: 10 },
    ];
    const r = generateDimensions(features, options);
    expect(r).toHaveLength(3);
  });

  it('boss produces 2 dims (diameter + height)', () => {
    const features: RecognizedFeature[] = [
      { id: 'F1', kind: 'boss', positionMm: [0, 0, 0], primarySizeMm: 12, secondarySizeMm: 25 },
    ];
    const r = generateDimensions(features, options);
    expect(r).toHaveLength(2);
  });

  it('slot produces length + width', () => {
    const features: RecognizedFeature[] = [
      { id: 'F1', kind: 'slot', positionMm: [0, 0, 0], primarySizeMm: 30, secondarySizeMm: 8 },
    ];
    const r = generateDimensions(features, options);
    expect(r.find(d => d.label.includes('length'))).toBeDefined();
    expect(r.find(d => d.label.includes('width'))).toBeDefined();
  });

  it('fillet produces 1 radial dim', () => {
    const features: RecognizedFeature[] = [
      { id: 'F1', kind: 'fillet', positionMm: [0, 0, 0], primarySizeMm: 3 },
    ];
    const r = generateDimensions(features, options);
    expect(r[0]!.kind).toBe('radial');
    expect(r[0]!.label).toBe('R3');
  });

  it('chain layout places dims along baseline', () => {
    const features: RecognizedFeature[] = [
      { id: 'F1', kind: 'hole', positionMm: [10, 20, 0], primarySizeMm: 5, secondarySizeMm: 10 },
      { id: 'F2', kind: 'hole', positionMm: [30, 20, 0], primarySizeMm: 5, secondarySizeMm: 10 },
    ];
    const r = generateDimensions(features, options);
    // All dims should have a position assigned.
    expect(r.every(d => d.position != null)).toBe(true);
  });

  it('baseline layout uses y-offsets', () => {
    const features: RecognizedFeature[] = [
      { id: 'F1', kind: 'hole', positionMm: [10, 20, 0], primarySizeMm: 5, secondarySizeMm: 10 },
      { id: 'F2', kind: 'hole', positionMm: [30, 20, 0], primarySizeMm: 5, secondarySizeMm: 10 },
    ];
    const r = generateDimensions(features, { ...options, layoutStyle: 'baseline' });
    // y-coords should differ between dims (stacked).
    const ys = r.map(d => d.position![1]);
    const distinctYs = new Set(ys);
    expect(distinctYs.size).toBeGreaterThan(1);
  });

  it('every dim has a leader', () => {
    const features: RecognizedFeature[] = [
      { id: 'F1', kind: 'hole', positionMm: [10, 20, 0], primarySizeMm: 5, secondarySizeMm: 10 },
    ];
    const r = generateDimensions(features, options);
    expect(r.every(d => d.leader && d.leader.length >= 2)).toBe(true);
  });

  it('repulsion pushes overlapping dims apart', () => {
    // Many holes at same location → repulsion should spread them.
    const features: RecognizedFeature[] = Array.from({ length: 5 }, (_, i) => ({
      id: `F${i}`, kind: 'hole' as const,
      positionMm: [0, 0, 0] as [number, number, number],
      primarySizeMm: 5,
    }));
    const r = generateDimensions(features, options);
    // Distinct positions after repulsion.
    const positions = r.map(d => d.position![0]).filter((x): x is number => x != null);
    const distinct = new Set(positions);
    expect(distinct.size).toBeGreaterThan(1);
  });
});

describe('recognizeFeatures', () => {
  it('emits one RecognizedFeature per input', () => {
    const r = recognizeFeatures({
      holes: [{ center: [0, 0, 0], diameterMm: 5, depthMm: 10 }],
      slots: [{ center: [0, 0, 0], lengthMm: 30, widthMm: 8 }],
      fillets: [{ position: [0, 0, 0], radiusMm: 2 }],
      chamfers: [{ position: [0, 0, 0], sizeMm: 1 }],
    });
    expect(r).toHaveLength(4);
  });

  it('hole tapped → 6H tolerance', () => {
    const r = recognizeFeatures({
      holes: [{ center: [0, 0, 0], diameterMm: 5, depthMm: 10, tapped: true }],
      slots: [], fillets: [], chamfers: [],
    });
    expect(r[0]!.toleranceGrade).toBe('6H');
  });

  it('hole untapped → H8 tolerance', () => {
    const r = recognizeFeatures({
      holes: [{ center: [0, 0, 0], diameterMm: 5, depthMm: 10 }],
      slots: [], fillets: [], chamfers: [],
    });
    expect(r[0]!.toleranceGrade).toBe('H8');
  });
});
