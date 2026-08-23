import { createHash } from 'node:crypto';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import { validateCivilDocument, type CivilAlignmentSegment, type CivilDocument } from './civilDocument';

export const CIVIL_PROFILE_ARTIFACT_SCHEMA = 'nexyfab.civil-profile-artifact.v1' as const;
export const CIVIL_PROFILE_EXPORTER_ID = 'scripts/drawing-to-3d/civil-profile-export.mjs' as const;
export const CIVIL_PROFILE_PARSER_ID = 'scripts/drawing-to-3d/civil-profile-import.mjs' as const;
export const CIVIL_PROFILE_PROBE_ID = 'scripts/drawing-to-3d/civil-profile-probe.mjs' as const;
export const CIVIL_PROFILE_STRUCTURAL_VERIFIER_ID = 'civil-profile-structural.v1' as const;
export const CIVIL_PROFILE_VERIFIER_ID = CIVIL_PROFILE_STRUCTURAL_VERIFIER_ID;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ITEMS = 100_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;
const unique = (values: readonly string[]) => values.length <= MAX_ITEMS && values.every(id) && new Set(values).size === values.length;
const increasing = (values: readonly number[]) => values.every((value, index) => finite(value) && (index === 0 || value > values[index - 1]!));
const sorted = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
const sourceDocumentSha256 = (document: CivilDocument) => designRevisionSha256(document);
const exactKeys = (value: unknown, expected: readonly string[]): boolean => record(value) && Object.keys(value).length === expected.length && Object.keys(value).every(key => expected.includes(key));

export type CivilProfileArtifactPayload = {
  schema: typeof CIVIL_PROFILE_ARTIFACT_SCHEMA;
  binding: { projectId: string; revisionId: string; revisionSha256: string; sourceDocumentSha256: string };
  coordinateSystemId: string;
  crs: CivilDocument['crs'];
  alignments: Array<{
    id: string; name: string; startStationM: number; endStationM: number;
    segments: Array<Record<string, unknown> & { id: string; kind: CivilAlignmentSegment['kind']; startStationM: number; endStationM: number }>;
  }>;
  profiles: Array<{ id: string; alignmentId: string; kind: 'existing' | 'proposed'; startStationM: number; endStationM: number; points: Array<{ stationM: number; elevationM: number }> }>;
  counts: { alignmentCount: number; segmentCount: number; profileCount: number; pviCount: number };
};

export type CivilProfileArtifact = { payload: CivilProfileArtifactPayload; contentHash: string; bytes: Uint8Array; artifactSha256: string; artifactName: string; artifactMime: 'application/json'; sourceDocumentSha256: string };
export type CivilProfileParseResult = { payload: CivilProfileArtifactPayload; contentHash: string; artifactSha256: string };
export type CivilProfileVerification =
  | { status: 'passed'; verifierId: typeof CIVIL_PROFILE_STRUCTURAL_VERIFIER_ID; issues: [] }
  | { status: 'failed'; verifierId: typeof CIVIL_PROFILE_STRUCTURAL_VERIFIER_ID; issues: string[] };
export type CivilProfileProbeReceipt = {
  schema: 'nexyfab.civil-profile-probe.v1'; capabilityId: 'civil.profile.internal'; format: 'json';
  projectId: string; revisionId: string; revisionSha256: string; sourceDocumentSha256: string;
  artifactSha256: string; artifactBytes: number; exporterId: string; exporterSourceSha256: string;
  parserId: string; parserSourceSha256: string; parserResult: 'verified'; parserOutputSha256: string;
  verifierId: typeof CIVIL_PROFILE_PROBE_ID; verifierEvidenceSha256: string;
  stableIds: { alignments: string[]; segments: string[]; profiles: string[]; pvis: string[] };
  alignmentStationCoverageM: Array<{ id: string; startStationM: number; endStationM: number }>;
  profileStationCoverageM: Array<{ id: string; alignmentId: string; startStationM: number; endStationM: number }>;
  externalInteroperability: 'HOLD'; nativeFormats: 'HOLD'; fieldEvidence: 'NOT_RUN';
  requiredArtifactKinds: []; releaseReady: false;
};

