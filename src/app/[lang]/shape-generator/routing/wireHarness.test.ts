import { describe, it, expect } from 'vitest';
import {
  AWG_TABLE,
  CONNECTOR_LIBRARY,
  pickGaugeForCurrent,
  findConnector,
  bundleSize,
  computeVoltageDrop,
  generateContinuityChecks,
  summarizeWireSchedule,
  type Wire,
  type Bundle,
} from './wireHarness';

describe('AWG_TABLE', () => {
  it('22 AWG ≈ 1.4 mm OD', () => {
    expect(AWG_TABLE['22AWG']!.insulatedDiameterMm).toBeCloseTo(1.4, 1);
  });

  it('larger AWG number → smaller conductor', () => {
    expect(AWG_TABLE['22AWG']!.conductorDiameterMm).toBeLessThan(AWG_TABLE['16AWG']!.conductorDiameterMm);
  });

  it('current rating decreases with AWG number', () => {
    expect(AWG_TABLE['10AWG']!.currentRatingA).toBeGreaterThan(AWG_TABLE['16AWG']!.currentRatingA);
  });
});

describe('pickGaugeForCurrent', () => {
  it('5A → 20AWG (20% margin needs 6A, table has 7A at 20AWG)', () => {
    // Sorted by rating ascending; 20AWG rated 7A ≥ 5 × 1.2 = 6A.
    expect(pickGaugeForCurrent(5)).toBe('20AWG');
  });

  it('50A → 4AWG (60A required, 6AWG only 55A so 4AWG wins)', () => {
    expect(pickGaugeForCurrent(50)).toBe('4AWG');
  });

  it('returns null for absurd current', () => {
    expect(pickGaugeForCurrent(10000)).toBeNull();
  });
});

describe('findConnector', () => {
  it('finds Molex Micro-Fit', () => {
    const c = findConnector('molex-microfit');
    expect(c?.partNumber).toBe('Micro-Fit 3.0');
  });

  it('returns null for unknown', () => {
    expect(findConnector('not-a-conn')).toBeNull();
  });
});

describe('bundleSize', () => {
  it('empty bundle → zero OD', () => {
    const b: Bundle = { id: 'b1', wireIds: [] };
    expect(bundleSize(b, []).outerDiameterMm).toBe(0);
  });

  it('single wire bundle ≈ wire OD × √1.25', () => {
    const wire: Wire = {
      id: 'w1', fromConnector: 'c1', fromPin: 1, toConnector: 'c2', toPin: 1,
      gauge: '22AWG', currentA: 1, lengthMm: 100,
    };
    const r = bundleSize({ id: 'b', wireIds: ['w1'] }, [wire]);
    const expectedOd = AWG_TABLE['22AWG']!.insulatedDiameterMm * Math.sqrt(1.25);
    expect(r.outerDiameterMm).toBeCloseTo(expectedOd, 2);
  });

  it('min bend radius = 10 × OD', () => {
    const wire: Wire = {
      id: 'w1', fromConnector: 'c1', fromPin: 1, toConnector: 'c2', toPin: 1,
      gauge: '18AWG', currentA: 2, lengthMm: 200,
    };
    const r = bundleSize({ id: 'b', wireIds: ['w1'] }, [wire]);
    expect(r.minBendRadiusMm).toBe(r.outerDiameterMm * 10);
  });

  it('more wires → larger OD', () => {
    const wires: Wire[] = [];
    for (let i = 0; i < 4; i++) {
      wires.push({
        id: `w${i}`, fromConnector: 'c1', fromPin: i, toConnector: 'c2', toPin: i,
        gauge: '22AWG', currentA: 1, lengthMm: 100,
      });
    }
    const r1 = bundleSize({ id: 'b1', wireIds: ['w0'] }, wires);
    const r4 = bundleSize({ id: 'b4', wireIds: ['w0', 'w1', 'w2', 'w3'] }, wires);
    expect(r4.outerDiameterMm).toBeGreaterThan(r1.outerDiameterMm);
  });
});

