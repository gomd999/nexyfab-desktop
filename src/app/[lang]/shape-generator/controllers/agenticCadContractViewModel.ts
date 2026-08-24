import {
  AGENTIC_CAD_EXECUTION_PLAN_SCHEMA,
  validateAgenticCadDryRunReceipt,
  validateAgenticCadExecutionPlan,
  validateAgenticCadPolicyReceipt,
  type AgenticCadDryRunReceipt,
  type AgenticCadExecutionPlan,
  type AgenticCadPolicyReceipt,
} from '@/lib/cad/agenticCadExecutionPlan';
import { validateAgenticCadCanonicalPreviewResult } from '@/lib/cad/agenticCadCanonicalPreview';
import type { CadMessage } from '@/lib/cad/i18n/message';

export const AGENTIC_CAD_UI_CONTRACT_SCHEMA =
  'nexyfab.precision-cad.agent-ui-contract-envelope.v1' as const;

export type AgenticCadContractState =
  | 'NOT_RUN'
  | 'INVALID_CONTRACT'
  | 'DRY_RUN_ONLY'
  | 'READ_ONLY_READY'
  | 'BLOCKED'
  | 'SANDBOX_PASS'
  | 'AWAITING_HUMAN_APPROVAL';

export interface AgenticCadContractViewModel {
  state: AgenticCadContractState;
  cadPass: false;
  authoritative: false;
  release: 'HOLD';
  sandboxPassed: boolean;
  planSha256: string | null;
  receiptSha256: string | null;
  toolId: string | null;
  highestRisk: string | null;
  blocker: CadMessage | null;
}

const ENVELOPE_KEYS = ['schema', 'plan', 'dryRunReceipt', 'policyReceipt', 'previewResult'] as const;

