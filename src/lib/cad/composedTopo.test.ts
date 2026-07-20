/**
 * composedTopo — stable edge names inherited across a boolean (K2.2).
 *
 * The W1-B block is the regression guard for ADR-017 S2b: inserting a second
 * boolean must never make an existing name resolve to a DIFFERENT entity.
 */
import { describe, it, expect } from 'vitest';
import {
  composeBooleanTopo, fromAnchors, isLegacyRoleName,
  type BooleanInput, type EdgeAnchorSource,
} from './composedTopo';
import type { Vec3 } from '@/lib/sketch/sketchPlane';

function input(featureId: string, anchors: Record<string, Vec3>): BooleanInput {
  return {
    featureId,
    names: Object.keys(anchors),
    anchorOf: (n) => anchors[n] ?? null,
  };
}
/** Pre-W1-B caller shape: positional prefix, no feature id. */
function legacyInput(role: string, anchors: Record<string, Vec3>): BooleanInput {
  return { role, names: Object.keys(anchors), anchorOf: (n) => anchors[n] ?? null };
}

describe('composeBooleanTopo', () => {
  const a = input('base', {
    'e.vert.0': { x: 0, y: 0, z: 2.5 },
    'e.vert.1': { x: 10, y: 0, z: 2.5 },
    'e.gone': { x: 5, y: 5, z: 2.5 }, // consumed by the boolean → no result edge
  });
  const b = input('H0', {
    'e.top.0-1': { x: 4, y: 5, z: 7 },
  });

  // Result edges: base/e.vert.0, base/e.vert.1, H0/e.top.0-1 survive; one seam.
  const resultMids: Vec3[] = [
    { x: 10, y: 0, z: 2.5 }, // base/e.vert.1
    { x: 4, y: 5, z: 7 },    // H0/e.top.0-1
    { x: 5, y: 5, z: 3 },    // seam (no input match)
    { x: 0, y: 0, z: 2.5 },  // base/e.vert.0
  ];

  it('inherits surviving input names with the operand feature id', () => {
    const t = composeBooleanTopo([a, b], resultMids);
    expect(t.anchor('base/e.vert.0')).toEqual({ x: 0, y: 0, z: 2.5 });
    expect(t.anchor('base/e.vert.1')).toEqual({ x: 10, y: 0, z: 2.5 });
    expect(t.anchor('H0/e.top.0-1')).toEqual({ x: 4, y: 5, z: 7 });
  });

  it('drops names whose edge did not survive the boolean', () => {
    const t = composeBooleanTopo([a, b], resultMids);
    expect(t.anchor('base/e.gone')).toBeNull();
    expect(t.lossReason?.('base/e.gone')).toBe('unknown');
  });

  it('names the leftover intersection edge as a seam', () => {
    const t = composeBooleanTopo([a, b], resultMids);
    expect(t.anchor('seam.0')).toEqual({ x: 5, y: 5, z: 3 });
    // every result edge is named exactly once (bijective coverage)
    expect(t.names()).toHaveLength(resultMids.length);
  });

  it('seam numbering is deterministic by midpoint, not kernel order', () => {
    const noNames: BooleanInput = { featureId: 'base', names: [], anchorOf: () => null };
    const mids: Vec3[] = [{ x: 9, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }];
    const t1 = composeBooleanTopo([noNames], mids);
    const t2 = composeBooleanTopo([noNames], [...mids].reverse());
    // seam.0 is the lexicographically-smallest midpoint regardless of input order
    expect(t1.anchor('seam.0')).toEqual({ x: 1, y: 0, z: 0 });
    expect(t2.anchor('seam.0')).toEqual({ x: 1, y: 0, z: 0 });
  });

  it('scopes seams to the boolean that minted them when opId is given', () => {
    const t = composeBooleanTopo([a, b], resultMids, { opId: 'cut.H0' });
    expect(t.anchor('cut.H0/seam.0')).toEqual({ x: 5, y: 5, z: 3 });
    expect(t.anchor('seam.0')).toBeNull();
  });

  it('accepts the legacy positional tolerance argument', () => {
    const t = composeBooleanTopo([a, b], resultMids, 1e-3);
    expect(t.anchor('base/e.vert.0')).toEqual({ x: 0, y: 0, z: 2.5 });
  });

  it('fromAnchors exposes a sorted name list', () => {
    const t = fromAnchors(new Map([['z', { x: 0, y: 0, z: 0 }], ['a', { x: 1, y: 1, z: 1 }]]));
    expect(t.names()).toEqual(['a', 'z']);
    expect(t.anchor('missing')).toBeNull();
  });
});

