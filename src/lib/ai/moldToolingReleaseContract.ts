import { createHash } from 'node:crypto';

export const MOLD_TOOLING_RELEASE_SCHEMA = 'nexyfab.mold-tooling-release.v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const EPSILON = 1e-8;

export interface MoldSourceBindingV1 {
  partId: string;
  brepPath: string;
  brepBytes: number;
  brepSha256: string;
  contentHash: string;
  revisionSha256: string;
  revision: number;
}

export interface MoldMaterialShrinkProvenanceV1 {
  materialId: string;
  shrinkAllowancePercent: number;
  sourceId: string;
  sourceRef: string;
  capturedAt: string;
  revisionSha256: string;
}

export interface MoldPullDirectionV1 { x: number; y: number; z: number; frame: 'global_cartesian'; normalized: true; }
export interface MoldFaceV1 {
  id: string;
  partId: string;
  draftAngleDeg: number;
  requiredDraftDeg: number;
  wallThicknessMm: number;
}
export interface MoldPartingSegmentV1 {
  id: string;
  startMm: [number, number, number];
  endMm: [number, number, number];
}
export interface MoldCoreCavityV1 {
  id: string;
  kind: 'core' | 'cavity';
  partId: string;
  faceIds: readonly string[];
}
export type MoldUndercutResponse = 'slider' | 'redesign';
export interface MoldUndercutV1 { id: string; faceId: string; response: MoldUndercutResponse; responseId?: string; }
export interface MoldSliderV1 { id: string; partId: string; undercutId: string; travelMm: number; }
export interface MoldEjectorV1 { id: string; partId: string; faceId: string; positionMm: [number, number, number]; diameterMm: number; }
export interface MoldCoolingV1 { id: string; partId: string; pointsMm: readonly [number, number, number][]; lengthMm: number; }
export interface MoldToolingOutputV1 { format: 'json' | 'step' | 'dxf'; revision: number; content: string; bytes: number; sha256: string; }

export interface MoldToolingReleaseInputV1 {
  schema: typeof MOLD_TOOLING_RELEASE_SCHEMA;
  units: 'mm-deg';
  revision: number;
  source: MoldSourceBindingV1;
  material: MoldMaterialShrinkProvenanceV1;
  pullDirection: MoldPullDirectionV1;
  faces: readonly MoldFaceV1[];
  partingLine: readonly MoldPartingSegmentV1[];
  coreCavities: readonly MoldCoreCavityV1[];
  undercuts: readonly MoldUndercutV1[];
  sliders: readonly MoldSliderV1[];
  ejectors: readonly MoldEjectorV1[];
  cooling: readonly MoldCoolingV1[];
  output: MoldToolingOutputV1;
}

export interface MoldToolingParserReadbackV1 {
  parserId: 'nexyfab.mold-tooling-independent-parser.v1';
  parserSourceSha256: string;
  sourcePartId: string;
  sourceBrepSha256: string;
  sourceContentHash: string;
  sourceRevision: number;
  outputSha256: string;
  faceIds: readonly string[];
  partingSegmentIds: readonly string[];
  coreCavityIds: readonly string[];
  undercutIds: readonly string[];
  sliderIds: readonly string[];
  ejectorIds: readonly string[];
  coolingIds: readonly string[];
  verificationSha256: string;
}

export interface MoldToolingValidationResult { valid: boolean; issues: string[]; }
export interface MoldToolingReadbackResult { valid: boolean; issues: string[]; }
export interface MoldToolingReleaseAssessment {
  schema: typeof MOLD_TOOLING_RELEASE_SCHEMA;
  releaseReady: false;
  status: 'HOLD';
  parserVerified: boolean;
  blockers: string[];
  holdBoundary: readonly string[];
}

