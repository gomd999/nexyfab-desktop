/**
 * refRelink.ts — R5: lost-reference inventory + one-click relink engine.
 *
 * ADR-017 §D1 made the rebuild pipeline REFUSE instead of guess: the margin
 * gate reports `lost` (topologyEdgeFinder → makeReferenceLostNotice, severity
 * 'blocked'), stale naming-scheme names report `legacy-role`/`legacy-seam`
 * (composedTopo), and a name that simply no longer exists reports `unknown` /
 * an `unresolved-ref` measure failure. S4 measured 0% mismatch with 100%
 * EXPLICIT loss — the roadmap's verdict is that this is correct behaviour, and
 * the product answer is not to weaken the gate but to make the loss ACTIONABLE:
 *
 *   1. `collectLostRefs`   — one rebuild result → the full list of lost
 *                            references (which consumer, why, what we knew
 *                            about the old anchor).
 *   2. `suggestRelinkCandidates` — ranked candidates for a lost ref using the
 *                            SAME scorer the gate itself uses (bestEdgeMatch),
 *                            with the score/margin numbers exposed. When no
 *                            candidate clears the calibrated gate the result
 *                            says so explicitly (`hasConfidentCandidate:
 *                            false`) — the engine NEVER auto-relinks.
 *   3. `applyRelink`       — user-confirmed substitution of one reference,
 *                            returning the updated consumer (immutably) plus a
 *                            RelinkRecord for the audit trail.
 *
 * Two reference channels exist in the codebase and both are covered:
 *
 *   - 'edge-selection' — geometric `EdgeSelectionInfo` stored on features
 *     (fillet/chamfer/variable fillet). Loss surfaces as a MeshDowngradeNotice
 *     with i18nKey 'reference.lost' whose `detail` is the EdgeMatchRejection.
 *     Candidates are the current solid's `EdgeSig`s (occtEdgeSignatures).
 *   - 'named' — stable topo names (`e.vert.3`, `base/e.vert.0`,
 *     `op1/seam(...)`) stored on drawing dimensions (Dimension.refs) and any
 *     other name-keyed consumer. Loss is `anchor(name) === null` on the
 *     current EdgeAnchorSource; the reason comes from `lossReason(name)`.
 *
 * Honesty rules (근사 명시 · 날조 금지):
 *   - Edge-selection ranking uses the calibrated scorer verbatim; `confident`
 *     is true ONLY for the candidate the full margin gate itself would accept.
 *   - Named-ref ranking has midpoint anchors only (no direction/length), which
 *     is NOT the calibrated gate — so named candidates are ranked by distance
 *     but are NEVER marked confident (`note: 'midpoint-only-ranking'`).
 *   - A lost ref with no prior anchor gets NO ranking at all
 *     (`note: 'no-prior-anchor'`) — an unranked name list is offered, nothing
 *     is scored, and the UI should push the user to re-select in the viewport.
 *
 * Pure + framework-free: unit-tests without OCCT WASM or React.
 */

import type { EdgeSelectionInfo } from '../editing/selectionInfo';
import type { MeshDowngradeNotice } from './downgradeNotice';
import {
  bestEdgeMatch,
  MIN_CONFIDENCE_SCORE,
  MIN_MARGIN,
  type EdgeMatchRejection,
  type EdgeSig,
} from './edgeCorrespondence';
import type { EdgeAnchorSource, LossReason } from '@/lib/cad/composedTopo';
import type { BBox3 } from './topologyEdgeFinder';

type Triple = [number, number, number];

// ─── lost-reference inventory ────────────────────────────────────────────────

/**
 * Union of every explicit-loss vocabulary in the pipeline:
 *  - EdgeMatchRejection (margin gate: 'no_candidates' | 'no_parallel_candidate'
 *    | 'low_confidence' | 'ambiguous')
 *  - LossReason (composed naming: 'unknown' | 'ambiguous' | 'legacy-role' |
 *    'legacy-seam')
 *  - 'unresolved-ref' (a name the current anchor source cannot resolve and
 *    diagnoses no further — same word the drawing measure layer uses)
 */
export type LostRefReason = EdgeMatchRejection | LossReason | 'unresolved-ref';

const EDGE_MATCH_REJECTIONS: ReadonlySet<string> = new Set([
  'no_candidates', 'no_parallel_candidate', 'low_confidence', 'ambiguous',
]);

export type RefConsumerType = 'feature' | 'dimension' | 'mate';

