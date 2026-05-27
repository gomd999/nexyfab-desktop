import { describe, it, expect } from 'vitest';
import {
  poseToMatrix4,
  snapToFloor,
  snapToWall,
  coLocationTransform,
  detectXrDevice,
  type ArPose,
} from './arPlacement';

const identityPose: ArPose = { position: [0, 0, 0], orientation: [0, 0, 0, 1] };

describe('poseToMatrix4', () => {
  it('identity quaternion produces identity rotation portion', () => {
    const m = poseToMatrix4(identityPose);
    expect(m[0]).toBeCloseTo(1, 6);
    expect(m[5]).toBeCloseTo(1, 6);
    expect(m[10]).toBeCloseTo(1, 6);
    expect(m[15]).toBe(1);
  });

  it('encodes translation in the last column', () => {
    const m = poseToMatrix4({ position: [1, 2, 3], orientation: [0, 0, 0, 1] });
    expect(m[3]).toBe(1);
    expect(m[7]).toBe(2);
    expect(m[11]).toBe(3);
  });

  it('90° Y rotation swaps X/Z axes', () => {
    // q for 90° about Y = (0, sin45, 0, cos45)
    const s = Math.SQRT1_2;
    const m = poseToMatrix4({ position: [0, 0, 0], orientation: [0, s, 0, s] });
    // X axis maps to -Z under +90° Y rotation.
    expect(m[0]).toBeCloseTo(0, 6);
    expect(m[8]).toBeCloseTo(-1, 6);
  });
});

describe('snapToFloor', () => {
  it('lifts model so bbox bottom sits on hit Y', () => {
    const adj = snapToFloor([-5, -3, -5], { position: [10, 1, 20], orientation: [0, 0, 0, 1] });
    expect(adj.position[1]).toBeCloseTo(1 - (-3), 6); // = 4
    expect(adj.position[0]).toBe(10);
    expect(adj.position[2]).toBe(20);
  });

  it('preserves orientation', () => {
    const q: ArPose['orientation'] = [0.1, 0.2, 0.3, 0.9];
    const adj = snapToFloor([0, 0, 0], { position: [0, 0, 0], orientation: q });
    expect(adj.orientation).toEqual(q);
  });
});

describe('snapToWall', () => {
  it('offsets along +X wall normal', () => {
    const adj = snapToWall([-1, -1, -1], [1, 1, 1], { position: [5, 0, 0], orientation: [0, 0, 0, 1] }, [1, 0, 0]);
    // wall normal +X → bbox.max[0]=1 sits against wall, so position pushed by -1.
    expect(adj.position[0]).toBeCloseTo(4, 6);
  });

  it('offsets along -X wall normal', () => {
    const adj = snapToWall([-1, -1, -1], [1, 1, 1], { position: [5, 0, 0], orientation: [0, 0, 0, 1] }, [-1, 0, 0]);
    // wall normal -X → bbox.min[0]=-1 against wall, so position pushed by +1.
    expect(adj.position[0]).toBeCloseTo(6, 6);
  });

  it('picks the dominant axis when normal is mixed', () => {
    // Normal mostly along +Y.
    const adj = snapToWall([-1, -1, -1], [1, 2, 1], { position: [0, 5, 0], orientation: [0, 0, 0, 1] }, [0.1, 0.9, 0.0]);
    expect(adj.position[1]).toBeCloseTo(3, 6); // 5 - 2
  });
});

describe('coLocationTransform', () => {
  it('identity poses produce identity rotation + zero translation', () => {
    const t = coLocationTransform(identityPose, identityPose);
    expect(t.rotation[3]).toBeCloseTo(1, 6);
    expect(t.translation).toEqual([0, 0, 0]);
  });

  it('returns position delta for translated anchor', () => {
    const a = identityPose;
    const b: ArPose = { position: [10, 5, -3], orientation: [0, 0, 0, 1] };
    const t = coLocationTransform(a, b);
    expect(t.translation).toEqual([10, 5, -3]);
  });
});

describe('detectXrDevice', () => {
  it('detects Vision Pro', () => {
    expect(detectXrDevice('Mozilla/5.0 visionOS Safari')).toBe('vision-pro');
  });
  it('detects Quest', () => {
    expect(detectXrDevice('OculusBrowser Quest/3.0')).toBe('quest');
  });
  it('detects iOS', () => {
    expect(detectXrDevice('Mozilla/5.0 iPhone')).toBe('mobile-arkit');
  });
  it('detects Android', () => {
    expect(detectXrDevice('Mozilla/5.0 Android Chrome')).toBe('mobile-arcore');
  });
  it('falls back to desktop', () => {
    expect(detectXrDevice('Mozilla/5.0 Windows Chrome')).toBe('desktop-fallback');
  });
});
