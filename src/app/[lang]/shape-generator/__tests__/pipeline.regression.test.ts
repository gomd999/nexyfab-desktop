/**
 * Regression test for the feature pipeline (scope B).
 *
 * Scope A (shapes.regression.test.ts) covered pure Three.js primitives. This
 * file exercises feature.apply() — i.e. the code that actually mutates the
 * geometry as users add holes, fillets, chamfers, and booleans. It runs the
 * real `three-bvh-csg` Evaluator, so if CSG silently breaks across a dep
 * upgrade the golden hash will drift.
 *
 * Every case is a tiny fixed scenario — we don't try to cover every
 * combination. The goal is smoke coverage on the operations that define
 * "this is a CAD app" so obvious regressions get caught in CI.
 *
 * Accept intentional changes with:
 *   UPDATE_GOLDENS=1 npx vitest run src/app/\[lang\]/shape-generator/__tests__/pipeline.regression.test.ts
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as THREE from 'three';
import { booleanFeature } from '../features/boolean';
import { filletFeature } from '../features/fillet';
import { chamferFeature } from '../features/chamfer';
import { computeSignature, type GeometrySignature } from './geometrySignature';

const GOLDEN_PATH = join(__dirname, '__goldens__', 'pipeline.json');
const UPDATE = process.env.UPDATE_GOLDENS === '1';

type GoldenFile = Record<string, GeometrySignature>;

function loadGoldens(): GoldenFile {
  if (!existsSync(GOLDEN_PATH)) return {};
  try { return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenFile; }
  catch { return {}; }
}

function saveGoldens(data: GoldenFile): void {
  mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
  writeFileSync(GOLDEN_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

// Build the input box directly from Three.js to sidestep the shape registry
// barrel — importing `shapes/box.ts` would drag in every sibling shape and
// trigger the registry's self-referencing initialization.
function makeBox(w = 60, h = 40, d = 30): THREE.BufferGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.computeVertexNormals();
  return geo;
}

function defaultParams(feature: { params: Array<{ key: string; default: number }> }): Record<string, number> {
  const p: Record<string, number> = {};
  for (const sp of feature.params) p[sp.key] = sp.default;
  return p;
}

// ─── Cases ─────────────────────────────────────────────────────────────────

type Case = {
  name: string;
  /** Build the input geometry and feature params, then call feature.apply(). */
  run: () => THREE.BufferGeometry;
};

const cases: Case[] = [
  {
    name: 'box-subtract-cylinder',
    run: () => {
      const geo = makeBox();
      const params = defaultParams(booleanFeature);
      params.operation = 1;     // subtract
      params.toolShape = 1;     // cylinder
      params.toolWidth = 20;
      params.toolHeight = 80;
      params.posX = 0;
      params.posY = 0;
      params.posZ = 0;
      return booleanFeature.apply(geo, params);
    },
  },
  {
    name: 'box-union-sphere',
    run: () => {
      const geo = makeBox();
      const params = defaultParams(booleanFeature);
      params.operation = 0;     // union
      params.toolShape = 2;     // sphere
      params.toolWidth = 40;
      params.posX = 40;
      return booleanFeature.apply(geo, params);
    },
  },
  {
    name: 'box-fillet-default',
    run: () => {
      const geo = makeBox();
      const params = defaultParams(filletFeature);
      return filletFeature.apply(geo, params);
    },
  },
  {
    name: 'box-chamfer-default',
    run: () => {
      const geo = makeBox();
      const params = defaultParams(chamferFeature);
      return chamferFeature.apply(geo, params);
    },
  },
];

// ─── Test runner ───────────────────────────────────────────────────────────

describe('feature pipeline regression', () => {
  const goldens = loadGoldens();
  const updated: GoldenFile = { ...goldens };

  for (const c of cases) {
    it(`${c.name} — matches golden`, () => {
      let geo: THREE.BufferGeometry;
      try {
        geo = c.run();
      } catch (err) {
        throw new Error(`${c.name} threw: ${(err as Error).message}`);
      }

      expect(geo).toBeDefined();
      expect(geo.attributes.position.count).toBeGreaterThan(0);

      const sig = computeSignature(geo);

      if (UPDATE) {
        updated[c.name] = sig;
        return;
      }

      const golden = goldens[c.name];
      if (!golden) {
        throw new Error(`No golden for ${c.name}. Run with UPDATE_GOLDENS=1 to accept.`);
      }

      // CSG is less stable across platforms than pure primitives, so we
      // don't assert on the position hash here — structural counts and
      // volume/bbox/surface area are the reliable regression signal.
      expect(sig.vertexCount, `${c.name} vertexCount`).toBe(golden.vertexCount);
      expect(sig.triangleCount, `${c.name} triangleCount`).toBe(golden.triangleCount);

      const volTol = Math.max(1e-3, Math.abs(golden.volume_mm3) * 5e-3);
      const areaTol = Math.max(1e-3, Math.abs(golden.surfaceArea_mm2) * 5e-3);
      expect(Math.abs(sig.volume_mm3 - golden.volume_mm3),
        `${c.name} volume drift`).toBeLessThanOrEqual(volTol);
      expect(Math.abs(sig.surfaceArea_mm2 - golden.surfaceArea_mm2),
        `${c.name} surface drift`).toBeLessThanOrEqual(areaTol);

      for (let i = 0; i < 3; i++) {
        expect(Math.abs(sig.bbox.min[i] - golden.bbox.min[i])).toBeLessThanOrEqual(1e-2);
        expect(Math.abs(sig.bbox.max[i] - golden.bbox.max[i])).toBeLessThanOrEqual(1e-2);
      }
    });
  }

  it('writes pipeline goldens when UPDATE_GOLDENS=1', () => {
    if (UPDATE) {
      saveGoldens(updated);
      // eslint-disable-next-line no-console
      console.log(`[pipeline regression] wrote ${Object.keys(updated).length} goldens to ${GOLDEN_PATH}`);
    }
    expect(true).toBe(true);
  });
});