// ── W1-B (ADR-017 S2b): inserting a feature must not relocate a reference ──

describe('composeBooleanTopo — stability under feature insertion', () => {
  const mid = (x: number): Vec3 => ({ x, y: 0, z: 0 });
  const src = (m: ReadonlyMap<string, Vec3>) => fromAnchors(m);
  const asInput = (featureId: string, s: EdgeAnchorSource): BooleanInput =>
    ({ featureId, names: s.names(), anchorOf: (n) => s.anchor(n) });

  const base = src(new Map([['e.vert.0', mid(0)], ['e.vert.1', mid(1)]]));
  const hole0 = src(new Map([['e.vert.0', mid(2)]]));
  const hole1 = src(new Map([['e.vert.0', mid(3)]]));

  /** base − H0, then optionally − H1 (a cut inserted AFTER authoring). */
  function build(withSecondCut: boolean): EdgeAnchorSource {
    let acc = composeBooleanTopo(
      [asInput('base', base), asInput('H0', hole0)],
      [mid(0), mid(1), mid(2)],
      { opId: 'cut.H0' },
    );
    if (withSecondCut) {
      acc = composeBooleanTopo(
        [asInput('cut.H0', acc), asInput('H1', hole1)],
        [mid(0), mid(1), mid(2), mid(3)],
        { opId: 'cut.H1' },
      );
    }
    return acc;
  }

  it('a name authored before the insert resolves to the SAME edge after it', () => {
    const before = build(false), after = build(true);
    for (const n of before.names()) {
      // Either it still resolves to the identical anchor, or it is explicitly
      // lost. What must never happen is resolving to a different edge.
      const now = after.anchor(n);
      if (now !== null) expect(now).toEqual(before.anchor(n));
    }
    // and in this configuration nothing is lost at all
    expect(after.anchor('H0/e.vert.0')).toEqual(mid(2));
    expect(after.anchor('base/e.vert.0')).toEqual(mid(0));
  });

  it('does not re-prefix already-qualified names (namespace stops growing)', () => {
    expect(build(true).names()).not.toContain('cut.H0/base/e.vert.0');
  });

  it('the newly inserted tool gets its OWN namespace', () => {
    expect(build(true).anchor('H1/e.vert.0')).toEqual(mid(3));
  });

  it('colliding names from two operands are refused, not shadowed', () => {
    // Both operands offer a bare `e.vert.0` (legacy callers with no feature id).
    const t = composeBooleanTopo(
      [
        { names: ['e.vert.0'], anchorOf: () => mid(0) },
        { names: ['e.vert.0'], anchorOf: () => mid(1) },
      ],
      [mid(0), mid(1)],
    );
    expect(t.anchor('e.vert.0')).toBeNull();
    expect(t.lossReason?.('e.vert.0')).toBe('ambiguous');
  });

  it('legacy positional callers degrade to explicit loss, never to a mismatch', () => {
    // Pre-W1-B chaining: acc keeps role 'a', each tool takes role 'b'.
    const cut1 = composeBooleanTopo(
      [legacyInput('a', { 'e.vert.0': mid(0) }), legacyInput('b', { 'e.vert.0': mid(2) })],
      [mid(0), mid(2)],
    );
    expect(cut1.anchor('b/e.vert.0')).toEqual(mid(2)); // H0's edge
    const cut2 = composeBooleanTopo(
      [
        { role: 'a', names: cut1.names(), anchorOf: (n) => cut1.anchor(n) },
        legacyInput('b', { 'e.vert.0': mid(3) }), // H1 — inserted later
      ],
      [mid(0), mid(2), mid(3)],
    );
    // The old scheme silently returned H1's edge here (ADR-017 S2b, 50%).
    expect(cut2.anchor('b/e.vert.0')).not.toEqual(mid(3));
    expect(cut2.anchor('b/e.vert.0')).toBeNull();
    expect(cut2.lossReason?.('b/e.vert.0')).toBe('ambiguous');
    // The accumulator's own names are no longer re-roled into `a/a/…`.
    expect(cut2.anchor('a/e.vert.0')).toEqual(mid(0));
  });

  it('classifies stale positional names distinctly from unknown ones', () => {
    const t = build(true);
    expect(t.lossReason?.('b/e.vert.0')).toBe('legacy-role');
    expect(t.lossReason?.('a/a/e.vert.0')).toBe('legacy-role');
    expect(t.lossReason?.('H9/e.vert.0')).toBe('unknown');
    expect(t.lossReason?.('H0/e.vert.0')).toBeNull(); // resolves fine
    expect(isLegacyRoleName('a/b/e.vert.0')).toBe(true);
    expect(isLegacyRoleName('base/e.vert.0')).toBe(false);
  });
});

