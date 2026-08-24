import { createHash } from 'node:crypto';

export const INTERIOR_PRODUCT_CONTRACT_SCHEMA = 'nexyfab.interior.small-office-retail-fitout.v1' as const;
export type InteriorObjectKind = 'space' | 'wall' | 'opening' | 'ffe-envelope' | 'ceiling' | 'lighting' | 'mep-zone' | 'finish-layer' | 'millwork';
export type InteriorUnits = { length: 'mm'; area: 'm2'; volume: 'm3'; angle: 'deg' };
export type InteriorPoint = { x: number; y: number };
export type InteriorRevision = { id: string; sha256: string };
export type InteriorProvenance = {
  sourceId: string; sourceRef: string; contentSha256: string; rightsReceiptSha256: string;
  origin: 'ORIGINAL' | 'LICENSED' | 'CLIENT_PROVIDED' | 'PUBLIC_STANDARD_FACT';
  rightsStatus: 'APPROVED'; authorityStatus: 'APPROVED';
};
export type InteriorRequirementAuthority = { sourceRevision: InteriorRevision; contentSha256: string; rightsReceiptSha256: string; authorityStatus: 'APPROVED' };
export interface InteriorRequirements {
  program: InteriorRequirementAuthority & { spaces: Array<{ spaceId: string; occupants: number; areaTargetM2: number }> };
  egress: InteriorRequirementAuthority & { maxTravelDistanceM: number; minClearWidthMm: number };
  clearances: InteriorRequirementAuthority & { minWorkingClearanceMm: number; minCeilingClearanceMm: number; minMepZoneHeightMm: number };
}

