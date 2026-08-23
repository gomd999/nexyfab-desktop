import { createHash, verify as verifySignature } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  validateEcadMcadRelease,
  verifyEcadMcadReadback,
  type EcadMcadParserReadbackV1,
  type EcadMcadReleaseInputV1,
} from './ecadMcadReleaseContract';

export const ECAD_MCAD_COMMERCIAL_EVIDENCE_SCHEMA = 'nexyfab.ecad-mcad-commercial-evidence.v1' as const;
export const ECAD_MCAD_REVIEW_ROLES = ['domain_reviewer', 'independent_reviewer', 'manufacturing_reviewer'] as const;
export type EcadMcadReviewRole = (typeof ECAD_MCAD_REVIEW_ROLES)[number];
export const ECAD_MCAD_REQUIRED_AXES = ['canonical_connectivity', 'erc_drc', 'step_roundtrip', 'wiring_manufacturing', 'fabrication_assembly'] as const;
const SHA256 = /^[a-f0-9]{64}$/i;
const MAX_FRESHNESS_MS = 90 * 24 * 60 * 60 * 1000;

export type CommercialArtifactKind = 'schematic' | 'netlist' | 'board_model' | 'kicad' | 'native_netlist' | 'ipc2581' | 'step' | 'occt' | 'gerber' | 'odbpp' | 'bom' | 'pnp' | 'erc' | 'drc' | 'tolerance' | 'datasheet' | 'continuity' | 'isolation' | 'hipot' | 'connector' | 'crimp' | 'aoi' | 'flying_probe' | 'parser_binary' | 'parser_source';
export type CommercialArtifact = { artifactId: string; relativePath: string; kind: CommercialArtifactKind; bytes: number; sha256: string; revision: number; buildId: string };

export type NativeParserReceipt = {
  receiptId: string;
  format: 'kicad' | 'netlist' | 'ipc-2581' | 'step' | 'occt';
  artifactId: string;
  parserId: string;
  parserBinarySha256: string;
  parserSourceSha256: string;
  artifactSha256: string;
  revision: number;
  buildId: string;
  targetHash: string;
  issuedAt: string;
  expiresAt: string;
  trustedSigner: { keyId: string; publicKeyPem: string; signatureBase64: string };
};

export type CanonicalConnectivityEvidence = {
  refdesPadPinNet: readonly { referenceDesignator: string; pad: string; pinId: string; netName: string }[];
  connectorCavityWire: readonly { connectorId: string; cableId: string; cavityPinIds: readonly string[]; wireEndpointPinIds: readonly string[] }[];
};

export type SignedWaiver = { waiverId: string; issueId: string; reason: string; targetHash: string; approvedByKeyId: string; approvedByRole: EcadMcadReviewRole; signatureBase64: string; publicKeyPem: string };
export type ErcDrcEvidence = { kind: 'erc' | 'drc'; rulesetId: string; rulesetSha256: string; inputArtifactId: string; outputArtifactId: string; status: 'passed'; waiver?: SignedWaiver };

export type StepRoundtripEvidence = { inputArtifactId: string; outputArtifactId: string; toleranceArtifactId: string; passed: true; toleranceMm: number; outline: { widthMm: number; heightMm: number; thicknessMm: number }; cutoutIds: readonly string[]; holeIds: readonly string[]; componentIds: readonly string[]; connectorIds: readonly string[]; targetHash: string; revision: number; buildId: string };

export type WireManufacturingEvidence = { wireId: string; cableId: string; gauge: string; deratingFactor: number; lengthMm: number; routeId: string; bendRadiusMm: number; contactIds: readonly string[]; crimpId: string; datasheetArtifactId: string; continuityArtifactId: string; isolationArtifactId: string; hipotArtifactId: string; continuity: 'passed'; isolation: 'passed'; hipot: 'passed' };
export type FabricationAssemblyEvidence = { gerberArtifactId: string; odbppArtifactId: string; ipc2581ArtifactId: string; bomArtifactId: string; pnpArtifactId: string; lot: string; serial: string; aoiArtifactId: string; flyingProbeArtifactId: string };

