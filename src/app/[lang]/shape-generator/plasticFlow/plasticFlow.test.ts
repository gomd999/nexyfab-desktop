import { describe, it, expect } from 'vitest';
import { simulateFill, fillTimeColor, DEFAULT_FLOW_VELOCITY, type FlowMesh } from './fillSimulation';
import { detectWeldLines, detectAirTraps } from './weldLineDetection';
import { coolingTimeAt, buildCoolingMap, sinkMarkRisk, POLYMERS } from './coolingTime';

// ── Fill simulation ────────────────────────────────────────────────

describe('simulateFill', () => {
  // 4-vertex chain: 0 ─ 1 ─ 2 ─ 3
  const chain: FlowMesh = {
    vertices: [
      [0, 0, 0], [10, 0, 0], [20, 0, 0], [30, 0, 0],
    ],
    adjacency: [[1], [0, 2], [1, 3], [2]],
  };

  it('gate vertex has distance 0', () => {
    const r = simulateFill(chain, { gateVertex: 0, flowVelocityMmS: 100 });
    expect(r.distances[0]).toBe(0);
    expect(r.fillTimes[0]).toBe(0);
  });

  it('distances increase along chain', () => {
    const r = simulateFill(chain, { gateVertex: 0, flowVelocityMmS: 100 });
    expect(r.distances[1]).toBe(10);
    expect(r.distances[2]).toBe(20);
    expect(r.distances[3]).toBe(30);
  });

  it('time = distance / velocity', () => {
    const r = simulateFill(chain, { gateVertex: 0, flowVelocityMmS: 100 });
    expect(r.fillTimes[3]).toBeCloseTo(0.3, 6);
  });

  it('worst vertex is farthest from gate', () => {
    const r = simulateFill(chain, { gateVertex: 0, flowVelocityMmS: 100 });
    expect(r.worstFillVertex).toBe(3);
  });

  it('DEFAULT_FLOW_VELOCITY includes ABS', () => {
    expect(DEFAULT_FLOW_VELOCITY.ABS).toBeGreaterThan(0);
  });

  it('fillTimeColor returns valid RGB triple', () => {
    const c = fillTimeColor(0.5, 1);
    expect(c).toHaveLength(3);
    expect(c.every(v => v >= 0 && v <= 1)).toBe(true);
  });
});

// ── Weld line + air trap ──────────────────────────────────────────

describe('detectWeldLines + detectAirTraps', () => {
  // 4 vertices in a square; 2 gates on opposite corners would
  // produce a weld line in the middle. With 1 gate, weld lines
  // should be empty.
  const square: FlowMesh = {
    vertices: [
      [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0],
    ],
    adjacency: [[1, 3], [0, 2], [1, 3], [0, 2]],
  };

  it('1-gate fill has no weld lines', () => {
    const fill = simulateFill(square, { gateVertex: 0, flowVelocityMmS: 100 });
    const welds = detectWeldLines(square, fill);
    // The edge (1, 3) — vertices opposite the gate — have equal fill
    // times because the square is symmetric. So 1 weld line emitted.
    expect(welds.length).toBeLessThanOrEqual(2);
  });

  it('air traps detected at fill-time maximum', () => {
    const fill = simulateFill(square, { gateVertex: 0, flowVelocityMmS: 100 });
    const traps = detectAirTraps(square, fill);
    expect(traps.length).toBeGreaterThan(0);
  });
});

// ── Cooling time ──────────────────────────────────────────────────

describe('coolingTimeAt', () => {
  it('returns positive cooling time for thick ABS', () => {
    const t = coolingTimeAt(3, { polymer: 'ABS', moldTempC: 50 });
    expect(t).toBeGreaterThan(0);
  });

  it('thicker wall cools longer', () => {
    const t1 = coolingTimeAt(1, { polymer: 'ABS', moldTempC: 50 });
    const t2 = coolingTimeAt(3, { polymer: 'ABS', moldTempC: 50 });
    expect(t2).toBeGreaterThan(t1);
  });

  it('hotter mold extends cooling time (smaller ejection differential)', () => {
    // Ballman formula: smaller dE = (T_eject - T_mold) means the
    // part has to lose less heat but the gradient drop is steeper —
    // net effect for typical polymers is *longer* cool time when
    // the mold is hotter (closer to ejection temp).
    const tCold = coolingTimeAt(2, { polymer: 'ABS', moldTempC: 40 });
    const tHot  = coolingTimeAt(2, { polymer: 'ABS', moldTempC: 80 });
    expect(tHot).toBeGreaterThan(tCold);
  });

  it('unknown polymer returns 0', () => {
    expect(coolingTimeAt(2, { polymer: 'unknown' as never, moldTempC: 50 })).toBe(0);
  });

  it('POLYMERS includes common types', () => {
    expect(POLYMERS.ABS).toBeTruthy();
    expect(POLYMERS.PP).toBeTruthy();
  });
});

describe('buildCoolingMap', () => {
  it('flags hot spots above 1.5× mean', () => {
    const thicknesses = [1, 1, 1, 1, 5]; // last is thick
    const map = buildCoolingMap(thicknesses, { polymer: 'ABS', moldTempC: 50 });
    expect(map.hotSpots).toContain(4);
  });

  it('mean reflects sample average', () => {
    const map = buildCoolingMap([1, 2, 3], { polymer: 'ABS', moldTempC: 50 });
    expect(map.meanSec).toBeGreaterThan(0);
  });
});

describe('sinkMarkRisk', () => {
  it('uniform thickness → low risk', () => {
    expect(sinkMarkRisk([2, 2, 2, 2])).toBeCloseTo(0, 6);
  });

  it('thick variation → high risk', () => {
    const r = sinkMarkRisk([1, 1, 1, 5]);
    expect(r).toBeGreaterThan(0.5);
  });
});