export interface InteriorObject {
  id: string; kind: InteriorObjectKind; sourceRevision: InteriorRevision; contentSha256: string;
  provenance: InteriorProvenance; hostRefs: string[]; data: Record<string, unknown>;
}
export interface InteriorProductContract {
  schema: typeof INTERIOR_PRODUCT_CONTRACT_SCHEMA;
  identity: { id: string; revision: string; contentSha256: string };
  units: InteriorUnits;
  requirements: InteriorRequirements;
  coordinateFrameSha256: string;
  hostBinding: { hostArtifactId: string; hostRevision: InteriorRevision; hostContentSha256: string; surveyed: true; rightsReceiptSha256: string };
  objects: InteriorObject[];
  authoritative: true;
}

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REV = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const KINDS: readonly InteriorObjectKind[] = ['space', 'wall', 'opening', 'ffe-envelope', 'ceiling', 'lighting', 'mep-zone', 'finish-layer', 'millwork'];
const CONTRACT_KEYS = ['schema', 'identity', 'units', 'requirements', 'coordinateFrameSha256', 'hostBinding', 'objects', 'authoritative'];
const IDENTITY_KEYS = ['id', 'revision', 'contentSha256'];
const HOST_KEYS = ['hostArtifactId', 'hostRevision', 'hostContentSha256', 'surveyed', 'rightsReceiptSha256'];
const OBJECT_KEYS = ['id', 'kind', 'sourceRevision', 'contentSha256', 'provenance', 'hostRefs', 'data'];
const PROV_KEYS = ['sourceId', 'sourceRef', 'contentSha256', 'rightsReceiptSha256', 'origin', 'rightsStatus', 'authorityStatus'];
const REQUIREMENT_AUTHORITY_KEYS = ['sourceRevision', 'contentSha256', 'rightsReceiptSha256', 'authorityStatus'];
const REV_KEYS = ['id', 'sha256'];
const finite = (v: unknown, min = -1e9, max = 1e9): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, expected: readonly string[]): boolean => record(v) && Object.keys(v).sort().join('|') === [...expected].sort().join('|');
const text = (v: unknown, re: RegExp, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && re.test(v);
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : record(v) ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
const hash = (v: unknown): string => createHash('sha256').update(canonical(v), 'utf8').digest('hex');

export function canonicalInteriorProductContractJson(contract: InteriorProductContract, includeHash = true): string {
  return canonical(includeHash ? contract : { ...contract, identity: { ...contract.identity, contentSha256: undefined } });
}
export function hashInteriorProductContract(contract: InteriorProductContract): string {
  return createHash('sha256').update(canonicalInteriorProductContractJson(contract, false), 'utf8').digest('hex');
}

const add = (issues: string[], ok: boolean, message: string) => { if (!ok) issues.push(message); };
function revision(v: unknown, path: string, issues: string[]): v is InteriorRevision {
  add(issues, exact(v, REV_KEYS), `${path}:keys`); if (!record(v)) return false;
  add(issues, text(v.id, REV), `${path}.id`); add(issues, text(v.sha256, SHA), `${path}.sha256`); return true;
}
function provenance(v: unknown, path: string, issues: string[]): void {
  if (!exact(v, PROV_KEYS) || !record(v)) { issues.push(`${path}:keys`); return; }
  add(issues, text(v.sourceId, ID), `${path}.sourceId`); add(issues, text(v.sourceRef, /^(?!ai:|preview:|synthetic:|catalog-unverified:).+$/i, 1024), `${path}.sourceRef`);
  add(issues, text(v.contentSha256, SHA), `${path}.contentSha256`); add(issues, text(v.rightsReceiptSha256, SHA), `${path}.rightsReceiptSha256`);
  add(issues, ['ORIGINAL', 'LICENSED', 'CLIENT_PROVIDED', 'PUBLIC_STANDARD_FACT'].includes(v.origin as string), `${path}.origin`);
  add(issues, v.rightsStatus === 'APPROVED' && v.authorityStatus === 'APPROVED', `${path}:not_authoritative`);
}
function requirementAuthority(v: unknown, path: string, expectedRevision: InteriorRevision | undefined, extraKeys: readonly string[], issues: string[]): void {
  if (!exact(v, [...REQUIREMENT_AUTHORITY_KEYS, ...extraKeys]) || !record(v)) { issues.push(`${path}:keys`); return; }
  revision(v.sourceRevision, `${path}.sourceRevision`, issues);
  if (expectedRevision && record(v.sourceRevision)
    && (v.sourceRevision.id !== expectedRevision.id || v.sourceRevision.sha256 !== expectedRevision.sha256)) {
    issues.push(`${path}.sourceRevision:mismatch`);
  }
  add(issues, text(v.contentSha256, SHA), `${path}.contentSha256`); add(issues, text(v.rightsReceiptSha256, SHA), `${path}.rightsReceiptSha256`); add(issues, v.authorityStatus === 'APPROVED', `${path}:not_authoritative`);
}
function point(v: unknown, path: string, issues: string[]): v is InteriorPoint {
  if (!exact(v, ['x', 'y']) || !record(v)) { issues.push(`${path}:point`); return false; }
  add(issues, finite(v.x, -1e7, 1e7), `${path}.x`); add(issues, finite(v.y, -1e7, 1e7), `${path}.y`); return true;
}
function polygon(v: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(v) || v.length < 4 || v.length > 1000) { issues.push(`${path}:polygon_count`); return; }
  v.forEach((p, i) => point(p, `${path}[${i}]`, issues));
  const first = v[0] as Record<string, unknown>; const last = v[v.length - 1] as Record<string, unknown>;
  if (!record(first) || !record(last) || first.x !== last.x || first.y !== last.y) issues.push(`${path}:not_closed`);
  let area = 0; for (let i = 0; i < v.length - 1; i++) { const a = v[i] as InteriorPoint; const b = v[i + 1] as InteriorPoint; area += a.x * b.y - b.x * a.y; }
  if (!Number.isFinite(area) || Math.abs(area) < 1e-6) issues.push(`${path}:zero_area`);
}
function dataShape(kind: InteriorObjectKind, data: Record<string, unknown>, path: string, issues: string[]): void {
  const shape: Record<InteriorObjectKind, readonly string[]> = {
    space: ['name', 'polygon'], wall: ['start', 'end', 'thickness'], opening: ['hostWallId', 'width', 'sill', 'head', 'center', 'swing'],
    'ffe-envelope': ['spaceId', 'x', 'y', 'width', 'depth', 'height', 'quantity'], ceiling: ['spaceId', 'elevation', 'type'],
    lighting: ['ceilingId', 'kind', 'quantity', 'photometricStatus'], 'mep-zone': ['spaceId', 'ceilingId', 'zoneKind', 'verificationStatus'],
    'finish-layer': ['spaceId', 'floor', 'wall', 'ceiling'], millwork: ['spaceId', 'kind', 'x', 'y', 'width', 'depth', 'height', 'catalogStatus'],
  };
  add(issues, exact(data, shape[kind]), `${path}:keys`);
  if (kind === 'space') { text(data.name, /./, 128) || issues.push(`${path}.name`); polygon(data.polygon, `${path}.polygon`, issues); }
  if (kind === 'wall') { point(data.start, `${path}.start`, issues); point(data.end, `${path}.end`, issues); add(issues, finite(data.thickness, 0.1, 2000), `${path}.thickness`); }
  if (kind === 'opening') { text(data.hostWallId, ID) || issues.push(`${path}.hostWallId`); add(issues, finite(data.width, 1, 1e5), `${path}.width`); add(issues, finite(data.sill, 0, 1e5), `${path}.sill`); add(issues, finite(data.head, 1, 1e5), `${path}.head`); point(data.center, `${path}.center`, issues); add(issues, ['inward-left', 'inward-right', 'outward-left', 'outward-right', 'none'].includes(data.swing as string), `${path}.swing`); }
  if (kind === 'ffe-envelope' || kind === 'millwork') { if (kind === 'ffe-envelope') text(data.spaceId, ID) || issues.push(`${path}.spaceId`); else { text(data.spaceId, ID) || issues.push(`${path}.spaceId`); add(issues, data.catalogStatus === 'APPROVED', `${path}.catalogStatus`); } for (const k of ['x', 'y', 'width', 'depth', 'height']) add(issues, finite(data[k], 0, 1e7), `${path}.${k}`); if (kind === 'ffe-envelope') add(issues, finite(data.quantity, 1, 1e6), `${path}.quantity`); }
  if (kind === 'ceiling') { text(data.spaceId, ID) || issues.push(`${path}.spaceId`); add(issues, finite(data.elevation, 1, 1e6), `${path}.elevation`); text(data.type, /./, 128) || issues.push(`${path}.type`); }
  if (kind === 'lighting') { text(data.ceilingId, ID) || issues.push(`${path}.ceilingId`); add(issues, finite(data.quantity, 1, 1e6), `${path}.quantity`); add(issues, data.photometricStatus === 'VERIFIED', `${path}.photometricStatus:not_verified`); }
  if (kind === 'mep-zone') { text(data.spaceId, ID) || issues.push(`${path}.spaceId`); text(data.ceilingId, ID) || issues.push(`${path}.ceilingId`); add(issues, data.verificationStatus === 'VERIFIED', `${path}.verificationStatus:not_verified`); }
  if (kind === 'finish-layer') { text(data.spaceId, ID) || issues.push(`${path}.spaceId`); for (const k of ['floor', 'wall', 'ceiling']) text(data[k], /^(?!catalog-unverified:).+$/i, 256) || issues.push(`${path}.${k}`); }
}

