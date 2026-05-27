import { describe, it, expect } from 'vitest';
import {
  planCoolingChannels,
  summarize,
  type CavityBBox,
} from './coolingChannelLayout';

function unitCavity(): CavityBBox {
  return { min: { x: 0, y: 0, z: 0 }, max: { x: 50, y: 30, z: 10 } };
}

describe('planCoolingChannels', () => {
  it('produces channels for a basic cavity', () => {
    const r = planCoolingChannels(unitCavity());
    expect(r.channels.length).toBeGreaterThan(0);
  });

  it('default upper + lower channels (top and bottom of plate)', () => {
    const r = planCoolingChannels(unitCavity());
    const upper = r.channels.filter(c => c.id.startsWith('upper'));
    const lower = r.channels.filter(c => c.id.startsWith('lower'));
    expect(upper.length).toBe(lower.length);
    expect(upper.length).toBeGreaterThan(0);
  });

  it('channel diameter respected', () => {
    const r = planCoolingChannels(unitCavity(), { diameterMm: 10 });
    expect(r.channels[0]!.diameterMm).toBe(10);
  });

  it('larger pitch → fewer channels', () => {
    const close = planCoolingChannels(unitCavity(), { pitchMm: 5 });
    const wide = planCoolingChannels(unitCavity(), { pitchMm: 30 });
    expect(close.channels.length).toBeGreaterThan(wide.channels.length);
  });

  it('cavity distances are positive', () => {
    const r = planCoolingChannels(unitCavity());
    for (const d of r.cavityDistances) {
      expect(d).toBeGreaterThan(0);
    }
  });

  it('cavity offset controls min distance', () => {
    const r = planCoolingChannels(unitCavity(), { cavityOffsetMm: 50 });
    // Channels far from cavity → avg distance must be ≥ ~50.
    expect(r.cavityDistanceAvg).toBeGreaterThan(40);
  });

  it('returns max ≥ avg ≥ 0', () => {
    const r = planCoolingChannels(unitCavity());
    expect(r.cavityDistanceMax).toBeGreaterThanOrEqual(r.cavityDistanceAvg);
    expect(r.cavityDistanceAvg).toBeGreaterThanOrEqual(0);
  });

  it('Y plate normal swaps stack axis', () => {
    const r = planCoolingChannels(unitCavity(), { plateNormal: 'Y', channelAxis: 'X' });
    expect(r.channels.length).toBeGreaterThan(0);
  });

  it('produces requested surface samples', () => {
    const r = planCoolingChannels(unitCavity(), { surfaceSamples: 30 });
    expect(r.cavityDistances).toHaveLength(30);
  });
});

describe('summarize', () => {
  it('reports channel count', () => {
    const r = planCoolingChannels(unitCavity());
    const s = summarize(r);
    expect(s.channelCount).toBe(r.channels.length);
  });

  it('uniformity score is between 0 and 1', () => {
    const r = planCoolingChannels(unitCavity());
    const s = summarize(r);
    expect(s.uniformityScore).toBeGreaterThanOrEqual(0);
    expect(s.uniformityScore).toBeLessThanOrEqual(1);
  });

  it('reports avg / worst distance', () => {
    const r = planCoolingChannels(unitCavity());
    const s = summarize(r);
    expect(s.avgDistanceToCavity).toBe(r.cavityDistanceAvg);
    expect(s.worstDistanceToCavity).toBe(r.cavityDistanceMax);
  });
});
