import { describe, expect, it } from 'vitest';
import {
  createAgenticCadApprovalCandidate,
  createAgenticCadDryRunReceipt,
  createAgenticCadExecutionPlan,
  evaluateAgenticCadExecutionPlan,
  validateAgenticCadDryRunReceipt,
  validateAgenticCadExecutionPlan,
  validateAgenticCadPolicyReceipt,
  type AgenticCadDryRunStepOutcome,
  type AgenticCadExecutionPlan,
  type AgenticCadPolicyContext,
} from './agenticCadExecutionPlan';
import { FEATURE_REGISTRY_HASH } from './featureRegistry';
import { getAgenticCadToolDescriptor } from './agenticCadToolRegistry';

const h = (character: string) => character.repeat(64);
const baseRevision = { revisionId: 'revision-1', sequence: 1, contentSha256: h('a') };
const issuedAt = '2026-08-24T00:00:00.000Z';
const expiresAt = '2026-08-24T01:00:00.000Z';

function input(toolId: Parameters<typeof getAgenticCadToolDescriptor>[0]) {
  const descriptor = getAgenticCadToolDescriptor(toolId);
  if (!descriptor) throw new Error('missing test descriptor');
  return { artifactId: `input:${toolId}`, contentSha256: h('b'), schema: descriptor.inputSchema };
}

function plan(toolId: 'project.inspect' | 'feature.preview' | 'feature.commit'): AgenticCadExecutionPlan {
  const authoritative = toolId === 'feature.commit';
  return createAgenticCadExecutionPlan({
    planId: `plan:${toolId}`,
    projectId: 'project-1',
    documentId: 'document-1',
    domain: 'mechanical',
    baseRevision,
    lockSetSha256: h('c'),
    agentIdentity: { agentId: 'agent-1', modelId: 'model-1', promptSha256: h('d') },
    steps: [{
      stepId: 'step-1',
      toolId,
      input: input(toolId),
      expectedChangedObjectIds: authoritative ? ['mechanical:part-1'] : [],
      expectedOutputArtifactIds: authoritative ? ['artifact:brep-1'] : [],
      idempotencyKey: toolId === 'project.inspect' ? null : 'idempotency-1',
      canonicalCommandSha256: authoritative ? h('e') : null,
      featureRegistryHash: authoritative ? FEATURE_REGISTRY_HASH : null,
      runtimeIdentitySha256: authoritative ? h('f') : null,
      preflightReceiptSha256: authoritative ? h('1') : null,
    }],
    issuedAt,
    expiresAt,
  });
}

function outcome(draft: AgenticCadExecutionPlan, status: 'PASS' | 'HOLD' = 'PASS'): AgenticCadDryRunStepOutcome {
  const step = draft.steps[0]!;
  return {
    stepId: step.stepId,
    status,
    changedObjectIds: [...step.expectedChangedObjectIds],
    invalidated: step.sideEffect === 'CANONICAL_MUTATION' ? ['exactGeometry', 'drawing', 'qualification'] : [],
    findingCodes: status === 'HOLD' ? ['EXACT_PREFLIGHT_HOLD'] : [],
    outputArtifacts: step.expectedOutputArtifactIds.map(artifactId => ({ artifactId, contentSha256: h('2') })),
    evidenceSha256: h('3'),
  };
}

function context(overrides: Partial<AgenticCadPolicyContext> = {}): AgenticCadPolicyContext {
  return {
    currentRevision: baseRevision,
    currentLockSetSha256: h('c'),
    evaluatedAt: '2026-08-24T00:30:00.000Z',
    permissions: ['VIEW_DOCUMENT', 'EDIT_DOCUMENT', 'GENERATE_ARTIFACT', 'VERIFY_DOCUMENT'],
    ...overrides,
  };
}

