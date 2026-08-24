import { describe, expect, it } from 'vitest';
import { createAiDesignInteractionState } from './aiDesignInteractionContract';
import {
  beginMobileGesture,
  consumeMobileResumeToken,
  createAiDesignMobileRecoveryState,
  createMobileResumeToken,
  setMobileConnectivity,
  setMobileSelection,
} from './aiDesignMobileRecovery';
import { createAiDesignScreenBinding } from './aiDesignScreenBinding';
import { createAiDesignWorkspaceViewModel } from './aiDesignWorkspaceViewModel';
import {
  createAiDesignWorkflowState,
  transitionAiDesignWorkflow,
  type AiDesignWorkflowState,
  type WorkflowEvidence,
} from './aiDesignWorkflow';
import { createDesignCandidateComparison } from './designCandidateComparison';
import { createDesignIntentCheckpoint, type DesignIntentSource } from './designIntentCheckpoint';
import { createGaugeViewModel } from './gaugeViewModel';
import { selectCodegenModel } from './modelSelectionPolicy';
import {
  DIRECT_MANIPULATION_INTENT_SCHEMA,
  planDirectManipulation,
  type DirectManipulationIntent,
} from './directManipulation';
import { directManipulationDigest } from './directManipulationDigest';
import {
  PRECISION_CAD_DIRECT_EDIT_RECEIPT_SCHEMA,
  type PrecisionCadDirectEditReceipt,
} from './precisionCadDirectEditReceipt';
import { AI_DESIGN_USER_SCENARIOS, validateAiDesignUserScenarios } from './aiDesignUserScenarios';

const hash = (character: string) => character.repeat(64);
const source = (id: string, kind: DesignIntentSource['kind'], fieldKey: string): DesignIntentSource => ({
  id,
  kind,
  projectId: 'project-1',
  revision: 0,
  sourceHash: hash(id.at(-1) ?? 'a'),
  authority: 'user_confirmed',
  provenance: { rights: 'user_owned', aiUseAllowed: true, derivativeUseAllowed: true },
  fields: [{ key: fieldKey, value: `${kind}-value`, category: 'requirement' }],
});

const checkpoint = () => createDesignIntentCheckpoint({
  checkpointId: 'checkpoint-1',
  projectId: 'project-1',
  revision: 0,
  projectContentHash: hash('a'),
  sources: [
    source('source-a', 'text', 'purpose'),
    source('source-b', 'image', 'appearance'),
    source('source-c', 'sketch', 'profile'),
    source('source-d', 'drawing_2d', 'drawing-revision'),
    source('source-e', 'selection_3d', 'selected-feature'),
  ],
});

const workflowEvidence = (kind: WorkflowEvidence['kind'], id: string): WorkflowEvidence => ({
  id,
  kind,
  checkpointId: 'checkpoint-1',
  revision: 0,
  status: 'PASS',
  digest: hash('a'),
  source: `${kind}-worker`,
});

