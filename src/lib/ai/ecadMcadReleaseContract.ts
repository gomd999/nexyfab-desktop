import { createHash } from 'node:crypto';

export const ECAD_MCAD_RELEASE_SCHEMA = 'nexyfab.ecad-mcad-release.v1' as const;
export const ECAD_MCAD_EXCHANGE_SCHEMA = 'nexyfab.ecad-mcad-exchange.v1' as const;
const PARSER_ID = 'nexyfab.ecad-mcad-independent-parser.v1' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const EPSILON = 1e-8;

export interface EcadMcadSourceBindingV1 {
  schematicPath: string;
  schematicSha256: string;
  netlistPath: string;
  netlistSha256: string;
  boardModelPath: string;
  boardModelSha256: string;
  contentHash: string;
  revisionSha256: string;
  revision: number;
}

export interface EcadLibraryProvenanceV1 {
  librarySource: string;
  libraryRevision: string;
  partSource: string;
  footprintSource: string;
  capturedAt: string;
  revisionSha256: string;
}

export interface EcadPointMmV1 { xMm: number; yMm: number; }
export interface EcadComponentV1 {
  id: string;
  referenceDesignator: string;
  value: string;
  partNumber: string;
  footprintId: string;
  positionMm: EcadPointMmV1;
  rotationDeg: number;
  pinIds: readonly string[];
  maxVoltageV: number;
  maxCurrentA: number;
  provenance: EcadLibraryProvenanceV1;
}
export interface EcadPinV1 {
  id: string;
  componentId: string;
  number: string;
  netId: string;
  positionMm: EcadPointMmV1;
  electricalType: 'input' | 'output' | 'passive' | 'power';
}
export interface EcadNetV1 {
  id: string;
  name: string;
  pinIds: readonly string[];
  voltageV: number;
  currentA: number;
  kind: 'signal' | 'power' | 'ground';
  shortCircuit?: boolean;
}
export interface EcadFootprintV1 {
  id: string;
  componentId: string;
  widthMm: number;
  heightMm: number;
  positionMm: EcadPointMmV1;
  librarySource: string;
  libraryRevision: string;
}
export interface EcadBoardOutlineV1 { id: string; widthMm: number; heightMm: number; thicknessMm: number; enclosureClearanceMm: number; }
export interface EcadMountingHoleV1 { id: string; positionMm: EcadPointMmV1; diameterMm: number; }
export interface EcadKeepoutV1 { id: string; ownerId: string; xMm: number; yMm: number; widthMm: number; heightMm: number; }
export interface EcadConnectorV1 { id: string; componentId: string; footprintId: string; positionMm: EcadPointMmV1; clearanceMm: number; }
export interface EcadCableV1 { id: string; connectorAId: string; connectorBId: string; pinCount: number; voltageRatingV: number; currentRatingA: number; }

