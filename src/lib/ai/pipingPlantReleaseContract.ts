import { createHash } from 'node:crypto';

export const PIPING_PLANT_RELEASE_SCHEMA = 'nexyfab.piping-plant-release.v1' as const;
export const PIPING_PLANT_EXCHANGE_SCHEMA = 'nexyfab.piping-plant-exchange.v1' as const;
const PARSER_ID = 'nexyfab.piping-plant-independent-parser.v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const EPSILON = 1e-8;

export interface PipingPlantSourceBindingV1 {
  projectId: string;
  modelId: string;
  brepPath: string;
  brepBytes: number;
  brepSha256: string;
  contentHash: string;
  revisionSha256: string;
  revision: number;
}

export interface PipingPlantProvenanceV1 {
  designCode: string;
  fluidId: string;
  fluidState: 'liquid' | 'gas' | 'two_phase';
  materialId: string;
  materialGrade: string;
  pipingClass: string;
  sourceId: string;
  sourceRef: string;
  capturedAt: string;
  revisionSha256: string;
}

export interface PipingPointMmV1 { xMm: number; yMm: number; zMm: number; }

export type PipingPortOwnerType = 'line' | 'equipment' | 'nozzle';
export interface PipingPortV1 {
  id: string;
  ownerType: PipingPortOwnerType;
  ownerId: string;
  nominalSizeMm: number;
  ratingMPa: number;
  positionMm: PipingPointMmV1;
}

export interface PipingLineV1 {
  id: string;
  fluidId: string;
  nominalSizeMm: number;
  schedule: string;
  ratingMPa: number;
  portIds: readonly string[];
  segmentIds: readonly string[];
  maximumSupportSpacingMm: number;
}

export interface PipingSegmentV1 {
  id: string;
  lineId: string;
  startPortId: string;
  endPortId: string;
  pointsMm: readonly PipingPointMmV1[];
  lengthMm: number;
  slopePercent: number;
  bendRadiusMm: number;
}

export type PipingFittingType = 'elbow' | 'tee' | 'reducer' | 'flange' | 'coupling';
export interface PipingFittingV1 {
  id: string;
  lineId: string;
  type: PipingFittingType;
  portIds: readonly string[];
  nominalSizeMm: number;
  ratingMPa: number;
}

export interface PipingValveV1 {
  id: string;
  lineId: string;
  portIds: readonly string[];
  nominalSizeMm: number;
  ratingMPa: number;
}

export interface PipingEquipmentV1 { id: string; equipmentType: string; portIds: readonly string[]; }
export interface PipingNozzleV1 {
  id: string;
  equipmentId: string;
  portId: string;
  nominalSizeMm: number;
  ratingMPa: number;
}

export interface PipingSupportV1 {
  id: string;
  segmentId: string;
  positionAlongMm: number;
  spacingMm: number;
  supportType: string;
}

export interface PipingWeldV1 {
  id: string;
  segmentId: string;
  lengthMm: number;
  process: string;
  wpsReference: string;
}

export type PipingBomItemType = 'line' | 'segment' | 'fitting' | 'valve' | 'equipment' | 'nozzle' | 'support' | 'weld';
export interface PipingBomLineV1 { id: string; itemId: string; itemType: PipingBomItemType; quantity: number; }
export interface PipingIsometricScheduleV1 {
  id: string;
  lineId: string;
  segmentIds: readonly string[];
  totalLengthMm: number;
}

export interface PipingPlantOutputV1 {
  format: 'json' | 'isometric' | 'step';
  revision: number;
  content: string;
  bytes: number;
  sha256: string;
}