const holdBoundary = [
  'moldflow_cae_not_run',
  'tool_steel_and_heat_treatment_not_verified',
  'machine_tryout_t0_not_run',
  'metrology_and_production_receipt_not_available',
] as const;
const hash = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const bounded = (value: unknown): value is number => finite(value) && Math.abs(value) <= 1_000_000_000;
const point = (value: unknown): value is readonly [number, number, number] => Array.isArray(value) && value.length === 3 && value.every(bounded);
const distance = (a: readonly [number, number, number], b: readonly [number, number, number]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const equal = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(EPSILON, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);
const stringIds = (value: unknown): string[] => Array.isArray(value) && value.every(item => typeof item === 'string') ? [...value].sort() : [];

function register(values: readonly { id?: unknown }[], label: string, issues: string[], all: Set<string>): void {
  for (const value of values) {
    if (!value || typeof value.id !== 'string' || !value.id.trim() || all.has(value.id)) issues.push(`${label}_id_invalid:${String(value?.id)}`);
    else all.add(value.id);
  }
}
function validProvenance(value: unknown, revisionSha256: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const p = value as MoldMaterialShrinkProvenanceV1;
  return typeof p.materialId === 'string' && p.materialId.trim().length > 0
    && typeof p.sourceId === 'string' && p.sourceId.trim().length > 0
    && typeof p.sourceRef === 'string' && p.sourceRef.trim().length > 0
    && typeof p.capturedAt === 'string' && Number.isFinite(Date.parse(p.capturedAt))
    && p.revisionSha256 === revisionSha256 && SHA256.test(p.revisionSha256);
}

export function validateMoldToolingRelease(input: MoldToolingReleaseInputV1 | null | undefined): MoldToolingValidationResult {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') return { valid: false, issues: ['input_missing'] };
  if (input.schema !== MOLD_TOOLING_RELEASE_SCHEMA) issues.push('schema_invalid');
  if (input.units !== 'mm-deg') issues.push('canonical_units_required');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) issues.push('revision_invalid');
  const source = input.source;
  if (!source || typeof source !== 'object') issues.push('source_binding_missing');
  else {
    if (typeof source.partId !== 'string' || !source.partId.trim()) issues.push('source_part_id_invalid');
    if (typeof source.brepPath !== 'string' || !source.brepPath.trim() || source.brepPath.replaceAll('\\', '/').split('/').includes('..') || source.brepPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source.brepPath)) issues.push('source_brep_path_invalid');
    if (!Number.isSafeInteger(source.brepBytes) || source.brepBytes <= 0) issues.push('source_brep_bytes_invalid');
    if (!SHA256.test(source.brepSha256) || !SHA256.test(source.contentHash) || !SHA256.test(source.revisionSha256)) issues.push('source_hash_invalid');
    if (source.revision !== input.revision) issues.push('stale_source_revision');
  }
  if (!validProvenance(input.material, source?.revisionSha256 ?? '')) issues.push('material_provenance_invalid');
  const material = input.material;
  if (!material || !finite(material.shrinkAllowancePercent) || material.shrinkAllowancePercent < 0 || material.shrinkAllowancePercent > 10) issues.push('shrink_allowance_invalid');
  const pull = input.pullDirection;
  if (!pull || pull.frame !== 'global_cartesian' || pull.normalized !== true || !finite(pull.x) || !finite(pull.y) || !finite(pull.z) || Math.hypot(pull.x, pull.y, pull.z) <= EPSILON || !equal(Math.hypot(pull.x, pull.y, pull.z), 1)) issues.push('pull_direction_invalid');
  const faces = Array.isArray(input.faces) ? input.faces : [];
  const parting = Array.isArray(input.partingLine) ? input.partingLine : [];
  const cores = Array.isArray(input.coreCavities) ? input.coreCavities : [];
  const undercuts = Array.isArray(input.undercuts) ? input.undercuts : [];
  const sliders = Array.isArray(input.sliders) ? input.sliders : [];
  const ejectors = Array.isArray(input.ejectors) ? input.ejectors : [];
  const cooling = Array.isArray(input.cooling) ? input.cooling : [];
  const all = new Set<string>();
  for (const [value, label] of [[input.faces, 'faces'], [input.partingLine, 'parting_line'], [input.coreCavities, 'core_cavity'], [input.undercuts, 'undercut'], [input.sliders, 'slider'], [input.ejectors, 'ejector'], [input.cooling, 'cooling']] as const) if (!Array.isArray(value)) issues.push(`${label}_array_required`);
  register(faces, 'face', issues, all); register(parting, 'parting_segment', issues, all); register(cores, 'core_cavity', issues, all); register(undercuts, 'undercut', issues, all); register(sliders, 'slider', issues, all); register(ejectors, 'ejector', issues, all); register(cooling, 'cooling', issues, all);
  const faceIds = new Set(faces.map(item => item?.id).filter((id): id is string => typeof id === 'string'));
  const undercutIds = new Set(undercuts.map(item => item?.id).filter((id): id is string => typeof id === 'string'));
  const sliderIds = new Set(sliders.map(item => item?.id).filter((id): id is string => typeof id === 'string'));
  for (const face of faces) {
    if (!face || typeof face !== 'object') { issues.push('face_invalid'); continue; }
    if (face.partId !== source?.partId) issues.push(`face_part_ownership_invalid:${face.id}`);
    if (!finite(face.draftAngleDeg) || !finite(face.requiredDraftDeg) || face.draftAngleDeg < face.requiredDraftDeg) issues.push(`draft_invalid:${face.id}`);
    if (!finite(face.wallThicknessMm) || face.wallThicknessMm <= 0) issues.push(`wall_thickness_invalid:${face.id}`);
  }
  if (parting.length < 3) issues.push('parting_line_required');
  for (const segment of parting) {
    if (!segment || typeof segment !== 'object' || !point(segment.startMm) || !point(segment.endMm) || distance(segment.startMm, segment.endMm) <= EPSILON) issues.push(`parting_segment_invalid:${String(segment?.id)}`);
  }
  for (let index = 0; index < parting.length; index += 1) {
    const current = parting[index]; const next = parting[(index + 1) % parting.length];
    if (!current || !next || !point(current.endMm) || !point(next.startMm)) continue;
    if (distance(current.endMm, next.startMm) > EPSILON) issues.push(`parting_line_not_closed:${current.id}`);
  }
  const assignedFaces = new Set<string>();
  const splitKinds = new Set<string>();
  for (const split of cores) {
    if (!split || typeof split !== 'object' || (split.kind !== 'core' && split.kind !== 'cavity') || split.partId !== source?.partId || !Array.isArray(split.faceIds) || split.faceIds.length === 0) { issues.push(`core_cavity_invalid:${String(split?.id)}`); continue; }
    splitKinds.add(split.kind);
    for (const faceId of split.faceIds) {
      if (!faceIds.has(faceId) || assignedFaces.has(faceId)) issues.push(`core_cavity_face_ownership_invalid:${faceId}`);
      assignedFaces.add(faceId);
    }
  }
  if (!splitKinds.has('core') || !splitKinds.has('cavity')) issues.push('core_and_cavity_required');
  for (const id of faceIds) if (!assignedFaces.has(id)) issues.push(`core_cavity_face_missing:${id}`);
  const responseIds = new Set([...sliderIds]);
  for (const undercut of undercuts) {
    if (!undercut || typeof undercut !== 'object' || !faceIds.has(undercut.faceId) || !['slider', 'redesign'].includes(undercut.response)) issues.push(`undercut_invalid:${String(undercut?.id)}`);
    if (undercut?.response !== 'redesign' && (!undercut?.responseId || !responseIds.has(undercut.responseId))) issues.push(`undercut_response_missing:${String(undercut?.id)}`);
    if (undercut?.response === 'slider' && sliders.find(item => item?.id === undercut.responseId)?.undercutId !== undercut.id) issues.push(`undercut_slider_ownership_invalid:${String(undercut?.id)}`);
  }
  for (const slider of sliders) if (!slider || typeof slider !== 'object' || slider.partId !== source?.partId || !undercutIds.has(slider.undercutId) || !finite(slider.travelMm) || slider.travelMm <= 0) issues.push(`slider_invalid:${String(slider?.id)}`);
  for (const ejector of ejectors) if (!ejector || typeof ejector !== 'object' || ejector.partId !== source?.partId || !faceIds.has(ejector.faceId) || !point(ejector.positionMm) || !finite(ejector.diameterMm) || ejector.diameterMm <= 0) issues.push(`ejector_invalid:${String(ejector?.id)}`);
  for (const channel of cooling) {
    if (!channel || typeof channel !== 'object' || channel.partId !== source?.partId || !Array.isArray(channel.pointsMm) || channel.pointsMm.length < 2 || channel.pointsMm.some((item: unknown) => !point(item)) || !finite(channel.lengthMm) || channel.lengthMm <= 0) { issues.push(`cooling_invalid:${String(channel?.id)}`); continue; }
    let computedLength = 0;
    for (let index = 1; index < channel.pointsMm.length; index += 1) computedLength += distance(channel.pointsMm[index - 1]!, channel.pointsMm[index]!);
    if (!equal(channel.lengthMm, computedLength)) issues.push(`cooling_length_mismatch:${channel.id}`);
  }
  const output = input.output;
  if (!output || !['json', 'step', 'dxf'].includes(output.format)) issues.push('output_format_invalid');
  if (!output || output.revision !== input.revision) issues.push('stale_output_revision');
  if (!output || typeof output.content !== 'string' || !Number.isSafeInteger(output.bytes) || output.bytes <= 0 || !SHA256.test(output.sha256)) issues.push('output_binding_invalid');
  else { if (Buffer.byteLength(output.content, 'utf8') !== output.bytes) issues.push('output_bytes_mismatch'); if (hash(output.content) !== output.sha256) issues.push('output_hash_mismatch'); }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function verifyMoldToolingReadback(input: MoldToolingReleaseInputV1, readback: MoldToolingParserReadbackV1 | null | undefined): MoldToolingReadbackResult {
  const issues = validateMoldToolingRelease(input).issues;
  if (!readback) issues.push('parser_readback_missing');
  else {
    if (readback.parserId !== 'nexyfab.mold-tooling-independent-parser.v1' || !SHA256.test(readback.parserSourceSha256)) issues.push('parser_identity_invalid');
    if (readback.sourcePartId !== input.source.partId || readback.sourceBrepSha256 !== input.source.brepSha256 || readback.sourceContentHash !== input.source.contentHash) issues.push('readback_source_binding_mismatch');
    if (readback.sourceRevision !== input.revision) issues.push('readback_source_revision_mismatch');
    if (readback.outputSha256 !== input.output.sha256) issues.push('readback_output_hash_mismatch');
    const expected = [input.faces.map(item => item?.id), input.partingLine.map(item => item?.id), input.coreCavities.map(item => item?.id), input.undercuts.map(item => item?.id), input.sliders.map(item => item?.id), input.ejectors.map(item => item?.id), input.cooling.map(item => item?.id)];
    const actual = [readback.faceIds, readback.partingSegmentIds, readback.coreCavityIds, readback.undercutIds, readback.sliderIds, readback.ejectorIds, readback.coolingIds];
    const labels = ['face', 'parting_segment', 'core_cavity', 'undercut', 'slider', 'ejector', 'cooling'];
    actual.forEach((value, index) => { if (JSON.stringify(stringIds(value)) !== JSON.stringify(stringIds(expected[index]))) issues.push(`readback_${labels[index]}_identity_mismatch`); });
    if (!SHA256.test(readback.verificationSha256) || readback.verificationSha256 !== moldToolingReadbackVerificationSha256(readback)) issues.push('readback_verification_hash_mismatch');
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)] };
}

