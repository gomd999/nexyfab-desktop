/**
 * stepRoundtripWasm.feasibility.test.ts — the END-TO-END STEP roundtrip that the
 * pure-math stepRoundtripReport.test.ts only *referenced*. `runStepRoundtripReport`
 * (export → OCCT B-rep → STEP → import → signature diff) was never actually
 * exercised by any test, despite a comment claiming it "lives in the existing
 * RUN_OCCT_FEASIBILITY gated suite". This is that suite.
 *
 * Gated behind RUN_OCCT_FEASIBILITY=1 (loads the 10 MB replicad/occt-import-js
 * WASM); run via `npm run test:occt:feasibility`. Verifies that real shapes
 * survive a STEP roundtrip with their SHAPE intact (volume/surface clean), and
 * pins the importer's intentional re-centring so it can't silently change.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { runStepRoundtripReport } from '../stepRoundtripReport';
import { ensureOcctReady } from '../../features/occtEngine';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const d = ENABLED ? describe : describe.skip;

function lExtrude(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(40, 0); s.lineTo(40, 20); s.lineTo(20, 20);
  s.lineTo(20, 40); s.lineTo(0, 40); s.lineTo(0, 0);
  return new THREE.ExtrudeGeometry(s, { depth: 10, bevelEnabled: false });
}

d('STEP roundtrip (export → OCCT → import) — shape fidelity', () => {
  beforeAll(async () => { await ensureOcctReady(); }, 60_000);

  it.each([
    ['box', () => new THREE.BoxGeometry(20, 30, 40)],
    ['cylinder', () => new THREE.CylinderGeometry(10, 10, 40, 48)],
    ['L-extrude', lExtrude],
  ] as [string, () => THREE.BufferGeometry][])(
    'a %s round-trips clean: importer accepts it and volume/surface are preserved',
    async (_name, make) => {
      const r = await runStepRoundtripReport(make(), 'probe');
      expect(r.importFailed).toBe(false);            // OCCT accepted our export
      expect(r.drift.verdict).toBe('clean');
      expect(r.drift.volumeDriftPct).toBeLessThan(0.5);
      expect(r.drift.surfaceDriftPct).toBeLessThan(0.5);
      expect(r.exportBytes).toBeGreaterThan(0);
    },
    60_000,
  );

  it('preserves the position of an already-origin-centred part (box → ~0 bbox shift)', async () => {
    // BoxGeometry is centred on the origin, so the importer's re-centring is a
    // no-op and the bbox must come back essentially unchanged.
    const r = await runStepRoundtripReport(new THREE.BoxGeometry(20, 30, 40), 'box');
    expect(r.drift.bboxDeltaMax).toBeLessThan(0.5);
  }, 60_000);

  it('re-centres a non-origin part to the origin (documented importer behaviour)', async () => {
    // The L-extrude lives in the +octant (bbox 0..40 / 0..40 / 0..10). importStepFile
    // intentionally translates the merged geometry to centre it on the origin
    // (stepImporter.ts "Center geometry at origin"), so the bbox shifts by half
    // the extent on each axis (max 20mm) while the SHAPE stays clean. This pins
    // that behaviour: relative/assembly layout is preserved, absolute origin is not.
    const r = await runStepRoundtripReport(lExtrude(), 'L');
    expect(r.drift.verdict).toBe('clean');           // shape unchanged…
    expect(r.drift.bboxDeltaMax).toBeGreaterThan(10); // …but position re-centred (~20mm)
  }, 60_000);
});
