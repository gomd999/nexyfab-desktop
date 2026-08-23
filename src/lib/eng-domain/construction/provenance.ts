import { createHash } from 'node:crypto';
import type { Activity, ConcreteElement, FormworkElement, RebarGroup } from './checks';
import type { ConstructionPlan } from './module';

/** A source revision that a construction takeoff/schedule is allowed to consume. */
export interface ConstructionRevisionInput {
  /** Legacy aliases retained for existing callers. */
  revisionId?: string;
  revisionSha256?: string;
  /** Preferred BIM workspace source binding. */
  workspaceRevisionId?: string;
  workspaceContentHash?: string;
}

export type ConstructionQuantityRole = 'concrete' | 'rebar' | 'formwork' | 'schedule';

/** Per-object binding carried into the BOQ/schedule package. */
export interface ConstructionObjectBinding {
  objectId: string;
  /** Stable ID of the concrete/rebar/formwork/activity BIM source object. */
  bimObjectId: string;
  role: ConstructionQuantityRole;
  sourceRevisionId: string;
  sourceRevisionSha256: string;
  workspaceRevisionId: string;
  workspaceContentHash: string;
  sourceObjectSha256: string;
}

export interface ConstructionRevisionBinding extends ConstructionRevisionInput {
  revisionId: string;
  revisionSha256: string;
  workspaceRevisionId: string;
  workspaceContentHash: string;
  /** Explicitly distinguishes governed BIM IDs from legacy compatibility IDs. */
  bindingMode: 'workspace_explicit' | 'legacy_derived';
  /** Hash of the complete revision/object ownership binding. */
  bindingSha256: string;
  /** Hash of the geometry/schedule source payload (claims and prices excluded). */
  payloadSha256: string;
  objectBindings: ConstructionObjectBinding[];
}

/** Evidence for values that are not derivable from geometry (prices or site data). */
export interface ConstructionAuthorityEvidence {
  sourceId: string;
  sourceSha256: string;
  /** `fixture` is deterministic demo input and must never be presented as actual evidence. */
  authority: 'authoritative' | 'fixture';
}

const SHA256 = /^[a-f0-9]{64}$/;

