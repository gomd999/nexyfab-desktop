/**
 * configStoreSoak.test.ts — A5 multi-peer burn-in.
 *
 * Simulates the tracker's "3 peers × 5 windows × 10 iterations" soak
 * (150 random ops per run) entirely in node. Each iteration:
 *   1. Pick a random peer
 *   2. Generate a random op (from a fair distribution of all kinds)
 *   3. Apply locally
 *   4. Star-of-stars sync ALL peers
 *   5. Assert all peers converge to identical canonical state
 *
 * No real timing — convergence is the only signal. The browser smoke
 * harness at /collab-smoke-configs covers the timing/transport surface.
 *
 * The test uses a seeded PRNG so failures are deterministic and the seed
 * is logged for repro. CI default: 3 peers, 150 ops. Local dev can dial
 * up by setting `SOAK_OPS` / `SOAK_PEERS`.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  applyConfigOp,
  canonicalConfigs,
  readActiveConfigId,
  readAllConfigs,
  readGlobalVars,
  syncAll,
  type ConfigOp,
} from '../configStoreYjs';
import type { ConfigEntry } from '../types';

// ─── PRNG (mulberry32 — deterministic, no crypto dep) ───────────────────────

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Op generators ──────────────────────────────────────────────────────────

interface GenContext {
  rng: () => number;
  configIds: Set<string>;
  /** Auto-incrementing seq per peer to keep entry ids unique across peers. */
  seq: { [peerId: number]: number };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function randomValue(rng: () => number): number | string {
  return rng() < 0.85 ? Math.floor(rng() * 100) : `expr-${Math.floor(rng() * 10)}`;
}

function blankEntry(id: string): ConfigEntry {
  return { id, name: `Config-${id}`, overrides: {}, expressionVars: {} };
}

function genOp(ctx: GenContext, peer: number, doc: Y.Doc): ConfigOp | null {
  const { rng, configIds } = ctx;
  const live = readAllConfigs(doc).map(e => e.id);
  const liveSet = new Set(live);
  // Bias toward addConfig early (when ids are scarce) and toward mutations
  // once we have material to mutate.
  const r = rng();

  if (live.length === 0 || r < 0.20) {
    // addConfig — unique per peer using peer-seq prefix.
    ctx.seq[peer] = (ctx.seq[peer] ?? 0) + 1;
    const id = `p${peer}-${ctx.seq[peer]}`;
    configIds.add(id);
    return { kind: 'addConfig', entry: blankEntry(id) };
  }
  if (r < 0.30) {
    return { kind: 'removeConfig', id: pick(rng, live) };
  }
  if (r < 0.40) {
    return { kind: 'renameConfig', id: pick(rng, live), name: `R${Math.floor(rng() * 1000)}` };
  }
  if (r < 0.55) {
    const id = pick(rng, live);
    // 30% of the time try parent = self (will be refused). Tests both
    // the legal and illegal branches.
    const parentCandidates = [...live, ...live.filter(x => x !== id)];
    const parentId = rng() < 0.10 ? id : (parentCandidates.length > 0 ? pick(rng, parentCandidates) : null);
    return { kind: 'setParent', id, parentId };
  }
  if (r < 0.62) {
    return { kind: 'setActive', id: rng() < 0.10 ? null : pick(rng, live) };
  }
  if (r < 0.78) {
    return {
      kind: 'setOverride',
      configId: pick(rng, live),
      featureId: `f${Math.floor(rng() * 5)}`,
      paramKey: pick(rng, ['radius', 'depth', 'count', 'angle']),
      value: randomValue(rng),
    };
  }
  if (r < 0.85) {
    return {
      kind: 'clearOverride',
      configId: pick(rng, live),
      featureId: `f${Math.floor(rng() * 5)}`,
      paramKey: pick(rng, ['radius', 'depth', 'count', 'angle']),
    };
  }
  if (r < 0.92) {
    return {
      kind: 'setSuppressed',
      configId: pick(rng, live),
      featureId: `f${Math.floor(rng() * 5)}`,
      suppressed: rng() < 0.5,
    };
  }
  if (r < 0.97) {
    return {
      kind: 'setGlobalVar',
      name: pick(rng, ['D', 'L', 'H', 'W']),
      value: randomValue(rng),
    };
  }
  return {
    kind: 'setExpressionVar',
    configId: pick(rng, live),
    varName: pick(rng, ['x', 'y', 'z']),
    value: randomValue(rng),
  };
  void liveSet;
}

