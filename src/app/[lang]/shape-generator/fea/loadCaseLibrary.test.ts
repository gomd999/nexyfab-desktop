import { describe, it, expect } from 'vitest';
import {
  buildPointLoad,
  buildPressure,
  buildGravity,
  buildThermal,
  buildBearing,
  buildFixed,
  validateLoadSet,
  combineCases,
  summarize,
  type LoadCase,
  type LoadCombination,
} from './loadCaseLibrary';

describe('builders', () => {
  it('point load includes force vector', () => {
    const l = buildPointLoad('p1', 'face-1', { x: 100, y: 0, z: 0 });
    expect(l.kind).toBe('point');
    if (l.data.kind === 'point') {
      expect(l.data.force.x).toBe(100);
    }
  });

  it('point load with moment carries moment', () => {
    const l = buildPointLoad('p1', 'face-1', { x: 0, y: 0, z: 100 }, { x: 50, y: 0, z: 0 });
    if (l.data.kind === 'point') {
      expect(l.data.moment).toBeDefined();
      expect(l.data.moment!.x).toBe(50);
    }
  });

  it('pressure load defaults inward', () => {
    const l = buildPressure('p2', 'face-2', 2.5);
    if (l.data.kind === 'pressure') {
      expect(l.data.pressureMpa).toBe(2.5);
      expect(l.data.direction).toBe('inward');
    }
  });

  it('gravity has -9.81 z acceleration', () => {
    const l = buildGravity();
    if (l.data.kind === 'body') {
      expect(l.data.acceleration.z).toBeCloseTo(-9.81, 5);
    }
  });

  it('thermal load records deltaC', () => {
    const l = buildThermal('t1', 'face-3', 50, 25);
    if (l.data.kind === 'thermal') {
      expect(l.data.deltaC).toBe(50);
      expect(l.data.referenceC).toBe(25);
    }
  });

  it('bearing load with axial + radial', () => {
    const l = buildBearing('b1', 'hole-1', 500, 100, { x: 0, y: 0, z: 1 });
    if (l.data.kind === 'bearing') {
      expect(l.data.radialN).toBe(500);
      expect(l.data.axialN).toBe(100);
    }
  });

  it('fixed constraint defaults all axes locked', () => {
    const l = buildFixed('f1', 'base');
    if (l.data.kind === 'constraint') {
      expect(l.data.fixed.x).toBe(true);
      expect(l.data.fixed.rx).toBe(true);
    }
  });

  it('fixed constraint with partial DOFs', () => {
    const l = buildFixed('f1', 'roller', { x: true, y: false, z: true });
    if (l.data.kind === 'constraint') {
      expect(l.data.fixed.x).toBe(true);
      expect(l.data.fixed.y).toBe(false);
    }
  });
});

describe('validateLoadSet', () => {
  it('empty set → error', () => {
    const r = validateLoadSet([]);
    expect(r.isValid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('loads without constraints → error', () => {
    const r = validateLoadSet([buildPointLoad('p', 'f', { x: 100, y: 0, z: 0 })]);
    expect(r.isValid).toBe(false);
    expect(r.errors.some(e => e.includes('No constraint'))).toBe(true);
  });

  it('constraints only → warning, valid', () => {
    const r = validateLoadSet([buildFixed('f1', 'base')]);
    expect(r.isValid).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('balanced set → valid', () => {
    const r = validateLoadSet([
      buildFixed('f1', 'base'),
      buildPointLoad('p1', 'top', { x: 100, y: 0, z: 0 }),
    ]);
    expect(r.isValid).toBe(true);
  });

  it('net force computed from point loads', () => {
    const r = validateLoadSet([
      buildFixed('f1', 'base'),
      buildPointLoad('p1', 'a', { x: 100, y: 0, z: 0 }),
      buildPointLoad('p2', 'b', { x: 50, y: 50, z: 0 }),
    ]);
    expect(r.netForceN.x).toBe(150);
    expect(r.netForceN.y).toBe(50);
  });
});

describe('combineCases', () => {
  it('scales point load forces by factor', () => {
    const cases: LoadCase[] = [buildPointLoad('p1', 'f', { x: 100, y: 0, z: 0 })];
    const comb: LoadCombination = { id: 'c1', name: 'half', factors: { p1: 0.5 } };
    const r = combineCases(cases, comb);
    if (r[0]!.data.kind === 'point') {
      expect(r[0]!.data.force.x).toBe(50);
    }
  });

  it('non-existent case id is skipped', () => {
    const r = combineCases([], { id: 'c1', name: '', factors: { ghost: 1 } });
    expect(r).toEqual([]);
  });

  it('combination preserves moments scaled', () => {
    const cases: LoadCase[] = [buildPointLoad('p1', 'f', { x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 })];
    const r = combineCases(cases, { id: 'c', name: 't', factors: { p1: 2 } });
    if (r[0]!.data.kind === 'point') {
      expect(r[0]!.data.moment!.x).toBe(200);
    }
  });
});

describe('summarize', () => {
  it('counts each load kind', () => {
    const loads = [
      buildFixed('f', 'base'),
      buildPointLoad('p', 'a', { x: 100, y: 0, z: 0 }),
      buildPressure('pr', 'b', 1),
      buildGravity(),
    ];
    const s = summarize(loads);
    expect(s.caseCount).toBe(4);
    expect(s.constraintCount).toBe(1);
    expect(s.pointLoadCount).toBe(1);
    expect(s.pressureCount).toBe(1);
    expect(s.bodyLoadCount).toBe(1);
  });

  it('total applied force = sum of force magnitudes', () => {
    const loads = [
      buildPointLoad('p1', 'a', { x: 30, y: 40, z: 0 }),
      buildPointLoad('p2', 'b', { x: 0, y: 0, z: 50 }),
    ];
    const s = summarize(loads);
    expect(s.totalAppliedForceN).toBeCloseTo(50 + 50, 5);
  });
});