function canonical(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('construction provenance: non-finite value');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('construction provenance: cyclic value');
    const next = new Set(ancestors).add(value);
    return `[${value.map((item) => canonical(item, next)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    if (ancestors.has(value)) throw new Error('construction provenance: cyclic value');
    const next = new Set(ancestors).add(value);
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key], next)}`).join(',')}}`;
  }
  throw new Error('construction provenance: unsupported value');
}

export function constructionSha256(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

type SourceObject = { objectId?: string };

function withObjectIds<T extends SourceObject>(items: readonly T[], prefix: string, allowLegacyDerivedIds: boolean): T[] {
  return items.map((item, index) => {
    if (typeof item.objectId !== 'string' || !item.objectId.trim()) {
      if (!allowLegacyDerivedIds) throw new Error(`construction provenance: missing BIM object id (${prefix})`);
      return { ...item, objectId: `${prefix}-${index + 1}` };
    }
    return { ...item, objectId: item.objectId.trim() };
  });
}

/**
 * The payload excludes mutable takeoff claims and evidence envelopes, but keeps
 * price rows/budget inputs themselves hash-bound. This lets the one-shot
 * concrete claim auto-fix remain valid without allowing a unit-rate edit to
 * bypass provenance.
 */
export function constructionSourcePayload(plan: ConstructionPlan): Record<string, unknown> {
  return {
    concreteElements: plan.concreteElements,
    rebarGroups: plan.rebarGroups,
    formworkElements: plan.formworkElements,
    activities: plan.activities,
    earthwork: plan.earthwork,
    costLineItems: plan.costLineItems,
    budget: plan.budget,
    contingencyFactor: plan.contingencyFactor,
  };
}

function sourceObjects(plan: ConstructionPlan): Array<{ objectId: string; role: ConstructionQuantityRole; value: unknown }> {
  return [
    ...plan.concreteElements.map((value) => ({ objectId: value.objectId as string, role: 'concrete' as const, value })),
    ...plan.rebarGroups.map((value) => ({ objectId: value.objectId as string, role: 'rebar' as const, value })),
    ...(plan.formworkElements ?? []).map((value) => ({ objectId: value.objectId as string, role: 'formwork' as const, value })),
    ...plan.activities.map((value) => ({ objectId: value.objectId as string, role: 'schedule' as const, value })),
  ];
}

/** Normalize IDs and create an immutable binding for a plan's source revision. */
export function bindConstructionPlan(plan: ConstructionPlan, source: ConstructionRevisionInput): ConstructionPlan {
  const hasWorkspaceRevision = source.workspaceRevisionId !== undefined;
  const hasWorkspaceHash = source.workspaceContentHash !== undefined;
  const hasLegacyRevision = source.revisionId !== undefined;
  const hasLegacyHash = source.revisionSha256 !== undefined;
  if (hasWorkspaceRevision !== hasWorkspaceHash || hasLegacyRevision !== hasLegacyHash) throw new Error('construction provenance: incomplete workspace revision binding');
  const revisionId = source.workspaceRevisionId?.trim() || source.revisionId?.trim() || '';
  const revisionSha256 = source.workspaceContentHash || source.revisionSha256 || '';
  if (!revisionId || !SHA256.test(revisionSha256) || (source.workspaceRevisionId !== undefined && source.revisionId !== undefined && source.workspaceRevisionId !== source.revisionId) || (source.workspaceContentHash !== undefined && source.revisionSha256 !== undefined && source.workspaceContentHash !== source.revisionSha256)) throw new Error('construction provenance: invalid workspace revision binding');
  const allowLegacyDerivedIds = source.workspaceRevisionId === undefined && source.workspaceContentHash === undefined;
  const bindingMode = allowLegacyDerivedIds ? 'legacy_derived' as const : 'workspace_explicit' as const;
  const normalized: ConstructionPlan = {
    ...plan,
    concreteElements: withObjectIds(plan.concreteElements, 'concrete', allowLegacyDerivedIds) as ConcreteElement[],
    rebarGroups: withObjectIds(plan.rebarGroups, 'rebar', allowLegacyDerivedIds) as RebarGroup[],
    ...(plan.formworkElements ? { formworkElements: withObjectIds(plan.formworkElements, 'formwork', allowLegacyDerivedIds) as FormworkElement[] } : {}),
    activities: withObjectIds(plan.activities, 'activity', allowLegacyDerivedIds) as Activity[],
  };
  const objects = sourceObjects(normalized);
  const ids = objects.map((item) => item.objectId);
  if (new Set(ids).size !== ids.length) throw new Error('construction provenance: duplicate object id');
  const payloadSha256 = constructionSha256(constructionSourcePayload(normalized));
  const objectBindings: ConstructionObjectBinding[] = objects.map((item) => ({
    objectId: item.objectId,
    bimObjectId: item.objectId,
    role: item.role,
    sourceRevisionId: revisionId,
    sourceRevisionSha256: revisionSha256,
    workspaceRevisionId: revisionId,
    workspaceContentHash: revisionSha256,
    sourceObjectSha256: constructionSha256(item.value),
  }));
  const bindingSha256 = constructionSha256({ revisionId, revisionSha256, workspaceRevisionId: revisionId, workspaceContentHash: revisionSha256, bindingMode, payloadSha256, objectBindings });
  return {
    ...normalized,
    revisionBinding: {
      revisionId,
      revisionSha256,
      workspaceRevisionId: revisionId,
      workspaceContentHash: revisionSha256,
      bindingMode,
      payloadSha256,
      bindingSha256,
      objectBindings,
    },
  };
}

function isEvidence(value: unknown): value is ConstructionAuthorityEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.sourceId === 'string' && item.sourceId.trim().length > 0
    && typeof item.sourceSha256 === 'string' && SHA256.test(item.sourceSha256)
    && (item.authority === 'authoritative' || item.authority === 'fixture');
}

/** Return all binding/evidence defects; an empty list is the only releasable state. */
export function validateConstructionProvenance(plan: ConstructionPlan): string[] {
  const issues: string[] = [];
  const binding = plan.revisionBinding;
  if (!binding) issues.push('construction_revision_binding_missing');
  else {
    if (typeof binding.revisionId !== 'string' || !binding.revisionId.trim()) issues.push('construction_revision_id_missing');
    if (!SHA256.test(binding.revisionSha256)) issues.push('construction_revision_hash_invalid');
    if (binding.workspaceRevisionId !== binding.revisionId) issues.push('construction_workspace_revision_mismatch');
    if (binding.workspaceContentHash !== binding.revisionSha256 || !SHA256.test(binding.workspaceContentHash)) issues.push('construction_workspace_content_hash_invalid');
    if (binding.bindingMode !== 'workspace_explicit' && binding.bindingMode !== 'legacy_derived') issues.push('construction_binding_mode_invalid');
    if (!SHA256.test(binding.payloadSha256)) issues.push('construction_payload_hash_invalid');
    try {
      if (binding.payloadSha256 !== constructionSha256(constructionSourcePayload(plan))) issues.push('construction_payload_hash_mismatch');
      if (!SHA256.test(binding.bindingSha256) || binding.bindingSha256 !== constructionSha256({ revisionId: binding.revisionId, revisionSha256: binding.revisionSha256, workspaceRevisionId: binding.workspaceRevisionId, workspaceContentHash: binding.workspaceContentHash, bindingMode: binding.bindingMode, payloadSha256: binding.payloadSha256, objectBindings: binding.objectBindings })) issues.push('construction_binding_hash_mismatch');
    } catch { issues.push('construction_payload_hash_uncomputable'); }
    const objects = sourceObjects(plan);
    const objectIds = objects.map((item) => item.objectId);
    if (objectIds.some((id) => typeof id !== 'string' || !id.trim())) issues.push('construction_object_id_invalid');
    if (new Set(objectIds).size !== objectIds.length) issues.push('construction_object_id_duplicate');
    const objectBindings: unknown[] = Array.isArray(binding.objectBindings) ? binding.objectBindings : [];
    if (objectBindings.length !== objects.length) issues.push('construction_object_binding_count_mismatch');
    const expected = new Map(objects.map((item) => [`${item.role}:${item.objectId}`, item]));
    const seen = new Set<string>();
    for (const item of objectBindings) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        issues.push('construction_object_binding_invalid');
        continue;
      }
      const candidate = item as ConstructionObjectBinding;
      if (typeof candidate.role !== 'string' || typeof candidate.objectId !== 'string' || typeof candidate.bimObjectId !== 'string' || candidate.bimObjectId !== candidate.objectId || typeof candidate.sourceRevisionId !== 'string' || typeof candidate.sourceRevisionSha256 !== 'string' || typeof candidate.workspaceRevisionId !== 'string' || typeof candidate.workspaceContentHash !== 'string' || typeof candidate.sourceObjectSha256 !== 'string') {
        issues.push('construction_object_binding_invalid');
        continue;
      }
      const key = `${candidate.role}:${candidate.objectId}`;
      if (seen.has(key)) issues.push(`construction_object_binding_duplicate:${key}`);
      seen.add(key);
      const sourceObject = expected.get(key);
      if (!sourceObject) { issues.push(`construction_object_binding_unknown:${key}`); continue; }
      if (candidate.sourceRevisionId !== binding.revisionId || candidate.sourceRevisionSha256 !== binding.revisionSha256 || candidate.workspaceRevisionId !== binding.workspaceRevisionId || candidate.workspaceContentHash !== binding.workspaceContentHash) issues.push(`construction_object_revision_mismatch:${key}`);
      if (!SHA256.test(candidate.sourceObjectSha256) || candidate.sourceObjectSha256 !== constructionSha256(sourceObject.value)) issues.push(`construction_object_hash_mismatch:${key}`);
    }
    for (const key of expected.keys()) if (!seen.has(key)) issues.push(`construction_object_binding_missing:${key}`);
  }
  if (plan.costLineItems && !isEvidence(plan.priceEvidence)) issues.push('construction_price_evidence_missing');
  if (plan.earthwork && !isEvidence(plan.siteEvidence)) issues.push('construction_site_evidence_missing');
  if (plan.priceEvidence?.authority === 'authoritative') issues.push('construction_price_authority_claim_not_allowed');
  if (plan.siteEvidence?.authority === 'authoritative') issues.push('construction_site_authority_claim_not_allowed');
  return [...new Set(issues)];
}

export function constructionEvidenceLabel(evidence: ConstructionAuthorityEvidence | undefined): string {
  if (!evidence) return 'not supplied';
  return `${evidence.authority}:${evidence.sourceId} (${evidence.sourceSha256.slice(0, 12)})`;
}
