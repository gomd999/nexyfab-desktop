import { describe, it, expect } from 'vitest';
import {
  interpolateScalar,
  interpolateVec3,
  sampleFrame,
  renderFrames,
  generateExplodedTimeline,
  addCallout,
  generateOrbitCamera,
  type Timeline,
  type Track,
  type Vec3,
} from './composerTimeline';

describe('interpolateScalar', () => {
  it('clamps to first keyframe before its t', () => {
    const tr: Track<number> = { actorId: 'a', property: 'opacity', keyframes: [{ t: 1, value: 5 }, { t: 2, value: 10 }] };
    expect(interpolateScalar(tr, 0)).toBe(5);
  });

  it('clamps to last keyframe after its t', () => {
    const tr: Track<number> = { actorId: 'a', property: 'opacity', keyframes: [{ t: 1, value: 5 }, { t: 2, value: 10 }] };
    expect(interpolateScalar(tr, 3)).toBe(10);
  });

  it('linear midpoint', () => {
    const tr: Track<number> = { actorId: 'a', property: 'opacity', keyframes: [{ t: 0, value: 0 }, { t: 2, value: 10, easing: 'linear' }] };
    expect(interpolateScalar(tr, 1)).toBe(5);
  });

  it('step easing snaps', () => {
    const tr: Track<number> = { actorId: 'a', property: 'opacity', keyframes: [{ t: 0, value: 0 }, { t: 1, value: 10, easing: 'step' }] };
    expect(interpolateScalar(tr, 0.99)).toBe(0);
    expect(interpolateScalar(tr, 1)).toBe(10);
  });

  it('empty keyframes → 0', () => {
    const tr: Track<number> = { actorId: 'a', property: 'opacity', keyframes: [] };
    expect(interpolateScalar(tr, 0)).toBe(0);
  });
});

describe('interpolateVec3', () => {
  it('linear interpolation per axis', () => {
    const tr: Track<Vec3> = { actorId: 'a', property: 'position', keyframes: [{ t: 0, value: [0, 0, 0] }, { t: 2, value: [10, 20, 30] }] };
    expect(interpolateVec3(tr, 1)).toEqual([5, 10, 15]);
  });
});

describe('sampleFrame', () => {
  it('returns position from track', () => {
    const timeline: Timeline = {
      duration: 2,
      tracks: [{
        actorId: 'box', property: 'position',
        keyframes: [{ t: 0, value: [0, 0, 0] as Vec3 }, { t: 2, value: [10, 0, 0] as Vec3 }],
      } as Track<Vec3>],
      captionEvents: [],
    };
    const f = sampleFrame(timeline, 1, ['box']);
    expect(f.actors['box']!.position).toEqual([5, 0, 0]);
  });

  it('captions visible during their duration', () => {
    const timeline: Timeline = {
      duration: 5,
      tracks: [],
      captionEvents: [{ t: 1, durationSec: 2, text: 'hello', positionScreen: [100, 100] }],
    };
    const f1 = sampleFrame(timeline, 1.5, []);
    expect(f1.captions).toHaveLength(1);
    const f2 = sampleFrame(timeline, 4, []);
    expect(f2.captions).toHaveLength(0);
  });

  it('caption opacity fades in/out', () => {
    const timeline: Timeline = {
      duration: 5,
      tracks: [],
      captionEvents: [{ t: 0, durationSec: 10, text: 'x', positionScreen: [0, 0] }],
    };
    // localT = 0.05 (in fade-in window 0..0.1) — opacity should be 0.5.
    const f = sampleFrame(timeline, 0.5, []);
    expect(f.captions[0]!.opacity).toBeCloseTo(0.5, 1);
  });
});

describe('renderFrames', () => {
  it('emits duration × fps frames', () => {
    const timeline: Timeline = {
      duration: 2,
      tracks: [],
      captionEvents: [],
    };
    const frames = renderFrames(timeline, [], 30);
    expect(frames.length).toBe(60);
  });
});

describe('generateExplodedTimeline', () => {
  it('one position track per actor', () => {
    const timeline = generateExplodedTimeline([
      { id: 'a', basePosition: [10, 0, 0], explodeDistanceMm: 50 },
      { id: 'b', basePosition: [-10, 0, 0], explodeDistanceMm: 50 },
    ], { explodeDurationSec: 1, holdDurationSec: 1, reassembleDurationSec: 1 });
    expect(timeline.tracks).toHaveLength(2);
  });

  it('returns to base position at end (4 keyframes)', () => {
    const t = generateExplodedTimeline([
      { id: 'a', basePosition: [10, 5, 0], explodeDistanceMm: 50 },
    ], { explodeDurationSec: 1, holdDurationSec: 1, reassembleDurationSec: 1 });
    const track = t.tracks[0]!;
    const last = track.keyframes[track.keyframes.length - 1]!.value as Vec3;
    expect(last).toEqual([10, 5, 0]);
  });

  it('stagger spaces actors in time', () => {
    const t = generateExplodedTimeline([
      { id: 'a', basePosition: [10, 0, 0], explodeDistanceMm: 50 },
      { id: 'b', basePosition: [-10, 0, 0], explodeDistanceMm: 50 },
    ], { explodeDurationSec: 1, holdDurationSec: 1, reassembleDurationSec: 1, staggerSec: 0.5 });
    expect(t.duration).toBeGreaterThan(3);
  });
});

describe('addCallout', () => {
  it('appends caption + extends duration', () => {
    const timeline: Timeline = { duration: 2, tracks: [], captionEvents: [] };
    addCallout(timeline, 3, 1, 'note', [50, 50]);
    expect(timeline.captionEvents).toHaveLength(1);
    expect(timeline.duration).toBe(4);
  });
});

describe('generateOrbitCamera', () => {
  it('camera positions sweep through angle range', () => {
    const r = generateOrbitCamera([0, 0, 0], 100, 0, 360, 4);
    expect(r.cameraTrack.keyframes.length).toBeGreaterThan(4);
  });

  it('camera target track holds center', () => {
    const r = generateOrbitCamera([5, 5, 5], 100, 0, 90, 2);
    expect(r.cameraTargetTrack.keyframes[0]!.value).toEqual([5, 5, 5]);
  });
});
