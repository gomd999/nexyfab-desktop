/**
 * Phase 3.2.5 — advanced mate IR tests (hinge / slot / gear / rack_pinion).
 *
 * These cover the IR-only layer: type discrimination, validateMate accept/
 * reject combos, and approxDofReduction values. Analytical solver support
 * for these kinds arrives in a follow-up task — see iterativeSolver.advanced.test.ts
 * for "supported=false" coverage at the solver layer.
 */
import { describe, it, expect } from 'vitest';
import {
  validateMate,
  approxDofReduction,
  MateValidationError,
  type Mate,
  type MateRef,
  type HingeMate,
  type SlotMate,
  type GearMate,
  type RackPinionMate,
} from './mate';

// ─── builders ────────────────────────────────────────────────────────────

function ref(partId: string, refId: string, refKind: MateRef['refKind']): MateRef {
  return { partId, refId, refKind };
}

// ─── HingeMate ───────────────────────────────────────────────────────────

describe('HingeMate', () => {
  it('accepts axis/axis with no limit', () => {
    const m: HingeMate = {
      id: 'h1',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
    };
    expect(() => validateMate(m)).not.toThrow();
  });

  it('accepts axis/axis with valid limit', () => {
    const m: HingeMate = {
      id: 'h2',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      limit: { minAngleDeg: -45, maxAngleDeg: 90 },
    };
    expect(() => validateMate(m)).not.toThrow();
  });

  it('rejects limit with min > max', () => {
    const m: HingeMate = {
      id: 'h3',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      limit: { minAngleDeg: 90, maxAngleDeg: 0 },
    };
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects non-finite limit angles', () => {
    const m: HingeMate = {
      id: 'h4',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      limit: { minAngleDeg: Number.NaN, maxAngleDeg: 90 },
    };
    expect(() => validateMate(m)).toThrow(/finite/);
  });

  it('rejects face/face refKind combo', () => {
    const m = {
      id: 'h5',
      kind: 'hinge',
      a: ref('p1', 'f1', 'face'),
      b: ref('p2', 'f2', 'face'),
    } as unknown as Mate;
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects axis/edge refKind combo (only axis/axis allowed)', () => {
    const m = {
      id: 'h6',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'e1', 'edge'),
    } as unknown as Mate;
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects same-part-on-both-sides', () => {
    const m: HingeMate = {
      id: 'h7',
      kind: 'hinge',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p1', 'ax2', 'axis'),
    };
    expect(() => validateMate(m)).toThrow(/same part/);
  });
});

// ─── SlotMate ────────────────────────────────────────────────────────────

describe('SlotMate', () => {
  it('accepts edge/axis (slot edge + pin axis)', () => {
    const m: SlotMate = {
      id: 's1',
      kind: 'slot',
      a: ref('p1', 'slot_e', 'edge'),
      b: ref('p2', 'pin_ax', 'axis'),
    };
    expect(() => validateMate(m)).not.toThrow();
  });

  it('accepts axis/edge (canonical order swap — both directions allowed)', () => {
    const m = {
      id: 's2',
      kind: 'slot',
      a: ref('p1', 'pin_ax', 'axis'),
      b: ref('p2', 'slot_e', 'edge'),
    } as unknown as Mate;
    expect(() => validateMate(m)).not.toThrow();
  });

  it('rejects face/face combo', () => {
    const m = {
      id: 's3',
      kind: 'slot',
      a: ref('p1', 'f1', 'face'),
      b: ref('p2', 'f2', 'face'),
    } as unknown as Mate;
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects edge/edge combo (no pin specified)', () => {
    const m = {
      id: 's4',
      kind: 'slot',
      a: ref('p1', 'e1', 'edge'),
      b: ref('p2', 'e2', 'edge'),
    } as unknown as Mate;
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects same-part-on-both-sides', () => {
    const m: SlotMate = {
      id: 's5',
      kind: 'slot',
      a: ref('p1', 'slot_e', 'edge'),
      b: ref('p1', 'pin_ax', 'axis'),
    };
    expect(() => validateMate(m)).toThrow(/same part/);
  });
});

// ─── GearMate ────────────────────────────────────────────────────────────

describe('GearMate', () => {
  it('accepts axis/axis with positive ratio', () => {
    const m: GearMate = {
      id: 'g1',
      kind: 'gear',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      ratio: 2,
    };
    expect(() => validateMate(m)).not.toThrow();
  });

  it('accepts ratio with reverse flag', () => {
    const m: GearMate = {
      id: 'g2',
      kind: 'gear',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      ratio: 1.5,
      reverse: true,
    };
    expect(() => validateMate(m)).not.toThrow();
  });

  it('rejects zero ratio', () => {
    const m: GearMate = {
      id: 'g3',
      kind: 'gear',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      ratio: 0,
    };
    expect(() => validateMate(m)).toThrow(/ratio/);
  });

  it('rejects negative ratio', () => {
    const m: GearMate = {
      id: 'g4',
      kind: 'gear',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      ratio: -2,
    };
    expect(() => validateMate(m)).toThrow(/ratio/);
  });

  it('rejects non-finite ratio', () => {
    const m: GearMate = {
      id: 'g5',
      kind: 'gear',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      ratio: Number.POSITIVE_INFINITY,
    };
    expect(() => validateMate(m)).toThrow(/ratio/);
  });

  it('rejects face/face combo', () => {
    const m = {
      id: 'g6',
      kind: 'gear',
      a: ref('p1', 'f1', 'face'),
      b: ref('p2', 'f2', 'face'),
      ratio: 2,
    } as unknown as Mate;
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects axis/edge combo', () => {
    const m = {
      id: 'g7',
      kind: 'gear',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'e1', 'edge'),
      ratio: 2,
    } as unknown as Mate;
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects same-part-on-both-sides', () => {
    const m: GearMate = {
      id: 'g8',
      kind: 'gear',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p1', 'ax2', 'axis'),
      ratio: 2,
    };
    expect(() => validateMate(m)).toThrow(/same part/);
  });
});

