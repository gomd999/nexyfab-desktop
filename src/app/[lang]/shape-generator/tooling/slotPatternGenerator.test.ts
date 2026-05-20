import { describe, it, expect } from 'vitest';
import {
  generateSlotPattern,
  estimatePlateStrength,
  summarize,
  type LinearInput,
  type GridInput,
  type CircularInput,
  type StaggeredInput,
} from './slotPatternGenerator';

describe('generateSlotPattern', () => {
  it('linear pattern produces N slots', () => {
    const spec: LinearInput = {
      pattern: 'linear',
      widthMm: 5, lengthMm: 20,
      start: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      count: 5,
      pitchMm: 10,
    };
    const r = generateSlotPattern(spec);
    expect(r.slots).toHaveLength(5);
  });

  it('linear slot centers spaced by pitch', () => {
    const spec: LinearInput = {
      pattern: 'linear',
      widthMm: 5, lengthMm: 20,
      start: { x: 0, y: 0 },
      direction: { x: 1, y: 0 },
      count: 3,
      pitchMm: 10,
    };
    const r = generateSlotPattern(spec);
    expect(r.slots[1]!.center.x).toBe(10);
    expect(r.slots[2]!.center.x).toBe(20);
  });

  it('grid pattern produces rows × cols slots', () => {
    const spec: GridInput = {
      pattern: 'grid',
      widthMm: 4, lengthMm: 12,
      origin: { x: 0, y: 0 },
      rows: 3, cols: 4,
      pitchXMm: 10, pitchYMm: 10,
    };
    expect(generateSlotPattern(spec).slots).toHaveLength(12);
  });

  it('circular pattern produces N slots around the center', () => {
    const spec: CircularInput = {
      pattern: 'circular',
      widthMm: 3, lengthMm: 10,
      center: { x: 0, y: 0 },
      radiusMm: 20,
      count: 8,
    };
    const r = generateSlotPattern(spec);
    expect(r.slots).toHaveLength(8);
    for (const s of r.slots) {
      const dist = Math.hypot(s.center.x, s.center.y);
      expect(dist).toBeCloseTo(20, 5);
    }
  });

  it('circular radialOrientation false → tangential slots', () => {
    const spec: CircularInput = {
      pattern: 'circular',
      widthMm: 3, lengthMm: 10,
      center: { x: 0, y: 0 },
      radiusMm: 20,
      count: 4,
      radialOrientation: false,
    };
    const r = generateSlotPattern(spec);
    expect(r.slots[0]!.angleRad).toBeCloseTo(Math.PI / 2, 3);
  });

  it('staggered pattern offsets odd rows', () => {
    const spec: StaggeredInput = {
      pattern: 'staggered',
      widthMm: 3, lengthMm: 10,
      origin: { x: 0, y: 0 },
      rows: 2, cols: 3,
      pitchXMm: 10, pitchYMm: 10,
    };
    const r = generateSlotPattern(spec);
    // Row 1 (odd) should be offset by pitchXMm/2.
    expect(r.slots[3]!.center.x).toBe(5);
  });

  it('total cut area > 0 for non-empty pattern', () => {
    const spec: LinearInput = {
      pattern: 'linear', widthMm: 5, lengthMm: 20,
      start: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, count: 3, pitchMm: 10,
    };
    const r = generateSlotPattern(spec);
    expect(r.totalCutAreaMm2).toBeGreaterThan(0);
  });

  it('total perimeter > 0 for non-empty pattern', () => {
    const spec: LinearInput = {
      pattern: 'linear', widthMm: 5, lengthMm: 20,
      start: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, count: 3, pitchMm: 10,
    };
    const r = generateSlotPattern(spec);
    expect(r.totalCutPerimeterMm).toBeGreaterThan(0);
  });

  it('cornerRadiusMm defaults to width/2', () => {
    const spec: LinearInput = {
      pattern: 'linear', widthMm: 6, lengthMm: 20,
      start: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, count: 1, pitchMm: 10,
    };
    const r = generateSlotPattern(spec);
    expect(r.slots[0]!.cornerRadiusMm).toBe(3);
  });
});

describe('estimatePlateStrength', () => {
  it('full plate area means 100% solid', () => {
    const r = generateSlotPattern({
      pattern: 'linear', widthMm: 5, lengthMm: 20,
      start: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, count: 1, pitchMm: 10,
    });
    const s = estimatePlateStrength(r, 10000);
    expect(s.solidFraction).toBeGreaterThan(0.95);
  });

  it('too many slots → remaining area drops', () => {
    const r = generateSlotPattern({
      pattern: 'grid', widthMm: 5, lengthMm: 20,
      origin: { x: 0, y: 0 }, rows: 10, cols: 10, pitchXMm: 10, pitchYMm: 10,
    });
    const s = estimatePlateStrength(r, 10000);
    expect(s.solidFraction).toBeLessThan(1);
  });
});

describe('summarize', () => {
  it('reports slot count', () => {
    const r = generateSlotPattern({
      pattern: 'linear', widthMm: 5, lengthMm: 20,
      start: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, count: 5, pitchMm: 10,
    });
    const s = summarize(r);
    expect(s.slotCount).toBe(5);
  });

  it('laser minutes scales inversely with speed', () => {
    const r = generateSlotPattern({
      pattern: 'linear', widthMm: 5, lengthMm: 20,
      start: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, count: 5, pitchMm: 10,
    });
    const fast = summarize(r, 5000);
    const slow = summarize(r, 500);
    expect(slow.estLaserMinutes).toBeGreaterThan(fast.estLaserMinutes);
  });
});
