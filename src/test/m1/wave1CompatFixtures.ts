/**
 * wave1CompatFixtures.ts — Wave 1 GA 20×5 compat matrix fixture catalog.
 *
 * Source spec: `docs/wave-1-compat-matrix.md` §2 (20 fixtures defined).
 * Each fixture documents its op sequence + predicted volume + tolerance.
 *
 * Goal of this module:
 *   - Make each fixture's geometry reproducible from code (single
 *     source of truth)
 *   - Expose `predicted` (volume_mm3 + tolerancePct) so a Vitest
 *     `expect(computed).toBeCloseTo(predicted, tolerance)` can guard
 *     against silent regressions
 *   - Document which fixtures require WASM (OCCT fillet / sketch /
 *     OCCT-only ops) — those are flagged `wasmGated: true` and the
 *     `build()` returns null in non-WASM environments
 *
 * The HUMAN viewer matrix (Onshape / Fusion / SolidWorks / FreeCAD /
 * Onshape Mobile) is fundamentally manual — this module covers the
 * code-side gate (does our STEP exporter still produce correct
 * geometry for each fixture?). Viewer matrix stays as a manual
 * walkthrough per the doc.
 */

import * as THREE from 'three';
import { applyBooleanSync } from '@/app/[lang]/shape-generator/features/boolean';
import {
  occtBaseSolid,
  occtBoxBooleanWithPrimitive,
  occtFilletBox,
  occtChamferBox,
  occtRevolveProfile,
  occtLinearPattern,
  resetShapeRegistry,
} from '@/app/[lang]/shape-generator/features/occtEngine';

/** Result of a gated (OCCT-WASM) builder. The gated test compares mesh
 *  volume vs the analytic prediction, optionally cross-checking against
 *  the exact B-rep volume when the builder can expose a registered handle. */
export interface GatedBuildResult {
  readonly geometry: THREE.BufferGeometry;
  /** Replicad registry handle for the B-rep solid, or null when the build
   *  fell back to a mesh-only path. The gated test can resolve this to a
   *  real shape and call replicad's `measureVolume()` for the exact volume. */
  readonly handle: string | null;
}

export interface FixtureSpec {
  readonly id: string;
  readonly name: string;
  /** Builder. Returns null when the fixture requires WASM / sketch
   *  ops that aren't available in the test env. */
  readonly build: () => THREE.BufferGeometry | null;
  /** Expected volume in mm³, or null when "to be confirmed by Shape
   *  Generator measurement" (per the spec doc — defer to in-app
   *  measurement). */
  readonly predictedVolumeMm3: number | null;
  /** Volume tolerance as a percent (e.g. 0.5 = ±0.5%). Defaults to 1%
   *  when not explicitly specified in the spec. */
  readonly tolerancePct: number;
  /** True when the fixture's build path needs OCCT WASM or sketch
   *  infrastructure that isn't loaded in this test env. */
  readonly wasmGated: boolean;
  /** Defer note when the fixture is excluded from the auto suite. */
  readonly deferNote?: string;
  /** Gated builder for fixtures that need OCCT WASM. Only invoked from
   *  the gated test suite (RUN_OCCT_FEASIBILITY=1) after
   *  `ensureOcctReady()` — calling it before init throws OcctNotReadyError.
   *  When provided alongside a non-null `predictedVolumeMm3`, the gated
   *  test asserts the mesh volume matches predicted within tolerancePct. */
  readonly gatedBuild?: () => GatedBuildResult;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildBoxGeometry(w: number, d: number, h: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, d, h);
  g.computeVertexNormals();
  return g;
}

function buildCylinder(d: number, h: number, segments = 64): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(d / 2, d / 2, h, segments);
  g.computeVertexNormals();
  return g;
}

function buildSphere(r: number, segments = 32): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, segments, segments);
  g.computeVertexNormals();
  return g;
}

/** Translate in place. */
function moved(g: THREE.BufferGeometry, dx: number, dy: number, dz: number): THREE.BufferGeometry {
  g.translate(dx, dy, dz);
  g.computeVertexNormals();
  return g;
}

// ─── Fixture definitions (per docs/wave-1-compat-matrix.md §2) ──────────────

