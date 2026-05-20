import { describe, it, expect } from 'vitest';
import { compute, airChangesPerHour, summarize, type VentilationRateInput } from './ventilationRate';

const base: VentilationRateInput = {
  category: 'office', floorAreaM2: 200, occupants: 10,
};

describe('compute', () => {
  it('Vbz = Rp·Pz + Ra·Az', () => {
    const r = compute(base);
    expect(r.breathingZoneOALps).toBeCloseTo(2.5 * 10 + 0.3 * 200, 4);
  });

  it('uses default occupancy when omitted', () => {
    const r = compute({ category: 'office', floorAreaM2: 200 });
    expect(r.occupants).toBeGreaterThan(0);
  });

  it('classroom needs more OA than office (same area+people)', () => {
    const office = compute({ category: 'office', floorAreaM2: 100, occupants: 20 });
    const classroom = compute({ category: 'classroom', floorAreaM2: 100, occupants: 20 });
    expect(classroom.breathingZoneOALps).toBeGreaterThan(office.breathingZoneOALps);
  });

  it('zone efficiency < 1 raises zone OA', () => {
    const eff1 = compute({ ...base, zoneAirDistEffEz: 1.0 });
    const eff08 = compute({ ...base, zoneAirDistEffEz: 0.8 });
    expect(eff08.zoneOALps).toBeGreaterThan(eff1.zoneOALps);
  });

  it('system efficiency < 1 raises system OA', () => {
    const ev1 = compute({ ...base, systemVentEffEv: 1.0 });
    const ev07 = compute({ ...base, systemVentEffEv: 0.7 });
    expect(ev07.systemOALps).toBeGreaterThan(ev1.systemOALps);
  });

  it('m³/h = L/s × 3.6', () => {
    const r = compute(base);
    expect(r.systemOAM3H).toBeCloseTo(r.systemOALps * 3.6, 4);
  });

  it('OA fraction of supply', () => {
    const r = compute({ ...base, supplyFlowLps: 500 });
    expect(r.oaFractionOfSupply).toBeCloseTo(r.systemOALps / 500, 5);
  });

  it('OA > supply → warning', () => {
    const r = compute({ ...base, occupants: 200, supplyFlowLps: 50 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('more occupants → more OA', () => {
    const few = compute({ ...base, occupants: 5 });
    const many = compute({ ...base, occupants: 40 });
    expect(many.systemOALps).toBeGreaterThan(few.systemOALps);
  });
});

describe('airChangesPerHour', () => {
  it('ACH = OA(m³/h) / volume', () => {
    expect(airChangesPerHour(100, 360)).toBeCloseTo((100 * 3.6) / 360, 5);
  });

  it('zero volume → 0', () => {
    expect(airChangesPerHour(100, 0)).toBe(0);
  });
});

describe('summarize', () => {
  it('reports system OA + occupants', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.systemOALps).toBe(r.systemOALps);
    expect(s.occupants).toBe(r.occupants);
  });
});