/** What we still know about the lost reference's old geometry. */
export interface LostRefAnchor {
  /** Last known midpoint / click point (mm, world). */
  position?: Triple;
  /** Unit edge direction, when the stored selection captured one. */
  direction?: Triple;
  /** Edge length (mm), when known. */
  length?: number;
}

export interface LostRef {
  /** Stable within one collection pass: `<type>:<consumerId>#<slot>`. */
  id: string;
  consumer: { type: RefConsumerType; id: string; label: string };
  kind: 'edge-selection' | 'named';
  /** 'named' only — the name that failed to resolve. */
  name?: string;
  /** 'edge-selection' only — index into the feature's edgeSelections, when the
   *  loss is attributable to exactly one stored selection. */
  selectionIndex?: number;
  reason: LostRefReason;
  /** null = no prior geometry is known (e.g. a legacy name with no anchor). */
  anchor: LostRefAnchor | null;
}

export interface FeatureRefInput {
  id: string;
  /** Display label, e.g. 'Fillet'. */
  op?: string;
  edgeSelections?: readonly EdgeSelectionInfo[];
}

export interface NamedRefInput {
  id: string;
  label?: string;
  /** Stable topology names this consumer references (Dimension.refs shape). */
  refs: readonly string[];
}

export interface CollectLostRefsInput {
  /** Downgrade notices collected off the rebuilt geometry
   *  (downgradeNotice.collectDowngrades). Only 'reference.lost' entries are
   *  reference losses; everything else is ignored here. */
  notices?: readonly MeshDowngradeNotice[];
  /** Features whose stored edge selections the notices refer to (by featureId). */
  features?: readonly FeatureRefInput[];
  /** Name-keyed consumers, resolved against `anchors`. */
  dimensions?: readonly NamedRefInput[];
  mates?: readonly NamedRefInput[];
  /** CURRENT topology the named refs must resolve against. */
  anchors?: EdgeAnchorSource;
  /** PREVIOUS topology (pre-rebuild), used only to recover the lost name's old
   *  anchor for candidate ranking. Optional — without it, named losses have
   *  `anchor: null` and get no geometric ranking. */
  priorAnchors?: EdgeAnchorSource;
}

function tripleOf(v: { x: number; y: number; z: number } | null): Triple | undefined {
  return v ? [v.x, v.y, v.z] : undefined;
}

/**
 * Enumerate every lost reference in one rebuild result.
 *
 * Edge-selection channel: a 'reference.lost' notice names the refusing feature
 * (featureId) and the gate's reason (detail). The stored selection is attached
 * when the feature has EXACTLY one — the current producers (fillet/chamfer/
 * variable fillet) only signature-resolve single selections, and attributing a
 * multi-selection loss to one member would be a guess.
 *
 * Named channel: every ref of every dimension/mate is resolved against
 * `anchors`; `anchor(name) === null` is a loss, with the reason taken from the
 * source's own `lossReason` diagnosis when it offers one.
 */
export function collectLostRefs(input: CollectLostRefsInput): LostRef[] {
  const out: LostRef[] = [];
  const seen = new Set<string>();

  const featureById = new Map<string, FeatureRefInput>();
  for (const f of input.features ?? []) featureById.set(f.id, f);

  for (const n of input.notices ?? []) {
    if (n.i18nKey !== 'reference.lost') continue;
    const consumerId = n.featureId ?? `op:${n.op}`;
    const reason: LostRefReason =
      n.detail && EDGE_MATCH_REJECTIONS.has(n.detail) ? (n.detail as EdgeMatchRejection) : 'unknown';
    const feature = n.featureId ? featureById.get(n.featureId) : undefined;
    const sels = feature?.edgeSelections ?? [];
    const single = sels.length === 1 ? sels[0]! : undefined;
    const id = `feature:${consumerId}#sel${single ? 0 : '?'}`;
    const dedupeKey = `${id}|${reason}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      id,
      consumer: { type: 'feature', id: consumerId, label: feature?.op ?? n.op },
      kind: 'edge-selection',
      ...(single ? { selectionIndex: 0 } : {}),
      reason,
      anchor: single
        ? {
            position: single.position,
            ...(single.direction ? { direction: single.direction } : {}),
            ...(Number.isFinite(single.length) && single.length > 0 ? { length: single.length } : {}),
          }
        : null,
    });
  }

  const collectNamed = (type: 'dimension' | 'mate', consumers?: readonly NamedRefInput[]): void => {
    if (!consumers || !input.anchors) return;
    for (const c of consumers) {
      const uniqueRefs = [...new Set(c.refs)];
      for (const name of uniqueRefs) {
        if (input.anchors.anchor(name) !== null) continue; // resolves — not lost
        const id = `${type}:${c.id}#${name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const reason: LostRefReason = input.anchors.lossReason?.(name) ?? 'unresolved-ref';
        const prior = tripleOf(input.priorAnchors?.anchor(name) ?? null);
        out.push({
          id,
          consumer: { type, id: c.id, label: c.label ?? c.id },
          kind: 'named',
          name,
          reason,
          anchor: prior ? { position: prior } : null,
        });
      }
    }
  };
  collectNamed('dimension', input.dimensions);
  collectNamed('mate', input.mates);

  return out;
}

