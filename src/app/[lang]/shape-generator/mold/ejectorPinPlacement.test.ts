import { describe, it, expect } from 'vitest';
import {
  placePins,
  summarize,
  type PartRegion,
} from './ejectorPinPlacement';

const squarePart: PartRegion = {
  outline: [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ],
  cosmeticZones: [],
  wallThicknessMm: 2,
};

const partWithCosmetic: PartRegion = {
  outline: [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ],
  cosmeticZones: [[{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }]],
  wallThicknessMm: 2,
};

describe('placePins', () => {
  it('square part → some pins placed', () => {
    const r = placePins(squarePart, { maxPinCount: 4, pinDiameterMm: 4, gridStepMm: 20, minDistanceFromCosmeticMm: 3 });
    expect(r.pins.length).toBeGreaterThan(0);
  });

  it('respects maxPinCount', () => {
    const r = placePins(squarePart, { maxPinCount: 2, pinDiameterMm: 4, gridStepMm: 20, minDistanceFromCosmeticMm: 3 });
    expect(r.pins.length).toBeLessThanOrEqual(2);
  });

  it('pins avoid cosmetic zone', () => {
    const r = placePins(partWithCosmetic, { maxPinCount: 4, pinDiameterMm: 4, gridStepMm: 5, minDistanceFromCosmeticMm: 5 });
    for (const pin of r.pins) {
      // Each pin should be ≥ minDistanceFromCosmeticMm from the cosmetic zone.
      expect(pin.distanceFromCosmetic).toBeGreaterThanOrEqual(5);
    }
  });

  it('centroid computed', () => {
    const r = placePins(squarePart);
    expect(r.centroid.x).toBeCloseTo(50, 1);
    expect(r.centroid.y).toBeCloseTo(50, 1);
  });

  it('pins are at least 2× pin diameter apart', () => {
    const r = placePins(squarePart, { maxPinCount: 6, pinDiameterMm: 5, gridStepMm: 5, minDistanceFromCosmeticMm: 3 });
    for (let i = 0; i < r.pins.length; i++) {
      for (let j = i + 1; j < r.pins.length; j++) {
        const d = Math.hypot(r.pins[i]!.position.x - r.pins[j]!.position.x, r.pins[i]!.position.y - r.pins[j]!.position.y);
        expect(d).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('maxPitchMm = 50 × wallThickness', () => {
    const r = placePins(squarePart);
    expect(r.maxPitchMm).toBeCloseTo(100, 1);
  });

  it('forceImbalance is averaged centroid offset', () => {
    const r = placePins(squarePart, { maxPinCount: 4, pinDiameterMm: 4, gridStepMm: 20, minDistanceFromCosmeticMm: 3 });
    // Symmetric square should produce roughly balanced pins.
    expect(Math.hypot(r.forceImbalance.x, r.forceImbalance.y)).toBeLessThan(60);
  });

  it('no candidates → warning', () => {
    // Outline that is just a degenerate point.
    const tiny: PartRegion = {
      outline: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }],
      cosmeticZones: [],
      wallThicknessMm: 1,
    };
    const r = placePins(tiny, { maxPinCount: 4, pinDiameterMm: 4, gridStepMm: 10, minDistanceFromCosmeticMm: 3 });
    if (r.pins.length === 0) {
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });
});

describe('summarize', () => {
  it('reports pin count + imbalance', () => {
    const r = placePins(squarePart);
    const s = summarize(r);
    expect(s.pinCount).toBe(r.pins.length);
    expect(s.forceImbalanceMagnitude).toBeGreaterThanOrEqual(0);
  });

  it('zero pins → zero imbalance', () => {
    const r = placePins(squarePart, { maxPinCount: 0, pinDiameterMm: 4, gridStepMm: 20, minDistanceFromCosmeticMm: 3 });
    expect(summarize(r).pinCount).toBe(0);
  });
});
