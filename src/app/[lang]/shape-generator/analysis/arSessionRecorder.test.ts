import { describe, it, expect } from 'vitest';
import {
  ArSessionRecorder,
  computeTrackingQuality,
  replaySession,
  sessionStats,
  type CameraPose,
  type DetectedPlane,
} from './arSessionRecorder';

function makePose(timeMs: number, x: number, y: number, z: number, conf: number = 1): CameraPose {
  return {
    timeMs,
    position: [x, y, z],
    rotation: [0, 0, 0, 1],
    trackingConfidence: conf,
  };
}

describe('ArSessionRecorder — basic', () => {
  it('starts empty', () => {
    const r = new ArSessionRecorder('s1');
    expect(r.session.cameraPoses).toHaveLength(0);
  });

  it('recordPose appends', () => {
    const r = new ArSessionRecorder('s1');
    r.recordPose(makePose(0, 0, 0, 0));
    expect(r.session.cameraPoses).toHaveLength(1);
  });

  it('recordPlane dedupes by id', () => {
    const r = new ArSessionRecorder('s1');
    const plane: DetectedPlane = {
      id: 'p1', firstSeenMs: 0, lastSeenMs: 1000,
      center: [0, 0, 0], normal: [0, 0, 1], extents: [1, 1],
    };
    r.recordPlane(plane);
    r.recordPlane({ ...plane, lastSeenMs: 2000 });
    expect(r.session.planes.size).toBe(1);
    expect(r.session.planes.get('p1')!.lastSeenMs).toBe(2000);
  });

  it('placeAnchor appends', () => {
    const r = new ArSessionRecorder('s1');
    r.placeAnchor({ id: 'a1', placedAtMs: 1000, position: [0, 0, 0] });
    expect(r.session.anchors).toHaveLength(1);
  });

  it('recordInteraction appends', () => {
    const r = new ArSessionRecorder('s1');
    r.recordInteraction({ timeMs: 500, kind: 'tap' });
    expect(r.session.interactions).toHaveLength(1);
  });
});

describe('poseAt + durationMs', () => {
  it('poseAt finds closest pose by time', () => {
    const r = new ArSessionRecorder('s1');
    r.recordPose(makePose(0, 0, 0, 0));
    r.recordPose(makePose(500, 1, 0, 0));
    r.recordPose(makePose(1000, 2, 0, 0));
    const pose = r.poseAt(700);
    expect(pose?.position[0]).toBeGreaterThan(0);
  });

  it('durationMs reports last pose time', () => {
    const r = new ArSessionRecorder('s1');
    r.recordPose(makePose(0, 0, 0, 0));
    r.recordPose(makePose(5000, 0, 0, 0));
    expect(r.durationMs()).toBe(5000);
  });

  it('empty session → 0 duration', () => {
    expect(new ArSessionRecorder('s1').durationMs()).toBe(0);
  });
});

describe('serialize / load', () => {
  it('round-trips', () => {
    const r = new ArSessionRecorder('s1', 'iPhone 15');
    r.recordPose(makePose(0, 0, 0, 0));
    r.placeAnchor({ id: 'a', placedAtMs: 0, position: [0, 0, 0] });
    const json = r.serialize();
    const r2 = ArSessionRecorder.load(json);
    expect(r2.session.id).toBe('s1');
    expect(r2.session.cameraPoses).toHaveLength(1);
    expect(r2.session.anchors).toHaveLength(1);
  });

  it('rejects unknown version', () => {
    expect(() => ArSessionRecorder.load({ version: 99 } as never)).toThrow();
  });
});

describe('computeTrackingQuality', () => {
  it('all high-confidence poses → meanConfidence ≈ 1', () => {
    const r = new ArSessionRecorder('s1');
    for (let i = 0; i < 10; i++) r.recordPose(makePose(i * 100, i * 0.1, 0, 0, 1));
    const q = computeTrackingQuality(r.session);
    expect(q.meanConfidence).toBe(1);
  });

  it('low-confidence frames counted', () => {
    const r = new ArSessionRecorder('s1');
    r.recordPose(makePose(0, 0, 0, 0, 1));
    r.recordPose(makePose(100, 0, 0, 0, 0.3));
    r.recordPose(makePose(200, 0, 0, 0, 0.2));
    const q = computeTrackingQuality(r.session);
    expect(q.lowConfidenceFrames).toBe(2);
  });

  it('drift = distance between head and tail centroids', () => {
    const r = new ArSessionRecorder('s1');
    for (let i = 0; i < 100; i++) r.recordPose(makePose(i * 10, i, 0, 0));
    const q = computeTrackingQuality(r.session);
    expect(q.driftMm).toBeGreaterThan(0);
  });

  it('empty session → zeros', () => {
    const r = new ArSessionRecorder('s1');
    const q = computeTrackingQuality(r.session);
    expect(q.meanConfidence).toBe(0);
    expect(q.driftMm).toBe(0);
  });
});

describe('replaySession', () => {
  it('fires events in chronological order', () => {
    const r = new ArSessionRecorder('s1');
    r.recordPose(makePose(0, 0, 0, 0));
    r.recordPose(makePose(100, 0, 0, 0));
    r.recordInteraction({ timeMs: 50, kind: 'tap' });
    const order: string[] = [];
    replaySession(r.session, {
      onPose: () => order.push('p'),
      onInteraction: () => order.push('i'),
    });
    // 0 pose, 50 interaction, 100 pose.
    expect(order).toEqual(['p', 'i', 'p']);
  });
});

describe('sessionStats', () => {
  it('reports counts + average frame rate', () => {
    const r = new ArSessionRecorder('s1');
    for (let i = 0; i < 10; i++) r.recordPose(makePose(i * 100, 0, 0, 0));
    const s = sessionStats(r.session);
    expect(s.poseCount).toBe(10);
    expect(s.averageFrameRate).toBeGreaterThan(0);
  });
});