export interface EcadMcadOutputV1 { format: 'nexyfab-exchange-json'; targetFormat: 'ipc-2581' | 'step' | 'netlist'; revision: number; content: string; bytes: number; sha256: string; }
export interface EcadMcadExchangeV1 {
  schema: typeof ECAD_MCAD_EXCHANGE_SCHEMA;
  revision: number;
  sourceSchematicSha256: string;
  sourceNetlistSha256: string;
  sourceBoardModelSha256: string;
  sourceContentHash: string;
  componentIds: string[];
  pinIds: string[];
  netIds: string[];
  footprintIds: string[];
  mountingHoleIds: string[];
  keepoutIds: string[];
  connectorIds: string[];
  cableIds: string[];
}
export interface EcadMcadReleaseInputV1 {
  schema: typeof ECAD_MCAD_RELEASE_SCHEMA;
  units: 'mm-V-A';
  revision: number;
  source: EcadMcadSourceBindingV1;
  board: EcadBoardOutlineV1;
  components: readonly EcadComponentV1[];
  pins: readonly EcadPinV1[];
  nets: readonly EcadNetV1[];
  footprints: readonly EcadFootprintV1[];
  mountingHoles: readonly EcadMountingHoleV1[];
  keepouts: readonly EcadKeepoutV1[];
  connectors: readonly EcadConnectorV1[];
  cables: readonly EcadCableV1[];
  output: EcadMcadOutputV1;
}
export interface EcadMcadParserReadbackV1 {
  parserId: typeof PARSER_ID;
  parserSourceSha256: string;
  sourceSchematicSha256: string;
  sourceNetlistSha256: string;
  sourceBoardModelSha256: string;
  sourceContentHash: string;
  sourceRevision: number;
  outputSha256: string;
  componentIds: readonly string[];
  pinIds: readonly string[];
  netIds: readonly string[];
  footprintIds: readonly string[];
  mountingHoleIds: readonly string[];
  keepoutIds: readonly string[];
  connectorIds: readonly string[];
  cableIds: readonly string[];
  verificationSha256: string;
}
export interface EcadMcadValidationResult { valid: boolean; issues: string[]; }
export interface EcadMcadReleaseAssessment {
  schema: typeof ECAD_MCAD_RELEASE_SCHEMA;
  releaseReady: false;
  status: 'HOLD';
  /** True only for this contract's internal canonical exchange readback. */
  internalParserVerified: boolean;
  /** Independent evidence is never inferred from the internal parser. */
  independentAttestationVerified: boolean;
  /** @deprecated Use internalParserVerified; retained for API compatibility. */
  parserVerified: boolean;
  blockers: string[];
  holdBoundary: readonly string[];
}
export interface EcadMcadReadbackResult { valid: boolean; issues: string[]; }

const holdBoundary = [
  'native_ipc2581_step_netlist_parser_not_verified',
  'si_pi_emc_thermal_analysis_not_run',
  'erc_drc_authority_not_verified',
  'fabrication_and_assembly_receipt_not_available',
  'aoi_and_flying_probe_not_run',
  'certification_receipt_not_available',
] as const;
const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const positive = (value: unknown): value is number => finite(value) && value > 0;
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const equal = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(EPSILON, Math.max(Math.abs(a), Math.abs(b)) * 1e-9);
const arrays = <T>(value: unknown): readonly T[] => Array.isArray(value) ? value as readonly T[] : [];
const validPoint = (value: unknown): value is EcadPointMmV1 => Boolean(value && typeof value === 'object' && finite((value as EcadPointMmV1).xMm) && finite((value as EcadPointMmV1).yMm) && Math.abs((value as EcadPointMmV1).xMm) <= 1e9 && Math.abs((value as EcadPointMmV1).yMm) <= 1e9);
const inBoard = (point: EcadPointMmV1, board: EcadBoardOutlineV1, margin = 0): boolean => point.xMm >= margin && point.yMm >= margin && point.xMm <= board.widthMm - margin && point.yMm <= board.heightMm - margin;
const ids = (values: readonly { id?: unknown }[]): Set<string> => new Set(values.map(value => value?.id).filter((id): id is string => typeof id === 'string'));
const exactKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)));
const stableIdArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === 'string' && id.trim() === id && id.length > 0) && new Set(value).size === value.length;
function register(values: readonly { id?: unknown }[], label: string, issues: string[], all: Set<string>): void { for (const value of values) { const id = value?.id; if (typeof id !== 'string' || !id.trim() || all.has(id)) issues.push(`${label}_id_invalid:${String(id)}`); else all.add(id); } }
function provenanceValid(value: unknown, revisionSha256: string): value is EcadLibraryProvenanceV1 {
  if (!value || typeof value !== 'object') return false;
  const p = value as EcadLibraryProvenanceV1;
  return typeof p.librarySource === 'string' && !!p.librarySource.trim() && typeof p.libraryRevision === 'string' && !!p.libraryRevision.trim()
    && typeof p.partSource === 'string' && !!p.partSource.trim() && typeof p.footprintSource === 'string' && !!p.footprintSource.trim()
    && typeof p.capturedAt === 'string' && Number.isFinite(Date.parse(p.capturedAt)) && p.revisionSha256 === revisionSha256 && SHA256.test(p.revisionSha256);
}
function rectOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean { return ax < bx + bw - EPSILON && ax + aw > bx + EPSILON && ay < by + bh - EPSILON && ay + ah > by + EPSILON; }