// ─── RackPinionMate ──────────────────────────────────────────────────────

describe('RackPinionMate', () => {
  it('accepts axis/edge with positive pinionRadius', () => {
    const m: RackPinionMate = {
      id: 'rp1',
      kind: 'rack_pinion',
      a: ref('p1', 'pinion_ax', 'axis'),
      b: ref('p2', 'rack_e', 'edge'),
      pinionRadius: 10,
    };
    expect(() => validateMate(m)).not.toThrow();
  });

  it('accepts edge/axis canonical-swap (allowed combo is symmetric)', () => {
    const m = {
      id: 'rp2',
      kind: 'rack_pinion',
      a: ref('p1', 'rack_e', 'edge'),
      b: ref('p2', 'pinion_ax', 'axis'),
      pinionRadius: 10,
    } as unknown as Mate;
    expect(() => validateMate(m)).not.toThrow();
  });

  it('rejects zero pinionRadius', () => {
    const m: RackPinionMate = {
      id: 'rp3',
      kind: 'rack_pinion',
      a: ref('p1', 'pinion_ax', 'axis'),
      b: ref('p2', 'rack_e', 'edge'),
      pinionRadius: 0,
    };
    expect(() => validateMate(m)).toThrow(/pinionRadius/);
  });

  it('rejects negative pinionRadius', () => {
    const m: RackPinionMate = {
      id: 'rp4',
      kind: 'rack_pinion',
      a: ref('p1', 'pinion_ax', 'axis'),
      b: ref('p2', 'rack_e', 'edge'),
      pinionRadius: -5,
    };
    expect(() => validateMate(m)).toThrow(/pinionRadius/);
  });

  it('rejects axis/axis combo (no rack defined)', () => {
    const m = {
      id: 'rp5',
      kind: 'rack_pinion',
      a: ref('p1', 'ax1', 'axis'),
      b: ref('p2', 'ax2', 'axis'),
      pinionRadius: 10,
    } as unknown as Mate;
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects edge/edge combo (no pinion defined)', () => {
    const m = {
      id: 'rp6',
      kind: 'rack_pinion',
      a: ref('p1', 'e1', 'edge'),
      b: ref('p2', 'e2', 'edge'),
      pinionRadius: 10,
    } as unknown as Mate;
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects same-part-on-both-sides', () => {
    const m: RackPinionMate = {
      id: 'rp7',
      kind: 'rack_pinion',
      a: ref('p1', 'pinion_ax', 'axis'),
      b: ref('p1', 'rack_e', 'edge'),
      pinionRadius: 10,
    };
    expect(() => validateMate(m)).toThrow(/same part/);
  });
});

// ─── approxDofReduction (advanced kinds) ─────────────────────────────────

describe('approxDofReduction — advanced mates', () => {
  it('hinge removes 5 DoF', () => {
    const m: HingeMate = {
      id: 'h',
      kind: 'hinge',
      a: ref('a', 'ax1', 'axis'),
      b: ref('b', 'ax2', 'axis'),
    };
    expect(approxDofReduction(m)).toBe(5);
  });

  it('slot removes 4 DoF', () => {
    const m: SlotMate = {
      id: 's',
      kind: 'slot',
      a: ref('a', 'e1', 'edge'),
      b: ref('b', 'ax1', 'axis'),
    };
    expect(approxDofReduction(m)).toBe(4);
  });

  it('gear removes 1 DoF', () => {
    const m: GearMate = {
      id: 'g',
      kind: 'gear',
      a: ref('a', 'ax1', 'axis'),
      b: ref('b', 'ax2', 'axis'),
      ratio: 2,
    };
    expect(approxDofReduction(m)).toBe(1);
  });

  it('rack_pinion removes 1 DoF', () => {
    const m: RackPinionMate = {
      id: 'rp',
      kind: 'rack_pinion',
      a: ref('a', 'ax1', 'axis'),
      b: ref('b', 'e1', 'edge'),
      pinionRadius: 8,
    };
    expect(approxDofReduction(m)).toBe(1);
  });

  it('hinge DoF is unaffected by limit presence', () => {
    const noLimit: HingeMate = {
      id: 'h1',
      kind: 'hinge',
      a: ref('a', 'ax1', 'axis'),
      b: ref('b', 'ax2', 'axis'),
    };
    const withLimit: HingeMate = {
      id: 'h2',
      kind: 'hinge',
      a: ref('a', 'ax1', 'axis'),
      b: ref('b', 'ax2', 'axis'),
      limit: { minAngleDeg: 0, maxAngleDeg: 180 },
    };
    expect(approxDofReduction(noLimit)).toBe(approxDofReduction(withLimit));
  });
});