function move(state: AiDesignWorkflowState, event: Parameters<typeof transitionAiDesignWorkflow>[1]): AiDesignWorkflowState {
  const result = transitionAiDesignWorkflow(state, event);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function commitIntent(): DirectManipulationIntent {
  return {
    schema: DIRECT_MANIPULATION_INTENT_SCHEMA,
    version: 1,
    intentId: 'intent-1',
    gestureId: 'gesture-1',
    sessionId: 'session-1',
    sequence: 3,
    idempotencyKey: 'commit-1',
    phase: 'commit',
    createdAt: '2026-08-24T00:00:00.000Z',
    projectId: 'project-1',
    baseRevision: 'rev-0',
    coordinateFrame: 'part:bracket-1',
    viewportRevision: 'viewport-1',
    device: { platform: 'desktop', pointer: 'mouse', pointerCount: 1 },
    origin: 'user_gauge',
    userCommand: 'Set the extrusion depth to 12 mm',
    selection: {
      version: 1,
      projectRevision: 'rev-0',
      assemblyPath: ['main'],
      partInstanceId: 'bracket-1',
      featureId: 'extrude-1',
      topology: [],
      sketchEntityIds: [],
      mateIds: [],
      coordinateFrame: 'part:bracket-1',
      units: 'mm',
    },
    binding: { kind: 'feature_parameter', partId: 'bracket-1', featureId: 'extrude-1', parameter: 'depth', unit: 'mm' },
    measurement: { semantics: 'absolute', startValue: 10, targetValue: 12, delta: 2, unit: 'mm', snapIncrement: 0.5 },
    rollback: { snapshotId: 'snapshot-0', snapshotDigestSha256: hash('9'), baseRevision: 'rev-0' },
  };
}

describe('AI Design screen-consumer user scenarios', () => {
  it('runs multimodal intake through candidate comparison, gauge edit, and bound precision verification', () => {
    const cp = checkpoint();
    let workflow = createAiDesignWorkflowState({ revision: 0 });
    workflow = move(workflow, { type: 'RECEIVE_INPUT', checkpoint: { id: cp.checkpointId, revision: 0, digest: cp.projectContentHash } });
    workflow = move(workflow, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: workflowEvidence('understanding', 'understanding-1') });
    workflow = move(workflow, { type: 'START_GENERATION', runId: 'generation-1' });
    workflow = move(workflow, { type: 'CANDIDATES_READY', evidence: workflowEvidence('candidate', 'candidate-evidence-1') });
    workflow = move(workflow, { type: 'BEGIN_PARAMETRIC_EDIT' });
    workflow = move(workflow, { type: 'REQUEST_PRECISION' });
    workflow = move(workflow, { type: 'START_PRECISION_VERIFICATION', runId: 'precision-1' });

    const intent = commitIntent();
    const planned = planDirectManipulation(intent, 'rev-0');
    if (!planned.ok) throw new Error(planned.issues.join(','));
    const proposalDigestSha256 = directManipulationDigest(planned.proposal);
    const receipt: PrecisionCadDirectEditReceipt = {
      schema: PRECISION_CAD_DIRECT_EDIT_RECEIPT_SCHEMA,
      receiptId: 'precision-receipt-1',
      proposalId: planned.proposal.proposalId,
      intentId: planned.proposal.intentId,
      projectId: 'project-1',
      idempotencyKey: planned.proposal.idempotencyKey,
      baseRevision: 'rev-0',
      proposalDigestSha256,
      status: 'VERIFIED',
      resultRevision: 'rev-1',
      resultDigestSha256: hash('b'),
      rollback: { snapshotId: 'snapshot-0', snapshotDigestSha256: hash('9') },
      verification: {
        geometry: { status: 'PASS', sourceId: 'geometry-1', sourceHash: hash('c') },
        topology: { status: 'PASS', sourceId: 'topology-1', sourceHash: hash('d') },
        manufacturing: { status: 'NOT_RUN' },
      },
      issues: [],
      issuedAt: '2026-08-24T00:00:02.000Z',
    };
    workflow = move(workflow, { type: 'VERIFICATION_COMPLETE', evidence: workflowEvidence('precision-verification', receipt.receiptId) });
    const selected = selectCodegenModel({ mode: 'auto', plan: 'enterprise', task: 'simple-execution' });
    if (!selected.ok) throw new Error('model selection failed');
    const candidates = createDesignCandidateComparison('rev-0', [{
      candidateId: 'candidate-1',
      revision: 'candidate-rev-1',
      baseRevision: 'rev-0',
      title: 'Bracket candidate',
      summary: 'Single-part bracket',
      metrics: [{ metricId: 'metric-1', label: 'Requirement match', value: 1, status: 'verified', evidenceId: 'evidence-1' }],
      evidence: [{ evidenceId: 'evidence-1', label: 'Candidate check', status: 'verified', source: 'candidate-worker' }],
      featureIds: ['extrude-1'],
      modelId: selected.model.id,
    }]);
    const view = createAiDesignWorkspaceViewModel({
      projectId: 'project-1',
      revision: 0,
      revisionToken: 'rev-0',
      checkpoint: cp,
      workflow,
      interaction: createAiDesignInteractionState(),
      modelSelection: selected.receipt,
      candidates,
      gauges: [createGaugeViewModel(intent)],
      activeProposal: planned.proposal,
      proposalDigestSha256,
      precisionReceipt: receipt,
    });
    const screen = createAiDesignScreenBinding(view);
    expect(view).toMatchObject({
      safety: 'READY',
      baseRevisionToken: 'rev-0',
      revisionToken: 'rev-1',
      header: { workflowStatus: 'VERIFIED', selectedModelId: 'gpt-luna', precisionStatus: 'PASS' },
      verification: { geometry: 'PASS', topology: 'PASS', manufacturing: 'NOT_RUN', receiptAccepted: true },
    });
    expect(view.intake.sourceKinds).toEqual(['text', 'image', 'sketch', 'drawing_2d', 'selection_3d']);
    expect(screen.precisionBadge.authoritative).toBe(true);
    expect(screen.regions.filter(region => region.visible).map(region => region.id)).toEqual(
      AI_DESIGN_USER_SCENARIOS[0]!.expectedRegions,
    );
  });

  it('discards an interrupted mobile gesture and resumes the exact generation stage', () => {
    const cp = checkpoint();
    let workflow = createAiDesignWorkflowState({ revision: 0 });
    workflow = move(workflow, { type: 'RECEIVE_INPUT', checkpoint: { id: cp.checkpointId, revision: 0, digest: cp.projectContentHash } });
    workflow = move(workflow, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: workflowEvidence('understanding', 'understanding-1') });
    workflow = move(workflow, { type: 'START_GENERATION', runId: 'generation-1' });
    workflow = move(workflow, { type: 'CANCEL', reason: 'app-backgrounded' });
    expect(workflow.resumeStatus).toBe('GENERATING');

    let mobile = createAiDesignMobileRecoveryState({ lowData: true });
    const selection = { entityId: 'face-1', entityType: 'face' as const, workflowRevision: 0, checkpointId: cp.checkpointId };
    mobile = setMobileSelection(mobile, selection, 0);
    mobile = beginMobileGesture(mobile, { id: 'gesture-mobile-1', selection, beforeValue: 10, draftValue: 12, unit: 'mm', dirty: true });
    mobile = setMobileConnectivity(mobile, true);
    expect(mobile).toMatchObject({ gesture: null, pendingGestureDiscarded: true, offline: true, selection });
    mobile = createMobileResumeToken(mobile, { workflowRevision: 0, checkpointId: cp.checkpointId, operationId: 'generation-1', createdAt: '2026-08-24T00:00:01Z' });
    mobile = setMobileConnectivity(mobile, false);
    mobile = consumeMobileResumeToken(mobile, 0, cp.checkpointId, 'generation-1');
    workflow = move(workflow, { type: 'RESUME' });
    expect(workflow.status).toBe('GENERATING');
    expect(mobile).toMatchObject({ resumeToken: null, offline: false, selection, preservedSelection: true });

    const selected = selectCodegenModel({ mode: 'auto', plan: 'free', task: 'simple-execution' });
    if (!selected.ok) throw new Error('model selection failed');
    const view = createAiDesignWorkspaceViewModel({
      projectId: 'project-1', revision: 0, revisionToken: 'rev-0', checkpoint: cp, workflow,
      interaction: createAiDesignInteractionState({ presentation: 'mobile' }), mobile, modelSelection: selected.receipt,
    });
    const screen = createAiDesignScreenBinding(view);
    expect(screen.mode).toBe('mobile');
    expect(screen.regions.filter(region => region.visible).map(region => region.id)).toEqual(
      AI_DESIGN_USER_SCENARIOS[1]!.expectedRegions,
    );
  });

  it('keeps the CAD selection and gauge identity when a preferred model falls back', () => {
    const intent = { ...commitIntent(), phase: 'preview' as const, rollback: undefined };
    const gauge = createGaugeViewModel(intent);
    const fallback = selectCodegenModel({ mode: 'auto', plan: 'free', modelId: 'gpt-terra' });
    expect(fallback.ok).toBe(true);
    if (!fallback.ok) return;
    expect(fallback.receipt.fallback.applied).toBe(true);
    expect(createGaugeViewModel(intent)).toEqual(gauge);
    expect(gauge.selection.featureId).toBe('extrude-1');
  });

  it('keeps the scenario manifest complete and ownership-explicit', () => {
    expect(validateAiDesignUserScenarios()).toEqual([]);
    expect(AI_DESIGN_USER_SCENARIOS.every(scenario => scenario.precisionCadBoundary.length > 0)).toBe(true);
  });
});
