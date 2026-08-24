import {
  buildCadEditImpact,
  evaluateAiEditTransaction,
  type AiEditTransaction,
  type CadEditImpact,
  type CadEditOperation,
  type EditTransactionVerdict,
} from './aiEditTransaction';
import {
  selectionRequiresConfirmation,
  type SelectionContext,
  type TopologySelectionRef,
} from './selectionContext';

export const DIRECT_MANIPULATION_INTENT_SCHEMA = 'nexyfab.direct-manipulation-intent.v1' as const;
export const DIRECT_MANIPULATION_PROPOSAL_SCHEMA = 'nexyfab.direct-manipulation-proposal.v1' as const;

export type DirectManipulationPhase = 'preview' | 'commit';
export type DirectManipulationUnit = 'mm' | 'deg' | '1';

export type DirectManipulationBinding =
  | {
      kind: 'feature_parameter';
      partId: string;
      featureId: string;
      parameter: string;
      unit: DirectManipulationUnit;
    }
  | {
      kind: 'sketch_dimension';
      partId: string;
      sketchId: string;
      entityIds: string[];
      unit: 'mm' | 'deg';
    }
  | { kind: 'face_offset'; partId: string; faceRefs: string[] }
  | { kind: 'face_draft'; partId: string; faceRefs: string[]; pullDirection: [number, number, number] }
  | { kind: 'edge_fillet'; partId: string; edgeRefs: string[] }
  | { kind: 'edge_chamfer'; partId: string; edgeRefs: string[] }
  | { kind: 'occurrence_translate'; partId: string; axis: [number, number, number] }
  | { kind: 'occurrence_rotate'; partId: string; axis: [number, number, number] };

export interface DirectManipulationMeasurement {
  semantics: 'absolute' | 'delta';
  startValue: number;
  targetValue: number;
  delta: number;
  unit: DirectManipulationUnit;
  snapIncrement?: number;
}

export interface DirectManipulationIntent {
  schema: typeof DIRECT_MANIPULATION_INTENT_SCHEMA;
  version: 1;
  intentId: string;
  gestureId: string;
  sessionId: string;
  sequence: number;
  idempotencyKey: string;
  phase: DirectManipulationPhase;
  createdAt: string;
  projectId: string;
  baseRevision: string;
  coordinateFrame: string;
  viewportRevision: string;
  device: {
    platform: 'desktop' | 'mobile';
    pointer: 'mouse' | 'pen' | 'touch' | 'keyboard' | 'numeric';
    pointerCount: number;
  };
  origin: 'user_gauge' | 'ai_suggestion';
  sourceModelReceipt?: {
    receiptId: string;
    schema: 'nexyfab.model-selection-receipt.v1';
    selectedModelId: string;
    policy: {
      conceptOnly: true;
      copyrightSafe: true;
      exactGeometryAuthority: false;
    };
  };
  userCommand: string;
  selection: SelectionContext;
  binding: DirectManipulationBinding;
  measurement: DirectManipulationMeasurement;
  rollback?: {
    snapshotId: string;
    snapshotDigestSha256: string;
    baseRevision: string;
  };
  confirmation?: {
    confirmed: true;
    proposalId: string;
    baseRevision: string;
    confirmedAt: string;
  };
  assumptions?: string[];
  unresolved?: string[];
}

export interface DirectManipulationProposal {
  schema: typeof DIRECT_MANIPULATION_PROPOSAL_SCHEMA;
  proposalId: string;
  intentId: string;
  projectId: string;
  gestureId: string;
  idempotencyKey: string;
  phase: DirectManipulationPhase;
  state: 'PREVIEW' | 'BLOCKED' | 'READY_FOR_CAD';
  summary: string;
  transaction: AiEditTransaction;
  verdict: EditTransactionVerdict;
  impact: CadEditImpact | null;
  verification: {
    geometry: 'NOT_RUN';
    topology: 'NOT_RUN';
    manufacturing: 'NOT_RUN';
  };
  requiresCadExecution: boolean;
}

export type DirectManipulationPlanResult =
  | { ok: true; proposal: DirectManipulationProposal }
  | { ok: false; issues: string[] };

