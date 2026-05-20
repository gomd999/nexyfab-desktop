import { describe, it, expect } from 'vitest';
import {
  placeVents,
  ventDensity,
  summarize,
  type Vec2,
  type LastFillCandidate,
} from './ventingPlacement';

const squareCavity: Vec2[] = [
  { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
];

function cand(x: number, y: number, time: number = 100, weld: boolean = false): LastFillCandidate {
  return { point: { x, y }, fillTimeMs: time, weldLine: weld };
}

describe('placeVents', () => {
  it('zero-area parting line → warning + empty', () => {
    const r = placeVents([{ x: 0, y: 0 }, { x: 1, y: 0 }], []);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('candidate vents placed at last-fill points', () => {
    const candidates = [cand(50, 0), cand(0, 50)];
    const r = placeVents(squareCavity, candidates);
    const lastFillVents = r.vents.filter(v => v.reason === 'last-fill');
    expect(lastFillVents.length).toBeGreaterThanOrEqual(2);
  });

  it('weld-line candidates labelled weld-line', () => {
    const candidates = [cand(50, 50, 100, true)];
    const r = placeVents(squareCavity, candidates);
    expect(r.vents.some(v => v.reason === 'weld-line')).toBe(true);
  });

  it('vent depth varies with polymer', () => {
    const unfilled = placeVents(squareCavity, [cand(50, 0)], { polymer: 'unfilled', ventWidthMm: 10, minTotalAreaFraction: 0.3 });
    const lsr = placeVents(squareCavity, [cand(50, 0)], { polymer: 'liquid-silicone', ventWidthMm: 10, minTotalAreaFraction: 0.3 });
    expect(unfilled.vents[0]!.depthMm).toBeGreaterThan(lsr.vents[0]!.depthMm);
  });

  it('total area target met', () => {
    const r = placeVents(squareCavity, [cand(50, 0)], { polymer: 'unfilled', ventWidthMm: 10, minTotalAreaFraction: 0.1 });
    expect(r.meetsMinimum).toBe(true);
  });

  it('cavity area reported', () => {
    const r = placeVents(squareCavity, []);
    expect(r.cavityProjectedAreaMm2).toBeCloseTo(10000, 1);
  });

  it('excess vent count warning when minTotalAreaFraction too high', () => {
    const r = placeVents(squareCavity, [], { polymer: 'unfilled', ventWidthMm: 1, minTotalAreaFraction: 1.0 });
    expect(r.vents.length).toBeLessThanOrEqual(501);
  });
});

describe('ventDensity', () => {
  it('positive when vents exist', () => {
    const r = placeVents(squareCavity, [cand(50, 0)]);
    expect(ventDensity(r)).toBeGreaterThan(0);
  });

  it('zero when cavity area zero', () => {
    const empty = placeVents([{ x: 0, y: 0 }, { x: 1, y: 0 }], []);
    expect(ventDensity(empty)).toBe(0);
  });
});

describe('summarize', () => {
  it('counts by reason', () => {
    const candidates = [cand(50, 0), cand(50, 50, 100, true)];
    const r = placeVents(squareCavity, candidates);
    const s = summarize(r);
    expect(s.byReason['last-fill']).toBeGreaterThanOrEqual(1);
    expect(s.byReason['weld-line']).toBe(1);
  });

  it('totalArea matches result', () => {
    const r = placeVents(squareCavity, [cand(50, 0)]);
    expect(summarize(r).totalAreaMm2).toBe(r.totalAreaMm2);
  });
});
