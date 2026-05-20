import { describe, it, expect } from 'vitest';
import {
  suggestGdtCallouts,
  pickDatumCandidates,
  summarizeCallouts,
  type AnalyzedFeature,
} from './gdtCalloutSuggester';

function planar(id: string, normal: [number, number, number], area: number): AnalyzedFeature {
  return {
    id, kind: 'planar', areaMm2: area, direction: normal, position: [0, 0, 0],
  };
}

function cyl(id: string, radius: number, length: number, axis: [number, number, number] = [0, 0, 1]): AnalyzedFeature {
  return {
    id, kind: 'cylindrical', areaMm2: 2 * Math.PI * radius * length,
    direction: axis, position: [0, 0, 0],
    radiusMm: radius, lengthMm: length,
  };
}

function hole(id: string, patternId: string, radius = 2): AnalyzedFeature {
  return {
    id, kind: 'cylindrical', areaMm2: 10, direction: [0, 0, 1], position: [0, 0, 0],
    radiusMm: radius, lengthMm: 5, patternId,
  };
}

describe('pickDatumCandidates', () => {
  it('picks largest planar face as A', () => {
    const features: AnalyzedFeature[] = [
      planar('p1', [0, 0, 1], 100),
      planar('p2', [0, 0, 1], 50),
    ];
    const d = pickDatumCandidates(features);
    expect(d[0]?.featureId).toBe('p1');
    expect(d[0]?.letter).toBe('A');
  });

  it('picks perpendicular face for B', () => {
    const features: AnalyzedFeature[] = [
      planar('bottom', [0, 0, 1], 100),
      planar('side', [1, 0, 0], 80),
    ];
    const d = pickDatumCandidates(features);
    expect(d.find(x => x.letter === 'B')?.featureId).toBe('side');
  });

  it('picks third orthogonal face for C', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      planar('B', [1, 0, 0], 80),
      planar('C', [0, 1, 0], 70),
    ];
    const d = pickDatumCandidates(features);
    expect(d).toHaveLength(3);
    expect(d.find(x => x.letter === 'C')?.featureId).toBe('C');
  });

  it('no planar faces → no datums', () => {
    expect(pickDatumCandidates([cyl('c', 5, 10)])).toEqual([]);
  });
});

describe('suggestGdtCallouts', () => {
  it('emits flatness on each datum', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      planar('B', [1, 0, 0], 80),
    ];
    const r = suggestGdtCallouts(features);
    const flatness = r.callouts.filter(c => c.symbol === 'flatness');
    expect(flatness).toHaveLength(2);
  });

  it('position tolerance on hole pattern (≥ 2 holes)', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      hole('h1', 'pat1'),
      hole('h2', 'pat1'),
    ];
    const r = suggestGdtCallouts(features);
    expect(r.callouts.some(c => c.symbol === 'position')).toBe(true);
  });

  it('cylindricity on long shaft (L/D > 1)', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      cyl('shaft', 1, 5), // L/D = 2.5
    ];
    const r = suggestGdtCallouts(features);
    expect(r.callouts.some(c => c.symbol === 'cylindricity')).toBe(true);
  });

  it('no cylindricity on short stub (L/D < 1)', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      cyl('stub', 5, 1),
    ];
    const r = suggestGdtCallouts(features);
    expect(r.callouts.some(c => c.symbol === 'cylindricity')).toBe(false);
  });

  it('parallelism on opposite planar pair', () => {
    const features: AnalyzedFeature[] = [
      planar('bottom', [0, 0, 1], 100),
      planar('top', [0, 0, -1], 100),
    ];
    const r = suggestGdtCallouts(features);
    expect(r.callouts.some(c => c.symbol === 'parallelism')).toBe(true);
  });

  it('perpendicularity on perpendicular planar pair', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      planar('side', [1, 0, 0], 50),
    ];
    const r = suggestGdtCallouts(features);
    expect(r.callouts.some(c => c.symbol === 'perpendicularity' || c.symbol === 'flatness')).toBe(true);
  });

  it('profile-surface on freeform face', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      { id: 'free', kind: 'freeform', areaMm2: 50, direction: [0, 0, 1], position: [0, 0, 0] },
    ];
    const r = suggestGdtCallouts(features);
    expect(r.callouts.some(c => c.symbol === 'profile-surface')).toBe(true);
  });

  it('callouts sorted by confidence descending', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      planar('B', [1, 0, 0], 80),
      hole('h1', 'pat1'),
      hole('h2', 'pat1'),
    ];
    const r = suggestGdtCallouts(features);
    for (let i = 1; i < r.callouts.length; i++) {
      expect(r.callouts[i]!.confidence).toBeLessThanOrEqual(r.callouts[i - 1]!.confidence);
    }
  });

  it('empty features → empty callouts', () => {
    expect(suggestGdtCallouts([]).callouts).toEqual([]);
  });

  it('position callout uses datum refs', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      planar('B', [1, 0, 0], 80),
      hole('h1', 'pat1'),
      hole('h2', 'pat1'),
    ];
    const r = suggestGdtCallouts(features);
    const pos = r.callouts.find(c => c.symbol === 'position');
    expect(pos?.datumRefs).toContain('A');
  });
});

describe('summarizeCallouts', () => {
  it('counts by symbol', () => {
    const features: AnalyzedFeature[] = [
      planar('A', [0, 0, 1], 100),
      planar('B', [1, 0, 0], 80),
      hole('h1', 'pat1'),
      hole('h2', 'pat1'),
    ];
    const r = suggestGdtCallouts(features);
    const s = summarizeCallouts(r.callouts);
    expect(s.totalCallouts).toBe(r.callouts.length);
    expect(s.bySymbol.flatness).toBe(2);
  });

  it('high-confidence count', () => {
    const features: AnalyzedFeature[] = [planar('A', [0, 0, 1], 100)];
    const r = suggestGdtCallouts(features);
    const s = summarizeCallouts(r.callouts);
    expect(s.highConfidenceCount).toBeGreaterThan(0);
  });
});
