import { describe, it, expect } from 'vitest';
import { intentToScad } from '../intentToScad';
import { runOpenScadCli } from '../runOpenScadCli';

/**
 * Real OpenSCAD CLI compilation check for a curated set of intents.
 *
 * The deterministic emitter's unit tests only verify the *text* it produces.
 * This file goes one step further and actually runs that text through OpenSCAD,
 * proving the SCAD source is valid AND produces a non-empty mesh.
 *
 * Gating: requires OpenSCAD on the host (or `OPENSCAD_USE_DOCKER=1`). When
 * neither is available the test is *skipped*, not failed — local dev on
 * machines without OpenSCAD remains green.
 *
 * BOSL2 shapes need `OPENSCADPATH` pointing at the BOSL2 clone. In Docker the
 * image already provides it; on hosts users set the env var manually.
 */

const TIMEOUT_MS = 60_000;

const HAVE_OPENSCAD =
  Boolean(process.env.OPENSCAD_BIN?.trim()) ||
  process.env.OPENSCAD_USE_DOCKER === '1' ||
  process.env.OPENSCAD_USE_DOCKER === 'true';

const HAVE_BOSL2 =
  HAVE_OPENSCAD && (
    Boolean(process.env.OPENSCADPATH?.trim()) ||
    process.env.OPENSCAD_USE_DOCKER === '1'
  );

interface CompileExpect {
  shapeId: string;
  params: Record<string, number>;
  needsBosl2?: boolean;
  /** Lower bound on STL file size in bytes — guarantees mesh is non-trivial. */
  minBytes?: number;
}

const CASES: CompileExpect[] = [
  // Plain primitives
  { shapeId: 'box',      params: { width: 30, height: 20, depth: 10 } },
  { shapeId: 'cylinder', params: { diameter: 30, height: 50 } },
  { shapeId: 'sphere',   params: { diameter: 30 } },
  { shapeId: 'pipe',     params: { outerDiameter: 30, innerDiameter: 20, length: 50 } },
  // Standard parts (plain SCAD)
  { shapeId: 'hexNut',   params: { acrossFlats: 13, thickness: 8, nominalDiameter: 8 } },
  { shapeId: 'washer',   params: { outerDiameter: 20, innerDiameter: 8, thickness: 1.6 } },
  { shapeId: 'iBeam',    params: { beamHeight: 100, flangeWidth: 60, webThick: 5, flangeThick: 8, length: 200 } },
  { shapeId: 'flange',   params: { outerDiameter: 100, innerDiameter: 30, thickness: 12, pcd: 70, boltCount: 4, boltDiameter: 8 } },
  // Domain shapes (plain SCAD)
  { shapeId: 'enclosure', params: { width: 80, height: 30, depth: 50, wallThickness: 2, lipHeight: 3, lipInset: 1 } },
  { shapeId: 'motorMount', params: { plateSize: 42, thickness: 5, boltCirclePitch: 31, boltDiameter: 3.4, centerBoreDiameter: 22 } },
  // BOSL2 shapes (require library)
  { shapeId: 'gear', needsBosl2: true, params: { teeth: 20, module: 2, thickness: 8 } },
  { shapeId: 'threadedRod', needsBosl2: true, params: { diameter: 8, length: 30, pitch: 1.25 } },
  { shapeId: 'roundedBox', needsBosl2: true, params: { width: 40, height: 30, depth: 20, rounding: 3 } },
];

describe.skipIf(!HAVE_OPENSCAD)('intentToScad → real OpenSCAD CLI', () => {
  for (const c of CASES) {
    const skip = c.needsBosl2 && !HAVE_BOSL2;
    it.skipIf(skip)(`compiles ${c.shapeId} to non-empty STL`, async () => {
      const conv = intentToScad({ shapeId: c.shapeId, params: c.params });
      expect(conv.ok).toBe(true);
      if (!conv.ok) return;

      const result = await runOpenScadCli({
        scadSource: conv.scad,
        format: 'stl',
        timeoutMs: TIMEOUT_MS,
      });

      if (!result.ok) {
        // Surface stderr for debugging when a previously-passing case breaks.
        throw new Error(`OpenSCAD CLI failed for ${c.shapeId}: ${result.code} ${result.message}\n${result.stderr ?? ''}`);
      }

      // Binary STL header is 80 bytes + 4 byte triangle count.
      // ASCII STL starts with "solid". Either way, > 100 bytes is a sane floor.
      expect(result.buffer.length).toBeGreaterThan(c.minBytes ?? 100);
    }, TIMEOUT_MS + 5_000);
  }

  it('feature pipeline (box + hole + fillet) compiles', async () => {
    const conv = intentToScad({
      shapeId: 'box',
      params: { width: 50, height: 50, depth: 20 },
      features: [
        { type: 'hole', params: { diameter: 6 } },
        { type: 'fillet', params: { radius: 1.5 } },
      ],
    });
    expect(conv.ok).toBe(true);
    if (!conv.ok) return;

    const result = await runOpenScadCli({
      scadSource: conv.scad,
      format: 'stl',
      timeoutMs: TIMEOUT_MS,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`compile failed: ${result.message}\n${result.stderr ?? ''}`);
    expect(result.buffer.length).toBeGreaterThan(100);
  }, TIMEOUT_MS + 5_000);
});
