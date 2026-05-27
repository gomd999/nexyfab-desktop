import { describe, it, expect } from 'vitest';
import {
  createTimeline,
  addTrack,
  insertKeyframe,
  removeKeyframe,
  moveKeyframe,
  sampleTrack,
  sampleTimeline,
  generateFrames,
  applyEasing,
  retimeTrack,
  snapTime,
  summarize,
  type Track,
} from './motionTimelineEditor';

describe('timeline construction', () => {
  it('createTimeline empty', () => {
    const t = createTimeline(5);
    expect(t.durationSec).toBe(5);
    expect(t.tracks.size).toBe(0);
  });

  it('addTrack stores by id', () => {
    const t = createTimeline();
    addTrack<number>(t, 'fov', 'number', [{ timeSec: 0, value: 60, easing: 'linear' }]);
    expect(t.tracks.has('fov')).toBe(true);
  });

  it('addTrack sorts keyframes by time', () => {
    const t = createTimeline();
    addTrack<number>(t, 'fov', 'number', [
      { timeSec: 1, value: 2, easing: 'linear' },
      { timeSec: 0, value: 1, easing: 'linear' },
    ]);
    const track = t.tracks.get('fov')!;
    expect(track.keyframes[0]!.timeSec).toBe(0);
  });
});

describe('insertKeyframe', () => {
  it('inserts in sorted order', () => {
    const t: Track<number> = { id: 'x', kind: 'number', keyframes: [] };
    insertKeyframe(t, { timeSec: 1, value: 1, easing: 'linear' });
    insertKeyframe(t, { timeSec: 0.5, value: 0.5, easing: 'linear' });
    expect(t.keyframes.map(k => k.timeSec)).toEqual([0.5, 1]);
  });

  it('replaces keyframe at same time', () => {
    const t: Track<number> = { id: 'x', kind: 'number', keyframes: [{ timeSec: 1, value: 1, easing: 'linear' }] };
    insertKeyframe(t, { timeSec: 1, value: 99, easing: 'linear' });
    expect(t.keyframes).toHaveLength(1);
    expect(t.keyframes[0]!.value).toBe(99);
  });
});

describe('removeKeyframe', () => {
  it('drops matching time', () => {
    const t: Track<number> = { id: 'x', kind: 'number', keyframes: [{ timeSec: 1, value: 1, easing: 'linear' }] };
    expect(removeKeyframe(t, 1)).toBe(true);
    expect(t.keyframes).toHaveLength(0);
  });

  it('returns false when missing', () => {
    const t: Track<number> = { id: 'x', kind: 'number', keyframes: [] };
    expect(removeKeyframe(t, 1)).toBe(false);
  });
});

describe('moveKeyframe', () => {
  it('moves and re-sorts', () => {
    const t: Track<number> = {
      id: 'x', kind: 'number',
      keyframes: [
        { timeSec: 0, value: 0, easing: 'linear' },
        { timeSec: 1, value: 1, easing: 'linear' },
      ],
    };
    moveKeyframe(t, 1, 0.5);
    expect(t.keyframes[1]!.timeSec).toBe(0.5);
  });
});

describe('sampleTrack — number', () => {
  it('linear interpolation midpoint', () => {
    const t: Track<number> = {
      id: 'x', kind: 'number',
      keyframes: [
        { timeSec: 0, value: 0, easing: 'linear' },
        { timeSec: 1, value: 10, easing: 'linear' },
      ],
    };
    expect(sampleTrack(t, 0.5)).toBe(5);
  });

  it('clamps below first keyframe', () => {
    const t: Track<number> = {
      id: 'x', kind: 'number',
      keyframes: [{ timeSec: 1, value: 5, easing: 'linear' }],
    };
    expect(sampleTrack(t, 0)).toBe(5);
  });

  it('null for empty track', () => {
    const t: Track<number> = { id: 'x', kind: 'number', keyframes: [] };
    expect(sampleTrack(t, 0.5)).toBeNull();
  });
});

