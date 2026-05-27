import { describe, it, expect } from 'vitest';
import {
  placeReliefs,
  validateReliefs,
  emitPolylines,
  summarize,
  type BendCorner,
} from './cornerReliefPlacer';

function corner(id: string, angle: number, x: number = 0, y: number = 0): BendCorner {
  return { id, point: { x, y }, angleDeg: angle, bendAId: 'b1', bendBId: 'b2' };
}

describe('placeReliefs', () => {
  it('empty → empty', () => {
    expect(placeReliefs([], { thicknessMm: 1, roundDiameterFactor: 1.5, tearDropRatio: 2.5 })).toEqual([]);
  });

  it('thin sheet 1mm at 90° → round style', () => {
    const r = placeReliefs([corner('c1', 90)], { thicknessMm: 1, roundDiameterFactor: 1.5, tearDropRatio: 2.5 });
    expect(r[0]!.style).toBe('round');
  });

  it('acute angle (< 60) → v-notch', () => {
    const r = placeReliefs([corner('c1', 45)], { thicknessMm: 2, roundDiameterFactor: 1.5, tearDropRatio: 2.5 });
    expect(r[0]!.style).toBe('v-notch');
  });

  it('obtuse angle (> 120) → square', () => {
    const r = placeReliefs([corner('c1', 150)], { thicknessMm: 2, roundDiameterFactor: 1.5, tearDropRatio: 2.5 });
    expect(r[0]!.style).toBe('square');
  });

  it('thicker sheet at 90° → tear-drop', () => {
    const r = placeReliefs([corner('c1', 90)], { thicknessMm: 3, roundDiameterFactor: 1.5, tearDropRatio: 2.5 });
    expect(r[0]!.style).toBe('tear-drop');
  });

  it('forcedStyle overrides selection', () => {
    const r = placeReliefs([corner('c1', 90)], { thicknessMm: 1, roundDiameterFactor: 1.5, tearDropRatio: 2.5, forcedStyle: 'square' });
    expect(r[0]!.style).toBe('square');
  });

  it('primary dim = thickness × factor', () => {
    const r = placeReliefs([corner('c1', 90)], { thicknessMm: 2, roundDiameterFactor: 2, tearDropRatio: 2.5 });
    expect(r[0]!.primaryDimMm).toBeCloseTo(4, 5);
  });

  it('tear-drop has secondary dim = primary × ratio', () => {
    const r = placeReliefs([corner('c1', 90)], { thicknessMm: 3, roundDiameterFactor: 1.5, tearDropRatio: 3 });
    expect(r[0]!.secondaryDimMm).toBeCloseTo(r[0]!.primaryDimMm * 3, 5);
  });
});

describe('validateReliefs', () => {
  it('error when relief smaller than thickness', () => {
    const reliefs = placeReliefs([corner('c1', 90)], { thicknessMm: 2, roundDiameterFactor: 0.5, tearDropRatio: 2.5 });
    const issues = validateReliefs(reliefs, 2);
    expect(issues.some(i => i.severity === 'error')).toBe(true);
  });

  it('no issues for 1.5t reliefs', () => {
    const reliefs = placeReliefs([corner('c1', 90)], { thicknessMm: 1, roundDiameterFactor: 1.5, tearDropRatio: 2.5 });
    expect(validateReliefs(reliefs, 1).some(i => i.severity === 'error')).toBe(false);
  });
});

describe('emitPolylines', () => {
  it('square gives 5 points (closed)', () => {
    const reliefs = placeReliefs([corner('c1', 150)], { thicknessMm: 2, roundDiameterFactor: 1.5, tearDropRatio: 2.5 });
    const poly = emitPolylines(reliefs);
    expect(poly[0]!.points.length).toBe(5);
  });

  it('round gives ~25 points', () => {
    const reliefs = placeReliefs([corner('c1', 90)], { thicknessMm: 1, roundDiameterFactor: 1.5, tearDropRatio: 2.5 });
    const poly = emitPolylines(reliefs);
    expect(poly[0]!.points.length).toBe(25);
  });
});

describe('summarize', () => {
  it('counts by style', () => {
    const reliefs = placeReliefs(
      [corner('a', 90), corner('b', 45), corner('c', 150)],
      { thicknessMm: 2, roundDiameterFactor: 1.5, tearDropRatio: 2.5 },
    );
    const s = summarize(reliefs, 2);
    expect(s.byStyle['tear-drop']).toBe(1);
    expect(s.byStyle['v-notch']).toBe(1);
    expect(s.byStyle.square).toBe(1);
  });

  it('errorCount reported', () => {
    const reliefs = placeReliefs([corner('c1', 90)], { thicknessMm: 2, roundDiameterFactor: 0.4, tearDropRatio: 2.5 });
    expect(summarize(reliefs, 2).errorCount).toBeGreaterThan(0);
  });
});
