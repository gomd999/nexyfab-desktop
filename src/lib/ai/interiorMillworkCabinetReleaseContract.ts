import { createHash } from 'node:crypto';

export const INTERIOR_MILLWORK_RELEASE_SCHEMA = 'nexyfab.interior-millwork-release.v1' as const;
export const INTERIOR_MILLWORK_EXCHANGE_SCHEMA = 'nexyfab.interior-millwork-exchange.v1' as const;
const PARSER_ID = 'nexyfab.interior-millwork-independent-parser.v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const EPSILON = 1e-8;

export interface MillworkSourceBindingV1 {
  assemblyId: string;
  modelPath: string;
  modelSha256: string;
  contentHash: string;
  revisionSha256: string;
  revision: number;
}
export interface MillworkMaterialProvenanceV1 {
  materialId: string;
  materialName: string;
  supplierSource: string;
  capturedAt: string;
  revisionSha256: string;
}
export interface MillworkPointMmV1 { xMm: number; yMm: number; zMm: number; }
export type MillworkPartKind = 'panel' | 'shelf' | 'door' | 'drawer' | 'back' | 'hardware';
export interface MillworkCabinetV1 {
  id: string;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  clearanceToleranceMm: number;
  partIds: readonly string[];
  jointIds: readonly string[];
}
export interface MillworkPartV1 {
  id: string;
  cabinetId: string;
  kind: MillworkPartKind;
  materialId: string;
  thicknessMm: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  originMm: MillworkPointMmV1;
  toleranceMm: number;
  provenance: MillworkMaterialProvenanceV1;
}
export type MillworkJointType = 'dowel' | 'dado' | 'rabbet' | 'confirmat' | 'biscuit';
export interface MillworkJointV1 {
  id: string;
  cabinetId: string;
  partAId: string;
  partBId: string;
  type: MillworkJointType;
  positionMm: MillworkPointMmV1;
  lengthMm: number;
  widthMm: number;
  depthMm: number;
  toleranceMm: number;
}
export type MillworkMachiningKind = 'drill' | 'dado' | 'rabbet' | 'edge_band';
export type MillworkEdge = 'top' | 'bottom' | 'left' | 'right' | 'front' | 'back';
export interface MillworkMachiningV1 {
  id: string;
  partId: string;
  kind: MillworkMachiningKind;
  positionMm: MillworkPointMmV1;
  lengthMm: number;
  widthMm: number;
  depthMm: number;
  diameterMm?: number;
  edge?: MillworkEdge;
  toolReference: string;
}
export interface MillworkBomItemV1 { id: string; partId: string; quantity: number; }
export interface MillworkOutputV1 { format: 'nexyfab-exchange-json'; targetFormat: 'step' | 'json' | 'cnc-neutral'; revision: number; content: string; bytes: number; sha256: string; }
export interface MillworkExchangeV1 { schema: typeof INTERIOR_MILLWORK_EXCHANGE_SCHEMA; revision: number; sourceAssemblyId: string; sourceModelSha256: string; sourceContentHash: string; cabinetIds: string[]; partIds: string[]; jointIds: string[]; machiningIds: string[]; bomIds: string[]; }
export interface InteriorMillworkReleaseInputV1 {
  schema: typeof INTERIOR_MILLWORK_RELEASE_SCHEMA;
  units: 'mm-N';
  revision: number;
  source: MillworkSourceBindingV1;
  cabinets: readonly MillworkCabinetV1[];
  parts: readonly MillworkPartV1[];
  joints: readonly MillworkJointV1[];
  machining: readonly MillworkMachiningV1[];
  bom: readonly MillworkBomItemV1[];
  output: MillworkOutputV1;
}
export interface MillworkParserReadbackV1 {
  parserId: typeof PARSER_ID;
  parserSourceSha256: string;
  sourceAssemblyId: string;
  sourceModelSha256: string;
  sourceContentHash: string;
  sourceRevision: number;
  outputSha256: string;
  cabinetIds: readonly string[];
  partIds: readonly string[];
  jointIds: readonly string[];
  machiningIds: readonly string[];
  bomIds: readonly string[];
  verificationSha256: string;
}
export interface MillworkValidationResult { valid: boolean; issues: string[]; }
export interface MillworkReleaseAssessment { schema: typeof INTERIOR_MILLWORK_RELEASE_SCHEMA; releaseReady: false; status: 'HOLD'; internalParserVerified: boolean; independentAttestationVerified: boolean; /** @deprecated Use internalParserVerified. */ parserVerified: boolean; blockers: string[]; holdBoundary: readonly string[]; }
export interface MillworkReadbackResult { valid: boolean; issues: string[]; }

