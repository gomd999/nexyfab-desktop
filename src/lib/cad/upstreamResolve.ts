/**
 * upstreamResolve — reference resolution for consumers that read a feature
 * tree OUTSIDE the SCAD replay path (W2-0 debt payoff, design note §5.4).
 *
 * W2-0 converted the SCAD emitter to resolve `childId` against the live
 * tree, but four consumers still read the embedded `childExtrude`
 * snapshot and therefore saw pre-edit geometry on a ref-mode tree:
 *
 *   - `lib/occt/featurePlan.ts`            (OCCT command IR)
 *   - `lib/brep-bridge/stepWriteFilletChamfer.ts` (STEP output)
 *   - `lib/cad/featureTreeStats.ts`        (volume / bbox)
 *   - `lib/ai/featureTreePlanner.ts`       (payload producer)
 *
 * This module gives them the same resolution semantics the emitter uses,
 * without duplicating it four times. It deliberately does NOT invent a
 * second policy: `resolveFilletChild` (filletProfile.ts, W2-0) stays the
 * single authority for fillet, and the generic path below mirrors it
 * exactly for the other ref-carrying kinds.
 *
 * ── Why a separate module rather than an export from featureTree.ts ──
 * `replayTree` builds its `EmitContext` from closures over the in-flight
 * `perNode` map, so it cannot hand one out before the render pass. The
 * static context here covers the payload-resolution half only; see
 * {@link emitContextForTree} for how the SCAD half is refused.
 */

import type { ExtrudeFeature } from './extrudeProfile';
import type {
  EmitContext,
  FeatureKind,
  FeatureNode,
  FeaturePayload,
  FeatureTree,
} from './featureTree';
import { FeatureTreeError } from './featureTree';
import { resolveFilletChild } from './filletProfile';
import type { FilletFeature } from './filletProfile';

// ─── static emit context ──────────────────────────────────────────────────

/**
 * An {@link EmitContext} backed by a tree's payloads alone.
 *
 * `requirePayload` behaves exactly as `replayTree`'s: live payload from the
 * tree, or a throw naming both nodes. Missing node and wrong-kind are hard
 * errors — never a quiet substitution (ADR-017 D1).
 *
 * `requireScad` THROWS unconditionally. Nothing has been rendered in a
 * static context, and returning `''` would let a caller silently emit an
 * empty body. Only the pattern kinds need `requireScad`, and none of the
 * four consumers this module serves does — if that changes, the caller must
 * be driven from `replayTree`'s context instead of this one.
 */
export function emitContextForTree(tree: FeatureTree): EmitContext {
  const byId = new Map<string, FeatureNode>(tree.nodes.map((n) => [n.id, n]));
  return {
    requirePayload<K extends FeatureKind>(
      refId: string,
      forId: string,
      expectKind: K,
    ): Extract<FeaturePayload, { kind: K }> {
      const target = byId.get(refId);
      if (!target) {
        throw new FeatureTreeError(
          `node ${forId} references upstream body ${refId}, which is not in the tree`,
        );
      }
      if (target.payload.kind !== expectKind) {
        throw new FeatureTreeError(
          `node ${forId} requires upstream ${refId} to be a '${expectKind}' feature, ` +
            `but it is '${target.payload.kind}'`,
        );
      }
      return target.payload as Extract<FeaturePayload, { kind: K }>;
    },
    requireScad(refId: string, forId: string): string {
      throw new FeatureTreeError(
        `node ${forId} needs the rendered SCAD of upstream body ${refId}, but this is a ` +
          `static (payload-only) EmitContext — nothing has been rendered. Drive this ` +
          `consumer from replayTree's context instead of emitContextForTree.`,
      );
    },
  };
}

// ─── child-body resolution ────────────────────────────────────────────────

/**
 * How a resolved child body was obtained. Callers surface this so a
 * snapshot read is never invisible (the reporting requirement of §5.4).
 */
export type ChildSource =
  /** Read live from the upstream node named by `childId`. Follows edits. */
  | 'ref'
  /** Read from the node's embedded `childExtrude`. Legacy tree — the value
   *  is whatever was captured when the feature was built and does NOT
   *  follow upstream edits. */
  | 'embedded';

export interface ResolvedChild {
  child: ExtrudeFeature;
  source: ChildSource;
  /** The upstream node id, when `source === 'ref'`. */
  refId?: string;
}

/**
 * Payloads that carry a child body, duck-typed.
 *
 * Read structurally rather than through each feature's interface so W2-A
 * can add `childId` to the remaining kinds without this file changing —
 * the same duck-typing rationale as `upstreamRefsOf` (design note §1.1).
 */
type ChildBearing = { childId?: unknown; childExtrude?: unknown };

/**
 * Resolve the upstream body a fillet/chamfer-style payload operates on.
 *
 * Mode is chosen by the presence of `childId`, never by a heuristic:
 *
 *   `childId` set + ctx      → live upstream payload  (`source: 'ref'`)
 *   `childId` set, no ctx    → THROW. Falling back to the stale snapshot is
 *                              the exact defect W2-0 removed.
 *   `childId` absent         → embedded snapshot     (`source: 'embedded'`)
 *
 * The third case is a legacy tree, not a failure — it is reported rather
 * than hidden so a caller can tell "this node is not parametric" from
 * "this node followed its upstream".
 *
 * Returns `undefined` for payloads that carry no child body at all.
 */
export function resolveChildExtrude(
  payload: FeaturePayload,
  selfId: string,
  ctx?: EmitContext,
): ResolvedChild | undefined {
  const p = payload as ChildBearing;
  const refId = typeof p.childId === 'string' && p.childId.length > 0 ? p.childId : undefined;

  if (refId === undefined) {
    if (p.childExtrude === undefined) return undefined;
    return { child: p.childExtrude as ExtrudeFeature, source: 'embedded' };
  }

  // Fillet keeps its W2-0 resolver as the single authority — same error
  // text, same refusal, so the two paths cannot drift apart.
  if (payload.kind === 'fillet') {
    return {
      child: resolveFilletChild(payload as FilletFeature, ctx, selfId),
      source: 'ref',
      refId,
    };
  }

  if (!ctx) {
    throw new Error(
      `${payload.kind} '${selfId}' references upstream body '${refId}' but was resolved ` +
        `without a tree context. Resolve it against the owning FeatureTree. ` +
        `(Refusing to fall back to the stale childExtrude snapshot.)`,
    );
  }
  return { child: ctx.requirePayload(refId, selfId, 'extrude'), source: 'ref', refId };
}

/**
 * Convenience wrapper for the common "I have the whole tree" case.
 * Equivalent to `resolveChildExtrude(node.payload, node.id, emitContextForTree(tree))`,
 * but reuses one context across a walk.
 */
export function resolveNodeChildExtrude(
  node: FeatureNode,
  ctx: EmitContext,
): ResolvedChild | undefined {
  return resolveChildExtrude(node.payload, node.id, ctx);
}