export function validateEcadMcadRelease(input: EcadMcadReleaseInputV1 | null | undefined): EcadMcadValidationResult {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') return { valid: false, issues: ['input_missing'] };
  if (input.schema !== ECAD_MCAD_RELEASE_SCHEMA) issues.push('schema_invalid');
  if (input.units !== 'mm-V-A') issues.push('canonical_units_required');
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) issues.push('revision_invalid');
  const source = input.source;
  if (!source || typeof source !== 'object') issues.push('source_binding_missing');
  else {
    for (const [key, label] of [['schematicPath', 'schematic_path'], ['netlistPath', 'netlist_path'], ['boardModelPath', 'board_model_path']] as const) { const path = source[key]; if (typeof path !== 'string' || !path.trim() || path.replaceAll('\\', '/').split('/').includes('..') || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) issues.push(`${label}_invalid`); }
    if (![source.schematicSha256, source.netlistSha256, source.boardModelSha256, source.contentHash, source.revisionSha256].every(value => typeof value === 'string' && SHA256.test(value))) issues.push('source_hash_invalid');
    if (!Number.isSafeInteger(source.revision) || source.revision !== input.revision) issues.push('stale_source_revision');
  }
  const board = input.board;
  if (!board || typeof board !== 'object' || !positive(board.widthMm) || !positive(board.heightMm) || !positive(board.thicknessMm) || !nonnegative(board.enclosureClearanceMm)) issues.push('board_geometry_invalid');
  const components = arrays<EcadComponentV1>(input.components); const pins = arrays<EcadPinV1>(input.pins); const nets = arrays<EcadNetV1>(input.nets); const footprints = arrays<EcadFootprintV1>(input.footprints); const holes = arrays<EcadMountingHoleV1>(input.mountingHoles); const keepouts = arrays<EcadKeepoutV1>(input.keepouts); const connectors = arrays<EcadConnectorV1>(input.connectors); const cables = arrays<EcadCableV1>(input.cables);
  for (const [value, label] of [[input.components, 'components'], [input.pins, 'pins'], [input.nets, 'nets'], [input.footprints, 'footprints'], [input.mountingHoles, 'mounting_holes'], [input.keepouts, 'keepouts'], [input.connectors, 'connectors'], [input.cables, 'cables']] as const) if (!Array.isArray(value)) issues.push(`${label}_array_required`);
  const all = new Set<string>(); register(board ? [board] : [], 'board', issues, all); register(components, 'component', issues, all); register(pins, 'pin', issues, all); register(nets, 'net', issues, all); register(footprints, 'footprint', issues, all); register(holes, 'mounting_hole', issues, all); register(keepouts, 'keepout', issues, all); register(connectors, 'connector', issues, all); register(cables, 'cable', issues, all);
  const componentIds = ids(components); const pinIds = ids(pins); const netIds = ids(nets); const connectorIds = ids(connectors); const componentMap = new Map(components.map(item => [item?.id, item])); const footprintMap = new Map(footprints.map(item => [item?.id, item])); const pinMap = new Map(pins.map(item => [item?.id, item]));
  const refs = new Set<string>();
  for (const component of components) {
    const ownedFootprint = footprintMap.get(component?.footprintId);
    if (!component || typeof component !== 'object' || typeof component.referenceDesignator !== 'string' || !component.referenceDesignator.trim() || refs.has(component.referenceDesignator) || typeof component.value !== 'string' || !component.value.trim() || typeof component.partNumber !== 'string' || !component.partNumber.trim() || !ownedFootprint || ownedFootprint.componentId !== component.id || !validPoint(component.positionMm) || !finite(component.rotationDeg) || !positive(component.maxVoltageV) || !positive(component.maxCurrentA) || !provenanceValid(component.provenance, source?.revisionSha256 ?? '')) issues.push(`component_invalid:${component?.id}`); else refs.add(component.referenceDesignator);
    if (component && (new Set(component.pinIds).size !== component.pinIds.length || !arrays<string>(component.pinIds).every(id => pinIds.has(id) && pinMap.get(id)?.componentId === component.id))) issues.push(`component_pin_ownership_invalid:${component.id}`);
    if (component && board && validPoint(component.positionMm) && !inBoard(component.positionMm, board)) issues.push(`component_out_of_board:${component.id}`);
  }
  for (const footprint of footprints) {
    if (!footprint || typeof footprint !== 'object' || !componentIds.has(footprint.componentId) || !positive(footprint.widthMm) || !positive(footprint.heightMm) || !validPoint(footprint.positionMm) || typeof footprint.librarySource !== 'string' || !footprint.librarySource.trim() || typeof footprint.libraryRevision !== 'string' || !footprint.libraryRevision.trim()) issues.push(`footprint_invalid:${footprint?.id}`);
    const component = componentMap.get(footprint?.componentId); if (component && (!equal(footprint.positionMm.xMm, component.positionMm.xMm) || !equal(footprint.positionMm.yMm, component.positionMm.yMm))) issues.push(`footprint_component_placement_mismatch:${footprint.id}`);
    if (board && footprint && validPoint(footprint.positionMm) && (!inBoard(footprint.positionMm, board) || footprint.positionMm.xMm + footprint.widthMm > board.widthMm || footprint.positionMm.yMm + footprint.heightMm > board.heightMm)) issues.push(`footprint_out_of_board:${footprint.id}`);
  }
  for (const footprint of footprints) { const owner = components.find(component => component?.footprintId === footprint?.id); if (!owner) issues.push(`footprint_orphan_invalid:${footprint?.id}`); }
  for (const pin of pins) {
    if (!pin || typeof pin !== 'object' || !componentIds.has(pin.componentId) || !netIds.has(pin.netId) || typeof pin.number !== 'string' || !pin.number.trim() || !validPoint(pin.positionMm) || !['input', 'output', 'passive', 'power'].includes(pin.electricalType)) issues.push(`pin_invalid:${pin?.id}`);
    const component = componentMap.get(pin?.componentId); if (component && !arrays<string>(component.pinIds).includes(pin.id)) issues.push(`pin_component_ownership_invalid:${pin.id}`);
    if (board && pin && validPoint(pin.positionMm) && !inBoard(pin.positionMm, board)) issues.push(`pin_out_of_board:${pin.id}`);
  }
  for (const net of nets) {
    const pinSet = arrays<string>(net?.pinIds);
    const voltageValid = finite(net?.voltageV) && (net?.kind === 'ground' ? equal(net.voltageV, 0) : true);
    if (!net || typeof net !== 'object' || typeof net.name !== 'string' || !net.name.trim() || !voltageValid || !nonnegative(net.currentA) || !['signal', 'power', 'ground'].includes(net.kind) || net.shortCircuit === true || pinSet.length < 2 || new Set(pinSet).size !== pinSet.length || pinSet.some(id => !pinIds.has(id))) issues.push(`net_invalid_or_open:${net?.id}`);
    for (const pinId of pinSet) { const pin = pinMap.get(pinId); if (pin && pin.netId !== net.id) issues.push(`pin_net_consistency_invalid:${pinId}`); }
    for (const pin of pins) if (pin?.netId === net?.id && !pinSet.includes(pin.id)) issues.push(`net_pin_ownership_invalid:${pin.id}`);
    for (const pinId of pinSet) { const componentId = pinMap.get(pinId)?.componentId; const component = componentId ? componentMap.get(componentId) : undefined; if (component && (Math.abs(net.voltageV) > component.maxVoltageV + EPSILON || net.currentA > component.maxCurrentA + EPSILON)) issues.push(`component_rating_exceeded:${component.id}:${net.id}`); }
  }
  for (const hole of holes) if (!hole || typeof hole !== 'object' || !positive(hole.diameterMm) || !validPoint(hole.positionMm) || !board || !inBoard(hole.positionMm, board, hole.diameterMm / 2)) issues.push(`mounting_hole_invalid:${hole?.id}`);
  for (const keepout of keepouts) if (!keepout || typeof keepout !== 'object' || !(keepout.ownerId === board?.id || all.has(keepout.ownerId)) || !positive(keepout.widthMm) || !positive(keepout.heightMm) || !finite(keepout.xMm) || !finite(keepout.yMm) || !board || keepout.xMm < 0 || keepout.yMm < 0 || keepout.xMm + keepout.widthMm > board.widthMm || keepout.yMm + keepout.heightMm > board.heightMm) issues.push(`keepout_invalid:${keepout?.id}`);
  for (const component of components) { const footprint = footprintMap.get(component?.footprintId); for (const keepout of keepouts) if (footprint && keepout && rectOverlap(footprint.positionMm.xMm, footprint.positionMm.yMm, footprint.widthMm, footprint.heightMm, keepout.xMm, keepout.yMm, keepout.widthMm, keepout.heightMm)) issues.push(`keepout_clearance_violation:${component?.id}`); }
  for (const connector of connectors) {
    const component = componentMap.get(connector?.componentId); const footprint = footprintMap.get(connector?.footprintId);
    if (!connector || typeof connector !== 'object' || !component || !footprint || footprint.componentId !== connector.componentId || !validPoint(connector.positionMm) || !nonnegative(connector.clearanceMm) || !equal(connector.positionMm.xMm, footprint.positionMm.xMm) || !equal(connector.positionMm.yMm, footprint.positionMm.yMm) || !board || !inBoard(connector.positionMm, board, Math.max(connector.clearanceMm, board.enclosureClearanceMm))) issues.push(`connector_placement_or_clearance_invalid:${connector?.id}`);
  }
  for (const cable of cables) { const a = connectors.find(item => item?.id === cable?.connectorAId); const b = connectors.find(item => item?.id === cable?.connectorBId); const ca = a?.componentId ? componentMap.get(a.componentId) : undefined; const cb = b?.componentId ? componentMap.get(b.componentId) : undefined; const requiredVoltage = Math.max(ca?.maxVoltageV ?? 0, cb?.maxVoltageV ?? 0); const requiredCurrent = Math.max(ca?.maxCurrentA ?? 0, cb?.maxCurrentA ?? 0); const aPins = ca ? ca.pinIds.length : 0; const bPins = cb ? cb.pinIds.length : 0; if (!cable || typeof cable !== 'object' || !connectorIds.has(cable.connectorAId) || !connectorIds.has(cable.connectorBId) || cable.connectorAId === cable.connectorBId || !Number.isSafeInteger(cable.pinCount) || cable.pinCount <= 0 || cable.pinCount !== aPins || cable.pinCount !== bPins || !positive(cable.voltageRatingV) || !positive(cable.currentRatingA) || cable.voltageRatingV + EPSILON < requiredVoltage || cable.currentRatingA + EPSILON < requiredCurrent) issues.push(`cable_connectivity_invalid:${cable?.id}`); }
  const output = input.output;
  if (!output || typeof output !== 'object' || output.format !== 'nexyfab-exchange-json' || !['ipc-2581', 'step', 'netlist'].includes(output.targetFormat) || output.revision !== input.revision || typeof output.content !== 'string' || !Number.isSafeInteger(output.bytes) || output.bytes !== Buffer.byteLength(output.content, 'utf8') || !SHA256.test(output.sha256) || sha256(output.content) !== output.sha256) issues.push('output_binding_invalid');
  else { try { if (!verifyEcadMcadReadback(input, parseEcadMcadOutput(input)).valid) issues.push('output_readback_invalid'); } catch { issues.push('output_readback_invalid'); } }
  return { valid: issues.length === 0, issues };
}

