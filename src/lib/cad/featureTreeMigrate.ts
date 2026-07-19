/**
 * featureTreeMigrate — W2-B: promoting saved trees to upstream references.
 *
 * See docs/design/w2-downstream-regen.md §5 for the design this implements.
 *
 * ─── the problem ────────────────────────────────────────────────────────
 *
 * W2-0 changed how a fillet names the body it rounds: from `childExtrude`
 * (a COPY of the upstream node, which goes stale the moment the upstream is
 * edited) to `childId` (a reference, resolved against the live tree at emit
 * time). Trees saved before W2-0 carry the copy. This module decides, per
 * node, whether that copy can be safely replaced by a reference.
 *
 * ─── the rule (and why it is this conservative) ─────────────────────────
 *
 *   childId already present            → nothing to do; already a reference
 *   exactly ONE extrude in dependencies → promote to that node          ★
 *   zero extrudes in dependencies       → keep legacy, record the reason
 *   two or more extrudes                → keep legacy, record the reason
 *   emitter does not honour childId yet → keep legacy, record the reason
 *
 * The last three branches are where the discipline lives. A fillet's
 * dependency list is the only *structural* evidence of which body it
 * consumes; when that evidence does not single out one candidate, there is
 * no honest way to pick. Matching the embedded snapshot's geometry against
 * the candidates would NOT help — under the pre-W2-0 bug an upstream edit
 * never reached the snapshot, so a snapshot that disagrees with its true
 * parent is the expected state, not evidence of a wrong parent. Using
 * geometric similarity as a tie-break would therefore prefer whichever node
 * was edited *least*, which is backwards.
 *
 * Refusing to promote costs the node its downstream-regeneration benefit
 * and nothing else: the legacy emission path is untouched, so the model
 * still opens and still renders. "Opens but is not parametric" beats
 * "wired to the wrong upstream" — a mis-wired reference produces silently
 * wrong geometry, the failure mode ADR-017 D1 exists to forbid.
 *
 * ─── where the reason is recorded ───────────────────────────────────────
 *
 * In the returned `PromotionReport`, not in the tree. Promotion is a pure
 * function of the tree, so the report is re-derived identically on every
 * load; persisting it would duplicate derivable state into the on-wire
 * schema, add diff noise for `diffTrees`, and risk the stored reason
 * drifting out of sync with the tree it describes. `formatPromotionReport`
 * renders it for a UI panel answering "why is this model not parametric?".
 */

import {
  syncEmbeddedSnapshots,
  upstreamRefsOf,
  type FeatureTree,
  type FeatureNode,
  type FeatureKind,
  type FeaturePayload,
} from './featureTree';
import type { ExtrudeFeature } from './extrudeProfile';

// ─── which kinds participate ──────────────────────────────────────────────

/**
 * Kinds that carry an embedded upstream *snapshot* (`childExtrude`) and so
 * are candidates for promotion at all.
 */
export const SNAPSHOT_KINDS: ReadonlySet<FeatureKind> = new Set<FeatureKind>([
  'fillet',
  'chamfer',
]);

/**
 * Kinds whose SCAD emitter actually *resolves* `childId` against the live
 * tree. Promoting a kind that is not in this set would be worse than
 * leaving it legacy:
 *
 *   - `upstreamRefsOf` would start reporting the ref, so `replayTree` marks
 *     the upstream as consumed (no longer emitted top-level) and cascades
 *     suppression through it,
 *   - while the emitter still reads the stale embedded snapshot.
 *
 * That combination changes what is rendered while delivering none of the
 * parametric benefit — a formally-promoted, functionally-stale node. So the
 * gate is the emitter's real capability, not the payload's shape.
 *
 * This list is a CLAIM about other modules, so it is not trusted on faith:
 * `__tests__/persistPromotion.test.ts` probes every kind in
 * `SNAPSHOT_KINDS` by actually editing an upstream and checking whether the
 * emitted body moves, and fails if this set disagrees. A kind converted by
 * a later wave therefore cannot be silently left out, and a kind listed
 * here that regresses cannot stay listed.
 */
export const REF_AWARE_EMITTERS: ReadonlySet<FeatureKind> = new Set<FeatureKind>([
  'fillet',
  'chamfer',
]);

/**
 * Kinds that consume an upstream body but store it in a form from which the
 * source node id is *unrecoverable* — the pattern features hold `childScad`,
 * already-rendered SCAD text (design note §2.2). There is no structural rule
 * that could recover the id, so these are reported as un-promotable rather
 * than silently ignored: a user asking "why is this model not parametric?"
 * needs to see them.
 */
const UNRECOVERABLE_KINDS: ReadonlySet<FeatureKind> = new Set<FeatureKind>([
  'linear_pattern',
  'circular_pattern',
]);

// ─── report shape ─────────────────────────────────────────────────────────

export type PromotionSkipReason =
  /** No dependency resolves to an extrude node — nothing to point at. */
  | 'no_extrude_dependency'
  /** Two or more extrude dependencies; the true parent is not determined. */
  | 'ambiguous_extrude_dependencies'
  /** Unambiguous, but this kind's emitter does not read `childId` yet. */
  | 'emitter_not_ref_aware'
  /** Upstream stored as rendered text; the source node id cannot be recovered. */
  | 'no_promotion_rule';