export interface PipingPlantReleaseInputV1 {
  schema: typeof PIPING_PLANT_RELEASE_SCHEMA;
  units: 'mm-MPa-C';
  revision: number;
  source: PipingPlantSourceBindingV1;
  provenance: PipingPlantProvenanceV1;
  ports: readonly PipingPortV1[];
  lines: readonly PipingLineV1[];
  segments: readonly PipingSegmentV1[];
  fittings: readonly PipingFittingV1[];
  valves: readonly PipingValveV1[];
  equipment: readonly PipingEquipmentV1[];
  nozzles: readonly PipingNozzleV1[];
  supports: readonly PipingSupportV1[];
  welds: readonly PipingWeldV1[];
  bom: readonly PipingBomLineV1[];
  isometricSchedule: readonly PipingIsometricScheduleV1[];
  output: PipingPlantOutputV1;
}

export interface PipingPlantParserReadbackV1 {
  parserId: typeof PARSER_ID;
  parserSourceSha256: string;
  sourceProjectId: string;
  sourceModelId: string;
  sourceBrepSha256: string;
  sourceContentHash: string;
  sourceRevision: number;
  outputSha256: string;
  lineIds: readonly string[];
  segmentIds: readonly string[];
  fittingIds: readonly string[];
  valveIds: readonly string[];
  equipmentIds: readonly string[];
  nozzleIds: readonly string[];
  supportIds: readonly string[];
  weldIds: readonly string[];
  verificationSha256: string;
}

export interface PipingPlantValidationResult { valid: boolean; issues: string[]; }
export interface PipingPlantReleaseAssessment {
  schema: typeof PIPING_PLANT_RELEASE_SCHEMA;
  releaseReady: false;
  status: 'HOLD';
  parserVerified: boolean;
  blockers: string[];
  holdBoundary: readonly string[];
}
export interface PipingPlantReadbackResult { valid: boolean; issues: string[]; }

const holdBoundary = [
  'stress_flexibility_analysis_not_run',
  'surge_transient_analysis_not_run',
  'process_simulation_not_run',
  'design_code_authority_not_verified',
  'nde_and_hydrotest_not_run',
  'fabrication_receipt_not_available',
] as const;

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const equal = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(EPSILON, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);
const asArray = <T>(value: unknown): readonly T[] => Array.isArray(value) ? value as readonly T[] : [];
const validPoint = (value: unknown): value is PipingPointMmV1 => Boolean(value && typeof value === 'object'
  && finite((value as PipingPointMmV1).xMm) && finite((value as PipingPointMmV1).yMm) && finite((value as PipingPointMmV1).zMm)
  && Math.max(Math.abs((value as PipingPointMmV1).xMm), Math.abs((value as PipingPointMmV1).yMm), Math.abs((value as PipingPointMmV1).zMm)) <= 1e9);
const distance = (a: PipingPointMmV1, b: PipingPointMmV1): number => Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm, a.zMm - b.zMm);
const ids = (values: readonly { id?: unknown }[]): Set<string> => new Set(values.map(value => value?.id).filter((id): id is string => typeof id === 'string'));

function registerIds(values: readonly { id?: unknown }[], label: string, issues: string[], all: Set<string>): void {
  for (const value of values) {
    const id = value?.id;
    if (typeof id !== 'string' || !id.trim() || all.has(id)) issues.push(`${label}_id_invalid:${String(id)}`);
    else all.add(id);
  }
}

function validProvenance(value: unknown, revisionSha256: string): value is PipingPlantProvenanceV1 {
  if (!value || typeof value !== 'object') return false;
  const provenance = value as PipingPlantProvenanceV1;
  return typeof provenance.designCode === 'string' && provenance.designCode.trim().length > 0
    && typeof provenance.fluidId === 'string' && provenance.fluidId.trim().length > 0
    && ['liquid', 'gas', 'two_phase'].includes(provenance.fluidState)
    && typeof provenance.materialId === 'string' && provenance.materialId.trim().length > 0
    && typeof provenance.materialGrade === 'string' && provenance.materialGrade.trim().length > 0
    && typeof provenance.pipingClass === 'string' && provenance.pipingClass.trim().length > 0
    && typeof provenance.sourceId === 'string' && provenance.sourceId.trim().length > 0
    && typeof provenance.sourceRef === 'string' && provenance.sourceRef.trim().length > 0
    && typeof provenance.capturedAt === 'string' && Number.isFinite(Date.parse(provenance.capturedAt))
    && provenance.revisionSha256 === revisionSha256 && SHA256.test(provenance.revisionSha256);
}