function verificationHash(value: Omit<EcadMcadParserReadbackV1, 'verificationSha256'>): string { return sha256(JSON.stringify({ ...value, componentIds: [...value.componentIds].sort(), pinIds: [...value.pinIds].sort(), netIds: [...value.netIds].sort(), footprintIds: [...value.footprintIds].sort(), mountingHoleIds: [...value.mountingHoleIds].sort(), keepoutIds: [...value.keepoutIds].sort(), connectorIds: [...value.connectorIds].sort(), cableIds: [...value.cableIds].sort() })); }
export function parseEcadMcadOutput(input: EcadMcadReleaseInputV1): EcadMcadParserReadbackV1 {
  let parsed: unknown; try { parsed = JSON.parse(input.output.content) as unknown; } catch { throw new Error('ECAD_MCAD_OUTPUT_JSON_INVALID'); }
  const keys = ['schema', 'revision', 'sourceSchematicSha256', 'sourceNetlistSha256', 'sourceBoardModelSha256', 'sourceContentHash', 'componentIds', 'pinIds', 'netIds', 'footprintIds', 'mountingHoleIds', 'keepoutIds', 'connectorIds', 'cableIds'] as const;
  if (!exactKeys(parsed, keys) || parsed.schema !== ECAD_MCAD_EXCHANGE_SCHEMA || !Number.isSafeInteger(parsed.revision) || ![parsed.sourceSchematicSha256, parsed.sourceNetlistSha256, parsed.sourceBoardModelSha256, parsed.sourceContentHash].every(value => typeof value === 'string' && SHA256.test(value)) || !keys.slice(6).every(key => stableIdArray(parsed[key]))) throw new Error('ECAD_MCAD_OUTPUT_SCHEMA_INVALID');
  const exchange = parsed as unknown as EcadMcadExchangeV1;
  const unsigned = { parserId: PARSER_ID, parserSourceSha256: sha256(parseEcadMcadOutput.toString()), sourceSchematicSha256: exchange.sourceSchematicSha256, sourceNetlistSha256: exchange.sourceNetlistSha256, sourceBoardModelSha256: exchange.sourceBoardModelSha256, sourceContentHash: exchange.sourceContentHash, sourceRevision: exchange.revision, outputSha256: sha256(input.output.content), componentIds: exchange.componentIds, pinIds: exchange.pinIds, netIds: exchange.netIds, footprintIds: exchange.footprintIds, mountingHoleIds: exchange.mountingHoleIds, keepoutIds: exchange.keepoutIds, connectorIds: exchange.connectorIds, cableIds: exchange.cableIds } as const;
  return { ...unsigned, verificationSha256: verificationHash(unsigned) };
}
export function verifyEcadMcadReadback(input: EcadMcadReleaseInputV1, readback: EcadMcadParserReadbackV1 | null | undefined): EcadMcadReadbackResult {
  if (!readback || typeof readback !== 'object') return { valid: false, issues: ['readback_missing'] };
  const expected = { parserId: PARSER_ID, parserSourceSha256: sha256(parseEcadMcadOutput.toString()), sourceSchematicSha256: input.source.schematicSha256, sourceNetlistSha256: input.source.netlistSha256, sourceBoardModelSha256: input.source.boardModelSha256, sourceContentHash: input.source.contentHash, sourceRevision: input.revision, outputSha256: sha256(input.output.content), componentIds: input.components.map(item => item.id), pinIds: input.pins.map(item => item.id), netIds: input.nets.map(item => item.id), footprintIds: input.footprints.map(item => item.id), mountingHoleIds: input.mountingHoles.map(item => item.id), keepoutIds: input.keepouts.map(item => item.id), connectorIds: input.connectors.map(item => item.id), cableIds: input.cables.map(item => item.id) } as const; const issues: string[] = [];
  for (const key of ['parserId', 'parserSourceSha256', 'sourceSchematicSha256', 'sourceNetlistSha256', 'sourceBoardModelSha256', 'sourceContentHash', 'sourceRevision', 'outputSha256', 'componentIds', 'pinIds', 'netIds', 'footprintIds', 'mountingHoleIds', 'keepoutIds', 'connectorIds', 'cableIds'] as const) if (JSON.stringify(readback[key]) !== JSON.stringify(expected[key])) issues.push(`readback_${key}_mismatch`);
  const { verificationSha256, ...unsigned } = readback; if (verificationSha256 !== verificationHash(unsigned)) issues.push('readback_verification_hash_invalid');
  return { valid: issues.length === 0, issues };
}
export function assessEcadMcadRelease(input: EcadMcadReleaseInputV1, readback?: EcadMcadParserReadbackV1 | null): EcadMcadReleaseAssessment {
  const validation = validateEcadMcadRelease(input); const internalParserVerified = readback ? verifyEcadMcadReadback(input, readback).valid : false; const independentAttestationVerified = false; const blockers: string[] = [...holdBoundary];
  if (!validation.valid) blockers.unshift(...validation.issues); blockers.unshift('independent_parser_attestation_required');
  return { schema: ECAD_MCAD_RELEASE_SCHEMA, releaseReady: false, status: 'HOLD', internalParserVerified, independentAttestationVerified, parserVerified: false, blockers, holdBoundary };
}