const holdBoundary = [
  'native_step_and_cnc_parser_not_verified',
  'cnc_postprocessor_and_machine_qualification_not_run',
  'site_measurement_not_verified',
  'fabrication_and_installation_inspection_not_run',
  'material_lot_and_finish_receipt_not_available',
] as const;
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const arrays = <T>(value: unknown): readonly T[] => Array.isArray(value) ? value as readonly T[] : [];
const point = (value: unknown): value is MillworkPointMmV1 => Boolean(value && typeof value === 'object' && finite((value as MillworkPointMmV1).xMm) && finite((value as MillworkPointMmV1).yMm) && finite((value as MillworkPointMmV1).zMm) && Math.max(Math.abs((value as MillworkPointMmV1).xMm), Math.abs((value as MillworkPointMmV1).yMm), Math.abs((value as MillworkPointMmV1).zMm)) <= 1e9);
const ids = (values: readonly { id?: unknown }[]): Set<string> => new Set(values.map(value => value?.id).filter((id): id is string => typeof id === 'string'));
const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)));
const stableIdArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string' && id.trim() === id && id.length > 0) && new Set(value).size === value.length;
const pointInsidePart = (value: MillworkPointMmV1, part: MillworkPartV1, tolerance: number): boolean => value.xMm >= part.originMm.xMm - tolerance && value.xMm <= part.originMm.xMm + part.widthMm + tolerance && value.yMm >= part.originMm.yMm - tolerance && value.yMm <= part.originMm.yMm + part.depthMm + tolerance && value.zMm >= part.originMm.zMm - tolerance && value.zMm <= part.originMm.zMm + part.heightMm + tolerance;
function register(values: readonly { id?: unknown }[], label: string, issues: string[], all: Set<string>): void { for (const value of values) { const id = value?.id; if (typeof id !== 'string' || !id.trim() || all.has(id)) issues.push(`${label}_id_invalid:${String(id)}`); else all.add(id); } }
function provenance(value: unknown, revisionSha256: string): value is MillworkMaterialProvenanceV1 { if (!value || typeof value !== 'object') return false; const p = value as MillworkMaterialProvenanceV1; return typeof p.materialId === 'string' && !!p.materialId.trim() && typeof p.materialName === 'string' && !!p.materialName.trim() && typeof p.supplierSource === 'string' && !!p.supplierSource.trim() && typeof p.capturedAt === 'string' && Number.isFinite(Date.parse(p.capturedAt)) && p.revisionSha256 === revisionSha256 && SHA256.test(p.revisionSha256); }
function boxOverlap(a: MillworkPartV1, b: MillworkPartV1): boolean { return a.originMm.xMm < b.originMm.xMm + b.widthMm - EPSILON && a.originMm.xMm + a.widthMm > b.originMm.xMm + EPSILON && a.originMm.yMm < b.originMm.yMm + b.depthMm - EPSILON && a.originMm.yMm + a.depthMm > b.originMm.yMm + EPSILON && a.originMm.zMm < b.originMm.zMm + b.heightMm - EPSILON && a.originMm.zMm + a.heightMm > b.originMm.zMm + EPSILON; }
function machiningFootprintFits(operation: MillworkMachiningV1, part: MillworkPartV1): boolean { const l = operation.lengthMm / 2; const w = operation.widthMm / 2; const d = operation.depthMm / 2; const t = part.toleranceMm; const x = operation.positionMm.xMm; const y = operation.positionMm.yMm; const z = operation.positionMm.zMm; const x0 = part.originMm.xMm - t; const x1 = part.originMm.xMm + part.widthMm + t; const y0 = part.originMm.yMm - t; const y1 = part.originMm.yMm + part.depthMm + t; const z0 = part.originMm.zMm - t; const z1 = part.originMm.zMm + part.heightMm + t; return (x - l >= x0 && x + l <= x1 && y - w >= y0 && y + w <= y1 && z - d >= z0 && z + d <= z1) || (x - w >= x0 && x + w <= x1 && y - l >= y0 && y + l <= y1 && z - d >= z0 && z + d <= z1) || (x - d >= x0 && x + d <= x1 && y - w >= y0 && y + w <= y1 && z - l >= z0 && z + l <= z1); }
function jointExtentIntersects(joint: MillworkJointV1, part: MillworkPartV1, dx: number, dy: number, dz: number): boolean { const x0 = joint.positionMm.xMm - dx / 2; const x1 = joint.positionMm.xMm + dx / 2; const y0 = joint.positionMm.yMm - dy / 2; const y1 = joint.positionMm.yMm + dy / 2; const z0 = joint.positionMm.zMm - dz / 2; const z1 = joint.positionMm.zMm + dz / 2; return x0 < part.originMm.xMm + part.widthMm - EPSILON && x1 > part.originMm.xMm + EPSILON && y0 < part.originMm.yMm + part.depthMm - EPSILON && y1 > part.originMm.yMm + EPSILON && z0 < part.originMm.zMm + part.heightMm - EPSILON && z1 > part.originMm.zMm + EPSILON; }

