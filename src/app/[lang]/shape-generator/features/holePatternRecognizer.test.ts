import { describe, it, expect } from 'vitest';
import {
  recognizePatterns,
  patternCallout,
  type HolePosition,
} from './holePatternRecognizer';

function holes(positions: Array<[number, number]>, diameter: number = 6): HolePosition[] {
  return positions.map((p, i) => ({ id: `H${i}`, position: p, diameterMm: diameter }));
}

describe('rectangular grid', () => {
  it('detects 2×2 grid', () => {
    const h = holes([[0, 0], [10, 0], [0, 10], [10, 10]]);
    const r = recognizePatterns(h);
    expect(r.patterns[0]!.kind).toBe('rectangular');
    expect(r.patterns[0]!.metadata.rows).toBe(2);
    expect(r.patterns[0]!.metadata.cols).toBe(2);
  });

  it('detects 3×4 grid', () => {
    const grid: Array<[number, number]> = [];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) {
        grid.push([i * 20, j * 30]);
      }
    }
    const r = recognizePatterns(holes(grid));
    expect(r.patterns[0]!.kind).toBe('rectangular');
    expect(r.patterns[0]!.metadata.cols).toBe(3);
    expect(r.patterns[0]!.metadata.rows).toBe(4);
  });

  it('rejects irregular grid (missing corner)', () => {
    // 4 holes that look like a rect but missing one corner.
    const h = holes([[0, 0], [10, 0], [0, 10]]);
    const r = recognizePatterns(h);
    expect(r.patterns.find(p => p.kind === 'rectangular')).toBeUndefined();
  });

  it('records xSpacing and ySpacing', () => {
    const h = holes([[0, 0], [25, 0], [50, 0], [0, 15], [25, 15], [50, 15]]);
    const r = recognizePatterns(h);
    expect(r.patterns[0]!.metadata.xSpacingMm).toBe(25);
    expect(r.patterns[0]!.metadata.ySpacingMm).toBe(15);
  });
});

describe('circular pattern', () => {
  it('detects 4-hole bolt circle', () => {
    const r = 20;
    const positions: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      positions.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    const result = recognizePatterns(holes(positions));
    expect(result.patterns[0]!.kind).toBe('circular');
    expect(result.patterns[0]!.metadata.count).toBe(4);
    expect(result.patterns[0]!.metadata.radiusMm).toBeCloseTo(20, 1);
  });

  it('detects 6-hole bolt circle', () => {
    const r = 50;
    const positions: Array<[number, number]> = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      positions.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    const result = recognizePatterns(holes(positions));
    expect(result.patterns[0]!.kind).toBe('circular');
    expect(result.patterns[0]!.metadata.angularSpacingDeg).toBeCloseTo(60, 4);
  });

  it('rejects 4 holes on uneven angles', () => {
    const positions: Array<[number, number]> = [
      [20, 0], [0, 20], [-20, 0], [10, -17],
    ];
    const result = recognizePatterns(holes(positions));
    expect(result.patterns.find(p => p.kind === 'circular')).toBeUndefined();
  });
});

describe('linear pattern', () => {
  it('detects 5 equally-spaced collinear holes', () => {
    const result = recognizePatterns(holes([[0, 0], [10, 0], [20, 0], [30, 0], [40, 0]]));
    expect(result.patterns[0]!.kind).toBe('linear');
    expect(result.patterns[0]!.metadata.count).toBe(5);
    expect(result.patterns[0]!.metadata.spacingMm).toBe(10);
  });

  it('rejects non-uniform spacing', () => {
    const result = recognizePatterns(holes([[0, 0], [10, 0], [25, 0], [40, 0]]));
    expect(result.patterns.find(p => p.kind === 'linear')).toBeUndefined();
  });

  it('handles diagonal line', () => {
    const result = recognizePatterns(holes([[0, 0], [10, 10], [20, 20], [30, 30]]));
    expect(result.patterns[0]!.kind).toBe('linear');
  });
});

describe('mixed + diameter grouping', () => {
  it('different diameters are recognized separately', () => {
    const result = recognizePatterns([
      ...holes([[0, 0], [10, 0], [0, 10], [10, 10]], 6),
      ...holes([[50, 50], [60, 50], [50, 60], [60, 60]], 8),
    ]);
    expect(result.patterns).toHaveLength(2);
  });

  it('ungrouped holes reported when no pattern matches', () => {
    const r = recognizePatterns(holes([[0, 0], [13, 11]])); // 2 holes, no pattern
    expect(r.patterns).toHaveLength(0);
    expect(r.ungroupedHoleIds).toHaveLength(2);
  });
});

describe('patternCallout', () => {
  it('rectangular: "N× ⌀X (C×R grid)"', () => {
    const result = recognizePatterns(holes([[0, 0], [10, 0], [0, 10], [10, 10]]));
    const callout = patternCallout(result.patterns[0]!);
    expect(callout).toContain('4×');
    expect(callout).toContain('⌀6');
    expect(callout).toContain('2×2');
  });

  it('circular: includes "EQL SP on ⌀R BC"', () => {
    const r = 20;
    const positions: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      positions.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
    const result = recognizePatterns(holes(positions));
    const callout = patternCallout(result.patterns[0]!);
    expect(callout).toContain('EQL SP');
    expect(callout).toContain('BC');
  });

  it('linear: includes "EQL SP @ Xmm"', () => {
    const result = recognizePatterns(holes([[0, 0], [10, 0], [20, 0]]));
    const callout = patternCallout(result.patterns[0]!);
    expect(callout).toContain('EQL SP');
  });
});
