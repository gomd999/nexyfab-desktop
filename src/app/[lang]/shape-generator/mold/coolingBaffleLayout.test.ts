import { describe, it, expect } from 'vitest';
import {
  layout,
  baffleHalfAreaMm2,
  bubblerTubeIdMm,
  summarize,
  type HotPoint,
} from './coolingBaffleLayout';

function pt(id: string, x: number, y: number, depth: number): HotPoint {
  return { id, position: { x, y }, depthMm: depth };
}

describe('layout', () => {
  it('empty hot points → warning', () => {
    const r = layout({ hotPoints: [], holeDiameterMm: 8, reachMm: 20 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('clustered points share one cooler', () => {
    const pts = [pt('a', 0, 0, 30), pt('b', 5, 0, 30), pt('c', 10, 0, 30)];
    const r = layout({ hotPoints: pts, holeDiameterMm: 8, reachMm: 20 });
    expect(r.coolers).toHaveLength(1);
    expect(r.coolers[0]!.servesPointIds).toHaveLength(3);
  });

  it('far-apart points need separate coolers', () => {
    const pts = [pt('a', 0, 0, 30), pt('b', 100, 0, 30)];
    const r = layout({ hotPoints: pts, holeDiameterMm: 8, reachMm: 20 });
    expect(r.coolers).toHaveLength(2);
  });

  it('deep point → bubbler, shallow → baffle', () => {
    const deep = layout({ hotPoints: [pt('a', 0, 0, 100)], holeDiameterMm: 8, reachMm: 20 });
    const shallow = layout({ hotPoints: [pt('a', 0, 0, 20)], holeDiameterMm: 8, reachMm: 20 });
    expect(deep.coolers[0]!.type).toBe('bubbler');
    expect(shallow.coolers[0]!.type).toBe('baffle');
  });

  it('baffle depth limit = maxDepthFactor × diameter', () => {
    // diameter 8, factor 5 → limit 40. depth 41 → bubbler
    const r = layout({ hotPoints: [pt('a', 0, 0, 41)], holeDiameterMm: 8, reachMm: 20, maxDepthFactor: 5 });
    expect(r.coolers[0]!.type).toBe('bubbler');
  });

  it('all points covered when within reach', () => {
    const pts = [pt('a', 0, 0, 30), pt('b', 5, 5, 30)];
    const r = layout({ hotPoints: pts, holeDiameterMm: 8, reachMm: 20 });
    expect(r.uncoveredPointIds).toEqual([]);
  });

  it('counts baffles + bubblers', () => {
    const pts = [pt('a', 0, 0, 100), pt('b', 100, 0, 20)];
    const r = layout({ hotPoints: pts, holeDiameterMm: 8, reachMm: 10 });
    expect(r.bubblerCount).toBe(1);
    expect(r.baffleCount).toBe(1);
  });
});

describe('baffleHalfAreaMm2', () => {
  it('half the full bore area', () => {
    const full = Math.PI * 8 * 8 / 4;
    expect(baffleHalfAreaMm2(8)).toBeCloseTo(full / 2, 6);
  });
});

describe('bubblerTubeIdMm', () => {
  it('tube ID = hole / √2 (balanced annulus)', () => {
    expect(bubblerTubeIdMm(10)).toBeCloseTo(10 / Math.SQRT2, 6);
  });

  it('annulus area equals tube area', () => {
    const hole = 10;
    const tube = bubblerTubeIdMm(hole);
    const tubeArea = Math.PI * tube * tube / 4;
    const annulus = Math.PI * (hole * hole - tube * tube) / 4;
    expect(tubeArea).toBeCloseTo(annulus, 6);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const pts = [pt('a', 0, 0, 30), pt('b', 100, 0, 100)];
    const r = layout({ hotPoints: pts, holeDiameterMm: 8, reachMm: 10 });
    const s = summarize(r);
    expect(s.coolerCount).toBe(r.coolers.length);
    expect(s.uncovered).toBe(0);
  });
});