function segmentLength(segment: CivilAlignmentSegment): number {
  if (segment.kind === 'line' || segment.kind === 'spiral') return Math.hypot(segment.endM[0] - segment.startM[0], segment.endM[1] - segment.startM[1]);
  const delta = Math.abs((segment.endAngleDeg - segment.startAngleDeg) * Math.PI / 180);
  return delta * segment.radiusM;
}

function segmentRecord(segment: CivilAlignmentSegment, endStationM: number): CivilProfileArtifactPayload['alignments'][number]['segments'][number] {
  if (segment.kind === 'line') return { id: segment.id, kind: segment.kind, startStationM: segment.startStationM, endStationM, startM: segment.startM, endM: segment.endM };
  if (segment.kind === 'arc') return { id: segment.id, kind: segment.kind, startStationM: segment.startStationM, endStationM, centerM: segment.centerM, radiusM: segment.radiusM, startAngleDeg: segment.startAngleDeg, endAngleDeg: segment.endAngleDeg, clockwise: segment.clockwise };
  return { id: segment.id, kind: segment.kind, startStationM: segment.startStationM, endStationM, startM: segment.startM, endM: segment.endM, startRadiusM: segment.startRadiusM, endRadiusM: segment.endRadiusM };
}

function payloadFor(input: { projectId: string; revisionId: string; revisionSha256: string; document: CivilDocument }): CivilProfileArtifactPayload {
  const alignments = sorted(input.document.alignments).map((alignment) => {
    const segments = alignment.segments.map((segment, index) => {
      const next = alignment.segments[index + 1];
      if (!next && segment.kind === 'spiral') throw new Error('CIVIL_PROFILE_TERMINAL_SPIRAL_COVERAGE_UNKNOWN');
      const end = next?.startStationM ?? segment.startStationM + segmentLength(segment);
      return segmentRecord(segment, end);
    });
    return { id: alignment.id, name: alignment.name, startStationM: segments[0]!.startStationM, endStationM: segments.at(-1)!.endStationM, segments };
  });
  const profiles = sorted(input.document.profiles).map((profile) => ({ id: profile.id, alignmentId: profile.alignmentId, kind: profile.kind, startStationM: profile.points[0]!.stationM, endStationM: profile.points.at(-1)!.stationM, points: profile.points.map((point) => ({ stationM: point.stationM, elevationM: point.elevationM })) }));
  return { schema: CIVIL_PROFILE_ARTIFACT_SCHEMA, binding: { projectId: input.projectId, revisionId: input.revisionId, revisionSha256: input.revisionSha256, sourceDocumentSha256: sourceDocumentSha256(input.document) }, coordinateSystemId: input.document.coordinateSystemId, crs: input.document.crs, alignments, profiles, counts: { alignmentCount: alignments.length, segmentCount: alignments.reduce((n, a) => n + a.segments.length, 0), profileCount: profiles.length, pviCount: profiles.reduce((n, p) => n + p.points.length, 0) } };
}

