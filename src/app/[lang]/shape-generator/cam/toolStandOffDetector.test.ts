import { describe, it, expect } from 'vitest';
import {
  detectStandOff,
  recommendStickout,
  aggregateFleet,
  summarize,
  type ToolUsage,
} from './toolStandOffDetector';

function tool(id: string, dia: number, stick: number, sideForce: number = 50, young: number = 600000): ToolUsage {
  return { id, toolDiameterMm: dia, stickoutMm: stick, youngMpa: young, sideForceN: sideForce };
}

describe('detectStandOff', () => {
  it('empty input → empty', () => {
    expect(detectStandOff([])).toEqual([]);
  });

  it('L/D 2 → ok', () => {
    const r = detectStandOff([tool('t1', 10, 20)]);
    expect(r[0]!.severity).toBe('ok');
  });

  it('L/D 5 → reduce-feed', () => {
    const r = detectStandOff([tool('t1', 10, 50)]);
    expect(r[0]!.severity).toBe('reduce-feed');
  });

  it('L/D 8 → slender-feed', () => {
    const r = detectStandOff([tool('t1', 10, 80)]);
    expect(r[0]!.severity).toBe('slender-feed');
  });

  it('L/D 15 → redesign', () => {
    const r = detectStandOff([tool('t1', 10, 150)]);
    expect(r[0]!.severity).toBe('redesign');
  });

  it('zero diameter → redesign', () => {
    const r = detectStandOff([tool('t1', 0, 50)]);
    expect(r[0]!.severity).toBe('redesign');
  });

  it('deflection beyond limit overrides severity', () => {
    const r = detectStandOff([tool('t1', 10, 25, 100)], { acceptableRatio: 3, redesignRatio: 10, maxDeflectionMm: 0.0001 });
    expect(r[0]!.severity).not.toBe('ok');
  });

  it('feed override < 1 for non-ok', () => {
    const r = detectStandOff([tool('t1', 10, 100)]);
    expect(r[0]!.feedOverride).toBeLessThan(1);
  });

  it('maxDoc shrinks with L/D', () => {
    const okTool = detectStandOff([tool('t1', 10, 20)])[0]!;
    const slenderTool = detectStandOff([tool('t2', 10, 80)])[0]!;
    expect(slenderTool.maxDocMm).toBeLessThan(okTool.maxDocMm);
  });

  it('L/D ratio reported', () => {
    const r = detectStandOff([tool('t1', 10, 50)]);
    expect(r[0]!.lDRatio).toBeCloseTo(5, 5);
  });
});

describe('recommendStickout', () => {
  it('returns positive length', () => {
    const length = recommendStickout(tool('t1', 10, 50, 50), 0.01);
    expect(length).toBeGreaterThan(0);
  });

  it('larger deflection → longer stickout allowed', () => {
    const tight = recommendStickout(tool('t1', 10, 50), 0.001);
    const loose = recommendStickout(tool('t2', 10, 50), 0.05);
    expect(loose).toBeGreaterThan(tight);
  });

  it('zero target → 0', () => {
    expect(recommendStickout(tool('t1', 10, 50), 0)).toBe(0);
  });
});

describe('aggregateFleet', () => {
  it('worst tool id', () => {
    const r = detectStandOff([tool('short', 10, 20), tool('long', 10, 100)]);
    expect(aggregateFleet(r).worstToolId).toBe('long');
  });

  it('redesign count', () => {
    const r = detectStandOff([tool('a', 10, 150), tool('b', 10, 20)]);
    expect(aggregateFleet(r).redesignCount).toBe(1);
  });

  it('empty → no worst tool', () => {
    expect(aggregateFleet([]).worstToolId).toBeNull();
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = detectStandOff([tool('a', 10, 20), tool('b', 10, 150)]);
    const s = summarize(r);
    expect(s.toolCount).toBe(2);
    expect(s.redesignCount).toBe(1);
    expect(s.okCount).toBe(1);
  });
});