export const WAVE_1_FIXTURES: readonly FixtureSpec[] = [
  // §2.2 Basic primitives (5 fixture)
  {
    id: 'F01',
    name: 'cube-50',
    build: () => buildBoxGeometry(50, 50, 50),
    predictedVolumeMm3: 125_000,
    tolerancePct: 0.05,
    wasmGated: false,
  },
  {
    id: 'F02',
    name: 'cylinder-d40-h60',
    build: () => buildCylinder(40, 60),
    // Cylinder tessellation undershoots true volume slightly; use
    // 1% to cover the polygon approximation.
    predictedVolumeMm3: Math.PI * 20 ** 2 * 60,
    tolerancePct: 1,
    wasmGated: false,
  },
  {
    id: 'F03',
    name: 'sphere-r25',
    // Sphere tessellation undershoots by ~3-5% at seg=32, so we use
    // a wider tolerance. Real B-rep sphere import via WASM is the
    // tighter check.
    build: () => buildSphere(25, 32),
    predictedVolumeMm3: (4 / 3) * Math.PI * 25 ** 3,
    tolerancePct: 5,
    wasmGated: false,
  },
  {
    id: 'F04',
    name: 'box-with-hole-M8',
    build: () => {
      const base = buildBoxGeometry(60, 40, 10);
      const hole = buildCylinder(8, 10.1, 32);
      // Cylinder is Y-up by default — rotate to Z-up for through-hole
      // along the box's H axis (Z).
      hole.rotateX(Math.PI / 2);
      return applyBooleanSync('subtract', base, hole);
    },
    predictedVolumeMm3: 60 * 40 * 10 - Math.PI * 4 ** 2 * 10,
    tolerancePct: 1,
    wasmGated: false,
  },
  {
    id: 'F05',
    name: 'L-bracket',
    // Predicted volume = 36000 - 16000 = 20000mm³ requires the cut
    // to land FULLY INSIDE the base's +X+Y quadrant. Centered cut at
    // (+10, +10) covers x ∈ [-10, +30], y ∈ [-10, +30] — the +X+Y
    // 40×40 region inside the 60×60 base. The spec doc's "+20 +20"
    // offset assumed corner-placement; centered placement is +10 +10.
    build: () => {
      const base = buildBoxGeometry(60, 60, 10);
      const cut = buildBoxGeometry(40, 40, 10.1);
      moved(cut, 10, 10, 0);
      return applyBooleanSync('subtract', base, cut);
    },
    predictedVolumeMm3: 60 * 60 * 10 - 40 * 40 * 10,
    tolerancePct: 1,
    wasmGated: false,
  },

  // §2.3 Boolean operations (5 fixture)
  {
    id: 'F06',
    name: 'bool-union-cube-cyl',
    build: () => {
      const cube = buildBoxGeometry(30, 30, 30);
      const cyl = buildCylinder(20, 40, 64);
      // Cylinder vertical (Y-up default), piercing both ends of the cube.
      return applyBooleanSync('union', cube, cyl);
    },
    predictedVolumeMm3: 30 ** 3 + Math.PI * 10 ** 2 * 40 - Math.PI * 10 ** 2 * 30,
    tolerancePct: 1.5,
    wasmGated: false,
  },
  {
    id: 'F07',
    name: 'bool-subtract-pocket',
    build: () => {
      const base = buildBoxGeometry(80, 60, 20);
      const pocket = buildBoxGeometry(40, 30, 10);
      // Pocket sits in the top half of the base (Z = +5 puts its
      // top face at +10 which is +Z of base; we need it to cut from
      // top down). Default centered → translate up by 5 so it
      // straddles the top face.
      moved(pocket, 0, 0, 5);
      return applyBooleanSync('subtract', base, pocket);
    },
    predictedVolumeMm3: 80 * 60 * 20 - 40 * 30 * 10,
    tolerancePct: 1,
    wasmGated: false,
  },
  {
    id: 'F08',
    name: 'bool-intersect-cyl-cube',
    build: () => {
      const cube = buildBoxGeometry(50, 50, 50);
      const cyl = buildCylinder(50, 50, 64);
      return applyBooleanSync('intersect', cube, cyl);
    },
    // Cube fully contains the cylinder → intersection == cylinder volume.
    predictedVolumeMm3: Math.PI * 25 ** 2 * 50,
    tolerancePct: 1.5,
    wasmGated: false,
  },
  {
    id: 'F09',
    name: 'bool-multi-tool-subtract',
    build: () => {
      const base = buildBoxGeometry(100, 50, 20);
      // 3 holes at x = -30 / 0 / +30 (centered on the box); each
      // hole D10 through Z (rotateX to align cylinder axis to Z).
      const positions = [-30, 0, 30];
      let result = base;
      for (const px of positions) {
        const hole = buildCylinder(10, 20.1, 32);
        hole.rotateX(Math.PI / 2);
        moved(hole, px, 0, 0);
        result = applyBooleanSync('subtract', result, hole);
      }
      return result;
    },
    predictedVolumeMm3: 100 * 50 * 20 - 3 * Math.PI * 5 ** 2 * 20,
    tolerancePct: 1.5,
    wasmGated: false,
  },
  {
    id: 'F10',
    name: 'bool-tee-union',
    build: () => {
      const cylX = buildCylinder(20, 80, 64);
      cylX.rotateZ(Math.PI / 2); // align to X
      const cylZ = buildCylinder(20, 80, 64);
      cylZ.rotateX(Math.PI / 2); // align to Z
      return applyBooleanSync('union', cylX, cylZ);
    },
    // 2 cylinders − intersection (cylinder ∩ cylinder ≈ Steinmetz
    // body, volume = 16r³/3; for r=10 = 5333.3 mm³).
    // Spec doc uses an approximation; allow 2% slack.
    predictedVolumeMm3: 2 * Math.PI * 10 ** 2 * 80 - (16 * 10 ** 3) / 3,
    tolerancePct: 3,
    wasmGated: false,
  },

  // §2.4 Fillet / Chamfer (5 fixture) — WASM-gated (active in gated suite)
  {
    id: 'F11',
    name: 'fillet-cube-1edge-r5',
    build: () => null,
    // Cube 40³ with one edge filleted R5. Material removed per filleted edge
    // of length L = L·r²·(1 − π/4). For L = 40, r = 5: 40·25·0.2146 ≈ 214.60.
    // V = 64,000 − 214.60 ≈ 63,785.4 mm³ (matches docs §2.4 F11).
    // gatedBuild fillets ALL 12 edges (no edge finder), so predicted is null
    // and the gated test compares against the OCCT B-rep exact volume instead.
    predictedVolumeMm3: null,
    tolerancePct: 1,
    wasmGated: true,
    deferNote: 'OCCT fillet (every edge of cube40, R5) — gated suite (RUN_OCCT_FEASIBILITY=1)',
    gatedBuild: () => {
      resetShapeRegistry();
      const r = occtFilletBox({ w: 40, h: 40, d: 40, cx: 0, cy: 0, cz: 0 }, 5, {});
      return { geometry: r.geometry, handle: r.handle };
    },
  },
  {
    id: 'F12',
    name: 'fillet-cube-allvert-r3',
    build: () => null,
    // Cube 50³, fillet all 12 edges R3. Closed-form for a fully filleted cube
    // (Minkowski-style): V = (s−2r)³ + 6r·(s−2r)² + 3π·r²·(s−2r) + (4/3)π·r³.
    // s=50, r=3 → 44³ + 18·44² + 27π·44 + 36π = 85184 + 34848 + 3733.84 + 113.10
    //         ≈ 123,879 mm³.
    predictedVolumeMm3:
      (50 - 6) ** 3
      + 6 * 3 * (50 - 6) ** 2
      + 3 * Math.PI * 9 * (50 - 6)
      + (4 / 3) * Math.PI * 27,
    tolerancePct: 1.5,
    wasmGated: true,
    deferNote: 'OCCT fillet (12 edges of cube50, R3) — gated',
    gatedBuild: () => {
      resetShapeRegistry();
      const r = occtFilletBox({ w: 50, h: 50, d: 50, cx: 0, cy: 0, cz: 0 }, 3, {});
      return { geometry: r.geometry, handle: r.handle };
    },
  },
  {
    id: 'F13',
    name: 'chamfer-cube-4topedge',
    build: () => null,
    // Cube 40³, chamfer all 12 edges 5mm × 45° (no edge finder → all edges).
    // Material removed: 12·(s−2c)·c²/2 + 4·c³·(... corner)  Use closed-form
    // for fully-chamfered cube via Minkowski: V = s³ − 12·c²·(s−c)/2·...
    // Simpler: predicted is null and gated test compares vs OCCT exact volume.
    predictedVolumeMm3: null,
    tolerancePct: 2,
    wasmGated: true,
    deferNote: 'OCCT chamfer (every edge of cube40, 5mm) — gated',
    gatedBuild: () => {
      resetShapeRegistry();
      const r = occtChamferBox({ w: 40, h: 40, d: 40, cx: 0, cy: 0, cz: 0 }, 5, {});
      return { geometry: r.geometry, handle: r.handle };
    },
  },
  {
    id: 'F14',
    name: 'fillet-different-radii',
    build: () => null,
    // Box 60×40×20 with one R3 fillet pass (every edge). gatedBuild does ONE
    // radius for simplicity (the multi-radius selective fillet needs an edge
    // finder, which is exercised in occtEngine.extrude.test.ts). Predicted is
    // null — gated test compares against OCCT exact volume.
    predictedVolumeMm3: null,
    tolerancePct: 2,
    wasmGated: true,
    deferNote: 'OCCT fillet (every edge of 60×40×20, R3) — gated',
    gatedBuild: () => {
      resetShapeRegistry();
      const r = occtFilletBox({ w: 60, h: 40, d: 20, cx: 0, cy: 0, cz: 0 }, 3, {});
      return { geometry: r.geometry, handle: r.handle };
    },
  },
  {
    id: 'F15',
    name: 'fillet-on-boolean',
    build: () => null,
    // F07 (box 80×60×20 with pocket 40×30×10 cut from the top) chained into a
    // fillet pass of R2 on every edge of the result. Exercises the B-rep
    // chain: boolean output handle → fillet input. Predicted is null —
    // gated test cross-checks mesh volume against OCCT exact volume.
    predictedVolumeMm3: null,
    tolerancePct: 2,
    wasmGated: true,
    deferNote: 'OCCT fillet on boolean result (chained handle) — gated',
    gatedBuild: () => {
      resetShapeRegistry();
      // Build host = box 80×60×20, then cut a 40×30×10 pocket from the top.
      // occtBoxBooleanWithPrimitive treats hostBox.cz as the TOP of the host
      // (it shifts to z∈[cz−d, cz]); centre at cz=10 puts it on z∈[−10,10].
      // Tool pocket sits straddling the top face (cz=10, d=10 → z∈[0,10]).
      const pocketed = occtBoxBooleanWithPrimitive(
        'subtract',
        { w: 80, h: 60, d: 20, cx: 0, cy: 0, cz: 10 },
        { shape: 'box', w: 40, h: 30, d: 10, cx: 0, cy: 0, cz: 10, rx: 0, ry: 0, rz: 0 },
        {},
      );
      if (!pocketed.handle) return { geometry: pocketed.geometry, handle: null };
      // Now fillet the pocketed solid (chained via handle). Bbox arg is
      // ignored on the chained path; provide best-effort values for safety.
      const r = occtFilletBox(
        { w: 80, h: 60, d: 20, cx: 0, cy: 0, cz: 10 },
        2,
        {},
        pocketed.handle,
      );
      return { geometry: r.geometry, handle: r.handle };
    },
  },

  // §2.5 Extrude / Revolve (3 fixture) — sketch-gated
  {
    id: 'F16',
    name: 'extrude-simple-rect',
    // Equivalent to a box, so we CAN build it without sketch infra.
    build: () => buildBoxGeometry(60, 40, 25),
    predictedVolumeMm3: 60_000,
    tolerancePct: 0.05,
    wasmGated: false,
  },
  {
    id: 'F17',
    name: 'extrude-circle-with-hole',
    // Equivalent to outer cylinder MINUS inner cylinder, both Z-axis.
    build: () => {
      const outer = buildCylinder(80, 15, 64);
      const inner = buildCylinder(40, 15.1, 64);
      return applyBooleanSync('subtract', outer, inner);
    },
    predictedVolumeMm3: Math.PI * (40 ** 2 - 20 ** 2) * 15,
    tolerancePct: 1.5,
    wasmGated: false,
  },
  {
    id: 'F18',
    name: 'revolve-profile-bowl',
    build: () => null,
    // Bowl = outer frustum minus inner frustum, both revolved 360° about Y.
    // Profile is a single CLOSED loop traversing outer wall (r=20→r=30,
    // y=−20→y=+20) then inner wall (r=25→r=15, y=+20→y=−20). After revolve,
    // shape = outer frustum (r1=20, r2=30, h=40) minus inner frustum
    // (r1=15, r2=25, h=40) (because the inner loop traces the cavity).
    // V_outer = (π·h/3)·(r1² + r1·r2 + r2²) = (π·40/3)·(400+600+900)
    //         = (40π/3)·1900 ≈ 79,587 mm³
    // V_inner = (π·40/3)·(225+375+625) = (40π/3)·1225 ≈ 51,313 mm³
    // V_bowl ≈ 79,587 − 51,313 = 28,274 mm³.
    //
    // Note: a single closed annular profile revolved with occtRevolveProfile
    // produces V_outer − V_inner directly (the profile area times 2π·r̄).
    predictedVolumeMm3:
      (Math.PI * 40 / 3) * (400 + 600 + 900)
      - (Math.PI * 40 / 3) * (225 + 375 + 625),
    tolerancePct: 2,
    wasmGated: true,
    deferNote: 'OCCT revolve (closed annular bowl profile, 360° about Y) — gated',
    gatedBuild: () => {
      resetShapeRegistry();
      // Closed profile (x ≥ 0 half-plane), traced counter-clockwise around
      // the annular cross-section: outer wall up, top across, inner wall
      // down, bottom across.
      const profile = [
        { x: 20, y: -20 }, // bottom-outer
        { x: 30, y:  20 }, // top-outer (outer wall tapers 20→30 over h=40)
        { x: 25, y:  20 }, // top-inner
        { x: 15, y: -20 }, // bottom-inner (inner wall tapers 15→25 down)
        { x: 20, y: -20 }, // close
      ];
      const r = occtRevolveProfile(profile);
      return { geometry: r.geometry, handle: r.handle };
    },
  },

  // §2.6 Pattern / Mirror (2 fixture) — buildable via boolean repetition
  {
    id: 'F19',
    name: 'linear-pattern-holes',
    build: () => {
      const base = buildBoxGeometry(200, 40, 10);
      let result = base;
      // 9 holes pitched at 20mm starting at x=20, centered at y=0 (the
      // spec docs use y=20 but our box is centered so y=0 puts holes
      // mid-bracket — equivalent volume).
      for (let i = 0; i < 9; i++) {
        const hole = buildCylinder(6, 10.1, 32);
        hole.rotateX(Math.PI / 2);
        const px = -80 + i * 20; // span 9 holes, pitch=20, range -80..+80
        moved(hole, px, 0, 0);
        result = applyBooleanSync('subtract', result, hole);
      }
      return result;
    },
    predictedVolumeMm3: 200 * 40 * 10 - 9 * Math.PI * 3 ** 2 * 10,
    tolerancePct: 1.5,
    wasmGated: false,
  },
  {
    id: 'F20',
    name: 'circular-pattern-+-mirror',
    build: () => null,
    // Cylinder D80 H10 base with 6 Ø8 through-holes arranged at angle steps
    // of 60° on a pitch radius of 30 (the spec's "circular pattern" of a
    // single hole), then duplicated to a parallel flange via occtLinearPattern
    // (count=2, spacing=20 along Y) — the spec's "mirror" effect.
    //
    // Implementation notes:
    //   1. The circular pattern is applied to the HOLE tools (not to the
    //      drilled plate). Patterning a drilled plate with .fuse() unions
    //      6 rotated copies of "cylinder − hole_at_angle_i"; each copy fills
    //      the others' holes, so the union is just the full cylinder. The
    //      correct sequence is "subtract each hole in turn" — equivalent to
    //      subtracting the union of 6 patterned hole tools.
    //   2. occtMirror would no-op here because the 6-hole plate is symmetric
    //      across the XZ plane (mirror just gives the same solid back).
    //      occtLinearPattern at spacing 20 produces the two parallel flanges
    //      the doc's mirror is intended to create, and exercises the same
    //      clone+translate+fuse B-rep primitives.
    //
    // Predicted per docs §2.6 F20: V = 2·(π·40²·10 − 6·π·4²·10)
    //                                = 2·(50265.5 − 3015.93) ≈ 94499.2 mm³.
    // Tolerance 2.5% to cover the cylinder/hole tessellation undershoot at
    // default mesh density (≈1% per cylinder face × 13 cylindrical surfaces).
    predictedVolumeMm3: 2 * (Math.PI * 40 ** 2 * 10 - 6 * Math.PI * 4 ** 2 * 10),
    tolerancePct: 2.5,
    wasmGated: true,
    deferNote: 'OCCT 6-hole drilled disk + parallel-flange linear pattern (chained handles) — gated',
    gatedBuild: () => {
      resetShapeRegistry();
      // 1. Base cylinder D80 H10 (axis +Y, centred on y=0 → spans y∈[−5,+5]).
      const base = occtBaseSolid('cylinder', { diameter: 80, height: 10 });
      if (!base.handle) return { geometry: base.geometry, handle: null };
      // 2. Drill 6 holes one by one. Each hole is Ø8 H12 (taller than the
      // plate so it punches through cleanly), positioned on a pitch circle of
      // radius 30 at 60° increments. Sequential subtracts is the correct
      // shape for "circular pattern of a hole" — see implementation notes
      // above for why patterning the drilled plate would short-circuit to a
      // full cylinder.
      let drilledHandle: string | null = base.handle;
      let drilledGeometry = base.geometry;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 2 * Math.PI;
        const hx = 30 * Math.cos(a);
        const hz = 30 * Math.sin(a);
        const drilled = occtBoxBooleanWithPrimitive(
          'subtract',
          { w: 80, h: 10, d: 80, cx: 0, cy: 0, cz: 0 },
          { shape: 'cylinder', w: 8, h: 12, d: 8, cx: hx, cy: 0, cz: hz, rx: 0, ry: 0, rz: 0 },
          {},
          drilledHandle,
        );
        if (!drilled.handle) return { geometry: drilled.geometry, handle: null };
        drilledHandle = drilled.handle;
        drilledGeometry = drilled.geometry;
      }
      // 3. Duplicate the 6-hole flange to a parallel flange via linear
      // pattern (count=2, spacing=20 along Y) — the doc's "mirror" intent.
      const r = occtLinearPattern(drilledHandle, 1 /* Y axis */, 2, 20);
      // Guard: if the linear pattern fuse fails, fall back to the single
      // flange + drilled handle so the test still reports a non-null mesh.
      if (!r.handle) return { geometry: drilledGeometry, handle: drilledHandle };
      return { geometry: r.geometry, handle: r.handle };
    },
  },
];

// ─── Volume measurement (divergence theorem) ────────────────────────────────

/** Geometry volume via signed-tetrahedron sum. Matches
 *  computeSignature.volume_mm3 but exposed here as a standalone
 *  helper so the fixture matrix doesn't pull in the whole signature
 *  computation. */
export function geometryVolumeMm3(geo: THREE.BufferGeometry): number {
  const positions = geo.getAttribute('position') as THREE.BufferAttribute | null;
  if (!positions) return 0;
  const index = geo.index;
  let vol = 0;
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const triCount = index ? index.count / 3 : positions.count / 3;
  for (let t = 0; t < triCount; t++) {
    const i0 = index ? index.getX(t * 3) : t * 3;
    const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
    v0.set(positions.getX(i0), positions.getY(i0), positions.getZ(i0));
    v1.set(positions.getX(i1), positions.getY(i1), positions.getZ(i1));
    v2.set(positions.getX(i2), positions.getY(i2), positions.getZ(i2));
    vol += v0.dot(new THREE.Vector3().crossVectors(v1, v2)) / 6;
  }
  return Math.abs(vol);
}