export function moldToolingReadbackVerificationSha256(
  readback: Omit<MoldToolingParserReadbackV1, 'verificationSha256'> | MoldToolingParserReadbackV1,
): string {
  return hash(JSON.stringify({
    parserId: readback.parserId,
    parserSourceSha256: readback.parserSourceSha256,
    sourcePartId: readback.sourcePartId,
    sourceBrepSha256: readback.sourceBrepSha256,
    sourceContentHash: readback.sourceContentHash,
    sourceRevision: readback.sourceRevision,
    outputSha256: readback.outputSha256,
    faceIds: [...readback.faceIds].sort(),
    partingSegmentIds: [...readback.partingSegmentIds].sort(),
    coreCavityIds: [...readback.coreCavityIds].sort(),
    undercutIds: [...readback.undercutIds].sort(),
    sliderIds: [...readback.sliderIds].sort(),
    ejectorIds: [...readback.ejectorIds].sort(),
    coolingIds: [...readback.coolingIds].sort(),
  }));
}

export function assessMoldToolingRelease(input: MoldToolingReleaseInputV1 | null | undefined, readback?: MoldToolingParserReadbackV1 | null): MoldToolingReleaseAssessment {
  const validation = input ? validateMoldToolingRelease(input) : { valid: false, issues: ['input_missing'] };
  const parser = input ? verifyMoldToolingReadback(input, readback) : { valid: false, issues: ['input_missing'] };
  return { schema: MOLD_TOOLING_RELEASE_SCHEMA, releaseReady: false, status: 'HOLD', parserVerified: parser.valid, blockers: [...new Set([...validation.issues, ...parser.issues, ...holdBoundary])], holdBoundary };
}