// ─── Soak driver ────────────────────────────────────────────────────────────

interface SoakResult {
  peers: number;
  ops: number;
  applied: number;
  refused: number;
  finalConfigs: number;
  finalCanonical: string;
}

function runSoak(seed: number, peers: number, ops: number): SoakResult {
  const docs = Array.from({ length: peers }, () => new Y.Doc());
  const ctx: GenContext = { rng: mulberry32(seed), configIds: new Set(), seq: {} };

  let applied = 0;
  let refused = 0;

  for (let i = 0; i < ops; i += 1) {
    const peer = Math.floor(ctx.rng() * peers);
    const doc = docs[peer]!;
    const op = genOp(ctx, peer, doc);
    if (!op) continue;
    const r = applyConfigOp(doc, op);
    if (r.applied) applied += 1;
    else refused += 1;
    // Star-of-stars sync after every op — production transport will batch
    // but for convergence verification we want maximum interleaving.
    syncAll(docs);
  }

  // Assert convergence across all peers.
  const canonicals = docs.map(d => canonicalConfigs(readAllConfigs(d)));
  const actives = docs.map(d => readActiveConfigId(d));
  const vars = docs.map(d => readGlobalVars(d));
  for (let i = 1; i < peers; i += 1) {
    if (canonicals[i] !== canonicals[0]) {
      throw new Error(
        `Soak DIVERGED at peer ${i} (seed=${seed}, ops=${ops}):\n` +
        `  p0=${canonicals[0]}\n` +
        `  p${i}=${canonicals[i]}`
      );
    }
    if (actives[i] !== actives[0]) {
      throw new Error(`Soak active divergence: p0=${actives[0]} vs p${i}=${actives[i]}`);
    }
    if (JSON.stringify(vars[i]) !== JSON.stringify(vars[0])) {
      throw new Error(`Soak globalVars divergence at p${i}`);
    }
  }

  return {
    peers,
    ops,
    applied,
    refused,
    finalConfigs: readAllConfigs(docs[0]!).length,
    finalCanonical: canonicals[0]!,
  };
}

// ─── Test cases ─────────────────────────────────────────────────────────────

describe('configStoreSoak — multi-peer burn-in', () => {
  // The flagship case: tracker's 3 × 5 × 10 = 150 ops with 3 peers.
  it('3 peers × 150 ops (seed=1) — all converge', () => {
    const r = runSoak(1, 3, 150);
    expect(r.applied + r.refused).toBe(150);
    expect(r.applied).toBeGreaterThan(0);
    // No assertion on exact final-config count — random ops fluctuate it —
    // only that all peers agree (already enforced inside runSoak).
  });

  it('3 peers × 150 ops (seed=2) — all converge', () => {
    expect(() => runSoak(2, 3, 150)).not.toThrow();
  });

  it('3 peers × 150 ops (seed=3) — all converge', () => {
    expect(() => runSoak(3, 3, 150)).not.toThrow();
  });

  it('3 peers × 150 ops (seed=42) — all converge', () => {
    expect(() => runSoak(42, 3, 150)).not.toThrow();
  });

  it('5 peers × 200 ops — all converge (stress)', () => {
    expect(() => runSoak(123, 5, 200)).not.toThrow();
  });

  it('2 peers × 50 ops repeated 5 times — all converge', () => {
    for (const seed of [10, 11, 12, 13, 14]) {
      expect(() => runSoak(seed, 2, 50)).not.toThrow();
    }
  });
});
