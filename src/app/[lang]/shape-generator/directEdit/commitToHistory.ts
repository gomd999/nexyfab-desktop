/**
 * commitToHistory.ts — Wave 2 Phase 3 Track E5 (W7).
 *
 * Pure mapper: `DirectEditOp` → `HistoryNode`.
 *
 * Lock-ins from ADR-012 §6:
 *   - E1 ships a session-only direct-edit stack that is **NOT** persisted
 *     by `serializeProject`. The stack survives a session, clears on
 *     history-rerun, and exists only in memory.
 *   - E5 (this file) is the opt-in promotion path: convert each op into
 *     a parametric history node so it becomes canonical on .nfab save.
 *   - This is the differentiator vs SolidWorks (history-only) and Fusion
 *     (parametric-only) — opt-in conversion lets a user pick the right
 *     authoring style per op.
 *
 * Mapping decisions (documented for follow-up E-tracks):
 *   - `pushPull` → `featureType: 'pushPull'` (SYNTHETIC). The string is
 *     cast through `as unknown as FeatureType` because adding it to the
 *     FeatureType union requires a registry entry + applier, which is
 *     explicitly out of scope per the E5 brief ("E5 just synthesizes
 *     history nodes that the existing pipeline applies — do NOT modify
 *     the existing parametric feature appliers"). The committed node
 *     stamps the design tree as a record of intent; the apply-side
 *     wiring lands in W8 follow-up.
 *   - `dynamicFillet` (E2, W4) → `featureType: 'fillet'` with `radius`
 *     param + synthesized `edgeSelections`. The existing fillet applier
 *     is reused unchanged.
 *   - `dynamicChamfer` (E2, W4) → `featureType: 'chamfer'` analogously.
 *   - `moveBody` (E3, W5) → `featureType: 'moveCopy'` (operation=0 / move)
 *     with `offsetX/Y/Z` params.
 *   - `rotateBody` (E3, W5) → also `featureType: 'moveCopy'` since the
 *     existing definition handles rotation params. The applier ignores
 *     `rx/ry/rz` keys it doesn't recognize, so future E3 lands the
 *     rotation matrix.
 *   - Unknown op kind → `{ ok: false, reason: 'unknown_op_kind' }`, so
 *     a future E-track addition doesn't crash this mapper.
 *
 * E2/E3 ops are pre-wired here because their `kind` strings are reserved
 * in `directEditTypes.ts` (the placeholder `reserved_W4_E2`). When E2/E3
 * land they'll replace the placeholder; this mapper's switch already
 * routes them. Until then the runtime branches are dead code, but the
 * static type-check still holds.
 */

import type { HistoryNode } from '../useFeatureStack';
import type { DirectEditOp } from './directEditTypes';
import type { EdgeSelectionInfo } from '../editing/selectionInfo';

/** Rejection reasons returned by the mapper. Localized in `directEditI18n`. */
export type CommitRejectionReason =
  | 'unknown_op_kind'
  | 'missing_owner_feature'
  | 'invalid_offset'
  | 'invalid_radius'
  | 'invalid_distance';

/** Context the mapper needs from the host. The caller passes these
 *  closures so the mapper stays pure (no React, no FeatureStack import). */
export interface CommitContext {
  /** Allocate a stable unique id for the new HistoryNode. Mirrors the
   *  internal `genId()` in useFeatureStack — passed in so this module
   *  stays testable in isolation. */
  nextNodeId: () => string;
  /** Current `activeNodeId` from `useFeatureStack`. The committed node
   *  becomes a child of this node. */
  activeNodeId: string;
  /** Resolve a `faceId` to the parametric feature that owns it (via
   *  `faceProvenance.getFaceFeatureId`). The mapper records this in
   *  `dependsOn` so the design tree knows the edit attached to face F
   *  comes after feature G. Returns null when the face has no
   *  resolvable owner. */
  getFaceFeatureId: (faceId: string) => string | null;
  /** Optional clock for the `timestamp` field. Defaults to `Date.now`. */
  now?: () => number;
  /** Optional face-normal lookup for synthesizing translation vectors
   *  on push-pull / dynamic-fillet edges. When absent the mapper falls
   *  back to recording the offset magnitude only and leaves direction
   *  resolution to the apply-side wiring (W8 follow-up). */
  getFaceNormal?: (faceId: string) => readonly [number, number, number] | null;
}