function payloadIssues(value: unknown): string[] {
  const issues: string[] = [];
  if (!record(value) || value.schema !== CIVIL_PROFILE_ARTIFACT_SCHEMA) return ['artifact_schema_invalid'];
  const p = value as Partial<CivilProfileArtifactPayload>;
  if (!exactKeys(p, ['schema', 'binding', 'coordinateSystemId', 'crs', 'alignments', 'profiles', 'counts'])) issues.push('artifact_unknown_key');
  if (record(p.binding) && !exactKeys(p.binding, ['projectId', 'revisionId', 'revisionSha256', 'sourceDocumentSha256'])) issues.push('binding_unknown_key');
  if (record(p.crs) && !exactKeys(p.crs, ['epsg', 'horizontalDatum', 'verticalDatum', 'units'])) issues.push('crs_unknown_key');
  if (!record(p.binding) || !id(p.binding.projectId) || !id(p.binding.revisionId) || !SHA256.test(String(p.binding.revisionSha256)) || !SHA256.test(String(p.binding.sourceDocumentSha256))) issues.push('artifact_binding_invalid');
  if (!id(p.coordinateSystemId) || !record(p.crs) || !Number.isSafeInteger(p.crs.epsg) || p.crs.epsg <= 0 || p.crs.units !== 'm' || !id(p.crs.horizontalDatum) || !id(p.crs.verticalDatum)) issues.push('artifact_crs_invalid');
  if (!Array.isArray(p.alignments) || !Array.isArray(p.profiles) || p.alignments.length > MAX_ITEMS || p.profiles.length > MAX_ITEMS) return [...issues, 'artifact_collections_invalid'];
  const alignments = p.alignments as unknown[]; const profiles = p.profiles as unknown[];
  const alignmentIds: string[] = [], segmentIds: string[] = [];
  for (const alignment of alignments) {
    if (!exactKeys(alignment, ['id', 'name', 'startStationM', 'endStationM', 'segments'])) { issues.push('alignment_unknown_key'); continue; }
    if (!record(alignment) || !id(alignment.id) || !id(alignment.name) || !finite(alignment.startStationM) || !finite(alignment.endStationM) || alignment.endStationM <= alignment.startStationM || !Array.isArray(alignment.segments) || alignment.segments.length === 0) { issues.push('alignment_record_invalid'); continue; }
    alignmentIds.push(alignment.id); const segments = alignment.segments as unknown[]; let previousEnd = alignment.startStationM;
    for (const segment of segments) {
      const s = record(segment) ? segment : {};
      const segmentKeys = s.kind === 'line' ? ['id', 'kind', 'startStationM', 'endStationM', 'startM', 'endM'] : s.kind === 'arc' ? ['id', 'kind', 'startStationM', 'endStationM', 'centerM', 'radiusM', 'startAngleDeg', 'endAngleDeg', 'clockwise'] : ['id', 'kind', 'startStationM', 'endStationM', 'startM', 'endM', 'startRadiusM', 'endRadiusM'];
      if (!exactKeys(segment, segmentKeys)) issues.push('alignment_segment_unknown_key');
      if (!record(segment) || !id(s.id) || !['line', 'arc', 'spiral'].includes(String(s.kind)) || !finite(s.startStationM) || !finite(s.endStationM) || s.startStationM < previousEnd || s.endStationM <= s.startStationM || (s.startStationM !== previousEnd && s.startStationM !== alignment.startStationM)) issues.push('alignment_segment_station_invalid');
      segmentIds.push(String(s.id)); previousEnd = Number(s.endStationM);
      const kind = s.kind;
      if (kind === 'line' || kind === 'spiral') { if (!Array.isArray(s.startM) || !Array.isArray(s.endM) || s.startM.length !== 2 || s.endM.length !== 2 || !s.startM.every(finite) || !s.endM.every(finite)) issues.push('alignment_segment_geometry_invalid'); }
      if (kind === 'arc' && (!Array.isArray(s.centerM) || s.centerM.length !== 2 || !s.centerM.every(finite) || !finite(s.radiusM) || s.radiusM <= 0 || !finite(s.startAngleDeg) || !finite(s.endAngleDeg) || s.startAngleDeg === s.endAngleDeg || typeof s.clockwise !== 'boolean')) issues.push('alignment_segment_geometry_invalid');
      if (kind === 'spiral' && ((s.startRadiusM !== null && (!finite(s.startRadiusM) || s.startRadiusM <= 0)) || (s.endRadiusM !== null && (!finite(s.endRadiusM) || s.endRadiusM <= 0)))) issues.push('alignment_segment_geometry_invalid');
    }
    if (previousEnd !== alignment.endStationM) issues.push('alignment_coverage_mismatch');
  }
  if (!unique(alignmentIds) || !unique(segmentIds)) issues.push('duplicate_stable_id');
  const profileIds: string[] = []; let pviCount = 0;
  for (const profile of profiles) {
    if (!exactKeys(profile, ['id', 'alignmentId', 'kind', 'startStationM', 'endStationM', 'points'])) { issues.push('profile_unknown_key'); continue; }
    if (!record(profile) || !id(profile.id) || !id(profile.alignmentId) || !alignmentIds.includes(profile.alignmentId) || !['existing', 'proposed'].includes(String(profile.kind)) || !finite(profile.startStationM) || !finite(profile.endStationM) || profile.endStationM < profile.startStationM || !Array.isArray(profile.points) || profile.points.length < 2 || !increasing(profile.points.map((point) => Number((point as Record<string, unknown>)?.stationM)))) { issues.push('profile_record_invalid'); continue; }
    const points = profile.points as unknown[]; if (profile.startStationM !== (points[0] as Record<string, unknown> | undefined)?.stationM || profile.endStationM !== (points.at(-1) as Record<string, unknown> | undefined)?.stationM) issues.push('profile_coverage_mismatch');
    const alignment = alignments.find((item) => record(item) && item.id === profile.alignmentId) as Record<string, unknown> | undefined;
    if (alignment && (profile.startStationM > Number(alignment.startStationM) || profile.endStationM < Number(alignment.endStationM))) issues.push('profile_alignment_coverage_invalid');
    profileIds.push(profile.id); pviCount += points.length;
    for (const point of points) { if (!exactKeys(point, ['stationM', 'elevationM'])) issues.push(`pvi_unknown_key:${profile.id}`); if (!record(point) || !finite(point.stationM) || !finite(point.elevationM)) issues.push(`pvi_invalid:${profile.id}`); }
  }
  if (!unique(profileIds)) issues.push('duplicate_stable_id');
  const c = p.counts; if (!exactKeys(c, ['alignmentCount', 'segmentCount', 'profileCount', 'pviCount']) || !record(c) || c.alignmentCount !== alignments.length || c.segmentCount !== segmentIds.length || c.profileCount !== profiles.length || c.pviCount !== pviCount) issues.push('artifact_counts_mismatch');
  return [...new Set(issues)];
}

