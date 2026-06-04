/**
 * selectionSurvivesParamChange — the F3 step-1 acceptance test (the "topological
 * naming problem"): a selected edge survives an UPSTREAM PARAMETER (dimension)
 * change, so a fillet/chamfer authored on it re-resolves to the same edge after
 * the part is resized — it does not fall off, and does not jump to a different
 * edge.
 *
 * edgeCorrespondence already proves survival across a TOPOLOGY change (a new
 * feature adding edges). This pins the harder, roadmap-named case: a DIMENSION
 * change, where the stored absolute click point no longer lies on any edge and
 * the bbox-relative remap (remapPointThroughBbox) + signature match must recover
 * the corresponding edge.
 *
 *   Part A — pure (no OCCT): the re-resolution math directly.
 *   Part B — end-to-end (gated, real kernel): the fillet feature actually
 *            re-applies to the resized solid.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { matchEdgeBySignature, type EdgeSig } from '../features/edgeCorrespondence';
import { remapPointThroughBbox } from '../features/topologyEdgeFinder';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';
import { filletFeature } from '../features/fillet';
import { ensureOcctReady, setOcctGlobalMode } from '../features/occtEngine';

type Box = { w: number; h: number; d: number };
type BBox = { min: [number, number, number]; max: [number, number, number] };

const bboxOf = (b: Box): BBox => ({
  min: [-b.w / 2, -b.h / 2, -b.d / 2],
  max: [b.w / 2, b.h / 2, b.d / 2],
});

/** The 12 edge signatures of an origin-centred box. */
function boxEdgeSigs(b: Box): EdgeSig[] {
  const x = b.w / 2, y = b.h / 2, z = b.d / 2;
  const sigs: EdgeSig[] = [];
  // 4 edges along X (vary y,z signs), length w
  for (const sy of [-1, 1]) for (const sz of [-1, 1])
    sigs.push({ mid: [0, sy * y, sz * z], dir: [1, 0, 0], length: b.w });
  // 4 along Y, length h
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    sigs.push({ mid: [sx * x, 0, sz * z], dir: [0, 1, 0], length: b.h });
  // 4 along Z, length d
  for (const sx of [-1, 1]) for (const sy of [-1, 1])
    sigs.push({ mid: [sx * x, sy * y, 0], dir: [0, 0, 1], length: b.d });
  return sigs;
}

describe('F3 step-1 — selection survives an upstream parameter (dimension) change', () => {
  describe('A · re-resolution math (pure, no OCCT)', () => {
    it('re-anchors the SAME top-front X edge after the part widens 40 → 60', () => {
      const before: Box = { w: 40, h: 40, d: 40 };
      const after: Box = { w: 60, h: 40, d: 40 }; // upstream width param changed

      // User clicked the top-front edge running along X (y=+20, z=+20), off-centre.
      const stored: EdgeSelectionInfo = {
        type: 'edge',
        position: [10, 20, 20],
        direction: [1, 0, 0],
        length: 40,
        normal: [0, 1, 0],
        bbox: bboxOf(before),
      };

      // The UI's re-resolution: remap the click point through the bbox change,
      // then match by signature against the resized solid's edges.
      const remapped = remapPointThroughBbox(stored.position, stored.bbox, bboxOf(after));
      const target: EdgeSig = { mid: remapped, dir: stored.direction!, length: stored.length };
      const candidates = boxEdgeSigs(after);
      const idx = matchEdgeBySignature(target, candidates);

      expect(idx).toBeGreaterThanOrEqual(0);
      const matched = candidates[idx]!;
      // It must be the top-front X edge of the WIDER box: dir +X, mid (0,+20,+20),
      // length now 60 — the corresponding edge, not a sibling.
      expect(matched.dir).toEqual([1, 0, 0]);
      expect(matched.mid[1]).toBeCloseTo(20, 5);
      expect(matched.mid[2]).toBeCloseTo(20, 5);
      expect(matched.length).toBeCloseTo(60, 5);
    });

    it('does NOT jump to the opposite (top-back) edge when depth changes', () => {
      const before: Box = { w: 40, h: 40, d: 40 };
      const after: Box = { w: 40, h: 40, d: 80 }; // depth doubled

      const stored: EdgeSelectionInfo = {
        type: 'edge',
        position: [0, 20, 20], // top-front X edge (z = +20)
        direction: [1, 0, 0],
        length: 40,
        normal: [0, 1, 0],
        bbox: bboxOf(before),
      };
      const remapped = remapPointThroughBbox(stored.position, stored.bbox, bboxOf(after));
      const target: EdgeSig = { mid: remapped, dir: stored.direction!, length: stored.length };
      const matched = boxEdgeSigs(after)[matchEdgeBySignature(target, boxEdgeSigs(after))]!;

      // front edge sits at z=+40 in the deeper box; must NOT resolve to z=−40.
      expect(matched.mid[2]).toBeGreaterThan(0);
    });
  });

  describe('B · end-to-end fillet re-applies to the resized solid (gated, real OCCT)', () => {
    const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
    const itMaybe = ENABLED ? it : it.skip;

    function box(w: number): THREE.BufferGeometry {
      const g = new THREE.BoxGeometry(w, 40, 40);
      g.computeVertexNormals();
      return g;
    }
    const sel = (w: number): EdgeSelectionInfo => ({
      type: 'edge',
      position: [w / 4, 20, 20],
      direction: [1, 0, 0],
      length: w,
      normal: [0, 1, 0],
      bbox: { min: [-w / 2, -20, -20], max: [w / 2, 20, 20] },
    });

    itMaybe('fillet authored on a 40-box edge re-applies after width → 60', async () => {
      await ensureOcctReady();
      setOcctGlobalMode(true);
      try {
        const params = { radius: 4, segments: 8, engine: 1 };
        // stored selection captured on the 40-wide part
        const stored = sel(40);

        const before = await filletFeature.applyAsync!(box(40), params, {
          featureId: 'f1', edgeSelections: [stored],
        });
        expect(before.attributes.position.count).toBeGreaterThan(0);

        // upstream width param changes to 60; the SAME stored selection must
        // re-resolve against the rebuilt solid and still fillet.
        const after = await filletFeature.applyAsync!(box(60), params, {
          featureId: 'f1', edgeSelections: [stored],
        });
        expect(after.attributes.position.count).toBeGreaterThan(0);
      } finally {
        setOcctGlobalMode(false);
      }
    }, 60_000);
  });
});
