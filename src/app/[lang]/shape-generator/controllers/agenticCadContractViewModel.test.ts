import { describe, expect, it, vi } from 'vitest';

import {
  createAgenticCadDryRunReceipt,
  createAgenticCadExecutionPlan,
  evaluateAgenticCadExecutionPlan,
} from '@/lib/cad/agenticCadExecutionPlan';
import { getAgenticCadToolDescriptor } from '@/lib/cad/agenticCadToolRegistry';
import {
  AGENTIC_CAD_UI_CONTRACT_SCHEMA,
  createAgenticCadContractViewModel,
} from './agenticCadContractViewModel';

const h = (character: string) => character.repeat(64);
const revision = { revisionId: 'revision-1', sequence: 1, contentSha256: h('a') };

function plan(toolId: 'project.inspect' | 'feature.preview') {
  const descriptor = getAgenticCadToolDescriptor(toolId)!;
  return createAgenticCadExecutionPlan({
    planId: `plan:${toolId}`,
    projectId: 'project-1',
    documentId: 'document-1',
    domain: 'mechanical',
    baseRevision: revision,
    lockSetSha256: h('b'),
    agentIdentity: { agentId: 'agent-1', modelId: 'model-1', promptSha256: h('c') },
    steps: [{
      stepId: 'step-1',
      toolId,
      input: { artifactId: 'artifact:input', contentSha256: h('d'), schema: descriptor.inputSchema },
      idempotencyKey: toolId === 'project.inspect' ? null : 'idempotency-1',
    }],
    issuedAt: '2026-08-24T00:00:00.000Z',
    expiresAt: '2026-08-24T01:00:00.000Z',
  });
}

function policyContext(dryRunReceipt?: unknown, overrides: Record<string, unknown> = {}) {
  return {
    currentRevision: revision,
    currentLockSetSha256: h('b'),
    evaluatedAt: '2026-08-24T00:30:00.000Z',
    permissions: ['VIEW_DOCUMENT', 'EDIT_DOCUMENT'],
    ...(dryRunReceipt !== undefined ? { dryRunReceipt } : {}),
    ...overrides,
  } as never;
}

function envelope(planValue: unknown, dryRunReceipt: unknown, policyReceipt: unknown, previewResult: unknown = null) {
  return {
    agenticCadContract: {
      schema: AGENTIC_CAD_UI_CONTRACT_SCHEMA,
      plan: planValue,
      dryRunReceipt,
      policyReceipt,
      previewResult,
    },
  };
}

describe('GP-08 agentic CAD contract view model', () => {
  it('never treats legacy generic completion values as CAD PASS', () => {
    for (const result of [null, 'done', {}, { ok: true }, { pass: true }, { status: 'HOLD' }]) {
      expect(createAgenticCadContractViewModel(result)).toMatchObject({
        state: 'NOT_RUN', cadPass: false, authoritative: false, release: 'HOLD', sandboxPassed: false,
      });
    }
  });

  it('accepts a validated read-only policy while retaining release HOLD', () => {
    const draft = plan('project.inspect');
    const policy = evaluateAgenticCadExecutionPlan(draft, policyContext());
    expect(createAgenticCadContractViewModel(envelope(draft, null, policy))).toMatchObject({
      state: 'READ_ONLY_READY', cadPass: false, authoritative: false, release: 'HOLD',
      planSha256: draft.planSha256, receiptSha256: policy.receiptSha256,
    });
  });

  it('labels a complete dry run as sandbox-only, never authoritative PASS', () => {
    const draft = plan('feature.preview');
    const dry = createAgenticCadDryRunReceipt(draft, [{
      stepId: 'step-1', status: 'PASS', changedObjectIds: [], invalidated: [], findingCodes: [],
      outputArtifacts: [], evidenceSha256: h('e'),
    }], '2026-08-24T00:10:00.000Z');
    const policy = evaluateAgenticCadExecutionPlan(draft, policyContext(dry));
    expect(createAgenticCadContractViewModel(envelope(draft, dry, policy))).toMatchObject({
      state: 'SANDBOX_PASS', sandboxPassed: true, cadPass: false,
      authoritative: false, release: 'HOLD',
    });
  });

  it('fails forged, partial and hostile envelopes closed without reading getters', () => {
    const draft = plan('project.inspect');
    const policy = evaluateAgenticCadExecutionPlan(draft, policyContext());
    expect(createAgenticCadContractViewModel(envelope(draft, null, { ...policy, status: 'SANDBOX_COMPLETE' }))).toMatchObject({ state: 'INVALID_CONTRACT' });
    expect(createAgenticCadContractViewModel({ agenticCadContract: { schema: AGENTIC_CAD_UI_CONTRACT_SCHEMA } })).toMatchObject({ state: 'INVALID_CONTRACT' });

    const getter = vi.fn(() => envelope(draft, null, policy).agenticCadContract);
    const hostile = Object.defineProperty({}, 'agenticCadContract', { enumerable: true, get: getter });
    expect(createAgenticCadContractViewModel(hostile)).toMatchObject({ state: 'NOT_RUN' });
    expect(getter).not.toHaveBeenCalled();
  });

  it('maps stale policy blockers to localized message codes instead of raw issues', () => {
    const draft = plan('project.inspect');
    const policy = evaluateAgenticCadExecutionPlan(draft, policyContext(undefined, {
      currentRevision: { ...revision, sequence: 2 },
    }));
    expect(createAgenticCadContractViewModel(envelope(draft, null, policy))).toMatchObject({
      state: 'BLOCKED', blocker: { code: 'CAD_REVISION_STALE' },
    });
  });
});