export function exportCivilProfileArtifact(input: { projectId: string; revisionId: string; revisionValue: unknown; expectedRevisionId: string; expectedRevisionSha256: string; document: CivilDocument; artifactName?: string }): CivilProfileArtifact {
  if (!id(input.projectId) || !id(input.revisionId) || input.revisionId !== input.expectedRevisionId) throw new Error('CIVIL_PROFILE_STALE_REVISION');
  const revisionSha256 = designRevisionSha256(input.revisionValue);
  if (!SHA256.test(input.expectedRevisionSha256) || revisionSha256 !== input.expectedRevisionSha256) throw new Error('CIVIL_PROFILE_STALE_REVISION_HASH');
  const documentIssues = validateCivilDocument(input.document); if (documentIssues.length) throw new Error(`CIVIL_PROFILE_DOCUMENT_INVALID:${documentIssues[0]}`);
  if (input.document.alignments.length === 0 || input.document.profiles.length === 0) throw new Error('CIVIL_PROFILE_DATA_REQUIRED');
  const payload = payloadFor({ projectId: input.projectId, revisionId: input.revisionId, revisionSha256, document: input.document }); const issues = payloadIssues(payload); if (issues.length) throw new Error(`CIVIL_PROFILE_PAYLOAD_INVALID:${issues[0]}`);
  const contentHash = designRevisionSha256(payload); const bytes = encoder.encode(canonicalDesignJson({ payload, contentHash }));
  return { payload, contentHash, bytes, artifactSha256: sha256(bytes), artifactName: input.artifactName ?? 'civil-profiles.json', artifactMime: 'application/json', sourceDocumentSha256: payload.binding.sourceDocumentSha256 };
}

