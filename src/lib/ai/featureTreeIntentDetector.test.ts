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
  it('lists all 12 intent kinds (6 base + 6 Phase 3.AI.2)', () => {
    expect(INTENT_KINDS).toHaveLength(12);
    expect(INTENT_KINDS).toContain('create_box_with_holes');
    expect(INTENT_KINDS).toContain('create_box_with_fillet');
    expect(INTENT_KINDS).toContain('create_cylinder');
    expect(INTENT_KINDS).toContain('add_fillet_to_last');
    expect(INTENT_KINDS).toContain('add_chamfer_to_last');
    expect(INTENT_KINDS).toContain('create_assembly_stack');
    expect(INTENT_KINDS).toContain('create_box_with_chamfer');
    expect(INTENT_KINDS).toContain('create_box_with_pocket');
    expect(INTENT_KINDS).toContain('create_cylinder_with_hole');
    expect(INTENT_KINDS).toContain('create_pattern_grid');
    expect(INTENT_KINDS).toContain('create_revolve_axis');
    expect(INTENT_KINDS).toContain('add_pattern_to_last');
  });
});

// ─── Phase 3.AI.2 — create_box_with_chamfer ──────────────────────────────

describe('detectIntent — create_box_with_chamfer', () => {
  it('"box 50x50x30 chamfer 2"', () => {
    const r = detectIntent('box 50x50x30 chamfer 2');
    expect(r?.kind).toBe('create_box_with_chamfer');
    if (r?.kind === 'create_box_with_chamfer') {
      expect(r.size).toEqual({ x: 50, y: 50, z: 30 });
      expect(r.chamferDistance).toBe(2);
    }
  });

  it('"create box 80x40x20 with chamfer distance 3"', () => {
    const r = detectIntent('create box 80x40x20 with chamfer distance 3');
    expect(r?.kind).toBe('create_box_with_chamfer');
    if (r?.kind === 'create_box_with_chamfer') {
      expect(r.chamferDistance).toBe(3);
    }
  });
});

// ─── Phase 3.AI.2 — create_box_with_pocket ───────────────────────────────

describe('detectIntent — create_box_with_pocket', () => {
  it('"box 50x50x30 with pocket depth 10 radius 5"', () => {
    const r = detectIntent('box 50x50x30 with pocket depth 10 radius 5');
    expect(r?.kind).toBe('create_box_with_pocket');
    if (r?.kind === 'create_box_with_pocket') {
      expect(r.size).toEqual({ x: 50, y: 50, z: 30 });
      expect(r.pocketDepth).toBe(10);
      expect(r.pocketRadius).toBe(5);
    }
  });

  it('"create box 100x100x20 pocket depth 5 r 8"', () => {
    const r = detectIntent('create box 100x100x20 pocket depth 5 r 8');
    expect(r?.kind).toBe('create_box_with_pocket');
    if (r?.kind === 'create_box_with_pocket') {
      expect(r.pocketDepth).toBe(5);
      expect(r.pocketRadius).toBe(8);
    }
  });

  it('returns null when "pocket" present but depth/radius missing', () => {
    expect(detectIntent('box 50x50x30 pocket')).toBeNull();
  });
});

// ─── Phase 3.AI.2 — create_cylinder_with_hole ────────────────────────────

describe('detectIntent — create_cylinder_with_hole', () => {
  it('"cylinder 25 60 with hole 10" (shorthand)', () => {
    const r = detectIntent('cylinder 25 60 with hole 10');
    expect(r?.kind).toBe('create_cylinder_with_hole');
    if (r?.kind === 'create_cylinder_with_hole') {
      expect(r.radius).toBe(25);
      expect(r.height).toBe(60);
      expect(r.holeRadius).toBe(10);
    }
  });

  it('"create cylinder radius 25 height 60 hole 10"', () => {
    const r = detectIntent('create cylinder radius 25 height 60 hole 10');
    expect(r?.kind).toBe('create_cylinder_with_hole');
    if (r?.kind === 'create_cylinder_with_hole') {
      expect(r.holeRadius).toBe(10);
    }
  });

  it('does not match a plain cylinder without "hole" keyword', () => {
    const r = detectIntent('cylinder 25 60');
    expect(r?.kind).not.toBe('create_cylinder_with_hole');
  });
});

