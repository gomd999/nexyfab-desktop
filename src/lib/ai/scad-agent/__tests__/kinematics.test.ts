/**
 * Q — Kinematics check tests (gear mesh + interference).
 */
import { describe, it, expect } from 'vitest';
import { checkGearMesh, checkInterference } from '../kinematics';

describe('checkGearMesh', () => {
  it('m=2 z1=20 z2=40 at ideal center distance 60mm passes', () => {
    const r = checkGearMesh({
      gearA: { module: 2, teeth: 20 },
      gearB: { module: 2, teeth: 40 },
      centerDistanceMm: 60,
    });
    expect(r.ok).toBe(true);
    expect(r.idealCenterDistanceMm).toBe(60);
    expect(r.gearRatio).toBe(2);
    expect(Math.abs(r.errorMm)).toBeLessThan(0.001);
  });

  it('5% slop within tolerance default', () => {
    // ideal 60, 4% off = 57.6 → still within 5% (3mm)
    const r = checkGearMesh({
      gearA: { module: 2, teeth: 20 },
      gearB: { module: 2, teeth: 40 },
      centerDistanceMm: 57.6,
    });
    expect(r.ok).toBe(true);
  });

  it('20% off fails with concrete error in mm', () => {
    const r = checkGearMesh({
      gearA: { module: 2, teeth: 20 },
      gearB: { module: 2, teeth: 40 },
      centerDistanceMm: 72,  // ideal 60 → +12mm = 20%
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain('+12');
  });

  it('mismatched modules fail typed', () => {
    const r = checkGearMesh({
      gearA: { module: 2, teeth: 20 },
      gearB: { module: 3, teeth: 40 },
      centerDistanceMm: 60,
    });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Modules differ/);
  });

  it('tighter tolerance can flip a borderline pass to fail', () => {
    const args = {
      gearA: { module: 2, teeth: 20 },
      gearB: { module: 2, teeth: 40 },
      centerDistanceMm: 62,  // 2/60 = 3.3%
    };
    expect(checkGearMesh({ ...args, toleranceFrac: 0.05 }).ok).toBe(true);
    expect(checkGearMesh({ ...args, toleranceFrac: 0.01 }).ok).toBe(false);
  });
});

describe('checkInterference', () => {
  it('non-overlapping bboxes report no collision', () => {
    const r = checkInterference({
      bboxA: { min: [0, 0, 0], max: [10, 10, 10] },
      bboxB: { min: [20, 0, 0], max: [30, 10, 10] },
    });
    expect(r.collides).toBe(false);
    expect(r.overlap.volume).toBe(0);
  });

  it('partial overlap reports correct overlap volume', () => {
    const r = checkInterference({
      bboxA: { min: [0, 0, 0], max: [10, 10, 10] },
      bboxB: { min: [5, 5, 5], max: [15, 15, 15] },
    });
    expect(r.collides).toBe(true);
    expect(r.overlap.x).toBe(5);
    expect(r.overlap.y).toBe(5);
    expect(r.overlap.z).toBe(5);
    expect(r.overlap.volume).toBe(125);
  });

  it('A inside B is collision (full inclusion)', () => {
    const r = checkInterference({
      bboxA: { min: [2, 2, 2], max: [8, 8, 8] },
      bboxB: { min: [0, 0, 0], max: [10, 10, 10] },
    });
    expect(r.collides).toBe(true);
    expect(r.overlap.volume).toBe(216);  // 6³
  });

  it('positionA shifts the bbox before testing', () => {
    const r = checkInterference({
      bboxA: { min: [0, 0, 0], max: [10, 10, 10] },
      bboxB: { min: [0, 0, 0], max: [10, 10, 10] },
      positionA: [20, 0, 0],  // moved beyond B
    });
    expect(r.collides).toBe(false);
  });

  it('touching faces (zero overlap on one axis) is NOT collision', () => {
    const r = checkInterference({
      bboxA: { min: [0, 0, 0], max: [10, 10, 10] },
      bboxB: { min: [10, 0, 0], max: [20, 10, 10] },  // touch at X=10
    });
    expect(r.collides).toBe(false);
  });

  it('message hints at separation distance when collides', () => {
    const r = checkInterference({
      bboxA: { min: [0, 0, 0], max: [10, 10, 10] },
      bboxB: { min: [3, 3, 3], max: [13, 13, 13] },
    });
    expect(r.message).toMatch(/Move parts/);
  });
});