const MAX_LINEAR_ABS_MM = 1_000_000;
const MAX_LINEAR_DELTA_MM = 100_000;
const MAX_ANGLE_ABS_DEG = 360_000;
const EPSILON = 1e-7;
const SHA256 = /^[a-f0-9]{64}$/;

const nonEmpty = (value: string): boolean => value.trim().length > 0;
const selectedPart = (selection: SelectionContext): string | undefined =>
  selection.partInstanceId ?? selection.bodyId;
const refsOfKind = (selection: SelectionContext, kind: TopologySelectionRef['kind']): Set<string> =>
  new Set(selection.topology.filter(ref => ref.kind === kind).map(ref => ref.persistentRef));

function unitForBinding(binding: DirectManipulationBinding): DirectManipulationUnit {
  switch (binding.kind) {
    case 'feature_parameter':
    case 'sketch_dimension':
      return binding.unit;
    case 'face_draft':
    case 'occurrence_rotate':
      return 'deg';
    default:
      return 'mm';
  }
}

function expectsDelta(binding: DirectManipulationBinding): boolean {
  return binding.kind === 'occurrence_translate' || binding.kind === 'occurrence_rotate';
}

function validAxis(axis: readonly number[]): boolean {
  if (axis.length !== 3 || !axis.every(Number.isFinite)) return false;
  const length = Math.hypot(...axis);
  return Math.abs(length - 1) <= 1e-5;
}

function multiply(axis: readonly [number, number, number], value: number): [number, number, number] {
  return [axis[0] * value, axis[1] * value, axis[2] * value];
}

function validateTopologyRefs(
  selection: SelectionContext,
  kind: 'face' | 'edge',
  refs: readonly string[],
): string[] {
  if (refs.length === 0 || refs.some(ref => !nonEmpty(ref))) return [`${kind}_references_required`];
  const selected = refsOfKind(selection, kind);
  return refs.some(ref => !selected.has(ref)) ? [`${kind}_reference_outside_selection`] : [];
}

