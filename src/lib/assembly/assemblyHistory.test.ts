/**
 * assemblyHistory — pure history primitives.
 *
 * Covers:
 *   - createAssemblyHistory initial shape
 *   - recordChange semantics (past growth, future clear, validation)
 *   - undo / redo navigation
 *   - canUndo / canRedo boundary conditions
 *   - invalid state → throws
 *   - maxHistory cap (default 50 + custom)
 *   - description preservation
 *   - 50+ change stability
 *   - immutability (input history not mutated)
 */

import { describe, it, expect } from 'vitest';
import {
  createAssemblyHistory,
  recordChange,
  undo,
  redo,
  canUndo,
  canRedo,
} from './assemblyHistory';
import {
  partInstance,
  IDENTITY_QUAT,
  AssemblyValidationError,
  type AssemblyState,
  type PartInstance,
} from './assemblyState';

// ─── helpers ──────────────────────────────────────────────────────────────

function makePart(id: string, fixed: boolean = false, x: number = 0): PartInstance {
  return partInstance({
    id,
    name: id,
    partTemplateId: `tpl_${id}`,
    position: { x, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed,
  });
}

const EMPTY: AssemblyState = { parts: [], mates: [] };

function withPart(id: string, fixed: boolean = true, x: number = 0): AssemblyState {
  return { parts: [makePart(id, fixed, x)], mates: [] };
}

// ─── createAssemblyHistory ───────────────────────────────────────────────

describe('createAssemblyHistory', () => {
  it('returns empty past/future and present = initial', () => {
    const h = createAssemblyHistory(EMPTY);
    expect(h.past).toEqual([]);
    expect(h.future).toEqual([]);
    expect(h.present.state).toBe(EMPTY);
  });

  it('seeds the present with a timestamp', () => {
    const before = Date.now();
    const h = createAssemblyHistory(EMPTY);
    const after = Date.now();
    expect(h.present.timestamp).toBeGreaterThanOrEqual(before);
    expect(h.present.timestamp).toBeLessThanOrEqual(after);
  });

  it('seeds the present with an Initial description', () => {
    const h = createAssemblyHistory(EMPTY);
    expect(h.present.description.length).toBeGreaterThan(0);
  });
});

// ─── recordChange ────────────────────────────────────────────────────────

describe('recordChange', () => {
  it('promotes present to past and installs new present', () => {
    const h0 = createAssemblyHistory(EMPTY);
    const s1 = withPart('bracket_a');
    const h1 = recordChange(h0, s1, 'Add part bracket_a');
    expect(h1.past).toHaveLength(1);
    expect(h1.past[0]!.state).toBe(EMPTY);
    expect(h1.present.state).toBe(s1);
    expect(h1.present.description).toBe('Add part bracket_a');
  });

  it('clears the future when a new change is recorded', () => {
    const h0 = createAssemblyHistory(EMPTY);
    const h1 = recordChange(h0, withPart('a'), 'A');
    const h2 = recordChange(h1, withPart('b'), 'B');
    const h2undo = undo(h2);
    expect(h2undo.future).toHaveLength(1);
    const h3 = recordChange(h2undo, withPart('c'), 'C');
    expect(h3.future).toEqual([]);
  });

  it('throws AssemblyValidationError for an invalid state (no fixed part)', () => {
    const h0 = createAssemblyHistory(EMPTY);
    const bad: AssemblyState = { parts: [makePart('a', false)], mates: [] };
    expect(() => recordChange(h0, bad, 'broken')).toThrow(AssemblyValidationError);
  });

  it('throws for duplicate part ids', () => {
    const h0 = createAssemblyHistory(EMPTY);
    const bad: AssemblyState = {
      parts: [makePart('dup', true), makePart('dup', false)],
      mates: [],
    };
    expect(() => recordChange(h0, bad, 'dup')).toThrow(AssemblyValidationError);
  });

  it('keeps the original history unchanged when validation throws', () => {
    const h0 = createAssemblyHistory(EMPTY);
    const bad: AssemblyState = { parts: [makePart('a', false)], mates: [] };
    expect(() => recordChange(h0, bad, 'broken')).toThrow();
    expect(h0.past).toEqual([]);
    expect(h0.future).toEqual([]);
    expect(h0.present.state).toBe(EMPTY);
  });

  it('preserves the human-readable description in past entries', () => {
    let h = createAssemblyHistory(EMPTY);
    h = recordChange(h, withPart('a'), 'Add part_a');
    h = recordChange(h, withPart('b'), 'Replace with part_b');
    expect(h.present.description).toBe('Replace with part_b');
    expect(h.past[1]!.description).toBe('Add part_a');
  });

  it('does not mutate the input history object', () => {
    const h0 = createAssemblyHistory(EMPTY);
    const snapshotPast = h0.past;
    const snapshotFuture = h0.future;
    recordChange(h0, withPart('a'), 'A');
    expect(h0.past).toBe(snapshotPast);
    expect(h0.future).toBe(snapshotFuture);
    expect(h0.past).toEqual([]);
  });

  it('trims past to maxHistory (custom 3) by evicting oldest first', () => {
    let h = createAssemblyHistory(EMPTY);
    for (let i = 0; i < 10; i++) {
      h = recordChange(h, withPart(`p${i}`), `add p${i}`, 3);
    }
    expect(h.past).toHaveLength(3);
    // Oldest retained past entry should be one of the most-recent edits,
    // not the original empty state. After recording p0..p9 with cap=3:
    // present = p9, past = [p6, p7, p8] (oldest → newest).
    expect(h.past[0]!.description).toBe('add p6');
    expect(h.past[2]!.description).toBe('add p8');
    expect(h.present.description).toBe('add p9');
  });

  it('respects the default maxHistory of 50', () => {
    let h = createAssemblyHistory(EMPTY);
    for (let i = 0; i < 75; i++) {
      h = recordChange(h, withPart(`p${i}`), `add p${i}`);
    }
    expect(h.past).toHaveLength(50);
    expect(h.present.description).toBe('add p74');
  });
});

// ─── undo / redo ─────────────────────────────────────────────────────────

describe('undo / redo', () => {
  it('undo returns the previous state', () => {
    const h0 = createAssemblyHistory(EMPTY);
    const h1 = recordChange(h0, withPart('a'), 'A');
    const h2 = undo(h1);
    expect(h2.present.state).toBe(EMPTY);
    expect(h2.past).toEqual([]);
    expect(h2.future).toHaveLength(1);
    expect(h2.future[0]!.description).toBe('A');
  });

  it('redo replays the most-recently-undone state', () => {
    const h0 = createAssemblyHistory(EMPTY);
    const h1 = recordChange(h0, withPart('a'), 'A');
    const h2 = undo(h1);
    const h3 = redo(h2);
    expect(h3.present.description).toBe('A');
    expect(h3.future).toEqual([]);
    expect(h3.past).toHaveLength(1);
  });

  it('undo + redo cycle is structurally idempotent', () => {
    let h = createAssemblyHistory(EMPTY);
    h = recordChange(h, withPart('a'), 'A');
    h = recordChange(h, withPart('b'), 'B');
    const original = h;
    h = redo(undo(h));
    expect(h.present.description).toBe(original.present.description);
    expect(h.past).toHaveLength(original.past.length);
    expect(h.future).toHaveLength(0);
  });

  it('undo on empty past is a no-op (returns same object)', () => {
    const h0 = createAssemblyHistory(EMPTY);
    expect(undo(h0)).toBe(h0);
  });

  it('redo on empty future is a no-op (returns same object)', () => {
    const h0 = createAssemblyHistory(EMPTY);
    expect(redo(h0)).toBe(h0);
  });

  it('undo navigates through multiple changes one step at a time', () => {
    let h = createAssemblyHistory(EMPTY);
    h = recordChange(h, withPart('a'), 'A');
    h = recordChange(h, withPart('b'), 'B');
    h = recordChange(h, withPart('c'), 'C');

    h = undo(h);
    expect(h.present.description).toBe('B');
    h = undo(h);
    expect(h.present.description).toBe('A');
    h = undo(h);
    expect(h.present.description).not.toBe('A');
    expect(h.past).toEqual([]);
  });
});

// ─── canUndo / canRedo ───────────────────────────────────────────────────

describe('canUndo / canRedo', () => {
  it('canUndo is false initially', () => {
    expect(canUndo(createAssemblyHistory(EMPTY))).toBe(false);
  });

  it('canRedo is false initially', () => {
    expect(canRedo(createAssemblyHistory(EMPTY))).toBe(false);
  });

  it('canUndo flips true after the first recordChange', () => {
    const h = recordChange(createAssemblyHistory(EMPTY), withPart('a'), 'A');
    expect(canUndo(h)).toBe(true);
    expect(canRedo(h)).toBe(false);
  });

  it('canRedo flips true after an undo', () => {
    let h = recordChange(createAssemblyHistory(EMPTY), withPart('a'), 'A');
    h = undo(h);
    expect(canRedo(h)).toBe(true);
  });

  it('canRedo flips back to false after a fresh recordChange', () => {
    let h = recordChange(createAssemblyHistory(EMPTY), withPart('a'), 'A');
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = recordChange(h, withPart('b'), 'B');
    expect(canRedo(h)).toBe(false);
  });
});

// ─── stress / stability ──────────────────────────────────────────────────

describe('stability under heavy use', () => {
  it('remains stable after 60+ alternating record/undo operations', () => {
    let h = createAssemblyHistory(EMPTY);
    for (let i = 0; i < 60; i++) {
      h = recordChange(h, withPart(`p${i}`), `add p${i}`);
      if (i % 5 === 0) h = undo(h);
    }
    // Sanity: present is always a valid AssemblyState we can keep editing on.
    expect(() =>
      recordChange(h, withPart('final'), 'final'),
    ).not.toThrow();
  });

  it('descriptions stay aligned with state through long histories', () => {
    let h = createAssemblyHistory(EMPTY);
    for (let i = 0; i < 30; i++) {
      h = recordChange(h, withPart(`p${i}`), `add p${i}`);
    }
    expect(h.present.state.parts[0]!.id).toBe('p29');
    expect(h.present.description).toBe('add p29');
    h = undo(h);
    expect(h.present.state.parts[0]!.id).toBe('p28');
    expect(h.present.description).toBe('add p28');
  });
});
