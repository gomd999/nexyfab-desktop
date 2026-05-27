import { describe, it, expect } from 'vitest';
import { compute, apexHalfAngleDeg, summarize, type ConeDevInput } from './coneDevelopment';

// Frustum R=100, r=50, h=120.
const base: ConeDevInput = { baseRadiusMm: 100, topRadiusMm: 50, heightMm: 120 };
// Full cone R=100, r=0, h=120 → s=√(120²+100²)=√24400≈156.2
const fullCone: ConeDevInput = { baseRadiusMm: 100, topRadiusMm: 0, heightMm: 120 };

describe('compute', () => {
  it('side slant = √(h² + (R−r)²)', () => {
    expect(compute(base).sideSlantMm).toBeCloseTo(Math.sqrt(120 * 120 + 50 * 50), 5);
  });

  it('outer dev radius L = R·s/(R−r)', () => {
    const r = compute(base);
    const s = Math.sqrt(120 * 120 + 50 * 50);
    expect(r.outerDevRadiusMm).toBeCloseTo((100 * s) / 50, 4);
  });

  it('inner dev radius l = L − s', () => {
    const r = compute(base);
    expect(r.innerDevRadiusMm).toBeCloseTo(r.outerDevRadiusMm - r.sideSlantMm, 4);
  });

  it('sector angle θ = 2π·R/L (deg)', () => {
    const r = compute(base);
    const expected = (2 * Math.PI * 100) / r.outerDevRadiusMm * 180 / Math.PI;
    expect(r.sectorAngleDeg).toBeCloseTo(expected, 4);
  });

  it('outer arc = base circumference 2πR', () => {
    expect(compute(base).outerArcLengthMm).toBeCloseTo(2 * Math.PI * 100, 5);
  });

  it('full cone: inner radius 0, slant = √(h²+R²)', () => {
    const r = compute(fullCone);
    expect(r.innerDevRadiusMm).toBeCloseTo(0, 6);
    expect(r.outerDevRadiusMm).toBeCloseTo(Math.sqrt(120 * 120 + 100 * 100), 5);
  });

  it('full cone blank area = ½·θ·L²', () => {
    const r = compute(fullCone);
    const theta = r.sectorAngleDeg * Math.PI / 180;
    expect(r.blankAreaMm2).toBeCloseTo(0.5 * theta * r.outerDevRadiusMm ** 2, 2);
  });

  it('taller frustum → larger slant', () => {
    const shortF = compute({ ...base, heightMm: 60 });
    const tallF = compute({ ...base, heightMm: 240 });
    expect(tallF.sideSlantMm).toBeGreaterThan(shortF.sideSlantMm);
  });

  it('r ≥ R → warning', () => {
    expect(compute({ ...base, topRadiusMm: 100 }).warnings.length).toBeGreaterThan(0);
  });
});

describe('apexHalfAngleDeg', () => {
  it('= atan2(R−r, h)', () => {
    expect(apexHalfAngleDeg(base)).toBeCloseTo(Math.atan2(50, 120) * 180 / Math.PI, 5);
  });
});

describe('summarize', () => {
  it('reports L + angle + area', () => {
    const r = compute(base);
    const s = summarize(r);
    expect(s.outerDevRadiusMm).toBe(r.outerDevRadiusMm);
    expect(s.blankAreaMm2).toBe(r.blankAreaMm2);
  });
});
