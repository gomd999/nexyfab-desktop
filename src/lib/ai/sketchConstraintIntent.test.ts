/**
 * sketchConstraintIntent — regex classifier tests.
 *
 * Covers all 6 SketchConstraintIntent kinds, the SELECTED_PLACEHOLDER
 * convention for selection-bound intents, the empty-array convention
 * for coincident_points, and fallback to null for unmatched prompts.
 */
import { describe, it, expect } from 'vitest';
import {
  detectSketchConstraintIntent,
  SELECTED_PLACEHOLDER,
  SKETCH_CONSTRAINT_INTENT_KINDS,
} from './sketchConstraintIntent';

describe('detectSketchConstraintIntent — make_horizontal', () => {
  it('"make all lines horizontal" → make_horizontal (lineIds undefined)', () => {
    const r = detectSketchConstraintIntent('make all lines horizontal');
    expect(r?.kind).toBe('make_horizontal');
    if (r?.kind === 'make_horizontal') {
      expect(r.lineIds).toBeUndefined();
    }
  });

  it('"horizontal all lines" (reversed order)', () => {
    const r = detectSketchConstraintIntent('horizontal all lines');
    expect(r?.kind).toBe('make_horizontal');
  });

  it('"make every line horizontal"', () => {
    const r = detectSketchConstraintIntent('make every line horizontal');
    expect(r?.kind).toBe('make_horizontal');
  });
});

describe('detectSketchConstraintIntent — make_vertical', () => {
  it('"make all lines vertical"', () => {
    const r = detectSketchConstraintIntent('make all lines vertical');
    expect(r?.kind).toBe('make_vertical');
    if (r?.kind === 'make_vertical') {
      expect(r.lineIds).toBeUndefined();
    }
  });

  it('"vertical every line"', () => {
    const r = detectSketchConstraintIntent('vertical every line');
    expect(r?.kind).toBe('make_vertical');
  });
});

describe('detectSketchConstraintIntent — make_parallel', () => {
  it('"make selected lines parallel" → SELECTED_PLACEHOLDER ids', () => {
    const r = detectSketchConstraintIntent('make selected lines parallel');
    expect(r?.kind).toBe('make_parallel');
    if (r?.kind === 'make_parallel') {
      expect(r.line1Id).toBe(SELECTED_PLACEHOLDER);
      expect(r.line2Id).toBe(SELECTED_PLACEHOLDER);
    }
  });

  it('"parallel the selected lines"', () => {
    const r = detectSketchConstraintIntent('parallel the selected lines');
    expect(r?.kind).toBe('make_parallel');
  });
});

describe('detectSketchConstraintIntent — make_perpendicular', () => {
  it('"make selected lines perpendicular"', () => {
    const r = detectSketchConstraintIntent(
      'make selected lines perpendicular',
    );
    expect(r?.kind).toBe('make_perpendicular');
    if (r?.kind === 'make_perpendicular') {
      expect(r.line1Id).toBe(SELECTED_PLACEHOLDER);
      expect(r.line2Id).toBe(SELECTED_PLACEHOLDER);
    }
  });

  it('"perpendicular selected"', () => {
    const r = detectSketchConstraintIntent('perpendicular selected');
    expect(r?.kind).toBe('make_perpendicular');
  });
});

describe('detectSketchConstraintIntent — fix_distance', () => {
  it('"set distance 50" → distance 50, SELECTED ids', () => {
    const r = detectSketchConstraintIntent('set distance 50');
    expect(r?.kind).toBe('fix_distance');
    if (r?.kind === 'fix_distance') {
      expect(r.distance).toBe(50);
      expect(r.pointAId).toBe(SELECTED_PLACEHOLDER);
      expect(r.pointBId).toBe(SELECTED_PLACEHOLDER);
    }
  });

  it('"fix distance to 12.5" → decimal value captured', () => {
    const r = detectSketchConstraintIntent('fix distance to 12.5');
    expect(r?.kind).toBe('fix_distance');
    if (r?.kind === 'fix_distance') {
      expect(r.distance).toBe(12.5);
    }
  });

  it('"distance 30"', () => {
    const r = detectSketchConstraintIntent('distance 30');
    expect(r?.kind).toBe('fix_distance');
    if (r?.kind === 'fix_distance') {
      expect(r.distance).toBe(30);
    }
  });

  it('zero distance returns null (invalid)', () => {
    const r = detectSketchConstraintIntent('set distance 0');
    expect(r).toBeNull();
  });
});

describe('detectSketchConstraintIntent — coincident_points', () => {
  it('"merge points" → coincident_points (empty ids)', () => {
    const r = detectSketchConstraintIntent('merge points');
    expect(r?.kind).toBe('coincident_points');
    if (r?.kind === 'coincident_points') {
      expect(r.pointIds).toEqual([]);
    }
  });

  it('"make selected points coincident"', () => {
    const r = detectSketchConstraintIntent('make selected points coincident');
    expect(r?.kind).toBe('coincident_points');
  });

  it('"coincident points"', () => {
    const r = detectSketchConstraintIntent('coincident points');
    expect(r?.kind).toBe('coincident_points');
  });
});

describe('detectSketchConstraintIntent — fallback / null', () => {
  it('empty string returns null', () => {
    expect(detectSketchConstraintIntent('')).toBeNull();
    expect(detectSketchConstraintIntent('   ')).toBeNull();
  });

  it('unrelated text returns null', () => {
    expect(detectSketchConstraintIntent('hello world')).toBeNull();
    expect(detectSketchConstraintIntent('make me a sandwich')).toBeNull();
  });

  it('"distance" without a number returns null', () => {
    const r = detectSketchConstraintIntent('set the distance');
    expect(r).toBeNull();
  });
});

describe('SKETCH_CONSTRAINT_INTENT_KINDS export', () => {
  it('lists all 6 supported kinds', () => {
    expect(SKETCH_CONSTRAINT_INTENT_KINDS).toEqual([
      'make_horizontal',
      'make_vertical',
      'make_parallel',
      'make_perpendicular',
      'fix_distance',
      'coincident_points',
    ]);
  });
});