// ─── candidate suggestion ────────────────────────────────────────────────────

export type RelinkTarget =
  | { kind: 'sig'; sigIndex: number; sig: EdgeSig }
  | { kind: 'name'; name: string };

export interface RelinkCandidate {
  target: RelinkTarget;
  /** Candidate midpoint (mm, world) for display / viewport highlight. */
  anchor: Triple;
  /** Score from the SAME scorer as the rebuild-time margin gate
   *  (bestEdgeMatch). null on the named channel — midpoint-only ranking has no
   *  gate-comparable score, and inventing one would be fabrication. */
  score: number | null;
  /** |candidate anchor − lost anchor| in mm; null when no prior anchor. */
  distance: number | null;
  /** True ONLY when the full calibrated margin gate would accept this
   *  candidate on its own (edge-selection channel). Named-channel candidates
   *  are never confident. */
  confident: boolean;
}

export type RelinkSuggestionNote =
  /** Edge channel: the top candidate passes the calibrated gate. */
  | 'gated-match'
  /** Edge channel: candidates exist but none clears the confidence/margin
   *  gate — "확신 후보 없음". One-click apply stays available because the USER
   *  confirms; the engine itself will not pick. */
  | 'below-gate'
  /** Edge channel: no candidate is parallel to the stored direction. */
  | 'no-parallel-candidate'
  /** No candidates at all in the current topology. */
  | 'no-candidates'
  /** Named channel: ranked by midpoint distance only — NOT the calibrated
   *  gate; treat the order as a hint, never as identification. */
  | 'midpoint-only-ranking'
  /** No prior anchor is known: nothing can be ranked; the list (if any) is
   *  alphabetical. Prefer re-selection in the viewport. */
  | 'no-prior-anchor';

export interface RelinkSuggestion {
  lostRefId: string;
  /** Ranked best-first (score desc on the edge channel, distance asc on the
   *  named channel, alphabetical when unrankable). At most `maxCandidates`. */
  candidates: RelinkCandidate[];
  hasConfidentCandidate: boolean;
  /** Gate margin of the top candidate over the whole candidate set (edge
   *  channel, ≥2 eligible candidates); null when not applicable. */
  margin: number | null;
  gate: { minScore: number; minMargin: number };
  note: RelinkSuggestionNote;
}

export interface RelinkTopology {
  /** Current solid's edge signatures (edge-selection channel candidates). */
  edgeSigs?: readonly EdgeSig[];
  /** Current named topology (named channel candidates). */
  anchors?: EdgeAnchorSource;
}

export interface SuggestOptions {
  /** Max candidates returned (default 5). */
  maxCandidates?: number;
  /** Length scale (≈ part size, mm) for the scorer's midpoint term — pass the
   *  same value the rebuild gate used for comparable numbers. */
  scale?: number;
}

