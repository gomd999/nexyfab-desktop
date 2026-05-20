import { describe, it, expect } from 'vitest';
import {
  size,
  solidDiskInertia,
  rimHoopStressPa,
  summarize,
  type FlywheelInput,
} from './flywheelSizer';

const base: FlywheelInput = {
  energySwingJ: 5000,
  meanRpm: 300,
  coefficientOfFluctuation: 0.05,
};

describe('size', () => {
  it('required inertia = ΔE / (ω²·Cs)', () => {
    const r = size(base);
    const omega = (2 * Math.PI * 300) / 60;
    expect(r.requiredInertiaKgM2).toBeCloseTo(5000 / (omega * omega * 0.05), 4);
  });

  it('lower Cs → larger inertia', () => {
    const tight = size({ ...base, coefficientOfFluctuation: 0.01 });
    const loose = size({ ...base, coefficientOfFluctuation: 0.1 });
    expect(tight.requiredInertiaKgM2).toBeGreaterThan(loose.requiredInertiaKgM2);
  });

  it('higher rpm → smaller inertia', () => {
    const slow = size({ ...base, meanRpm: 100 });
    const fast = size({ ...base, meanRpm: 600 });
    expect(fast.requiredInertiaKgM2).toBeLessThan(slow.requiredInertiaKgM2);
  });

  it('disk mass solved for given radius', () => {
    const r = size({ ...base, rimRadiusMm: 300, geometry: 'solid-disk' });
    expect(r.diskMassKg).not.toBeNull();
    expect(r.diskMassKg!).toBeGreaterThan(0);
  });

  it('rim geometry needs less mass than disk (same I, radius)', () => {
    const disk = size({ ...base, rimRadiusMm: 300, geometry: 'solid-disk' });
    const rim = size({ ...base, rimRadiusMm: 300, geometry: 'rim' });
    expect(rim.diskMassKg!).toBeLessThan(disk.diskMassKg!);
  });

  it('no radius → null disk mass', () => {
    expect(size(base).diskMassKg).toBeNull();
  });

  it('max rpm > mean > min', () => {
    const r = size(base);
    expect(r.maxRpm).toBeGreaterThan(300);
    expect(r.minRpm).toBeLessThan(300);
  });

  it('zero rpm → warning', () => {
    const r = size({ ...base, meanRpm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe('solidDiskInertia', () => {
  it('I = ½ m r²', () => {
    expect(solidDiskInertia(10, 200)).toBeCloseTo(0.5 * 10 * 0.04, 6);
  });
});

describe('rimHoopStressPa', () => {
  it('σ = ρ v² grows with rpm', () => {
    const slow = rimHoopStressPa(7850, 1000, 300);
    const fast = rimHoopStressPa(7850, 2000, 300);
    expect(fast).toBeCloseTo(4 * slow, 0);
  });
});

describe('summarize', () => {
  it('reports inertia + KE', () => {
    const r = size(base);
    const s = summarize(r);
    expect(s.requiredInertiaKgM2).toBe(r.requiredInertiaKgM2);
    expect(s.kineticEnergyJ).toBe(r.kineticEnergyJ);
  });
});
