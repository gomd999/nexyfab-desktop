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

  // §2.4 Fillet / Chamfer (5 fixture) — WASM-gated
  {
    id: 'F11',
    name: 'fillet-cube-1edge-r5',
    build: () => null,
    predictedVolumeMm3: null,
    tolerancePct: 1,
    wasmGated: true,
    deferNote: 'OCCT fillet — gated suite (RUN_OCCT_FEASIBILITY=1)',
  },
  {
    id: 'F12',
    name: 'fillet-cube-allvert-r3',
    build: () => null,
    predictedVolumeMm3: null,
    tolerancePct: 1,
    wasmGated: true,
    deferNote: 'OCCT fillet (12 edges) — gated',
  },
  {
    id: 'F13',
    name: 'chamfer-cube-4topedge',
    build: () => null,
    predictedVolumeMm3: null,
    tolerancePct: 1,
    wasmGated: true,
    deferNote: 'OCCT chamfer — gated',
  },
  {
    id: 'F14',
    name: 'fillet-different-radii',
    build: () => null,
    predictedVolumeMm3: null,
    tolerancePct: 1,
    wasmGated: true,
    deferNote: 'OCCT multi-radius fillet — gated',
  },
  {
    id: 'F15',
    name: 'fillet-on-boolean',
    build: () => null,
    predictedVolumeMm3: null,
    tolerancePct: 1,
    wasmGated: true,
    deferNote: 'OCCT fillet on subtract output — gated',
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
    predictedVolumeMm3: null,
    tolerancePct: 1,
    wasmGated: true,
    deferNote: 'Revolve from sketch — sketch infra required',
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
    predictedVolumeMm3: null,
    tolerancePct: 1,
    wasmGated: true,
    deferNote: 'Circular pattern + mirror via OCCT — gated',
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