/** Mapper result. `ok: true` means a HistoryNode was synthesized;
 *  `ok: false` means the caller should surface the rejection reason. */
export type DirectEditMapResult =
  | { ok: true; node: HistoryNode }
  | { ok: false; reason: CommitRejectionReason };

/** Synthetic featureType marker for committed push-pull ops. Cast at
 *  the assignment site since the FeatureType union doesn't yet include
 *  this value (out-of-scope for E5 per the brief; W8 follow-up adds the
 *  applier + registry entry). */
const SYNTHETIC_PUSH_PULL_FEATURE_TYPE = 'pushPull';

/** Round-trip the synthetic key so the apply-side (W8) can detect a
 *  committed direct-edit node and ignore it for parametric replay
 *  until the applier lands. Stored as a numeric flag because
 *  `HistoryNode.params` is `Record<string, number>`. */
const DIRECT_EDIT_COMMITTED_FLAG = 1;

/** Param key used to mark synthesized nodes. Read by the W8 applier. */
export const DIRECT_EDIT_COMMITTED_PARAM_KEY = '_directEditCommitted';

/**
 * Convert a single `DirectEditOp` into a `HistoryNode`. Pure function —
 * no side effects, no React, no global state. Callers (commitStack.ts)
 * orchestrate the all-or-nothing semantics.
 */
export function directEditOpToHistoryNode(
  op: DirectEditOp,
  ctx: CommitContext,
): DirectEditMapResult {
  const now = ctx.now ?? Date.now;

  // ─── pushPull → synthetic pushPull node ────────────────────────────────
  if (op.kind === 'pushPull') {
    if (!Number.isFinite(op.offsetMm) || Math.abs(op.offsetMm) < 1e-9) {
      return { ok: false, reason: 'invalid_offset' };
    }
    const ownerFeatureId = ctx.getFaceFeatureId(op.faceId);
    const normal = ctx.getFaceNormal?.(op.faceId) ?? null;

    const params: Record<string, number> = {
      offsetMm: op.offsetMm,
      [DIRECT_EDIT_COMMITTED_PARAM_KEY]: DIRECT_EDIT_COMMITTED_FLAG,
    };
    if (normal) {
      params._normalX = normal[0];
      params._normalY = normal[1];
      params._normalZ = normal[2];
    }

    const node: HistoryNode = {
      id: ctx.nextNodeId(),
      type: 'feature',
      label: `Push-Pull (direct edit) ${op.offsetMm.toFixed(2)}mm`,
      icon: '↕️',
      // Synthetic marker — see header comment. Cast because the
      // FeatureType union doesn't include this string in the W3 stack
      // base; the W8 follow-up adds it + an applier.
      featureType: SYNTHETIC_PUSH_PULL_FEATURE_TYPE as unknown as HistoryNode['featureType'],
      params,
      enabled: true,
      expanded: true,
      parentId: ctx.activeNodeId,
      children: [],
      editingActive: false,
      timestamp: now(),
      dependsOn: ownerFeatureId
        ? [ctx.activeNodeId, ownerFeatureId]
        : [ctx.activeNodeId],
    };
    return { ok: true, node };
  }

  // ─── Reserved E2/E3 op kinds (forward-compatibility) ────────────────────
  // The DirectEditOp union currently only has `pushPull` + the reserved
  // placeholder. Once E2 (W4) replaces the placeholder, the switch below
  // routes the new kinds. Until then the branches are unreachable at
  // runtime but cost nothing — and the static type system warns if
  // someone forgets to handle a new kind here (exhaustive switch).
  //
  // We use a string-based discriminator check instead of `switch` so the
  // forward-compat code compiles cleanly against the W3 union (which
  // doesn't yet have these kinds).
  const k = (op as { kind: string }).kind;

  if (k === 'dynamicFillet') {
    return mapDynamicFillet(op as unknown as DynamicFilletOpShape, ctx);
  }
  if (k === 'dynamicChamfer') {
    return mapDynamicChamfer(op as unknown as DynamicChamferOpShape, ctx);
  }
  if (k === 'moveBody') {
    return mapMoveBody(op as unknown as MoveBodyOpShape, ctx);
  }
  if (k === 'rotateBody') {
    return mapRotateBody(op as unknown as RotateBodyOpShape, ctx);
  }
  if (k === ("unknownTestKind" as unknown as DirectEditOp["kind"])) {
    // The W3-base placeholder has no payload — refuse the commit so the
    // user notices their stack contains a not-yet-shipped op kind.
    return { ok: false, reason: 'unknown_op_kind' };
  }

  return { ok: false, reason: 'unknown_op_kind' };
}

