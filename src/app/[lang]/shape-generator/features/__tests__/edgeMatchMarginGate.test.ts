// @vitest-environment node
/**
 * edgeMatchMarginGate — W1-C acceptance measurement (ADR-017 §D1).
 *
 * WHAT THIS MEASURES
 * ──────────────────
 * System B (geometric signature matching: `bestEdgeMatch` +
 * `remapPointThroughBbox`) is the path the real OCCT features use. The ADR-017
 * spike measured that it **never reports a loss** — it always returns its
 * nearest candidate — so 100% of its failures are SILENT MISMATCHES: the wrong
 * edge, handed back with no warning. Under §D1 that is worse than a low
 * survival rate, because the user cannot tell they've been given garbage.
 *
 * This file adds a confidence floor + runner-up margin gate and measures the
 * conversion: mismatch → EXPLICIT loss. Three rates per configuration:
 *   survival  — resolved to the ground-truth edge
 *   mismatch  — resolved to a DIFFERENT edge, silently  ← must reach 0
 *   lost      — matcher said "I don't know" (index −1)  ← acceptable
 *
 * GEOMETRY MODEL — and its honest limits
 * ──────────────────────────────────────
 * The spike harness (`scripts/spike/topo-naming-k22.test.ts`) is owned by the
 * W1-B track and must not be modified, and it needs the 63MB OCCT WASM. So this
 * file re-derives the same part families ANALYTICALLY, in pure TS.
 *
 * That is exact, not an approximation, for the families used here: every part
 * is a prism over a polygon, optionally cut by fully-interior through-prisms.
 * The resulting B-rep edge set is exactly {base ring} ∪ {tool ring per tool},
 * where a "ring" is the profile's n vertical + n bottom + n top edges. The
 * spike's own `semanticEdges()` asserts the same decomposition, and its
 * `kernelEdges()` dedupes to the same set.
 *
 * ⚠ Deliberately EXCLUDED: the spike's `blindPocket` family. At its authoring
 * config the pocket and the through-hole are concentric and overlap, so the
 * boolean result is NOT the union of two independent rings — modelling it
 * analytically would be a guess. It is left to the kernel-backed spike.
 * The remaining 5 families include the two adversarial ones (a skewed profile
 * whose edge DIRECTIONS move with a parameter, and a hole tucked against a
 * corner specifically to bait a nearest-neighbour matcher).
 *
 * Ground truth is by semantic LABEL, independent of both the matcher and the
 * edge ordering — same contract as the spike.
 */
import { describe, it, expect } from 'vitest';
import {
  bestEdgeMatch,
  MIN_CONFIDENCE_SCORE,
  MIN_MARGIN,
  type EdgeSig,
} from '../edgeCorrespondence';
import { remapPointThroughBbox, type BBox3 } from '../topologyEdgeFinder';

// ─── parametric part model (mirrors scripts/spike/topo-naming-k22.test.ts) ────

interface P2 { x: number; y: number }
interface Solid { loop: P2[]; z0: number; z1: number }
interface Part { base: Solid; tools: Array<Solid & { id: string }> }
interface Cfg { w: number; d: number; h: number; skew: number; holeX: number; holeY: number }

const BASE_CFG: Cfg = { w: 40, d: 30, h: 20, skew: 0.30, holeX: 0.50, holeY: 0.50 };
const withC = (o: Partial<Cfg>): Cfg => ({ ...BASE_CFG, ...o });

/** The spike's 12 rebuild configs, verbatim. */
const SWEEP: Cfg[] = [
  withC({ w: 44 }), withC({ d: 33 }), withC({ h: 24 }),
  withC({ w: 48, d: 36, h: 24 }), withC({ w: 32, d: 24, h: 16 }),
  withC({ w: 60 }), withC({ d: 60 }), withC({ h: 45 }),
  withC({ w: 55, d: 22, h: 30, skew: 0.10, holeX: 0.30 }),
  withC({ w: 25, d: 45, h: 12, skew: 0.55, holeY: 0.28 }),
  withC({ w: 70, d: 18, h: 35, skew: 0.05, holeX: 0.72, holeY: 0.66 }),
  withC({ w: 18, d: 55, h: 8, skew: 0.48, holeX: 0.35, holeY: 0.75 }),
];

