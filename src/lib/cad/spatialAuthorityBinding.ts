import { createHash } from 'node:crypto';

export const SPATIAL_AUTHORITY_BINDING_SCHEMA = 'nexyfab.cad.spatial-authority-binding.v1' as const;
export const SPATIAL_DOMAINS = ['building', 'civil', 'landscape', 'interior'] as const;
export type SpatialDomain = (typeof SPATIAL_DOMAINS)[number];
export type SpatialAuthorityKind = 'BIM_HOST' | 'SURVEY_TIN' | 'CATALOG' | 'HYDRAULIC' | 'CODE' | 'CLIENT';
export type SpatialReviewStatus = 'APPROVED' | 'HOLD' | 'REJECTED' | 'STALE';
export type SpatialSourceClass = 'AUTHORITATIVE' | 'PREVIEW' | 'SYNTHETIC' | 'AI_INFERRED';

export interface SpatialCoordinateFrame {
  crsId: string;
  horizontalDatum: string;
  verticalDatum: string;
  epoch: number;
  units: { linear: 'm' | 'mm' | 'ft' | 'in'; angular: 'deg' | 'rad' };
  localOrigin: [number, number, number];
  localRotation: [number, number, number, number];
  transformProvenanceSha256: string;
}

export interface SpatialRightsReceipt {
  status: 'APPROVED' | 'HOLD' | 'REJECTED';
  receiptSha256?: string;
  allowedUse?: 'commercial' | 'internal' | 'review_only';
}

export interface SpatialAuthorityArtifact {
  id: string;
  kind: SpatialAuthorityKind;
  contentSha256: string;
  sourceRevision: { id: string; sha256: string };
  sourceClass: SpatialSourceClass;
  reviewStatus: SpatialReviewStatus;
  rights: SpatialRightsReceipt;
  capturedAt: string;
  reviewedAt?: string;
  surveyedHost?: boolean;
}

export interface SpatialUpstreamBinding {
  id: string;
  artifactId: string;
  revision: { id: string; sha256: string };
}

export interface SpatialAuthorityBinding {
  schemaVersion: typeof SPATIAL_AUTHORITY_BINDING_SCHEMA;
  domain: SpatialDomain;
  projectId: string;
  projectRevision: { id: string; sha256: string };
  coordinateFrame: SpatialCoordinateFrame;
  authorities: SpatialAuthorityArtifact[];
  upstreamBindings: SpatialUpstreamBinding[];
}

export interface SpatialAuthorityValidation {
  status: 'PASS' | 'HOLD' | 'STALE';
  issues: string[];
  canonicalSha256?: string;
}

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX = 64;
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: unknown) => isRecord(v) ? Object.keys(v) : [];
const exact = (v: unknown, allowed: readonly string[], path: string, issues: string[]) => keys(v).forEach(k => { if (!allowed.includes(k)) issues.push(`${path}.${k}:unknown_key`); });
const text = (v: unknown, path: string, issues: string[], max = 256) => { if (typeof v !== 'string' || v.length === 0 || v.length > max) issues.push(`${path}:invalid_string`); };
const sha = (v: unknown, path: string, issues: string[]) => { if (typeof v !== 'string' || !SHA.test(v)) issues.push(`${path}:invalid_sha256`); };
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const vector = (v: unknown, n: number, path: string, issues: string[]) => {
  if (!Array.isArray(v) || v.length !== n || !v.every(finite)) issues.push(`${path}:invalid_vector`);
};
const canonical = (v: unknown): string => {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
};

export function canonicalSpatialAuthorityBindingJson(binding: SpatialAuthorityBinding): string { return canonical(binding); }
export function hashSpatialAuthorityBinding(binding: SpatialAuthorityBinding): string {
  return createHash('sha256').update(canonicalSpatialAuthorityBindingJson(binding), 'utf8').digest('hex');
}

const requiredKinds: Record<SpatialDomain, SpatialAuthorityKind[]> = {
  civil: ['SURVEY_TIN', 'CLIENT'],
  building: ['BIM_HOST', 'SURVEY_TIN', 'CODE', 'CLIENT'],
  landscape: ['SURVEY_TIN', 'CATALOG', 'HYDRAULIC', 'CLIENT'],
  interior: ['BIM_HOST', 'CATALOG', 'CODE', 'CLIENT'],
};

