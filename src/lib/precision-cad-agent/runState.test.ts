import { describe, expect, it } from 'vitest';
import {
  approveToolCall,
  argumentsHash,
  beginRevalidation,
  cancelRun,
  completeRun,
  createAgentRun,
  planRun,
  queueRun,
  recordToolResult,
  requestToolCall,
  resumeRun,
  retryRun,
} from './runState';

const request = { request: 'Make a bracket', provider: 'local' as const, model: 'nexyfab-local' };
const readCall = { callId: 'c1', toolName: 'verify_3d', arguments: { intent: { type: 'box' } }, scope: 'read' as const };
const applyCall = { callId: 'c2', toolName: 'edit_part', arguments: { partId: 'p1', delta: { x: 1 } }, scope: 'apply' as const };

function planned() {
  const result = planRun(createAgentRun(request, 'run-test'));
  if (!result.ok) throw new Error(result.error.message);
  return result.run;
}

describe('precision CAD agent run state machine', () => {
  it('keeps an immutable event ledger and rejects invalid transitions', () => {
    const idle = createAgentRun(request, 'run-ledger');
    const invalid = recordToolResult(idle, { ok: true });
    expect(invalid.ok).toBe(false);
    expect(idle.state).toBe('idle');
    expect(Object.isFrozen(idle.events)).toBe(true);
    const started = planRun(idle);
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.run.events).not.toBe(idle.events);
      expect(idle.events).toHaveLength(1);
      expect(started.run.events).toHaveLength(2);
    }
  });

  it('requires a run-bound approval token and detects argument tampering', () => {
    const requested = requestToolCall(planned(), applyCall);
    expect(requested.ok).toBe(true);
    if (!requested.ok) return;
    expect(requested.run.state).toBe('awaiting_approval');
    const approval = requested.run.pendingApproval!;
    expect(approval.token).toContain(`run-test:${applyCall.callId}`);
    expect(argumentsHash(applyCall.arguments)).toBe(approval.argumentsHash);
    expect(approveToolCall(requested.run, 'wrong-token').ok).toBe(false);
    const tampered = { ...requested.run, pendingApproval: { ...approval, call: { ...approval.call, arguments: { partId: 'p1', delta: { x: 99 } } } } };
    expect(approveToolCall(tampered, approval.token).ok).toBe(false);
    const approved = approveToolCall(requested.run, approval.token);
    expect(approved.ok).toBe(true);
  });

  it('never auto-approves apply/export and enforces bounds', () => {
    let run = planned();
    const first = requestToolCall(run, applyCall);
    expect(first.ok && first.run.state).toBe('awaiting_approval');
    if (!first.ok) return;
    const approved = approveToolCall(first.run, first.run.pendingApproval!.token);
    if (!approved.ok) return;
    const result = recordToolResult(approved.run, { ok: true });
    expect(result.ok && result.run.state).toBe('planning');
    run = result.ok ? result.run : run;
    const bounded = requestToolCall(run, readCall);
    expect(bounded.ok).toBe(true);
    const limitRun = createAgentRun(request, 'run-limit', { maxSteps: 1, maxToolCalls: 1 });
    const limitPlanned = planRun(limitRun);
    if (!limitPlanned.ok) return;
    const one = requestToolCall(limitPlanned.run, readCall);
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    const oneResult = recordToolResult(one.run, { ok: true });
    if (!oneResult.ok) return;
    const nextPlan = oneResult.run;
    expect(requestToolCall(nextPlan, readCall)).toMatchObject({ ok: false, error: { code: 'MAX_STEPS_EXCEEDED' } });
  });

  it('supports cancel/resume and failed-run retry only', () => {
    const started = planned();
    const cancelled = cancelRun(started);
    expect(cancelled.ok && cancelled.run.state).toBe('cancelled');
    if (!cancelled.ok) return;
    const resumed = resumeRun(cancelled.run);
    expect(resumed.ok && resumed.run.state).toBe('planning');
    expect(retryRun(started).ok).toBe(false);
    const failed = { ...resumed.run, state: 'failed' as const };
    const retried = retryRun(failed);
    expect(retried.ok && retried.run.state).toBe('planning');
  });

  it('requires revalidation before completion', () => {
    const requested = requestToolCall(planned(), readCall);
    if (!requested.ok) return;
    const runningResult = recordToolResult(requested.run, { verdict: 'pass' });
    if (!runningResult.ok) return;
    const validation = beginRevalidation(runningResult.run);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(completeRun(validation.run, { verdict: 'pass' }).ok).toBe(true);
  });

  it('stops browser continuation after durable commercial queue ownership transfers', () => {
    const requested = requestToolCall(planned(), applyCall);
    if (!requested.ok) return;
    const approved = approveToolCall(requested.run, requested.run.pendingApproval!.token);
    if (!approved.ok) return;
    const queued = queueRun(approved.run, { execution: { status: 'queued', executionId: 'execution-1' } });
    expect(queued.ok && queued.run.state).toBe('queued');
    if (!queued.ok) return;
    expect(queued.run.events.at(-1)?.type).toBe('run_queued');
    expect(cancelRun(queued.run).ok).toBe(false);
    expect(planRun(queued.run).ok).toBe(false);
  });
});
