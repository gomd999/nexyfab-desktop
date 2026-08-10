import { DESIGN_DOMAIN_IDS, type DesignDomainId } from './domainProfile';
import type { UnifiedDesignProject } from './unifiedDesignProject';

export const DOMAIN_DESIGN_HANDOFF_KEY = 'nexyfab:domain-design-handoff:v1';

export interface DomainDesignIntentMatch {
  matched: number;
  mismatched: number;
  unverifiable: number;
  results: Array<{ verdict: string; note: string; text: string }>;
  assumptions?: string[];
  repair?: { attempted: boolean; adopted: boolean; before: number; after: number };
}

export interface DomainDesignValidationEvidence {
  designOk: true;
  gateErrors: [];
  interferenceCount: 0;
  floatingCount: 0;
  degraded: false;
  droppedPartCount: 0;
  canonicalIssues: [];
  intentMatch: DomainDesignIntentMatch | null;
}

export interface DomainDesignHandoff {
  schema: 'nexyfab.domain-design-handoff.v1' | 'nexyfab.domain-design-handoff.v2';
  createdAt: number;
  domain: DesignDomainId;
  assembly: Record<string, unknown>;
  openscad: string;
  parts: Array<{ id: string; aabb: { min: number[]; max: number[] } }>;
  unifiedProject: UnifiedDesignProject;
  /** Required on v2: proves AI and manual/expert CAD use one project revision. */
  workspaceRevision?: {
    projectId: string;
    lineageId: string;
    revision: number;
    contentRevision: string;
    workMode: 'ai_assisted' | 'manual' | 'precision_cad';
    protectedLockIds: string[];
  };
  validation: DomainDesignValidationEvidence;
}

export function isDomainDesignHandoff(value: unknown, now = Date.now()): value is DomainDesignHandoff {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DomainDesignHandoff>;
  const parts = (item.assembly as { parts?: unknown[] } | undefined)?.parts;
  const validation = item.validation as Partial<DomainDesignValidationEvidence> | undefined;
  const schemaValid = item.schema === 'nexyfab.domain-design-handoff.v1' || item.schema === 'nexyfab.domain-design-handoff.v2';
  const revision = item.workspaceRevision;
  const v2RevisionValid = item.schema !== 'nexyfab.domain-design-handoff.v2' || (
    !!revision
    && typeof revision.projectId === 'string' && revision.projectId === item.unifiedProject?.id
    && typeof revision.lineageId === 'string' && revision.lineageId.trim().length > 0
    && Number.isSafeInteger(revision.revision) && revision.revision === item.unifiedProject?.revision
    && typeof revision.contentRevision === 'string' && revision.contentRevision.trim().length > 0
    && ['ai_assisted', 'manual', 'precision_cad'].includes(revision.workMode)
    && Array.isArray(revision.protectedLockIds)
    && revision.protectedLockIds.every(id => typeof id === 'string' && id.trim().length > 0)
    && new Set(revision.protectedLockIds).size === revision.protectedLockIds.length
  );
  return schemaValid && v2RevisionValid
    && typeof item.createdAt === 'number'
    && now - item.createdAt >= 0
    && now - item.createdAt <= 30 * 60 * 1000
    && DESIGN_DOMAIN_IDS.includes(item.domain as DesignDomainId)
    && !!item.assembly && typeof item.assembly === 'object' && Array.isArray(parts) && parts.length > 0
    && typeof item.openscad === 'string' && item.openscad.length > 0
    && Array.isArray(item.parts)
    && item.unifiedProject?.schema === 'nexyfab.unified-design-project.v1'
    && validation?.designOk === true
    && Array.isArray(validation.gateErrors) && validation.gateErrors.length === 0
    && validation.interferenceCount === 0
    && validation.floatingCount === 0
    && validation.degraded === false
    && validation.droppedPartCount === 0
    && Array.isArray(validation.canonicalIssues) && validation.canonicalIssues.length === 0
    && (validation.intentMatch === null
      || (typeof validation.intentMatch === 'object'
        && Number(validation.intentMatch.mismatched) === 0
        && Array.isArray(validation.intentMatch.results)));
}

export function saveDomainDesignHandoff(
  storage: Storage,
  handoff: Omit<DomainDesignHandoff, 'schema' | 'createdAt' | 'workspaceRevision'> & { workspaceRevision: NonNullable<DomainDesignHandoff['workspaceRevision']> },
): void {
  const payload: DomainDesignHandoff = {
    schema: 'nexyfab.domain-design-handoff.v2',
    createdAt: Date.now(),
    ...handoff,
  };
  storage.setItem(DOMAIN_DESIGN_HANDOFF_KEY, JSON.stringify(payload));
}

export function takeDomainDesignHandoff(storage: Storage, expectedDomain?: DesignDomainId): DomainDesignHandoff | null {
  let parsed: unknown = null;
  try { parsed = JSON.parse(storage.getItem(DOMAIN_DESIGN_HANDOFF_KEY) ?? 'null'); } catch { /* invalid */ }
  if (!isDomainDesignHandoff(parsed) || (expectedDomain && parsed.domain !== expectedDomain)) return null;
  storage.removeItem(DOMAIN_DESIGN_HANDOFF_KEY);
  return parsed;
}