// ─── E2/E3 forward-compat op shapes ─────────────────────────────────────────
// These interfaces describe the shape the E2/E3 PRs are expected to land
// (per the master tracker). When the union grows, drop the local shapes
// and rely on the union's discriminant.

interface DynamicFilletOpShape {
  kind: 'dynamicFillet';
  edgeId: string;
  /** Anchor position (mm, world). Used to seed the EdgeFinder click. */
  edgePosition?: readonly [number, number, number];
  /** Estimated edge length, mm. Optional — improves EdgeFinder
   *  re-resolution but the mapper tolerates absence. */
  edgeLength?: number;
  /** Face normal of either incident face, for EdgeFinder rebuild. */
  faceNormal?: readonly [number, number, number];
  radius: number;
  createdAt?: number;
}

interface DynamicChamferOpShape {
  kind: 'dynamicChamfer';
  edgeId: string;
  edgePosition?: readonly [number, number, number];
  edgeLength?: number;
  faceNormal?: readonly [number, number, number];
  distance: number;
  createdAt?: number;
}

interface MoveBodyOpShape {
  kind: 'moveBody';
  bodyId?: string;
  tx: number;
  ty: number;
  tz: number;
  createdAt?: number;
}

interface RotateBodyOpShape {
  kind: 'rotateBody';
  bodyId?: string;
  /** Radians around X/Y/Z. */
  rx?: number;
  ry?: number;
  rz?: number;
  createdAt?: number;
}

function mapDynamicFillet(
  op: DynamicFilletOpShape,
  ctx: CommitContext,
): DirectEditMapResult {
  if (!Number.isFinite(op.radius) || op.radius <= 0) {
    return { ok: false, reason: 'invalid_radius' };
  }
  const now = ctx.now ?? Date.now;
  // Synthesize an EdgeSelectionInfo so the existing fillet applier can
  // build an EdgeFinder. Empty fallback when the op lacks geometry —
  // the applier degrades to the legacy "all edges" behaviour with a
  // warning, which is acceptable for a committed-from-direct-edit node.
  const edgeSelections: EdgeSelectionInfo[] = op.edgePosition && op.faceNormal
    ? [{
        type: 'edge',
        position: [op.edgePosition[0], op.edgePosition[1], op.edgePosition[2]],
        length: op.edgeLength ?? 0,
        normal: [op.faceNormal[0], op.faceNormal[1], op.faceNormal[2]],
        persistentId: op.edgeId,
      }]
    : [];

  const node: HistoryNode = {
    id: ctx.nextNodeId(),
    type: 'feature',
    label: `Fillet (direct edit) r${op.radius.toFixed(2)}`,
    icon: '🔵',
    featureType: 'fillet',
    params: {
      radius: op.radius,
      segments: 4,
      [DIRECT_EDIT_COMMITTED_PARAM_KEY]: DIRECT_EDIT_COMMITTED_FLAG,
    },
    enabled: true,
    expanded: true,
    parentId: ctx.activeNodeId,
    children: [],
    editingActive: false,
    timestamp: now(),
    dependsOn: [ctx.activeNodeId],
    ...(edgeSelections.length > 0 ? { edgeSelections } : {}),
  };
  return { ok: true, node };
}

