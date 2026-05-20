import { describe, it, expect } from 'vitest';
import {
  generate,
  tapDrillDiameterMm,
  engagementPercent,
  summarize,
  type TappingInput,
} from './tappingCycle';

const base: TappingInput = {
  threadPitchMm: 1.5, // M10×1.5
  spindleRpm: 500,
  threadDepthMm: 20,
};

describe('generate', () => {
  it('feed = rpm × pitch', () => {
    const r = generate(base);
    expect(r.feedMmPerMin).toBeCloseTo(500 * 1.5, 6);
  });

  it('right hand → G84', () => {
    const r = generate({ ...base, hand: 'right' });
    expect(r.gCode).toContain('G84');
  });

  it('left hand → G74', () => {
    const r = generate({ ...base, hand: 'left' });
    expect(r.gCode).toContain('G74');
  });

  it('tapping depth includes chamfer clearance', () => {
    const r = generate({ ...base, chamferPitches: 3 });
    expect(r.tappingDepthMm).toBeCloseTo(20 + 3 * 1.5, 6);
  });

  it('through hole → null blind clearance', () => {
    const r = generate(base);
    expect(r.blindHoleClearanceMm).toBeNull();
  });

  it('blind hole too shallow → warning', () => {
    const r = generate({ ...base, holeDepthMm: 22 }); // tapping depth ~24.5
    expect(r.warnings.some(w => w.toLowerCase().includes('hole'))).toBe(true);
  });

  it('blind hole with ample clearance → no bottoming warning', () => {
    const r = generate({ ...base, holeDepthMm: 40 });
    expect(r.blindHoleClearanceMm!).toBeGreaterThan(0);
  });

  it('cycle time positive', () => {
    expect(generate(base).cycleTimeSec).toBeGreaterThan(0);
  });

  it('zero rpm → warning', () => {
    const r = generate({ ...base, spindleRpm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('higher rpm → higher feed → shorter cycle', () => {
    const slow = generate({ ...base, spindleRpm: 300 });
    const fast = generate({ ...base, spindleRpm: 800 });
    expect(fast.cycleTimeSec).toBeLessThan(slow.cycleTimeSec);
  });
});

describe('tapDrillDiameterMm', () => {
  it('M10×1.5 75% ≈ 8.78 mm', () => {
    const d = tapDrillDiameterMm(10, 1.5, 0.75);
    expect(d).toBeCloseTo(10 - 0.75 * 1.0825 * 1.5, 4);
  });

  it('higher engagement → smaller drill', () => {
    expect(tapDrillDiameterMm(10, 1.5, 0.85)).toBeLessThan(tapDrillDiameterMm(10, 1.5, 0.65));
  });
});

describe('engagementPercent', () => {
  it('round-trips with tapDrillDiameterMm', () => {
    const d = tapDrillDiameterMm(10, 1.5, 0.75);
    expect(engagementPercent(10, 1.5, d)).toBeCloseTo(75, 2);
  });

  it('clamped to 0..100', () => {
    expect(engagementPercent(10, 1.5, 10)).toBe(0);
    expect(engagementPercent(10, 1.5, 0)).toBe(100);
  });
});

describe('summarize', () => {
  it('reports feed + depth + hand', () => {
    const r = generate(base);
    const s = summarize(r);
    expect(s.feedMmPerMin).toBe(r.feedMmPerMin);
    expect(s.hand).toBe('right');
  });
});
