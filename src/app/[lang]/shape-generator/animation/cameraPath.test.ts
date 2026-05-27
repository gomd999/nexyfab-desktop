import { describe, it, expect } from 'vitest';
import {
  applyEasing,
  sampleCamera,
  generateFrames,
  buildOrbit,
  buildFlyby,
  buildPushIn,
  buildDollyZoom,
  biasRuleOfThirds,
  type Keyframe,
  type CameraPath,
} from './cameraPath';

describe('applyEasing', () => {
  it('linear is identity', () => {
    expect(applyEasing(0.3, 'linear')).toBe(0.3);
  });

  it('all easings return 0 at t=0', () => {
    for (const e of ['ease-in-quad', 'ease-out-quad', 'ease-in-cubic', 'ease-out-cubic', 'ease-in-out-quad', 'ease-in-out-cubic', 'cubic-bezier'] as const) {
      expect(applyEasing(0, e)).toBeCloseTo(0, 5);
    }
  });

  it('all easings return 1 at t=1', () => {
    for (const e of ['ease-in-quad', 'ease-out-quad', 'ease-in-cubic', 'ease-out-cubic', 'ease-in-out-quad', 'ease-in-out-cubic'] as const) {
      expect(applyEasing(1, e)).toBeCloseTo(1, 5);
    }
  });

  it('ease-in-quad < t for t in (0, 1)', () => {
    expect(applyEasing(0.5, 'ease-in-quad')).toBe(0.25);
  });

  it('ease-out-quad > t for t in (0, 1)', () => {
    expect(applyEasing(0.5, 'ease-out-quad')).toBeGreaterThan(0.5);
  });
});

describe('sampleCamera', () => {
  const path: CameraPath = {
    keyframes: [
      { timeSec: 0, state: { positionMm: [0, 0, 0], lookAtMm: [0, 0, 0], upVector: [0, 1, 0], fovYRad: 1, aspect: 1 } },
      { timeSec: 1, state: { positionMm: [10, 0, 0], lookAtMm: [0, 0, 0], upVector: [0, 1, 0], fovYRad: 1, aspect: 1 }, easing: 'linear' },
    ],
  };

  it('returns first keyframe at t=0', () => {
    expect(sampleCamera(path, 0).positionMm[0]).toBe(0);
  });

  it('returns last keyframe at t≥end', () => {
    expect(sampleCamera(path, 5).positionMm[0]).toBe(10);
  });

  it('midway with linear easing → midpoint', () => {
    expect(sampleCamera(path, 0.5).positionMm[0]).toBeCloseTo(5, 5);
  });

  it('clamps before first keyframe', () => {
    expect(sampleCamera(path, -1).positionMm[0]).toBe(0);
  });

  it('empty path → default state', () => {
    expect(sampleCamera({ keyframes: [] }, 0).fovYRad).toBeGreaterThan(0);
  });
});

describe('generateFrames', () => {
  it('produces fps × duration frames', () => {
    const path = buildFlyby([0, 0, 100], [100, 0, 100], [50, 0, 0], 2);
    const frames = generateFrames(path, { fps: 30 });
    expect(frames.length).toBeGreaterThan(50);
  });

  it('respects start/end overrides', () => {
    const path = buildFlyby([0, 0, 100], [100, 0, 100], [50, 0, 0], 10);
    const frames = generateFrames(path, { fps: 30, startSec: 1, endSec: 2 });
    expect(frames.length).toBeLessThan(40);
  });

  it('empty path → empty frames', () => {
    expect(generateFrames({ keyframes: [] }, { fps: 30 })).toEqual([]);
  });
});

describe('buildOrbit', () => {
  it('produces requested keyframe count', () => {
    const path = buildOrbit([0, 0, 0], 50, 20, 4, Math.PI / 3, 16 / 9, 8);
    expect(path.keyframes).toHaveLength(8);
  });

  it('orbit positions equidistant from target', () => {
    const path = buildOrbit([0, 0, 0], 50, 20, 4, Math.PI / 3, 16 / 9, 4);
    for (const kf of path.keyframes) {
      const d = Math.hypot(kf.state.positionMm[0], kf.state.positionMm[2]);
      expect(d).toBeCloseTo(50, 4);
    }
  });

  it('all lookAt point at target', () => {
    const path = buildOrbit([5, 0, 5], 10, 2, 4, Math.PI / 3, 16 / 9, 4);
    for (const kf of path.keyframes) {
      expect(kf.state.lookAtMm).toEqual([5, 0, 5]);
    }
  });
});

describe('buildFlyby', () => {
  it('has 2 keyframes', () => {
    const path = buildFlyby([0, 0, 100], [100, 0, 100], [50, 0, 0], 3);
    expect(path.keyframes).toHaveLength(2);
  });

  it('end keyframe uses cubic easing', () => {
    const path = buildFlyby([0, 0, 100], [100, 0, 100], [50, 0, 0], 3);
    expect(path.keyframes[1]!.easing).toBe('ease-in-out-cubic');
  });
});

describe('buildPushIn', () => {
  it('ends near target with specified distance', () => {
    const path = buildPushIn([0, 0, 100], [0, 0, 0], 10, 3);
    const end = path.keyframes[1]!.state.positionMm;
    const d = Math.hypot(end[0], end[1], end[2]);
    expect(d).toBeCloseTo(10, 4);
  });
});

describe('buildDollyZoom', () => {
  it('FOV at start differs from end', () => {
    const path = buildDollyZoom([0, 0, 100], [0, 0, 20], [0, 0, 0], 30, 3);
    expect(path.keyframes[0]!.state.fovYRad).not.toBeCloseTo(path.keyframes[1]!.state.fovYRad, 5);
  });

  it('closer camera has wider FOV (constant subject size)', () => {
    const path = buildDollyZoom([0, 0, 100], [0, 0, 20], [0, 0, 0], 30, 3);
    const f1 = path.keyframes[0]!.state.fovYRad;
    const f2 = path.keyframes[1]!.state.fovYRad;
    expect(f2).toBeGreaterThan(f1);
  });
});

describe('biasRuleOfThirds', () => {
  it('horizontal shift moves lookAt X', () => {
    const state = { positionMm: [0, 0, 0] as [number, number, number], lookAtMm: [0, 0, 0] as [number, number, number], upVector: [0, 1, 0] as [number, number, number], fovYRad: 1, aspect: 1 };
    const r = biasRuleOfThirds(state, 'horizontal', 1, 5);
    expect(r.lookAtMm[0]).toBe(5);
  });

  it('vertical shift moves lookAt Y', () => {
    const state = { positionMm: [0, 0, 0] as [number, number, number], lookAtMm: [0, 0, 0] as [number, number, number], upVector: [0, 1, 0] as [number, number, number], fovYRad: 1, aspect: 1 };
    const r = biasRuleOfThirds(state, 'vertical', -1, 3);
    expect(r.lookAtMm[1]).toBe(-3);
  });
});