const sq = (cx: number, cy: number, a: number): P2[] =>
  [{ x: cx - a, y: cy - a }, { x: cx + a, y: cy - a }, { x: cx + a, y: cy + a }, { x: cx - a, y: cy + a }];

type Family = 'box' | 'lshape' | 'skew' | 'movingHole' | 'cornerHoleBait';
const FAMILIES: Family[] = ['box', 'lshape', 'skew', 'movingHole', 'cornerHoleBait'];

function buildPart(fam: Family, c: Cfg): Part {
  const { w, d, h } = c;
  // All families are CENTRED on the origin → negative coordinates everywhere.
  const rect: P2[] = [{ x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: d / 2 }, { x: -w / 2, y: d / 2 }];
  const zBase = { z0: -h / 2, z1: h / 2 };
  const through = { z0: -h, z1: h };

  switch (fam) {
    case 'box':
      return { base: { loop: rect, ...zBase }, tools: [] };
    case 'lshape': {
      const loop: P2[] = [
        { x: -w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 }, { x: w / 2, y: -d / 2 + d * 0.40 },
        { x: -w / 2 + w * 0.40, y: -d / 2 + d * 0.40 }, { x: -w / 2 + w * 0.40, y: d / 2 }, { x: -w / 2, y: d / 2 },
      ];
      return { base: { loop, ...zBase }, tools: [] };
    }
    case 'skew': {
      const s = c.skew * w;
      const loop: P2[] = [
        { x: -w / 2 - s / 2, y: -d / 2 }, { x: w / 2 - s / 2, y: -d / 2 },
        { x: w / 2 + s / 2, y: d / 2 }, { x: -w / 2 + s / 2, y: d / 2 },
      ];
      return { base: { loop, ...zBase }, tools: [] };
    }
    case 'movingHole': {
      const a = Math.min(w, d) * 0.13;
      const cx = -w / 2 + c.holeX * w, cy = -d / 2 + c.holeY * d;
      return { base: { loop: rect, ...zBase }, tools: [{ id: 'H0', loop: sq(cx, cy, a), ...through }] };
    }
    case 'cornerHoleBait': {
      const a = Math.min(w, d) * 0.10;
      const cx = -w / 2 + a * 2.2, cy = -d / 2 + a * 2.2;
      return { base: { loop: rect, ...zBase }, tools: [{ id: 'B0', loop: sq(cx, cy, a), ...through }] };
    }
  }
}

/** The S2b topology change: a SECOND through hole inserted after authoring. */
function addSecondHole(p: Part, c: Cfg): Part {
  const a = Math.min(c.w, c.d) * 0.13;
  const cx = -c.w / 2 + 0.82 * c.w, cy = -c.d / 2 + 0.18 * c.d;
  return { base: p.base, tools: [...p.tools, { id: 'H1', loop: sq(cx, cy, a), z0: -c.h, z1: c.h }] };
}

// ─── analytic B-rep edge set ─────────────────────────────────────────────────

interface LabelledEdge { label: string; sig: EdgeSig }

function ring(tag: string, loop: P2[], zLo: number, zHi: number): LabelledEdge[] {
  const out: LabelledEdge[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    out.push({
      label: `${tag}.vert.${i}`,
      sig: { mid: [loop[i]!.x, loop[i]!.y, (zLo + zHi) / 2], dir: [0, 0, 1], length: zHi - zLo },
    });
  }
  for (const [suffix, z] of [['bot', zLo], ['top', zHi]] as Array<[string, number]>) {
    for (let i = 0; i < n; i++) {
      const a = loop[i]!, b = loop[(i + 1) % n]!;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      out.push({
        label: `${tag}.${suffix}.${i}`,
        sig: { mid: [(a.x + b.x) / 2, (a.y + b.y) / 2, z], dir: [dx / len, dy / len, 0], length: len },
      });
    }
  }
  return out;
}

/** Exact edge set of `base minus each fully-interior through tool`. */
function edgesOf(p: Part): LabelledEdge[] {
  const out = ring('base', p.base.loop, p.base.z0, p.base.z1);
  for (const t of p.tools) {
    out.push(...ring(t.id, t.loop, Math.max(t.z0, p.base.z0), Math.min(t.z1, p.base.z1)));
  }
  return out;
}

