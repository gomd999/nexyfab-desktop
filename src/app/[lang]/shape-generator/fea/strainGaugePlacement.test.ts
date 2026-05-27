import { describe, it, expect } from 'vitest';
import {
  placeGauges,
  coverageReport,
  summarize,
  type StrainNode,
} from './strainGaugePlacement';

function node(id: string, x: number, y: number, z: number, eps: number = 0.001, onFillet: boolean = false): StrainNode {
  return {
    id,
    position: { x, y, z },
    principalStrains: [eps, eps * 0.5, eps * 0.2],
    principalDirections: [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    onFillet,
  };
}

function manyNodes(count: number): StrainNode[] {
  const nodes: StrainNode[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push(node(`n${i}`, i * 50, 0, 0, (count - i) * 0.0001));
  }
  return nodes;
}

describe('placeGauges', () => {
  it('empty input → no gauges', () => {
    const r = placeGauges([]);
    expect(r.gauges).toEqual([]);
  });

  it('hotspot has high principal strain', () => {
    const r = placeGauges(manyNodes(20), { gaugeCount: 5, gaugeLengthMm: 5, minSpacingFactor: 3, hotspotFraction: 1 });
    const hotspot = r.gauges[0]!;
    expect(Math.abs(hotspot.principalStrain)).toBeGreaterThan(0);
    expect(hotspot.category).toBe('hotspot');
  });

  it('honours gaugeCount', () => {
    const r = placeGauges(manyNodes(30), { gaugeCount: 4, gaugeLengthMm: 5, minSpacingFactor: 1, hotspotFraction: 1 });
    expect(r.gauges).toHaveLength(4);
  });

  it('respects minimum spacing', () => {
    const r = placeGauges(manyNodes(20), { gaugeCount: 10, gaugeLengthMm: 5, minSpacingFactor: 3, hotspotFraction: 1 });
    for (let i = 0; i < r.gauges.length; i++) {
      for (let j = i + 1; j < r.gauges.length; j++) {
        const d = Math.hypot(
          r.gauges[i]!.position.x - r.gauges[j]!.position.x,
          r.gauges[i]!.position.y - r.gauges[j]!.position.y,
          r.gauges[i]!.position.z - r.gauges[j]!.position.z,
        );
        expect(d).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('fillet nodes rejected', () => {
    const nodes = [
      node('a', 0, 0, 0, 0.01, true),
      node('b', 100, 0, 0, 0.005),
      node('c', 200, 0, 0, 0.004),
    ];
    const r = placeGauges(nodes, { gaugeCount: 3, gaugeLengthMm: 5, minSpacingFactor: 3, hotspotFraction: 1 });
    expect(r.rejectedDueToFillet).toBeGreaterThan(0);
    expect(r.gauges.some(g => g.nodeId === 'a')).toBe(false);
  });

  it('hotspotFraction mix produces baseline gauges', () => {
    const r = placeGauges(manyNodes(30), { gaugeCount: 10, gaugeLengthMm: 5, minSpacingFactor: 1, hotspotFraction: 0.5 });
    expect(r.gauges.some(g => g.category === 'baseline')).toBe(true);
  });

  it('orientation matches first principal direction', () => {
    const r = placeGauges([node('a', 0, 0, 0, 0.01)], { gaugeCount: 1, gaugeLengthMm: 5, minSpacingFactor: 3, hotspotFraction: 1 });
    expect(r.gauges[0]!.orientation.x).toBe(1);
  });

  it('zero strain → warning', () => {
    const n: StrainNode = { ...node('a', 0, 0, 0), principalStrains: [0, 0, 0] };
    const r = placeGauges([n], { gaugeCount: 1, gaugeLengthMm: 5, minSpacingFactor: 3, hotspotFraction: 1 });
    expect(r.gauges[0]!.warnings.length).toBeGreaterThan(0);
  });
});

describe('coverageReport', () => {
  it('empty → 0 axes', () => {
    expect(coverageReport([]).coveredAxes).toBe(0);
  });

  it('three orthogonal directions → 3 axes', () => {
    const nodes: StrainNode[] = [
      { id: 'a', position: { x: 0, y: 0, z: 0 }, principalStrains: [0.01, 0, 0], principalDirections: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }], onFillet: false },
      { id: 'b', position: { x: 100, y: 0, z: 0 }, principalStrains: [0.01, 0, 0], principalDirections: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }], onFillet: false },
      { id: 'c', position: { x: 200, y: 0, z: 0 }, principalStrains: [0.01, 0, 0], principalDirections: [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], onFillet: false },
    ];
    const r = placeGauges(nodes, { gaugeCount: 3, gaugeLengthMm: 5, minSpacingFactor: 1, hotspotFraction: 1 });
    expect(coverageReport(r.gauges).coveredAxes).toBe(3);
  });

  it('total spread > 0 for multi-position gauges', () => {
    const r = placeGauges(manyNodes(10), { gaugeCount: 4, gaugeLengthMm: 5, minSpacingFactor: 1, hotspotFraction: 1 });
    expect(coverageReport(r.gauges).totalSpread).toBeGreaterThan(0);
  });
});

describe('summarize', () => {
  it('reports counts', () => {
    const r = placeGauges(manyNodes(20), { gaugeCount: 5, gaugeLengthMm: 5, minSpacingFactor: 1, hotspotFraction: 0.6 });
    const s = summarize(r);
    expect(s.gaugeCount).toBe(r.gauges.length);
    expect(s.hotspotCount + s.baselineCount).toBe(r.gauges.length);
  });
});