export type CommercialReviewerAttestation = { attestationId: string; role: EcadMcadReviewRole; reviewerId: string; keyId: string; publicKeyPem: string; signatureBase64: string; targetHash: string; revision: number; buildId: string; issuedAt: string; expiresAt: string; axes: readonly string[]; evidenceIds: readonly string[] };
export type EcadMcadTrustedSignerRole = EcadMcadReviewRole | 'native_parser';
export type EcadMcadTrustedSigner = { publicKeyPem: string; roles: readonly EcadMcadTrustedSignerRole[] };

export type EcadMcadCommercialQualificationInput = {
  allowedRoot: string;
  buildId: string;
  release: EcadMcadReleaseInputV1;
  readback: EcadMcadParserReadbackV1 | null | undefined;
  artifacts: readonly CommercialArtifact[];
  nativeParsers: readonly NativeParserReceipt[];
  canonicalConnectivity: CanonicalConnectivityEvidence;
  ercDrc: readonly ErcDrcEvidence[];
  stepRoundtrip: StepRoundtripEvidence;
  wires: readonly WireManufacturingEvidence[];
  fabrication: FabricationAssemblyEvidence;
  attestations: readonly CommercialReviewerAttestation[];
  trustedSigners: Readonly<Record<string, EcadMcadTrustedSigner>>;
  now?: string;
  maxFreshnessMs?: number;
};

export type EcadMcadCommercialQualificationResult = { schema: typeof ECAD_MCAD_COMMERCIAL_EVIDENCE_SCHEMA; status: 'QUALIFIED' | 'HOLD'; qualified: boolean; targetHash: string; revision: number; buildId: string; internalValidation: { valid: boolean; issues: readonly string[] }; internalReadback: { valid: boolean; issues: readonly string[] }; artifacts: { valid: boolean; issues: readonly string[] }; nativeParsers: { valid: boolean; issues: readonly string[] }; reviewers: { valid: boolean; issues: readonly string[] }; evidence: { valid: boolean; issues: readonly string[] }; blockers: readonly string[] };

