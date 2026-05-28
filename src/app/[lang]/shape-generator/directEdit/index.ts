/**
 * directEdit/index.ts — Wave 2 Phase 3 Track E1 + E2.
 *
 * Public surface for the direct-edit module. The host imports from
 * here so the underlying file layout stays an implementation detail.
 */

export {
  DirectEditProvider,
  useDirectEditController,
  useDirectEditStack,
  useDirectEditEnabled,
  DIRECT_EDIT_INVALIDATED_EVENT,
  type DirectEditControllerApi,
  type DirectEditInvalidatedDetail,
  type DirectEditProviderProps,
} from './DirectEditController';

export {
  DirectEditToolbar,
  type DirectEditToolbarProps,
  type DirectEditSubMode,
} from './DirectEditToolbar';

export {
  DirectEditOverlay,
  type DirectEditOverlayProps,
} from './DirectEditOverlay';

export {
  DynamicEdgeOverlay,
  type DynamicEdgeOverlayProps,
  type DynamicEdgeMode,
} from './DynamicEdgeOverlay';

export {
  applyPushPull,
  type ApplyContext,
  type ApplyPushPullResult,
} from './applyPushPull';

export {
  applyDynamicFillet,
  type ApplyDynamicFilletContext,
  type ApplyDynamicFilletResult,
} from './applyDynamicFillet';

export {
  applyDynamicChamfer,
  type ApplyDynamicChamferContext,
  type ApplyDynamicChamferResult,
} from './applyDynamicChamfer';

export {
  computePushPullOffset,
  validatePushPullOffset,
  dragSnapToGrid,
  computeFaceBboxExtent,
  PUSH_PULL_EPSILON_MM,
  PUSH_PULL_MAX_OFFSET_MM,
  type Vec3,
  type PushPullValidationContext,
  type PushPullValidationResult,
} from './pushPullMath';

export {
  computeFilletRadiusFromDrag,
  computeChamferDistanceFromDrag,
  validateDynamicFillet,
  validateDynamicChamfer,
  encodeEdgeId,
  decodeEdgeId,
  edgeLength,
  findNearestTriangleEdge,
  DYNAMIC_EDGE_EPSILON_MM,
  DYNAMIC_EDGE_MAX_MM,
  type DynamicFilletValidationContext,
  type DynamicFilletValidationResult,
  type DynamicChamferValidationContext,
  type DynamicChamferValidationResult,
} from './dynamicEdgeMath';

export {
  makeEdgeCapWarning,
  EDGE_CAP_WARNING_CATALOGUE,
  type EdgeCapWarning,
  type EdgeCapWarningKind,
} from './edgeCapWarnings';

export {
  emptyDirectEditStack,
  isPushPullOp,
  isDynamicFilletOp,
  isDynamicChamferOp,
  validateDirectEditOp,
  type DirectEditOp,
  type DirectEditStack,
  type DirectEditFacePick,
  type DirectEditEdgePick,
  type OpValidationResult,
} from './directEditTypes';

export {
  getDirectEditStrings,
  type DirectEditLang,
  type DirectEditStrings,
} from './directEditI18n';

/**
 * Derive a `historyVersion` proxy from the host's feature history.
 * We don't have a true monotonic version counter on `useFeatureStack`
 * (Phase 3 W7 / E5 may add one), so we proxy with the cheap-to-compare
 * tuple of (node count + active node id). When either changes, the
 * provider clears the stack with a toast.
 *
 * This is deliberately conservative: any add/remove/rollback bumps
 * the proxy, which is exactly the "history rerun" semantic ADR-012 §6
 * specifies for invalidation.
 */
export function deriveHistoryVersionProxy(history: {
  nodes: ReadonlyArray<{ id: string }>;
  activeNodeId: string;
}): number {
  // Hash to a single number so the provider's useEffect dependency
  // comparison stays O(1). We use a multiplicative hash of node count
  // + active node id — collision probability is negligible for the
  // monotonic-modifying-history use case.
  let h = history.nodes.length * 2654435761;
  for (let i = 0; i < history.activeNodeId.length; i++) {
    h = ((h << 5) - h + history.activeNodeId.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