function dist3(a: Triple, b: Triple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Rank relink candidates for one lost reference. Reuses `bestEdgeMatch` — the
 * exact scorer + gate the rebuild pipeline refused with — so the numbers shown
 * to the user are the numbers the gate saw.
 */
export function suggestRelinkCandidates(
  lostRef: LostRef,
  topo: RelinkTopology,
  opts: SuggestOptions = {},
): RelinkSuggestion {
  const maxN = Math.max(1, opts.maxCandidates ?? 5);
  const gate = { minScore: MIN_CONFIDENCE_SCORE, minMargin: MIN_MARGIN };
  const base = { lostRefId: lostRef.id, gate };

  if (lostRef.kind === 'edge-selection') {
    const sigs = topo.edgeSigs ?? [];
    if (sigs.length === 0) {
      return { ...base, candidates: [], hasConfidentCandidate: false, margin: null, note: 'no-candidates' };
    }
    const pos = lostRef.anchor?.position;
    const dir = lostRef.anchor?.direction;
    if (!pos) {
      return { ...base, candidates: [], hasConfidentCandidate: false, margin: null, note: 'no-prior-anchor' };
    }
    if (!dir) {
      // No stored direction → the calibrated scorer cannot run (its dominant
      // term is direction alignment). Distance-only ranking, never confident.
      const ranked = sigs
        .map((sig, sigIndex) => ({
          target: { kind: 'sig' as const, sigIndex, sig },
          anchor: sig.mid,
          score: null,
          distance: dist3(pos, sig.mid),
          confident: false,
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, maxN);
      return { ...base, candidates: ranked, hasConfidentCandidate: false, margin: null, note: 'midpoint-only-ranking' };
    }

    const target: EdgeSig = { mid: pos, dir, length: lostRef.anchor?.length ?? 0 };
    const matchOpts = opts.scale ? { scale: opts.scale } : {};
    // Full-set gate verdict — identical to what the rebuild pipeline ran.
    const gateResult = bestEdgeMatch(target, [...sigs], matchOpts);
    // Per-candidate raw score via the same scorer (ungated singleton run).
    const scored = sigs
      .map((sig, sigIndex) => {
        const r = bestEdgeMatch(target, [sig], { ...matchOpts, ungated: true });
        return { sig, sigIndex, eligible: !r.lost, score: r.score };
      })
      .filter((c) => c.eligible)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return { ...base, candidates: [], hasConfidentCandidate: false, margin: null, note: 'no-parallel-candidate' };
    }
    const candidates: RelinkCandidate[] = scored.slice(0, maxN).map((c) => ({
      target: { kind: 'sig', sigIndex: c.sigIndex, sig: c.sig },
      anchor: c.sig.mid,
      score: c.score,
      distance: dist3(pos, c.sig.mid),
      confident: !gateResult.lost && gateResult.index === c.sigIndex,
    }));
    const hasConfident = candidates.some((c) => c.confident);
    return {
      ...base,
      candidates,
      hasConfidentCandidate: hasConfident,
      margin: Number.isFinite(gateResult.margin) ? gateResult.margin : null,
      note: hasConfident ? 'gated-match' : 'below-gate',
    };
  }

  // Named channel.
  const src = topo.anchors;
  const names = src?.names() ?? [];
  const withAnchors = names
    .map((name) => ({ name, anchor: tripleOf(src!.anchor(name)) }))
    .filter((n): n is { name: string; anchor: Triple } => n.anchor !== undefined);
  if (withAnchors.length === 0) {
    return { ...base, candidates: [], hasConfidentCandidate: false, margin: null, note: 'no-candidates' };
  }
  const pos = lostRef.anchor?.position;
  if (!pos) {
    const candidates: RelinkCandidate[] = withAnchors
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, maxN)
      .map((n) => ({
        target: { kind: 'name', name: n.name },
        anchor: n.anchor,
        score: null,
        distance: null,
        confident: false,
      }));
    return { ...base, candidates, hasConfidentCandidate: false, margin: null, note: 'no-prior-anchor' };
  }
  const candidates: RelinkCandidate[] = withAnchors
    .map((n) => ({
      target: { kind: 'name' as const, name: n.name },
      anchor: n.anchor,
      score: null,
      distance: dist3(pos, n.anchor),
      confident: false, // midpoint-only proximity is not the calibrated gate — never confident
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxN);
  return { ...base, candidates, hasConfidentCandidate: false, margin: null, note: 'midpoint-only-ranking' };
}

// ─── apply ───────────────────────────────────────────────────────────────────

export type RelinkableConsumer =
  | { type: 'feature'; id: string; op?: string; edgeSelections: readonly EdgeSelectionInfo[] }
  | { type: 'dimension' | 'mate'; id: string; refs: readonly string[] };

/** Audit-trail entry for one applied relink. */
export interface RelinkRecord {
  at: number;
  consumerType: RefConsumerType;
  consumerId: string;
  lostRefId: string;
  reason: LostRefReason;
  /** Old reference: the lost name, or `@(x,y,z)` for a geometric selection. */
  from: string;
  /** New reference: the chosen name, or `@(x,y,z)` of the chosen edge. */
  to: string;
  /** Whether the applied candidate had passed the calibrated gate. */
  confident: boolean;
}

function fmtPoint(p: Triple): string {
  const f = (n: number) => String(Number(n.toFixed(3)));
  return `@(${f(p[0])},${f(p[1])},${f(p[2])})`;
}

/** One-line human-readable form of a relink record (for history panes/logs). */
export function formatRelinkRecord(r: RelinkRecord): string {
  return `[${r.consumerType}:${r.consumerId}] ${r.from} → ${r.to}` +
    ` (reason: ${r.reason}${r.confident ? ', gate-confident' : ', user-confirmed'})`;
}

export interface ApplyRelinkOptions {
  /** Timestamp for the record (default Date.now()) — injectable for tests. */
  at?: number;
  /** Whether the chosen candidate was gate-confident (RelinkCandidate.confident). */
  confident?: boolean;
  /** Current solid bbox: stamped onto a relinked edge selection so the next
   *  rebuild remaps from CURRENT geometry, not the stale pre-loss bbox. */
  currentBbox?: BBox3;
}

export interface ApplyRelinkResult {
  consumer: RelinkableConsumer;
  record: RelinkRecord;
}

/**
 * Substitute one lost reference with a user-chosen candidate. Immutable: the
 * input consumer is not touched; the updated copy + audit record are returned.
 *
 * Refusals (thrown Error, never a silent partial apply):
 *   - consumer/lostRef mismatch (wrong consumer id or channel/target shape)
 *   - edge-selection loss that is not attributable to one stored selection
 *   - named loss whose name is not among the consumer's refs
 *
 * Approximation (명시): a relinked edge selection keeps the OLD face normal —
 * an EdgeSig carries no face normal. The normal only feeds loop-direction
 * inference for MULTI-edge selections, which this path (single selection)
 * never reaches; direction + position, which the resolver actually anchors
 * with, come from the chosen candidate exactly.
 */
export function applyRelink(
  consumer: RelinkableConsumer,
  lostRef: LostRef,
  target: RelinkTarget,
  opts: ApplyRelinkOptions = {},
): ApplyRelinkResult {
  if (consumer.id !== lostRef.consumer.id || consumer.type !== lostRef.consumer.type) {
    throw new Error(
      `applyRelink: consumer ${consumer.type}:${consumer.id} does not own lost ref ${lostRef.id}`,
    );
  }
  const at = opts.at ?? Date.now();
  const confident = opts.confident ?? false;

  if (consumer.type === 'feature') {
    if (lostRef.kind !== 'edge-selection' || target.kind !== 'sig') {
      throw new Error(
        `applyRelink: feature ${consumer.id} takes an edge-signature target, got kind '${target.kind}' for a '${lostRef.kind}' ref`,
      );
    }
    const idx = lostRef.selectionIndex;
    if (idx === undefined || idx < 0 || idx >= consumer.edgeSelections.length) {
      throw new Error(
        `applyRelink: lost ref ${lostRef.id} is not attributable to one stored selection — re-select in the viewport instead`,
      );
    }
    const old = consumer.edgeSelections[idx]!;
    const next: EdgeSelectionInfo = {
      type: 'edge',
      position: [...target.sig.mid] as Triple,
      direction: [...target.sig.dir] as Triple,
      length: target.sig.length,
      // Approximation (see JSDoc): EdgeSig has no face normal — keep the old one.
      normal: old.normal,
      // Stale bbox must NOT survive the relink (it belongs to the pre-loss
      // geometry); anchor to the current bbox when the caller provides it.
      ...(opts.currentBbox ? { bbox: opts.currentBbox } : {}),
      ...(old.partName !== undefined ? { partName: old.partName } : {}),
    };
    const edgeSelections = consumer.edgeSelections.map((s, i) => (i === idx ? next : s));
    return {
      consumer: { ...consumer, edgeSelections },
      record: {
        at,
        consumerType: consumer.type,
        consumerId: consumer.id,
        lostRefId: lostRef.id,
        reason: lostRef.reason,
        from: fmtPoint(old.position),
        to: fmtPoint(target.sig.mid),
        confident,
      },
    };
  }

  // dimension / mate — name substitution.
  if (lostRef.kind !== 'named' || target.kind !== 'name' || !lostRef.name) {
    throw new Error(
      `applyRelink: ${consumer.type} ${consumer.id} takes a name target for a named ref, got target '${target.kind}' for a '${lostRef.kind}' ref`,
    );
  }
  if (!consumer.refs.includes(lostRef.name)) {
    throw new Error(
      `applyRelink: ${consumer.type} ${consumer.id} has no ref '${lostRef.name}' — nothing to relink`,
    );
  }
  const refs = consumer.refs.map((r) => (r === lostRef.name ? target.name : r));
  return {
    consumer: { ...consumer, refs },
    record: {
      at,
      consumerType: consumer.type,
      consumerId: consumer.id,
      lostRefId: lostRef.id,
      reason: lostRef.reason,
      from: lostRef.name,
      to: target.name,
      confident,
    },
  };
}