function canonicalNormalized(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('canonical_nonfinite'); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalNormalized).join(',')}]`;
  if (typeof value === 'object') { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalNormalized(record[key])}`).join(',')}}`; }
  throw new Error('canonical_unsupported');
}
function canonical(value: unknown): string { const serialized = JSON.stringify(value); if (serialized === undefined) throw new Error('canonical_unsupported'); return canonicalNormalized(JSON.parse(serialized) as unknown); }

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const validHash = (value: unknown): value is string => typeof value === 'string' && SHA256.test(value);
const dateMs = (value: unknown): number | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const unique = (values: readonly string[]): boolean => values.length === new Set(values).size;
const fresh = (issuedAt: unknown, expiresAt: unknown, now: number, max: number): boolean => { const issued = dateMs(issuedAt); const expires = dateMs(expiresAt); return issued !== null && expires !== null && issued <= now && now <= expires && expires > issued && expires - issued <= max; };

function signatureMaterial(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value }; delete copy.signatureBase64; delete copy.publicKeyPem; return copy;
}
function targetMaterial(value: Record<string, unknown>): Record<string, unknown> {
  const copy = signatureMaterial(value); delete copy.targetHash; return copy;
}

export function canonicalEcadCommercialTarget(input: Pick<EcadMcadCommercialQualificationInput, 'buildId' | 'release' | 'artifacts' | 'nativeParsers' | 'canonicalConnectivity' | 'ercDrc' | 'stepRoundtrip' | 'wires' | 'fabrication'>): string {
  const parserMaterial = input.nativeParsers.map(parser => targetMaterial({ ...parser, trustedSigner: { keyId: parser.trustedSigner.keyId } })).sort((a, b) => String(a.receiptId).localeCompare(String(b.receiptId)));
  const ercMaterial = input.ercDrc.map(item => ({ ...item, waiver: item.waiver ? targetMaterial({ ...item.waiver }) : undefined })).sort((a, b) => a.kind.localeCompare(b.kind));
  return canonical({ schema: ECAD_MCAD_COMMERCIAL_EVIDENCE_SCHEMA, track: 'ecad_mcad', buildId: input.buildId, release: input.release, artifacts: [...input.artifacts].sort((a, b) => a.artifactId.localeCompare(b.artifactId)), nativeParsers: parserMaterial, canonicalConnectivity: input.canonicalConnectivity, ercDrc: ercMaterial, stepRoundtrip: targetMaterial({ ...input.stepRoundtrip }), wires: input.wires, fabrication: input.fabrication });
}

export function hashEcadMcadCommercialTarget(input: Pick<EcadMcadCommercialQualificationInput, 'buildId' | 'release' | 'artifacts' | 'nativeParsers' | 'canonicalConnectivity' | 'ercDrc' | 'stepRoundtrip' | 'wires' | 'fabrication'>): string { return sha256(canonicalEcadCommercialTarget(input)); }

function attestationPayload(value: CommercialReviewerAttestation): string { return canonical({ schema: ECAD_MCAD_COMMERCIAL_EVIDENCE_SCHEMA, purpose: 'reviewer-attestation', ...signatureMaterial({ ...value }) }); }
export function canonicalEcadCommercialAttestationPayload(value: CommercialReviewerAttestation): string { return attestationPayload(value); }
export function canonicalEcadNativeParserPayload(value: NativeParserReceipt): string { return canonical({ schema: ECAD_MCAD_COMMERCIAL_EVIDENCE_SCHEMA, purpose: 'native-parser-receipt', ...signatureMaterial({ ...value, trustedSigner: { keyId: value.trustedSigner.keyId } }) }); }
export function canonicalEcadErcDrcWaiverPayload(value: SignedWaiver): string { return canonical({ schema: ECAD_MCAD_COMMERCIAL_EVIDENCE_SCHEMA, purpose: 'erc-drc-waiver', ...signatureMaterial({ ...value }) }); }

function pathInside(root: string, relative: string): string {
  if (!validId(relative) || relative.includes('\0') || path.isAbsolute(relative) || /^[A-Za-z]:[\\/]/.test(relative)) throw new Error('artifact_path_invalid');
  const normalized = relative.replaceAll('\\', '/'); const parts = normalized.split('/'); if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('artifact_path_traversal');
  const absolute = path.resolve(root, ...parts); const rel = path.relative(root, absolute); if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('artifact_path_outside_root'); return absolute;
}

function isLink(stat: fs.Stats): boolean { return stat.isSymbolicLink() || (stat as fs.Stats & { reparsePoint?: boolean; isJunction?: boolean }).reparsePoint === true || (stat as fs.Stats & { isJunction?: boolean }).isJunction === true; }
function resolveArtifact(root: string, rootReal: string, relative: string): string {
  const absolute = pathInside(root, relative); let current = root; for (const part of relative.replaceAll('\\', '/').split('/')) { current = path.join(current, part); const stat = fs.lstatSync(current); if (isLink(stat)) throw new Error('artifact_symlink_or_junction'); const real = fs.realpathSync.native(current); const rel = path.relative(rootReal, real); if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('artifact_realpath_escape'); } return absolute;
}

function verifyArtifacts(input: EcadMcadCommercialQualificationInput, revision: number): { issues: string[]; map: Map<string, CommercialArtifact> } {
  const issues: string[] = []; const map = new Map<string, CommercialArtifact>(); let root = ''; let rootReal = '';
  try { const rootStat = fs.lstatSync(input.allowedRoot); if (!rootStat.isDirectory() || isLink(rootStat)) throw new Error('allowed_root_invalid'); root = path.resolve(input.allowedRoot); rootReal = fs.realpathSync.native(root); } catch (error) { return { issues: [`allowed_root_invalid:${String(error instanceof Error ? error.message : error)}`], map }; }
  for (const artifact of input.artifacts) {
    if (!validId(artifact.artifactId) || map.has(artifact.artifactId)) issues.push(`artifact_id_invalid_or_duplicate:${artifact?.artifactId}`);
    if (!validHash(artifact.sha256) || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.revision !== revision || artifact.buildId !== input.buildId) issues.push(`artifact_metadata_invalid:${artifact?.artifactId}`);
    try { const absolute = resolveArtifact(root, rootReal, artifact.relativePath); const stat = fs.statSync(absolute); if (!stat.isFile()) throw new Error('artifact_not_regular_file'); const bytes = fs.readFileSync(absolute); if (bytes.length !== artifact.bytes || sha256(bytes.toString('utf8')) !== artifact.sha256) { const rawHash = createHash('sha256').update(bytes).digest('hex'); if (bytes.length !== artifact.bytes || rawHash !== artifact.sha256) throw new Error('artifact_bytes_or_sha_mismatch'); } } catch (error) { issues.push(`artifact_unreadable_or_mismatch:${artifact?.artifactId}:${String(error instanceof Error ? error.message : error)}`); }
    map.set(artifact.artifactId, artifact);
  }
  const source = input.release.source; const requiredSources: Array<[keyof Pick<typeof source, 'schematicPath' | 'netlistPath' | 'boardModelPath'>, CommercialArtifactKind, string]> = [['schematicPath', 'schematic', source.schematicSha256], ['netlistPath', 'netlist', source.netlistSha256], ['boardModelPath', 'board_model', source.boardModelSha256]];
  for (const [field, kind, expectedSha] of requiredSources) { const matches = input.artifacts.filter(artifact => artifact.relativePath === source[field] && artifact.kind === kind && artifact.sha256 === expectedSha); if (matches.length !== 1) issues.push(`source_artifact_binding_invalid:${field}`); }
  return { issues, map };
}

function verifyNativeParsers(input: EcadMcadCommercialQualificationInput, targetHash: string, revision: number, artifacts: Map<string, CommercialArtifact>, now: number, max: number): string[] {
  const issues: string[] = []; const required = new Set(['kicad', 'netlist', 'ipc-2581', 'step', 'occt']); const seen = new Set<string>(); const signerKeys = new Set<string>();
  const formatKinds: Record<NativeParserReceipt['format'], CommercialArtifactKind> = { kicad: 'kicad', netlist: 'native_netlist', 'ipc-2581': 'ipc2581', step: 'step', occt: 'occt' };
  for (const receipt of input.nativeParsers) {
    if (!validId(receipt.receiptId) || seen.has(receipt.receiptId)) issues.push(`native_receipt_duplicate:${receipt?.receiptId}`); seen.add(receipt.receiptId);
    if (!required.has(receipt.format)) issues.push(`native_format_invalid:${receipt?.format}`);
    if (!artifacts.has(receipt.artifactId) || artifacts.get(receipt.artifactId)!.kind !== formatKinds[receipt.format] || artifacts.get(receipt.artifactId)!.sha256 !== receipt.artifactSha256 || artifacts.get(receipt.artifactId)!.revision !== revision || artifacts.get(receipt.artifactId)!.buildId !== input.buildId) issues.push(`native_artifact_binding_invalid:${receipt?.receiptId}`);
    if (!validHash(receipt.parserBinarySha256) || !validHash(receipt.parserSourceSha256) || receipt.targetHash !== targetHash || receipt.revision !== revision || receipt.buildId !== input.buildId || !fresh(receipt.issuedAt, receipt.expiresAt, now, max)) issues.push(`native_receipt_binding_invalid:${receipt?.receiptId}`);
    if (!input.artifacts.some(item => item.kind === 'parser_binary' && item.sha256 === receipt.parserBinarySha256) || !input.artifacts.some(item => item.kind === 'parser_source' && item.sha256 === receipt.parserSourceSha256)) issues.push(`native_parser_implementation_artifact_missing:${receipt?.receiptId}`);
    if (!validId(receipt.trustedSigner.keyId) || signerKeys.has(receipt.trustedSigner.keyId)) issues.push(`native_signer_invalid_or_replayed:${receipt?.receiptId}`); signerKeys.add(receipt.trustedSigner.keyId);
    const registration = input.trustedSigners[receipt.trustedSigner.keyId];
    if (!registration || !registration.roles.includes('native_parser') || registration.publicKeyPem !== receipt.trustedSigner.publicKeyPem) issues.push(`native_signer_not_trusted:${receipt?.receiptId}`);
    try { if (!registration || !verifySignature(null, Buffer.from(canonicalEcadNativeParserPayload(receipt), 'utf8'), registration.publicKeyPem, Buffer.from(receipt.trustedSigner.signatureBase64, 'base64'))) issues.push(`native_signature_invalid:${receipt?.receiptId}`); } catch { issues.push(`native_signature_invalid:${receipt?.receiptId}`); }
  }
  for (const format of required) if (!input.nativeParsers.some(receipt => receipt.format === format)) issues.push(`native_format_missing:${format}`);
  return issues;
}

function verifyCanonicalConnectivity(input: EcadMcadCommercialQualificationInput): string[] {
  const issues: string[] = []; const release = input.release; const expected = release.components.flatMap(component => release.pins.filter(pin => pin.componentId === component.id).map(pin => ({ referenceDesignator: component.referenceDesignator, pad: pin.number, pinId: pin.id, netName: release.nets.find(net => net.id === pin.netId)?.name ?? '' }))).sort((a, b) => canonical(a).localeCompare(canonical(b))); const actual = [...input.canonicalConnectivity.refdesPadPinNet].sort((a, b) => canonical(a).localeCompare(canonical(b)));
  if (canonical(expected) !== canonical(actual)) issues.push('canonical_refdes_pad_pin_net_exact_set_mismatch');
  if (new Set(release.components.map(component => component.referenceDesignator)).size !== release.components.length) issues.push('duplicate_reference_designator');
  for (const component of release.components) { const numbers = release.pins.filter(pin => pin.componentId === component.id).map(pin => pin.number); if (!unique(numbers)) issues.push(`duplicate_pin_pad_name:${component.id}`); }
  const netNames = release.nets.map(net => net.name); if (!unique(netNames)) issues.push('duplicate_net_name');
  for (const net of release.nets) { const pins = net.pinIds.map(id => release.pins.find(pin => pin.id === id)).filter(Boolean); if (pins.filter(pin => pin!.electricalType === 'output').length > 1) issues.push(`output_output_conflict:${net.id}`); if (net.kind === 'power' && pins.some(pin => pin!.electricalType === 'output')) issues.push(`output_power_conflict:${net.id}`); }
  const connectorRecords = input.canonicalConnectivity.connectorCavityWire; if (connectorRecords.length !== release.connectors.length) issues.push('connector_reconciliation_set_mismatch');
  for (const connector of release.connectors) { const record = connectorRecords.find(item => item.connectorId === connector.id); const component = release.components.find(item => item.id === connector.componentId); const cable = release.cables.find(item => item.connectorAId === connector.id || item.connectorBId === connector.id); const expectedPins = component?.pinIds ?? []; if (!record || record.cableId !== cable?.id || canonical([...record.cavityPinIds].sort()) !== canonical([...expectedPins].sort()) || canonical([...record.wireEndpointPinIds].sort()) !== canonical([...expectedPins].sort())) issues.push(`connector_cavity_wire_reconciliation_invalid:${connector.id}`); }
  return issues;
}

function verifyErcDrc(input: EcadMcadCommercialQualificationInput, targetHash: string, artifacts: Map<string, CommercialArtifact>, reviewers: Map<string, CommercialReviewerAttestation>): string[] {
  const issues: string[] = []; if (input.ercDrc.length !== 2 || !input.ercDrc.some(item => item.kind === 'erc') || !input.ercDrc.some(item => item.kind === 'drc')) issues.push('erc_drc_receipts_incomplete');
  for (const item of input.ercDrc) { if (!validId(item.rulesetId) || !validHash(item.rulesetSha256) || item.status !== 'passed' || !artifacts.has(item.inputArtifactId) || !artifacts.has(item.outputArtifactId)) issues.push(`erc_drc_receipt_invalid:${item?.kind}`); if (item.waiver) { if (item.waiver.targetHash !== targetHash || !reviewers.has(item.waiver.approvedByKeyId) || item.waiver.approvedByRole !== 'domain_reviewer' || !validId(item.waiver.waiverId) || !validId(item.waiver.issueId) || !validId(item.waiver.reason)) issues.push(`erc_drc_waiver_invalid:${item.kind}`); else { const reviewer = reviewers.get(item.waiver.approvedByKeyId)!; try { if (!verifySignature(null, Buffer.from(canonicalEcadErcDrcWaiverPayload(item.waiver), 'utf8'), reviewer.publicKeyPem, Buffer.from(item.waiver.signatureBase64, 'base64'))) issues.push(`erc_drc_waiver_signature_invalid:${item.kind}`); } catch { issues.push(`erc_drc_waiver_signature_invalid:${item.kind}`); } if (reviewer.publicKeyPem !== item.waiver.publicKeyPem) issues.push(`erc_drc_waiver_key_mismatch:${item.kind}`); } } }
  return issues;
}

function verifyStep(input: EcadMcadCommercialQualificationInput, targetHash: string, revision: number, artifacts: Map<string, CommercialArtifact>): string[] {
  const item = input.stepRoundtrip; const issues: string[] = []; const board = input.release.board;
  if (item.passed !== true || item.targetHash !== targetHash || item.revision !== revision || item.buildId !== input.buildId || !artifacts.has(item.inputArtifactId) || !artifacts.has(item.outputArtifactId) || !artifacts.has(item.toleranceArtifactId) || !Number.isFinite(item.toleranceMm) || item.toleranceMm <= 0) issues.push('step_roundtrip_receipt_invalid');
  if (Math.abs(item.outline.widthMm - board.widthMm) > item.toleranceMm || Math.abs(item.outline.heightMm - board.heightMm) > item.toleranceMm || Math.abs(item.outline.thicknessMm - board.thicknessMm) > item.toleranceMm) issues.push('step_outline_thickness_tolerance_failed');
  const exact = (actual: readonly string[], expected: readonly string[], label: string) => { if (!unique(actual) || canonical([...actual].sort()) !== canonical([...expected].sort())) issues.push(`step_${label}_envelope_mismatch`); };
  exact(item.cutoutIds, input.release.keepouts.map(value => value.id), 'cutout'); exact(item.holeIds, input.release.mountingHoles.map(value => value.id), 'hole'); exact(item.componentIds, input.release.components.map(value => value.id), 'component'); exact(item.connectorIds, input.release.connectors.map(value => value.id), 'connector'); return issues;
}

function verifyWires(input: EcadMcadCommercialQualificationInput, artifacts: Map<string, CommercialArtifact>): string[] {
  const issues: string[] = []; const cables = input.release.cables; if (input.wires.length !== cables.length) issues.push('wire_evidence_set_mismatch');
  for (const cable of cables) { const item = input.wires.find(value => value.cableId === cable.id); if (!item || !validId(item.wireId) || !validId(item.gauge) || !validId(item.routeId) || !validId(item.crimpId) || !(item.deratingFactor > 0 && item.deratingFactor <= 1) || !(item.lengthMm > 0) || !(item.bendRadiusMm > 0) || item.contactIds.length !== cable.pinCount || !['passed'].every(status => item.continuity === status && item.isolation === status && item.hipot === status) || ![item.datasheetArtifactId, item.continuityArtifactId, item.isolationArtifactId, item.hipotArtifactId].every(id => artifacts.has(id))) issues.push(`wire_manufacturing_invalid:${cable.id}`); }
  return issues;
}

function verifyFabrication(input: EcadMcadCommercialQualificationInput, artifacts: Map<string, CommercialArtifact>): string[] {
  const item = input.fabrication; const issues: string[] = []; for (const [field, kind] of Object.entries({ gerberArtifactId: 'gerber', odbppArtifactId: 'odbpp', ipc2581ArtifactId: 'ipc2581', bomArtifactId: 'bom', pnpArtifactId: 'pnp', aoiArtifactId: 'aoi', flyingProbeArtifactId: 'flying_probe' })) { const id = item[field as keyof FabricationAssemblyEvidence]; if (!validId(id) || !artifacts.has(id) || artifacts.get(id)?.kind !== kind) issues.push(`fabrication_artifact_invalid:${field}`); } if (!validId(item.lot) || !validId(item.serial)) issues.push('fabrication_lot_serial_missing'); return issues;
}

function verifyArtifactReuse(input: EcadMcadCommercialQualificationInput, artifacts: Map<string, CommercialArtifact>): string[] {
  const issues: string[] = []; const refs: string[] = [];
  refs.push(...input.nativeParsers.map(item => item.artifactId));
  refs.push(...input.ercDrc.flatMap(item => [item.inputArtifactId, item.outputArtifactId]));
  refs.push(input.stepRoundtrip.inputArtifactId, input.stepRoundtrip.outputArtifactId, input.stepRoundtrip.toleranceArtifactId);
  refs.push(...input.wires.flatMap(item => [item.datasheetArtifactId, item.continuityArtifactId, item.isolationArtifactId, item.hipotArtifactId]));
  refs.push(input.fabrication.gerberArtifactId, input.fabrication.odbppArtifactId, input.fabrication.ipc2581ArtifactId, input.fabrication.bomArtifactId, input.fabrication.pnpArtifactId, input.fabrication.aoiArtifactId, input.fabrication.flyingProbeArtifactId);
  const seenIds = new Set<string>(); const seenHashes = new Set<string>();
  for (const id of refs) {
    const artifact = artifacts.get(id); if (!artifact) continue;
    if (seenIds.has(id)) issues.push(`artifact_reuse_id:${id}`); if (seenHashes.has(artifact.sha256)) issues.push(`artifact_reuse_sha256:${id}`);
    seenIds.add(id); seenHashes.add(artifact.sha256);
  }
  return issues;
}

function verifyReviewers(input: EcadMcadCommercialQualificationInput, targetHash: string, revision: number, now: number, max: number, artifacts: Map<string, CommercialArtifact>): { issues: string[]; map: Map<string, CommercialReviewerAttestation> } {
  const issues: string[] = []; const map = new Map<string, CommercialReviewerAttestation>(); const seenKeys = new Set<string>(); const seenIds = new Set<string>(); const seenReviewers = new Set<string>();
  if (input.attestations.length !== ECAD_MCAD_REVIEW_ROLES.length) issues.push('reviewer_role_set_invalid');
  for (const role of ECAD_MCAD_REVIEW_ROLES) { const reviewer = input.attestations.find(item => item.role === role); if (!reviewer) { issues.push(`reviewer_missing:${role}`); continue; } if (!validId(reviewer.attestationId) || seenIds.has(reviewer.attestationId)) issues.push(`reviewer_replay:${role}`); seenIds.add(reviewer.attestationId); if (!validId(reviewer.reviewerId) || seenReviewers.has(reviewer.reviewerId) || !validId(reviewer.keyId) || seenKeys.has(reviewer.keyId)) issues.push(`reviewer_key_invalid_or_reused:${role}`); seenReviewers.add(reviewer.reviewerId); seenKeys.add(reviewer.keyId); if (reviewer.targetHash !== targetHash || reviewer.revision !== revision || reviewer.buildId !== input.buildId) issues.push(`reviewer_binding_invalid:${role}`); if (!unique(reviewer.axes) || ECAD_MCAD_REQUIRED_AXES.some(axis => !reviewer.axes.includes(axis))) issues.push(`reviewer_axes_incomplete:${role}`); if (!unique(reviewer.evidenceIds) || reviewer.evidenceIds.length === 0 || reviewer.evidenceIds.some(id => !artifacts.has(id))) issues.push(`reviewer_evidence_missing:${role}`); if (!fresh(reviewer.issuedAt, reviewer.expiresAt, now, max)) issues.push(`reviewer_stale:${role}`); const registration = input.trustedSigners[reviewer.keyId]; if (!registration || !registration.roles.includes(role) || registration.publicKeyPem !== reviewer.publicKeyPem) issues.push(`reviewer_not_trusted:${role}`); try { if (!registration || !verifySignature(null, Buffer.from(attestationPayload(reviewer), 'utf8'), registration.publicKeyPem, Buffer.from(reviewer.signatureBase64, 'base64'))) issues.push(`reviewer_signature_invalid:${role}`); } catch { issues.push(`reviewer_signature_invalid:${role}`); } map.set(reviewer.keyId, reviewer); }
  const publicKeys = input.attestations.filter(item => ECAD_MCAD_REVIEW_ROLES.includes(item.role)).map(item => item.publicKeyPem); if (new Set(publicKeys).size !== publicKeys.length) issues.push('reviewer_public_keys_must_be_distinct'); return { issues, map };
}

export function qualifyEcadMcadCommercial(input: EcadMcadCommercialQualificationInput): EcadMcadCommercialQualificationResult {
  const blockers: string[] = []; const now = dateMs(input.now ?? new Date().toISOString()); const max = Number.isSafeInteger(input.maxFreshnessMs) && (input.maxFreshnessMs ?? 0) > 0 ? Math.min(input.maxFreshnessMs!, MAX_FRESHNESS_MS) : MAX_FRESHNESS_MS; const revision = input.release.revision; let targetHash = '0'.repeat(64);
  try { targetHash = hashEcadMcadCommercialTarget(input); } catch { blockers.push('target_hash_generation_failed'); }
  const validation = validateEcadMcadRelease(input.release); if (!validation.valid) blockers.push(...validation.issues.map(issue => `internal_validation:${issue}`));
  const readback = input.readback ? verifyEcadMcadReadback(input.release, input.readback) : { valid: false, issues: ['readback_missing'] }; if (!readback.valid) blockers.push(...readback.issues.map(issue => `internal_readback:${issue}`));
  const artifacts = verifyArtifacts(input, revision); blockers.push(...artifacts.issues); const reviewerResult = now === null ? { issues: ['reviewer_clock_invalid'], map: new Map<string, CommercialReviewerAttestation>() } : verifyReviewers(input, targetHash, revision, now, max, artifacts.map); blockers.push(...reviewerResult.issues);
  const nativeIssues = now === null ? ['native_clock_invalid'] : verifyNativeParsers(input, targetHash, revision, artifacts.map, now, max); blockers.push(...nativeIssues);
  for (const parser of input.nativeParsers) if (reviewerResult.map.has(parser.trustedSigner.keyId)) blockers.push(`native_signer_reuses_reviewer_key:${parser.receiptId}`);
  blockers.push(...verifyCanonicalConnectivity(input)); blockers.push(...verifyErcDrc(input, targetHash, artifacts.map, reviewerResult.map)); blockers.push(...verifyStep(input, targetHash, revision, artifacts.map)); blockers.push(...verifyWires(input, artifacts.map)); blockers.push(...verifyFabrication(input, artifacts.map));
  blockers.push(...verifyArtifactReuse(input, artifacts.map));
  const uniqueBlockers = [...new Set(blockers)]; const qualified = uniqueBlockers.length === 0;
  return { schema: ECAD_MCAD_COMMERCIAL_EVIDENCE_SCHEMA, status: qualified ? 'QUALIFIED' : 'HOLD', qualified, targetHash, revision, buildId: input.buildId, internalValidation: { valid: validation.valid, issues: validation.issues }, internalReadback: { valid: readback.valid, issues: readback.issues }, artifacts: { valid: artifacts.issues.length === 0, issues: artifacts.issues }, nativeParsers: { valid: nativeIssues.length === 0, issues: nativeIssues }, reviewers: { valid: reviewerResult.issues.length === 0, issues: reviewerResult.issues }, evidence: { valid: uniqueBlockers.filter(issue => !issue.startsWith('internal_') && !issue.startsWith('artifact_') && !issue.startsWith('native_') && !issue.startsWith('reviewer_')).length === 0, issues: uniqueBlockers, }, blockers: uniqueBlockers };
}