function validSizeRating(item: { nominalSizeMm?: unknown; ratingMPa?: unknown }, expectedSize: number, expectedRating: number): boolean {
  return positive(item.nominalSizeMm) && positive(item.ratingMPa) && equal(item.nominalSizeMm, expectedSize) && equal(item.ratingMPa, expectedRating);
}

export function validatePipingPlantRelease(input: PipingPlantReleaseInputV1 | null | undefined): PipingPlantValidationResult {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') return { valid: false, issues: ['input_missing'] };
  if (input.schema !== PIPING_PLANT_RELEASE_SCHEMA) issues.push('schema_invalid');
  if (input.units !== 'mm-MPa-C') issues.push('canonical_units_required');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) issues.push('revision_invalid');
  const source = input.source;
  if (!source || typeof source !== 'object') issues.push('source_binding_missing');
  else {
    if (typeof source.projectId !== 'string' || !source.projectId.trim()) issues.push('source_project_id_invalid');
    if (typeof source.modelId !== 'string' || !source.modelId.trim()) issues.push('source_model_id_invalid');
    if (typeof source.brepPath !== 'string' || !source.brepPath.trim() || source.brepPath.replaceAll('\\', '/').split('/').includes('..') || source.brepPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(source.brepPath)) issues.push('source_brep_path_invalid');
    if (!Number.isSafeInteger(source.brepBytes) || source.brepBytes <= 0) issues.push('source_brep_bytes_invalid');
    if (!SHA256.test(source.brepSha256) || !SHA256.test(source.contentHash) || !SHA256.test(source.revisionSha256)) issues.push('source_hash_invalid');
    if (source.revision !== input.revision) issues.push('stale_source_revision');
  }
  if (!validProvenance(input.provenance, source?.revisionSha256 ?? '')) issues.push('provenance_invalid');
  const ports = asArray<PipingPortV1>(input.ports); const lines = asArray<PipingLineV1>(input.lines);
  const segments = asArray<PipingSegmentV1>(input.segments); const fittings = asArray<PipingFittingV1>(input.fittings);
  const valves = asArray<PipingValveV1>(input.valves); const equipment = asArray<PipingEquipmentV1>(input.equipment);
  const nozzles = asArray<PipingNozzleV1>(input.nozzles); const supports = asArray<PipingSupportV1>(input.supports);
  const welds = asArray<PipingWeldV1>(input.welds); const bom = asArray<PipingBomLineV1>(input.bom);
  const iso = asArray<PipingIsometricScheduleV1>(input.isometricSchedule);
  for (const [value, label] of [[input.ports, 'ports'], [input.lines, 'lines'], [input.segments, 'segments'], [input.fittings, 'fittings'], [input.valves, 'valves'], [input.equipment, 'equipment'], [input.nozzles, 'nozzles'], [input.supports, 'supports'], [input.welds, 'welds'], [input.bom, 'bom'], [input.isometricSchedule, 'isometric_schedule']] as const) if (!Array.isArray(value)) issues.push(`${label}_array_required`);
  const all = new Set<string>();
  registerIds(ports, 'port', issues, all); registerIds(lines, 'line', issues, all); registerIds(segments, 'segment', issues, all);
  registerIds(fittings, 'fitting', issues, all); registerIds(valves, 'valve', issues, all); registerIds(equipment, 'equipment', issues, all);
  registerIds(nozzles, 'nozzle', issues, all); registerIds(supports, 'support', issues, all); registerIds(welds, 'weld', issues, all);
  registerIds(bom, 'bom_line', issues, all); registerIds(iso, 'isometric_line', issues, all);
  const portMap = new Map(ports.map(item => [item?.id, item])); const lineMap = new Map(lines.map(item => [item?.id, item]));
  const segmentMap = new Map(segments.map(item => [item?.id, item])); const equipmentMap = new Map(equipment.map(item => [item?.id, item]));
  const lineIds = ids(lines); const segmentIds = ids(segments); const fittingIds = ids(fittings); const valveIds = ids(valves);
  const equipmentIds = ids(equipment); const nozzleIds = ids(nozzles); const supportIds = ids(supports); const weldIds = ids(welds);
  for (const port of ports) {
    const ownerExists = port?.ownerType === 'line' ? lineIds.has(port.ownerId) : port?.ownerType === 'equipment' ? equipmentIds.has(port.ownerId) : port?.ownerType === 'nozzle' && nozzleIds.has(port.ownerId);
    if (!port || typeof port !== 'object' || !['line', 'equipment', 'nozzle'].includes(port.ownerType) || !ownerExists
      || !positive(port.nominalSizeMm) || !positive(port.ratingMPa) || !validPoint(port.positionMm)) issues.push(`port_invalid:${port?.id}`);
  }
  for (const line of lines) {
    if (!line || typeof line !== 'object' || !lineIds.has(line.id) || typeof line.fluidId !== 'string' || !line.fluidId.trim() || !positive(line.nominalSizeMm) || typeof line.schedule !== 'string' || !line.schedule.trim() || !positive(line.ratingMPa) || !positive(line.maximumSupportSpacingMm)) { issues.push(`line_invalid:${line?.id}`); continue; }
    if (line.fluidId !== input.provenance?.fluidId) issues.push(`line_fluid_provenance_mismatch:${line.id}`);
    const ownedSegments = asArray<string>(line.segmentIds);
    if (ownedSegments.length === 0 || ownedSegments.some(id => !segmentIds.has(id) || segmentMap.get(id)?.lineId !== line.id)) issues.push(`line_segment_ownership_invalid:${line.id}`);
    if (asArray<string>(line.portIds).some(id => !portMap.has(id))) issues.push(`line_port_ownership_invalid:${line.id}`);
    const graph = new Map<string, Set<string>>();
    for (const segmentId of ownedSegments) {
      const segment = segmentMap.get(segmentId); if (!segment) continue;
      for (const endpoint of [segment.startPortId, segment.endPortId]) { if (!portMap.has(endpoint)) issues.push(`segment_port_dangling:${segment.id}`); if (!graph.has(endpoint)) graph.set(endpoint, new Set()); }
      if (portMap.has(segment.startPortId) && portMap.has(segment.endPortId)) { graph.get(segment.startPortId)!.add(segment.endPortId); graph.get(segment.endPortId)!.add(segment.startPortId); }
    }
    const first = graph.keys().next().value as string | undefined; const seen = new Set<string>(); const todo = first ? [first] : [];
    while (todo.length) { const node = todo.pop()!; if (seen.has(node)) continue; seen.add(node); todo.push(...(graph.get(node) ?? [])); }
    if (graph.size > 0 && seen.size !== graph.size) issues.push(`line_disconnected:${line.id}`);
  }
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object' || !lineIds.has(segment.lineId) || !portMap.has(segment.startPortId) || !portMap.has(segment.endPortId)
      || segment.startPortId === segment.endPortId || !Array.isArray(segment.pointsMm) || segment.pointsMm.length < 2 || segment.pointsMm.some((pointValue: unknown) => !validPoint(pointValue))
      || !positive(segment.lengthMm) || !finite(segment.slopePercent) || Math.abs(segment.slopePercent) > 1000 || !positive(segment.bendRadiusMm)) { issues.push(`segment_invalid:${segment?.id}`); continue; }
    const points = segment.pointsMm; let length = 0;
    for (let index = 1; index < points.length; index += 1) { const a = points[index - 1]!, b = points[index]!; if (validPoint(a) && validPoint(b)) { const part = distance(a, b); if (part <= EPSILON) issues.push(`segment_zero_length:${segment.id}`); length += part; } }
    if (!equal(segment.lengthMm, length)) issues.push(`segment_length_mismatch:${segment.id}`);
    const owningLine = lineMap.get(segment.lineId);
    if (!owningLine?.segmentIds.includes(segment.id) || !owningLine.portIds.includes(segment.startPortId) || !owningLine.portIds.includes(segment.endPortId)) issues.push(`segment_line_reverse_ownership_invalid:${segment.id}`);
    const start = portMap.get(segment.startPortId); const end = portMap.get(segment.endPortId);
    if ((start && !equal(distance(start.positionMm, points[0]!), 0)) || (end && !equal(distance(end.positionMm, points[points.length - 1]!), 0))) issues.push(`segment_port_geometry_mismatch:${segment.id}`);
    const firstPoint = points[0]; const lastPoint = points[points.length - 1];
    if (firstPoint && lastPoint) {
      const horizontalLength = Math.hypot(lastPoint.xMm - firstPoint.xMm, lastPoint.yMm - firstPoint.yMm);
      const expectedSlope = horizontalLength <= EPSILON ? Number.NaN : ((lastPoint.zMm - firstPoint.zMm) / horizontalLength) * 100;
      if (!finite(expectedSlope) || !equal(segment.slopePercent, expectedSlope)) issues.push(`segment_slope_mismatch:${segment.id}`);
    }
  }
  const checkLineComponent = (item: { id?: string; lineId?: string; portIds?: readonly string[]; nominalSizeMm?: number; ratingMPa?: number }, label: string): void => {
    const line = item && typeof item === 'object' && typeof item.lineId === 'string' ? lineMap.get(item.lineId) : undefined;
    if (!item || typeof item !== 'object' || !line || !asArray<string>(item.portIds).length || asArray<string>(item.portIds).some(portId => !portMap.has(portId)) || !validSizeRating(item, line?.nominalSizeMm ?? 0, line?.ratingMPa ?? 0)) issues.push(`${label}_ownership_or_rating_invalid:${item?.id}`);
    for (const portId of asArray<string>(item?.portIds)) { const port = portMap.get(portId); if (port && line && !validSizeRating(port, line.nominalSizeMm, line.ratingMPa)) issues.push(`${label}_port_size_rating_invalid:${item?.id}`); }
  };
  fittings.forEach(item => checkLineComponent(item, 'fitting')); valves.forEach(item => checkLineComponent(item, 'valve'));
  for (const item of equipment) if (!item || typeof item !== 'object' || typeof item.equipmentType !== 'string' || !item.equipmentType.trim() || asArray<string>(item.portIds).some(portId => !portMap.has(portId))) issues.push(`equipment_invalid:${item?.id}`);
  for (const nozzle of nozzles) {
    const owner = equipmentMap.get(nozzle?.equipmentId); const port = portMap.get(nozzle?.portId);
    if (!owner || !port || !asArray<string>(owner?.portIds).includes(nozzle?.portId) || !validSizeRating(nozzle, port?.nominalSizeMm ?? 0, port?.ratingMPa ?? 0)) issues.push(`nozzle_ownership_or_rating_invalid:${nozzle?.id}`);
  }
  for (const support of supports) {
    const segment = segmentMap.get(support?.segmentId);
    if (!segment || !finite(support.positionAlongMm) || support.positionAlongMm < 0 || support.positionAlongMm > segment.lengthMm || !positive(support.spacingMm) || typeof support.supportType !== 'string' || !support.supportType.trim() || support.spacingMm > (lineMap.get(segment.lineId)?.maximumSupportSpacingMm ?? 0)) issues.push(`support_invalid:${support?.id}`);
  }
  for (const weld of welds) if (!segmentMap.has(weld?.segmentId) || !positive(weld?.lengthMm) || typeof weld.wpsReference !== 'string' || !weld.wpsReference.trim() || typeof weld.process !== 'string' || !weld.process.trim() || weld.lengthMm > (segmentMap.get(weld.segmentId)?.lengthMm ?? 0)) issues.push(`weld_invalid:${weld?.id}`);
  const itemTypeIds: Record<PipingBomItemType, Set<string>> = { line: lineIds, segment: segmentIds, fitting: fittingIds, valve: valveIds, equipment: equipmentIds, nozzle: nozzleIds, support: supportIds, weld: weldIds };
  const bomSeen = new Set<string>();
  for (const item of bom) {
    const typeIds = item && typeof item === 'object' ? itemTypeIds[item.itemType] : undefined;
    if (!item || !typeIds || !typeIds.has(item.itemId) || !Number.isSafeInteger(item.quantity) || item.quantity <= 0 || bomSeen.has(item.itemId)) issues.push(`bom_invalid:${item?.id}`);
    else bomSeen.add(item.itemId);
  }
  for (const [type, typeIds] of Object.entries(itemTypeIds) as [PipingBomItemType, Set<string>][]) for (const itemId of typeIds) if (!bom.some(item => item?.itemType === type && item.itemId === itemId)) issues.push(`bom_missing:${itemId}`);
  for (const schedule of iso) { const line = lineMap.get(schedule?.lineId); const scheduleSegments = asArray<string>(schedule?.segmentIds); const expected = scheduleSegments.reduce((sum, id) => sum + (segmentMap.get(id)?.lengthMm ?? 0), 0); if (!line || scheduleSegments.length !== line.segmentIds.length || scheduleSegments.some(id => !line.segmentIds.includes(id)) || !positive(schedule.totalLengthMm) || !equal(schedule.totalLengthMm, expected)) issues.push(`isometric_schedule_invalid:${schedule?.id}`); }
  const output = input.output;
  if (!output || typeof output !== 'object' || !['json', 'isometric', 'step'].includes(output.format) || output.revision !== input.revision || typeof output.content !== 'string' || !Number.isSafeInteger(output.bytes) || output.bytes !== Buffer.byteLength(output.content, 'utf8') || !SHA256.test(output.sha256) || sha256(output.content) !== output.sha256) issues.push('output_binding_invalid');
  return { valid: issues.length === 0, issues };
}

