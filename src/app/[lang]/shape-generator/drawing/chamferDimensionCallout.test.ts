import { describe, it, expect } from 'vitest';
import {
  build,
  validateChamfer,
  summarize,
  type ChamferCalloutInput,
} from './chamferDimensionCallout';

const base: ChamferCalloutInput = {
  legMm: 2,
  angleDeg: 45,
  chamferMidpoint: { x: 0, y: 0 },
};

describe('build', () => {
  it('45° auto → C-prefix form', () => {
    const r = build(base);
    expect(r.styleUsed).toBe('C-prefix');
    expect(r.text).toBe('C2');
  });

  it('non-45° auto → leg-angle form', () => {
    const r = build({ ...base, angleDeg: 30 });
    expect(r.styleUsed).toBe('leg-angle');
    expect(r.text).toBe('2 × 30°');
  });

  it('C-prefix forced on non-45° → warning + fallback', () => {
    const r = build({ ...base, angleDeg: 30, style: 'C-prefix' });
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.styleUsed).toBe('leg-angle');
  });

  it('leg-leg form shows both legs', () => {
    const r = build({ ...base, angleDeg: 45, style: 'leg-leg' });
    // 45° → second leg = leg, so "2 × 2"
    expect(r.text).toBe('2 × 2');
  });

  it('second leg for 30° chamfer', () => {
    const r = build({ ...base, angleDeg: 30 });
    // secondLeg = leg × tan(60°)
    expect(r.secondLegMm).toBeCloseTo(2 * Math.tan(60 * Math.PI / 180), 5);
  });

  it('leader connects midpoint to text', () => {
    const r = build(base);
    expect(r.leaderStart).toEqual({ x: 0, y: 0 });
    expect(r.leaderEnd.x).toBeGreaterThan(0);
  });

  it('text anchor beyond leader end', () => {
    const r = build(base);
    const leaderLen = Math.hypot(r.leaderEnd.x - r.leaderStart.x, r.leaderEnd.y - r.leaderStart.y);
    const anchorDist = Math.hypot(r.textAnchor.x - r.leaderStart.x, r.textAnchor.y - r.leaderStart.y);
    expect(anchorDist).toBeGreaterThan(leaderLen);
  });

  it('zero leg → warning', () => {
    const r = build({ ...base, legMm: 0 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('angle ≥ 90 → warning', () => {
    const r = build({ ...base, angleDeg: 90 });
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('non-integer leg formatted', () => {
    const r = build({ ...base, legMm: 1.5 });
    expect(r.text).toBe('C1.5');
  });
});

describe('validateChamfer', () => {
  it('within tolerance → ok', () => {
    const v = validateChamfer(2, 45, 2.05, 44.5, 0.1, 1);
    expect(v.ok).toBe(true);
  });

  it('leg out of tolerance → not ok', () => {
    const v = validateChamfer(2, 45, 2.5, 45, 0.1, 1);
    expect(v.legOk).toBe(false);
    expect(v.ok).toBe(false);
  });

  it('angle out of tolerance → not ok', () => {
    const v = validateChamfer(2, 45, 2, 50, 0.1, 1);
    expect(v.angleOk).toBe(false);
  });
});

describe('summarize', () => {
  it('reports text + style', () => {
    const r = build(base);
    const s = summarize(r);
    expect(s.text).toBe('C2');
    expect(s.styleUsed).toBe('C-prefix');
  });
});