describe('GP-07 agent execution plan and policy receipts', () => {
  it('seals a read-only plan and never returns commit authority', () => {
    const draft = plan('project.inspect');
    expect(validateAgenticCadExecutionPlan(draft)).toEqual([]);
    const decision = evaluateAgenticCadExecutionPlan(draft, context());
    expect(validateAgenticCadPolicyReceipt(decision, draft)).toEqual([]);
    expect(decision).toMatchObject({
      status: 'READ_ONLY_READY', authority: 'POLICY_EVALUATION_ONLY',
      authoritativeCommit: 'NOT_AUTHORIZED', release: 'HOLD', issues: [],
    });
    expect(decision.receiptSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps preview in the sandbox after a complete dry run', () => {
    const draft = plan('feature.preview');
    expect(evaluateAgenticCadExecutionPlan(draft, context()).status).toBe('DRY_RUN_REQUIRED');
    const dryRun = createAgenticCadDryRunReceipt(draft, [outcome(draft)], '2026-08-24T00:10:00.000Z');
    expect(validateAgenticCadDryRunReceipt(dryRun, draft)).toEqual([]);
    const decision = evaluateAgenticCadExecutionPlan(draft, context({ dryRunReceipt: dryRun }));
    expect(validateAgenticCadPolicyReceipt(decision, draft, dryRun)).toEqual([]);
    expect(decision).toMatchObject({
      status: 'SANDBOX_COMPLETE', authoritativeCommit: 'NOT_AUTHORIZED', dryRunReceiptSha256: dryRun.receiptSha256,
    });
  });

  it('requires current feature/runtime/preflight bindings and stops at human approval', () => {
    const draft = plan('feature.commit');
    expect(validateAgenticCadExecutionPlan(draft)).toEqual([]);
    const dryRun = createAgenticCadDryRunReceipt(draft, [outcome(draft)], '2026-08-24T00:10:00.000Z');
    const decision = evaluateAgenticCadExecutionPlan(draft, context({ dryRunReceipt: dryRun }));
    expect(validateAgenticCadPolicyReceipt(decision, draft, dryRun)).toEqual([]);
    expect(decision).toMatchObject({
      status: 'AWAITING_HUMAN_APPROVAL', authoritativeCommit: 'NOT_AUTHORIZED', release: 'HOLD', issues: [],
    });
    const candidate = createAgenticCadApprovalCandidate({
      plan: draft,
      policyReceipt: decision,
      humanActorId: 'reviewer-1',
      approvalScope: 'document-1:feature-commit',
      approvedStepIds: ['step-1'],
      issuedAt: '2026-08-24T00:11:00.000Z',
      expiresAt: '2026-08-24T00:20:00.000Z',
    });
    expect(candidate).toMatchObject({
      authority: 'UNTRUSTED_CANDIDATE', status: 'AWAITING_TRUSTED_AUTHORITY',
      authoritativeCommit: 'NOT_AUTHORIZED', release: 'HOLD',
    });
  });

  it('turns changed-set, output-set, partial and evidence tampering into HOLD/BLOCK', () => {
    const draft = plan('feature.commit');
    const changed = outcome(draft);
    changed.changedObjectIds = ['mechanical:other'];
    changed.outputArtifacts = [];
    const held = createAgenticCadDryRunReceipt(draft, [changed], '2026-08-24T00:10:00.000Z');
    expect(held).toMatchObject({ status: 'HOLD', steps: [{ status: 'HOLD' }] });
    expect(held.steps[0]?.findingCodes).toEqual(expect.arrayContaining(['DRY_RUN_CHANGED_SET_MISMATCH', 'DRY_RUN_OUTPUT_SET_MISMATCH']));
    expect(evaluateAgenticCadExecutionPlan(draft, context({ dryRunReceipt: held }))).toMatchObject({ status: 'BLOCK', issues: ['policy:dryRunHold'] });

    const valid = createAgenticCadDryRunReceipt(draft, [outcome(draft)], '2026-08-24T00:10:00.000Z');
    const tampered = { ...valid, steps: [{ ...valid.steps[0]!, evidenceSha256: h('9') }] };
    expect(validateAgenticCadDryRunReceipt(tampered, draft)).toContain('dryRun:hashMismatch');
    expect(evaluateAgenticCadExecutionPlan(draft, context({ dryRunReceipt: tampered })).status).toBe('BLOCK');
  });

  it('blocks stale revision/locks, expired plans, missing permissions and registry drift', () => {
    const draft = plan('feature.commit');
    expect(evaluateAgenticCadExecutionPlan(draft, context({ currentRevision: { ...baseRevision, sequence: 2 } }))).toMatchObject({ status: 'BLOCK', issues: expect.arrayContaining(['policy:staleBaseRevision']) });
    expect(evaluateAgenticCadExecutionPlan(draft, context({ currentLockSetSha256: h('9') }))).toMatchObject({ status: 'BLOCK', issues: expect.arrayContaining(['policy:staleLockSet']) });
    expect(evaluateAgenticCadExecutionPlan(draft, context({ evaluatedAt: expiresAt }))).toMatchObject({ status: 'BLOCK', issues: expect.arrayContaining(['policy:expired']) });
    expect(evaluateAgenticCadExecutionPlan(draft, context({ permissions: ['VIEW_DOCUMENT'] }))).toMatchObject({ status: 'BLOCK', issues: expect.arrayContaining(['policy:permission:EDIT_DOCUMENT']) });
    expect(validateAgenticCadExecutionPlan({ ...draft, registryHash: h('0') })).toEqual(expect.arrayContaining(['plan:registryHash', 'plan:hashMismatch']));
  });

  it('does not accept raw prompt/tool arguments, unknown schemas or unordered dependencies', () => {
    const descriptor = getAgenticCadToolDescriptor('feature.preview')!;
    expect(() => createAgenticCadExecutionPlan({
      planId: 'plan-hostile', projectId: 'project-1', documentId: 'document-1', domain: 'mechanical',
      baseRevision, lockSetSha256: h('c'), agentIdentity: { agentId: 'agent-1', modelId: 'model-1', promptSha256: h('d') },
      steps: [{
        stepId: 'step-1', toolId: 'feature.preview',
        input: { artifactId: 'input-1', contentSha256: h('b'), schema: 'unknown.schema' },
        idempotencyKey: 'idempotency-1',
      }], issuedAt, expiresAt,
    })).toThrow('inputSchema');
    expect(descriptor.inputSchema).not.toBe('unknown.schema');

    const read = plan('project.inspect');
    const poisoned = { ...read, steps: [{ ...read.steps[0]!, input: { ...read.steps[0]!.input, rawPrompt: '$(malicious)' } }] };
    expect(validateAgenticCadExecutionPlan(poisoned)).toContain('plan:steps[0]:input:invalid');

    const dependency = structuredClone(read);
    dependency.steps[0]!.dependencies = ['future-step'];
    dependency.planSha256 = h('0');
    expect(validateAgenticCadExecutionPlan(dependency)).toEqual(expect.arrayContaining(['plan:steps[0]:dependencies', 'plan:hashMismatch']));
  });

  it('is nonthrowing for proxy/getter input and cannot create approval from a forged policy result', () => {
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error('boom'); } });
    expect(validateAgenticCadExecutionPlan(hostile)).toEqual(['plan:unreadable']);
    expect(evaluateAgenticCadExecutionPlan(hostile, context())).toMatchObject({ status: 'BLOCK', authoritativeCommit: 'NOT_AUTHORIZED' });

    const draft = plan('feature.commit');
    const forged = { ...evaluateAgenticCadExecutionPlan(draft, context()), status: 'AWAITING_HUMAN_APPROVAL' as const, planSha256: draft.planSha256, dryRunReceiptSha256: h('8') };
    expect(() => createAgenticCadApprovalCandidate({
      plan: draft, policyReceipt: forged, humanActorId: 'reviewer-1', approvalScope: 'document-1',
      approvedStepIds: ['step-1'], issuedAt: '2026-08-24T00:11:00.000Z', expiresAt: '2026-08-24T00:20:00.000Z',
    })).not.toThrow();
    const candidate = createAgenticCadApprovalCandidate({
      plan: draft, policyReceipt: forged, humanActorId: 'reviewer-1', approvalScope: 'document-1',
      approvedStepIds: ['step-1'], issuedAt: '2026-08-24T00:11:00.000Z', expiresAt: '2026-08-24T00:20:00.000Z',
    });
    expect(candidate.authoritativeCommit).toBe('NOT_AUTHORIZED');
    expect(validateAgenticCadPolicyReceipt(forged, draft)).toContain('policyReceipt:hashMismatch');
    expect(validateAgenticCadPolicyReceipt(hostile)).toEqual(['policyReceipt:unreadable']);
  });
});
