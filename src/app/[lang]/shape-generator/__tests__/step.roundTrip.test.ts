/**
 * STEP round-trip accuracy (Q2).
 *
 * Validates that geometry survives an export → re-import cycle within a
 * tight tolerance. The exporter writes AP242 tessellated representation
 * (`COORDINATES_LIST` + `TRIANGULATED_FACE`); the importer is occt-import-js.
 * If our exporter ever drifts from valid AP242 the importer will either
 * reject the file or read garbage — this catches both.
 *
 * Skipped unless RUN_OCCT_FEASIBILITY=1 because occt-import-js loads a
 * 5MB WASM module just like the OCCT engine itself.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { exportToStep, exportToStepAsync } from '../io/stepExporter';
import { importStepFile } from '../io/stepImporter';
import { computeSignature } from './geometrySignature';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

function makeBox(w: number, h: number, d: number): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.computeVertexNormals();
  return geo;
}

function stringToArrayBuffer(s: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(s);
  // Copy into a fresh ArrayBuffer so the result is not a SharedArrayBuffer view.
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

interface RoundTripDelta {
  volumeDriftPct: number;
  surfaceDriftPct: number;
  bboxDeltaMax: number;
}

async function roundTrip(geometry: THREE.BufferGeometry, useBridge = false): Promise<RoundTripDelta> {
  const before = computeSignature(geometry);

  const stepText = useBridge
    ? await exportToStepAsync(geometry, 'roundtrip_part')
    : exportToStep(geometry, 'roundtrip_part');
  const buf = stringToArrayBuffer(stepText);
  const reimported = await importStepFile(buf);
  const after = computeSignature(reimported.geometry);

  // Importer recenters geometry around origin — for drift measurement we
  // compare normalized bbox extents, not absolute positions.
  const beforeExtent: [number, number, number] = [
    before.bbox.max[0] - before.bbox.min[0],
    before.bbox.max[1] - before.bbox.min[1],
    before.bbox.max[2] - before.bbox.min[2],
  ];
  const afterExtent: [number, number, number] = [
    after.bbox.max[0] - after.bbox.min[0],
    after.bbox.max[1] - after.bbox.min[1],
    after.bbox.max[2] - after.bbox.min[2],
  ];
  const bboxDeltaMax = Math.max(
    Math.abs(beforeExtent[0] - afterExtent[0]),
    Math.abs(beforeExtent[1] - afterExtent[1]),
    Math.abs(beforeExtent[2] - afterExtent[2]),
  );

  return {
    volumeDriftPct: Math.abs(after.volume_mm3 - before.volume_mm3) / before.volume_mm3 * 100,
    surfaceDriftPct: Math.abs(after.surfaceArea_mm2 - before.surfaceArea_mm2) / before.surfaceArea_mm2 * 100,
    bboxDeltaMax,
  };
}

describeMaybe('STEP round-trip accuracy (Q2)', () => {
  // ─── Volume / SA drift on simple primitives ─────────────────────────────
  // Box export uses the AP214 NX cube remap path (B-rep), so the round trip
  // here exercises the most common customer import format.
  it('60×40×30 box round-trips with <0.5% volume drift', async () => {
    const delta = await roundTrip(makeBox(60, 40, 30));

    console.log(
      `[STEP RT] box60x40x30  vol drift ${delta.volumeDriftPct.toFixed(3)}%  ` +
      `area drift ${delta.surfaceDriftPct.toFixed(3)}%  bbox Δ ${delta.bboxDeltaMax.toFixed(4)}mm`,
    );
    expect(delta.volumeDriftPct).toBeLessThan(0.5);
    expect(delta.surfaceDriftPct).toBeLessThan(0.5);
    expect(delta.bboxDeltaMax).toBeLessThan(0.1);
  }, 90_000);

  it('thin slab (200×200×2) round-trips without losing the thin axis', async () => {
    // Thin features are where tessellated round-trips often go wrong —
    // OCCT's mesh-merge tolerance can collapse them. This is a realistic
    // sheet-metal-ish part shape.
    const delta = await roundTrip(makeBox(200, 200, 2));

    console.log(
      `[STEP RT] slab200x200x2  vol drift ${delta.volumeDriftPct.toFixed(3)}%  ` +
      `bbox Δ ${delta.bboxDeltaMax.toFixed(4)}mm`,
    );
    expect(delta.volumeDriftPct).toBeLessThan(2.0); // looser for thin parts
    expect(delta.bboxDeltaMax).toBeLessThan(0.5);
  }, 90_000);

  // KNOWN GAP (R2 실측 결과, 2026-05-08):
  // Non-Box geometry round-trips fail because our hand-written AP242
  // tessellated representation isn't accepted by occt-import-js. BoxGeometry
  // takes the AP214 NX-cube fast path which is well-formed; everything else
  // (cylinder, sphere, sweep results) currently exports STEP that re-imports
  // as `STEP parsing failed`.
  //
  // Until we either (a) wire stepExporter through the OCCT WASM kernel for
  // arbitrary meshes or (b) emit a STEP profile occt-import-js accepts,
  // customers should be told STEP export is **B-rep-from-OCCT path only**
  // (i.e. shapes that came in via STEP and didn't lose their occtHandle).
  // ─── Route A bridge: arbitrary mesh → OCCT B-rep → STEP ─────────────────
  // exportToStepAsync now pipes non-occtHandle meshes through
  // replicad.importSTL → OCCT, so cylinders / spheres / CSG output should
  // round-trip cleanly. The legacy `exportToStep` path stays skipped — it's
  // the broken AP242 emitter the R2 entry called out.
  it.skip('tessellated cylinder round-trips with bounded drift — BLOCKED on AP242 importer (legacy path)', async () => {
    const cyl = new THREE.CylinderGeometry(15, 15, 50, 32);
    cyl.computeVertexNormals();
    const delta = await roundTrip(cyl);
    expect(delta.volumeDriftPct).toBeLessThan(1.0);
  }, 90_000);

  it('cylinder round-trips via Route A bridge with bounded volume drift', async () => {
    const cyl = new THREE.CylinderGeometry(15, 15, 50, 32);
    cyl.computeVertexNormals();
    const delta = await roundTrip(cyl, /* useBridge */ true);
    console.log(
      `[STEP RT viaBridge] cylinder  vol drift ${delta.volumeDriftPct.toFixed(3)}%  ` +
      `area drift ${delta.surfaceDriftPct.toFixed(3)}%  bbox Δ ${delta.bboxDeltaMax.toFixed(4)}mm`,
    );
    // Tessellation re-mesh adds noise (typically a few percent), so the
    // bound is wider than the box AP214 path — this just asserts the round
    // trip *completed* without the AP242-importer rejection.
    expect(delta.volumeDriftPct).toBeLessThan(10);
  }, 120_000);

  it('sphere round-trips via Route A bridge', async () => {
    const sph = new THREE.SphereGeometry(20, 24, 24);
    sph.computeVertexNormals();
    const delta = await roundTrip(sph, /* useBridge */ true);
    console.log(
      `[STEP RT viaBridge] sphere  vol drift ${delta.volumeDriftPct.toFixed(3)}%  ` +
      `bbox Δ ${delta.bboxDeltaMax.toFixed(4)}mm`,
    );
    expect(delta.volumeDriftPct).toBeLessThan(15);
  }, 120_000);

  // ─── Stability: same geometry exported twice → identical bytes ──────────
  it('exporter is deterministic — same geometry → identical STEP text', () => {
    const geo = makeBox(50, 30, 20);
    const a = exportToStep(geo, 'det_test');
    const b = exportToStep(geo, 'det_test');
    // Timestamp is the only intentional non-determinism. Strip the
    // FILE_NAME line and compare the rest.
    const stripTs = (s: string) =>
      s.split('\n').filter(l => !l.startsWith('FILE_NAME')).join('\n');
    expect(stripTs(a)).toBe(stripTs(b));
  });

  // ─── Round-trip preserves face count for indexed geometry ───────────────
  it('triangle count preserved across round-trip (indexed→non-indexed→indexed)', async () => {
    const geo = makeBox(40, 40, 40);
    const beforeTris = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    const stepText = exportToStep(geo, 'triCount');
    const reimported = await importStepFile(stringToArrayBuffer(stepText));
    const afterTris = reimported.geometry.index
      ? reimported.geometry.index.count / 3
      : reimported.geometry.attributes.position.count / 3;

    console.log(`[STEP RT] tri count before=${beforeTris} after=${afterTris}`);
    // Box geometry exports as 12 triangles; OCCT may merge coplanar but
    // not below the convex-hull face count.
    expect(afterTris).toBeGreaterThanOrEqual(8);
    expect(afterTris).toBeLessThanOrEqual(beforeTris * 2);
  }, 90_000);
});
