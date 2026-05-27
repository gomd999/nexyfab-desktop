import { describe, it, expect } from 'vitest';
import {
  validatePid,
  sizeLiquidValve,
  sizePump,
  sizeReliefValve,
  type PidDocument,
} from './pidNetwork';

function makeDoc(): PidDocument {
  return {
    equipment: [
      { id: 'T-100', tag: 'T-100', kind: 'tank' },
      { id: 'P-100', tag: 'P-100', kind: 'pump' },
    ],
    lines: [
      { id: 'L-1', lineNumber: '6-CW-101-A1', nominalSize: 'DN50', serviceCode: 'CW', specClass: 'CS150',
        fromEquipmentId: 'T-100', toEquipmentId: 'P-100' },
    ],
    valves: [
      { id: 'V-1', tag: 'V-101', kind: 'ball', lineId: 'L-1' },
    ],
    instruments: [
      { id: 'I-1', tag: 'PT-101', kind: 'pressure', locationId: 'L-1' },
    ],
  };
}

describe('validatePid', () => {
  it('clean doc → no orphans + no warnings', () => {
    const r = validatePid(makeDoc());
    expect(r.orphanLines).toHaveLength(0);
    expect(r.orphanValves).toHaveLength(0);
    expect(r.orphanInstruments).toHaveLength(0);
    expect(r.duplicateTags).toHaveLength(0);
  });

  it('orphan line: refers to missing equipment', () => {
    const doc = makeDoc();
    doc.lines.push({
      id: 'L-2', lineNumber: '4-XX-200', nominalSize: 'DN40', serviceCode: 'XX', specClass: 'CS150',
      fromEquipmentId: 'NOT-EXISTS', toEquipmentId: 'T-100',
    });
    expect(validatePid(doc).orphanLines).toContain('L-2');
  });

  it('orphan valve: refers to missing line', () => {
    const doc = makeDoc();
    doc.valves.push({ id: 'V-2', tag: 'V-102', kind: 'gate', lineId: 'L-NONEXISTENT' });
    expect(validatePid(doc).orphanValves).toContain('V-2');
  });

  it('orphan instrument: refers to missing host', () => {
    const doc = makeDoc();
    doc.instruments.push({ id: 'I-2', tag: 'TT-200', kind: 'temperature', locationId: 'NONEXISTENT' });
    expect(validatePid(doc).orphanInstruments).toContain('I-2');
  });

  it('duplicate tag flagged', () => {
    const doc = makeDoc();
    doc.equipment.push({ id: 'T-200', tag: 'T-100', kind: 'tank' });
    expect(validatePid(doc).duplicateTags).toContain('T-100');
  });

  it('control valve without failure mode → warning', () => {
    const doc = makeDoc();
    doc.valves.push({ id: 'V-2', tag: 'V-200', kind: 'control', lineId: 'L-1' });
    const r = validatePid(doc);
    expect(r.warnings.some(w => w.includes('V-200'))).toBe(true);
  });
});

describe('sizeLiquidValve', () => {
  it('Kv = Q · √(SG / ΔP)', () => {
    const r = sizeLiquidValve({ flowM3H: 10, pressureDropBar: 1, specificGravity: 1 });
    expect(r.kv).toBeCloseTo(10, 4);
  });

  it('Cv = 1.156 × Kv', () => {
    const r = sizeLiquidValve({ flowM3H: 10, pressureDropBar: 1, specificGravity: 1 });
    expect(r.cv).toBeCloseTo(10 * 1.156, 3);
  });

  it('higher SG → larger Kv', () => {
    const water = sizeLiquidValve({ flowM3H: 10, pressureDropBar: 1, specificGravity: 1 });
    const heavy = sizeLiquidValve({ flowM3H: 10, pressureDropBar: 1, specificGravity: 4 });
    expect(heavy.kv).toBeGreaterThan(water.kv);
  });

  it('recommends DN based on Kv', () => {
    const small = sizeLiquidValve({ flowM3H: 1, pressureDropBar: 1, specificGravity: 1 });
    const large = sizeLiquidValve({ flowM3H: 500, pressureDropBar: 1, specificGravity: 1 });
    expect(small.recommendedDn).toBeLessThan(large.recommendedDn);
  });

  it('high ΔP warns about cavitation', () => {
    const r = sizeLiquidValve({ flowM3H: 5, pressureDropBar: 25, specificGravity: 1 });
    expect(r.warnings.some(w => w.includes('cavitation'))).toBe(true);
  });
});

describe('sizePump', () => {
  it('hydraulic power = ρ·g·Q·H / 1000', () => {
    // SG=1 → ρ=1000. Q=3.6 m³/h = 0.001 m³/s. H=10. → P_hyd = 1000·9.81·0.001·10/1000 = 0.0981 kW.
    const r = sizePump({ flowM3H: 3.6, headM: 10, specificGravity: 1, efficiency: 1.0, motorEfficiency: 1.0 });
    expect(r.hydraulicPowerKw).toBeCloseTo(0.0981, 3);
  });

  it('shaft power = hydraulic / efficiency', () => {
    const r = sizePump({ flowM3H: 100, headM: 20, specificGravity: 1, efficiency: 0.5, motorEfficiency: 1.0 });
    expect(r.shaftPowerKw).toBeCloseTo(r.hydraulicPowerKw / 0.5, 4);
  });

  it('motor rating snaps to standard size', () => {
    const standardSizes = [0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110];
    const r = sizePump({ flowM3H: 50, headM: 30, specificGravity: 1 });
    expect(standardSizes).toContain(r.motorRatingKw);
  });
});

describe('sizeReliefValve', () => {
  it('returns an orifice letter from the API table', () => {
    const r = sizeReliefValve({
      setPressureBar: 10, reliefFlowKgH: 500, molecularWeight: 29,
      temperatureK: 300,
    });
    expect(['D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'T']).toContain(r.orificeLetter);
  });

  it('larger flow → larger orifice', () => {
    const small = sizeReliefValve({ setPressureBar: 10, reliefFlowKgH: 100, temperatureK: 300 });
    const big = sizeReliefValve({ setPressureBar: 10, reliefFlowKgH: 10000, temperatureK: 300 });
    expect(big.effectiveOrificeAreaMm2).toBeGreaterThan(small.effectiveOrificeAreaMm2);
  });
});
