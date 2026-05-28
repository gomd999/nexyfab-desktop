/**
 * phase3SoakHarness.test.ts — Wave 2 Phase 3 W4 Q-precursor.
 *
 * **Mini-soak: 3 peers × 100 ops × 6 seeds × 3 stores. Converge.**
 *
 * This is the node-side multi-peer burn-in that feeds the W11 Q1 full
 * burn-in. We do NOT measure timing here — convergence verification only.
 * The browser-side timing surface is the existing smoke harness at
 * `/collab-smoke-*` routes.
 *
 * ─── Pattern ──────────────────────────────────────────────────────────
 *
 * Modeled on Phase 2's `configurations/__tests__/configStoreSoak.test.ts`
 * (A5 multi-peer burn-in). Same deterministic mulberry32 PRNG so seed
 * failures are reproducible. Same star-of-stars `syncAll` after every op
 * for maximum interleaving.
 *
 * For each store (Sketch, FeatureTree, RefGeom):
 *   1. Spawn 3 Y.Doc peers.
 *   2. Generate 100 random ops per RUN (mix of adds / updates / removes).
 *   3. Random peer picks each op; star-of-stars sync after every op.
 *   4. Assert: all peers converge to identical canonical state.
 *   5. Repeat across 6 random seeds.
 *
 * Total: 3 stores × 6 seeds = 18 convergence runs. All must pass at
 * 100%.
 *
 * ─── Why through the store API, not the raw Yjs primitives ──────────
 *
 * The raw `applySketchOp` / `applyFeatureOp` / `applyRefGeomOp` already
 * have a Phase-1 161-test soak. THIS suite proves the **adapter layer**
 * (LocalSketchStore vs YjsSketchStore + applySketchOp) does not
 * introduce divergence under random workload. The store IS the user-
 * facing seam, so soak-testing IT is what matters for ADR-012 §9
 * graduation.
 */

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';

import { SketchStore } from '../sketch/SketchStore';
import { FeatureTreeStore } from '../featureTree/FeatureTreeStore';
import { RefGeomStore } from '../referenceGeometry/RefGeomStore';
import { sketchesEqual } from '../collab/sketchYjs';
import { syncDocs as syncSketchDocs } from '../collab/sketchYjs';
import { syncDocs as syncTreeDocs } from '../collab/featureTreeYjs';
import { syncDocs as syncRefGeomDocs } from '../referenceGeometry/refGeomYjs';

import type { SketchSegment } from '../sketch/types';
import type { HistoryNode } from '../useFeatureStack';
import type { ReferenceNode, ReferencePlaneNode } from '../referenceGeometry/types';

// ─── PRNG (mulberry32 — deterministic, matches configStoreSoak.test.ts) ──

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

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

// ─── Star-of-stars sync ─────────────────────────────────────────────────

/** Pairwise sync every doc with every other doc using `syncFn`. After
 *  this all docs share the same state vector. */
