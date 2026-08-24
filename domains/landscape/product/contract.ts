import { createHash } from 'node:crypto';

/**
 * Landscape is a clean-room data contract.  It contains project geometry and
 * declared inputs, never copied planting catalogues, code prose, or vendor
 * schedules.  An authority receipt is required before any external input can
 * become a commercial design input.
 */
export const LANDSCAPE_PRODUCT_CONTRACT_SCHEMA = 'nexyfab.landscape.small-plaza-courtyard.v1' as const;

export type LandscapeRevision = { id: string; sha256: string };
export type LandscapePoint = { x: number; y: number };
export type LandscapePoint3 = { x: number; y: number; z: number };
export type LandscapeProvenance = {
  sourceId: string; sourceRef: string; contentSha256: string; rightsReceiptSha256: string;
  origin: 'ORIGINAL' | 'LICENSED' | 'CLIENT_PROVIDED' | 'PUBLIC_STANDARD_FACT';
  rightsStatus: 'APPROVED'; authorityStatus: 'APPROVED';
};
export type LandscapeBase = { id: string; revision: LandscapeRevision; contentSha256: string; provenance: LandscapeProvenance };
export type LandscapeAuthorityInput = LandscapeBase & {
  subject: 'CLIENT' | 'CODE' | 'HYDRAULIC' | 'CATALOG' | 'MAINTENANCE';
  values: Record<string, string | number | boolean>;
};

export interface LandscapeCoordinateBinding extends LandscapeBase {
  kind: 'APPROVED_CARTESIAN'; crs: string; horizontalDatum: string; verticalDatum: string;
  epoch: string; origin: LandscapePoint3; rotationDeg: number; reviewStatus: 'APPROVED';
}
export interface LandscapeTerrainBinding extends LandscapeBase {
  civilSurfaceId: string; civilSurfaceRevision: LandscapeRevision; civilSurfaceSha256: string;
  drainageOutletId: string; drainageOutletSha256: string; approvedUse: true;
}
export interface LandscapeAuthority {
  coordinateFrame: LandscapeCoordinateBinding; terrainBinding: LandscapeTerrainBinding;
  client: LandscapeAuthorityInput; code: LandscapeAuthorityInput;
  hydraulic: LandscapeAuthorityInput; catalog: LandscapeAuthorityInput; maintenance: LandscapeAuthorityInput;
}
export interface LandscapeSiteBoundary extends LandscapeBase { polygon: LandscapePoint[] }
export interface LandscapeSpotGrade extends LandscapeBase { point: LandscapePoint3 }
export interface LandscapeBreakline extends LandscapeBase { kind: 'EDGE' | 'RIDGE' | 'VALLEY' | 'WALL'; pointRefs: string[] }
export interface LandscapeDrainagePath extends LandscapeBase { pointRefs: string[]; outletRef: string; flowDirection: 'DOWNHILL' | 'CONTROLLED'; }
export interface LandscapeOutlet extends LandscapeBase { civilOutletRef: string; elevationM: number; approvalStatus: 'APPROVED' }
export interface LandscapeGrading { spotGrades: LandscapeSpotGrade[]; breaklines: LandscapeBreakline[]; drainagePaths: LandscapeDrainagePath[]; outlets: LandscapeOutlet[] }
export interface LandscapeHardscape extends LandscapeBase { kind: 'PAVING' | 'PATH' | 'SEAT_WALL' | 'PLAY_SURFACE'; boundary: LandscapePoint[]; thicknessM: number; maxSlopePercent: number; accessibilityCriterionRef: string }
export interface LandscapeSoilZone extends LandscapeBase { boundary: LandscapePoint[]; depthM: number; volumeM3: number; soilTypeRef: string }
export interface LandscapePlantingZone extends LandscapeBase { soilZoneRef: string; boundary: LandscapePoint[]; irrigationZoneRef: string }
export interface LandscapePlant extends LandscapeBase {
  plantingZoneRef: string; speciesId: string; supplierId: string; supplierProvenance: LandscapeProvenance;
  point: LandscapePoint; matureCanopyDiameterM: number; matureRootDiameterM: number;
}
export interface LandscapeWaterSource extends LandscapeBase { pressureKPa: number; maxFlowLpm: number; authorityInputRef: string }
export interface LandscapeIrrigationValve extends LandscapeBase { sourceRef: string; zoneRef: string; ratedFlowLpm: number; catalogAuthorityRef: string }
export interface LandscapeIrrigationZone extends LandscapeBase { plantingZoneRefs: string[]; valveRef: string; designFlowLpm: number; waterBudgetM3PerYear: number }
export interface LandscapeIrrigationPipe extends LandscapeBase { fromRef: string; toRef: string; diameterMm: number; lengthM: number; designFlowLpm: number }
export interface LandscapeEmitter extends LandscapeBase { valveRef: string; plantRefs: string[]; flowLpm: number; spacingM: number }
export interface LandscapeWaterBudget extends LandscapeBase { annualDemandM3: number; sourceCapacityLpm: number; climateInputRef: string; approvalStatus: 'APPROVED' }
export interface LandscapeIrrigation { source: LandscapeWaterSource; valves: LandscapeIrrigationValve[]; zones: LandscapeIrrigationZone[]; pipes: LandscapeIrrigationPipe[]; emitters: LandscapeEmitter[]; waterBudget: LandscapeWaterBudget }
export interface LandscapeMaintenanceZone extends LandscapeBase { objectRefs: string[]; accessWidthM: number; taskAuthorityRef: string }
export interface LandscapeMaintenanceTask extends LandscapeBase { zoneRef: string; taskCode: string; intervalDays: number; methodRef: string }
export interface LandscapeMaintenance { zones: LandscapeMaintenanceZone[]; tasks: LandscapeMaintenanceTask[] }

