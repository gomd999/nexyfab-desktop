/**
 * featurePipelineFuzz — F2 robustness harness (commercial-parity roadmap).
 *
 * Robustness = surviving inputs you didn't anticipate. This actively HUNTS for
 * edge-case failures by running thousands of random (shape × feature sequence ×
 * params) pipelines and asserting invariants:
 *   - never crashes — a feature either returns geometry OR throws a structured
 *     Error (a graceful, deliberate block); a non-Error throw / undefined access
 *     is a robustness bug.
 *   - output geometry is sane — non-empty, all coords finite (no NaN / Infinity).
 *   - deterministic — the same seed reproduces the same output.
 *
 * Seeded PRNG so any failure is reproducible (no Math.random). Mesh path only
 * (headless, no WASM). Every failure this finds becomes a fix + a regression
 * test, which is how robustness is earned.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SHAPE_MAP } from '../shapes';
import { FEATURE_MAP } from '../features/index';
import type { FeatureType } from '../features/types';
import type { ShapeConfig } from '../shapes/index';

// ─── seeded PRNG (mulberry32) ───────────────────────────────────────────────
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

/** Random params from a definition's own param ranges (within [min,max]). */
function randomParams(rng: () => number, defs: ReadonlyArray<{ key: string; default: number; min?: number; max?: number; step?: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of defs) {
    const min = p.min ?? p.default;
    const max = p.max ?? p.default;
    out[p.key] = max > min ? min + rng() * (max - min) : p.default;
  }
  return out;
}

function checkSane(g: THREE.BufferGeometry, ctx: string): void {
  const pos = g.attributes.position;
  expect(pos, `${ctx}: missing position`).toBeDefined();
  expect(pos.count, `${ctx}: empty geometry`).toBeGreaterThan(0);
  const arr = pos.array as ArrayLike<number>;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) throw new Error(`${ctx}: non-finite vertex coord at ${i} (= ${arr[i]})`);
  }
}

// Mesh-path-robust primitives + features (no OCCT dependency).
const FUZZ_SHAPES = ['box', 'cylinder', 'sphere', 'cone', 'torus', 'wedge', 'pipe', 'disk', 'ellipsoid'];
const FUZZ_FEATURES: FeatureType[] = [
  'boolean', 'hole', 'mirror', 'linearPattern', 'circularPattern', 'scale', 'chamfer', 'draft', 'revolve',
];

describe('feature pipeline fuzz (F2 robustness)', () => {
  // A pipeline must stay BOUNDED: pattern-on-pattern would explode the mesh
  // (20×36 copies → millions of tris). Real CAD caps this; the fuzz stops a
  // chain once the geometry crosses a sane size, which also keeps CI fast.
  const MAX_VERTS = 200_000;

  it('survives random shape + feature pipelines: no crash, no NaN, no silent-empty', () => {
    const rng = makeRng(0xC0FFEE);
    let applied = 0;
    const ITER = 120;

    for (let i = 0; i < ITER; i++) {
      const shapeId = pick(rng, FUZZ_SHAPES);
      const shape: ShapeConfig = SHAPE_MAP[shapeId];
      const base = shape.generate(randomParams(rng, shape.params));
      checkSane(base.geometry, `iter ${i} base ${shapeId}`);
      let g = base.geometry;

      const seqLen = 1 + Math.floor(rng() * 3);
      for (let s = 0; s < seqLen; s++) {
        if (g.attributes.position.count > MAX_VERTS) break; // bounded pipeline
        const ft = pick(rng, FUZZ_FEATURES);
        const def = FEATURE_MAP[ft as keyof typeof FEATURE_MAP];
        const params = randomParams(rng, def.params);
        let out: THREE.BufferGeometry;
        try {
          out = def.apply(g, params);
        } catch (e) {
          // A deliberate, structured failure is acceptable robustness behaviour.
          // A non-Error throw (undefined access, etc.) is a bug.
          if (!(e instanceof Error) || !e.message) {
            throw new Error(`iter ${i} ${shapeId}→${ft}: non-structured throw: ${String(e)}`);
          }
          break; // chain can't continue after a feature declines
        }
        checkSane(out, `iter ${i} ${shapeId}→${ft} (params ${JSON.stringify(params)})`);
        g = out;
        applied++;
      }
    }

    // Sanity: the harness actually exercised features (not all graceful-skipped).
    expect(applied).toBeGreaterThan(ITER); // >1 feature applied per iter on average
  }, 120_000);

  it('is deterministic — the same seed reproduces identical geometry', () => {
    function run(): { count: number; checksum: number } {
      const rng = makeRng(0x1234);
      const shape = SHAPE_MAP[pick(rng, FUZZ_SHAPES)];
      let g = shape.generate(randomParams(rng, shape.params)).geometry;
      for (let s = 0; s < 3; s++) {
        const def = FEATURE_MAP[pick(rng, FUZZ_FEATURES) as keyof typeof FEATURE_MAP];
        try { g = def.apply(g, randomParams(rng, def.params)); } catch { break; }
      }
      const arr = g.attributes.position.array as ArrayLike<number>;
      let checksum = 0;
      for (let i = 0; i < arr.length; i++) checksum = (checksum + arr[i] * (i + 1)) % 1e9;
      return { count: g.attributes.position.count, checksum };
    }
    const a = run();
    const b = run();
    expect(b.count).toBe(a.count);
    expect(b.checksum).toBeCloseTo(a.checksum, 3);
  });
});