export interface PromotedEntry {
  id: string;
  kind: FeatureKind;
  /** The node the payload now references. */
  childId: string;
  /**
   * True when the embedded snapshot disagreed with the live upstream — i.e.
   * this node had drifted and its rendered geometry *will change* on the
   * next replay. Not a failure: it is the staleness W2-0 removes. Surfaced
   * because the change is user-visible.
   */
  snapshotDiverged: boolean;
}

export interface SkippedEntry {
  id: string;
  kind: FeatureKind;
  reason: PromotionSkipReason;
  /** Human-readable sentence; safe to show in a UI as-is. */
  message: string;
  /** Extrude dependencies considered, in declaration order. */
  candidates: ReadonlyArray<string>;
}

export interface PromotionReport {
  /** Nodes that gained a `childId`. */
  promoted: ReadonlyArray<PromotedEntry>;
  /** Nodes deliberately left on the legacy embedded path, with reasons. */
  skipped: ReadonlyArray<SkippedEntry>;
  /** Nodes that were already in reference mode before this pass. */
  alreadyRef: ReadonlyArray<string>;
  /** promoted + skipped + alreadyRef — the denominator for a promotion rate. */
  considered: number;
  /**
   * Set when embedded snapshots could NOT be re-synced because some
   * reference does not resolve to an in-tree extrude (a tree that
   * `validateTree` would also reject). The tree is returned un-synced and
   * otherwise unchanged; nothing is silently repaired.
   */
  syncSkippedReason?: string;
}

export interface PromotionResult {
  tree: FeatureTree;
  report: PromotionReport;
}

export interface PromotionOptions {
  /**
   * Override which kinds are treated as ref-aware. Defaults to
   * {@link REF_AWARE_EMITTERS}.
   *
   * Exists so the `emitter_not_ref_aware` branch stays exercisable: today
   * every snapshot-carrying kind happens to be converted, so without an
   * override that branch would have no live trigger and would rot. It also
   * gives a wave that converts a kind a way to stage the rollout.
   */
  refAwareKinds?: ReadonlySet<FeatureKind>;
}

// ─── the pass ─────────────────────────────────────────────────────────────

/**
 * Promote embedded upstream snapshots to `childId` references where — and
 * only where — the dependency graph determines the parent unambiguously.
 *
 * Pure: `tree` is not mutated. Nodes with nothing to change are passed
 * through *by reference*, so `diffTrees`' identity comparison still reports
 * them as unchanged.
 *
 * Idempotent: running it on its own output promotes nothing further and
 * produces a structurally identical tree.
 *
 * Does not validate. A tree that `validateTree` would reject is returned
 * as-is for the invalid parts; callers that need validity (the persistence
 * path does) validate before promoting.
 */
export function promoteEmbeddedRefs(
  tree: FeatureTree,
  options: PromotionOptions = {},
): PromotionResult {
  const refAware = options.refAwareKinds ?? REF_AWARE_EMITTERS;
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));

  const promoted: PromotedEntry[] = [];
  const skipped: SkippedEntry[] = [];
  const alreadyRef: string[] = [];

  const nextNodes: FeatureNode[] = tree.nodes.map((node) => {
    const kind = node.payload.kind;

    if (UNRECOVERABLE_KINDS.has(kind)) {
      skipped.push({
        id: node.id,
        kind,
        reason: 'no_promotion_rule',
        message:
          `'${node.name}' (${kind}) stores its upstream body as rendered SCAD text, ` +
          `from which the source feature cannot be recovered. It stays non-parametric ` +
          `until it is rebuilt.`,
        candidates: [],
      });
      return node;
    }

    if (!SNAPSHOT_KINDS.has(kind)) return node;

    // Already a reference? Leave it exactly alone (design note §5.2 line 1).
    if (upstreamRefsOf(node.payload).length > 0) {
      alreadyRef.push(node.id);
      return node;
    }

    // The only structural evidence available: extrude-kinded dependencies.
    const candidates = node.dependencies.filter((d) => byId.get(d)?.payload.kind === 'extrude');

    if (candidates.length === 0) {
      skipped.push({
        id: node.id,
        kind,
        reason: 'no_extrude_dependency',
        message:
          `'${node.name}' (${kind}) declares no extrude dependency, so there is no ` +
          `upstream feature to reference. It still renders from its stored copy of the ` +
          `body, but upstream edits will not reach it.`,
        candidates,
      });
      return node;
    }

    if (candidates.length > 1) {
      skipped.push({
        id: node.id,
        kind,
        reason: 'ambiguous_extrude_dependencies',
        message:
          `'${node.name}' (${kind}) depends on ${candidates.length} extrude features ` +
          `(${candidates.join(', ')}); which one it operates on is not recorded. Left ` +
          `connected to its stored copy rather than guessing — re-create the feature to ` +
          `make it parametric.`,
        candidates,
      });
      return node;
    }

    if (!refAware.has(kind)) {
      skipped.push({
        id: node.id,
        kind,
        reason: 'emitter_not_ref_aware',
        message:
          `'${node.name}' (${kind}) has an unambiguous upstream (${candidates[0]}), but ` +
          `${kind} features do not yet regenerate from a reference. Promoting it would ` +
          `change what is rendered without making it parametric, so it is left as-is.`,
        candidates,
      });
      return node;
    }

    const childId = candidates[0];
    const upstream = byId.get(childId)!.payload as ExtrudeFeature;
    const snapshot = (node.payload as { childExtrude?: ExtrudeFeature }).childExtrude;

    promoted.push({
      id: node.id,
      kind,
      childId,
      snapshotDiverged: !sameExtrude(snapshot, upstream),
    });

    // Set the reference AND refresh the snapshot in one step. The refreshed
    // snapshot is what lets a pre-W2-0 reader still render correct geometry
    // from this file (see §5.4 / the backward-compat note in the tests).
    return {
      ...node,
      payload: { ...node.payload, childId, childExtrude: upstream } as FeaturePayload,
    };
  });

  let next: FeatureTree = promoted.length > 0 ? { nodes: nextNodes } : tree;

  // §5.3 — re-sync every embedded snapshot against its live upstream. This
  // also catches nodes that arrived already in reference mode with a stale
  // snapshot. Idempotent, and reference-preserving for untouched nodes.
  const syncBlock = describeUnsyncableRef(next);
  const report: PromotionReport = {
    promoted,
    skipped,
    alreadyRef,
    considered: promoted.length + skipped.length + alreadyRef.length,
  };
  if (syncBlock === null) {
    const synced = syncEmbeddedSnapshots(next);
    // syncEmbeddedSnapshots always allocates a new tree object even when it
    // changes nothing. Collapse that back to the original identity when no
    // node moved, so a caller diffing whole trees by reference (and the
    // "we touched nothing" guarantee for a fully-skipped tree) still holds.
    const unchanged =
      synced.nodes.length === next.nodes.length &&
      synced.nodes.every((n, i) => n === next.nodes[i]);
    next = unchanged ? next : synced;
  } else {
    report.syncSkippedReason = syncBlock;
  }

  return { tree: next, report };
}

