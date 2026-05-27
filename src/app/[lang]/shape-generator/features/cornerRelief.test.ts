import { describe, it, expect } from 'vitest';
import { detectCornerReliefNeeds, reliefSuggestionsToWarnings } from './cornerRelief';
import type { BendParams } from './sheetMetal';

const bend = (position: number, radius = 2, direction: 'up' | 'down' = 'up'): BendParams => ({
  angle: 90,
  radius,
  position,
  direction,
});

describe('detectCornerReliefNeeds', () => {
  it('finds a corner pair when two bends are at the same outer end', () => {
    const out = detectCornerReliefNeeds({
      thickness: 1.5,
      material: 'mildSteel',
      bendHistory: [bend(0.05), bend(0.10)], // both near the −Z end
    });
    expect(out).toHaveLength(1);
    expect(out[0].bendAIndex).toBe(0);
    expect(out[0].bendBIndex).toBe(1);
  });

  it('does NOT flag bends on opposite ends (no shared corner)', () => {
    const out = detectCornerReliefNeeds({
      thickness: 2,
      material: 'mildSteel',
      bendHistory: [bend(0.05), bend(0.95)],
    });
    expect(out).toHaveLength(0);
  });

  it('does NOT flag bends in the middle of the sheet (no corner)', () => {
    const out = detectCornerReliefNeeds({
      thickness: 2,
      material: 'mildSteel',
      bendHistory: [bend(0.45), bend(0.55)],
    });
    expect(out).toHaveLength(0);
  });

  it('does NOT flag opposing directions (up + down is a jog, not a corner)', () => {
    const out = detectCornerReliefNeeds({
      thickness: 2,
      material: 'mildSteel',
      bendHistory: [bend(0.05, 2, 'up'), bend(0.10, 2, 'down')],
    });
    expect(out).toHaveLength(0);
  });

  it('uses thickness + radius for depth and 1.5T for width (industry rule)', () => {
    const out = detectCornerReliefNeeds({
      thickness: 2,
      material: 'mildSteel',
      bendHistory: [bend(0.05, 3), bend(0.10, 2)],
    });
    expect(out[0].width).toBeCloseTo(3, 5);       // 1.5 × 2
    expect(out[0].depth).toBeCloseTo(2 + 3, 5);   // T + max(R) = 2 + 3
  });

  it('suggests circular relief for high-tensile materials (stainless)', () => {
    const out = detectCornerReliefNeeds({
      thickness: 1.5,
      material: 'stainless304', // tensile 520 > 400 threshold
      bendHistory: [bend(0.05), bend(0.10)],
    });
    expect(out[0].shape).toBe('circular');
  });

  it('suggests rectangular relief for low-tensile materials (mild steel)', () => {
    const out = detectCornerReliefNeeds({
      thickness: 1.5,
      material: 'mildSteel', // tensile 270 < 400
      bendHistory: [bend(0.05), bend(0.10)],
    });
    expect(out[0].shape).toBe('rectangular');
  });

  it('returns empty list on zero thickness (input rejected)', () => {
    const out = detectCornerReliefNeeds({
      thickness: 0,
      material: 'mildSteel',
      bendHistory: [bend(0.05), bend(0.10)],
    });
    expect(out).toEqual([]);
  });

  it('emits N×(N−1)/2 pairs when more than two adjacent bends exist', () => {
    const out = detectCornerReliefNeeds({
      thickness: 1.5,
      material: 'mildSteel',
      bendHistory: [bend(0.05), bend(0.10), bend(0.15)],
    });
    expect(out).toHaveLength(3); // all-pairs: (0,1), (0,2), (1,2)
  });
});

describe('reliefSuggestionsToWarnings', () => {
  it('converts each suggestion into a warning-severity DFM entry', () => {
    const sugg = detectCornerReliefNeeds({
      thickness: 1.5,
      material: 'mildSteel',
      bendHistory: [bend(0.05), bend(0.10)],
    });
    const warns = reliefSuggestionsToWarnings(sugg);
    expect(warns).toHaveLength(1);
    expect(warns[0].severity).toBe('warning');
    expect(warns[0].messageEn).toMatch(/corner crack/);
  });

  it('preserves both Korean and English message text', () => {
    const sugg = detectCornerReliefNeeds({
      thickness: 1.5,
      material: 'mildSteel',
      bendHistory: [bend(0.05), bend(0.10)],
    });
    const warns = reliefSuggestionsToWarnings(sugg);
    expect(warns[0].messageKo).toMatch(/릴리프/);
    expect(warns[0].messageEn).toMatch(/relief/);
  });
});
