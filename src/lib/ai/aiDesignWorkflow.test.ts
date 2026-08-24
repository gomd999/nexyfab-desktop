import { describe, expect, it } from 'vitest';
import {
  assertAiDesignWorkflowState,
  createAiDesignWorkflowState,
  transitionAiDesignWorkflow,
} from './aiDesignWorkflow';

const checkpoint = { id: 'cp-1', revision: 0, digest: 'sha-1' } as const;
const evidence = (kind: 'understanding' | 'candidate' | 'verification', id: string, status: 'PASS' | 'FAIL' | 'NOT_RUN' = 'PASS') => ({ id, kind, checkpointId: checkpoint.id, revision: 0, status, digest: checkpoint.digest, source: 'worker-receipt-1' } as const);
const stateOf = <T extends { ok: boolean; state: any }>(result: T) => {
  expect(result.ok).toBe(true);
  return result.state;
};

describe('AI design workflow state machine', () => {
  it('walks the happy path and exposes current/next actions', () => {
    let state = createAiDesignWorkflowState();
    expect(state.status).toBe('EMPTY');
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'RECEIVE_INPUT', checkpoint }));
    expect(state.status).toBe('UNDERSTANDING');
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: evidence('understanding', 'ev-u') }));
    expect(state.status).toBe('READY_TO_GENERATE');
    expect(state.currentAction).toBe('generate');
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'START_GENERATION', runId: 'run-1' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'CANDIDATES_READY', evidence: evidence('candidate', 'ev-c') }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'REQUEST_PRECISION' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'START_PRECISION_VERIFICATION', runId: 'verify-1' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'VERIFICATION_COMPLETE', evidence: evidence('verification', 'ev-v') }));
    expect(state.status).toBe('VERIFIED');
    expect(state.evidence?.id).toBe('ev-v');
    expect(state.nextActions.map(action => action.id)).toContain('inspect-verification');
    expect(() => assertAiDesignWorkflowState(state)).not.toThrow();
  });

  it('requires a matching checkpoint and evidence before success', () => {
    let state = stateOf(transitionAiDesignWorkflow(createAiDesignWorkflowState(), { type: 'RECEIVE_INPUT', checkpoint }));
    const noEvidence = transitionAiDesignWorkflow(state, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: { ...evidence('understanding', 'x'), checkpointId: 'wrong' } });
    expect(noEvidence).toMatchObject({ ok: false, error: 'evidence_checkpoint_mismatch' });
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: evidence('understanding', 'ev-u') }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'START_GENERATION', runId: 'run-1' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'CANDIDATES_READY', evidence: evidence('candidate', 'ev-c') }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'REQUEST_PRECISION' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'START_PRECISION_VERIFICATION', runId: 'verify-1' }));
    const invalid = transitionAiDesignWorkflow(state, { type: 'VERIFICATION_COMPLETE', evidence: { ...evidence('verification', 'bad'), revision: 1 } });
    expect(invalid).toMatchObject({ ok: false, error: 'evidence_revision_mismatch' });
  });

  it('requires passing, sourced, digest-bound completion evidence for understanding and candidates', () => {
    let state = stateOf(transitionAiDesignWorkflow(createAiDesignWorkflowState(), { type: 'RECEIVE_INPUT', checkpoint }));
    expect(transitionAiDesignWorkflow(state, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: evidence('understanding', 'fail', 'FAIL') })).toMatchObject({ ok: false, error: 'evidence_not_pass' });
    expect(transitionAiDesignWorkflow(state, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: { ...evidence('understanding', 'source'), source: '' } })).toMatchObject({ ok: false, error: 'evidence_source_required' });
    expect(transitionAiDesignWorkflow(state, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: { ...evidence('understanding', 'digest'), digest: undefined } })).toMatchObject({ ok: false, error: 'evidence_digest_required' });
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: evidence('understanding', 'u') }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'START_GENERATION', runId: 'run' }));
    expect(transitionAiDesignWorkflow(state, { type: 'CANDIDATES_READY', evidence: evidence('candidate', 'candidate-fail', 'NOT_RUN') })).toMatchObject({ ok: false, error: 'evidence_not_pass' });
  });

  it('supports missing input, stale revisions, and guarded cancellation/resume', () => {
    let state = stateOf(transitionAiDesignWorkflow(createAiDesignWorkflowState(), { type: 'RECEIVE_INPUT', checkpoint }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'UNDERSTANDING_COMPLETE', missingInput: true, evidence: evidence('understanding', 'ev-u') }));
    expect(state.status).toBe('NEEDS_INPUT');
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'INPUT_RESOLVED' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'START_GENERATION', runId: 'run-1' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'CANCEL', reason: 'offline' }));
    expect(state.status).toBe('CANCELLED');
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'RESUME' }));
    expect(state.status).toBe('GENERATING');
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'MARK_STALE', revision: 1 }));
    expect(state).toMatchObject({ status: 'STALE', revision: 1, checkpoint: null, currentAction: 'refresh' });
    expect(transitionAiDesignWorkflow(state, { type: 'CANCEL' })).toMatchObject({ ok: false, error: 'cancel_not_allowed' });
  });

  it('restores the exact interrupted stage and rejects non-passing or unbound verification', () => {
    let state = stateOf(transitionAiDesignWorkflow(createAiDesignWorkflowState(), { type: 'RECEIVE_INPUT', checkpoint }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'UNDERSTANDING_COMPLETE', missingInput: false, evidence: evidence('understanding', 'u') }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'START_GENERATION', runId: 'run' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'CANDIDATES_READY', evidence: evidence('candidate', 'c') }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'BEGIN_PARAMETRIC_EDIT' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'CANCEL', reason: 'backgrounded' }));
    expect(state.resumeStatus).toBe('PARAMETRIC_EDIT');
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'RESUME' }));
    expect(state.status).toBe('PARAMETRIC_EDIT');
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'REQUEST_PRECISION' }));
    state = stateOf(transitionAiDesignWorkflow(state, { type: 'START_PRECISION_VERIFICATION', runId: 'verify' }));
    expect(transitionAiDesignWorkflow(state, { type: 'VERIFICATION_COMPLETE', evidence: evidence('verification', 'fail', 'FAIL') })).toMatchObject({ ok: false, error: 'verification_not_pass' });
    expect(transitionAiDesignWorkflow(state, { type: 'VERIFICATION_COMPLETE', evidence: { ...evidence('verification', 'wrong-digest'), digest: 'other' } })).toMatchObject({ ok: false, error: 'evidence_digest_mismatch' });
    expect(transitionAiDesignWorkflow(state, { type: 'VERIFICATION_COMPLETE', evidence: { ...evidence('verification', 'no-source'), source: '' } })).toMatchObject({ ok: false, error: 'verification_evidence_incomplete' });
  });
});
