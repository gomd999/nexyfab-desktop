import { describe, it, expect } from 'vitest';
import {
  mintSemanticTag,
  SemanticTagRegistry,
} from './edgeSemanticTagging';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

function sel(
  pos: [number, number, number],
  length = 10,
  persistentId?: string,
): EdgeSelectionInfo {
  return { type: 'edge', position: pos, length, normal: [0, 1, 0], persistentId };
}

describe('mintSemanticTag', () => {
  it('uses persistentId when present', () => {
    const tag = mintSemanticTag(sel([0, 0, 0], 10, 'edge_42'));
    expect(tag).toBe('edge_42');
  });

  it('produces stable hash for same selection', () => {
    const a = mintSemanticTag(sel([1, 2, 3], 10));
    const b = mintSemanticTag(sel([1, 2, 3], 10));
    expect(a).toBe(b);
  });

  it('produces different hash for different positions', () => {
    const a = mintSemanticTag(sel([1, 2, 3], 10));
    const b = mintSemanticTag(sel([1, 2, 4], 10));
    expect(a).not.toBe(b);
  });

  it('produces different hash for different lengths', () => {
    const a = mintSemanticTag(sel([1, 2, 3], 10));
    const b = mintSemanticTag(sel([1, 2, 3], 20));
    expect(a).not.toBe(b);
  });
});

describe('SemanticTagRegistry', () => {
  it('registers and resolves a tag', () => {
    const r = new SemanticTagRegistry();
    const s = sel([0, 0, 0], 10);
    const tag = mintSemanticTag(s);
    r.register(tag, s);
    expect(r.resolve(tag)).toHaveLength(1);
  });

  it('groups multiple selections under one tag', () => {
    const r = new SemanticTagRegistry();
    const s1 = sel([0, 0, 0], 10);
    const tag = mintSemanticTag(s1);
    r.register(tag, s1);
    r.register(tag, sel([0, 0, 0], 5));
    expect(r.resolve(tag)).toHaveLength(2);
    expect(r.splitCount()).toBe(1);
  });

  it('returns empty for unknown tag', () => {
    const r = new SemanticTagRegistry();
    expect(r.resolve('phantom' as any)).toEqual([]);
  });

  it('propagateAfterBoolean tags fragments within tolerance', () => {
    const r = new SemanticTagRegistry();
    const s1 = sel([0, 0, 0], 10);
    const tag = mintSemanticTag(s1);
    r.register(tag, s1);

    // Simulate boolean split — two new fragments near original endpoint.
    const newSels = [
      sel([0.2, 0, 0], 5),   // close → should inherit
      sel([100, 0, 0], 5),   // far  → orphan
    ];
    const report = r.propagateAfterBoolean(newSels, 1.0);
    expect(report.taggedFragments).toBe(1);
    expect(report.orphans).toHaveLength(1);
    expect(r.resolve(tag)).toHaveLength(2);
  });

  it('clear empties the registry', () => {
    const r = new SemanticTagRegistry();
    const s = sel([0, 0, 0]);
    r.register(mintSemanticTag(s), s);
    r.clear();
    expect(r.entries()).toEqual([]);
  });

  // ── Boolean SPLIT propagation (the module's actual purpose) ──────────────
  // A real split moves each fragment's midpoint well away from the original
  // click, so point-proximity alone tags neither half (the C0-kink bug). A
  // fragment is the same edge when it is COLLINEAR and within the original's
  // reach; that tags both halves while off-line siblings keep their distance.
  const edge = (pos: [number, number, number], length: number, direction: [number, number, number]): EdgeSelectionInfo =>
    ({ type: 'edge', position: pos, length, direction, normal: [0, 1, 0] });

  it('tags BOTH halves when a boolean splits an edge at its centre', () => {
    const r = new SemanticTagRegistry();
    const orig = edge([0, 0, 0], 40, [1, 0, 0]); // clicked mid of a 40mm +X edge
    const tag = mintSemanticTag(orig);
    r.register(tag, orig);
    // Split at x=0 → fragments at x=−10 and x=+10 (each midpoint 10mm from click).
    const report = r.propagateAfterBoolean([
      edge([-10, 0, 0], 20, [1, 0, 0]),
      edge([10, 0, 0], 20, [1, 0, 0]),
    ]);
    expect(report.taggedFragments).toBe(2);
    expect(report.orphans).toHaveLength(0);
    expect(r.resolve(tag)).toHaveLength(3); // original + two halves
  });

  it('tags both fragments of an off-centre (end-clicked) split', () => {
    const r = new SemanticTagRegistry();
    const orig = edge([-18, 0, 0], 40, [1, 0, 0]);
    const tag = mintSemanticTag(orig);
    r.register(tag, orig);
    const report = r.propagateAfterBoolean([
      edge([-19, 0, 0], 4, [1, 0, 0]),
      edge([10, 0, 0], 32, [1, 0, 0]),
    ]);
    expect(report.taggedFragments).toBe(2);
    expect(report.orphans).toHaveLength(0);
  });

  it('a parallel but OFF-LINE edge (opposite side) does not steal the tag', () => {
    const r = new SemanticTagRegistry();
    const orig = edge([0, 0, 20], 40, [1, 0, 0]); // top-front +X edge (z=+20)
    const tag = mintSemanticTag(orig);
    r.register(tag, orig);
    // top-back edge: same +X direction, but 40mm off the line in z.
    const report = r.propagateAfterBoolean([edge([0, 0, -20], 40, [1, 0, 0])]);
    expect(report.taggedFragments).toBe(0);
    expect(report.orphans).toHaveLength(1);
  });
});