export function parseCivilProfileArtifact(bytes: Uint8Array): CivilProfileParseResult {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('CIVIL_PROFILE_ARTIFACT_EMPTY');
  let text: string; try { text = decoder.decode(bytes); } catch { throw new Error('CIVIL_PROFILE_ARTIFACT_JSON_INVALID'); }
  let parsed: unknown; try { parsed = JSON.parse(text) as unknown; } catch { throw new Error('CIVIL_PROFILE_ARTIFACT_JSON_INVALID'); }
  if (!record(parsed) || !record(parsed.payload) || typeof parsed.contentHash !== 'string' || !SHA256.test(parsed.contentHash)) throw new Error('CIVIL_PROFILE_ARTIFACT_ENVELOPE_INVALID');
  if (canonicalDesignJson(parsed) !== text) throw new Error('CIVIL_PROFILE_ARTIFACT_NON_CANONICAL');
  const issues = payloadIssues(parsed.payload); if (issues.length) throw new Error(`CIVIL_PROFILE_ARTIFACT_INVALID:${issues[0]}`);
  if (designRevisionSha256(parsed.payload) !== parsed.contentHash) throw new Error('CIVIL_PROFILE_CONTENT_HASH_MISMATCH');
  return { payload: parsed.payload as CivilProfileArtifactPayload, contentHash: parsed.contentHash, artifactSha256: sha256(bytes) };
}

export function verifyCivilProfileArtifact(input: { artifact: CivilProfileParseResult; document: CivilDocument; projectId: string; revisionId: string; revisionSha256: string }): CivilProfileVerification {
  const issues: string[] = []; try { issues.push(...payloadIssues(input.artifact.payload)); if (input.artifact.contentHash !== designRevisionSha256(input.artifact.payload)) issues.push('content_hash_mismatch'); const binding = input.artifact.payload.binding; if (binding.projectId !== input.projectId || binding.revisionId !== input.revisionId || binding.revisionSha256 !== input.revisionSha256) issues.push('stale_revision_binding'); if (binding.sourceDocumentSha256 !== sourceDocumentSha256(input.document)) issues.push('source_document_hash_mismatch'); const expected = payloadFor({ projectId: input.projectId, revisionId: input.revisionId, revisionSha256: input.revisionSha256, document: input.document }); if (canonicalDesignJson(expected) !== canonicalDesignJson(input.artifact.payload)) issues.push('source_alignment_profile_set_mismatch'); } catch { issues.push('verifier_exception'); }
  return issues.length ? { status: 'failed', verifierId: CIVIL_PROFILE_VERIFIER_ID, issues: [...new Set(issues)] } : { status: 'passed', verifierId: CIVIL_PROFILE_VERIFIER_ID, issues: [] };
}

