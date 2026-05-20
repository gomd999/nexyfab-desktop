import { describe, it, expect } from 'vitest';
import { calcFeedSpeed } from './feedSpeed';

describe('calcFeedSpeed', () => {
  it('returns positive RPM and feed for valid inputs', () => {
    const r = calcFeedSpeed({
      material: 'aluminum-6061',
      cutterType: 'flat-end',
      diameterMm: 6,
      fluteCount: 3,
      pass: 'rough',
    });
    expect(r.rpm).toBeGreaterThan(0);
    expect(r.feedMmMin).toBeGreaterThan(0);
  });

  it('aluminum gets higher RPM than steel for same cutter', () => {
    const alu = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 6, fluteCount: 3, pass: 'rough' });
    const steel = calcFeedSpeed({ material: 'steel-1018', cutterType: 'flat-end', diameterMm: 6, fluteCount: 3, pass: 'rough' });
    expect(alu.rpm).toBeGreaterThan(steel.rpm);
  });

  it('finishing pass halves chip load', () => {
    const rough = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 6, fluteCount: 3, pass: 'rough' });
    const finish = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 6, fluteCount: 3, pass: 'finish' });
    expect(finish.chipLoadMm).toBeCloseTo(rough.chipLoadMm * 0.5, 4);
  });

  it('ball-end reduces effective chip load', () => {
    const flat = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 6, fluteCount: 3, pass: 'rough' });
    const ball = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'ball-end', diameterMm: 6, fluteCount: 3, pass: 'rough' });
    expect(ball.chipLoadMm).toBeLessThan(flat.chipLoadMm);
  });

  it('warns on absurd inputs', () => {
    const r = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 0, fluteCount: 3, pass: 'rough' });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('warns on RPM > 24000', () => {
    // Tiny cutter in aluminum → super-high RPM.
    const r = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 0.5, fluteCount: 2, pass: 'rough' });
    expect(r.warnings.some(w => /RPM/.test(w))).toBe(true);
  });

  it('flute count linearly scales feed rate', () => {
    const f2 = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 6, fluteCount: 2, pass: 'rough' });
    const f4 = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 6, fluteCount: 4, pass: 'rough' });
    expect(f4.feedMmMin / f2.feedMmMin).toBeCloseTo(2, 1);
  });

  it('larger diameter increases chip load (sqrt scaling)', () => {
    const small = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 3, fluteCount: 3, pass: 'rough' });
    const big = calcFeedSpeed({ material: 'aluminum-6061', cutterType: 'flat-end', diameterMm: 12, fluteCount: 3, pass: 'rough' });
    expect(big.chipLoadMm).toBeGreaterThan(small.chipLoadMm);
  });
});