export function validateInteriorMillworkRelease(input: InteriorMillworkReleaseInputV1 | null | undefined): MillworkValidationResult {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') return { valid: false, issues: ['input_missing'] };
  if (input.schema !== INTERIOR_MILLWORK_RELEASE_SCHEMA) issues.push('schema_invalid');
  if (input.units !== 'mm-N') issues.push('canonical_units_required');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) issues.push('revision_invalid');
  const source = input.source;
  if (!source || typeof source !== 'object') issues.push('source_binding_missing');
  else { if (typeof source.assemblyId !== 'string' || !source.assemblyId.trim()) issues.push('source_assembly_id_invalid'); if (typeof source.modelPath !== 'string' || !source.modelPath.trim() || source.modelPath.replaceAll('\\', '/').split('/').includes('..') || source.modelPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source.modelPath)) issues.push('source_model_path_invalid'); if (!SHA256.test(source.modelSha256) || !SHA256.test(source.contentHash) || !SHA256.test(source.revisionSha256)) issues.push('source_hash_invalid'); if (!Number.isSafeInteger(source.revision) || source.revision !== input.revision) issues.push('stale_source_revision'); }
  const cabinets = arrays<MillworkCabinetV1>(input.cabinets); const parts = arrays<MillworkPartV1>(input.parts); const joints = arrays<MillworkJointV1>(input.joints); const machining = arrays<MillworkMachiningV1>(input.machining); const bom = arrays<MillworkBomItemV1>(input.bom);
  for (const [value, label] of [[input.cabinets, 'cabinets'], [input.parts, 'parts'], [input.joints, 'joints'], [input.machining, 'machining'], [input.bom, 'bom']] as const) if (!Array.isArray(value)) issues.push(`${label}_array_required`);
  const all = new Set<string>(); register(cabinets, 'cabinet', issues, all); register(parts, 'part', issues, all); register(joints, 'joint', issues, all); register(machining, 'machining', issues, all); register(bom, 'bom', issues, all);
  const cabinetIds = ids(cabinets); const partIds = ids(parts); const jointIds = ids(joints); const partMap = new Map(parts.map(item => [item?.id, item])); const cabinetMap = new Map(cabinets.map(item => [item?.id, item]));
  for (const cabinet of cabinets) if (!cabinet || typeof cabinet !== 'object' || !positive(cabinet.widthMm) || !positive(cabinet.depthMm) || !positive(cabinet.heightMm) || !nonnegative(cabinet.clearanceToleranceMm) || arrays<string>(cabinet.partIds).length === 0 || new Set(cabinet.partIds).size !== cabinet.partIds.length || new Set(cabinet.jointIds).size !== cabinet.jointIds.length || arrays<string>(cabinet.partIds).some(id => !partIds.has(id)) || arrays<string>(cabinet.jointIds).some(id => !jointIds.has(id))) issues.push(`cabinet_invalid:${cabinet?.id}`);
  for (const part of parts) {
    if (!part || typeof part !== 'object' || !cabinetIds.has(part.cabinetId) || !cabinetMap.get(part.cabinetId)?.partIds.includes(part.id) || !['panel', 'shelf', 'door', 'drawer', 'back', 'hardware'].includes(part.kind) || typeof part.materialId !== 'string' || !part.materialId.trim() || part.materialId !== part.provenance?.materialId || !positive(part.thicknessMm) || !positive(part.widthMm) || !positive(part.depthMm) || !positive(part.heightMm) || !point(part.originMm) || !positive(part.toleranceMm) || part.toleranceMm > Math.min(part.widthMm, part.depthMm, part.heightMm) / 2 || !provenance(part.provenance, source?.revisionSha256 ?? '') || part.thicknessMm > Math.min(part.widthMm, part.depthMm, part.heightMm)) issues.push(`part_invalid:${part?.id}`);
    const cabinet = cabinetMap.get(part?.cabinetId); if (cabinet && point(part.originMm) && (part.originMm.xMm < -part.toleranceMm || part.originMm.yMm < -part.toleranceMm || part.originMm.zMm < -part.toleranceMm || part.originMm.xMm + part.widthMm > cabinet.widthMm + part.toleranceMm || part.originMm.yMm + part.depthMm > cabinet.depthMm + part.toleranceMm || part.originMm.zMm + part.heightMm > cabinet.heightMm + part.toleranceMm)) issues.push(`part_out_of_cabinet:${part.id}`);
  }
  for (const cabinet of cabinets) { const owned = parts.filter(part => part?.cabinetId === cabinet?.id); for (let i = 0; i < owned.length; i += 1) for (let j = i + 1; j < owned.length; j += 1) if (boxOverlap(owned[i]!, owned[j]!)) issues.push(`part_clash:${owned[i]!.id}:${owned[j]!.id}`); }
  for (const joint of joints) { const a = partMap.get(joint?.partAId); const b = partMap.get(joint?.partBId); const cabinet = cabinetMap.get(joint?.cabinetId); const t = joint && finite(joint.toleranceMm) ? joint.toleranceMm : 0; const p = joint?.positionMm; const dx = joint?.widthMm ?? 0; const dy = joint?.lengthMm ?? 0; const dz = joint?.depthMm ?? 0; const extentInsideCabinet = Boolean(cabinet && p && point(p) && p.xMm - dx / 2 >= -t && p.xMm + dx / 2 <= cabinet.widthMm + t && p.yMm - dy / 2 >= -t && p.yMm + dy / 2 <= cabinet.depthMm + t && p.zMm - dz / 2 >= -t && p.zMm + dz / 2 <= cabinet.heightMm + t); const extentIntersectsBoth = Boolean(joint && a && b && jointExtentIntersects(joint, a, dx, dy, dz) && jointExtentIntersects(joint, b, dx, dy, dz)); if (!joint || typeof joint !== 'object' || !cabinet || !cabinet.jointIds.includes(joint.id) || !a || !b || a.id === b.id || a.cabinetId !== joint.cabinetId || b.cabinetId !== joint.cabinetId || !['dowel', 'dado', 'rabbet', 'confirmat', 'biscuit'].includes(joint.type) || !point(joint.positionMm) || !pointInsidePart(joint.positionMm, a, joint.toleranceMm) || !pointInsidePart(joint.positionMm, b, joint.toleranceMm) || !positive(joint.lengthMm) || !positive(joint.widthMm) || !positive(joint.depthMm) || !positive(joint.toleranceMm) || !extentInsideCabinet || !extentIntersectsBoth || joint.toleranceMm > cabinet.clearanceToleranceMm || joint.depthMm > Math.min(a.thicknessMm, b.thicknessMm) * 2) issues.push(`joint_invalid_or_dangling:${joint?.id}`); }
  for (const operation of machining) {
    const part = partMap.get(operation?.partId);
    const halfLength = operation && finite(operation.lengthMm) ? operation.lengthMm / 2 : 0;
    const extentFits = Boolean(operation && part && point(operation.positionMm) && ((operation.positionMm.xMm - halfLength >= part.originMm.xMm - part.toleranceMm && operation.positionMm.xMm + halfLength <= part.originMm.xMm + part.widthMm + part.toleranceMm) || (operation.positionMm.yMm - halfLength >= part.originMm.yMm - part.toleranceMm && operation.positionMm.yMm + halfLength <= part.originMm.yMm + part.depthMm + part.toleranceMm) || (operation.positionMm.zMm - halfLength >= part.originMm.zMm - part.toleranceMm && operation.positionMm.zMm + halfLength <= part.originMm.zMm + part.heightMm + part.toleranceMm)));
    if (!operation || typeof operation !== 'object' || !part || !['drill', 'dado', 'rabbet', 'edge_band'].includes(operation.kind) || !point(operation.positionMm) || !positive(operation.lengthMm) || !positive(operation.widthMm) || !positive(operation.depthMm) || typeof operation.toolReference !== 'string' || !operation.toolReference.trim() || operation.lengthMm > Math.max(part.widthMm, part.depthMm, part.heightMm) || !extentFits || !machiningFootprintFits(operation, part) || operation.depthMm > part.thicknessMm + part.toleranceMm || operation.positionMm.xMm < part.originMm.xMm - part.toleranceMm || operation.positionMm.xMm > part.originMm.xMm + part.widthMm + part.toleranceMm || operation.positionMm.yMm < part.originMm.yMm - part.toleranceMm || operation.positionMm.yMm > part.originMm.yMm + part.depthMm + part.toleranceMm || operation.positionMm.zMm < part.originMm.zMm - part.toleranceMm || operation.positionMm.zMm > part.originMm.zMm + part.heightMm + part.toleranceMm) issues.push(`machining_invalid_or_out_of_part:${operation?.id}`);
    if (operation?.kind === 'drill' && (!positive(operation.diameterMm) || operation.diameterMm! > Math.min(part?.widthMm ?? 0, part?.depthMm ?? 0))) issues.push(`drill_diameter_invalid:${operation.id}`);
    if (operation?.kind === 'edge_band' && !['top', 'bottom', 'left', 'right', 'front', 'back'].includes(operation.edge ?? '')) issues.push(`edge_band_edge_invalid:${operation.id}`);
  }
  const bomParts = new Set<string>(); for (const item of bom) { if (!item || typeof item !== 'object' || !partIds.has(item.partId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || bomParts.has(item.partId)) issues.push(`bom_invalid:${item?.id}`); else bomParts.add(item.partId); }
  for (const partId of partIds) if (!bomParts.has(partId)) issues.push(`bom_missing:${partId}`);
  const output = input.output; if (!output || typeof output !== 'object' || output.format !== 'nexyfab-exchange-json' || !['step', 'json', 'cnc-neutral'].includes(output.targetFormat) || output.revision !== input.revision || typeof output.content !== 'string' || !Number.isSafeInteger(output.bytes) || output.bytes !== Buffer.byteLength(output.content, 'utf8') || !SHA256.test(output.sha256) || sha256(output.content) !== output.sha256) issues.push('output_binding_invalid');
  else { try { if (!verifyInteriorMillworkReadback(input, parseInteriorMillworkOutput(input)).valid) issues.push('output_readback_invalid'); } catch { issues.push('output_readback_invalid'); } }
  return { valid: issues.length === 0, issues };
}
function verificationHash(value: Omit<MillworkParserReadbackV1, 'verificationSha256'>): string { return sha256(JSON.stringify({ ...value, cabinetIds: [...value.cabinetIds].sort(), partIds: [...value.partIds].sort(), jointIds: [...value.jointIds].sort(), machiningIds: [...value.machiningIds].sort(), bomIds: [...value.bomIds].sort() })); }
export function parseInteriorMillworkOutput(input: InteriorMillworkReleaseInputV1): MillworkParserReadbackV1 { let parsed: unknown; try { parsed = JSON.parse(input.output.content) as unknown; } catch { throw new Error('INTERIOR_MILLWORK_OUTPUT_JSON_INVALID'); } const keys = ['schema', 'revision', 'sourceAssemblyId', 'sourceModelSha256', 'sourceContentHash', 'cabinetIds', 'partIds', 'jointIds', 'machiningIds', 'bomIds'] as const; if (!exactKeys(parsed, keys) || parsed.schema !== INTERIOR_MILLWORK_EXCHANGE_SCHEMA || !Number.isSafeInteger(parsed.revision) || typeof parsed.sourceAssemblyId !== 'string' || !parsed.sourceAssemblyId.trim() || !SHA256.test(String(parsed.sourceModelSha256)) || !SHA256.test(String(parsed.sourceContentHash)) || !keys.slice(5).every(key => stableIdArray(parsed[key]))) throw new Error('INTERIOR_MILLWORK_OUTPUT_SCHEMA_INVALID'); const exchange = parsed as unknown as MillworkExchangeV1; const unsigned = { parserId: PARSER_ID, parserSourceSha256: sha256(parseInteriorMillworkOutput.toString()), sourceAssemblyId: exchange.sourceAssemblyId, sourceModelSha256: exchange.sourceModelSha256, sourceContentHash: exchange.sourceContentHash, sourceRevision: exchange.revision, outputSha256: sha256(input.output.content), cabinetIds: exchange.cabinetIds, partIds: exchange.partIds, jointIds: exchange.jointIds, machiningIds: exchange.machiningIds, bomIds: exchange.bomIds } as const; return { ...unsigned, verificationSha256: verificationHash(unsigned) }; }
export function verifyInteriorMillworkReadback(input: InteriorMillworkReleaseInputV1, readback: MillworkParserReadbackV1 | null | undefined): MillworkReadbackResult { if (!readback || typeof readback !== 'object') return { valid: false, issues: ['readback_missing'] }; const expected = { parserId: PARSER_ID, parserSourceSha256: sha256(parseInteriorMillworkOutput.toString()), sourceAssemblyId: input.source.assemblyId, sourceModelSha256: input.source.modelSha256, sourceContentHash: input.source.contentHash, sourceRevision: input.revision, outputSha256: sha256(input.output.content), cabinetIds: input.cabinets.map(item => item.id), partIds: input.parts.map(item => item.id), jointIds: input.joints.map(item => item.id), machiningIds: input.machining.map(item => item.id), bomIds: input.bom.map(item => item.id) } as const; const issues: string[] = []; for (const key of ['parserId', 'parserSourceSha256', 'sourceAssemblyId', 'sourceModelSha256', 'sourceContentHash', 'sourceRevision', 'outputSha256', 'cabinetIds', 'partIds', 'jointIds', 'machiningIds', 'bomIds'] as const) if (JSON.stringify(readback[key]) !== JSON.stringify(expected[key])) issues.push(`readback_${key}_mismatch`); const { verificationSha256, ...unsigned } = readback; if (verificationSha256 !== verificationHash(unsigned)) issues.push('readback_verification_hash_invalid'); return { valid: issues.length === 0, issues }; }
export function assessInteriorMillworkRelease(input: InteriorMillworkReleaseInputV1, readback?: MillworkParserReadbackV1 | null): MillworkReleaseAssessment { const validation = validateInteriorMillworkRelease(input); const internalParserVerified = readback ? verifyInteriorMillworkReadback(input, readback).valid : false; const independentAttestationVerified = false; const blockers: string[] = [...holdBoundary]; if (!validation.valid) blockers.unshift(...validation.issues); blockers.unshift('independent_parser_attestation_required'); return { schema: INTERIOR_MILLWORK_RELEASE_SCHEMA, releaseReady: false, status: 'HOLD', internalParserVerified, independentAttestationVerified, parserVerified: false, blockers, holdBoundary }; }
