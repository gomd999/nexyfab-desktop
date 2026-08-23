import { checkCadMutationScopeOwnership, type CadSelectionOwnership } from './cadCapabilityRegistry';
import type { AdaptiveComplexProductExecutionPlan } from './adaptiveComplexProductExecution';

export interface PrecisionCadAgentTask {
  schema: 'nexyfab.precision-cad-agent-task.v1';
  activeStage: string;
  affectedPartIds: string[];
  reasonCodes: string[];
  scope: 'affected_parts_only' | 'assembly_or_product';
  generationBinding?: PrecisionCadGenerationBinding;
}

export interface PrecisionCadGenerationBinding {
  projectId: string;
  runId: string;
  revision: number;
  stateSha256: string;
}

/**
 * Precision tasks are client-carried but not client-authorized. This helper
 * checks the normalized task against the ownership index from the signed
 * AgentSession before the run consumes quota or reaches the model loop.
 */
export function isPrecisionCadAgentTaskBoundToOwnership(
  task: PrecisionCadAgentTask,
  ownership: CadSelectionOwnership | null | undefined,
): boolean {
  return checkCadMutationScopeOwnership({
    partIds: task.affectedPartIds,
    assemblyScope: task.scope === 'assembly_or_product',
  }, ownership).decision === 'proven';
}

function safeStringList(value: unknown, limit: number): string[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const values = value.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean);
  return values.length === value.length && values.every(item => item.length <= 128)
    ? [...new Set(values)]
    : null;
}

function parseGenerationBinding(value: unknown): PrecisionCadGenerationBinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const binding = value as Record<string, unknown>;
  const projectId = typeof binding.projectId === 'string' ? binding.projectId.trim() : '';
  const runId = typeof binding.runId === 'string' ? binding.runId.trim() : '';
  const revision = binding.revision;
  const stateSha256 = typeof binding.stateSha256 === 'string' ? binding.stateSha256.toLowerCase() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(projectId)
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runId)
    || typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0
    || !/^[a-f0-9]{64}$/.test(stateSha256)) return undefined;
  return { projectId, runId, revision, stateSha256 };
}

/** Converts the persisted adaptive plan into a bounded, server-revalidated task. */
export function parsePrecisionCadAgentTask(value: unknown): PrecisionCadAgentTask | null {
  if (!value || typeof value !== 'object') return null;
  const plan = value as Record<string, unknown>;
  if (plan.schema !== 'nexyfab.adaptive-complex-product-execution.v1'
    || plan.nextAction !== 'run_ai_managed_precision_cad') return null;
  const precision = plan.precisionCad;
  if (!precision || typeof precision !== 'object') return null;
  const precisionRecord = precision as Record<string, unknown>;
  if (precisionRecord.required !== true || precisionRecord.executionMode !== 'ai_managed') return null;
  const scope = precisionRecord.scope;
  if (scope !== 'affected_parts_only' && scope !== 'assembly_or_product') return null;
  const activeStage = typeof plan.activeStage === 'string' ? plan.activeStage.trim() : '';
  const affectedPartIds = safeStringList(plan.affectedPartIds, 100);
  const reasonCodes = safeStringList(plan.reasonCodes, 50);
  if (!activeStage || activeStage.length > 64 || !affectedPartIds || !reasonCodes) return null;
  return {
    schema: 'nexyfab.precision-cad-agent-task.v1',
    activeStage,
    affectedPartIds,
    reasonCodes,
    scope,
    ...(parseGenerationBinding(plan.generationBinding) ? { generationBinding: parseGenerationBinding(plan.generationBinding) } : {}),
  };
}

/** Validates an already-normalized task received by the API. */
export function validatePrecisionCadAgentTask(value: unknown): PrecisionCadAgentTask | null {
  if (!value || typeof value !== 'object') return null;
  const task = value as Record<string, unknown>;
  if (task.schema !== 'nexyfab.precision-cad-agent-task.v1') return null;
  const scope = task.scope;
  const activeStage = typeof task.activeStage === 'string' ? task.activeStage.trim() : '';
  const affectedPartIds = safeStringList(task.affectedPartIds, 100);
  const reasonCodes = safeStringList(task.reasonCodes, 50);
  if ((scope !== 'affected_parts_only' && scope !== 'assembly_or_product')
    || !activeStage || activeStage.length > 64 || !affectedPartIds || !reasonCodes) return null;
  const generationBinding = parseGenerationBinding(task.generationBinding);
  return { schema: 'nexyfab.precision-cad-agent-task.v1', activeStage, affectedPartIds, reasonCodes, scope, ...(generationBinding ? { generationBinding } : {}) };
}

/** Exact comparison against a freshly rebuilt server execution plan. */
export function precisionCadAgentTaskMatchesPlan(task: PrecisionCadAgentTask, plan: AdaptiveComplexProductExecutionPlan): boolean {
  if (plan.nextAction !== 'run_ai_managed_precision_cad' || plan.precisionCad.required !== true || plan.precisionCad.executionMode !== 'ai_managed') return false;
  const expectedScope = plan.precisionCad.scope;
  if (expectedScope !== task.scope || plan.activeStage !== task.activeStage || expectedScope === null) return false;
  const equal = (left: readonly string[], right: readonly string[]) => [...new Set(left)].sort().join('\0') === [...new Set(right)].sort().join('\0');
  return equal(task.affectedPartIds, plan.affectedPartIds) && equal(task.reasonCodes, plan.reasonCodes);
}
