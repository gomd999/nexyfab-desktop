import { describe, it, expect } from 'vitest';
import {
  valueAtTime,
  sampleStudy,
  setKeyframe,
  removeKeyframe,
  type MotionDriver,
  type MotionStudy,
} from './motionStudy';

const linearDriver: MotionDriver = {
  id: 'd1', targetId: 'mate1', paramKey: 'angle',
  interpolation: 'linear',
  keyframes: [
    { t: 0, value: 0 },
    { t: 2, value: 90 },
    { t: 4, value: 180 },
  ],
};

describe('valueAtTime', () => {
  it('returns null for empty driver', () => {
    expect(valueAtTime({ ...linearDriver, keyframes: [] }, 1)).toBeNull();
  });

  it('clamps to first keyframe before start', () => {
    expect(valueAtTime(linearDriver, -1)).toBe(0);
  });

  it('clamps to last keyframe after end', () => {
    expect(valueAtTime(linearDriver, 99)).toBe(180);
  });

  it('linear interpolates between keyframes', () => {
    expect(valueAtTime(linearDriver, 1)).toBe(45);
    expect(valueAtTime(linearDriver, 3)).toBe(135);
  });

  it('step mode holds value', () => {
    const stepDriver: MotionDriver = { ...linearDriver, interpolation: 'step' };
    expect(valueAtTime(stepDriver, 1.5)).toBe(0); // still at first keyframe value
  });

  it('ease mode produces smooth output', () => {
    const easeDriver: MotionDriver = {
      ...linearDriver, interpolation: 'ease',
      keyframes: [
        { t: 0, value: 0, tangentOut: 0 },
        { t: 2, value: 100, tangentIn: 0 },
      ],
    };
    const mid = valueAtTime(easeDriver, 1)!;
    // Hermite midpoint should be 50 (zero tangents → cubic ease-in-out symmetric at mid).
    expect(mid).toBeCloseTo(50, 5);
  });
});

describe('sampleStudy', () => {
  const study: MotionStudy = {
    id: 's1', name: 'Test', durationSec: 4, fps: 30,
    drivers: [linearDriver],
  };

  it('returns updates for each driver', () => {
    const out = sampleStudy(study, 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.value).toBe(45);
  });

  it('skips drivers with no keyframes', () => {
    const s: MotionStudy = {
      ...study,
      drivers: [...study.drivers, { ...linearDriver, id: 'd2', keyframes: [] }],
    };
    const out = sampleStudy(s, 1);
    expect(out).toHaveLength(1);
  });
});

describe('setKeyframe / removeKeyframe', () => {
  it('insert keeps array sorted', () => {
    const d: MotionDriver = { ...linearDriver, keyframes: [{ t: 0, value: 0 }, { t: 5, value: 100 }] };
    setKeyframe(d, { t: 2, value: 40 });
    expect(d.keyframes.map(k => k.t)).toEqual([0, 2, 5]);
  });

  it('replace existing keyframe', () => {
    const d: MotionDriver = { ...linearDriver, keyframes: [{ t: 0, value: 0 }] };
    setKeyframe(d, { t: 0, value: 50 });
    expect(d.keyframes[0]!.value).toBe(50);
  });

  it('remove returns true/false', () => {
    const d: MotionDriver = { ...linearDriver, keyframes: [{ t: 0, value: 0 }] };
    expect(removeKeyframe(d, 0)).toBe(true);
    expect(removeKeyframe(d, 99)).toBe(false);
  });
});
