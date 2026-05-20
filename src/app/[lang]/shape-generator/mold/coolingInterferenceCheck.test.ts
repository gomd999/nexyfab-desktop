import { describe, it, expect } from 'vitest';
import {
  checkInterferences,
  aggregate,
  summarize,
  type CoolingChannel,
  type SolidFeature,
  type Vec3,
} from './coolingInterferenceCheck';

function ch(id: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, d: number = 8): CoolingChannel {
  return { id, start: { x: x0, y: y0, z: z0 }, end: { x: x1, y: y1, z: z1 }, diameterMm: d };
}

function feat(id: string, kind: SolidFeature['kind'], a: Vec3, b: Vec3, r: number): SolidFeature {
  return { id, kind, centreLineStart: a, centreLineEnd: b, radiusMm: r };
}

describe('checkInterferences', () => {
  it('no channels/features → no interferences', () => {
    const r = checkInterferences([], []);
    expect(r.interferences).toEqual([]);
  });

  it('channel far from cavity → no interference', () => {
    const channel = ch('c1', 0, 0, 0, 100, 0, 0);
    const cavity = feat('cav1', 'cavity', { x: 200, y: 0, z: 0 }, { x: 200, y: 100, z: 0 }, 30);
    const r = checkInterferences([channel], [cavity]);
    expect(r.interferences).toEqual([]);
  });

  it('channel too close to cavity → interference', () => {
    const channel = ch('c1', 0, 0, 0, 100, 0, 0);
    const cavity = feat('cav1', 'cavity', { x: 0, y: 5, z: 0 }, { x: 100, y: 5, z: 0 }, 20);
    const r = checkInterferences([channel], [cavity]);
    expect(r.interferences.length).toBeGreaterThan(0);
  });

  it('channel crossing ejector pin → critical', () => {
    const channel = ch('c1', 0, 0, 0, 100, 0, 0);
    const pin = feat('p1', 'ejector-pin', { x: 50, y: 0, z: -10 }, { x: 50, y: 0, z: 10 }, 2);
    const r = checkInterferences([channel], [pin]);
    expect(r.interferences.some(i => i.severity === 'critical')).toBe(true);
  });

  it('two channels too close → channel-channel interference', () => {
    const a = ch('a', 0, 0, 0, 100, 0, 0);
    const b = ch('b', 0, 5, 0, 100, 5, 0);
    const r = checkInterferences([a, b], [], { cavityClearanceMm: 15, channelChannelMinMm: 10 });
    expect(r.interferences.length).toBeGreaterThan(0);
  });

  it('channel feature distance reported', () => {
    const channel = ch('c1', 0, 0, 0, 100, 0, 0);
    const cavity = feat('cav1', 'cavity', { x: 50, y: 50, z: 0 }, { x: 50, y: 100, z: 0 }, 10);
    const r = checkInterferences([channel], [cavity]);
    if (r.interferences.length > 0) {
      expect(r.interferences[0]!.minDistanceMm).toBeDefined();
    }
  });

  it('recommendation provided per interference', () => {
    const channel = ch('c1', 0, 0, 0, 100, 0, 0);
    const cavity = feat('cav1', 'cavity', { x: 0, y: 5, z: 0 }, { x: 100, y: 5, z: 0 }, 20);
    const r = checkInterferences([channel], [cavity]);
    expect(r.interferences[0]!.recommendation.length).toBeGreaterThan(0);
  });
});

describe('aggregate', () => {
  it('counts by feature kind', () => {
    const channel = ch('c1', 0, 0, 0, 100, 0, 0);
    const cavity = feat('cav1', 'cavity', { x: 0, y: 5, z: 0 }, { x: 100, y: 5, z: 0 }, 20);
    const r = checkInterferences([channel], [cavity]);
    const agg = aggregate(r);
    expect(agg.byFeatureKind.cavity).toBeGreaterThan(0);
  });

  it('critical count tracked', () => {
    const channel = ch('c1', 0, 0, 0, 100, 0, 0);
    const pin = feat('p1', 'ejector-pin', { x: 50, y: 0, z: -10 }, { x: 50, y: 0, z: 10 }, 2);
    const r = checkInterferences([channel], [pin]);
    expect(aggregate(r).criticalCount).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const channel = ch('c1', 0, 0, 0, 100, 0, 0);
    const r = checkInterferences([channel], []);
    const s = summarize(r);
    expect(s.interferenceCount).toBe(r.interferences.length);
  });
});