describe('sampleTrack — vec3', () => {
  it('interpolates per-component', () => {
    const t: Track<[number, number, number]> = {
      id: 'pos', kind: 'vec3',
      keyframes: [
        { timeSec: 0, value: [0, 0, 0], easing: 'linear' },
        { timeSec: 1, value: [10, 20, 30], easing: 'linear' },
      ],
    };
    expect(sampleTrack(t, 0.5)).toEqual([5, 10, 15]);
  });
});

describe('sampleTrack — quaternion', () => {
  it('slerp returns unit quaternion', () => {
    const t: Track<[number, number, number, number]> = {
      id: 'rot', kind: 'quaternion',
      keyframes: [
        { timeSec: 0, value: [0, 0, 0, 1], easing: 'linear' },
        { timeSec: 1, value: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)], easing: 'linear' },
      ],
    };
    const r = sampleTrack(t, 0.5)!;
    const len = Math.hypot(r[0], r[1], r[2], r[3]);
    expect(len).toBeCloseTo(1, 4);
  });
});

describe('sampleTimeline', () => {
  it('samples every track', () => {
    const t = createTimeline();
    addTrack<number>(t, 'fov', 'number', [{ timeSec: 0, value: 60, easing: 'linear' }]);
    addTrack<[number, number, number]>(t, 'pos', 'vec3', [{ timeSec: 0, value: [0, 0, 0], easing: 'linear' }]);
    const frame = sampleTimeline(t, 0);
    expect(frame.trackValues.size).toBe(2);
  });
});

describe('generateFrames', () => {
  it('produces fps × duration frames', () => {
    const t = createTimeline(2);
    addTrack<number>(t, 'fov', 'number', [{ timeSec: 0, value: 60, easing: 'linear' }]);
    const frames = generateFrames(t, 30);
    expect(frames.length).toBeGreaterThan(50);
  });
});

describe('applyEasing', () => {
  it('linear identity', () => {
    expect(applyEasing(0.3, 'linear')).toBe(0.3);
  });

  it('step returns 0', () => {
    expect(applyEasing(0.99, 'step')).toBe(0);
  });

  it('ease-in below linear', () => {
    expect(applyEasing(0.5, 'ease-in')).toBeLessThan(0.5);
  });

  it('bezier falls back to linear without handles', () => {
    expect(applyEasing(0.5, 'bezier')).toBe(0.5);
  });
});

describe('retimeTrack', () => {
  it('scales keyframe times', () => {
    const t: Track<number> = {
      id: 'x', kind: 'number',
      keyframes: [
        { timeSec: 0, value: 0, easing: 'linear' },
        { timeSec: 1, value: 1, easing: 'linear' },
        { timeSec: 2, value: 2, easing: 'linear' },
      ],
    };
    retimeTrack(t, 0.5);
    expect(t.keyframes[2]!.timeSec).toBe(1);
  });

  it('clamps to maxSec', () => {
    const t: Track<number> = {
      id: 'x', kind: 'number',
      keyframes: [{ timeSec: 10, value: 0, easing: 'linear' }],
    };
    retimeTrack(t, 2, 15);
    expect(t.keyframes[0]!.timeSec).toBe(15);
  });
});

describe('snapTime', () => {
  it('snaps to nearby marker', () => {
    const t = createTimeline();
    t.markers.push({ timeSec: 1, label: 'chapter1' });
    expect(snapTime(t, 0.98, 0.05)).toBe(1);
  });

  it('preserves time when outside snap window', () => {
    const t = createTimeline();
    t.markers.push({ timeSec: 1, label: 'chapter1' });
    expect(snapTime(t, 0.5, 0.05)).toBe(0.5);
  });
});

describe('summarize', () => {
  it('counts tracks + keyframes', () => {
    const t = createTimeline();
    addTrack<number>(t, 'fov', 'number', [{ timeSec: 0, value: 60, easing: 'linear' }]);
    addTrack<number>(t, 'empty', 'number');
    const s = summarize(t);
    expect(s.trackCount).toBe(2);
    expect(s.totalKeyframes).toBe(1);
    expect(s.emptyTrackIds).toContain('empty');
  });
});
