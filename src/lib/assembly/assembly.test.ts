/**
 * Phase 3.1 — assembly mate IR + state tests.
 */
import { describe, it, expect } from 'vitest';
import {
  validateMate,
  approxDofReduction,
  MateValidationError,
  type Mate,
  type MateRef,
} from './mate';
import {
  partInstance,
  validateAssembly,
  approximateAssemblyDoF,
  addPart,
  removePart,
  addMate,
  removeMate,
  setPartFixed,
  AssemblyValidationError,
  IDENTITY_QUAT,
  type AssemblyState,
} from './assemblyState';

// ─── builders ─────────────────────────────────────────────────────────────

function ref(partId: string, refId: string, refKind: MateRef['refKind']): MateRef {
  return { partId, refId, refKind };
}

function makePart(id: string, opts: Partial<{ name: string; fixed: boolean }> = {}) {
  return partInstance({
    id,
    name: opts.name ?? id,
    partTemplateId: 'template',
    position: { x: 0, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed: opts.fixed,
  });
}

function makeMate(id: string, kind: Mate['kind'], a: MateRef, b: MateRef, value?: number): Mate {
  if (kind === 'distance' || kind === 'angle') {
    return { id, kind, a, b, value: value ?? 0 } as Mate;
  }
  return { id, kind, a, b } as Mate;
}

// ─── validateMate ─────────────────────────────────────────────────────────

describe('validateMate', () => {
  it('accepts coincident face/face', () => {
    const m = makeMate('m1', 'coincident', ref('p1', 'f1', 'face'), ref('p2', 'f2', 'face'));
    expect(() => validateMate(m)).not.toThrow();
  });

  it('accepts concentric axis/axis', () => {
    const m = makeMate('m1', 'concentric', ref('p1', 'a1', 'axis'), ref('p2', 'a2', 'axis'));
    expect(() => validateMate(m)).not.toThrow();
  });

  it('rejects coincident axis/face (not in allowed combos)', () => {
    const m = makeMate('m1', 'coincident', ref('p1', 'a1', 'axis'), ref('p2', 'f1', 'face'));
    expect(() => validateMate(m)).toThrow(MateValidationError);
  });

  it('rejects self-mate (same part on both sides)', () => {
    const m = makeMate('m1', 'coincident', ref('p1', 'f1', 'face'), ref('p1', 'f2', 'face'));
    expect(() => validateMate(m)).toThrow(/same part/);
  });

  it('rejects negative distance', () => {
    const m = makeMate('m1', 'distance', ref('p1', 'f1', 'face'), ref('p2', 'f2', 'face'), -5);
    expect(() => validateMate(m)).toThrow(/distance/);
  });

  it('rejects out-of-range angle', () => {
    const m = makeMate('m1', 'angle', ref('p1', 'a1', 'axis'), ref('p2', 'a2', 'axis'), 200);
    expect(() => validateMate(m)).toThrow(/angle/);
  });

  it('accepts perpendicular edge/face (mixed kinds in allowed combos)', () => {
    const m = makeMate('m1', 'perpendicular', ref('p1', 'e1', 'edge'), ref('p2', 'f1', 'face'));
    expect(() => validateMate(m)).not.toThrow();
  });
});

// ─── approxDofReduction ──────────────────────────────────────────────────

describe('approxDofReduction', () => {
  it('coincident face/face removes 3 DoF', () => {
    const m = makeMate('m', 'coincident', ref('a', 'f1', 'face'), ref('b', 'f2', 'face'));
    expect(approxDofReduction(m)).toBe(3);
  });
  it('coincident edge/edge removes 4 DoF', () => {
    const m = makeMate('m', 'coincident', ref('a', 'e1', 'edge'), ref('b', 'e2', 'edge'));
    expect(approxDofReduction(m)).toBe(4);
  });
  it('concentric removes 4 DoF', () => {
    const m = makeMate('m', 'concentric', ref('a', 'ax1', 'axis'), ref('b', 'ax2', 'axis'));
    expect(approxDofReduction(m)).toBe(4);
  });
  it('parallel removes 2 DoF', () => {
    const m = makeMate('m', 'parallel', ref('a', 'f1', 'face'), ref('b', 'f2', 'face'));
    expect(approxDofReduction(m)).toBe(2);
  });
  it('distance/angle/perpendicular/tangent remove 1 DoF', () => {
    const d = makeMate('m', 'distance', ref('a', 'f1', 'face'), ref('b', 'f2', 'face'), 10);
    expect(approxDofReduction(d)).toBe(1);
    const ang = makeMate('m', 'angle', ref('a', 'ax1', 'axis'), ref('b', 'ax2', 'axis'), 30);
    expect(approxDofReduction(ang)).toBe(1);
    const perp = makeMate('m', 'perpendicular', ref('a', 'f1', 'face'), ref('b', 'f2', 'face'));
    expect(approxDofReduction(perp)).toBe(1);
    const tan = makeMate('m', 'tangent', ref('a', 'f1', 'face'), ref('b', 'f2', 'face'));
    expect(approxDofReduction(tan)).toBe(1);
  });
});

// ─── validateAssembly ────────────────────────────────────────────────────

describe('validateAssembly', () => {
  it('accepts a 2-part assembly with one fixed and one mate', () => {
    const state: AssemblyState = {
      parts: [makePart('p1', { fixed: true }), makePart('p2')],
      mates: [makeMate('m1', 'concentric', ref('p1', 'a1', 'axis'), ref('p2', 'a2', 'axis'))],
    };
    expect(() => validateAssembly(state)).not.toThrow();
  });

  it('rejects assembly with no fixed part', () => {
    const state: AssemblyState = {
      parts: [makePart('p1'), makePart('p2')],
      mates: [],
    };
    expect(() => validateAssembly(state)).toThrow(/fixed/);
  });

  it('rejects mate that references unknown part', () => {
    const state: AssemblyState = {
      parts: [makePart('p1', { fixed: true })],
      mates: [makeMate('m1', 'coincident', ref('p1', 'f1', 'face'), ref('ghost', 'f1', 'face'))],
    };
    expect(() => validateAssembly(state)).toThrow(/unknown part/);
  });

  it('rejects duplicate part ids', () => {
    const state: AssemblyState = {
      parts: [makePart('p1', { fixed: true }), makePart('p1')],
      mates: [],
    };
    expect(() => validateAssembly(state)).toThrow(/duplicate part/);
  });

  it('rejects duplicate mate ids', () => {
    const state: AssemblyState = {
      parts: [makePart('p1', { fixed: true }), makePart('p2')],
      mates: [
        makeMate('m1', 'concentric', ref('p1', 'a1', 'axis'), ref('p2', 'a2', 'axis')),
        makeMate('m1', 'parallel', ref('p1', 'a1', 'axis'), ref('p2', 'a3', 'axis')),
      ],
    };
    expect(() => validateAssembly(state)).toThrow(/duplicate mate/);
  });
});

// ─── approximateAssemblyDoF ──────────────────────────────────────────────

describe('approximateAssemblyDoF', () => {
  it('1 fixed + 1 free part with no mates = 6 DoF', () => {
    const state: AssemblyState = {
      parts: [makePart('p1', { fixed: true }), makePart('p2')],
      mates: [],
    };
    const d = approximateAssemblyDoF(state);
    expect(d.rawDoF).toBe(6);
    expect(d.removedByMates).toBe(0);
    expect(d.approximate).toBe(6);
  });

  it('concentric mate removes 4 → DoF = 2 (axial slide + rotation)', () => {
    const state: AssemblyState = {
      parts: [makePart('p1', { fixed: true }), makePart('p2')],
      mates: [makeMate('m1', 'concentric', ref('p1', 'a1', 'axis'), ref('p2', 'a2', 'axis'))],
    };
    expect(approximateAssemblyDoF(state).approximate).toBe(2);
  });

  it('suppressed mates do not reduce DoF', () => {
    const state: AssemblyState = {
      parts: [makePart('p1', { fixed: true }), makePart('p2')],
      mates: [
        {
          ...makeMate('m1', 'concentric', ref('p1', 'a1', 'axis'), ref('p2', 'a2', 'axis')),
          suppressed: true,
        },
      ],
    };
    expect(approximateAssemblyDoF(state).removedByMates).toBe(0);
  });
});

// ─── edit helpers ────────────────────────────────────────────────────────

describe('addPart / removePart / addMate / removeMate / setPartFixed', () => {
  const base: AssemblyState = { parts: [makePart('p1', { fixed: true })], mates: [] };

  it('addPart succeeds and rejects duplicate ids', () => {
    const next = addPart(base, makePart('p2'));
    expect(next.parts.length).toBe(2);
    expect(() => addPart(next, makePart('p2'))).toThrow(AssemblyValidationError);
  });

  it('removePart rejects when mates still reference it', () => {
    let state = addPart(base, makePart('p2'));
    state = addMate(
      state,
      makeMate('m1', 'concentric', ref('p1', 'a1', 'axis'), ref('p2', 'a2', 'axis')),
    );
    expect(() => removePart(state, 'p2')).toThrow(/referenced by mate/);
  });

  it('removePart works after the referencing mate is gone', () => {
    let state = addPart(base, makePart('p2'));
    state = addMate(
      state,
      makeMate('m1', 'concentric', ref('p1', 'a1', 'axis'), ref('p2', 'a2', 'axis')),
    );
    state = removeMate(state, 'm1');
    const next = removePart(state, 'p2');
    expect(next.parts.length).toBe(1);
  });

  it('addMate validates before committing', () => {
    const state = addPart(base, makePart('p2'));
    expect(() =>
      addMate(state, makeMate('m1', 'distance', ref('p1', 'f', 'face'), ref('p2', 'f', 'face'), -3)),
    ).toThrow(MateValidationError);
  });

  it('setPartFixed flips the flag without mutating other fields', () => {
    const state = addPart(base, makePart('p2'));
    const next = setPartFixed(state, 'p2', true);
    expect(next.parts[1]!.fixed).toBe(true);
    expect(next.parts[1]!.name).toBe('p2');
  });
});
