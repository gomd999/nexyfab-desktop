/**
 * Regression test for the built-in shape primitives.
 *
 * Strategy: for every ShapeConfig in the registry, generate the geometry at
 * default parameters, compute a deterministic signature, and compare against
 * the golden JSON checked into the repo. A mismatch fails the test so we
 * notice the behaviour change before shipping.
 *
 * To accept an intentional change, re-run with `UPDATE_GOLDENS=1`:
 *
 *     UPDATE_GOLDENS=1 npx vitest run src/app/\[lang\]/shape-generator/__tests__/shapes.regression.test.ts
 *
 * This is scope A of the geometry test infra — only pure primitives, no CSG
 * and no OCCT. Scope B (feature pipeline) and scope C (round-trip through
 * importers) come later when we have WASM in node sorted out.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { SHAPES } from '../shapes';
import { computeSignature, type GeometrySignature } from './geometrySignature';

const GOLDEN_PATH = join(__dirname, '__goldens__', 'shapes.json');
const UPDATE = process.env.UPDATE_GOLDENS === '1';

type GoldenFile = Record<string, GeometrySignature>;

function loadGoldens(): GoldenFile {
  if (!existsSync(GOLDEN_PATH)) return {};
  try {
    return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile;
  } catch {
    return {};
  }
}

function saveGoldens(data: GoldenFile): void {
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

describe('shape primitive regression', () => {
  const goldens = loadGoldens();
  const updated: GoldenFile = { ...goldens };

  for (const shape of SHAPES) {
    it(`${shape.id} — matches golden signature`, () => {
      // Build with default params.
      const p: Record<string, number> = {};
      for (const sp of shape.params) p[sp.key] = sp.default;

      // formulaFields default to their default string (no user override).
      const formulas: Record<string, string> = {};
      for (const ff of shape.formulaFields ?? []) formulas[ff.key] = ff.default;

      let result;
      try {
        result = shape.generate(p, formulas);
      } catch (err) {
        throw new Error(`${shape.id}.generate() threw: ${(err as Error).message}`);
      }

      expect(result.geometry).toBeDefined();
      expect(result.geometry.attributes.position.count).toBeGreaterThan(0);

      const sig = computeSignature(result.geometry);

      if (UPDATE) {
        updated[shape.id] = sig;
        return;
      }

      const golden = goldens[shape.id];
      if (!golden) {
        throw new Error(
          `No golden for ${shape.id}. Run with UPDATE_GOLDENS=1 to accept the current output.`,
        );
      }

      // Exact match on structural counts + hash. Numerical values get a
      // tiny slack for cross-platform float differences.
      expect(sig.vertexCount, `${shape.id} vertexCount`).toBe(golden.vertexCount);
      expect(sig.triangleCount, `${shape.id} triangleCount`).toBe(golden.triangleCount);
      expect(sig.indexed, `${shape.id} indexed`).toBe(golden.indexed);
      expect(sig.positionHash, `${shape.id} positionHash (geometry drift)`).toBe(golden.positionHash);

      // Numerical metrics: 0.01% tolerance. Anything bigger is a real drift,
      // not float jitter.
      const tol = (g: number) => Math.max(1e-4, Math.abs(g) * 1e-4);
      expect(sig.volume_mm3, `${shape.id} volume`).toBeCloseTo(golden.volume_mm3, 0);
      expect(Math.abs(sig.volume_mm3 - golden.volume_mm3)).toBeLessThanOrEqual(tol(golden.volume_mm3));
      expect(Math.abs(sig.surfaceArea_mm2 - golden.surfaceArea_mm2))
        .toBeLessThanOrEqual(tol(golden.surfaceArea_mm2));

      for (let i = 0; i < 3; i++) {
        expect(Math.abs(sig.bbox.min[i] - golden.bbox.min[i])).toBeLessThanOrEqual(1e-3);
        expect(Math.abs(sig.bbox.max[i] - golden.bbox.max[i])).toBeLessThanOrEqual(1e-3);
      }
    });
  }

  it('writes updated goldens when UPDATE_GOLDENS=1', () => {
    if (UPDATE) {
      saveGoldens(updated);
      // eslint-disable-next-line no-console
      console.log(`[regression] wrote ${Object.keys(updated).length} goldens to ${GOLDEN_PATH}`);
    }
    expect(true).toBe(true);
  });
});
