import { createHash } from 'node:crypto';
import type { ConstructionPackage } from './module';
import type { ConstructionObjectBinding, ConstructionRevisionBinding, ConstructionQuantityRole } from './provenance';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;
const ROLES: readonly ConstructionQuantityRole[] = ['concrete', 'rebar', 'formwork', 'schedule'];
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const hash = (value: unknown) => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const fail = (reason: string): never => { throw new Error(`CONSTRUCTION_CHANGE_IMPACT_INVALID:${reason}`); };

export type ConstructionChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';
export interface ConstructionObjectChange {
  id: string;
  objectId: string;
  role: ConstructionQuantityRole;
  kind: ConstructionChangeKind;
  beforeSourceObjectSha256: string | null;
  afterSourceObjectSha256: string | null;
}
export interface ConstructionImpactRow {
  id: string;
  objectId: string;
  role: ConstructionQuantityRole;
  changeKind: Exclude<ConstructionChangeKind, 'unchanged'>;
  impact: 'quantity' | 'schedule';
}
export interface ConstructionChangeImpact {
  schema: 'nexyfab.construction-change-impact.v1';
  workspaceLineageId: string;
  beforeRevisionNumber: number;
  beforeWorkspaceRevisionId: string;
  beforeWorkspaceContentHash: string;
  beforeBindingSha256: string;
  afterRevisionNumber: number;
  afterWorkspaceRevisionId: string;
  afterWorkspaceContentHash: string;
  afterBindingSha256: string;
  beforeObjectBindingHashes: Record<string, { role: ConstructionQuantityRole; sourceObjectSha256: string }>;
  afterObjectBindingHashes: Record<string, { role: ConstructionQuantityRole; sourceObjectSha256: string }>;
  changes: ConstructionObjectChange[];
  impacts: ConstructionImpactRow[];
  counts: { added: number; removed: number; changed: number; unchanged: number; quantityImpacts: number; scheduleImpacts: number };
  costEvidence: 'NOT_RUN';
  procurementEvidence: 'NOT_RUN';
  fieldProgressEvidence: 'NOT_RUN';
  contractEvidence: 'NOT_RUN';
  releaseEligible: false;
  resultSha256: string;
}

type BindingOrPackage = ConstructionRevisionBinding | ConstructionPackage;
export interface ConstructionChangeImpactSource {
  value: BindingOrPackage;
  /** Explicit workspace lineage; never inferred from a revision label. */
  workspaceLineageId: string;
  /** Explicit safe-integer workspace revision supplied by the caller. */
  revisionNumber: number;
}
function isPackage(value: BindingOrPackage): value is ConstructionPackage { return Boolean(value && typeof value === 'object' && 'provenance' in value && 'claimBoundary' in value); }
function extractBinding(value: BindingOrPackage): ConstructionRevisionBinding {
  if (!value || typeof value !== 'object') fail('INPUT_MALFORMED');
  if (isPackage(value)) {
    if (value.claimBoundary.releaseEligible !== false || !['NOT_RUN', 'NOT_APPLICABLE'].includes(value.claimBoundary.actualCostEvidence) || !['NOT_RUN', 'NOT_APPLICABLE'].includes(value.claimBoundary.actualSiteEvidence)) fail('PACKAGE_RELEASE_TRUTH');
    if (value.provenance.priceEvidence?.authority === 'authoritative' || value.provenance.siteEvidence?.authority === 'authoritative') fail('PACKAGE_AUTHORITY_CLAIM');
    if (canonical(value.provenance.quantityObjects) !== canonical(value.provenance.revisionBinding.objectBindings)) fail('PACKAGE_QUANTITY_OWNERSHIP');
    return value.provenance.revisionBinding;
  }
  return value;
}
function bindingMap(binding: ConstructionRevisionBinding): Map<string, ConstructionObjectBinding> {
  if (!binding || !Array.isArray(binding.objectBindings) || binding.objectBindings.length === 0) fail('OBJECT_BINDINGS_MISSING');
  if (binding.bindingMode !== 'workspace_explicit') fail('LEGACY_DERIVED_BINDING');
  if (binding.revisionId !== binding.workspaceRevisionId || binding.revisionSha256 !== binding.workspaceContentHash) fail('WORKSPACE_BINDING_ALIAS_MISMATCH');
  if (!ID.test(binding.workspaceRevisionId) || !SHA256.test(binding.workspaceContentHash) || !SHA256.test(binding.bindingSha256)) fail('WORKSPACE_BINDING_INVALID');
  const map = new Map<string, ConstructionObjectBinding>();
  for (const item of binding.objectBindings) {
    if (!item || typeof item !== 'object' || !ID.test(item.objectId) || item.bimObjectId !== item.objectId || !ROLES.includes(item.role) || item.workspaceRevisionId !== binding.workspaceRevisionId || item.workspaceContentHash !== binding.workspaceContentHash || item.sourceRevisionId !== binding.revisionId || item.sourceRevisionSha256 !== binding.revisionSha256 || !SHA256.test(item.sourceObjectSha256)) fail('OBJECT_BINDING_INVALID');
    if (map.has(item.objectId)) fail(`OBJECT_ID_DUPLICATE:${item.objectId}`);
    map.set(item.objectId, item);
  }
  const expectedBindingHash = hash({ revisionId: binding.revisionId, revisionSha256: binding.revisionSha256, workspaceRevisionId: binding.workspaceRevisionId, workspaceContentHash: binding.workspaceContentHash, bindingMode: binding.bindingMode, payloadSha256: binding.payloadSha256, objectBindings: binding.objectBindings });
  if (expectedBindingHash !== binding.bindingSha256) fail('BINDING_HASH_MISMATCH');
  return map;
}
function objectHashes(map: Map<string, ConstructionObjectBinding>): Record<string, { role: ConstructionQuantityRole; sourceObjectSha256: string }> {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, item]) => [id, { role: item.role, sourceObjectSha256: item.sourceObjectSha256 }]));
}