// ── W3-A (ADR-017 route (a)): seams named by kernel history, not position ──

describe('composeBooleanTopo — kernel-history seams', () => {
  const mid = (x: number): Vec3 => ({ x, y: 0, z: 0 });
  const noNames: BooleanInput = { featureId: 'base', names: [], anchorOf: () => null };

  it('names seams by their generating-face key, invariant to kernel edge order', () => {
    const mids = [mid(9), mid(1), mid(5)];
    const keys = [
      'H0/f.side.0∩base/f.cap.top',
      'H0/f.side.1∩base/f.cap.top',
      'H0/f.side.0∩base/f.cap.bottom',
    ];
    const t1 = composeBooleanTopo([noNames], mids, { opId: 'cut.H0', seamKeys: keys });
    const t2 = composeBooleanTopo([noNames], [...mids].reverse(), { opId: 'cut.H0', seamKeys: [...keys].reverse() });
    // Same physical edge (mid 9) under the same name in BOTH kernel orders —
    // the legacy midpoint sort gave it a different ordinal per order.
    expect(t1.anchor('cut.H0/seam(H0/f.side.0∩base/f.cap.top)')).toEqual(mid(9));
    expect(t2.anchor('cut.H0/seam(H0/f.side.0∩base/f.cap.top)')).toEqual(mid(9));
    // Positional seam names are gone in history mode.
    expect(t1.anchor('cut.H0/seam.0')).toBeNull();
    expect(t1.lossReason?.('cut.H0/seam.0')).toBe('legacy-seam');
  });

  it('a keyless seam stays unnamed — explicit loss, never a positional guess', () => {
    const t = composeBooleanTopo([noNames], [mid(1), mid(2)], { opId: 'op', seamKeys: ['k1', null] });
    expect(t.names()).toEqual(['op/seam(k1)']);
    expect(t.anchor('op/seam.1')).toBeNull();
  });

  it('duplicate keys refuse ALL their edges (ambiguous, D1)', () => {
    const t = composeBooleanTopo([noNames], [mid(1), mid(2)], { opId: 'op', seamKeys: ['k', 'k'] });
    expect(t.names()).toEqual([]);
    expect(t.anchor('op/seam(k)')).toBeNull();
    expect(t.lossReason?.('op/seam(k)')).toBe('ambiguous');
  });

  it('a new seam key colliding with an inherited pass-through name refuses both', () => {
    // The operand carries a seam name minted by an id-less earlier boolean and
    // the new boolean's history mints the same composed name.
    const prev: BooleanInput = { names: ['seam(k)'], anchorOf: () => mid(0) };
    const t = composeBooleanTopo([prev], [mid(0), mid(5)], { seamKeys: [null, 'k'] });
    expect(t.anchor('seam(k)')).toBeNull();
    expect(t.lossReason?.('seam(k)')).toBe('ambiguous');
  });

  it('legacy-seam diagnosis applies only to unresolved positional seam names', () => {
    const t = composeBooleanTopo([noNames], [mid(1)], { opId: 'op', seamKeys: ['k'] });
    expect(t.lossReason?.('seam.3')).toBe('legacy-seam');
    expect(t.lossReason?.('nope')).toBe('unknown');
    expect(t.lossReason?.('op/seam(k)')).toBeNull(); // resolves fine
  });
});
