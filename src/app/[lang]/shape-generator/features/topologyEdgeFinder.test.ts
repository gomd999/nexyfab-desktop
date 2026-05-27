/**
 * topologyEdgeFinder.test.ts — unit-test surface for the EdgeFinder
 * bridge. We don't load replicad / WASM here (those tests live in the
 * `.spike.test.ts` gated on RUN_OCCT_FEASIBILITY); the goal is to
 * exercise the pure JS scaffolding around the constructor probe.
 */
import { describe, it, expect } from 'vitest';
import {
  buildEdgeFinderFromSelection,
  buildEdgeFinderFromMultiSelection,
  buildEdgeFinderForLoop,
  inferLoopDirection,
} from './topologyEdgeFinder';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

function edge(
  id: string,
  pos: [number, number, number],
  normal: [number, number, number],
  length = 10,
): EdgeSelectionInfo {
  return { type: 'edge', position: pos, length, normal, persistentId: id };
}

describe('buildEdgeFinderFromSelection (no-WASM env)', () => {
  it('returns null when replicad is unavailable', async () => {
    const sel = edge('e1', [0, 0, 0], [0, 1, 0]);
    const finder = await buildEdgeFinderFromSelection(sel);
    expect(finder).toBeNull();
  });

  it('handles negative length safely', async () => {
    const sel = edge('e1', [0, 0, 0], [0, 1, 0], -5);
    const finder = await buildEdgeFinderFromSelection(sel);
    expect(finder).toBeNull();
  });
});

describe('buildEdgeFinderFromMultiSelection', () => {
  it('returns null for empty array', async () => {
    expect(await buildEdgeFinderFromMultiSelection([])).toBeNull();
  });

  it('delegates to single-edge builder for size 1', async () => {
    const sel = edge('e1', [0, 0, 0], [0, 1, 0]);
    const finder = await buildEdgeFinderFromMultiSelection([sel]);
    // In WASM-less env both return null. The contract is "no throw".
    expect(finder).toBeNull();
  });

  it('returns null for size > 1 in WASM-less env without crashing', async () => {
    const sels = [
      edge('e1', [0, 0, 0], [0, 1, 0]),
      edge('e2', [10, 0, 0], [0, 1, 0]),
    ];
    const finder = await buildEdgeFinderFromMultiSelection(sels);
    expect(finder).toBeNull();
  });
});

describe('inferLoopDirection', () => {
  it('returns null for single selection', () => {
    const sel = edge('e1', [0, 0, 0], [0, 1, 0]);
    expect(inferLoopDirection([sel])).toBeNull();
  });

  it('detects +Y axis when all faces share +Y normal', () => {
    const sels = [
      edge('e1', [0, 5, 0], [0, 1, 0]),
      edge('e2', [10, 5, 0], [0, 1, 0]),
      edge('e3', [10, 5, 10], [0, 1, 0]),
      edge('e4', [0, 5, 10], [0, 1, 0]),
    ];
    expect(inferLoopDirection(sels)).toEqual([0, 1, 0]);
  });

  it('detects -Z axis when all faces share -Z normal', () => {
    const sels = [
      edge('e1', [0, 0, -5], [0, 0, -1]),
      edge('e2', [10, 0, -5], [0, 0, -1]),
      edge('e3', [10, 10, -5], [0, 0, -1]),
      edge('e4', [0, 10, -5], [0, 0, -1]),
    ];
    expect(inferLoopDirection(sels)).toEqual([0, 0, -1]);
  });

  it('returns null when normals disagree (< 75% consensus)', () => {
    const sels = [
      edge('e1', [0, 0, 0], [0, 1, 0]),
      edge('e2', [10, 0, 0], [1, 0, 0]),
      edge('e3', [0, 0, 10], [0, 0, 1]),
      edge('e4', [10, 10, 0], [0, 1, 0]),
    ];
    expect(inferLoopDirection(sels)).toBeNull();
  });

  it('accepts 75% consensus (3 of 4 agree)', () => {
    const sels = [
      edge('e1', [0, 5, 0], [0, 1, 0]),
      edge('e2', [10, 5, 0], [0, 1, 0]),
      edge('e3', [0, 5, 10], [0, 1, 0]),
      edge('e4', [10, 5, 5], [0.1, 0.9, 0.1]), // still dominant Y
    ];
    expect(inferLoopDirection(sels)).toEqual([0, 1, 0]);
  });
});

describe('buildEdgeFinderForLoop (no-WASM env)', () => {
  it('returns null when direction cannot be inferred', async () => {
    const sels = [
      edge('e1', [0, 0, 0], [0, 1, 0]),
      edge('e2', [10, 0, 0], [1, 0, 0]),
    ];
    expect(await buildEdgeFinderForLoop(sels)).toBeNull();
  });

  it('returns null in WASM-less env even with a clean axis', async () => {
    const sels = [
      edge('e1', [0, 5, 0], [0, 1, 0]),
      edge('e2', [10, 5, 0], [0, 1, 0]),
      edge('e3', [10, 5, 10], [0, 1, 0]),
      edge('e4', [0, 5, 10], [0, 1, 0]),
    ];
    // No replicad → null, but the inference logic should have succeeded.
    expect(inferLoopDirection(sels)).not.toBeNull();
    expect(await buildEdgeFinderForLoop(sels)).toBeNull();
  });
});