function ownData(value: unknown, key: string): unknown {
  try {
    if (value === null || typeof value !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return false;
    return Reflect.ownKeys(value).every(key => typeof key === 'string'
      && Boolean(Object.getOwnPropertyDescriptor(value, key)?.enumerable)
      && 'value' in Object.getOwnPropertyDescriptor(value, key)!);
  } catch {
    return false;
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  try {
    const keys = Object.keys(value).sort();
    const wanted = [...expected].sort();
    return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
  } catch {
    return false;
  }
}

function base(state: AgenticCadContractState): AgenticCadContractViewModel {
  return {
    state,
    cadPass: false,
    authoritative: false,
    release: 'HOLD',
    sandboxPassed: false,
    planSha256: null,
    receiptSha256: null,
    toolId: null,
    highestRisk: null,
    blocker: null,
  };
}

function invalid(reason = 'agent_contract'): AgenticCadContractViewModel {
  return {
    ...base('INVALID_CONTRACT'),
    blocker: { code: 'CAD_RECEIPT_INVALID', params: { reason } },
  };
}

function policyBlocker(receipt: AgenticCadPolicyReceipt, plan: AgenticCadExecutionPlan): CadMessage {
  const issues = receipt.issues;
  if (issues.some(issue => issue.includes('staleBaseRevision') || issue.includes('expired') || issue.includes('notYetValid'))) {
    return { code: 'CAD_REVISION_STALE', params: { revision: plan.baseRevision.sequence } };
  }
  if (issues.some(issue => issue.includes('staleLockSet') || issue.includes('lock'))) {
    return { code: 'CAD_LOCK_CONFLICT', params: { resource: plan.documentId } };
  }
  if (issues.some(issue => issue.includes('permission'))) {
    return { code: 'CAD_PERMISSION_DENIED', params: { action: plan.steps[0]?.toolId ?? 'agent-plan' } };
  }
  if (issues.some(issue => issue.includes('registry'))) {
    return { code: 'CAD_FEATURE_REGISTRY_MISMATCH', params: { registry: plan.registryHash.slice(0, 12) } };
  }
  if (issues.some(issue => issue.includes('runtime'))) {
    return { code: 'CAD_RUNTIME_IDENTITY_MISMATCH', params: { field: 'runtimeIdentitySha256' } };
  }
  if (issues.some(issue => issue.includes('preflight') || issue.includes('dryRunHold'))) {
    return { code: 'CAD_PREFLIGHT_HOLD', params: { reason: 'agent_sandbox' } };
  }
  return { code: 'CAD_RECEIPT_INVALID', params: { reason: 'agent_policy' } };
}

/**
 * Legacy run completion is deliberately ignored. Only an exact, validated
 * `agenticCadContract` envelope can advance this view model beyond NOT_RUN.
 */
export function createAgenticCadContractViewModel(result: unknown): AgenticCadContractViewModel {
  const envelope = ownData(result, 'agenticCadContract');
  if (envelope === undefined) return base('NOT_RUN');
  if (!isDataRecord(envelope) || !exactKeys(envelope, ENVELOPE_KEYS)
    || ownData(envelope, 'schema') !== AGENTIC_CAD_UI_CONTRACT_SCHEMA) return invalid();

  const planInput = ownData(envelope, 'plan');
  if (!isDataRecord(planInput) || ownData(planInput, 'schema') !== AGENTIC_CAD_EXECUTION_PLAN_SCHEMA
    || validateAgenticCadExecutionPlan(planInput).length) return invalid('agent_plan');
  const plan = planInput as unknown as AgenticCadExecutionPlan;
  const dryInput = ownData(envelope, 'dryRunReceipt');
  const policyInput = ownData(envelope, 'policyReceipt');
  const previewInput = ownData(envelope, 'previewResult');
  const dryRun = dryInput === null ? null : dryInput as AgenticCadDryRunReceipt;

  if (dryInput !== null && validateAgenticCadDryRunReceipt(dryInput, plan).length) return invalid('agent_dry_run');
  if (previewInput !== null && validateAgenticCadCanonicalPreviewResult(previewInput, plan).length) return invalid('agent_preview');
  if (previewInput !== null) {
    const previewReceipt = ownData(previewInput, 'receipt');
    if (previewReceipt !== null && dryRun !== null
      && ownData(previewReceipt, 'receiptSha256') !== dryRun.receiptSha256) return invalid('agent_preview_binding');
  }

  const common = {
    planSha256: plan.planSha256,
    toolId: plan.steps[0]?.toolId ?? null,
    highestRisk: plan.highestRisk,
  };
  if (policyInput === null) return { ...base('DRY_RUN_ONLY'), ...common };
  if (validateAgenticCadPolicyReceipt(policyInput, plan, dryRun ?? undefined).length) return invalid('agent_policy');
  const policy = policyInput as AgenticCadPolicyReceipt;
  if ((policy.status === 'SANDBOX_COMPLETE' || policy.status === 'AWAITING_HUMAN_APPROVAL') && dryRun === null) {
    return invalid('agent_dry_run_missing');
  }
  if (previewInput !== null && ownData(previewInput, 'ok') === false && policy.status !== 'BLOCK') {
    return invalid('agent_preview_policy_mismatch');
  }
  const receiptSha256 = policy.receiptSha256;
  if (policy.status === 'BLOCK') {
    return { ...base('BLOCKED'), ...common, receiptSha256, blocker: policyBlocker(policy, plan) };
  }
  if (policy.status === 'READ_ONLY_READY') return { ...base('READ_ONLY_READY'), ...common, receiptSha256 };
  if (policy.status === 'DRY_RUN_REQUIRED') return { ...base('DRY_RUN_ONLY'), ...common, receiptSha256 };
  if (policy.status === 'SANDBOX_COMPLETE') {
    return { ...base('SANDBOX_PASS'), ...common, receiptSha256, sandboxPassed: true };
  }
  return { ...base('AWAITING_HUMAN_APPROVAL'), ...common, receiptSha256, sandboxPassed: true };
}
