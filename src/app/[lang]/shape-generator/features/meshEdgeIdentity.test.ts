/**
 * meshEdgeIdentity — mesh-mode selection survival at the edge-identity level
 * (F3 step-1 breadth). A stored edge selection must resolve to the SAME box-edge
 * id before and after an upstream dimension change, and to DIFFERENT ids for
 * genuinely different edges. This is the resize-invariant half of mesh-mode
 * selection survival (the watertight per-edge bevel is a documented follow-up).
 */
import { describe, it, expect } from 'vitest';
import { boxEdgeFromSelection, boxEdgeKey, perpAxes, type BBox } from './meshEdgeIdentity';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

const bbox = (hw: number, hh: number, hd: number): BBox => ({
  min: [-hw, -hh, -hd], max: [hw, hh, hd],
});

const sel = (over: Partial<EdgeSelectionInfo>): EdgeSelectionInfo => ({
  type: 'edge',
  position: [8, 20, 20],
  direction: [1, 0, 0],
  length: 40,
  normal: [0, 1, 0],
  bbox: bbox(20, 20, 20),
  ...over,
});

describe('meshEdgeIdentity — resize-invariant box-edge identity', () => {
  it('picks the axis from the click direction', () => {
    expect(boxEdgeFromSelection(sel({ direction: [1, 0, 0] }), bbox(20, 20, 20))!.axis).toBe('x');
    expect(boxEdgeFromSelection(sel({ direction: [0, 1, 0] }), bbox(20, 20, 20))!.axis).toBe('y');
    expect(boxEdgeFromSelection(sel({ direction: [0, 0, 1] }), bbox(20, 20, 20))!.axis).toBe('z');
  });

  it('returns null without a direction (cannot pick an axis)', () => {
    expect(boxEdgeFromSelection(sel({ direction: undefined }), bbox(20, 20, 20))).toBeNull();
  });

  it('SELECTION SURVIVES a width change: same edge id at 40 wide and 60 wide', () => {
    const stored = sel({ position: [8, 20, 20], direction: [1, 0, 0], bbox: bbox(20, 20, 20) });
    const before = boxEdgeFromSelection(stored, bbox(20, 20, 20));
    const after = boxEdgeFromSelection(stored, bbox(30, 20, 20)); // width 40 → 60
    expect(before).toEqual({ axis: 'x', sU: 1, sV: 1 });
    expect(after).toEqual(before);
    expect(boxEdgeKey(after!)).toBe(boxEdgeKey(before!));
  });

  it('survives a NON-uniform resize (depth doubles) without jumping edges', () => {
    const stored = sel({ position: [0, 20, 20], direction: [1, 0, 0], bbox: bbox(20, 20, 20) });
    const after = boxEdgeFromSelection(stored, bbox(20, 20, 40)); // depth 40 → 80
    // top-front X edge — perpendicular signs stay (+y, +z), not flipped to −z.
    expect(after).toEqual({ axis: 'x', sU: 1, sV: 1 });
  });

  it('distinguishes the opposite edge (a click near −y resolves to sU = −1)', () => {
    const top = boxEdgeFromSelection(sel({ position: [0, 20, 20], direction: [1, 0, 0] }), bbox(20, 20, 20));
    const bottom = boxEdgeFromSelection(sel({ position: [0, -20, 20], direction: [1, 0, 0] }), bbox(20, 20, 20));
    expect(top!.sU).toBe(1);
    expect(bottom!.sU).toBe(-1);
    expect(boxEdgeKey(top!)).not.toBe(boxEdgeKey(bottom!));
  });

  it('perpAxes are the two non-extrude axes in a fixed order', () => {
    expect(perpAxes('x')).toEqual(['y', 'z']);
    expect(perpAxes('y')).toEqual(['z', 'x']);
    expect(perpAxes('z')).toEqual(['x', 'y']);
  });
});
