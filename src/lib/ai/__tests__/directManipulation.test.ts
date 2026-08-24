import { describe, expect, it } from 'vitest';
import {
  DIRECT_MANIPULATION_INTENT_SCHEMA,
  planDirectManipulation,
  validateDirectManipulationIntent,
  type DirectManipulationIntent,
} from '../directManipulation';
import type { SelectionContext } from '../selectionContext';

const selection: SelectionContext = {
  version: 1,
  projectRevision: 'rev-4',
  assemblyPath: ['main'],
  partInstanceId: 'housing-1',
  featureId: 'extrude-1',
  topology: [{
    kind: 'face',
    persistentRef: 'face:extrude-1:top',
    referenceQuality: 'persistent',
    geometrySignature: 'face:n=0,0,1:p=0,0,20:a=800',
  }],
  sketchEntityIds: [],
  mateIds: [],
  coordinateFrame: 'part:housing-1',
  units: 'mm',
};

const base = (overrides: Partial<DirectManipulationIntent> = {}): DirectManipulationIntent => ({
  schema: DIRECT_MANIPULATION_INTENT_SCHEMA,
  version: 1,
  intentId: 'intent-1',
  gestureId: 'gesture-1',
  sessionId: 'session-1',
  sequence: 1,
  idempotencyKey: 'gesture-1:rev-4:preview',
  phase: 'preview',
  createdAt: '2026-08-24T00:00:00.000Z',
  projectId: 'project-1',
  baseRevision: 'rev-4',
  coordinateFrame: 'part:housing-1',
  viewportRevision: 'viewport-9',
  device: { platform: 'desktop', pointer: 'mouse', pointerCount: 1 },
  origin: 'user_gauge',
  userCommand: '윗면 높이를 25mm로 변경',
  selection,
  binding: {
    kind: 'feature_parameter',
    partId: 'housing-1',
    featureId: 'extrude-1',
    parameter: 'depth',
    unit: 'mm',
  },
  measurement: {
    semantics: 'absolute',
    startValue: 20,
    targetValue: 25,
    delta: 5,
    unit: 'mm',
    snapIncrement: 0.5,
  },
  ...overrides,
});