export function validateSpatialAuthorityBinding(input: unknown): SpatialAuthorityValidation {
  const issues: string[] = [];
  if (!isRecord(input)) return { status: 'HOLD', issues: ['binding:not_an_object'] };
  exact(input, ['schemaVersion', 'domain', 'projectId', 'projectRevision', 'coordinateFrame', 'authorities', 'upstreamBindings'], 'binding', issues);
  const b = input as Partial<SpatialAuthorityBinding>;
  if (b.schemaVersion !== SPATIAL_AUTHORITY_BINDING_SCHEMA) issues.push('binding:unsupported_schema');
  if (!SPATIAL_DOMAINS.includes(b.domain as SpatialDomain)) issues.push('binding:invalid_domain');
  text(b.projectId, 'projectId', issues, 128);
  const revision = (v: unknown, path: string) => {
    if (!isRecord(v)) { issues.push(`${path}:required_object`); return; }
    exact(v, ['id', 'sha256'], path, issues); text(v.id, `${path}.id`, issues, 128); sha(v.sha256, `${path}.sha256`, issues);
  };
  revision(b.projectRevision, 'projectRevision');
  const f = b.coordinateFrame;
  if (!isRecord(f)) issues.push('coordinateFrame:required_object');
  else {
    exact(f, ['crsId', 'horizontalDatum', 'verticalDatum', 'epoch', 'units', 'localOrigin', 'localRotation', 'transformProvenanceSha256'], 'coordinateFrame', issues);
    text(f.crsId, 'coordinateFrame.crsId', issues, 128); text(f.horizontalDatum, 'coordinateFrame.horizontalDatum', issues, 128); text(f.verticalDatum, 'coordinateFrame.verticalDatum', issues, 128);
    if (!finite(f.epoch) || (f.epoch as number) < 1900 || (f.epoch as number) > 2200) issues.push('coordinateFrame.epoch:invalid');
    if (!isRecord(f.units)) issues.push('coordinateFrame.units:required_object');
    else { exact(f.units, ['linear', 'angular'], 'coordinateFrame.units', issues); if (!['m', 'mm', 'ft', 'in'].includes(f.units.linear as string)) issues.push('coordinateFrame.units.linear:invalid'); if (!['deg', 'rad'].includes(f.units.angular as string)) issues.push('coordinateFrame.units.angular:invalid'); }
    vector(f.localOrigin, 3, 'coordinateFrame.localOrigin', issues); vector(f.localRotation, 4, 'coordinateFrame.localRotation', issues); sha(f.transformProvenanceSha256, 'coordinateFrame.transformProvenanceSha256', issues);
    if (Array.isArray(f.localRotation) && f.localRotation.length === 4 && f.localRotation.every(finite)) {
      const norm = Math.hypot(...f.localRotation);
      if (Math.abs(norm - 1) > 1e-9) issues.push('coordinateFrame.localRotation:not_unit_quaternion');
    }
  }
  if (!Array.isArray(b.authorities) || b.authorities.length < 1 || b.authorities.length > MAX) issues.push('authorities:invalid_count');
  const authorities = Array.isArray(b.authorities) ? b.authorities : [];
  const ids = new Set<string>();
  for (const [i, raw] of authorities.entries()) {
    const p = `authorities[${i}]`;
    if (!isRecord(raw)) { issues.push(`${p}:not_an_object`); continue; }
    exact(raw, ['id', 'kind', 'contentSha256', 'sourceRevision', 'sourceClass', 'reviewStatus', 'rights', 'capturedAt', 'reviewedAt', 'surveyedHost'], p, issues);
    const a = raw as Partial<SpatialAuthorityArtifact>;
    if (typeof a.id !== 'string' || !ID.test(a.id)) issues.push(`${p}.id:unsafe_id`); else if (ids.has(a.id)) issues.push(`${p}.id:duplicate`); else ids.add(a.id);
    if (!['BIM_HOST', 'SURVEY_TIN', 'CATALOG', 'HYDRAULIC', 'CODE', 'CLIENT'].includes(a.kind as string)) issues.push(`${p}.kind:invalid`);
    sha(a.contentSha256, `${p}.contentSha256`, issues); revision(a.sourceRevision, `${p}.sourceRevision`);
    if (!['AUTHORITATIVE', 'PREVIEW', 'SYNTHETIC', 'AI_INFERRED'].includes(a.sourceClass as string)) issues.push(`${p}.sourceClass:invalid`);
    if (a.sourceClass !== 'AUTHORITATIVE') issues.push(`${p}.sourceClass:${String(a.sourceClass).toLowerCase()}_blocker`);
    if (!['APPROVED', 'HOLD', 'REJECTED', 'STALE'].includes(a.reviewStatus as string)) issues.push(`${p}.reviewStatus:invalid`);
    if (a.reviewStatus !== 'APPROVED') issues.push(`${p}.reviewStatus:${String(a.reviewStatus).toLowerCase()}_blocker`);
    if (typeof a.capturedAt !== 'string' || !ISO.test(a.capturedAt) || Number.isNaN(Date.parse(a.capturedAt))) issues.push(`${p}.capturedAt:invalid_timestamp`);
    if (a.reviewedAt !== undefined && (typeof a.reviewedAt !== 'string' || !ISO.test(a.reviewedAt) || Number.isNaN(Date.parse(a.reviewedAt)))) issues.push(`${p}.reviewedAt:invalid_timestamp`);
    if (a.reviewStatus === 'APPROVED' && a.reviewedAt === undefined) issues.push(`${p}.reviewedAt:required_for_approval`);
    if (typeof a.capturedAt === 'string' && typeof a.reviewedAt === 'string' && Date.parse(a.reviewedAt) < Date.parse(a.capturedAt)) issues.push(`${p}.reviewedAt:before_capture`);
    if (!isRecord(a.rights)) issues.push(`${p}.rights:required_object`);
    else { exact(a.rights, ['status', 'receiptSha256', 'allowedUse'], `${p}.rights`, issues); if (!['APPROVED', 'HOLD', 'REJECTED'].includes(a.rights.status as string)) issues.push(`${p}.rights.status:invalid`); if (a.rights.status !== 'APPROVED') issues.push(`${p}.rights.status:${String(a.rights.status).toLowerCase()}_blocker`); sha(a.rights.receiptSha256, `${p}.rights.receiptSha256`, issues); if (!['commercial', 'internal', 'review_only'].includes(a.rights.allowedUse as string)) issues.push(`${p}.rights.allowedUse:invalid`); else if (a.rights.allowedUse !== 'commercial') issues.push(`${p}.rights.allowedUse:not_commercial`); }
    if (a.kind === 'BIM_HOST' && a.surveyedHost !== true) issues.push(`${p}.surveyedHost:required_true`);
  }
  const seenKinds = new Set(authorities.map(a => isRecord(a) ? a.kind : undefined));
  const domain = b.domain as SpatialDomain;
  if (requiredKinds[domain]) for (const kind of requiredKinds[domain]) if (!seenKinds.has(kind)) issues.push(`required_authority_missing:${kind}`);
  if (domain === 'civil' && isRecord(b.coordinateFrame) && b.coordinateFrame.verticalDatum === 'UNCONFIRMED') issues.push('coordinateFrame.verticalDatum:unconfirmed_blocker');
  if (!Array.isArray(b.upstreamBindings) || b.upstreamBindings.length > MAX) issues.push('upstreamBindings:invalid_count');
  const upstream = Array.isArray(b.upstreamBindings) ? b.upstreamBindings : [];
  const upstreamIds = new Set<string>();
  for (const [i, raw] of upstream.entries()) {
    const p = `upstreamBindings[${i}]`;
    if (!isRecord(raw)) { issues.push(`${p}:not_an_object`); continue; }
    exact(raw, ['id', 'artifactId', 'revision'], p, issues); text(raw.id, `${p}.id`, issues, 128); text(raw.artifactId, `${p}.artifactId`, issues, 128); revision(raw.revision, `${p}.revision`);
    if (typeof raw.id === 'string' && upstreamIds.has(raw.id)) issues.push(`${p}.id:duplicate`); else if (typeof raw.id === 'string') upstreamIds.add(raw.id);
    const source = authorities.find(a => isRecord(a) && a.id === raw.artifactId) as Partial<SpatialAuthorityArtifact> | undefined;
    if (source && isRecord(source.sourceRevision) && isRecord(raw.revision) && (source.sourceRevision.id !== raw.revision.id || source.sourceRevision.sha256 !== raw.revision.sha256)) issues.push(`${p}.revision:mismatch`);
  }
  if (issues.some(issue => issue.includes('stale') || issue.includes('STALE') || issue.includes('mismatch'))) return { status: 'STALE', issues: [...new Set(issues)] };
  if (issues.length) return { status: 'HOLD', issues: [...new Set(issues)] };
  return { status: 'PASS', issues: [], canonicalSha256: hashSpatialAuthorityBinding(b as SpatialAuthorityBinding) };
}
