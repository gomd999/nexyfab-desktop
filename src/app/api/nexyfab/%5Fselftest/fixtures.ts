/**
 * fixtures.ts — deterministic geometry generator for the ops SELF-TEST route.
 *
 * We do NOT ship third-party CAD. Every fixture is a tiny, self-authored
 * OpenSCAD source rendered to a binary STL by the SAME production render path
 * (`renderScadToStl`) the rest of the app uses — so the bytes we measure come
 * from the exact toolchain present in the deployed container (OpenSCAD binary).
 * On the dev host (no OpenSCAD) the render returns ENOENT and the caller reports
 * an honest error rather than fabricating geometry.
 *
 * Two audiences:
 *   - `plateHole` — the A5 Kirsch geometry (200x120x8 plate, central r=10 hole
 *     through the 8 mm thickness), oriented with its LONG axis along +Z so the
 *     production FEA auto-BC (fix z-min plane, load z-max plane) applies uniaxial
 *     tension across the hole — the setup whose peak/nominal gives Kt~3.
 *   - `box` / `cylinder` / `plateHole` / `lBracket` — a tiny reconstruction fleet
 *     sample (primitives the fleet should mostly land, plus one holed part).
 */
import { renderScadToStl } from '@/lib/openscad-render/renderStl';

export type FixtureName = 'plateHole' | 'box' | 'cylinder' | 'lBracket';

/**
 * A5 Kirsch plate-with-hole. Length (200) along Z, width (120) along Y,
 * thickness (8) along X; the hole (r=10) runs through the thickness (X axis).
 * Under the FEA auto-BC (z-min fixed, z-max -Z load) this is uniaxial tension
 * across the net section (W-2r)*T, so maxStress/nominal recovers the Kt raiser.
 */
const PLATE_HOLE_SCAD = `$fn=64;
difference() {
  cube([8, 120, 200], center=true);
  rotate([0, 90, 0]) cylinder(h=40, r=10, center=true);
}
`;

/** Tiny primitives for the reconstruction fleet sample (deterministic, mm). */
const FIXTURE_SCAD: Record<FixtureName, string> = {
  plateHole: PLATE_HOLE_SCAD,
  box: `cube([20, 30, 10], center=true);\n`,
  cylinder: `$fn=48;\ncylinder(h=30, r=10, center=true);\n`,
  lBracket: `union() {\n  cube([40, 8, 30]);\n  cube([8, 40, 30]);\n}\n`,
};

/** The A5 plate constants (mm, N) - shared by the FEA handler for the Kt nominal. */
export const PLATE_HOLE_A5 = {
  widthMm: 120, // Y
  thicknessMm: 8, // X
  holeRadiusMm: 10,
  lengthMm: 200, // Z (tension axis)
  totalLoadN: 100_000,
  /** Net-section nominal stress sigma = F / ((W - 2r)*T) - the Kirsch denominator. */
  nominalMPa(): number {
    return this.totalLoadN / ((this.widthMm - 2 * this.holeRadiusMm) * this.thicknessMm);
  },
} as const;

/**
 * Render a named fixture to binary-STL bytes via the production OpenSCAD path.
 * Throws a descriptive Error on render failure (e.g. ENOENT on a host without
 * OpenSCAD) so the route reports it honestly instead of running on fake bytes.
 */
export async function renderFixtureStl(name: FixtureName, timeoutMs = 30_000): Promise<Uint8Array> {
  const scad = FIXTURE_SCAD[name];
  if (!scad) throw new Error(`unknown fixture: ${name}`);
  const out = await renderScadToStl({ scadSource: scad, timeoutMs });
  if (!out.ok) throw new Error(`openscad render failed for "${name}": ${out.code} ${out.message}`);
  const b = out.bytes;
  return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
}
