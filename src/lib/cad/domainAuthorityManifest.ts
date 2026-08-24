import { createHash } from 'node:crypto';

export const DOMAIN_AUTHORITY_SCHEMA = 'nexyfab.cad.domain-authority-manifest.v1' as const;
export const AUTHORITY_DOMAINS = ['mechanical', 'building', 'civil', 'landscape', 'interior'] as const;
export type AuthorityDomain = (typeof AUTHORITY_DOMAINS)[number];
export type AuthorityKind = 'code' | 'survey' | 'catalog' | 'manufacturer' | 'standard' | 'client' | 'professional-review' | 'other';
export type AuthorityStatus = 'APPROVED' | 'HOLD' | 'REJECTED' | 'STALE';
export type RightsStatus = 'APPROVED' | 'HOLD' | 'REJECTED';

export interface RevisionBinding { id: string; sha256: string }
export interface AuthorityRights { status: RightsStatus; receiptSha256?: string; jurisdiction?: string; applicability?: string }
export interface DomainAuthorityEntry {
  id: string;
  kind: AuthorityKind;
  sourceRef: string;
  contentSha256: string;
  capturedAt: string;
  reviewedAt: string;
  status: AuthorityStatus;
  rights: AuthorityRights;
  jurisdiction?: string;
  applicability?: string;
}
export interface DomainAuthorityManifest {
  schemaVersion: typeof DOMAIN_AUTHORITY_SCHEMA;
  domain: AuthorityDomain;
  projectId: string;
  projectRevision: RevisionBinding;
  sourceRevision: RevisionBinding;
  authorities: DomainAuthorityEntry[];
}

export interface ManifestValidation { status: 'PASS' | 'HOLD'; issues: string[]; canonicalSha256?: string }

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX = 100;
const keys = (value: unknown): string[] => value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>) : [];
const exact = (value: unknown, allowed: readonly string[], path: string, issues: string[]) => {
  for (const key of keys(value)) if (!allowed.includes(key)) issues.push(`${path}.${key}:unknown_key`);
};
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, path: string, issues: string[], max = 256) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) issues.push(`${path}:invalid_string`);
};
const hash = (value: unknown, path: string, issues: string[]) => {
  if (typeof value !== 'string' || !SHA.test(value)) issues.push(`${path}:invalid_sha256`);
};
const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(k => object[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(object[k])}`).join(',')}}`;
};

export function canonicalAuthorityManifestJson(manifest: DomainAuthorityManifest): string { return canonical(manifest); }
export function hashDomainAuthorityManifest(manifest: DomainAuthorityManifest): string {
  return createHash('sha256').update(canonicalAuthorityManifestJson(manifest), 'utf8').digest('hex');
}

export function validateDomainAuthorityManifest(input: unknown): ManifestValidation {
  const issues: string[] = [];
  if (!record(input)) return { status: 'HOLD', issues: ['manifest:not_an_object'] };
  exact(input, ['schemaVersion', 'domain', 'projectId', 'projectRevision', 'sourceRevision', 'authorities'], 'manifest', issues);
  const m = input as Partial<DomainAuthorityManifest>;
  if (m.schemaVersion !== DOMAIN_AUTHORITY_SCHEMA) issues.push('manifest:unsupported_schema');
  if (!AUTHORITY_DOMAINS.includes(m.domain as AuthorityDomain)) issues.push('manifest:invalid_domain');
  text(m.projectId, 'projectId', issues, 128);
  for (const [name, binding] of [['projectRevision', m.projectRevision], ['sourceRevision', m.sourceRevision]] as const) {
    if (!record(binding)) { issues.push(`${name}:required_object`); continue; }
    exact(binding, ['id', 'sha256'], name, issues); text(binding.id, `${name}.id`, issues, 128); hash(binding.sha256, `${name}.sha256`, issues);
  }
  if (!Array.isArray(m.authorities) || m.authorities.length === 0 || m.authorities.length > MAX) issues.push('authorities:invalid_count');
  const authorities = Array.isArray(m.authorities) ? m.authorities : [];
  const ids = new Set<string>();
  authorities.forEach((entry, i) => {
    const path = `authorities[${i}]`;
    if (!record(entry)) { issues.push(`${path}:not_an_object`); return; }
    exact(entry, ['id', 'kind', 'sourceRef', 'contentSha256', 'capturedAt', 'reviewedAt', 'status', 'rights', 'jurisdiction', 'applicability'], path, issues);
    const e = entry as DomainAuthorityEntry;
    if (typeof e.id !== 'string' || !ID.test(e.id)) issues.push(`${path}.id:unsafe_id`); else if (ids.has(e.id)) issues.push(`${path}.id:duplicate`); else ids.add(e.id);
    if (!['code', 'survey', 'catalog', 'manufacturer', 'standard', 'client', 'professional-review', 'other'].includes(e.kind)) issues.push(`${path}.kind:invalid`);
    text(e.sourceRef, `${path}.sourceRef`, issues, 1024); hash(e.contentSha256, `${path}.contentSha256`, issues);
    for (const field of ['capturedAt', 'reviewedAt'] as const) { if (typeof e[field] !== 'string' || !ISO.test(e[field]) || Number.isNaN(Date.parse(e[field]))) issues.push(`${path}.${field}:invalid_timestamp`); }
    if (!['APPROVED', 'HOLD', 'REJECTED', 'STALE'].includes(e.status)) issues.push(`${path}.status:invalid`);
    if (e.status === 'STALE' || e.status === 'HOLD' || e.status === 'REJECTED') issues.push(`${path}.status:${e.status.toLowerCase()}_blocker`);
    if (e.jurisdiction !== undefined) text(e.jurisdiction, `${path}.jurisdiction`, issues, 256);
    if (e.applicability !== undefined) text(e.applicability, `${path}.applicability`, issues, 512);
    if (!record(e.rights)) { issues.push(`${path}.rights:required_object`); return; }
    exact(e.rights, ['status', 'receiptSha256', 'jurisdiction', 'applicability'], `${path}.rights`, issues);
    const rights = e.rights as AuthorityRights;
    if (!['APPROVED', 'HOLD', 'REJECTED'].includes(rights.status)) issues.push(`${path}.rights.status:invalid`);
    if (rights.status !== 'APPROVED') issues.push(`${path}.rights.status:${rights.status.toLowerCase()}_blocker`);
    if (rights.receiptSha256 !== undefined) hash(rights.receiptSha256, `${path}.rights.receiptSha256`, issues);
    if (rights.status === 'APPROVED' && !rights.receiptSha256) issues.push(`${path}.rights.receiptSha256:required_for_approval`);
    if (rights.jurisdiction !== undefined) text(rights.jurisdiction, `${path}.rights.jurisdiction`, issues, 256);
    if (rights.applicability !== undefined) text(rights.applicability, `${path}.rights.applicability`, issues, 512);
  });
  if (issues.length) return { status: 'HOLD', issues };
  return { status: 'PASS', issues: [], canonicalSha256: hashDomainAuthorityManifest(m as DomainAuthorityManifest) };
}
