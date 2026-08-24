import {
  applyCanonicalCadCommandV2,
  canonicalCadConsumerDraftJson,
  sealCanonicalCadCommandV2,
  validateCanonicalCadCommandV2,
  validateCanonicalCadDocumentV2,
  type CanonicalCadCommandV2ConsumerDraft,
  type CanonicalCadDocumentV2ConsumerDraft,
  type CanonicalCadExecutionContext,
  type CanonicalCadOperationV2,
} from './canonicalCadV2ConsumerDraft';
import {
  createAgenticCadDryRunReceipt,
  validateAgenticCadDryRunReceipt,
  validateAgenticCadExecutionPlan,
  type AgenticCadDryRunReceipt,
  type AgenticCadExecutionPlan,
} from './agenticCadExecutionPlan';

export type AgenticCadCanonicalPreviewResult =
  | {
      ok: true;
      authority: 'SANDBOX_CANDIDATE_ONLY';
      document: CanonicalCadDocumentV2ConsumerDraft;
      previewCommandSha256: string;
      receipt: AgenticCadDryRunReceipt;
      issues: [];
    }
  | {
      ok: false;
      authority: 'SANDBOX_CANDIDATE_ONLY';
      document: CanonicalCadDocumentV2ConsumerDraft;
      previewCommandSha256: string | null;
      receipt: AgenticCadDryRunReceipt | null;
      issues: string[];
    };

const ALLOWED_OPERATION_KINDS = new Set(['create', 'update', 'move', 'host']);
const MAX_AGENT_PREVIEW_OPERATIONS = 16;
const PREVIEW_RESULT_KEYS = ['ok', 'authority', 'document', 'previewCommandSha256', 'receipt', 'issues'] as const;
const SHA256 = /^[a-f0-9]{64}$/;

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

function isIssueArray(value: unknown): value is string[] {
  try {
    return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype && value.length <= 128
      && Reflect.ownKeys(value).every(key => key === 'length' || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key)
        && Boolean(Object.getOwnPropertyDescriptor(value, key)?.enumerable) && 'value' in Object.getOwnPropertyDescriptor(value, key)!))
      && value.every(issue => typeof issue === 'string' && issue.length > 0 && issue.length <= 192 && !/[\u0000-\u001f\u007f]/.test(issue))
      && new Set(value).size === value.length;
  } catch {
    return false;
  }
}

function sorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return sorted(left).join('|') === sorted(right).join('|');
}

function sameJson(left: unknown, right: unknown): boolean {
  try {
    return canonicalCadConsumerDraftJson(left) === canonicalCadConsumerDraftJson(right);
  } catch {
    return false;
  }
}

function operationScope(operation: CanonicalCadOperationV2): { objectIds: string[]; paths: string[] } | null {
  if (operation.kind === 'create') return { objectIds: [operation.object.objectId], paths: ['object'] };
  if (operation.kind === 'update') return { objectIds: [operation.objectId], paths: ['payload'] };
  if (operation.kind === 'move') return { objectIds: [operation.objectId], paths: ['transform'] };
  if (operation.kind === 'host') return {
    objectIds: [operation.relationship.fromObjectId, operation.relationship.toObjectId],
    paths: ['relationships'],
  };
  if (operation.kind === 'relate' && operation.mode === 'create') return {
    objectIds: [operation.relationship.fromObjectId, operation.relationship.toObjectId],
    paths: ['relationships'],
  };
  return null;
}

function machineFinding(issue: string): string {
  const normalized = issue.toUpperCase().replace(/[^A-Z0-9_:-]+/g, '_').slice(0, 96);
  return `CAD_PREVIEW_${normalized || 'HOLD'}`;
}

function fail(
  document: CanonicalCadDocumentV2ConsumerDraft,
  issues: string[],
  previewCommandSha256: string | null = null,
  receipt: AgenticCadDryRunReceipt | null = null,
): AgenticCadCanonicalPreviewResult {
  return {
    ok: false,
    authority: 'SANDBOX_CANDIDATE_ONLY',
    document,
    previewCommandSha256,
    receipt,
    issues: sorted(issues).slice(0, 128),
  };
}

/**
 * Runs a bounded canonical graph proposal against an immutable draft clone.
 * It never persists, approves, rematerializes a human actor, or authorizes a
 * commit. Domain handlers, delete operations, and external side effects remain
 * outside this first GP-07 preview slice.
 */