function stableIds(payload: CivilProfileArtifactPayload): CivilProfileProbeReceipt['stableIds'] { return { alignments: payload.alignments.map((a) => a.id), segments: payload.alignments.flatMap((a) => a.segments.map((s) => s.id)), profiles: payload.profiles.map((p) => p.id), pvis: payload.profiles.flatMap((p) => p.points.map((point, index) => `${p.id}:pvi-${String(index).padStart(4, '0')}`)) }; }
function verifierEvidenceIssues(bytes: Uint8Array, payload: CivilProfileArtifactPayload): string[] {
  let value: unknown;
  try { value = JSON.parse(decoder.decode(bytes)) as unknown; } catch { return ['verifier_evidence_invalid']; }
  if (!record(value) || !exactKeys(value, ['exporterId', 'parserId', 'verifierId', 'stableIds', 'alignmentStationCoverageM', 'profileStationCoverageM', 'requiredArtifactKinds', 'externalInteroperability', 'nativeFormats', 'fieldEvidence', 'releaseReady']) || canonicalDesignJson(value) !== decoder.decode(bytes)) return ['verifier_evidence_noncanonical'];
  const expectedIds = stableIds(payload);
  const expectedAlignmentCoverage = payload.alignments.map((a) => ({ id: a.id, startStationM: a.startStationM, endStationM: a.endStationM }));
  const expectedProfileCoverage = payload.profiles.map((p) => ({ id: p.id, alignmentId: p.alignmentId, startStationM: p.startStationM, endStationM: p.endStationM }));
  const issues: string[] = [];
  if (value.exporterId !== CIVIL_PROFILE_EXPORTER_ID || value.parserId !== CIVIL_PROFILE_PARSER_ID || value.verifierId !== CIVIL_PROFILE_PROBE_ID) issues.push('verifier_evidence_identity_mismatch');
  if (canonicalDesignJson(value.stableIds) !== canonicalDesignJson(expectedIds) || canonicalDesignJson(value.alignmentStationCoverageM) !== canonicalDesignJson(expectedAlignmentCoverage) || canonicalDesignJson(value.profileStationCoverageM) !== canonicalDesignJson(expectedProfileCoverage)) issues.push('verifier_evidence_geometry_mismatch');
  if (!Array.isArray(value.requiredArtifactKinds) || value.requiredArtifactKinds.length !== 0 || value.externalInteroperability !== 'HOLD' || value.nativeFormats !== 'HOLD' || value.fieldEvidence !== 'NOT_RUN' || value.releaseReady !== false) issues.push('verifier_evidence_release_truth_mismatch');
  return issues;
}
export function buildCivilProfileProbeReceipt(input: { artifact: CivilProfileArtifact; exporterId: string; exporterSourceSha256: string; parserId: string; parserSourceSha256: string; parserResult: { status: 'verified'; sourceArtifactSha256: string; outputBytes: Uint8Array; stableIds: CivilProfileProbeReceipt['stableIds'] }; verifierEvidenceBytes: Uint8Array }): Uint8Array {
  const p = input.artifact.payload; const expected = stableIds(p); if (input.exporterId !== CIVIL_PROFILE_EXPORTER_ID || input.parserId !== CIVIL_PROFILE_PARSER_ID || sha256(input.artifact.bytes) !== input.artifact.artifactSha256 || !SHA256.test(input.exporterSourceSha256) || !SHA256.test(input.parserSourceSha256) || input.parserResult.status !== 'verified' || input.parserResult.sourceArtifactSha256 !== input.artifact.artifactSha256 || input.parserResult.outputBytes.byteLength === 0 || input.verifierEvidenceBytes.byteLength === 0 || canonicalDesignJson(expected) !== canonicalDesignJson(input.parserResult.stableIds)) throw new Error('CIVIL_PROFILE_PROBE_RESULT_MISMATCH');
  if (verifierEvidenceIssues(input.verifierEvidenceBytes, p).length) throw new Error('CIVIL_PROFILE_PROBE_RESULT_MISMATCH');
  const receipt: CivilProfileProbeReceipt = { schema: 'nexyfab.civil-profile-probe.v1', capabilityId: 'civil.profile.internal', format: 'json', projectId: p.binding.projectId, revisionId: p.binding.revisionId, revisionSha256: p.binding.revisionSha256, sourceDocumentSha256: p.binding.sourceDocumentSha256, artifactSha256: input.artifact.artifactSha256, artifactBytes: input.artifact.bytes.byteLength, exporterId: input.exporterId, exporterSourceSha256: input.exporterSourceSha256, parserId: input.parserId, parserSourceSha256: input.parserSourceSha256, parserResult: 'verified', parserOutputSha256: sha256(input.parserResult.outputBytes), verifierId: CIVIL_PROFILE_PROBE_ID, verifierEvidenceSha256: sha256(input.verifierEvidenceBytes), stableIds: input.parserResult.stableIds, alignmentStationCoverageM: p.alignments.map((a) => ({ id: a.id, startStationM: a.startStationM, endStationM: a.endStationM })), profileStationCoverageM: p.profiles.map((profile) => ({ id: profile.id, alignmentId: profile.alignmentId, startStationM: profile.startStationM, endStationM: profile.endStationM })), externalInteroperability: 'HOLD', nativeFormats: 'HOLD', fieldEvidence: 'NOT_RUN', requiredArtifactKinds: [], releaseReady: false };
  return encoder.encode(canonicalDesignJson(receipt));
}