describe('direct manipulation planning', () => {
  it('creates a non-mutating preview with downstream verification marked NOT_RUN', () => {
    const result = planDirectManipulation(base(), 'rev-4');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal).toMatchObject({
      state: 'PREVIEW',
      requiresCadExecution: false,
      verification: { geometry: 'NOT_RUN', topology: 'NOT_RUN', manufacturing: 'NOT_RUN' },
      transaction: {
        operations: [{ kind: 'set_feature_parameter', value: 25, unit: 'mm' }],
      },
    });
    expect(result.proposal.impact?.invalidatedStages).toContain('topology');
  });

  it('only produces READY_FOR_CAD after a commit request has rollback identity', () => {
    const result = planDirectManipulation(base({
      phase: 'commit',
      idempotencyKey: 'gesture-1:rev-4:commit',
      rollback: { snapshotId: 'snapshot:rev-4', snapshotDigestSha256: 'a'.repeat(64), baseRevision: 'rev-4' },
    }), 'rev-4');
    expect(result.ok && result.proposal.state).toBe('READY_FOR_CAD');
    expect(result.ok && result.proposal.requiresCadExecution).toBe(true);
  });

  it('fails closed on stale revision, coordinate-frame mismatch, or inconsistent delta', () => {
    expect(validateDirectManipulationIntent(base(), 'rev-5')).toContain('stale_workspace_revision');
    expect(validateDirectManipulationIntent(base({ coordinateFrame: 'world' }), 'rev-4')).toContain('coordinate_frame_mismatch');
    expect(validateDirectManipulationIntent(base({
      measurement: { semantics: 'absolute', startValue: 20, targetValue: 25, delta: 6, unit: 'mm' },
    }), 'rev-4')).toContain('inconsistent_measurement_delta');
  });

  it('rejects non-finite and unsafe linear input', () => {
    expect(validateDirectManipulationIntent(base({
      measurement: { semantics: 'absolute', startValue: 20, targetValue: Number.NaN, delta: 5, unit: 'mm' },
    }), 'rev-4')).toContain('non_finite_measurement');
    expect(validateDirectManipulationIntent(base({
      measurement: { semantics: 'absolute', startValue: 0, targetValue: 1_000_001, delta: 1_000_001, unit: 'mm' },
    }), 'rev-4')).toEqual(expect.arrayContaining(['linear_measurement_out_of_range']));
  });

  it('does not let an edge or face command escape the active selection', () => {
    const invalid = base({
      binding: { kind: 'face_offset', partId: 'housing-1', faceRefs: ['face:other'] },
      measurement: { semantics: 'absolute', startValue: 0, targetValue: 2, delta: 2, unit: 'mm' },
    });
    expect(validateDirectManipulationIntent(invalid, 'rev-4')).toContain('face_reference_outside_selection');
  });

  it('requires confirmation for a derived topology reference', () => {
    const derived = base({
      selection: {
        ...selection,
        topology: [{ ...selection.topology[0]!, referenceQuality: 'derived' }],
      },
      binding: { kind: 'face_offset', partId: 'housing-1', faceRefs: ['face:extrude-1:top'] },
      measurement: { semantics: 'absolute', startValue: 0, targetValue: 2, delta: 2, unit: 'mm' },
    });
    const result = planDirectManipulation(derived, 'rev-4');
    expect(result.ok && result.proposal.verdict.requiresConfirmation).toBe(true);
  });

  it('blocks a derived-selection commit until the exact preview is confirmed', () => {
    const derivedSelection = {
      ...selection,
      topology: [{ ...selection.topology[0]!, referenceQuality: 'derived' as const }],
    };
    const commit = base({
      phase: 'commit',
      selection: derivedSelection,
      binding: { kind: 'face_offset', partId: 'housing-1', faceRefs: ['face:extrude-1:top'] },
      measurement: { semantics: 'absolute', startValue: 0, targetValue: 2, delta: 2, unit: 'mm' },
      rollback: { snapshotId: 'snapshot:rev-4', snapshotDigestSha256: 'a'.repeat(64), baseRevision: 'rev-4' },
    });
    expect(planDirectManipulation(commit, 'rev-4')).toEqual({ ok: false, issues: ['explicit_confirmation_required'] });
    const confirmed = planDirectManipulation({
      ...commit,
      confirmation: {
        confirmed: true,
        proposalId: 'proposal:intent-1',
        baseRevision: 'rev-4',
        confirmedAt: '2026-08-24T00:00:01.000Z',
      },
    }, 'rev-4');
    expect(confirmed.ok && confirmed.proposal.state).toBe('READY_FOR_CAD');
  });

  it('requires a copyright-safe model receipt for an AI-originated gauge suggestion', () => {
    const intent = base({ origin: 'ai_suggestion' });
    expect(validateDirectManipulationIntent(intent, 'rev-4')).toContain('source_model_receipt_required');
    expect(validateDirectManipulationIntent({
      ...intent,
      sourceModelReceipt: {
        receiptId: 'receipt-1',
        schema: 'nexyfab.model-selection-receipt.v1',
        selectedModelId: 'gpt-luna',
        policy: {
          conceptOnly: true,
          copyrightSafe: true,
          exactGeometryAuthority: false,
        },
      },
    }, 'rev-4')).not.toContain('source_model_receipt_required');
  });

  it('maps an occurrence gauge to an explicit delta transform', () => {
    const occurrenceSelection = { ...selection, featureId: undefined, topology: [] };
    const result = planDirectManipulation(base({
      selection: occurrenceSelection,
      binding: { kind: 'occurrence_translate', partId: 'housing-1', axis: [1, 0, 0] },
      measurement: { semantics: 'delta', startValue: 0, targetValue: 12, delta: 12, unit: 'mm' },
    }), 'rev-4');
    expect(result.ok && result.proposal.transaction.operations).toEqual([{
      kind: 'transform_part_delta',
      partId: 'housing-1',
      translationDeltaMm: [12, 0, 0],
    }]);
    expect(result.ok && result.proposal.impact?.scope).toBe('occurrence_transform');
  });
});