export function previewAgenticCanonicalCadCommand(
  planInput: unknown,
  commandInput: unknown,
  document: CanonicalCadDocumentV2ConsumerDraft,
  execution: CanonicalCadExecutionContext,
): AgenticCadCanonicalPreviewResult {
  try {
    const planIssues = validateAgenticCadExecutionPlan(planInput);
    const commandIssues = validateCanonicalCadCommandV2(commandInput);
    const documentIssues = validateCanonicalCadDocumentV2(document);
    if (planIssues.length || commandIssues.length || documentIssues.length) {
      return fail(document, [...planIssues, ...commandIssues, ...documentIssues]);
    }
    const plan = planInput as AgenticCadExecutionPlan;
    const command = commandInput as CanonicalCadCommandV2ConsumerDraft;
    if (plan.steps.length !== 1 || plan.steps[0]?.toolId !== 'spatial.object.commit') return fail(document, ['agent_preview_tool_not_supported']);
    const step = plan.steps[0];
    const issues: string[] = [];
    if (plan.projectId !== document.projectId || plan.documentId !== document.documentId
      || command.projectId !== document.projectId || command.documentId !== document.documentId) issues.push('agent_preview_document_binding_mismatch');
    if (!sameJson(plan.baseRevision, document.revision) || !sameJson(command.baseRevision, document.revision)) issues.push('agent_preview_base_revision_stale');
    if (plan.lockSetSha256 !== command.preconditions.lockSetSha256) issues.push('agent_preview_lock_binding_mismatch');
    if (step.input.contentSha256 !== command.commandSha256 || step.canonicalCommandSha256 !== command.commandSha256) issues.push('agent_preview_command_hash_mismatch');
    if (command.actor.kind !== 'agent' || !command.actor.agentIdentity
      || command.actor.actorId !== plan.agentIdentity.agentId
      || !sameJson(command.actor.agentIdentity, plan.agentIdentity)) issues.push('agent_preview_actor_binding_mismatch');
    if (command.authorization.riskClass !== 'R3' || command.authorization.approvalReceiptSha256 !== null) issues.push('agent_preview_untrusted_authorization');
    if (command.operations.length > MAX_AGENT_PREVIEW_OPERATIONS) issues.push('agent_preview_operation_limit');

    const touchedObjects: string[] = [];
    const touchedPaths: string[] = [];
    for (const operation of command.operations) {
      const scope = operationScope(operation);
      if (!scope || (!ALLOWED_OPERATION_KINDS.has(operation.kind) && !(operation.kind === 'relate' && operation.mode === 'create'))) {
        issues.push(`agent_preview_operation_hold:${operation.kind}${operation.kind === 'relate' ? `:${operation.mode}` : ''}`);
        continue;
      }
      touchedObjects.push(...scope.objectIds);
      touchedPaths.push(...scope.paths);
    }
    if (!sameStrings(command.expectedChangedObjectIds, touchedObjects)
      || !sameStrings(step.expectedChangedObjectIds, touchedObjects)) issues.push('agent_preview_changed_scope_mismatch');
    if (!sameStrings(command.preconditions.selectedObjectIds, touchedObjects)) issues.push('agent_preview_selected_scope_mismatch');
    if (!sameStrings(command.preconditions.parameterPaths, touchedPaths)) issues.push('agent_preview_parameter_scope_mismatch');
    if (issues.length) return fail(document, issues);

    const { schema: _schema, contractVersion: _contract, modelVersion: _model, commandSha256: _hash, ...proposal } = structuredClone(command);
    void _schema; void _contract; void _model; void _hash;
    const previewCommand = sealCanonicalCadCommandV2({
      ...proposal,
      authorization: {
        ...proposal.authorization,
        riskClass: 'R2',
        approvalReceiptSha256: null,
      },
    });
    const transaction = applyCanonicalCadCommandV2(document, previewCommand, execution);
    const createdAt = execution.evaluatedAt;
    const receipt = createAgenticCadDryRunReceipt(plan, [{
      stepId: step.stepId,
      status: transaction.committed ? 'PASS' : 'HOLD',
      changedObjectIds: transaction.committed ? transaction.changedObjectIds : [],
      invalidated: transaction.committed
        ? ['exactGeometry', 'nativeDocument', 'analysis', 'drawing', 'quantity', 'exchange', 'qualification']
        : [],
      findingCodes: transaction.committed ? [] : transaction.issues.map(machineFinding),
      outputArtifacts: transaction.committed
        ? step.expectedOutputArtifactIds.map(artifactId => ({ artifactId, contentSha256: transaction.document.revision.contentSha256 }))
        : [],
      evidenceSha256: transaction.document.revision.contentSha256,
    }], createdAt);
    if (!transaction.committed) return fail(document, transaction.issues, previewCommand.commandSha256, receipt);
    return {
      ok: true,
      authority: 'SANDBOX_CANDIDATE_ONLY',
      document: transaction.document,
      previewCommandSha256: previewCommand.commandSha256,
      receipt,
      issues: [],
    };
  } catch {
    return fail(document, ['agent_preview_unreadable']);
  }
}

export function validateAgenticCadCanonicalPreviewResult(
  input: unknown,
  plan?: AgenticCadExecutionPlan,
): string[] {
  const issues: string[] = [];
  try {
    if (!isDataRecord(input) || !exactKeys(input, PREVIEW_RESULT_KEYS)) return ['previewResult:keys'];
    const result = input as unknown as AgenticCadCanonicalPreviewResult;
    if (typeof result.ok !== 'boolean' || result.authority !== 'SANDBOX_CANDIDATE_ONLY') issues.push('previewResult:contract');
    if (validateCanonicalCadDocumentV2(result.document).length) issues.push('previewResult:document');
    if (result.previewCommandSha256 !== null
      && (typeof result.previewCommandSha256 !== 'string' || !SHA256.test(result.previewCommandSha256))) issues.push('previewResult:commandHash');
    if (!isIssueArray(result.issues)) issues.push('previewResult:issues');
    if (plan && validateAgenticCadExecutionPlan(plan).length) issues.push('previewResult:plan');
    if (result.receipt !== null) {
      if (validateAgenticCadDryRunReceipt(result.receipt, plan).length) issues.push('previewResult:receipt');
    }
    if (result.ok) {
      if (result.previewCommandSha256 === null || result.receipt === null || result.receipt.status !== 'PASS'
        || result.issues.length !== 0) issues.push('previewResult:aggregateStatus');
    } else if (result.issues.length === 0
      || (result.receipt !== null && result.receipt.status !== 'HOLD')) issues.push('previewResult:aggregateStatus');
  } catch {
    return ['previewResult:unreadable'];
  }
  return [...new Set(issues)].slice(0, 128);
}