function syncAll(docs: Y.Doc[], syncFn: (a: Y.Doc, b: Y.Doc) => unknown): void {
  for (let i = 0; i < docs.length; i += 1) {
    for (let j = i + 1; j < docs.length; j += 1) {
      syncFn(docs[i]!, docs[j]!);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  1. SketchStore soak
// ═══════════════════════════════════════════════════════════════════════

interface SketchSoakResult {
  applied: number;
  finalSegCount: number;
}

function runSketchSoak(seed: number, peers: number, ops: number): SketchSoakResult {
  const docs = Array.from({ length: peers }, () => new Y.Doc());
  const stores = docs.map((d) => SketchStore.fromYDoc(d, 'soak-sketch'));
  const rng = mulberry32(seed);
  const seq: number[] = Array(peers).fill(0);
  const knownIds = new Set<string>();

  let applied = 0;
  for (let i = 0; i < ops; i += 1) {
    const peer = Math.floor(rng() * peers);
    const store = stores[peer]!;
    const live = store.getSegments();
    const liveIds = live.map((s) => s.id ?? '');
    const r = rng();

    if (live.length === 0 || r < 0.40) {
      // add segment
      seq[peer] += 1;
      const id = `p${peer}-${seq[peer]}`;
      const seg: SketchSegment = {
        id,
        type: 'line',
        points: [
          { x: Math.floor(rng() * 100), y: Math.floor(rng() * 100) },
          { x: Math.floor(rng() * 100), y: Math.floor(rng() * 100) },
        ],
      };
      store.addSegment(seg);
      knownIds.add(id);
      applied += 1;
    } else if (r < 0.70) {
      // update segment
      const id = pick(rng, liveIds);
      if (id) {
        store.updateSegment(id, {
          points: [
            { x: Math.floor(rng() * 100), y: Math.floor(rng() * 100) },
            { x: Math.floor(rng() * 100), y: Math.floor(rng() * 100) },
          ],
        });
        applied += 1;
      }
    } else if (r < 0.85) {
      // remove segment
      const id = pick(rng, liveIds);
      if (id) {
        store.removeSegment(id);
        applied += 1;
      }
    } else {
      // meta mutation
      const planes = ['xy', 'xz', 'yz'] as const;
      store.setPlane(pick(rng, planes));
      applied += 1;
    }

    syncAll(docs, syncSketchDocs);
  }

  // Convergence check — all stores should report identical sketches.
  const sketches = stores.map((s) => s.getSketch());
  for (let i = 1; i < peers; i += 1) {
    if (!sketchesEqual(sketches[0]!, sketches[i]!)) {
      throw new Error(
        `[phase3Soak/Sketch] DIVERGED at peer ${i} (seed=${seed}, ops=${ops}). ` +
        `p0 segs=${sketches[0]!.segments.length}, p${i} segs=${sketches[i]!.segments.length}`,
      );
    }
  }

  for (const s of stores) s.destroy();
  return { applied, finalSegCount: sketches[0]!.segments.length };
}

describe('Phase 3 W4 soak — SketchStore (3 peers × 100 ops × 6 seeds)', () => {
  for (const seed of [1, 2, 3, 42, 100, 999]) {
    it(`seed=${seed} — all 3 peers converge`, () => {
      const r = runSketchSoak(seed, 3, 100);
      expect(r.applied).toBeGreaterThan(0);
      // No exact-count assertion on finalSegCount — the random mix
      // fluctuates it; convergence is the only signal (already enforced
      // inside runSketchSoak).
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  2. FeatureTreeStore soak
// ═══════════════════════════════════════════════════════════════════════

interface TreeSoakResult {
  applied: number;
  finalNodeCount: number;
}

function makeRandomNode(id: string, parentId: string, rng: () => number): HistoryNode {
  return {
    id,
    type: 'feature',
    label: `node-${id}`,
    icon: '🔧',
    params: { x: Math.floor(rng() * 100) },
    enabled: rng() > 0.1,
    expanded: true,
    parentId,
    children: [],
    editingActive: false,
    timestamp: Math.floor(rng() * 1_000_000),
  };
}

function runTreeSoak(seed: number, peers: number, ops: number): TreeSoakResult {
  const docs = Array.from({ length: peers }, () => new Y.Doc());
  const stores = docs.map((d) => FeatureTreeStore.fromYDoc(d));
  // Sync once so all peers see the same bootstrapped rootId (each peer
  // bootstraps with its own random rootId on construct; after one sync
  // Yjs LWW picks one and all converge).
  syncAll(docs, syncTreeDocs);

  const rng = mulberry32(seed);
  const seq: number[] = Array(peers).fill(0);

  let applied = 0;
  for (let i = 0; i < ops; i += 1) {
    const peer = Math.floor(rng() * peers);
    const store = stores[peer]!;
    const nodes = store.getNodes();
    const rootId = store.getRootId();
    const nonRoot = nodes.filter((n) => n.id !== rootId);
    const r = rng();

    if (nonRoot.length === 0 || r < 0.40) {
      // add node
      seq[peer] += 1;
      const id = `p${peer}-n${seq[peer]}`;
      // Pick a random existing node as parent (root if no others).
      const parent = nonRoot.length > 0 && rng() > 0.5 ? pick(rng, nonRoot).id : rootId;
      store.addNode(makeRandomNode(id, parent, rng));
      applied += 1;
    } else if (r < 0.60) {
      // updateParams
      const target = pick(rng, nonRoot);
      store.updateParams(target.id, { x: Math.floor(rng() * 100) });
      applied += 1;
    } else if (r < 0.75) {
      // updateLabel
      const target = pick(rng, nonRoot);
      store.updateLabel(target.id, `lbl-${Math.floor(rng() * 1000)}`);
      applied += 1;
    } else if (r < 0.85) {
      // setEnabled
      const target = pick(rng, nonRoot);
      store.setEnabled(target.id, rng() > 0.5);
      applied += 1;
    } else if (r < 0.92) {
      // setActive
      const target = pick(rng, nodes);
      store.setActive(target.id);
      applied += 1;
    } else {
      // removeNode (don't remove root)
      const target = pick(rng, nonRoot);
      store.removeNode(target.id);
      applied += 1;
    }

    syncAll(docs, syncTreeDocs);
  }

  // Convergence — id-keyed canonical comparison across stores.
  const snapshots = stores.map((s) => s.getSnapshot());
  const canonical = (snap: ReturnType<typeof stores[0]['getSnapshot']>): string => {
    const nodes = [...snap.tree.nodes]
      .map((n) => ({
        id: n.id,
        type: n.type,
        label: n.label,
        params: n.params,
        enabled: n.enabled,
        parentId: n.parentId,
        children: [...n.children].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return JSON.stringify({
      nodes,
      rootId: snap.tree.rootId,
      activeNodeId: snap.tree.activeNodeId,
    });
  };
  const c0 = canonical(snapshots[0]!);
  for (let i = 1; i < peers; i += 1) {
    const ci = canonical(snapshots[i]!);
    if (ci !== c0) {
      throw new Error(
        `[phase3Soak/FeatureTree] DIVERGED at peer ${i} (seed=${seed}, ops=${ops}).` +
        ` p0 nodes=${snapshots[0]!.tree.nodes.length}, p${i} nodes=${snapshots[i]!.tree.nodes.length}`,
      );
    }
  }

  for (const s of stores) s.destroy();
  return { applied, finalNodeCount: snapshots[0]!.tree.nodes.length };
}

describe('Phase 3 W4 soak — FeatureTreeStore (3 peers × 100 ops × 6 seeds)', () => {
  for (const seed of [1, 2, 3, 42, 100, 999]) {
    it(`seed=${seed} — all 3 peers converge`, () => {
      const r = runTreeSoak(seed, 3, 100);
      expect(r.applied).toBeGreaterThan(0);
      expect(r.finalNodeCount).toBeGreaterThan(0); // root at minimum
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  3. RefGeomStore soak
// ═══════════════════════════════════════════════════════════════════════

interface RefGeomSoakResult {
  applied: number;
  finalNodeCount: number;
}

function makeRandomPlane(id: string): ReferencePlaneNode {
  return {
    id,
    kind: 'plane',
    method: 'standard',
    label: id,
    hidden: false,
    dependsOn: [],
    evaluatedAt: 0,
    params: { method: 'standard', id: 'front' },
  };
}

function runRefGeomSoak(seed: number, peers: number, ops: number): RefGeomSoakResult {
  const docs = Array.from({ length: peers }, () => new Y.Doc());
  const stores = docs.map((d) => RefGeomStore.fromYDoc(d));
  const rng = mulberry32(seed);
  const seq: number[] = Array(peers).fill(0);

  let applied = 0;
  for (let i = 0; i < ops; i += 1) {
    const peer = Math.floor(rng() * peers);
    const store = stores[peer]!;
    const nodes = store.getNodes();
    const r = rng();

    if (nodes.length === 0 || r < 0.45) {
      seq[peer] += 1;
      const id = `p${peer}-r${seq[peer]}`;
      const res = store.addNode(makeRandomPlane(id));
      if (res.ok) applied += 1;
    } else if (r < 0.65) {
      const target = pick(rng, nodes);
      store.renameNode(target.id, `n-${Math.floor(rng() * 1000)}`);
      applied += 1;
    } else if (r < 0.80) {
      const target = pick(rng, nodes);
      store.updateNode(target.id, { hidden: rng() > 0.5 });
      applied += 1;
    } else if (r < 0.95) {
      const target = pick(rng, nodes);
      store.removeNode(target.id);
      applied += 1;
    } else {
      store.clear();
      applied += 1;
    }

    syncAll(docs, syncRefGeomDocs);
  }

  // Convergence
  const snapshots = stores.map((s) => s.getNodes());
  const canonical = (arr: ReferenceNode[]): string =>
    JSON.stringify(
      [...arr]
        .map((n) => ({ id: n.id, kind: n.kind, label: n.label, hidden: n.hidden, params: n.params }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  const c0 = canonical(snapshots[0]!);
  for (let i = 1; i < peers; i += 1) {
    const ci = canonical(snapshots[i]!);
    if (ci !== c0) {
      throw new Error(
        `[phase3Soak/RefGeom] DIVERGED at peer ${i} (seed=${seed}, ops=${ops}).` +
        ` p0 nodes=${snapshots[0]!.length}, p${i} nodes=${snapshots[i]!.length}`,
      );
    }
  }

  for (const s of stores) s.destroy();
  return { applied, finalNodeCount: snapshots[0]!.length };
}

describe('Phase 3 W4 soak — RefGeomStore (3 peers × 100 ops × 6 seeds)', () => {
  for (const seed of [1, 2, 3, 42, 100, 999]) {
    it(`seed=${seed} — all 3 peers converge`, () => {
      const r = runRefGeomSoak(seed, 3, 100);
      expect(r.applied).toBeGreaterThan(0);
    });
  }
});

