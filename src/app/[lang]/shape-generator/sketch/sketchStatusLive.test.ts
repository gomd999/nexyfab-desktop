import { describe, it, expect } from 'vitest';
import { computeSketchLiveStatus, getSketchStatusTone, EMPTY_SKETCH_STATUS } from './sketchStatusLive';
import type { SketchConstraint, SketchSegment } from './types';

const line = (id: string, aId: string, bId: string): SketchSegment => ({
  type: 'line',
  id,
  points: [
    { id: aId, x: 0, y: 0 },
    { id: bId, x: 10, y: 5 },
  ],
});

describe('computeSketchLiveStatus', () => {
  it('reports null status for an empty sketch (no fake "fully constrained")', () => {
    const r = computeSketchLiveStatus([], [], []);
    expect(r).toEqual(EMPTY_SKETCH_STATUS);
    expect(r.status).toBeNull();
    expect(r.dof).toBeNull();
  });

  it('reports under-defined with DOF 4 for one free line', () => {
    const r = computeSketchLiveStatus([line('s0', 'a', 'b')], [], []);
    expect(r.status).toBe('under-defined');
    expect(r.dof).toBe(4);
    expect(r.solveMs).not.toBeNull();
  });

  it('reports ok / DOF 0 when both endpoints are fixed', () => {
    const constraints: SketchConstraint[] = [
      { id: 'f1', type: 'fixed', entityIds: ['a'], satisfied: false },
      { id: 'f2', type: 'fixed', entityIds: ['b'], satisfied: false },
    ];
    const r = computeSketchLiveStatus([line('s0', 'a', 'b')], constraints, []);
    expect(r.status).toBe('ok');
    expect(r.dof).toBe(0);
    expect(r.unsatisfiedIds).toEqual([]);
  });

  it('does not mutate the input geometry (read-only solve)', () => {
    const seg: SketchSegment = {
      type: 'line',
      id: 's0',
      points: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 5 },
      ],
    };
    const constraints: SketchConstraint[] = [
      { id: 'f1', type: 'fixed', entityIds: ['a'], satisfied: false },
      { id: 'h1', type: 'horizontal', entityIds: ['s0'], satisfied: false },
    ];
    computeSketchLiveStatus([seg], constraints, []);
    // Horizontal would move b.y → 0 if the solve were applied.
    expect(seg.points[1].y).toBe(5);
    expect(constraints[1].satisfied).toBe(false);
  });

  it('counts points without ids as free DOF instead of reporting fake ok', () => {
    const seg: SketchSegment = {
      type: 'line',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const r = computeSketchLiveStatus([seg], [], []);
    expect(r.status).toBe('under-defined');
    expect(r.dof).toBe(4);
  });
});

describe('getSketchStatusTone', () => {
  it('maps solver statuses to UI tones', () => {
    expect(getSketchStatusTone(null)).toBe('none');
    expect(getSketchStatusTone('ok')).toBe('ok');
    expect(getSketchStatusTone('under-defined')).toBe('under');
    expect(getSketchStatusTone('over-defined')).toBe('over');
    expect(getSketchStatusTone('inconsistent')).toBe('conflict');
  });
});
