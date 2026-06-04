/**
 * featureDegenerateCorpus — F2 robustness, the curated half (roadmap F2 steps 2–4).
 *
 * The fuzz harness hunts random inputs; this pins the KNOWN-pathological ones — the
 * cases a real user hits by dragging a slider to its rail, or that an upstream
 * feature hands down. Every feature, against every degenerate input, must obey ONE
 * invariant:
 *
 *     apply(geo, params)  →  sane geometry   OR   a structured Error
 *
 * Never a silent empty/garbage solid, never NaN/Infinity coords, never a
 * non-Error throw (undefined access, stack overflow). A deliberate structured
 * block IS correct robustness behaviour — the part is protected, the user is told.
 *
 * Each row here is a regression lock: once a feature handles a degenerate input
 * (by producing sane geometry or by blocking), it must keep doing so.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FEATURE_MAP } from '../features/index';
import type { FeatureType } from '../features/types';

const FEATURES: FeatureType[] = [
  'boolean', 'hole', 'mirror', 'linearPattern', 'circularPattern', 'scale', 'chamfer', 'draft', 'revolve',
];

type ParamDef = { key: string; default: number; min?: number; max?: number };

/** Build a param set by mapping every numeric param through `pick`. */
function params(defs: ReadonlyArray<ParamDef>, pick: (d: ParamDef) => number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of defs) out[d.key] = pick(d);
  return out;
}

/** Degenerate param strategies — the rails and beyond. */
const PARAM_STRATEGIES: Record<string, (d: ParamDef) => number> = {
  zeros: () => 0,
  mins: (d) => d.min ?? d.default,
  maxs: (d) => d.max ?? d.default,
  // Past the declared range in both directions — a clamp bug surfaces here.
  beyondMax: (d) => (d.max ?? d.default) * 10 + 1,
  beyondMin: (d) => (d.min ?? d.default) - Math.abs(d.default || 1) * 10 - 1,
};

/** Degenerate geometry inputs (the upstream hands these down). */
function degenerateGeometries(): Array<{ name: string; geo: THREE.BufferGeometry }> {
  const normal = new THREE.BoxGeometry(20, 20, 20);

  const tiny = new THREE.BoxGeometry(1e-7, 1e-7, 1e-7);

  const huge = new THREE.BoxGeometry(1e7, 1e7, 1e7);

  // Open, non-manifold surface (a bare plane — no volume).
  const plane = new THREE.PlaneGeometry(20, 20);

  // A zero-area "triangle": three coincident vertices.
  const sliver = new THREE.BufferGeometry();
  sliver.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  sliver.setIndex([0, 1, 2]);

  return [
    { name: 'normal-box', geo: normal },
    { name: 'tiny-box', geo: tiny },
    { name: 'huge-box', geo: huge },
    { name: 'open-plane', geo: plane },
    { name: 'zero-area-sliver', geo: sliver },
  ];
}

function assertSaneOrBlocked(
  fn: () => THREE.BufferGeometry,
  ctx: string,
): void {
  let out: THREE.BufferGeometry;
  try {
    out = fn();
  } catch (e) {
    // A structured Error is a deliberate, acceptable block.
    if (e instanceof Error && e.message) return;
    throw new Error(`${ctx}: non-structured throw (robustness bug): ${String(e)}`);
  }
  const pos = out.attributes.position;
  if (!pos || pos.count === 0) {
    throw new Error(`${ctx}: returned a silent EMPTY geometry (must block with an Error instead)`);
  }
  const arr = pos.array as ArrayLike<number>;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) {
      throw new Error(`${ctx}: produced a non-finite coord (${arr[i]}) at ${i} — must block instead`);
    }
  }
}

describe('feature degenerate-input corpus (F2 robustness)', () => {
  it('every feature × degenerate params (on a normal box) stays sane-or-blocked', () => {
    for (const ft of FEATURES) {
      const def = FEATURE_MAP[ft as keyof typeof FEATURE_MAP];
      for (const [strat, pick] of Object.entries(PARAM_STRATEGIES)) {
        const p = params(def.params as ParamDef[], pick);
        assertSaneOrBlocked(
          () => def.apply(new THREE.BoxGeometry(20, 20, 20), p),
          `${ft} / params:${strat} ${JSON.stringify(p)}`,
        );
      }
    }
  }, 120_000);

  it('every feature × degenerate geometry (with default params) stays sane-or-blocked', () => {
    for (const ft of FEATURES) {
      const def = FEATURE_MAP[ft as keyof typeof FEATURE_MAP];
      const p = params(def.params as ParamDef[], (d) => d.default);
      for (const { name, geo } of degenerateGeometries()) {
        assertSaneOrBlocked(
          () => def.apply(geo.clone(), p),
          `${ft} / geo:${name}`,
        );
      }
    }
  }, 120_000);

  // The interaction surface: a degenerate solid AND rail params at once. Single-axis
  // tests pass each in isolation; bugs often hide in the cross (e.g. a beyond-range
  // tool on a sub-millimetre solid).
  it('every feature × (degenerate geometry × rail params) stays sane-or-blocked', () => {
    const geos = degenerateGeometries().filter((g) => g.name !== 'normal-box');
    const strats = ['zeros', 'beyondMax', 'beyondMin'] as const;
    for (const ft of FEATURES) {
      const def = FEATURE_MAP[ft as keyof typeof FEATURE_MAP];
      for (const strat of strats) {
        const p = params(def.params as ParamDef[], PARAM_STRATEGIES[strat]);
        for (const { name, geo } of geos) {
          assertSaneOrBlocked(
            () => def.apply(geo.clone(), p),
            `${ft} / geo:${name} × params:${strat} ${JSON.stringify(p)}`,
          );
        }
      }
    }
  }, 120_000);
});