export function validateInteriorProductContract(input: unknown): string[] {
  const issues: string[] = []; if (!exact(input, CONTRACT_KEYS) || !record(input)) return ['contract:keys'];
  if (input.schema !== INTERIOR_PRODUCT_CONTRACT_SCHEMA || input.authoritative !== true) issues.push('contract:not_authoritative');
  if (!exact(input.identity, IDENTITY_KEYS) || !record(input.identity)) issues.push('identity:keys');
  const revisionId = record(input.identity) ? input.identity.revision : undefined;
  const expectedRevision = record(input.hostBinding) && record(input.hostBinding.hostRevision)
    ? input.hostBinding.hostRevision as unknown as InteriorRevision
    : undefined;
  if (record(input.identity)) { add(issues, text(input.identity.id, ID), 'identity.id'); add(issues, text(input.identity.revision, REV), 'identity.revision'); add(issues, text(input.identity.contentSha256, SHA), 'identity.contentSha256'); if (text(input.identity.contentSha256, SHA) && input.identity.contentSha256 !== hashInteriorProductContract(input as unknown as InteriorProductContract)) issues.push('identity.contentSha256:mismatch'); }
  add(issues, exact(input.units, ['length', 'area', 'volume', 'angle']) && record(input.units) && input.units.length === 'mm' && input.units.area === 'm2' && input.units.volume === 'm3' && input.units.angle === 'deg', 'units:invalid');
  if (!record(input.requirements) || !exact(input.requirements, ['program', 'egress', 'clearances'])) issues.push('requirements:keys'); else {
    const req = input.requirements;
    requirementAuthority(req.program, 'requirements.program', expectedRevision, ['spaces'], issues);
    requirementAuthority(req.egress, 'requirements.egress', expectedRevision, ['maxTravelDistanceM', 'minClearWidthMm'], issues);
    requirementAuthority(req.clearances, 'requirements.clearances', expectedRevision, ['minWorkingClearanceMm', 'minCeilingClearanceMm', 'minMepZoneHeightMm'], issues);
    if (!record(req.program) || !Array.isArray(req.program.spaces) || req.program.spaces.length === 0) issues.push('requirements.program.spaces:invalid'); else req.program.spaces.forEach((s, i) => { if (!exact(s, ['spaceId', 'occupants', 'areaTargetM2']) || !record(s)) issues.push(`requirements.program.spaces[${i}]:keys`); else { add(issues, text(s.spaceId, ID), `requirements.program.spaces[${i}].spaceId`); add(issues, finite(s.occupants, 0, 1e6), `requirements.program.spaces[${i}].occupants`); add(issues, finite(s.areaTargetM2, 0.01, 1e9), `requirements.program.spaces[${i}].areaTargetM2`); } });
    if (record(req.egress)) { add(issues, finite(req.egress.maxTravelDistanceM, 0.01, 1e6), 'requirements.egress.maxTravelDistanceM'); add(issues, finite(req.egress.minClearWidthMm, 1, 1e6), 'requirements.egress.minClearWidthMm'); }
    if (record(req.clearances)) for (const key of ['minWorkingClearanceMm', 'minCeilingClearanceMm', 'minMepZoneHeightMm']) add(issues, finite(req.clearances[key], 0.01, 1e6), `requirements.clearances.${key}`);
  }
  add(issues, text(input.coordinateFrameSha256, SHA), 'coordinateFrameSha256');
  if (!exact(input.hostBinding, HOST_KEYS) || !record(input.hostBinding)) issues.push('hostBinding:keys'); else { const h = input.hostBinding; add(issues, text(h.hostArtifactId, ID), 'hostBinding.hostArtifactId'); revision(h.hostRevision, 'hostBinding.hostRevision', issues); add(issues, text(h.hostContentSha256, SHA), 'hostBinding.hostContentSha256'); add(issues, h.surveyed === true, 'hostBinding:surveyed_required'); add(issues, text(h.rightsReceiptSha256, SHA), 'hostBinding.rightsReceiptSha256'); if (record(h.hostRevision) && revisionId && h.hostRevision.id !== revisionId) issues.push('hostBinding:source_revision_mismatch'); }
  if (!Array.isArray(input.objects) || input.objects.length < KINDS.length || input.objects.length > 10000) issues.push('objects:count');
  const objects = Array.isArray(input.objects) ? input.objects : []; const ids = new Set<string>(); const byKind = new Map<InteriorObjectKind, InteriorObject>();
  for (const [i, raw] of objects.entries()) { const path = `objects[${i}]`; if (!exact(raw, OBJECT_KEYS) || !record(raw)) { issues.push(`${path}:keys`); continue; } const o = raw as unknown as InteriorObject; add(issues, text(o.id, ID) && !ids.has(o.id), `${path}.id`); ids.add(o.id); add(issues, KINDS.includes(o.kind), `${path}.kind`); revision(o.sourceRevision, `${path}.sourceRevision`, issues); if (expectedRevision && (o.sourceRevision?.id !== expectedRevision.id || o.sourceRevision?.sha256 !== expectedRevision.sha256)) issues.push(`${path}.sourceRevision:mismatch`); add(issues, text(o.contentSha256, SHA), `${path}.contentSha256`); provenance(o.provenance, `${path}.provenance`, issues); add(issues, Array.isArray(o.hostRefs) && o.hostRefs.length > 0 && o.hostRefs.every(ref => text(ref, ID)), `${path}.hostRefs`); if (KINDS.includes(o.kind)) dataShape(o.kind, o.data, `${path}.data`, issues); if (KINDS.includes(o.kind) && !byKind.has(o.kind)) byKind.set(o.kind, o); }
  for (const kind of KINDS) if (!byKind.has(kind)) issues.push(`required_kind_missing:${kind}`);
  const hostId = record(input.hostBinding) ? input.hostBinding.hostArtifactId : undefined; for (const o of objects) if (record(o) && Array.isArray(o.hostRefs) && hostId && !o.hostRefs.includes(hostId)) issues.push(`objects:${String(o.id)}:host_binding_dangling`);
  if (record(input.requirements) && record(input.requirements.program) && Array.isArray(input.requirements.program.spaces)) for (const [i, s] of input.requirements.program.spaces.entries()) if (record(s) && typeof s.spaceId === 'string' && !ids.has(s.spaceId)) issues.push(`requirements.program.spaces[${i}].spaceId:dangling`);
  for (const o of objects) if (record(o) && record(o.data)) { for (const key of ['spaceId', 'hostWallId', 'ceilingId']) { const ref = o.data[key]; if (typeof ref === 'string' && !ids.has(ref)) issues.push(`objects:${String(o.id)}:${key}:dangling`); } }
  return [...new Set(issues)];
}

export function createInteriorProductContract(input: Omit<InteriorProductContract, 'identity'> & { identity: Omit<InteriorProductContract['identity'], 'contentSha256'> }): InteriorProductContract {
  const draft = { ...input, identity: { ...input.identity, contentSha256: '0'.repeat(64) } } as InteriorProductContract;
  const contract = { ...draft, identity: { ...draft.identity, contentSha256: hashInteriorProductContract(draft) } };
  const issues = validateInteriorProductContract(contract); if (issues.length) throw new Error(`invalid_interior_product_contract:${issues.join(',')}`); return contract;
}