function bboxOf(p: Part): BBox3 {
  const xs = p.base.loop.map(v => v.x), ys = p.base.loop.map(v => v.y);
  return {
    min: [Math.min(...xs), Math.min(...ys), p.base.z0],
    max: [Math.max(...xs), Math.max(...ys), p.base.z1],
  };
}

// ─── scoring ─────────────────────────────────────────────────────────────────

type Verdict = 'ok' | 'lost' | 'mismatch';

/** One reference resolution, recorded WITHOUT any gate applied. Because the
 *  gate is a pure function of (bestScore, runnerUpScore), replaying a threshold
 *  pair over these records is exactly equivalent to re-running the matcher. */
interface Record_ {
  scenario: string;
  /** Verdict of the raw nearest-candidate matcher. */
  raw: Verdict;
  score: number;
  runnerUpScore: number;
}

/** Resolve a stored reference against a rebuilt part, ungated. */
function resolveRaw(
  stored: { sig: EdgeSig; bbox: BBox3; label: string },
  now: { edges: LabelledEdge[]; bbox: BBox3 },
): Record_ | null {
  const gtIndex = now.edges.findIndex(e => e.label === stored.label);
  if (gtIndex < 0) return null; // edge genuinely gone — excluded from rates (spike's `nogt`)

  const mid = remapPointThroughBbox(stored.sig.mid, stored.bbox, now.bbox);
  const scale = Math.max(
    now.bbox.max[0] - now.bbox.min[0],
    now.bbox.max[1] - now.bbox.min[1],
    now.bbox.max[2] - now.bbox.min[2],
  );
  const r = bestEdgeMatch({ ...stored.sig, mid }, now.edges.map(e => e.sig), { scale, ungated: true });
  return {
    scenario: '',
    raw: r.index < 0 ? 'lost' : r.index === gtIndex ? 'ok' : 'mismatch',
    score: r.score,
    runnerUpScore: r.runnerUpScore,
  };
}

/** Replay a threshold pair over recorded (best, runner-up) scores. */
function applyGate(rec: Record_, minScore: number, minMargin: number): Verdict {
  if (rec.raw === 'lost') return 'lost';
  if (rec.score < minScore) return 'lost';
  if (rec.score - rec.runnerUpScore < minMargin) return 'lost';
  return rec.raw;
}

interface Rates { n: number; okPct: number; lostPct: number; mismatchPct: number }
function rates(recs: Record_[], minScore: number, minMargin: number): Rates {
  let ok = 0, lost = 0, mismatch = 0;
  for (const r of recs) {
    const v = applyGate(r, minScore, minMargin);
    if (v === 'ok') ok++; else if (v === 'lost') lost++; else mismatch++;
  }
  const n = recs.length || 1;
  const pct = (x: number) => Number(((x / n) * 100).toFixed(1));
  return { n: recs.length, okPct: pct(ok), lostPct: pct(lost), mismatchPct: pct(mismatch) };
}

// ─── scenario corpus ─────────────────────────────────────────────────────────

/**
 * S1  extrude-only families → dimension change      (spike S1)
 * S2  boolean-cut families → dimension change       (spike S2)
 * S2b movingHole → SECOND cut inserted, then dims   (spike S2b)
 * S4  box authored, then a cut inserted mid-tree    (spike S4)
 */
function buildCorpus(): Record_[] {
  const out: Record_[] = [];
  const push = (scenario: string, r: Record_ | null) => { if (r) out.push({ ...r, scenario }); };

  const authorOf = (fam: Family, c: Cfg) => {
    const p = buildPart(fam, c);
    return { edges: edgesOf(p), bbox: bboxOf(p) };
  };

  for (const fam of FAMILIES) {
    const scenario = fam === 'movingHole' || fam === 'cornerHoleBait' ? 'S2' : 'S1';
    const a0 = authorOf(fam, BASE_CFG);
    for (const c1 of SWEEP) {
      const p1 = buildPart(fam, c1);
      const now = { edges: edgesOf(p1), bbox: bboxOf(p1) };
      for (const e of a0.edges) push(scenario, resolveRaw({ sig: e.sig, bbox: a0.bbox, label: e.label }, now));
    }
  }

  // S2b — author on movingHole, then a second hole appears AND dimensions change.
  {
    const a0 = authorOf('movingHole', BASE_CFG);
    for (const c1 of SWEEP) {
      const p1 = addSecondHole(buildPart('movingHole', c1), c1);
      const now = { edges: edgesOf(p1), bbox: bboxOf(p1) };
      for (const e of a0.edges) push('S2b', resolveRaw({ sig: e.sig, bbox: a0.bbox, label: e.label }, now));
    }
  }

  // S4 — author on a plain box, then a cut is inserted mid-tree (no dim change).
  for (const c1 of SWEEP) {
    const a0 = authorOf('box', c1);
    const p1: Part = { base: buildPart('box', c1).base, tools: buildPart('movingHole', c1).tools };
    const now = { edges: edgesOf(p1), bbox: bboxOf(p1) };
    for (const e of a0.edges) push('S4', resolveRaw({ sig: e.sig, bbox: a0.bbox, label: e.label }, now));
  }

  return out;
}

