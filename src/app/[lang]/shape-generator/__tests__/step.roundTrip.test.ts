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
import * as fs from 'node:fs';
import * as path from 'node:path';
import { exportToStep, exportToStepAsync } from '../io/stepExporter';
import { importStepFile } from '../io/stepImporter';
import { computeSignature } from './geometrySignature';

const ENABLED = process.env.RUN_OCCT_FEASIBILITY === '1';
const describeMaybe = ENABLED ? describe : describe.skip;

// Wave 1 W1 — when STEP_RT_DUMP_DIR is set, also write each fixture's
// exported STEP text to disk so the 5-viewer manual matrix
// (docs/strategy/step-roundtrip-matrix-2026-w1.md) has its input files.
const DUMP_DIR = process.env.STEP_RT_DUMP_DIR;
if (DUMP_DIR) {
  fs.mkdirSync(DUMP_DIR, { recursive: true });
}
function dumpStep(name: string, text: string): void {
  if (!DUMP_DIR) return;
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  fs.writeFileSync(path.join(DUMP_DIR, `${safe}.step`), text);
}

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

async function roundTrip(
  geometry: THREE.BufferGeometry,
  useBridge = false,
  dumpName?: string,
): Promise<RoundTripDelta> {
  const before = computeSignature(geometry);

  const stepText = useBridge
    ? await exportToStepAsync(geometry, 'roundtrip_part')
    : exportToStep(geometry, 'roundtrip_part');
  if (dumpName) dumpStep(dumpName, stepText);
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

  // ─── 20-Fixture Wave 1 W1 matrix ─────────────────────────────────────────
  //
  // Wave 1 W1 (ADR-002) — exhaustive Route A roundtrip coverage. Each fixture
  // here is the canonical baseline the 5-viewer external matrix
  // (docs/strategy/step-roundtrip-matrix-2026-w1.md) cross-references. The
  // engine path is `exportToStepAsync` (Route A: mesh → OCCT B-rep → STEP).
  //
  // Drift bounds are intentionally per-fixture: tessellation noise scales
  // with curvature density (sphere > cylinder > box). A breach of these
  // bounds is a regression worth investigating, not a "looks close" warning.

  interface FixtureCase {
    name: string;
    /** Build the canonical geometry. Each test isolates its own. */
    build: () => THREE.BufferGeometry;
    /** Volume drift cap in percent (re-tessellation rounds, OCCT merge). */
    maxVolumeDriftPct: number;
    /** Surface area drift cap. */
    maxSurfaceDriftPct: number;
    /** Absolute bbox extent delta cap, in mm. */
    maxBboxDeltaMm: number;
  }

  const FIXTURES: FixtureCase[] = [
    // Flat-faced primitives — tightest bounds (Route A re-tessellation is
    // near-exact for planar surfaces).
    {
      name: 'small box 30×20×15',
      build: () => { const g = new THREE.BoxGeometry(30, 20, 15); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 0.5, maxSurfaceDriftPct: 0.5, maxBboxDeltaMm: 0.1,
    },
    {
      name: 'wedge (tapered box)',
      build: () => {
        // Approximate wedge via a scaled+sheared box would need custom verts;
        // simplest fixture is a long thin box that exercises elongated bbox.
        const g = new THREE.BoxGeometry(120, 8, 30); g.computeVertexNormals(); return g;
      },
      maxVolumeDriftPct: 1, maxSurfaceDriftPct: 1, maxBboxDeltaMm: 0.3,
    },

    // Curved primitives — Route A bridge; tessellation noise is larger.
    {
      name: 'tall cylinder R10 H80',
      build: () => { const g = new THREE.CylinderGeometry(10, 10, 80, 32); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 10, maxSurfaceDriftPct: 10, maxBboxDeltaMm: 2,
    },
    {
      name: 'truncated cone R20→R10 H40',
      build: () => { const g = new THREE.CylinderGeometry(10, 20, 40, 32); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 10, maxSurfaceDriftPct: 10, maxBboxDeltaMm: 2,
    },
    {
      name: 'sphere R30 (low-poly 16 seg)',
      build: () => { const g = new THREE.SphereGeometry(30, 16, 16); g.computeVertexNormals(); return g; },
      // Low-poly sphere has substantial discretization error from a perfect sphere.
      maxVolumeDriftPct: 18, maxSurfaceDriftPct: 18, maxBboxDeltaMm: 3,
    },
    {
      name: 'sphere R30 (hi-poly 48 seg)',
      build: () => { const g = new THREE.SphereGeometry(30, 48, 48); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 8, maxSurfaceDriftPct: 8, maxBboxDeltaMm: 1.5,
    },
    {
      name: 'torus R20 r6 (donut)',
      build: () => { const g = new THREE.TorusGeometry(20, 6, 12, 32); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 12, maxSurfaceDriftPct: 12, maxBboxDeltaMm: 2,
    },

    // Tube / pipe — hollow cylinder; merging tolerance can collapse the wall.
    {
      name: 'tube/pipe R20 r15 H50',
      build: () => {
        // THREE has no tube primitive; approximate by extruding an annulus
        // via lathe-like geometry. For the fixture we use a thin cylinder —
        // the real tube shape ships via shapes/pipe.ts in the live UI.
        const g = new THREE.CylinderGeometry(20, 20, 50, 32); g.computeVertexNormals(); return g;
      },
      maxVolumeDriftPct: 10, maxSurfaceDriftPct: 10, maxBboxDeltaMm: 2,
    },

    // Thin-feature — tessellated re-mesh can collapse thin axes.
    {
      name: 'thin disk R50 H1 (washer-shaped)',
      build: () => { const g = new THREE.CylinderGeometry(50, 50, 1, 32); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 25, maxSurfaceDriftPct: 5, maxBboxDeltaMm: 0.5,
    },
    {
      name: 'very thin slab 100×100×0.5',
      build: () => { const g = new THREE.BoxGeometry(100, 100, 0.5); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 30, maxSurfaceDriftPct: 5, maxBboxDeltaMm: 0.5,
    },

    // Large extent — bbox drift bound stays sub-1mm even at 500mm extent.
    {
      name: 'large box 500×100×100',
      build: () => { const g = new THREE.BoxGeometry(500, 100, 100); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 0.5, maxSurfaceDriftPct: 0.5, maxBboxDeltaMm: 0.5,
    },

    // Small extent — sub-millimeter parts (jewelry / micro-mech).
    {
      name: 'tiny cube 5×5×5',
      build: () => { const g = new THREE.BoxGeometry(5, 5, 5); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 1, maxSurfaceDriftPct: 1, maxBboxDeltaMm: 0.05,
    },
    {
      name: 'tiny cylinder R2 H3',
      build: () => { const g = new THREE.CylinderGeometry(2, 2, 3, 16); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 12, maxSurfaceDriftPct: 12, maxBboxDeltaMm: 0.2,
    },

    // Aspect-ratio extreme — long thin features stress the OCCT merge tolerance.
    {
      name: 'long rod R3 H300',
      build: () => { const g = new THREE.CylinderGeometry(3, 3, 300, 24); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 10, maxSurfaceDriftPct: 10, maxBboxDeltaMm: 1.5,
    },

    // Off-origin geometry — translate to ensure roundtrip doesn't drop the offset.
    // (Importer recenters around origin per the comment above, so we measure
    // bbox extent not position. This fixture still catches "wrong size after
    // re-import" regressions.)
    {
      name: 'box at offset (200,100,50)',
      build: () => {
        const g = new THREE.BoxGeometry(40, 40, 40);
        g.translate(200, 100, 50);
        g.computeVertexNormals();
        return g;
      },
      maxVolumeDriftPct: 0.5, maxSurfaceDriftPct: 0.5, maxBboxDeltaMm: 0.1,
    },

    // Rotated geometry — ensure orientation survives mesh→B-rep→STEP→import.
    {
      name: 'box rotated 45° on Z',
      build: () => {
        const g = new THREE.BoxGeometry(50, 30, 20);
        g.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.PI / 4));
        g.computeVertexNormals();
        return g;
      },
      maxVolumeDriftPct: 1, maxSurfaceDriftPct: 1, maxBboxDeltaMm: 0.3,
    },

    // Non-axis-aligned scale (anisotropic) — tessellation re-mesh under scale.
    {
      name: 'scaled box (3× X)',
      build: () => {
        const g = new THREE.BoxGeometry(30, 30, 30);
        g.applyMatrix4(new THREE.Matrix4().makeScale(3, 1, 1));
        g.computeVertexNormals();
        return g;
      },
      maxVolumeDriftPct: 0.5, maxSurfaceDriftPct: 0.5, maxBboxDeltaMm: 0.2,
    },

    // Dense tessellation — high triangle count exercises OCCT merge / dedupe.
    {
      name: 'dense sphere R20 (96 seg ~18k tris)',
      build: () => { const g = new THREE.SphereGeometry(20, 96, 96); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 5, maxSurfaceDriftPct: 5, maxBboxDeltaMm: 1,
    },

    // Composite via merge (proxy for boolean union) — multiple disjoint solids
    // in one geometry. STEP should preserve all parts (or merge cleanly).
    {
      name: 'two stacked boxes (proxy for union)',
      build: () => {
        const a = new THREE.BoxGeometry(40, 40, 20);
        const b = new THREE.BoxGeometry(20, 20, 20).translate(0, 0, 20);
        // Merge into single non-indexed BufferGeometry — simulates a CSG union output.
        const merged = new THREE.BufferGeometry();
        const aNi = a.toNonIndexed();
        const bNi = b.toNonIndexed();
        const posA = aNi.attributes.position.array as Float32Array;
        const posB = bNi.attributes.position.array as Float32Array;
        const merged_pos = new Float32Array(posA.length + posB.length);
        merged_pos.set(posA, 0);
        merged_pos.set(posB, posA.length);
        merged.setAttribute('position', new THREE.BufferAttribute(merged_pos, 3));
        merged.computeVertexNormals();
        return merged;
      },
      maxVolumeDriftPct: 2, maxSurfaceDriftPct: 5, maxBboxDeltaMm: 0.3,
    },

    // Very high-curvature fillet-like — small radius rounded corner via torus.
    {
      name: 'small torus R5 r1 (fillet-like)',
      build: () => { const g = new THREE.TorusGeometry(5, 1, 12, 24); g.computeVertexNormals(); return g; },
      maxVolumeDriftPct: 15, maxSurfaceDriftPct: 15, maxBboxDeltaMm: 0.5,
    },
  ];

  // Each fixture as its own test so a single regression doesn't poison
  // the rest of the matrix. Timeout per test stays at 90s; cold WASM init
  // happens once per file.
  for (const fx of FIXTURES) {
    it(`Route A roundtrip — ${fx.name}`, async () => {
      const geo = fx.build();
      const delta = await roundTrip(geo, /* useBridge */ true, fx.name);
      console.log(
        `[STEP RT W1] ${fx.name.padEnd(40)}  ` +
        `vol ${delta.volumeDriftPct.toFixed(2)}%  ` +
        `area ${delta.surfaceDriftPct.toFixed(2)}%  ` +
        `bbox Δ ${delta.bboxDeltaMax.toFixed(3)}mm`,
      );
      expect(delta.volumeDriftPct,  `${fx.name}: volume drift`).toBeLessThan(fx.maxVolumeDriftPct);
      expect(delta.surfaceDriftPct, `${fx.name}: surface drift`).toBeLessThan(fx.maxSurfaceDriftPct);
      expect(delta.bboxDeltaMax,    `${fx.name}: bbox delta`).toBeLessThan(fx.maxBboxDeltaMm);
    }, 90_000);
  }
});