export interface LandscapeProductContract {
  schema: typeof LANDSCAPE_PRODUCT_CONTRACT_SCHEMA;
  identity: { projectId: string; revision: LandscapeRevision; contentSha256: string };
  units: { length: 'm'; area: 'm2'; volume: 'm3'; flow: 'lpm'; pressure: 'kPa'; slope: '%' };
  authority: LandscapeAuthority; siteBoundary: LandscapeSiteBoundary; grading: LandscapeGrading;
  hardscape: LandscapeHardscape[]; soilZones: LandscapeSoilZone[]; plantingZones: LandscapePlantingZone[]; plants: LandscapePlant[];
  irrigation: LandscapeIrrigation; maintenance: LandscapeMaintenance; authoritative: true;
}

const SHA = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REV_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const MAX = 10000;
const BASE_KEYS = ['id', 'revision', 'contentSha256', 'provenance'] as const;
const REV_KEYS = ['id', 'sha256'] as const;
const PROV_KEYS = ['sourceId', 'sourceRef', 'contentSha256', 'rightsReceiptSha256', 'origin', 'rightsStatus', 'authorityStatus'] as const;
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: unknown, keys: readonly string[]) => record(v) && Object.keys(v).sort().join('|') === [...keys].sort().join('|');
const text = (v: unknown, re: RegExp = /./, max = 256): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && re.test(v);
const finite = (v: unknown, min = -1e9, max = 1e9): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : record(v) ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}` : JSON.stringify(v) ?? 'null';
const sameRevision = (a: unknown, b: LandscapeRevision | undefined): boolean => record(a) && !!b && a.id === b.id && a.sha256 === b.sha256;
const samePoint = (a: LandscapePoint, b: LandscapePoint) => a.x === b.x && a.y === b.y;

export function canonicalLandscapeProductContractJson(contract: LandscapeProductContract, includeHash = true): string {
  return canonical(includeHash ? contract : { ...contract, identity: { ...contract.identity, contentSha256: undefined } });
}
export function hashLandscapeProductContract(contract: LandscapeProductContract): string {
  return createHash('sha256').update(canonicalLandscapeProductContractJson(contract, false), 'utf8').digest('hex');
}
/** Hash an object after removing its own content hash. Useful to stamp authored objects. */
export function hashLandscapeObject(value: Record<string, unknown>): string {
  return createHash('sha256').update(canonical({ ...value, contentSha256: undefined }), 'utf8').digest('hex');
}

function add(issues: string[], ok: boolean, path: string): void { if (!ok) issues.push(path); }
function revision(value: unknown, path: string, issues: string[]): value is LandscapeRevision {
  if (!exact(value, REV_KEYS) || !record(value)) { issues.push(`${path}:keys`); return false; }
  add(issues, text(value.id, REV_ID), `${path}.id`); add(issues, text(value.sha256, SHA), `${path}.sha256`); return true;
}
function provenance(value: unknown, path: string, issues: string[]): value is LandscapeProvenance {
  if (!exact(value, PROV_KEYS) || !record(value)) { issues.push(`${path}:keys`); return false; }
  add(issues, text(value.sourceId, ID), `${path}.sourceId`);
  add(issues, text(value.sourceRef, /^(?!ai:|preview:|synthetic:|inferred:|catalog-unverified:|HOLD:).+$/i, 1024), `${path}.sourceRef`);
  add(issues, text(value.contentSha256, SHA), `${path}.contentSha256`); add(issues, text(value.rightsReceiptSha256, SHA), `${path}.rightsReceiptSha256`);
  add(issues, ['ORIGINAL', 'LICENSED', 'CLIENT_PROVIDED', 'PUBLIC_STANDARD_FACT'].includes(value.origin as string), `${path}.origin`);
  add(issues, value.rightsStatus === 'APPROVED' && value.authorityStatus === 'APPROVED', `${path}:not_authoritative`); return true;
}
function point(value: unknown, path: string, issues: string[], z = false): value is LandscapePoint | LandscapePoint3 {
  const keys = z ? ['x', 'y', 'z'] : ['x', 'y'];
  if (!exact(value, keys) || !record(value)) { issues.push(`${path}:keys`); return false; }
  add(issues, finite(value.x, -1e8, 1e8), `${path}.x`); add(issues, finite(value.y, -1e8, 1e8), `${path}.y`); if (z) add(issues, finite(value.z, -1e5, 1e5), `${path}.z`); return true;
}
function polygon(value: unknown, path: string, issues: string[]): void {
  if (!Array.isArray(value) || value.length < 4 || value.length > 2000) { issues.push(`${path}:count`); return; }
  value.forEach((v, i) => point(v, `${path}[${i}]`, issues));
  const first = value[0] as LandscapePoint; const last = value[value.length - 1] as LandscapePoint;
  add(issues, samePoint(first, last), `${path}:not_closed`);
  let area = 0;
  for (let i = 0; i < value.length - 1; i++) {
    const a = value[i] as LandscapePoint; const b = value[i + 1] as LandscapePoint;
    add(issues, !samePoint(a, b), `${path}:duplicate_adjacent_point`); area += a.x * b.y - b.x * a.y;
  }
  add(issues, Number.isFinite(area) && Math.abs(area) > 1e-6, `${path}:zero_area`);
  const orient = (a: LandscapePoint, b: LandscapePoint, c: LandscapePoint) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a: LandscapePoint, b: LandscapePoint, c: LandscapePoint) => Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) && Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y);
  const cross = (a: LandscapePoint, b: LandscapePoint, c: LandscapePoint, d: LandscapePoint) => { const o1 = orient(a, b, c); const o2 = orient(a, b, d); const o3 = orient(c, d, a); const o4 = orient(c, d, b); return (o1 * o2 < 0 && o3 * o4 < 0) || (o1 === 0 && on(a, b, c)) || (o2 === 0 && on(a, b, d)) || (o3 === 0 && on(c, d, a)) || (o4 === 0 && on(c, d, b)); };
  for (let i = 0; i < value.length - 1; i++) for (let j = i + 1; j < value.length - 1; j++) if (j > i + 1 && !(i === 0 && j === value.length - 2) && cross(value[i] as LandscapePoint, value[i + 1] as LandscapePoint, value[j] as LandscapePoint, value[j + 1] as LandscapePoint)) issues.push(`${path}:self_intersection`);
}
function base(value: unknown, path: string, expected: LandscapeRevision | undefined, issues: string[], extra: readonly string[]): boolean {
  if (!exact(value, [...BASE_KEYS, ...extra]) || !record(value)) { issues.push(`${path}:keys`); return false; }
  add(issues, text(value.id, ID), `${path}.id`); if (revision(value.revision, `${path}.revision`, issues) && expected && !sameRevision(value.revision, expected)) issues.push(`${path}.revision:mismatch`);
  add(issues, text(value.contentSha256, SHA), `${path}.contentSha256`); provenance(value.provenance, `${path}.provenance`, issues);
  if (text(value.contentSha256, SHA) && value.contentSha256 !== hashLandscapeObject(value)) issues.push(`${path}.contentSha256:mismatch`);
  return true;
}
function positive(value: unknown, path: string, issues: string[], max = 1e9): void { add(issues, finite(value, Number.MIN_VALUE, max), path); }
function refs(value: unknown, ids: Set<string>, path: string, issues: string[], min = 1): void { add(issues, Array.isArray(value) && value.length >= min && value.every(id => typeof id === 'string' && ids.has(id)), `${path}:dangling`); }
function authorityInput(value: unknown, path: string, expected: LandscapeRevision | undefined, subject: LandscapeAuthorityInput['subject'], issues: string[]): void {
  if (!base(value, path, expected, issues, ['subject', 'values']) || !record(value)) return;
  const authority = value as unknown as LandscapeAuthorityInput;
  add(issues, authority.subject === subject, `${path}.subject`); if (!record(authority.values) || Object.keys(authority.values).length === 0) issues.push(`${path}.values:empty`); else Object.entries(authority.values).forEach(([k, v]) => { add(issues, text(k, ID), `${path}.values:key`); add(issues, (typeof v === 'string' && !/^(ai:|preview:|synthetic:|catalog-unverified:|HOLD:)/i.test(v)) || typeof v === 'boolean' || finite(v), `${path}.values.${k}`); });
}

export function validateLandscapeProductContract(input: unknown): string[] {
  const issues: string[] = [];
  const keys = ['schema', 'identity', 'units', 'authority', 'siteBoundary', 'grading', 'hardscape', 'soilZones', 'plantingZones', 'plants', 'irrigation', 'maintenance', 'authoritative'] as const;
  if (!exact(input, keys) || !record(input)) return ['contract:keys'];
  const c = input as unknown as LandscapeProductContract;
  add(issues, c.schema === LANDSCAPE_PRODUCT_CONTRACT_SCHEMA && c.authoritative === true, 'contract:not_authoritative');
  if (!exact(c.identity, ['projectId', 'revision', 'contentSha256']) || !record(c.identity)) issues.push('identity:keys');
  const identity = record(c.identity) ? c.identity : undefined; const rev = identity && record(identity.revision) ? identity.revision as unknown as LandscapeRevision : undefined;
  if (identity) { add(issues, text(identity.projectId, ID), 'identity.projectId'); revision(identity.revision, 'identity.revision', issues); add(issues, text(identity.contentSha256, SHA), 'identity.contentSha256'); if (text(identity.contentSha256, SHA) && identity.contentSha256 !== hashLandscapeProductContract(c)) issues.push('identity.contentSha256:mismatch'); }
  add(issues, exact(c.units, ['length', 'area', 'volume', 'flow', 'pressure', 'slope']) && c.units.length === 'm' && c.units.area === 'm2' && c.units.volume === 'm3' && c.units.flow === 'lpm' && c.units.pressure === 'kPa' && c.units.slope === '%', 'units:invalid');
  if (!exact(c.authority, ['coordinateFrame', 'terrainBinding', 'client', 'code', 'hydraulic', 'catalog', 'maintenance'])) issues.push('authority:keys'); else {
    const a = c.authority;
    if (base(a.coordinateFrame, 'authority.coordinateFrame', rev, issues, ['kind', 'crs', 'horizontalDatum', 'verticalDatum', 'epoch', 'origin', 'rotationDeg', 'reviewStatus'])) { add(issues, a.coordinateFrame.kind === 'APPROVED_CARTESIAN' && a.coordinateFrame.reviewStatus === 'APPROVED', 'authority.coordinateFrame:unapproved'); add(issues, text(a.coordinateFrame.crs, /^(?!ai:|preview:|synthetic:).+$/i), 'authority.coordinateFrame.crs'); add(issues, text(a.coordinateFrame.horizontalDatum, /^(?!ai:|preview:|synthetic:).+$/i), 'authority.coordinateFrame.horizontalDatum'); add(issues, text(a.coordinateFrame.verticalDatum, /^(?!ai:|preview:|synthetic:).+$/i), 'authority.coordinateFrame.verticalDatum'); add(issues, text(a.coordinateFrame.epoch, /^\d{4}(?:-\d{2}-\d{2})?$/), 'authority.coordinateFrame.epoch'); point(a.coordinateFrame.origin, 'authority.coordinateFrame.origin', issues, true); add(issues, finite(a.coordinateFrame.rotationDeg, -360, 360), 'authority.coordinateFrame.rotationDeg'); }
    if (base(a.terrainBinding, 'authority.terrainBinding', rev, issues, ['civilSurfaceId', 'civilSurfaceRevision', 'civilSurfaceSha256', 'drainageOutletId', 'drainageOutletSha256', 'approvedUse'])) { add(issues, text(a.terrainBinding.civilSurfaceId, ID), 'authority.terrainBinding.civilSurfaceId'); revision(a.terrainBinding.civilSurfaceRevision, 'authority.terrainBinding.civilSurfaceRevision', issues); add(issues, text(a.terrainBinding.civilSurfaceSha256, SHA), 'authority.terrainBinding.civilSurfaceSha256'); add(issues, text(a.terrainBinding.drainageOutletId, ID), 'authority.terrainBinding.drainageOutletId'); add(issues, text(a.terrainBinding.drainageOutletSha256, SHA), 'authority.terrainBinding.drainageOutletSha256'); add(issues, a.terrainBinding.approvedUse === true, 'authority.terrainBinding:unapproved'); }
    authorityInput(a.client, 'authority.client', rev, 'CLIENT', issues); authorityInput(a.code, 'authority.code', rev, 'CODE', issues); authorityInput(a.hydraulic, 'authority.hydraulic', rev, 'HYDRAULIC', issues); authorityInput(a.catalog, 'authority.catalog', rev, 'CATALOG', issues); authorityInput(a.maintenance, 'authority.maintenance', rev, 'MAINTENANCE', issues);
  }
  const allIds = new Set<string>(); const register = (value: unknown, path: string): boolean => { if (!record(value) || !text(value.id, ID)) { issues.push(`${path}.id`); return false; } if (allIds.has(value.id)) issues.push(`${path}.id:duplicate`); allIds.add(value.id); return true; };
  const authorityObjects = [c.authority.coordinateFrame, c.authority.terrainBinding, c.authority.client, c.authority.code, c.authority.hydraulic, c.authority.catalog, c.authority.maintenance];
  authorityObjects.forEach((value, index) => register(value, `authority.object[${index}]`));
  if (base(c.siteBoundary, 'siteBoundary', rev, issues, ['polygon'])) { register(c.siteBoundary, 'siteBoundary'); polygon(c.siteBoundary.polygon, 'siteBoundary.polygon', issues); }
  const spotIds = new Set<string>(); const breaklineIds = new Set<string>(); const outletIds = new Set<string>();
  const grading = c.grading;
  if (!exact(grading, ['spotGrades', 'breaklines', 'drainagePaths', 'outlets']) || !record(grading)) issues.push('grading:keys'); else {
    if (!Array.isArray(grading.spotGrades) || grading.spotGrades.length === 0) issues.push('grading.spotGrades:required'); else grading.spotGrades.forEach((v, i) => { const p = `grading.spotGrades[${i}]`; if (base(v, p, rev, issues, ['point'])) { register(v, p); spotIds.add(v.id); point(v.point, `${p}.point`, issues, true); } });
    if (!Array.isArray(grading.breaklines) || grading.breaklines.length === 0) issues.push('grading.breaklines:required'); else grading.breaklines.forEach((v, i) => { const p = `grading.breaklines[${i}]`; if (base(v, p, rev, issues, ['kind', 'pointRefs'])) { register(v, p); breaklineIds.add(v.id); add(issues, ['EDGE', 'RIDGE', 'VALLEY', 'WALL'].includes(v.kind), `${p}.kind`); refs(v.pointRefs, spotIds, `${p}.pointRefs`, issues, 2); } });
    if (!Array.isArray(grading.outlets) || grading.outlets.length === 0) issues.push('grading.outlets:required'); else grading.outlets.forEach((v, i) => { const p = `grading.outlets[${i}]`; if (base(v, p, rev, issues, ['civilOutletRef', 'elevationM', 'approvalStatus'])) { register(v, p); outletIds.add(v.id); add(issues, text(v.civilOutletRef, ID), `${p}.civilOutletRef`); add(issues, finite(v.elevationM), `${p}.elevationM`); add(issues, v.approvalStatus === 'APPROVED', `${p}.approvalStatus`); } });
    if (!Array.isArray(grading.drainagePaths) || grading.drainagePaths.length === 0) issues.push('grading.drainagePaths:required'); else grading.drainagePaths.forEach((v, i) => { const p = `grading.drainagePaths[${i}]`; if (base(v, p, rev, issues, ['pointRefs', 'outletRef', 'flowDirection'])) { register(v, p); refs(v.pointRefs, spotIds, `${p}.pointRefs`, issues, 2); add(issues, outletIds.has(v.outletRef), `${p}.outletRef:dangling`); add(issues, ['DOWNHILL', 'CONTROLLED'].includes(v.flowDirection), `${p}.flowDirection`); } });
  }
  const hardscapeIds = new Set<string>(); const soilIds = new Set<string>(); const plantingIds = new Set<string>(); const plantIds = new Set<string>();
  const list = <T extends Record<string, unknown>>(value: unknown, key: string, extra: readonly string[], each: (v: T, path: string) => void): void => { if (!Array.isArray(value) || value.length === 0 || value.length > MAX) { issues.push(`${key}:required`); return; } value.forEach((v, i) => { const p = `${key}[${i}]`; if (base(v, p, rev, issues, extra)) { register(v, p); each(v as unknown as T, p); } }); };
  list(c.hardscape, 'hardscape', ['kind', 'boundary', 'thicknessM', 'maxSlopePercent', 'accessibilityCriterionRef'], (v, p) => { add(issues, ['PAVING', 'PATH', 'SEAT_WALL', 'PLAY_SURFACE'].includes(v.kind as string), `${p}.kind`); polygon(v.boundary, `${p}.boundary`, issues); positive(v.thicknessM, `${p}.thicknessM`, issues, 10); add(issues, finite(v.maxSlopePercent, 0, 100), `${p}.maxSlopePercent`); add(issues, v.accessibilityCriterionRef === c.authority.code.id, `${p}.accessibilityCriterionRef:dangling`); hardscapeIds.add(v.id as string); });
  list(c.soilZones, 'soilZones', ['boundary', 'depthM', 'volumeM3', 'soilTypeRef'], (v, p) => { polygon(v.boundary, `${p}.boundary`, issues); positive(v.depthM, `${p}.depthM`, issues, 100); positive(v.volumeM3, `${p}.volumeM3`, issues); add(issues, text(v.soilTypeRef, ID), `${p}.soilTypeRef`); soilIds.add(v.id as string); });
  list(c.plantingZones, 'plantingZones', ['soilZoneRef', 'boundary', 'irrigationZoneRef'], (v, p) => { add(issues, soilIds.has(v.soilZoneRef as string), `${p}.soilZoneRef:dangling`); polygon(v.boundary, `${p}.boundary`, issues); add(issues, text(v.irrigationZoneRef, ID), `${p}.irrigationZoneRef`); plantingIds.add(v.id as string); });
  list(c.plants, 'plants', ['plantingZoneRef', 'speciesId', 'supplierId', 'supplierProvenance', 'point', 'matureCanopyDiameterM', 'matureRootDiameterM'], (v, p) => { add(issues, plantingIds.has(v.plantingZoneRef as string), `${p}.plantingZoneRef:dangling`); add(issues, text(v.speciesId, ID), `${p}.speciesId`); add(issues, text(v.supplierId, ID), `${p}.supplierId`); provenance(v.supplierProvenance, `${p}.supplierProvenance`, issues); point(v.point, `${p}.point`, issues); positive(v.matureCanopyDiameterM, `${p}.matureCanopyDiameterM`, issues); positive(v.matureRootDiameterM, `${p}.matureRootDiameterM`, issues); add(issues, (v.matureRootDiameterM as number) >= 0.1, `${p}.matureRootDiameterM`); plantIds.add(v.id as string); });
  const irrigation = c.irrigation;
  if (!exact(irrigation, ['source', 'valves', 'zones', 'pipes', 'emitters', 'waterBudget']) || !record(irrigation)) issues.push('irrigation:keys'); else {
    const sourceIds = new Set<string>(); const valveIds = new Set<string>(); const zoneIds = new Set<string>();
    if (base(irrigation.source, 'irrigation.source', rev, issues, ['pressureKPa', 'maxFlowLpm', 'authorityInputRef'])) { register(irrigation.source, 'irrigation.source'); sourceIds.add(irrigation.source.id); positive(irrigation.source.pressureKPa, 'irrigation.source.pressureKPa', issues); positive(irrigation.source.maxFlowLpm, 'irrigation.source.maxFlowLpm', issues); add(issues, irrigation.source.authorityInputRef === c.authority.hydraulic.id, 'irrigation.source.authorityInputRef:dangling'); }
    list(irrigation.valves, 'irrigation.valves', ['sourceRef', 'zoneRef', 'ratedFlowLpm', 'catalogAuthorityRef'], (v, p) => { valveIds.add(v.id as string); add(issues, sourceIds.has(v.sourceRef as string), `${p}.sourceRef:dangling`); add(issues, text(v.zoneRef, ID), `${p}.zoneRef`); positive(v.ratedFlowLpm, `${p}.ratedFlowLpm`, issues); add(issues, v.catalogAuthorityRef === c.authority.catalog.id, `${p}.catalogAuthorityRef:dangling`); });
    list(irrigation.zones, 'irrigation.zones', ['plantingZoneRefs', 'valveRef', 'designFlowLpm', 'waterBudgetM3PerYear'], (v, p) => { zoneIds.add(v.id as string); refs(v.plantingZoneRefs, plantingIds, `${p}.plantingZoneRefs`, issues); add(issues, text(v.valveRef, ID), `${p}.valveRef`); positive(v.designFlowLpm, `${p}.designFlowLpm`, issues); positive(v.waterBudgetM3PerYear, `${p}.waterBudgetM3PerYear`, issues); });
    const nodeIds = new Set([...sourceIds, ...valveIds]); const edges: Array<[string, string]> = [];
    list(irrigation.pipes, 'irrigation.pipes', ['fromRef', 'toRef', 'diameterMm', 'lengthM', 'designFlowLpm'], (v, p) => { add(issues, nodeIds.has(v.fromRef as string), `${p}.fromRef:dangling`); add(issues, nodeIds.has(v.toRef as string), `${p}.toRef:dangling`); add(issues, v.fromRef !== v.toRef, `${p}:self_cycle`); if (nodeIds.has(v.fromRef as string) && nodeIds.has(v.toRef as string)) edges.push([v.fromRef as string, v.toRef as string]); positive(v.diameterMm, `${p}.diameterMm`, issues); positive(v.lengthM, `${p}.lengthM`, issues); positive(v.designFlowLpm, `${p}.designFlowLpm`, issues); });
    const adjacency = new Map<string, string[]>(); edges.forEach(([a, b]) => adjacency.set(a, [...(adjacency.get(a) ?? []), b])); const visited = new Set<string>(); const visiting = new Set<string>(); const walk = (id: string): void => { if (visiting.has(id)) { issues.push('irrigation.pipes:cycle'); return; } if (visited.has(id)) return; visiting.add(id); (adjacency.get(id) ?? []).forEach(walk); visiting.delete(id); visited.add(id); }; sourceIds.forEach(walk); edges.forEach(([a, b]) => { if (!visited.has(a) || !visited.has(b)) issues.push('irrigation.pipes:disconnected'); });
    list(irrigation.emitters, 'irrigation.emitters', ['valveRef', 'plantRefs', 'flowLpm', 'spacingM'], (v, p) => { add(issues, valveIds.has(v.valveRef as string), `${p}.valveRef:dangling`); refs(v.plantRefs, plantIds, `${p}.plantRefs`, issues); positive(v.flowLpm, `${p}.flowLpm`, issues); positive(v.spacingM, `${p}.spacingM`, issues); });
    if (base(irrigation.waterBudget, 'irrigation.waterBudget', rev, issues, ['annualDemandM3', 'sourceCapacityLpm', 'climateInputRef', 'approvalStatus'])) { positive(irrigation.waterBudget.annualDemandM3, 'irrigation.waterBudget.annualDemandM3', issues); positive(irrigation.waterBudget.sourceCapacityLpm, 'irrigation.waterBudget.sourceCapacityLpm', issues); add(issues, irrigation.waterBudget.climateInputRef === c.authority.hydraulic.id, 'irrigation.waterBudget.climateInputRef:dangling'); add(issues, irrigation.waterBudget.approvalStatus === 'APPROVED', 'irrigation.waterBudget.approvalStatus'); }
    irrigation.zones.forEach((z, i) => { if (record(z)) add(issues, valveIds.has(z.valveRef), `irrigation.zones[${i}].valveRef:dangling`); });
    irrigation.valves.forEach((v, i) => { if (record(v)) add(issues, zoneIds.has(v.zoneRef), `irrigation.valves[${i}].zoneRef:dangling`); });
    c.plantingZones.forEach((z, i) => add(issues, zoneIds.has(z.irrigationZoneRef), `plantingZones[${i}].irrigationZoneRef:dangling`));
  }
  if (!exact(c.maintenance, ['zones', 'tasks']) || !record(c.maintenance)) issues.push('maintenance:keys'); else { const zoneIds = new Set<string>(); list(c.maintenance.zones, 'maintenance.zones', ['objectRefs', 'accessWidthM', 'taskAuthorityRef'], (v, p) => { zoneIds.add(v.id as string); refs(v.objectRefs, allIds, `${p}.objectRefs`, issues); positive(v.accessWidthM, `${p}.accessWidthM`, issues); add(issues, v.taskAuthorityRef === c.authority.maintenance.id, `${p}.taskAuthorityRef:dangling`); }); list(c.maintenance.tasks, 'maintenance.tasks', ['zoneRef', 'taskCode', 'intervalDays', 'methodRef'], (v, p) => { add(issues, zoneIds.has(v.zoneRef as string), `${p}.zoneRef:dangling`); add(issues, text(v.taskCode, ID), `${p}.taskCode`); positive(v.intervalDays, `${p}.intervalDays`, issues); add(issues, v.methodRef === c.authority.maintenance.id, `${p}.methodRef:dangling`); }); }
  return [...new Set(issues)];
}

export function createLandscapeProductContract(input: Omit<LandscapeProductContract, 'identity'> & { identity: Omit<LandscapeProductContract['identity'], 'contentSha256'> }): LandscapeProductContract {
  const draft = { ...input, identity: { ...input.identity, contentSha256: '0'.repeat(64) } } as LandscapeProductContract;
  const contract = { ...draft, identity: { ...draft.identity, contentSha256: hashLandscapeProductContract(draft) } };
  const issues = validateLandscapeProductContract(contract); if (issues.length) throw new Error(`invalid_landscape_product_contract:${issues.join(',')}`); return contract;
}
