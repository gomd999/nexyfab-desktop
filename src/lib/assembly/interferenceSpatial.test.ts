/**
 * interferenceSpatial — A4: the spatial-hash broad-phase must (1) return EXACTLY
 * the same pairs as the O(N²) reference and (2) scale to 10k parts within budget.
 */
import { describe, it, expect } from 'vitest';
import {
  aabb,
  assemblyInterferences,
  assemblyInterferencesSpatial,
  type AABB,
} from './interference';
import { partInstance, IDENTITY_QUAT } from './assemblyState';
import { vec3 } from '@/lib/sketch/sketchPlane';

/** Deterministic LCG so the scatter is reproducible across runs. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

const UNIT_BOX: AABB = aabb(vec3(-0.5, -0.5, -0.5), vec3(0.5, 0.5, 0.5));

/** N unit-cube parts scattered in a cube of `side`, deterministic. */
function scatter(n: number, side: number, seed = 12345) {
  const rnd = lcg(seed);
  const parts = [];
  const boxes = new Map<string, AABB>();
  for (let i = 0; i < n; i++) {
    const id = `p${i}`;
    parts.push(partInstance({
      id, name: id, partTemplateId: 'tpl',
      position: vec3(rnd() * side, rnd() * side, rnd() * side),
      orientation: IDENTITY_QUAT, fixed: false,
    }));
    boxes.set(id, UNIT_BOX);
  }
  return { parts, boxes };
}

const norm = (prs: { partA: string; partB: string }[]): Set<string> =>
  new Set(prs.map((p) => (p.partA < p.partB ? `${p.partA}::${p.partB}` : `${p.partB}::${p.partA}`)));

describe('assemblyInterferencesSpatial — exactness vs O(N²)', () => {
  it('returns the identical pair set as the brute-force scan (dense)', () => {
    const { parts, boxes } = scatter(400, 12); // dense → many overlaps
    const brute = assemblyInterferences(parts, boxes);
    const fast = assemblyInterferencesSpatial(parts, boxes);
    expect(fast.length).toBeGreaterThan(0); // the scatter actually overlaps
    expect(norm(fast)).toEqual(norm(brute));
  });

  it('matches the brute force when there are zero overlaps (sparse)', () => {
    const { parts, boxes } = scatter(300, 400); // sparse → ~no overlaps
    const brute = assemblyInterferences(parts, boxes);
    const fast = assemblyInterferencesSpatial(parts, boxes);
    expect(norm(fast)).toEqual(norm(brute));
  });

  it('honours the whitelist identically', () => {
    const { parts, boxes } = scatter(200, 10, 7);
    const all = assemblyInterferences(parts, boxes);
    expect(all.length).toBeGreaterThan(2);
    const wl = new Set([
      all[0]!.partA < all[0]!.partB ? `${all[0]!.partA}::${all[0]!.partB}` : `${all[0]!.partB}::${all[0]!.partA}`,
    ]);
    const brute = assemblyInterferences(parts, boxes, wl);
    const fast = assemblyInterferencesSpatial(parts, boxes, wl);
    expect(norm(fast)).toEqual(norm(brute));
  });

  it('handles an oversized part (spans many cells) correctly', () => {
    const { parts, boxes } = scatter(150, 20, 99);
    // Make p0 a giant box that should overlap many neighbours.
    boxes.set('p0', aabb(vec3(-10, -10, -10), vec3(10, 10, 10)));
    const brute = assemblyInterferences(parts, boxes);
    const fast = assemblyInterferencesSpatial(parts, boxes, undefined, { maxCellsPerBox: 32 });
    expect(norm(fast)).toEqual(norm(brute));
  });
});

// 10k-part scale validation — heavy; gated like the other perf benchmarks.
const ENABLED = process.env.RUN_PERF_BENCH === '1';
(ENABLED ? describe : describe.skip)('assemblyInterferencesSpatial — 10k scale (A4)', () => {
  it('broad-phases 10k parts well under the brute-force cost', () => {
    const { parts, boxes } = scatter(10_000, 250); // sparse-ish realistic spread

    const t0 = performance.now();
    const fast = assemblyInterferencesSpatial(parts, boxes);
    const tFast = performance.now() - t0;

    const t1 = performance.now();
    const brute = assemblyInterferences(parts, boxes);
    const tBrute = performance.now() - t1;

     
    console.log(`[A4] 10k parts — spatial ${tFast.toFixed(0)}ms (${fast.length} pairs) vs brute ${tBrute.toFixed(0)}ms`);
    expect(norm(fast)).toEqual(norm(brute));     // still exact at scale
    expect(tFast).toBeLessThan(1500);            // interactive budget
    expect(tFast).toBeLessThan(tBrute);          // and beats N²/2
  }, 120_000);
});