export function claimCivilProfileProbe(input: { artifact: CivilProfileArtifact; evidenceBytes: Uint8Array; exporterSourceBytes: Uint8Array; parserSourceBytes: Uint8Array; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): CivilProfileProbeReceipt & { evidenceSha256: string; claim: 'internal-profile-verified' } {
  let evidence: CivilProfileProbeReceipt; try { evidence = JSON.parse(decoder.decode(input.evidenceBytes)) as CivilProfileProbeReceipt; } catch { throw new Error('CIVIL_PROFILE_EVIDENCE_INVALID'); }
  if (canonicalDesignJson(evidence) !== decoder.decode(input.evidenceBytes)) throw new Error('CIVIL_PROFILE_EVIDENCE_NON_CANONICAL');
  if (evidence.schema !== 'nexyfab.civil-profile-probe.v1' || evidence.capabilityId !== 'civil.profile.internal' || evidence.format !== 'json' || evidence.exporterId !== CIVIL_PROFILE_EXPORTER_ID || evidence.parserId !== CIVIL_PROFILE_PARSER_ID || evidence.verifierId !== CIVIL_PROFILE_PROBE_ID || evidence.projectId !== input.artifact.payload.binding.projectId || evidence.revisionId !== input.artifact.payload.binding.revisionId || evidence.revisionSha256 !== input.artifact.payload.binding.revisionSha256 || evidence.sourceDocumentSha256 !== input.artifact.payload.binding.sourceDocumentSha256 || evidence.artifactSha256 !== input.artifact.artifactSha256 || sha256(input.artifact.bytes) !== evidence.artifactSha256 || evidence.artifactBytes !== input.artifact.bytes.byteLength || evidence.parserResult !== 'verified' || evidence.externalInteroperability !== 'HOLD' || evidence.nativeFormats !== 'HOLD' || evidence.fieldEvidence !== 'NOT_RUN' || evidence.releaseReady !== false || evidence.requiredArtifactKinds.length !== 0 || !SHA256.test(evidence.artifactSha256) || !SHA256.test(evidence.revisionSha256) || !SHA256.test(evidence.sourceDocumentSha256) || !SHA256.test(evidence.exporterSourceSha256) || !SHA256.test(evidence.parserSourceSha256) || !SHA256.test(evidence.parserOutputSha256) || !SHA256.test(evidence.verifierEvidenceSha256) || input.exporterSourceBytes.byteLength === 0 || input.parserSourceBytes.byteLength === 0 || input.parserOutputBytes.byteLength === 0 || input.verifierEvidenceBytes.byteLength === 0 || sha256(input.exporterSourceBytes) !== evidence.exporterSourceSha256 || sha256(input.parserSourceBytes) !== evidence.parserSourceSha256 || sha256(input.parserOutputBytes) !== evidence.parserOutputSha256 || sha256(input.verifierEvidenceBytes) !== evidence.verifierEvidenceSha256) throw new Error('CIVIL_PROFILE_EVIDENCE_BINDING_MISMATCH');
  const expected = stableIds(input.artifact.payload); const expectedAlignmentCoverage = input.artifact.payload.alignments.map((a) => ({ id: a.id, startStationM: a.startStationM, endStationM: a.endStationM })); const expectedProfileCoverage = input.artifact.payload.profiles.map((p) => ({ id: p.id, alignmentId: p.alignmentId, startStationM: p.startStationM, endStationM: p.endStationM }));
  if (canonicalDesignJson(expected) !== canonicalDesignJson(evidence.stableIds) || canonicalDesignJson(expectedAlignmentCoverage) !== canonicalDesignJson(evidence.alignmentStationCoverageM) || canonicalDesignJson(expectedProfileCoverage) !== canonicalDesignJson(evidence.profileStationCoverageM)) throw new Error('CIVIL_PROFILE_EVIDENCE_CARDINALITY_MISMATCH');
  if (verifierEvidenceIssues(input.verifierEvidenceBytes, input.artifact.payload).length) throw new Error('CIVIL_PROFILE_EVIDENCE_BINDING_MISMATCH');
  return { ...evidence, evidenceSha256: sha256(input.evidenceBytes), claim: 'internal-profile-verified' };
}