describe('computeVoltageDrop', () => {
  it('zero current → zero drop', () => {
    const wire: Wire = {
      id: 'w1', fromConnector: 'c1', fromPin: 1, toConnector: 'c2', toPin: 1,
      gauge: '18AWG', currentA: 0, lengthMm: 1000,
    };
    expect(computeVoltageDrop(wire, 12).voltageDropV).toBe(0);
  });

  it('drop scales with length × current', () => {
    const w: Wire = {
      id: 'w1', fromConnector: 'c1', fromPin: 1, toConnector: 'c2', toPin: 1,
      gauge: '18AWG', currentA: 5, lengthMm: 1000,
    };
    const r1 = computeVoltageDrop(w, 12);
    const r2 = computeVoltageDrop({ ...w, lengthMm: 2000 }, 12);
    expect(r2.voltageDropV).toBeCloseTo(r1.voltageDropV * 2, 4);
  });

  it('flags exceedsRecommendation when drop > 3%', () => {
    const w: Wire = {
      id: 'w1', fromConnector: 'c1', fromPin: 1, toConnector: 'c2', toPin: 1,
      gauge: '22AWG', currentA: 5, lengthMm: 5000,
    };
    expect(computeVoltageDrop(w, 12).exceedsRecommendation).toBe(true);
  });
});

describe('generateContinuityChecks', () => {
  it('emits one check per wire', () => {
    const wires: Wire[] = [
      { id: 'w1', fromConnector: 'A', fromPin: 1, toConnector: 'B', toPin: 1, gauge: '20AWG', currentA: 1, lengthMm: 100 },
      { id: 'w2', fromConnector: 'A', fromPin: 2, toConnector: 'B', toPin: 2, gauge: '20AWG', currentA: 1, lengthMm: 100 },
    ];
    expect(generateContinuityChecks(wires)).toHaveLength(2);
  });

  it('expected resistance > 0 for non-zero length', () => {
    const wires: Wire[] = [
      { id: 'w1', fromConnector: 'A', fromPin: 1, toConnector: 'B', toPin: 1, gauge: '20AWG', currentA: 1, lengthMm: 500 },
    ];
    expect(generateContinuityChecks(wires)[0]!.expectedResistanceOhm).toBeGreaterThan(0);
  });
});

describe('summarizeWireSchedule', () => {
  const wires: Wire[] = [
    { id: 'w1', fromConnector: 'A', fromPin: 1, toConnector: 'B', toPin: 1, gauge: '20AWG', currentA: 1, lengthMm: 1000 },
    { id: 'w2', fromConnector: 'A', fromPin: 2, toConnector: 'B', toPin: 2, gauge: '20AWG', currentA: 1, lengthMm: 500 },
    { id: 'w3', fromConnector: 'A', fromPin: 3, toConnector: 'C', toPin: 1, gauge: '16AWG', currentA: 5, lengthMm: 1200 },
  ];

  it('total length in metres', () => {
    expect(summarizeWireSchedule(wires).totalLengthM).toBeCloseTo(2.7, 5);
  });

  it('per-gauge lengths', () => {
    const s = summarizeWireSchedule(wires);
    expect(s.perGaugeLengthM['20AWG']).toBeCloseTo(1.5, 5);
    expect(s.perGaugeLengthM['16AWG']).toBeCloseTo(1.2, 5);
  });

  it('connector counts cumulative', () => {
    const s = summarizeWireSchedule(wires);
    expect(s.connectorCounts['A']).toBe(3);
    expect(s.connectorCounts['B']).toBe(2);
    expect(s.connectorCounts['C']).toBe(1);
  });
});

describe('CONNECTOR_LIBRARY', () => {
  it('contains at least 6 entries', () => {
    expect(CONNECTOR_LIBRARY.length).toBeGreaterThanOrEqual(6);
  });

  it('every entry has positive pin count', () => {
    for (const c of CONNECTOR_LIBRARY) {
      expect(c.pinCount).toBeGreaterThan(0);
      expect(c.contactCurrentA).toBeGreaterThan(0);
    }
  });
});