export function buildConstructionChangeImpact(input: { before: ConstructionChangeImpactSource; after: ConstructionChangeImpactSource }): ConstructionChangeImpact {
  if (!input?.before || !input?.after || typeof input.before.workspaceLineageId !== 'string' || !input.before.workspaceLineageId.trim() || typeof input.after.workspaceLineageId !== 'string' || !input.after.workspaceLineageId.trim() || !Number.isSafeInteger(input.before.revisionNumber) || input.before.revisionNumber < 0 || !Number.isSafeInteger(input.after.revisionNumber) || input.after.revisionNumber < 0) fail('EXPLICIT_REVISION_CONTRACT_INVALID');
  const before = extractBinding(input.before.value), after = extractBinding(input.after.value);
  const beforeMap = bindingMap(before), afterMap = bindingMap(after);
  if (input.before.workspaceLineageId !== input.after.workspaceLineageId) fail('WORKSPACE_LINEAGE_MISMATCH');
  if (input.after.revisionNumber <= input.before.revisionNumber) fail('WORKSPACE_REVISION_NOT_INCREASING');
  const allIds = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort((a, b) => a.localeCompare(b));
  const changes: ConstructionObjectChange[] = allIds.map((objectId) => {
    const oldItem = beforeMap.get(objectId), newItem = afterMap.get(objectId);
    const kind: ConstructionChangeKind = !oldItem ? 'added' : !newItem ? 'removed' : oldItem.role !== newItem.role || oldItem.sourceObjectSha256 !== newItem.sourceObjectSha256 ? 'changed' : 'unchanged';
    const role = newItem?.role ?? oldItem!.role;
    return { id: `change:${kind}:${role}:${objectId}`, objectId, role, kind, beforeSourceObjectSha256: oldItem?.sourceObjectSha256 ?? null, afterSourceObjectSha256: newItem?.sourceObjectSha256 ?? null };
  });
  const impacts: ConstructionImpactRow[] = changes.filter((item): item is ConstructionObjectChange & { kind: Exclude<ConstructionChangeKind, 'unchanged'> } => item.kind !== 'unchanged').map((item) => ({ id: `impact:${item.kind}:${item.role}:${item.objectId}`, objectId: item.objectId, role: item.role, changeKind: item.kind, impact: item.role === 'schedule' ? 'schedule' : 'quantity' }));
  const counts = { added: changes.filter((item) => item.kind === 'added').length, removed: changes.filter((item) => item.kind === 'removed').length, changed: changes.filter((item) => item.kind === 'changed').length, unchanged: changes.filter((item) => item.kind === 'unchanged').length, quantityImpacts: impacts.filter((item) => item.impact === 'quantity').length, scheduleImpacts: impacts.filter((item) => item.impact === 'schedule').length };
  const draft = { schema: 'nexyfab.construction-change-impact.v1' as const, workspaceLineageId: input.before.workspaceLineageId, beforeRevisionNumber: input.before.revisionNumber, beforeWorkspaceRevisionId: before.workspaceRevisionId, beforeWorkspaceContentHash: before.workspaceContentHash, beforeBindingSha256: before.bindingSha256, afterRevisionNumber: input.after.revisionNumber, afterWorkspaceRevisionId: after.workspaceRevisionId, afterWorkspaceContentHash: after.workspaceContentHash, afterBindingSha256: after.bindingSha256, beforeObjectBindingHashes: objectHashes(beforeMap), afterObjectBindingHashes: objectHashes(afterMap), changes, impacts, counts, costEvidence: 'NOT_RUN' as const, procurementEvidence: 'NOT_RUN' as const, fieldProgressEvidence: 'NOT_RUN' as const, contractEvidence: 'NOT_RUN' as const, releaseEligible: false as const };
  return { ...draft, resultSha256: hash(draft) };
}