export function validateDirectManipulationIntent(
  intent: DirectManipulationIntent,
  currentRevision: string,
): string[] {
  const issues: string[] = [];
  if (intent.schema !== DIRECT_MANIPULATION_INTENT_SCHEMA || intent.version !== 1) issues.push('unsupported_intent_schema');
  if (![intent.intentId, intent.gestureId, intent.sessionId, intent.idempotencyKey, intent.projectId, intent.baseRevision,
    intent.viewportRevision, intent.userCommand]
    .every(nonEmpty)) issues.push('missing_intent_identity');
  if (!Number.isSafeInteger(intent.sequence) || intent.sequence < 0) issues.push('invalid_event_sequence');
  if (!Number.isSafeInteger(intent.device.pointerCount) || intent.device.pointerCount < 0 || intent.device.pointerCount > 16) {
    issues.push('invalid_pointer_count');
  }
  if (!Number.isFinite(Date.parse(intent.createdAt))) issues.push('invalid_created_at');
  if (intent.origin === 'ai_suggestion') {
    const receipt = intent.sourceModelReceipt;
    if (!receipt || !nonEmpty(receipt.receiptId)
      || receipt.schema !== 'nexyfab.model-selection-receipt.v1'
      || !nonEmpty(receipt.selectedModelId)
      || receipt.policy?.conceptOnly !== true || receipt.policy.copyrightSafe !== true
      || receipt.policy.exactGeometryAuthority !== false) {
      issues.push('source_model_receipt_required');
    }
  }
  if (intent.phase !== 'preview' && intent.phase !== 'commit') issues.push('invalid_phase');
  if (intent.baseRevision !== currentRevision) issues.push('stale_workspace_revision');
  if (intent.selection.projectRevision !== intent.baseRevision) issues.push('selection_revision_mismatch');
  if (intent.coordinateFrame !== intent.selection.coordinateFrame) issues.push('coordinate_frame_mismatch');
  if (intent.phase === 'commit') {
    const rollback = intent.rollback;
    if (!rollback || !nonEmpty(rollback.snapshotId) || !SHA256.test(rollback.snapshotDigestSha256)
      || rollback.baseRevision !== intent.baseRevision) issues.push('rollback_snapshot_required');
  }
  const needsConfirmation = selectionRequiresConfirmation(intent.selection)
    || (intent.assumptions?.length ?? 0) > 0;
  if (intent.phase === 'commit' && needsConfirmation) {
    const confirmation = intent.confirmation;
    if (!confirmation || confirmation.confirmed !== true
      || confirmation.proposalId !== `proposal:${intent.intentId}`
      || confirmation.baseRevision !== intent.baseRevision
      || !Number.isFinite(Date.parse(confirmation.confirmedAt))) {
      issues.push('explicit_confirmation_required');
    }
  }

  const measurement = intent.measurement;
  if (![measurement.startValue, measurement.targetValue, measurement.delta].every(Number.isFinite)) {
    issues.push('non_finite_measurement');
  } else {
    const expected = measurement.startValue + measurement.delta;
    const tolerance = Math.max(EPSILON, Math.abs(measurement.targetValue) * EPSILON);
    if (Math.abs(expected - measurement.targetValue) > tolerance) issues.push('inconsistent_measurement_delta');
    if (measurement.unit === 'mm'
      && (Math.abs(measurement.targetValue) > MAX_LINEAR_ABS_MM || Math.abs(measurement.delta) > MAX_LINEAR_DELTA_MM)) {
      issues.push('linear_measurement_out_of_range');
    }
    if (measurement.unit === 'deg' && Math.abs(measurement.targetValue) > MAX_ANGLE_ABS_DEG) {
      issues.push('angular_measurement_out_of_range');
    }
  }
  if (measurement.snapIncrement !== undefined
    && (!Number.isFinite(measurement.snapIncrement) || measurement.snapIncrement <= 0)) issues.push('invalid_snap_increment');
  if (measurement.unit !== unitForBinding(intent.binding)) issues.push('binding_unit_mismatch');
  if (expectsDelta(intent.binding) !== (measurement.semantics === 'delta')) issues.push('measurement_semantics_mismatch');

  const part = selectedPart(intent.selection);
  if (!part || part !== intent.binding.partId) issues.push('binding_part_outside_selection');
  switch (intent.binding.kind) {
    case 'feature_parameter':
      if (!nonEmpty(intent.binding.featureId) || !nonEmpty(intent.binding.parameter)) issues.push('feature_binding_required');
      if (intent.selection.featureId && intent.selection.featureId !== intent.binding.featureId) issues.push('feature_binding_outside_selection');
      break;
    case 'sketch_dimension': {
      if (!nonEmpty(intent.binding.sketchId) || intent.binding.entityIds.length === 0) issues.push('sketch_binding_required');
      const selectedEntities = new Set(intent.selection.sketchEntityIds);
      if (intent.binding.entityIds.some(id => !selectedEntities.has(id))) issues.push('sketch_entity_outside_selection');
      break;
    }
    case 'face_offset':
      issues.push(...validateTopologyRefs(intent.selection, 'face', intent.binding.faceRefs));
      break;
    case 'face_draft':
      issues.push(...validateTopologyRefs(intent.selection, 'face', intent.binding.faceRefs));
      if (!validAxis(intent.binding.pullDirection)) issues.push('invalid_pull_direction');
      if (Math.abs(measurement.startValue) >= 90 || Math.abs(measurement.targetValue) >= 90) issues.push('draft_angle_out_of_range');
      break;
    case 'edge_fillet':
      issues.push(...validateTopologyRefs(intent.selection, 'edge', intent.binding.edgeRefs));
      if (measurement.targetValue <= 0) issues.push('fillet_radius_must_be_positive');
      break;
    case 'edge_chamfer':
      issues.push(...validateTopologyRefs(intent.selection, 'edge', intent.binding.edgeRefs));
      if (measurement.targetValue <= 0) issues.push('chamfer_distance_must_be_positive');
      break;
    case 'occurrence_translate':
    case 'occurrence_rotate':
      if (intent.selection.topology.length > 0) issues.push('occurrence_binding_requires_part_selection');
      if (!validAxis(intent.binding.axis)) issues.push('invalid_transform_axis');
      break;
  }
  return [...new Set(issues)];
}