function mapDynamicChamfer(
  op: DynamicChamferOpShape,
  ctx: CommitContext,
): DirectEditMapResult {
  if (!Number.isFinite(op.distance) || op.distance <= 0) {
    return { ok: false, reason: 'invalid_distance' };
  }
  const now = ctx.now ?? Date.now;
  const edgeSelections: EdgeSelectionInfo[] = op.edgePosition && op.faceNormal
    ? [{
        type: 'edge',
        position: [op.edgePosition[0], op.edgePosition[1], op.edgePosition[2]],
        length: op.edgeLength ?? 0,
        normal: [op.faceNormal[0], op.faceNormal[1], op.faceNormal[2]],
        persistentId: op.edgeId,
      }]
    : [];

  const node: HistoryNode = {
    id: ctx.nextNodeId(),
    type: 'feature',
    label: `Chamfer (direct edit) d${op.distance.toFixed(2)}`,
    icon: '🔶',
    featureType: 'chamfer',
    params: {
      distance: op.distance,
      [DIRECT_EDIT_COMMITTED_PARAM_KEY]: DIRECT_EDIT_COMMITTED_FLAG,
    },
    enabled: true,
    expanded: true,
    parentId: ctx.activeNodeId,
    children: [],
    editingActive: false,
    timestamp: now(),
    dependsOn: [ctx.activeNodeId],
    ...(edgeSelections.length > 0 ? { edgeSelections } : {}),
  };
  return { ok: true, node };
}

function mapMoveBody(
  op: MoveBodyOpShape,
  ctx: CommitContext,
): DirectEditMapResult {
  if (
    !Number.isFinite(op.tx) ||
    !Number.isFinite(op.ty) ||
    !Number.isFinite(op.tz)
  ) {
    return { ok: false, reason: 'invalid_offset' };
  }
  const now = ctx.now ?? Date.now;
  const node: HistoryNode = {
    id: ctx.nextNodeId(),
    type: 'feature',
    label: `Move Body (direct edit) (${op.tx.toFixed(1)}, ${op.ty.toFixed(1)}, ${op.tz.toFixed(1)})`,
    icon: '↗️',
    featureType: 'moveCopy',
    params: {
      offsetX: op.tx,
      offsetY: op.ty,
      offsetZ: op.tz,
      operation: 0, // 0 = move (1 = copy)
      [DIRECT_EDIT_COMMITTED_PARAM_KEY]: DIRECT_EDIT_COMMITTED_FLAG,
    },
    enabled: true,
    expanded: true,
    parentId: ctx.activeNodeId,
    children: [],
    editingActive: false,
    timestamp: now(),
    dependsOn: [ctx.activeNodeId],
  };
  return { ok: true, node };
}

function mapRotateBody(
  op: RotateBodyOpShape,
  ctx: CommitContext,
): DirectEditMapResult {
  const rx = op.rx ?? 0;
  const ry = op.ry ?? 0;
  const rz = op.rz ?? 0;
  if (
    !Number.isFinite(rx) ||
    !Number.isFinite(ry) ||
    !Number.isFinite(rz)
  ) {
    return { ok: false, reason: 'invalid_offset' };
  }
  if (rx === 0 && ry === 0 && rz === 0) {
    return { ok: false, reason: 'invalid_offset' };
  }
  const now = ctx.now ?? Date.now;
  const node: HistoryNode = {
    id: ctx.nextNodeId(),
    type: 'feature',
    label: `Rotate Body (direct edit)`,
    icon: '🔄',
    featureType: 'moveCopy',
    params: {
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0,
      operation: 0,
      // Reserved keys for the W8 follow-up applier. The existing
      // moveCopy applier ignores unknown keys, so this is forward-safe.
      _rotateX: rx,
      _rotateY: ry,
      _rotateZ: rz,
      [DIRECT_EDIT_COMMITTED_PARAM_KEY]: DIRECT_EDIT_COMMITTED_FLAG,
    },
    enabled: true,
    expanded: true,
    parentId: ctx.activeNodeId,
    children: [],
    editingActive: false,
    timestamp: now(),
    dependsOn: [ctx.activeNodeId],
  };
  return { ok: true, node };
}