/**
 * Pre-flight for `syncEmbeddedSnapshots`, which throws on an unresolvable
 * reference. We would rather report than throw: a load path that throws on
 * a malformed file loses the user's data entirely, whereas returning the
 * tree unsynced keeps it openable. Returns `null` when the sync is safe.
 */
function describeUnsyncableRef(tree: FeatureTree): string | null {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  for (const node of tree.nodes) {
    const p = node.payload as { childId?: unknown; childExtrude?: unknown };
    if (typeof p.childId !== 'string' || p.childExtrude === undefined) continue;
    const upstream = byId.get(p.childId);
    if (!upstream) {
      return `node ${node.id} references ${p.childId}, which is not in the tree`;
    }
    if (upstream.payload.kind !== 'extrude') {
      return (
        `node ${node.id} references ${p.childId}, which is '${upstream.payload.kind}' ` +
        `and cannot back a childExtrude snapshot`
      );
    }
  }
  return null;
}

/**
 * Structural equality over the fields an extrude emission depends on.
 * Used only to report drift, never to decide a promotion.
 */
function sameExtrude(a: ExtrudeFeature | undefined, b: ExtrudeFeature): boolean {
  if (a === undefined) return false;
  if (a === b) return true;
  if (a.depth !== b.depth) return false;
  if (a.direction !== b.direction) return false;
  if (a.mode !== b.mode) return false;
  if ((a.draftDegrees ?? 0) !== (b.draftDegrees ?? 0)) return false;
  if (a.loop.length !== b.loop.length) return false;
  for (let i = 0; i < a.loop.length; i++) {
    if (a.loop[i].x !== b.loop[i].x || a.loop[i].y !== b.loop[i].y) return false;
  }
  return true;
}

// ─── reporting ────────────────────────────────────────────────────────────

/**
 * Render a report as plain text for a "model health" panel or a log line.
 * Answers the user-facing question: which features are not parametric, and
 * why.
 */
export function formatPromotionReport(report: PromotionReport): string {
  const lines: string[] = [];
  const total = report.considered;
  const parametric = report.promoted.length + report.alreadyRef.length;
  lines.push(
    `Feature references: ${parametric}/${total} parametric ` +
      `(${report.promoted.length} upgraded on load, ${report.alreadyRef.length} already linked).`,
  );
  const diverged = report.promoted.filter((p) => p.snapshotDiverged);
  if (diverged.length > 0) {
    lines.push(
      `  ${diverged.length} upgraded feature(s) were out of date and will now follow their ` +
        `upstream: ${diverged.map((d) => d.id).join(', ')}.`,
    );
  }
  if (report.skipped.length > 0) {
    lines.push(`Not parametric (${report.skipped.length}):`);
    for (const s of report.skipped) lines.push(`  - ${s.id}: ${s.message}`);
  }
  if (report.syncSkippedReason !== undefined) {
    lines.push(`Snapshot refresh skipped: ${report.syncSkippedReason}`);
  }
  return lines.join('\n');
}
