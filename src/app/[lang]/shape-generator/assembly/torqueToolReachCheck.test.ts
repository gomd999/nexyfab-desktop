import { describe, it, expect } from 'vitest';
import {
  checkReach,
  suggestSmallerTool,
  summarize,
  type Bolt,
  type TorqueTool,
  type AABB,
} from './torqueToolReachCheck';

const tool: TorqueTool = {
  socketLengthMm: 50,
  leverRadiusMm: 100,
  swingAngleDeg: 90,
  clearanceMm: 5,
};

function bolt(id: string, x: number, y: number, z: number): Bolt {
  return { id, position: { x, y, z }, axis: { x: 0, y: 0, z: 1 }, socketSizeMm: 13 };
}

function obstacle(id: string, min: { x: number; y: number; z: number }, max: { x: number; y: number; z: number }): { id: string; aabb: AABB } {
  return { id, aabb: { min, max } };
}

describe('checkReach', () => {
  it('empty bolts → empty results', () => {
    expect(checkReach([], tool, [])).toEqual([]);
  });

  it('open space → reachable', () => {
    const r = checkReach([bolt('b1', 0, 0, 0)], tool, []);
    expect(r[0]!.reachable).toBe(true);
  });

  it('close obstacle → not reachable', () => {
    const obs = obstacle('w', { x: -5, y: -5, z: 51 }, { x: 5, y: 5, z: 60 });
    const r = checkReach([bolt('b1', 0, 0, 0)], tool, [obs]);
    expect(r[0]!.reachable).toBe(false);
  });

  it('approachClear positive in free space', () => {
    const r = checkReach([bolt('b1', 0, 0, 0)], tool, []);
    expect(r[0]!.approachClearMm).toBeGreaterThan(0);
  });

  it('obstacleHit recorded on blocked swing', () => {
    // Swing arc with default 90° goes from +Y to -X direction, sweeping the
    // -X half. Place a wall directly on that path so a swing sample
    // intersects it.
    const wall = obstacle('wall', { x: -120, y: -20, z: 40 }, { x: -80, y: 20, z: 60 });
    const r = checkReach([bolt('b1', 0, 0, 0)], tool, [wall], { swingSamples: 16 });
    expect(r[0]!.obstacleHit).toBe('wall');
  });

  it('multiple bolts processed', () => {
    const r = checkReach([bolt('b1', 0, 0, 0), bolt('b2', 100, 0, 0)], tool, []);
    expect(r).toHaveLength(2);
  });

  it('small clearance threshold still reachable in free space', () => {
    const tightTool: TorqueTool = { ...tool, clearanceMm: 0.1 };
    const r = checkReach([bolt('b1', 0, 0, 0)], tightTool, []);
    expect(r[0]!.reachable).toBe(true);
  });

  it('axis direction respected', () => {
    const sideBolt: Bolt = { id: 'b1', position: { x: 0, y: 0, z: 0 }, axis: { x: 1, y: 0, z: 0 }, socketSizeMm: 13 };
    const r = checkReach([sideBolt], tool, []);
    expect(r[0]!.reachable).toBe(true);
  });
});

describe('suggestSmallerTool', () => {
  it('null when reachable', () => {
    const r = checkReach([bolt('b1', 0, 0, 0)], tool, []);
    expect(suggestSmallerTool(r[0]!, tool)).toBeNull();
  });

  it('reduces lever radius when unreachable', () => {
    const wall = obstacle('w', { x: -120, y: -20, z: 40 }, { x: -80, y: 20, z: 60 });
    const r = checkReach([bolt('b1', 0, 0, 0)], tool, [wall]);
    const sug = suggestSmallerTool(r[0]!, tool);
    expect(sug).not.toBeNull();
    expect(sug!.newLeverRadius).toBeLessThan(tool.leverRadiusMm);
  });
});

describe('summarize', () => {
  it('counts reachable', () => {
    const r = checkReach([bolt('b1', 0, 0, 0), bolt('b2', 1000, 0, 0)], tool, []);
    const s = summarize(r);
    expect(s.boltCount).toBe(2);
    expect(s.reachableCount).toBeGreaterThan(0);
  });

  it('worstApproachClear tracks min', () => {
    const wall = obstacle('w', { x: -5, y: -5, z: 55 }, { x: 5, y: 5, z: 100 });
    const r = checkReach([bolt('b1', 0, 0, 0)], tool, [wall]);
    expect(summarize(r).worstApproachClear).toBeLessThan(10);
  });
});
