/**
 * featureTreeIntentDetector — Phase 3.AI tests for the regex-based NL
 * → PlanIntent classifier.
 *
 * Confirms each of the 6 PlanIntent kinds is detected from natural prompts,
 * and that unmatched prompts return null (signaling LLM fallback).
 */
import { describe, it, expect } from 'vitest';
import { detectIntent, INTENT_KINDS } from './featureTreeIntentDetector';

describe('detectIntent — create_box_with_fillet', () => {
  it('"create a box 50x50x30 with rounded edges radius 5"', () => {
    const r = detectIntent('create a box 50x50x30 with rounded edges radius 5');
    expect(r?.kind).toBe('create_box_with_fillet');
    if (r?.kind === 'create_box_with_fillet') {
      expect(r.size).toEqual({ x: 50, y: 50, z: 30 });
      expect(r.filletRadius).toBe(5);
    }
  });

  it('"make box 100 x 100 x 20 with fillet 3"', () => {
    const r = detectIntent('make box 100 x 100 x 20 with fillet 3');
    expect(r?.kind).toBe('create_box_with_fillet');
  });

  it('"box 40x40x40 fillet radius 2.5" (decimal radius)', () => {
    const r = detectIntent('box 40x40x40 fillet radius 2.5');
    expect(r?.kind).toBe('create_box_with_fillet');
    if (r?.kind === 'create_box_with_fillet') {
      expect(r.filletRadius).toBe(2.5);
    }
  });
});

describe('detectIntent — create_box_with_holes', () => {
  it('"create box 50x50x30 with 4 holes diameter 6"', () => {
    const r = detectIntent('create box 50x50x30 with 4 holes diameter 6');
    expect(r?.kind).toBe('create_box_with_holes');
    if (r?.kind === 'create_box_with_holes') {
      expect(r.holes).toHaveLength(4);
      expect(r.holes[0]!.diameter).toBe(6);
    }
  });

  it('"box 80x40x10 with hole diameter 8" (singular hole)', () => {
    const r = detectIntent('box 80x40x10 with hole diameter 8');
    expect(r?.kind).toBe('create_box_with_holes');
    if (r?.kind === 'create_box_with_holes') {
      expect(r.holes).toHaveLength(1);
    }
  });
});

describe('detectIntent — create_cylinder', () => {
  it('"create a cylinder radius 25 height 60"', () => {
    const r = detectIntent('create a cylinder radius 25 height 60');
    expect(r?.kind).toBe('create_cylinder');
    if (r?.kind === 'create_cylinder') {
      expect(r.radius).toBe(25);
      expect(r.height).toBe(60);
    }
  });

  it('"cylinder r 10 h 20" (short keyword form)', () => {
    const r = detectIntent('cylinder r 10 h 20');
    expect(r?.kind).toBe('create_cylinder');
  });

  it('"cylinder 25x60" (shorthand)', () => {
    const r = detectIntent('cylinder 25x60');
    expect(r?.kind).toBe('create_cylinder');
    if (r?.kind === 'create_cylinder') {
      expect(r.radius).toBe(25);
      expect(r.height).toBe(60);
    }
  });
});

describe('detectIntent — add_fillet_to_last', () => {
  it('"add fillet 5"', () => {
    const r = detectIntent('add fillet 5');
    expect(r?.kind).toBe('add_fillet_to_last');
    if (r?.kind === 'add_fillet_to_last') {
      expect(r.radius).toBe(5);
    }
  });

  it('"fillet radius 3"', () => {
    const r = detectIntent('fillet radius 3');
    expect(r?.kind).toBe('add_fillet_to_last');
  });

  it('"round all edges radius 2"', () => {
    const r = detectIntent('round all edges radius 2');
    expect(r?.kind).toBe('add_fillet_to_last');
    if (r?.kind === 'add_fillet_to_last') {
      expect(r.radius).toBe(2);
    }
  });
});

describe('detectIntent — add_chamfer_to_last', () => {
  it('"add chamfer 3"', () => {
    const r = detectIntent('add chamfer 3');
    expect(r?.kind).toBe('add_chamfer_to_last');
    if (r?.kind === 'add_chamfer_to_last') {
      expect(r.distance).toBe(3);
    }
  });

  it('"chamfer distance 1.5"', () => {
    const r = detectIntent('chamfer distance 1.5');
    expect(r?.kind).toBe('add_chamfer_to_last');
    if (r?.kind === 'add_chamfer_to_last') {
      expect(r.distance).toBe(1.5);
    }
  });

  it('"bevel all edges 2"', () => {
    const r = detectIntent('bevel all edges 2');
    expect(r?.kind).toBe('add_chamfer_to_last');
  });
});

describe('detectIntent — create_assembly_stack', () => {
  it('"create 3 stacked parts"', () => {
    const r = detectIntent('create 3 stacked parts');
    expect(r?.kind).toBe('create_assembly_stack');
    if (r?.kind === 'create_assembly_stack') {
      expect(r.partCount).toBe(3);
    }
  });

  it('"stack 5 parts"', () => {
    const r = detectIntent('stack 5 parts');
    expect(r?.kind).toBe('create_assembly_stack');
    if (r?.kind === 'create_assembly_stack') {
      expect(r.partCount).toBe(5);
    }
  });

  it('"4 part assembly spaced 10"', () => {
    const r = detectIntent('4 part assembly spaced 10');
    expect(r?.kind).toBe('create_assembly_stack');
    if (r?.kind === 'create_assembly_stack') {
      expect(r.partCount).toBe(4);
      expect(r.spacing).toBe(10);
    }
  });
});

describe('detectIntent — fallback / null', () => {
  it('returns null on empty string (LLM fallback signal)', () => {
    expect(detectIntent('')).toBeNull();
    expect(detectIntent('   ')).toBeNull();
  });

  it('returns null on garbage text', () => {
    expect(detectIntent('please help me with my CAD')).toBeNull();
  });

  it('returns null on free-form unrecognized command', () => {
    expect(detectIntent('build a complex sprocket with 24 teeth')).toBeNull();
  });

  it('returns null on partial box dimensions (missing third dim)', () => {
    expect(detectIntent('box 50x50 with fillet 3')).toBeNull();
  });
});

describe('detectIntent — disambiguation', () => {
  it('"cylinder 50x20" does not match create_box_with_fillet', () => {
    const r = detectIntent('cylinder 50x20');
    expect(r?.kind).toBe('create_cylinder');
  });

  it('"add fillet 5" does not match anything box-related', () => {
    const r = detectIntent('add fillet 5');
    expect(r?.kind).toBe('add_fillet_to_last');
  });

  it('"box 50x50x30 with rounded edges 5" still matches fillet intent', () => {
    const r = detectIntent('box 50x50x30 with rounded edges 5');
    expect(r?.kind).toBe('create_box_with_fillet');
  });
});

describe('INTENT_KINDS export', () => {
  it('lists all 6 intent kinds', () => {
    expect(INTENT_KINDS).toHaveLength(6);
    expect(INTENT_KINDS).toContain('create_box_with_holes');
    expect(INTENT_KINDS).toContain('create_box_with_fillet');
    expect(INTENT_KINDS).toContain('create_cylinder');
    expect(INTENT_KINDS).toContain('add_fillet_to_last');
    expect(INTENT_KINDS).toContain('add_chamfer_to_last');
    expect(INTENT_KINDS).toContain('create_assembly_stack');
  });
});
