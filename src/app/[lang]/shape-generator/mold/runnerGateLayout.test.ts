import { describe, it, expect } from 'vitest';
import {
  planLayout,
  summarize,
  type Cavity,
} from './runnerGateLayout';

function makeCavity(id: string, x: number, y: number, vol: number = 10): Cavity {
  return {
    id,
    gatePosition: { x, y },
    center: { x, y },
    volumeCm3: vol,
  };
}

describe('planLayout', () => {
  it('empty cavities → empty result', () => {
    const r = planLayout([]);
    expect(r.runners).toEqual([]);
    expect(r.gates).toEqual([]);
    expect(r.maxFlowLengthMm).toBe(0);
  });

  it('creates a gate per cavity', () => {
    const r = planLayout([makeCavity('a', 10, 10), makeCavity('b', -10, -10)]);
    expect(r.gates).toHaveLength(2);
    expect(r.gates.map(g => g.cavityId).sort()).toEqual(['a', 'b']);
  });

  it('star topology has 1 runner per cavity', () => {
    const cavities = [makeCavity('a', 10, 0), makeCavity('b', 0, 10), makeCavity('c', -10, 0), makeCavity('d', 0, -10)];
    const r = planLayout(cavities, { topology: 'star' });
    expect(r.runners).toHaveLength(4);
  });

  it('H-runner has main + branch runners', () => {
    const cavities = [makeCavity('a', 10, 5), makeCavity('b', 10, -5), makeCavity('c', -10, 5), makeCavity('d', -10, -5)];
    const r = planLayout(cavities, { topology: 'H-runner' });
    // 2 main + 4 branches
    expect(r.runners).toHaveLength(6);
  });

  it('fishbone has 1 spine + 1 branch per cavity', () => {
    const cavities = [makeCavity('a', 10, 5), makeCavity('b', 20, -5), makeCavity('c', 30, 5)];
    const r = planLayout(cavities, { topology: 'fishbone' });
    expect(r.runners).toHaveLength(4);
  });

  it('symmetric star layout has 0 imbalance', () => {
    const cavities = [makeCavity('a', 10, 0), makeCavity('b', -10, 0), makeCavity('c', 0, 10), makeCavity('d', 0, -10)];
    const r = planLayout(cavities, { topology: 'star' });
    expect(r.imbalanceScore).toBeLessThan(0.05);
  });

  it('asymmetric star has nonzero imbalance', () => {
    const cavities = [makeCavity('a', 50, 0), makeCavity('b', -1, 0)];
    const r = planLayout(cavities, { topology: 'star' });
    expect(r.imbalanceScore).toBeGreaterThan(0.5);
  });

  it('scrap volume scales with runner length', () => {
    const small = planLayout([makeCavity('a', 5, 0)], { topology: 'star' });
    const big = planLayout([makeCavity('a', 50, 0)], { topology: 'star' });
    expect(big.scrapVolumeCm3).toBeGreaterThan(small.scrapVolumeCm3);
  });

  it('flow paths include sprue and gate', () => {
    const r = planLayout([makeCavity('a', 10, 0)], { topology: 'star' });
    expect(r.flowPaths[0]!.waypoints).toHaveLength(2);
  });

  it('H-runner flow paths have 3 waypoints', () => {
    const r = planLayout([makeCavity('a', 10, 5), makeCavity('b', 10, -5)], { topology: 'H-runner' });
    expect(r.flowPaths[0]!.waypoints).toHaveLength(3);
  });
});

describe('summarize', () => {
  it('counts cavities and runners', () => {
    const cavities = [makeCavity('a', 10, 0), makeCavity('b', -10, 0)];
    const r = planLayout(cavities, { topology: 'star' });
    const s = summarize(cavities, r);
    expect(s.cavityCount).toBe(2);
    expect(s.runnerCount).toBe(2);
  });

  it('reports scrap percent', () => {
    const cavities = [makeCavity('a', 10, 0, 5)];
    const r = planLayout(cavities, { topology: 'star' });
    const s = summarize(cavities, r);
    expect(s.scrapPercent).toBeGreaterThan(0);
    expect(s.scrapPercent).toBeLessThan(100);
  });

  it('symmetric layout reports balanced', () => {
    const cavities = [makeCavity('a', 10, 0), makeCavity('b', -10, 0), makeCavity('c', 0, 10), makeCavity('d', 0, -10)];
    const r = planLayout(cavities, { topology: 'star' });
    const s = summarize(cavities, r);
    expect(s.isBalanced).toBe(true);
  });

  it('asymmetric layout reports unbalanced', () => {
    const cavities = [makeCavity('a', 50, 0), makeCavity('b', -1, 0)];
    const r = planLayout(cavities, { topology: 'star' });
    const s = summarize(cavities, r);
    expect(s.isBalanced).toBe(false);
  });

  it('empty input handled', () => {
    const s = summarize([], planLayout([]));
    expect(s.cavityCount).toBe(0);
    expect(s.flowLengthRatio).toBe(0);
  });

  it('flow length ratio = max / min', () => {
    const cavities = [makeCavity('a', 20, 0), makeCavity('b', 5, 0)];
    const r = planLayout(cavities, { topology: 'star' });
    const s = summarize(cavities, r);
    expect(s.flowLengthRatio).toBeGreaterThan(1);
    expect(s.flowLengthRatio).toBeCloseTo(4, 1);
  });
});