function operationForIntent(intent: DirectManipulationIntent): CadEditOperation {
  const binding = intent.binding;
  const value = intent.measurement.targetValue;
  switch (binding.kind) {
    case 'feature_parameter':
      return { kind: 'set_feature_parameter', partId: binding.partId, featureId: binding.featureId, parameter: binding.parameter, value, unit: binding.unit };
    case 'sketch_dimension':
      return { kind: 'set_sketch_dimension', partId: binding.partId, sketchId: binding.sketchId, entityIds: [...binding.entityIds], value, unit: binding.unit };
    case 'face_offset':
      return { kind: 'offset_faces', partId: binding.partId, faceRefs: [...binding.faceRefs], distanceMm: value };
    case 'face_draft':
      return { kind: 'draft_faces', partId: binding.partId, faceRefs: [...binding.faceRefs], angleDeg: value, pullDirection: [...binding.pullDirection] };
    case 'edge_fillet':
      return { kind: 'add_fillet', partId: binding.partId, edgeRefs: [...binding.edgeRefs], radiusMm: value };
    case 'edge_chamfer':
      return { kind: 'add_chamfer', partId: binding.partId, edgeRefs: [...binding.edgeRefs], distanceMm: value };
    case 'occurrence_translate':
      return { kind: 'transform_part_delta', partId: binding.partId, translationDeltaMm: multiply(binding.axis, intent.measurement.delta) };
    case 'occurrence_rotate':
      return { kind: 'transform_part_delta', partId: binding.partId, rotationDeltaDeg: multiply(binding.axis, intent.measurement.delta) };
  }
}

function summaryForIntent(intent: DirectManipulationIntent): string {
  const value = intent.measurement.semantics === 'delta' ? intent.measurement.delta : intent.measurement.targetValue;
  return `${intent.binding.kind}: ${value}${intent.measurement.unit}`;
}

export function planDirectManipulation(
  intent: DirectManipulationIntent,
  currentRevision: string,
): DirectManipulationPlanResult {
  const issues = validateDirectManipulationIntent(intent, currentRevision);
  if (issues.length) return { ok: false, issues };

  const transaction: AiEditTransaction = {
    version: 1,
    id: `direct:${intent.intentId}`,
    baseRevision: intent.baseRevision,
    userCommand: intent.userCommand,
    selection: structuredClone(intent.selection),
    observations: [`gesture:${intent.gestureId}`, `binding:${intent.binding.kind}`],
    assumptions: [...(intent.assumptions ?? [])],
    unresolved: [...(intent.unresolved ?? [])],
    operations: [operationForIntent(intent)],
    affected: {
      parts: [intent.binding.partId],
      features: 'featureId' in intent.binding ? [intent.binding.featureId] : [],
      mates: [],
      drawings: [],
    },
    preconditions: intent.selection.topology.map(ref => ({
      code: `TOPOLOGY-${ref.persistentRef}`,
      status: ref.referenceQuality === 'persistent' ? 'passed' : 'needs_confirmation',
      message: ref.referenceQuality === 'persistent' ? 'persistent topology reference' : `${ref.referenceQuality} topology reference`,
    })),
    rollbackSnapshot: intent.rollback
      ? `${intent.rollback.snapshotId}@sha256:${intent.rollback.snapshotDigestSha256}`
      : `preview:no-mutation:${intent.baseRevision}`,
  };
  const verdict = evaluateAiEditTransaction(transaction, currentRevision);
  const state = !verdict.applicable
    ? 'BLOCKED'
    : intent.phase === 'preview'
      ? 'PREVIEW'
      : 'READY_FOR_CAD';
  return {
    ok: true,
    proposal: {
      schema: DIRECT_MANIPULATION_PROPOSAL_SCHEMA,
      proposalId: `proposal:${intent.intentId}`,
      intentId: intent.intentId,
      projectId: intent.projectId,
      gestureId: intent.gestureId,
      idempotencyKey: intent.idempotencyKey,
      phase: intent.phase,
      state,
      summary: summaryForIntent(intent),
      transaction,
      verdict,
      impact: verdict.applicable ? buildCadEditImpact(transaction) : null,
      verification: { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' },
      requiresCadExecution: state === 'READY_FOR_CAD',
    },
  };
}
