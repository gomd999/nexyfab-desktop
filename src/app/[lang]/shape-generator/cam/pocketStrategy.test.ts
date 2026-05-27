import { describe, it, expect } from 'vitest';
import { planPocket } from './pocketStrategy';

describe('planPocket', () => {
  it('picks trochoidal for narrow slot', () => {
    const r = planPocket({ bboxWidthMm: 5, bboxLengthMm: 100, depthMm: 10, toolDiamMm: 4 });
    expect(r.strategy).toBe('trochoidal');
    expect(r.rationale).toMatch(/slot/);
  });

  it('picks spiral for round pocket', () => {
    const r = planPocket({ bboxWidthMm: 50, bboxLengthMm: 50, depthMm: 10, toolDiamMm: 6, geometryKind: 'round' });
    expect(r.strategy).toBe('spiral');
  });

  it('picks raster for elongated rectangle', () => {
    const r = planPocket({ bboxWidthMm: 30, bboxLengthMm: 200, depthMm: 5, toolDiamMm: 6 });
    expect(r.strategy).toBe('raster');
    expect(r.rationale).toMatch(/aspect/);
  });

  it('picks spiral for square pocket', () => {
    const r = planPocket({ bboxWidthMm: 40, bboxLengthMm: 45, depthMm: 5, toolDiamMm: 6 });
    expect(r.strategy).toBe('spiral');
  });

  it('passes count scales with depth', () => {
    const shallow = planPocket({ bboxWidthMm: 50, bboxLengthMm: 50, depthMm: 3, toolDiamMm: 6 });
    const deep = planPocket({ bboxWidthMm: 50, bboxLengthMm: 50, depthMm: 30, toolDiamMm: 6 });
    expect(deep.passes).toBeGreaterThan(shallow.passes);
  });

  it('returns zero passes for zero/negative depth', () => {
    const r = planPocket({ bboxWidthMm: 50, bboxLengthMm: 50, depthMm: 0, toolDiamMm: 6 });
    expect(r.passes).toBe(0);
  });

  it('respects custom stepover ratio', () => {
    const default40 = planPocket({ bboxWidthMm: 50, bboxLengthMm: 50, depthMm: 5, toolDiamMm: 10 });
    const aggressive80 = planPocket({ bboxWidthMm: 50, bboxLengthMm: 50, depthMm: 5, toolDiamMm: 10, stepoverRatio: 0.8 });
    expect(aggressive80.stepoverMm).toBeGreaterThan(default40.stepoverMm);
    expect(aggressive80.estimatedToolPathMm).toBeLessThan(default40.estimatedToolPathMm);
  });

  it('toolpath estimate is positive for non-zero pocket', () => {
    const r = planPocket({ bboxWidthMm: 50, bboxLengthMm: 50, depthMm: 5, toolDiamMm: 6 });
    expect(r.estimatedToolPathMm).toBeGreaterThan(0);
  });
});
