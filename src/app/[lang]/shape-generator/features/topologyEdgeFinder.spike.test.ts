/**
 * Phase 3-c-1 spike test — verifies the EdgeFinder bridge can be
 * constructed and at least returns a non-null object when replicad is
 * available. End-to-end fillet persistence is gated on the OCCT
 * feasibility harness (RUN_OCCT_FEASIBILITY=1) and pipeline wiring
 * that ships in a follow-up PR.
 */
import { describe, it, expect } from 'vitest';
import { buildEdgeFinderFromSelection, buildEdgeFinderFromMultiSelection } from './topologyEdgeFinder';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

describe('topologyEdgeFinder · null-safe contract', () => {
  it('returns null when replicad is not available (no crash)', async () => {
    // In the default vitest env replicad isn't loaded (no WASM init).
    const sel: EdgeSelectionInfo = {
      type: 'edge',
      position: [10, 20, 30],
      length: 50,
      normal: [0, 1, 0],
    };
    const finder = await buildEdgeFinderFromSelection(sel);
    expect(finder).toBeNull();
  });

  it('multi-selection helper returns null (spike: not implemented)', async () => {
    const out = await buildEdgeFinderFromMultiSelection([]);
    expect(out).toBeNull();
  });
});

describeMaybe('topologyEdgeFinder · OCCT feasibility', () => {
  it('builds a finder when replicad is loaded', async () => {
    const sel: EdgeSelectionInfo = {
      type: 'edge',
      position: [5, 5, 0],
      length: 10,
      normal: [0, 0, 1],
    };
    const finder = await buildEdgeFinderFromSelection(sel);
    // We don't assert the inner shape — replicad's EdgeFinder is opaque.
    // The contract is "non-null and usable as a predicate".
    expect(finder).not.toBeNull();
  });
});