export function validateConstructionChangeImpact(value: ConstructionChangeImpact): string[] {
  const issues: string[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['change_impact_input_invalid'];
  if (!value || value.schema !== 'nexyfab.construction-change-impact.v1' || value.costEvidence !== 'NOT_RUN' || value.procurementEvidence !== 'NOT_RUN' || value.fieldProgressEvidence !== 'NOT_RUN' || value.contractEvidence !== 'NOT_RUN' || value.releaseEligible !== false) issues.push('change_impact_truth_invalid');
  const validRevision = (revision: unknown) => typeof revision === 'number' && Number.isSafeInteger(revision) && revision >= 0;
  if (typeof value.workspaceLineageId !== 'string' || !ID.test(value.workspaceLineageId) || !validRevision(value.beforeRevisionNumber) || !validRevision(value.afterRevisionNumber) || value.afterRevisionNumber <= value.beforeRevisionNumber) issues.push('change_impact_revision_contract_invalid');
  if (typeof value.beforeWorkspaceRevisionId !== 'string' || typeof value.afterWorkspaceRevisionId !== 'string' || !ID.test(value.beforeWorkspaceRevisionId) || !ID.test(value.afterWorkspaceRevisionId) || !SHA256.test(value.beforeWorkspaceContentHash) || !SHA256.test(value.afterWorkspaceContentHash) || !SHA256.test(value.beforeBindingSha256) || !SHA256.test(value.afterBindingSha256)) issues.push('change_impact_binding_invalid');
  type ObjectBindingSummary = { role: ConstructionQuantityRole; sourceObjectSha256: string };
  const validateHashMap = (input: unknown, name: string): Record<string, ObjectBindingSummary> => {
    const result: Record<string, ObjectBindingSummary> = {};
    if (!input || typeof input !== 'object' || Array.isArray(input)) { issues.push(`${name}_invalid`); return result; }
    const keys = Object.keys(input);
    if (keys.some((key) => !ID.test(key)) || keys.some((key, index) => index > 0 && keys[index - 1]!.localeCompare(key) >= 0)) issues.push(`${name}_invalid`);
    for (const key of keys) {
      const summary = (input as Record<string, unknown>)[key];
      if (!summary || typeof summary !== 'object' || Array.isArray(summary)) { issues.push(`${name}_invalid`); continue; }
      const summaryRecord = summary as Record<string, unknown>;
      const summaryKeys = Object.keys(summaryRecord).sort((a, b) => a.localeCompare(b));
      if (summaryKeys.length !== 2 || summaryKeys[0] !== 'role' || summaryKeys[1] !== 'sourceObjectSha256' || !ROLES.includes(summaryRecord.role as ConstructionQuantityRole) || typeof summaryRecord.sourceObjectSha256 !== 'string' || !SHA256.test(summaryRecord.sourceObjectSha256)) {
        issues.push(`${name}_invalid`);
        continue;
      }
      result[key] = { role: summaryRecord.role as ConstructionQuantityRole, sourceObjectSha256: summaryRecord.sourceObjectSha256 };
    }
    return result;
  };
  const beforeSummaries = validateHashMap(value.beforeObjectBindingHashes, 'change_impact_before_object_hashes');
  const afterSummaries = validateHashMap(value.afterObjectBindingHashes, 'change_impact_after_object_hashes');
  const changes: unknown[] = Array.isArray(value.changes) ? value.changes : [];
  const impacts: unknown[] = Array.isArray(value.impacts) ? value.impacts : [];
  if (!Array.isArray(value.changes) || !Array.isArray(value.impacts)) issues.push('change_impact_rows_invalid');
  const expectedImpacts: ConstructionImpactRow[] = [];
  const expectedObjectIds = [...new Set([...Object.keys(beforeSummaries), ...Object.keys(afterSummaries)])].sort((a, b) => a.localeCompare(b));
  const seenObjectIds = new Set<string>();
  for (let index = 0; index < changes.length; index += 1) {
    const item = changes[index];
    const row = item && typeof item === 'object' ? item as Partial<ConstructionObjectChange> : {};
    if (typeof row.objectId !== 'string' || !ID.test(row.objectId) || !ROLES.includes(row.role as ConstructionQuantityRole) || !['added', 'removed', 'changed', 'unchanged'].includes(row.kind as ConstructionChangeKind) || row.id !== `change:${row.kind}:${row.role}:${row.objectId}` || (index > 0 && typeof (changes[index - 1] as Partial<ConstructionObjectChange> | undefined)?.objectId === 'string' && (changes[index - 1] as Partial<ConstructionObjectChange>).objectId!.localeCompare(row.objectId) >= 0) || ![null, ...Object.values(beforeSummaries).map((summary) => summary.sourceObjectSha256)].includes(row.beforeSourceObjectSha256 ?? null) || ![null, ...Object.values(afterSummaries).map((summary) => summary.sourceObjectSha256)].includes(row.afterSourceObjectSha256 ?? null)) { issues.push('change_impact_change_row_invalid'); continue; }
    if (seenObjectIds.has(row.objectId)) issues.push(`change_impact_duplicate_object_id:${row.objectId}`);
    seenObjectIds.add(row.objectId);
    const before = beforeSummaries[row.objectId], after = afterSummaries[row.objectId];
    const expectedBefore = before?.sourceObjectSha256 ?? null, expectedAfter = after?.sourceObjectSha256 ?? null;
    const expectedKind: ConstructionChangeKind = !before ? 'added' : !after ? 'removed' : before.role !== after.role || before.sourceObjectSha256 !== after.sourceObjectSha256 ? 'changed' : 'unchanged';
    const expectedRole = after?.role ?? before?.role;
    if (!expectedRole || row.role !== expectedRole || row.kind !== expectedKind || row.id !== `change:${expectedKind}:${expectedRole}:${row.objectId}` || row.beforeSourceObjectSha256 !== expectedBefore || row.afterSourceObjectSha256 !== expectedAfter) issues.push(`change_impact_change_row_mismatch:${row.objectId}`);
    if (expectedKind !== 'unchanged' && expectedRole) expectedImpacts.push({ id: `impact:${expectedKind}:${expectedRole}:${row.objectId}`, objectId: row.objectId, role: expectedRole, changeKind: expectedKind, impact: expectedRole === 'schedule' ? 'schedule' : 'quantity' });
  }
  if (changes.length !== expectedObjectIds.length || seenObjectIds.size !== expectedObjectIds.length || changes.some((item, index) => !item || typeof item !== 'object' || (item as Partial<ConstructionObjectChange>).objectId !== expectedObjectIds[index])) issues.push('change_impact_object_coverage_mismatch');
  if (canonical(impacts) !== canonical(expectedImpacts)) issues.push('change_impact_impacts_mismatch');
  const expectedCounts = { added: expectedObjectIds.filter((objectId) => !beforeSummaries[objectId] && afterSummaries[objectId]).length, removed: expectedObjectIds.filter((objectId) => beforeSummaries[objectId] && !afterSummaries[objectId]).length, changed: expectedObjectIds.filter((objectId) => beforeSummaries[objectId] && afterSummaries[objectId] && (beforeSummaries[objectId]!.role !== afterSummaries[objectId]!.role || beforeSummaries[objectId]!.sourceObjectSha256 !== afterSummaries[objectId]!.sourceObjectSha256)).length, unchanged: expectedObjectIds.filter((objectId) => beforeSummaries[objectId] && afterSummaries[objectId] && beforeSummaries[objectId]!.role === afterSummaries[objectId]!.role && beforeSummaries[objectId]!.sourceObjectSha256 === afterSummaries[objectId]!.sourceObjectSha256).length, quantityImpacts: expectedImpacts.filter((item) => item.impact === 'quantity').length, scheduleImpacts: expectedImpacts.filter((item) => item.impact === 'schedule').length };
  if (canonical(value.counts) !== canonical(expectedCounts)) issues.push('change_impact_counts_mismatch');
  try {
    const { resultSha256, ...draft } = value;
    if (!SHA256.test(resultSha256) || hash(draft) !== resultSha256) issues.push('change_impact_result_hash_mismatch');
  } catch { issues.push('change_impact_result_hash_uncomputable'); }
  return issues;
}

export { canonical };