function readbackVerification(readback: Omit<PipingPlantParserReadbackV1, 'verificationSha256'>): string {
  return sha256(JSON.stringify({ ...readback, lineIds: [...readback.lineIds].sort(), segmentIds: [...readback.segmentIds].sort(), fittingIds: [...readback.fittingIds].sort(), valveIds: [...readback.valveIds].sort(), equipmentIds: [...readback.equipmentIds].sort(), nozzleIds: [...readback.nozzleIds].sort(), supportIds: [...readback.supportIds].sort(), weldIds: [...readback.weldIds].sort() }));
}

export function parsePipingPlantOutput(input: PipingPlantReleaseInputV1): PipingPlantParserReadbackV1 {
  const output = input.output;
  if (output.format !== 'json') throw new Error('PIPING_PLANT_INDEPENDENT_PARSER_UNSUPPORTED_FORMAT');
  let parsed: unknown;
  try { parsed = JSON.parse(output.content) as unknown; } catch { throw new Error('PIPING_PLANT_OUTPUT_JSON_INVALID'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('PIPING_PLANT_OUTPUT_SCHEMA_INVALID');
  const exchange = parsed as {
    schema?: unknown;
    source?: { projectId?: unknown; modelId?: unknown; brepSha256?: unknown; contentHash?: unknown };
    revision?: unknown;
    ids?: Record<string, unknown>;
  };
  const parsedIds = (key: string): string[] => {
    const value = exchange.ids?.[key];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`PIPING_PLANT_OUTPUT_IDS_INVALID:${key}`);
    return value;
  };
  if (exchange.schema !== PIPING_PLANT_EXCHANGE_SCHEMA) throw new Error('PIPING_PLANT_OUTPUT_SCHEMA_INVALID');
  const readback = {
    parserId: PARSER_ID,
    parserSourceSha256: sha256(parsePipingPlantOutput.toString()),
    sourceProjectId: String(exchange.source?.projectId ?? ''),
    sourceModelId: String(exchange.source?.modelId ?? ''),
    sourceBrepSha256: String(exchange.source?.brepSha256 ?? ''),
    sourceContentHash: String(exchange.source?.contentHash ?? ''),
    sourceRevision: Number(exchange.revision),
    outputSha256: sha256(output.content),
    lineIds: parsedIds('lines'), segmentIds: parsedIds('segments'), fittingIds: parsedIds('fittings'),
    valveIds: parsedIds('valves'), equipmentIds: parsedIds('equipment'), nozzleIds: parsedIds('nozzles'),
    supportIds: parsedIds('supports'), weldIds: parsedIds('welds'),
  } as const;
  return { ...readback, verificationSha256: readbackVerification(readback) };
}

export function verifyPipingPlantReadback(input: PipingPlantReleaseInputV1, readback: PipingPlantParserReadbackV1 | null | undefined): PipingPlantReadbackResult {
  const issues: string[] = [];
  if (!readback || typeof readback !== 'object') return { valid: false, issues: ['readback_missing'] };
  let expected: PipingPlantParserReadbackV1;
  try { expected = parsePipingPlantOutput(input); } catch { return { valid: false, issues: ['independent_parser_failed'] }; }
  const authoritative = {
    sourceProjectId: input.source.projectId,
    sourceModelId: input.source.modelId,
    sourceBrepSha256: input.source.brepSha256,
    sourceContentHash: input.source.contentHash,
    sourceRevision: input.revision,
    outputSha256: input.output.sha256,
    lineIds: input.lines.map(item => item.id),
    segmentIds: input.segments.map(item => item.id),
    fittingIds: input.fittings.map(item => item.id),
    valveIds: input.valves.map(item => item.id),
    equipmentIds: input.equipment.map(item => item.id),
    nozzleIds: input.nozzles.map(item => item.id),
    supportIds: input.supports.map(item => item.id),
    weldIds: input.welds.map(item => item.id),
  };
  for (const key of Object.keys(authoritative) as Array<keyof typeof authoritative>) if (JSON.stringify(expected[key]) !== JSON.stringify(authoritative[key])) issues.push(`readback_${key}_mismatch`);
  for (const key of ['parserId', 'parserSourceSha256', 'sourceProjectId', 'sourceModelId', 'sourceBrepSha256', 'sourceContentHash', 'sourceRevision', 'outputSha256', 'lineIds', 'segmentIds', 'fittingIds', 'valveIds', 'equipmentIds', 'nozzleIds', 'supportIds', 'weldIds'] as const) if (JSON.stringify(readback[key]) !== JSON.stringify(expected[key])) issues.push(`readback_${key}_mismatch`);
  const { verificationSha256, ...unsignedReadback } = readback;
  if (verificationSha256 !== readbackVerification(unsignedReadback)) issues.push('readback_verification_hash_invalid');
  return { valid: issues.length === 0, issues };
}

export function assessPipingPlantRelease(input: PipingPlantReleaseInputV1, readback?: PipingPlantParserReadbackV1 | null): PipingPlantReleaseAssessment {
  const validation = validatePipingPlantRelease(input);
  const parser = readback ? verifyPipingPlantReadback(input, readback).valid : false;
  const blockers: string[] = [...holdBoundary];
  if (!validation.valid) blockers.unshift(...validation.issues);
  if (!parser) blockers.unshift('independent_parser_verification_failed');
  return { schema: PIPING_PLANT_RELEASE_SCHEMA, releaseReady: false, status: 'HOLD', parserVerified: parser, blockers, holdBoundary };
}
