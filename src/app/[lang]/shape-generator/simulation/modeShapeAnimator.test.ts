import { describe, it, expect } from 'vitest';
import {
  buildModeAnimation,
  interpolateFrames,
  summarize,
  type MeshArrays,
  type ModeShape,
} from './modeShapeAnimator';

function unitCubeMesh(): MeshArrays {
  return {
    positions: [
      0, 0, 0,  10, 0, 0,  10, 10, 0,  0, 10, 0,
      0, 0, 10,  10, 0, 10,  10, 10, 10,  0, 10, 10,
    ],
    indices: [],
  };
}

function uniformBendMode(): ModeShape {
  // Vertices 4-7 (top) displaced +X by 1; bottom not displaced.
  const d = new Array(24).fill(0);
  for (let v = 4; v < 8; v++) {
    d[v * 3] = 1; // dx
  }
  return { displacements: d, frequencyHz: 50, modeIndex: 0 };
}

describe('buildModeAnimation', () => {
  it('empty mesh → empty result', () => {
    const r = buildModeAnimation({ positions: [], indices: [] }, uniformBendMode());
    expect(r.frames).toEqual([]);
  });

  it('produces requested number of frames', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode(), { fps: 30, durationSec: 1 });
    expect(r.frames.length).toBe(30);
  });

  it('frames sample times from 0 to duration', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode(), { fps: 10, durationSec: 1 });
    expect(r.frames[0]!.timeSec).toBeCloseTo(0, 5);
    expect(r.frames[r.frames.length - 1]!.timeSec).toBeCloseTo(0.9, 1);
  });

  it('first frame has zero displacement (sin(0) = 0)', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode());
    expect(r.frames[0]!.maxDisplacementMm).toBeCloseTo(0, 5);
  });

  it('auto scale produces non-trivial displacement', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode());
    expect(r.appliedScale).toBeGreaterThan(0);
  });

  it('scale override is respected', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode(), { scaleOverride: 2 });
    expect(r.appliedScale).toBe(2);
  });

  it('per-vertex strain proxy reflects displacement magnitudes', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode());
    expect(r.perVertexStrainProxy.slice(4, 8).every(v => v > 0)).toBe(true);
    expect(r.perVertexStrainProxy.slice(0, 4).every(v => v === 0)).toBe(true);
  });

  it('higher frequency does not change frame count', () => {
    const slow = buildModeAnimation(unitCubeMesh(), { ...uniformBendMode(), frequencyHz: 1 }, { fps: 30, durationSec: 1 });
    const fast = buildModeAnimation(unitCubeMesh(), { ...uniformBendMode(), frequencyHz: 100 }, { fps: 30, durationSec: 1 });
    expect(slow.frames.length).toBe(fast.frames.length);
  });
});

describe('interpolateFrames', () => {
  it('t=0 yields a-like frame', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode(), { fps: 30, durationSec: 1 });
    const interp = interpolateFrames(r.frames[0]!, r.frames[1]!, 0);
    expect(interp.positions).toEqual(r.frames[0]!.positions);
  });

  it('t=1 yields b-like frame', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode(), { fps: 30, durationSec: 1 });
    const interp = interpolateFrames(r.frames[0]!, r.frames[1]!, 1);
    expect(interp.positions).toEqual(r.frames[1]!.positions);
  });

  it('midpoint averages positions', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode(), { fps: 30, durationSec: 1 });
    const interp = interpolateFrames(r.frames[0]!, r.frames[1]!, 0.5);
    expect(interp.positions[0]).toBeCloseTo((r.frames[0]!.positions[0]! + r.frames[1]!.positions[0]!) / 2, 5);
  });
});

describe('summarize', () => {
  it('empty result', () => {
    const r = buildModeAnimation({ positions: [], indices: [] }, uniformBendMode());
    const s = summarize(r, 24);
    expect(s.frameCount).toBe(0);
  });

  it('reports frame count and fps', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode(), { fps: 24, durationSec: 2 });
    const s = summarize(r, 24);
    expect(s.frameCount).toBe(48);
    expect(s.fps).toBe(24);
  });

  it('peakDisplacement equals max across frames', () => {
    const r = buildModeAnimation(unitCubeMesh(), uniformBendMode(), { fps: 24, durationSec: 2 });
    const s = summarize(r, 24);
    const max = r.frames.reduce((m, f) => Math.max(m, f.maxDisplacementMm), 0);
    expect(s.peakDisplacementMm).toBeCloseTo(max, 5);
  });
});
