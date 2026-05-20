import { describe, it, expect } from 'vitest';
import {
  generateJointProfile,
  estimateJointStrength,
  JOINT_PRESETS,
} from './parametricJoint';

describe('mortise + tenon', () => {
  it('male and female bboxes match with clearance', () => {
    const p = generateJointProfile({ kind: 'mortise-tenon', widthMm: 10, heightMm: 20, lengthMm: 15, clearanceMm: 0.1 });
    expect(p.male).toHaveLength(4);
    expect(p.female).toHaveLength(4);
    expect(p.bbox.max.x).toBeCloseTo(10.1, 5);
  });

  it('male starts at origin', () => {
    const p = generateJointProfile({ kind: 'mortise-tenon', widthMm: 10, heightMm: 20, lengthMm: 15, clearanceMm: 0 });
    expect(p.male[0]).toEqual({ x: 0, y: 0 });
  });
});

describe('dovetail', () => {
  it('count tails produced', () => {
    const p = generateJointProfile({ kind: 'dovetail', count: 3, widthMm: 100, pitchMm: 25, angleDeg: 12, pinWidthMm: 5, thicknessMm: 12, clearanceMm: 0 });
    // Each tail adds 4 points to the male array.
    expect(p.male.length).toBeGreaterThan(8);
  });

  it('female applies clearance offset', () => {
    const p = generateJointProfile({ kind: 'dovetail', count: 2, widthMm: 50, pitchMm: 20, angleDeg: 12, pinWidthMm: 5, thicknessMm: 10, clearanceMm: 0.2 });
    const maleMaxY = Math.max(...p.male.map(pt => pt.y));
    const femaleMaxY = Math.max(...p.female.map(pt => pt.y));
    expect(femaleMaxY).toBeGreaterThan(maleMaxY);
  });

  it('warns when pin too wide for pitch', () => {
    const p = generateJointProfile({ kind: 'dovetail', count: 2, widthMm: 50, pitchMm: 10, angleDeg: 12, pinWidthMm: 15, thicknessMm: 10, clearanceMm: 0 });
    expect(p.warnings.some(w => w.includes('Pin'))).toBe(true);
  });
});

describe('finger / box joint', () => {
  it('produces 4 points per finger', () => {
    const p = generateJointProfile({ kind: 'finger', count: 3, widthMm: 60, fingerWidthMm: 10, thicknessMm: 12, clearanceMm: 0 });
    expect(p.male).toHaveLength(12);
  });
});

describe('lap', () => {
  it('male is rectangle', () => {
    const p = generateJointProfile({ kind: 'lap', widthMm: 30, thicknessMm: 8, clearanceMm: 0 });
    expect(p.male).toHaveLength(4);
  });

  it('clearance expands female', () => {
    const p = generateJointProfile({ kind: 'lap', widthMm: 30, thicknessMm: 8, clearanceMm: 0.2 });
    expect(p.female[0]).toEqual({ x: -0.2, y: -0.2 });
  });
});

describe('half-blind dovetail', () => {
  it('produces points', () => {
    const p = generateJointProfile({ kind: 'half-blind-dovetail', count: 3, widthMm: 100, pitchMm: 25, angleDeg: 12, blindDepthMm: 8, thicknessMm: 15, clearanceMm: 0.1 });
    expect(p.male.length).toBeGreaterThan(0);
  });
});

describe('tab + slot', () => {
  it('count tabs produced', () => {
    const p = generateJointProfile({ kind: 'tab-slot', count: 4, tabWidthMm: 8, pitchMm: 20, thicknessMm: 2, clearanceMm: 0.05 });
    expect(p.male.length).toBe(16);
  });

  it('female bbox larger than male', () => {
    const p = generateJointProfile({ kind: 'tab-slot', count: 2, tabWidthMm: 8, pitchMm: 20, thicknessMm: 2, clearanceMm: 0.2 });
    const femaleMinY = Math.min(...p.female.map(pt => pt.y));
    expect(femaleMinY).toBeLessThan(0);
  });
});

describe('estimateJointStrength', () => {
  it('larger joints have higher tensile strength', () => {
    const small = generateJointProfile({ kind: 'mortise-tenon', widthMm: 5, heightMm: 10, lengthMm: 8, clearanceMm: 0 });
    const big = generateJointProfile({ kind: 'mortise-tenon', widthMm: 30, heightMm: 50, lengthMm: 25, clearanceMm: 0 });
    expect(estimateJointStrength(big).tensileN).toBeGreaterThan(estimateJointStrength(small).tensileN);
  });

  it('shear < tensile', () => {
    const p = generateJointProfile({ kind: 'mortise-tenon', widthMm: 10, heightMm: 20, lengthMm: 15, clearanceMm: 0 });
    const s = estimateJointStrength(p);
    expect(s.shearN).toBeLessThan(s.tensileN);
  });
});

describe('JOINT_PRESETS', () => {
  it('contains common families', () => {
    expect(JOINT_PRESETS.drawer_front_dovetail!.kind).toBe('dovetail');
    expect(JOINT_PRESETS.shelf_finger!.kind).toBe('finger');
    expect(JOINT_PRESETS.chair_mortise!.kind).toBe('mortise-tenon');
  });

  it('presets generate valid profiles', () => {
    for (const preset of Object.values(JOINT_PRESETS)) {
      const p = generateJointProfile(preset);
      expect(p.male.length).toBeGreaterThan(0);
      expect(p.female.length).toBeGreaterThan(0);
    }
  });
});
