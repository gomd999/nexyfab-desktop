import { describe, it, expect } from 'vitest';
import {
  sweepHolder,
  recommendFix,
  summarize,
  type HolderProfile,
  type Vec3,
  type AABB,
  type CollisionKind,
} from './holderCollisionSweep';

const holder: HolderProfile = {
  bottomDiameterMm: 16,
  topDiameterMm: 20,
  heightMm: 60,
  zOffsetFromTipMm: 20,
};

function obstacle(id: string, min: Vec3, max: Vec3, kind: CollisionKind = 'workpiece'): { id: string; aabb: AABB; kind: CollisionKind } {
  return { id, aabb: { min, max }, kind };
}

describe('sweepHolder', () => {
  it('empty path → no events', () => {
    const r = sweepHolder([], holder, []);
    expect(r.events).toEqual([]);
  });

  it('no obstacles → no events', () => {
    const r = sweepHolder([{ x: 0, y: 0, z: 0 }], holder, []);
    expect(r.events).toEqual([]);
  });

  it('tall wall blocks holder', () => {
    const path: Vec3[] = [{ x: 0, y: 0, z: -10 }];
    const wall = obstacle('wall', { x: -5, y: -100, z: 0 }, { x: 50, y: 100, z: 80 });
    const r = sweepHolder(path, holder, [wall]);
    expect(r.events.length).toBeGreaterThan(0);
  });

  it('low workpiece does not block holder', () => {
    const path: Vec3[] = [{ x: 100, y: 0, z: 0 }];
    const obs = obstacle('wp', { x: 0, y: -100, z: -10 }, { x: 90, y: 100, z: 0 });
    const r = sweepHolder(path, holder, [obs]);
    expect(r.events).toEqual([]);
  });

  it('intermediate samples generated', () => {
    const path: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }];
    const r = sweepHolder(path, holder, [], { samplesPerSegment: 10, clearanceMm: 1 });
    expect(r.totalSamplesChecked).toBeGreaterThanOrEqual(10);
  });

  it('records penetration magnitude', () => {
    const wall = obstacle('w', { x: -5, y: -100, z: 0 }, { x: 50, y: 100, z: 80 });
    const r = sweepHolder([{ x: 0, y: 0, z: -10 }], holder, [wall]);
    expect(r.events[0]!.penetrationMm).toBeGreaterThan(0);
  });

  it('worstPenetration tracks max', () => {
    const path: Vec3[] = [{ x: 0, y: 0, z: -10 }, { x: 10, y: 0, z: -10 }];
    const wall = obstacle('w', { x: -5, y: -100, z: 0 }, { x: 50, y: 100, z: 100 });
    const r = sweepHolder(path, holder, [wall], { samplesPerSegment: 1, clearanceMm: 1 });
    expect(r.worstPenetrationMm).toBeGreaterThan(0);
  });

  it('clearance increases hit count', () => {
    const path: Vec3[] = [{ x: 0, y: 0, z: 0 }];
    const wall = obstacle('w', { x: 15, y: -100, z: 0 }, { x: 50, y: 100, z: 100 });
    const tight = sweepHolder(path, holder, [wall], { samplesPerSegment: 1, clearanceMm: 0 });
    const loose = sweepHolder(path, holder, [wall], { samplesPerSegment: 1, clearanceMm: 10 });
    expect(loose.events.length).toBeGreaterThanOrEqual(tight.events.length);
  });
});

describe('recommendFix', () => {
  it('null when no events', () => {
    const r = sweepHolder([{ x: 0, y: 0, z: 0 }], holder, []);
    expect(recommendFix(r, holder)).toBeNull();
  });

  it('recommends longer stickout', () => {
    const wall = obstacle('w', { x: -5, y: -100, z: 0 }, { x: 50, y: 100, z: 80 });
    const r = sweepHolder([{ x: 0, y: 0, z: -10 }], holder, [wall]);
    const fix = recommendFix(r, holder);
    expect(fix).not.toBeNull();
    expect(fix!.recommendedStickoutMm).toBeGreaterThan(holder.zOffsetFromTipMm);
  });
});

describe('summarize', () => {
  it('byKind counts by obstacle type', () => {
    const path: Vec3[] = [{ x: 0, y: 0, z: -10 }];
    const wall = obstacle('w', { x: -5, y: -100, z: 0 }, { x: 50, y: 100, z: 80 }, 'wall');
    const fixture = obstacle('f', { x: -100, y: -5, z: 0 }, { x: 100, y: 5, z: 80 }, 'fixture');
    const r = sweepHolder(path, holder, [wall, fixture]);
    const s = summarize(r);
    expect(s.byKind.wall + s.byKind.fixture).toBeGreaterThan(0);
  });
});