const CORPUS = buildCorpus();
const UNGATED = { minScore: -Infinity, minMargin: -Infinity };

// ─── tests ───────────────────────────────────────────────────────────────────

describe('W1-C — edge match confidence + runner-up margin gate (ADR-017 §D1)', () => {
  it('corpus is large enough to draw a conclusion from', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(1000);
  });

  it('BASELINE: the ungated matcher never reports a loss — every failure is silent', () => {
    const r = rates(CORPUS, UNGATED.minScore, UNGATED.minMargin);
    // This is the ADR-017 finding restated as an executable assertion: the raw
    // matcher's `lost` rate is 0, so mismatchPct is the ENTIRE failure mass.
    expect(r.lostPct).toBe(0);
    expect(r.mismatchPct).toBeGreaterThan(0);
    expect(Number((r.okPct + r.mismatchPct).toFixed(1))).toBe(100);
     
    console.log('[W1-C] ungated baseline:', r);
  });

  it('THRESHOLD SWEEP: picks the cheapest setting that reaches zero mismatch', () => {
    const scoreGrid = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const marginGrid = [0, 0.01, 0.02, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.15, 0.2, 0.3, 0.5];

    let best: { minScore: number; minMargin: number; r: Rates } | null = null;
    const table: string[] = [];
    for (const s of scoreGrid) {
      for (const m of marginGrid) {
        const r = rates(CORPUS, s, m);
        // Objective: zero silent mismatch FIRST, then maximum survival. Ties go
        // to the least restrictive setting (lowest score floor, then margin) so
        // we never over-tighten for a gain the data doesn't show.
        if (r.mismatchPct === 0) {
          const better = !best || r.okPct > best.r.okPct
            || (r.okPct === best.r.okPct && (s < best.minScore || (s === best.minScore && m < best.minMargin)));
          if (better) best = { minScore: s, minMargin: m, r };
        }
        if (s === 0) {
          table.push(`  minScore=${s.toFixed(2)} minMargin=${m.toFixed(2)} → ok ${r.okPct}% lost ${r.lostPct}% MISMATCH ${r.mismatchPct}%`);
        }
      }
    }
     
    console.log('[W1-C] sweep (excerpt):\n' + table.join('\n'));
     
    console.log('[W1-C] best zero-mismatch setting:', best);

    expect(best).not.toBeNull();
    // The shipped constants must BE the sweep optimum — not a nearby guess.
    // If this fails, the comment in edgeCorrespondence.ts has rotted: re-derive.
    expect({ minScore: MIN_CONFIDENCE_SCORE, minMargin: MIN_MARGIN })
      .toEqual({ minScore: best!.minScore, minMargin: best!.minMargin });
  });

  it('ACCEPTANCE: the shipped gate converts every silent mismatch into an explicit loss', () => {
    const before = rates(CORPUS, UNGATED.minScore, UNGATED.minMargin);
    const after = rates(CORPUS, MIN_CONFIDENCE_SCORE, MIN_MARGIN);
     
    console.log('[W1-C] BEFORE:', before, '\n[W1-C] AFTER :', after);

    expect(after.mismatchPct).toBe(0);          // ← the acceptance criterion
    expect(after.lostPct).toBeGreaterThan(before.lostPct);
    // Survival is allowed to fall, but the loss must be reported, not invented.
    expect(after.okPct).toBeLessThanOrEqual(before.okPct);
    expect(Number((after.okPct + after.lostPct).toFixed(1))).toBe(100);
  });

  it('per-scenario before/after (the ADR-017 table, re-measured)', () => {
    const rows: Record<string, { before: Rates; after: Rates }> = {};
    for (const s of ['S1', 'S2', 'S2b', 'S4']) {
      const sub = CORPUS.filter(r => r.scenario === s);
      rows[s] = {
        before: rates(sub, UNGATED.minScore, UNGATED.minMargin),
        after: rates(sub, MIN_CONFIDENCE_SCORE, MIN_MARGIN),
      };
      expect(sub.length).toBeGreaterThan(0);
      expect(rows[s]!.after.mismatchPct).toBe(0);
    }
     
    console.log('[W1-C] per-scenario:', JSON.stringify(rows, null, 2));
  });

  // ─── behavioural contract of the gate itself ───────────────────────────────

  const box = (w: number): EdgeSig[] => {
    const x = w / 2, y = 20, z = 20;
    const s: EdgeSig[] = [];
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) s.push({ mid: [0, sy * y, sz * z], dir: [1, 0, 0], length: w });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.push({ mid: [sx * x, 0, sz * z], dir: [0, 1, 0], length: 40 });
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) s.push({ mid: [sx * x, sy * y, 0], dir: [0, 0, 1], length: 40 });
    return s;
  };

  it('an unambiguous match still resolves, and reports its margin', () => {
    const cands = box(40);
    const r = bestEdgeMatch({ mid: [0, 20, 20], dir: [1, 0, 0], length: 40 }, cands, { scale: 40 });
    expect(r.lost).toBe(false);
    expect(r.index).toBe(cands.findIndex(c => c.mid[1] === 20 && c.mid[2] === 20 && c.dir[0] === 1));
    expect(r.margin).toBeGreaterThanOrEqual(MIN_MARGIN);
    expect(r.rejectedIndex).toBe(-1);
  });

  it('a dead-centre tie between two identical candidates is REFUSED as ambiguous', () => {
    // Two parallel edges, target exactly equidistant → the matcher cannot know.
    const cands: EdgeSig[] = [
      { mid: [0, 0, 0], dir: [1, 0, 0], length: 10 },
      { mid: [0, 10, 0], dir: [1, 0, 0], length: 10 },
    ];
    const r = bestEdgeMatch({ mid: [0, 5, 0], dir: [1, 0, 0], length: 10 }, cands, { scale: 10 });
    expect(r.lost).toBe(true);
    expect(r.reason).toBe('ambiguous');
    expect(r.margin).toBeLessThan(MIN_MARGIN);
    // It still tells the caller WHICH edge it would have guessed, for a
    // "did you mean…?" prompt — but refuses to apply it silently.
    expect(r.rejectedIndex).toBeGreaterThanOrEqual(0);
  });

  it('a far-away lone candidate is REFUSED as low confidence, not accepted by default', () => {
    const cands: EdgeSig[] = [{ mid: [500, 500, 500], dir: [1, 0, 0], length: 10 }];
    const r = bestEdgeMatch({ mid: [0, 0, 0], dir: [1, 0, 0], length: 10 }, cands, { scale: 10 });
    expect(r.lost).toBe(true);
    expect(r.reason).toBe('low_confidence');
    expect(r.rejectedIndex).toBe(0);
    expect(r.margin).toBe(Infinity); // unopposed, yet still not trustworthy
  });

  it('no candidates / no parallel candidate are distinguishable reasons', () => {
    const empty = bestEdgeMatch({ mid: [0, 0, 0], dir: [1, 0, 0], length: 10 }, []);
    expect(empty.reason).toBe('no_candidates');
    const perp = bestEdgeMatch(
      { mid: [0, 0, 0], dir: [1, 0, 0], length: 10 },
      [{ mid: [0, 0, 0], dir: [0, 1, 0], length: 10 }],
    );
    expect(perp.reason).toBe('no_parallel_candidate');
    expect(perp.index).toBe(-1);
  });

  it('`ungated` restores the old guess-anyway behaviour (documented escape hatch)', () => {
    const cands: EdgeSig[] = [{ mid: [500, 500, 500], dir: [1, 0, 0], length: 10 }];
    const r = bestEdgeMatch({ mid: [0, 0, 0], dir: [1, 0, 0], length: 10 }, cands, { scale: 10, ungated: true });
    expect(r.lost).toBe(false);
    expect(r.index).toBe(0);
  });
});
