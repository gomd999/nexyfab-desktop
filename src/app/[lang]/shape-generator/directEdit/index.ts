/**
 * directEdit/index.ts — Wave 2 Phase 3 Track E1 + E2 + E3.
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
  type DirectEditMode,
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
  BodyTransformOverlay,
  type BodyTransformOverlayProps,
  type BodyTransformMode,
} from './BodyTransformOverlay';

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
  applyMoveBody,
  type ApplyMoveBodyContext,
  type ApplyMoveBodyResult,
} from './applyMoveBody';

export {
  applyRotateBody,
  type ApplyRotateBodyContext,
  type ApplyRotateBodyResult,
} from './applyRotateBody';

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
  buildRotationMatrix3,
  applyTranslationToPoint,
  applyRotationToPoint,
  applyMatrix4ToPoint,
  composeTransforms,
  bboxAfterTranslation,
  bboxAfterRotation,
  snapTranslationToGrid,
  snapAngleToStep,
  MOVE_BODY_EPSILON_MM,
  ROTATE_BODY_EPSILON_RAD,
  BODY_TRANSLATION_SNAP_MM,
  BODY_ROTATION_SNAP_RAD,
} from './bodyTransformMath';

export {
  checkMoveBodyCaps,
  checkRotateBodyCaps,
  checkBodyRequired,
  type BodyCapWarning,
  type BodyCapWarningCode,
  type MoveCapContext,
} from './bodyCapWarnings';

export {
  emptyDirectEditStack,
  isPushPullOp,
  isDynamicFilletOp,
  isDynamicChamferOp,
  isMoveBodyOp,
  isRotateBodyOp,
  validateDirectEditOp,
  validateMoveBody,
  validateRotateBody,
  MOVE_BODY_MAX_TRANSLATION_MM,
  ROTATE_BODY_MAX_ANGLE_RAD,
  type DirectEditOp,
  type DirectEditStack,
  type DirectEditFacePick,
  type DirectEditEdgePick,
  type DirectEditBodyPick,
  type OpValidationResult,
  type BodyTransformValidationResult,
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
  let h = history.nodes.length * 2654435761;
  for (let i = 0; i < history.activeNodeId.length; i++) {
    h = ((h << 5) - h + history.activeNodeId.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