// ─── Phase 3.AI.2 — create_pattern_grid ──────────────────────────────────

describe('detectIntent — create_pattern_grid', () => {
  it('"grid 3x3 cubes spacing 100"', () => {
    const r = detectIntent('grid 3x3 cubes spacing 100');
    expect(r?.kind).toBe('create_pattern_grid');
    if (r?.kind === 'create_pattern_grid') {
      expect(r.count).toEqual({ x: 3, y: 3 });
      expect(r.spacing).toBe(100);
      expect(r.baseFeature).toBe('extrude_box');
    }
  });

  it('"4x2 grid of cylinders spacing 50"', () => {
    const r = detectIntent('4x2 grid of cylinders spacing 50');
    expect(r?.kind).toBe('create_pattern_grid');
    if (r?.kind === 'create_pattern_grid') {
      expect(r.baseFeature).toBe('cylinder');
      expect(r.count).toEqual({ x: 4, y: 2 });
    }
  });

  it('returns null when shape word missing', () => {
    expect(detectIntent('grid 3x3 spacing 10')).toBeNull();
  });
});

// ─── Phase 3.AI.2 — create_revolve_axis ──────────────────────────────────

describe('detectIntent — create_revolve_axis', () => {
  it('"revolve triangle 25 60" (shorthand)', () => {
    const r = detectIntent('revolve triangle 25 60');
    expect(r?.kind).toBe('create_revolve_axis');
    if (r?.kind === 'create_revolve_axis') {
      expect(r.profile).toBe('triangle');
      expect(r.radius).toBe(25);
      expect(r.height).toBe(60);
    }
  });

  it('"revolve rectangle radius 30 height 80"', () => {
    const r = detectIntent('revolve rectangle radius 30 height 80');
    expect(r?.kind).toBe('create_revolve_axis');
    if (r?.kind === 'create_revolve_axis') {
      expect(r.profile).toBe('rectangle');
      expect(r.radius).toBe(30);
    }
  });

  it('returns null when profile word missing', () => {
    expect(detectIntent('revolve 25 60')).toBeNull();
  });
});

// ─── Phase 3.AI.2 — add_pattern_to_last ──────────────────────────────────

describe('detectIntent — add_pattern_to_last', () => {
  it('"linear pattern 5 spacing 50"', () => {
    const r = detectIntent('linear pattern 5 spacing 50');
    expect(r?.kind).toBe('add_pattern_to_last');
    if (r?.kind === 'add_pattern_to_last') {
      expect(r.patternKind).toBe('linear');
      expect(r.count).toBe(5);
      expect(r.spacing).toBe(50);
    }
  });

  it('"circular pattern 8 around 360"', () => {
    const r = detectIntent('circular pattern 8 around 360');
    expect(r?.kind).toBe('add_pattern_to_last');
    if (r?.kind === 'add_pattern_to_last') {
      expect(r.patternKind).toBe('circular');
      expect(r.count).toBe(8);
      expect(r.angle).toBe(360);
    }
  });

  it('"circular pattern 6" defaults angle to 360', () => {
    const r = detectIntent('circular pattern 6');
    expect(r?.kind).toBe('add_pattern_to_last');
    if (r?.kind === 'add_pattern_to_last') {
      expect(r.angle).toBe(360);
    }
  });

  it('returns null when linear pattern omits spacing', () => {
    expect(detectIntent('linear pattern 5')).toBeNull();
  });

  it('returns null when count < 2', () => {
    expect(detectIntent('linear pattern 1 spacing 10')).toBeNull();
  });
});
