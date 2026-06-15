// @vitest-environment jsdom
/**
 * assemblyPersist — Phase 4 round-trip + hook tests.
 *
 * Coverage:
 *   - empty state round-trip
 *   - 2 parts + 1 mate round-trip
 *   - every mate kind round-trips (preserves kind-specific fields)
 *   - version mismatch / corrupt JSON / bad envelope rejected
 *   - serializeAssembly refuses an invalid IR (no fixed part)
 *   - useAssemblyStorage round-trip via localStorage (debounced)
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  serializeAssembly,
  deserializeAssembly,
  useAssemblyStorage,
  ASSEMBLY_PERSIST_VERSION,
} from './assemblyPersist';
import {
  partInstance,
  IDENTITY_QUAT,
  AssemblyValidationError,
  type AssemblyState,
} from './assemblyState';
import type { Mate, MateRef } from './mate';

// ─── helpers ──────────────────────────────────────────────────────────────

function ref(partId: string, refId: string, refKind: MateRef['refKind']): MateRef {
  return { partId, refId, refKind };
}

function makePart(id: string, opts: Partial<{ fixed: boolean; x: number }> = {}) {
  return partInstance({
    id,
    name: id,
    partTemplateId: `tpl_${id}`,
    position: { x: opts.x ?? 0, y: 0, z: 0 },
    orientation: IDENTITY_QUAT,
    fixed: opts.fixed,
  });
}

// ─── serialize / deserialize basics ───────────────────────────────────────

describe('serializeAssembly / deserializeAssembly', () => {
  it('round-trips an empty state', () => {
    const empty: AssemblyState = { parts: [], mates: [] };
    const wire = serializeAssembly(empty);
    const parsed = JSON.parse(wire);
    expect(parsed.version).toBe(ASSEMBLY_PERSIST_VERSION);
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.state.parts).toEqual([]);
      expect(out.state.mates).toEqual([]);
    }
  });

  it('round-trips 2 parts + 1 coincident mate', () => {
    const state: AssemblyState = {
      parts: [makePart('base', { fixed: true }), makePart('arm', { x: 10 })],
      mates: [
        { id: 'm1', kind: 'coincident', a: ref('base', 'f1', 'face'), b: ref('arm', 'f2', 'face') },
      ],
    };
    const wire = serializeAssembly(state);
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.parts).toHaveLength(2);
    expect(out.state.mates).toHaveLength(1);
    expect(out.state.mates[0]!.kind).toBe('coincident');
    expect(out.state.parts[1]!.position.x).toBe(10);
  });

  it('preserves the fixed flag', () => {
    const state: AssemblyState = {
      parts: [makePart('a', { fixed: true })],
      mates: [],
    };
    const wire = serializeAssembly(state);
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.state.parts[0]!.fixed).toBe(true);
  });

  it('preserves quaternion orientation exactly', () => {
    const state: AssemblyState = {
      parts: [
        {
          id: 'a',
          name: 'a',
          partTemplateId: 't',
          position: { x: 1.5, y: -2.25, z: 3 },
          orientation: { x: 0.5, y: 0.5, z: 0.5, w: 0.5 },
          fixed: true,
        },
      ],
      mates: [],
    };
    const wire = serializeAssembly(state);
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.state.parts[0]!.orientation).toEqual({ x: 0.5, y: 0.5, z: 0.5, w: 0.5 });
      expect(out.state.parts[0]!.position).toEqual({ x: 1.5, y: -2.25, z: 3 });
    }
  });

  // ── every mate kind ────────────────────────────────────────────────────

  it('round-trips every mate kind (11 kinds total)', () => {
    const base = makePart('A', { fixed: true });
    const other = makePart('B', { x: 10 });
    const A = (refId: string, refKind: MateRef['refKind']) => ref('A', refId, refKind);
    const B = (refId: string, refKind: MateRef['refKind']) => ref('B', refId, refKind);

    const mates: Mate[] = [
      { id: 'm1',  kind: 'coincident',    a: A('f1', 'face'), b: B('f2', 'face') },
      { id: 'm2',  kind: 'concentric',    a: A('a1', 'axis'), b: B('a2', 'axis') },
      { id: 'm3',  kind: 'distance',      a: A('f1', 'face'), b: B('f2', 'face'), value: 12.5 },
      { id: 'm4',  kind: 'angle',         a: A('f1', 'face'), b: B('f2', 'face'), value: 45 },
      { id: 'm5',  kind: 'parallel',      a: A('a1', 'axis'), b: B('a2', 'axis') },
      { id: 'm6',  kind: 'perpendicular', a: A('a1', 'axis'), b: B('a2', 'axis') },
      { id: 'm7',  kind: 'tangent',       a: A('f1', 'face'), b: B('f2', 'face') },
      { id: 'm8',  kind: 'hinge',         a: A('a1', 'axis'), b: B('a2', 'axis'),
        limit: { minAngleDeg: -90, maxAngleDeg: 90 } },
      { id: 'm9',  kind: 'slot',          a: A('e1', 'edge'), b: B('a2', 'axis'), slotLength: 20 },
      { id: 'm10', kind: 'gear',          a: A('a1', 'axis'), b: B('a2', 'axis'), ratio: 2.5, backlash: 0.01 },
      { id: 'm11', kind: 'rack_pinion',   a: A('a1', 'axis'), b: B('e2', 'edge'), pinionRadius: 5,
        rackTravel: { min: -10, max: 10 } },
    ];
    const state: AssemblyState = { parts: [base, other], mates };

    const wire = serializeAssembly(state);
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.state.mates).toHaveLength(mates.length);
    for (let i = 0; i < mates.length; i++) {
      expect(out.state.mates[i]).toEqual(mates[i]);
    }
  });

  // ── error envelopes ────────────────────────────────────────────────────

  it('rejects non-string input', () => {
    const out = deserializeAssembly(42 as unknown as string);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/parse_error/);
  });

  it('rejects empty string', () => {
    const out = deserializeAssembly('');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/parse_error/);
  });

  it('rejects malformed JSON', () => {
    const out = deserializeAssembly('{not json');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/parse_error/);
  });

  it('rejects version mismatch', () => {
    const wire = JSON.stringify({ version: 999, state: { parts: [], mates: [] } });
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/version_mismatch/);
  });

  it('rejects missing version field', () => {
    const wire = JSON.stringify({ state: { parts: [], mates: [] } });
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/version_mismatch/);
  });

  it('rejects bad envelope shape (state missing)', () => {
    const wire = JSON.stringify({ version: 1 });
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/bad_envelope/);
  });

  it('rejects bad envelope shape (parts not an array)', () => {
    const wire = JSON.stringify({ version: 1, state: { parts: {}, mates: [] } });
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/bad_envelope/);
  });

  it('rejects when validateAssembly fails (no fixed part)', () => {
    // bypass serialize validation by hand-building the wire
    const wire = JSON.stringify({
      version: 1,
      state: {
        parts: [{
          id: 'a', name: 'a', partTemplateId: 't',
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          fixed: false,
        }],
        mates: [],
      },
    });
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/invalid_state/);
  });

  it('rejects when a mate references an unknown part', () => {
    const wire = JSON.stringify({
      version: 1,
      state: {
        parts: [{
          id: 'a', name: 'a', partTemplateId: 't',
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
          fixed: true,
        }],
        mates: [{
          id: 'm1', kind: 'coincident',
          a: { partId: 'a', refId: 'f1', refKind: 'face' },
          b: { partId: 'GHOST', refId: 'f2', refKind: 'face' },
        }],
      },
    });
    const out = deserializeAssembly(wire);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/invalid_state/);
  });

  it('serializeAssembly throws AssemblyValidationError on invalid input', () => {
    const bad: AssemblyState = {
      parts: [makePart('a')], // no fixed part
      mates: [],
    };
    expect(() => serializeAssembly(bad)).toThrow(AssemblyValidationError);
  });
});

// ─── useAssemblyStorage hook ──────────────────────────────────────────────

describe('useAssemblyStorage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists writes to localStorage after the 500 ms debounce', () => {
    const KEY = 'asm:test:hook1';
    const { result } = renderHook(() => useAssemblyStorage(KEY));
    expect(result.current[0].parts).toEqual([]);

    const next: AssemblyState = {
      parts: [makePart('a', { fixed: true })],
      mates: [],
    };
    act(() => {
      result.current[1](next);
    });

    // Pre-debounce: state is set in-memory but localStorage is still empty.
    expect(result.current[0].parts).toHaveLength(1);
    expect(localStorage.getItem(KEY)).toBeNull();

    // After 500 ms: persisted.
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const raw = localStorage.getItem(KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(ASSEMBLY_PERSIST_VERSION);
    expect(parsed.state.parts).toHaveLength(1);

    // Rehydration: a fresh hook with the same key reads the saved state.
    const { result: r2 } = renderHook(() => useAssemblyStorage(KEY));
    expect(r2.current[0].parts).toHaveLength(1);
    expect(r2.current[0].parts[0]!.id).toBe('a');
  });
});
