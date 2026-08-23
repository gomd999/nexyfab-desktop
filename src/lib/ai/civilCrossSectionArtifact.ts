import { createHash } from 'node:crypto';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import { validateCivilDocument, type CivilAlignment, type CivilCrossSection, type CivilDocument } from './civilDocument';

export const CIVIL_CROSS_SECTION_ARTIFACT_SCHEMA = 'nexyfab.civil-cross-section-artifact.v1' as const;
export const CIVIL_CROSS_SECTION_EXPORTER_ID = 'src/lib/ai/civilCrossSectionArtifact.ts' as const;
export const CIVIL_CROSS_SECTION_PARSER_ID = 'src/lib/ai/civilCrossSectionArtifact.ts' as const;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_ITEMS = 100_000;
const sha256 = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const text = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export type CivilCrossSectionArtifactPayload = {
  schema: typeof CIVIL_CROSS_SECTION_ARTIFACT_SCHEMA;
  binding: {
    projectId: string;
    revisionId: string;
    revisionSha256: string;
    sourceDocumentSha256: string;
  };
  coordinateSystemId: string;
  crs: CivilDocument['crs'];
  alignments: Array<{
    id: string;
    name: string;
    segmentIds: string[];
    segmentStartStationsM: number[];
  }>;
  crossSections: Array<{
    id: string;
    alignmentId: string;
    stationM: number;
    pointCount: number;
    points: Array<{ offsetM: number; elevationM: number; code: string }>;
  }>;
  counts: { alignmentCount: number; crossSectionCount: number; pointCount: number };
};

export type CivilCrossSectionArtifact = {
  payload: CivilCrossSectionArtifactPayload;
  contentHash: string;
  bytes: Uint8Array;
  artifactSha256: string;
  artifactName: string;
  artifactMime: 'application/json';
  sourceDocumentSha256: string;
};

export type CivilCrossSectionParseResult = {
  payload: CivilCrossSectionArtifactPayload;
  contentHash: string;
  artifactSha256: string;
};

export type CivilCrossSectionVerification =
  | { status: 'passed'; verifierId: 'civil-cross-section-structural.v1'; issues: [] }
  | { status: 'failed'; verifierId: 'civil-cross-section-structural.v1'; issues: string[] };

export type CivilCrossSectionProbeReceipt = {
  schema: 'nexyfab.civil-cross-section-probe.v1';
  capabilityId: 'civil.cross-section.internal';
  format: 'json';
  projectId: string;
  revisionId: string;
  revisionSha256: string;
  sourceDocumentSha256: string;
  artifactSha256: string;
  artifactBytes: number;
  exporterId: string;
  exporterSourceSha256: string;
  parserId: string;
  parserSourceSha256: string;
  parserResult: 'verified';
  parserOutputSha256: string;
  verifierId: 'civil-cross-section-structural.v1';
  verifierEvidenceSha256: string;
  stableIds: { alignments: string[]; crossSections: string[]; segments: string[] };
  stationsM: number[];
  pointCounts: number[];
  externalInteroperability: 'HOLD';
  fieldEvidence: 'NOT_RUN';
  releaseReady: false;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value;
const idsUnique = (values: readonly string[]) => new Set(values).size === values.length && values.every(identifier);
const strictlyIncreasing = (values: readonly number[]) => values.every((value, index) => index === 0 || value > values[index - 1]!);
const validStableIds = (value: unknown): value is CivilCrossSectionProbeReceipt['stableIds'] => isRecord(value)
  && ['alignments', 'crossSections', 'segments'].every(key => Array.isArray(value[key]) && (value[key] as unknown[]).every(identifier) && new Set(value[key] as string[]).size === (value[key] as unknown[]).length);
const sortedById = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
const sortedSections = (items: readonly CivilCrossSection[]) => [...items].sort((a, b) => a.alignmentId.localeCompare(b.alignmentId) || a.stationM - b.stationM || a.id.localeCompare(b.id));

function sourceDocumentSha256(document: CivilDocument): string { return designRevisionSha256(document); }

function payloadFor(input: { projectId: string; revisionId: string; revisionSha256: string; document: CivilDocument }): CivilCrossSectionArtifactPayload {
  const alignments = sortedById(input.document.alignments).map((alignment: CivilAlignment) => ({
    id: alignment.id,
    name: alignment.name,
    segmentIds: alignment.segments.map(segment => segment.id),
    segmentStartStationsM: alignment.segments.map(segment => segment.startStationM),
  }));
  const crossSections = sortedSections(input.document.crossSections).map(section => ({
    id: section.id,
    alignmentId: section.alignmentId,
    stationM: section.stationM,
    pointCount: section.points.length,
    points: section.points.map(point => ({ offsetM: point.offsetM, elevationM: point.elevationM, code: point.code })),
  }));
  return {
    schema: CIVIL_CROSS_SECTION_ARTIFACT_SCHEMA,
    binding: { projectId: input.projectId, revisionId: input.revisionId, revisionSha256: input.revisionSha256, sourceDocumentSha256: sourceDocumentSha256(input.document) },
    coordinateSystemId: input.document.coordinateSystemId,
    crs: input.document.crs,
    alignments,
    crossSections,
    counts: {
      alignmentCount: alignments.length,
      crossSectionCount: crossSections.length,
      pointCount: crossSections.reduce((sum, section) => sum + section.pointCount, 0),
    },
  };
}

function payloadIssues(value: unknown): string[] {
  const issues: string[] = [];
  if (!isRecord(value) || value.schema !== CIVIL_CROSS_SECTION_ARTIFACT_SCHEMA) return ['artifact_schema_invalid'];
  const payload = value as Partial<CivilCrossSectionArtifactPayload>;
  if (!isRecord(payload.binding) || !identifier(payload.binding.projectId) || !identifier(payload.binding.revisionId) || !SHA256.test(String(payload.binding.revisionSha256)) || !SHA256.test(String(payload.binding.sourceDocumentSha256))) issues.push('artifact_binding_invalid');
  if (!identifier(payload.coordinateSystemId) || !isRecord(payload.crs) || !Number.isSafeInteger(payload.crs.epsg) || payload.crs.epsg <= 0 || payload.crs.units !== 'm' || !identifier(payload.crs.horizontalDatum) || !identifier(payload.crs.verticalDatum)) issues.push('artifact_crs_invalid');
  if (!Array.isArray(payload.alignments) || !Array.isArray(payload.crossSections) || !isRecord(payload.counts) || payload.alignments.length > MAX_ITEMS || payload.crossSections.length > MAX_ITEMS) return [...issues, 'artifact_collections_invalid'];
  const alignments = payload.alignments as unknown[];
  const sections = payload.crossSections as unknown[];
  const alignmentIds: string[] = [], segmentIds: string[] = [];
  for (const alignment of alignments) {
    if (!isRecord(alignment) || !identifier(alignment.id) || !identifier(alignment.name) || !Array.isArray(alignment.segmentIds) || !Array.isArray(alignment.segmentStartStationsM) || alignment.segmentIds.length === 0 || alignment.segmentIds.length !== alignment.segmentStartStationsM.length || !idsUnique(alignment.segmentIds as string[]) || (alignment.segmentStartStationsM as unknown[]).some(station => !finite(station)) || !strictlyIncreasing(alignment.segmentStartStationsM as number[])) { issues.push('alignment_record_invalid'); continue; }
    alignmentIds.push(alignment.id); segmentIds.push(...alignment.segmentIds as string[]);
  }
  if (!idsUnique(alignmentIds) || !idsUnique(segmentIds)) issues.push('duplicate_stable_id');
  const sectionIds: string[] = [], sectionStations: number[] = [];
  let pointCount = 0;
  for (const section of sections) {
    if (!isRecord(section) || !identifier(section.id) || !identifier(section.alignmentId) || !alignmentIds.includes(section.alignmentId) || !finite(section.stationM) || !Number.isSafeInteger(section.pointCount) || Number(section.pointCount) < 2 || !Array.isArray(section.points) || section.points.length !== Number(section.pointCount)) { issues.push('cross_section_record_invalid'); continue; }
    sectionIds.push(section.id); sectionStations.push(section.stationM); pointCount += Number(section.pointCount);
    for (const point of section.points) if (!isRecord(point) || !finite(point.offsetM) || !finite(point.elevationM) || !identifier(point.code)) issues.push(`cross_section_point_invalid:${section.id}`);
  }
  if (!idsUnique(sectionIds)) issues.push('duplicate_stable_id');
  if (sections.some((section, index) => {
    const previous = sections[index - 1] as Record<string, unknown> | undefined;
    return previous && isRecord(section) && (String(previous.alignmentId).localeCompare(String(section.alignmentId)) > 0 || (previous.alignmentId === section.alignmentId && (Number(previous.stationM) > Number(section.stationM) || (previous.stationM === section.stationM && String(previous.id).localeCompare(String(section.id)) > 0))));
  })) issues.push('cross_section_order_invalid');
  if (!isRecord(payload.counts) || payload.counts.alignmentCount !== alignments.length || payload.counts.crossSectionCount !== sections.length || payload.counts.pointCount !== pointCount) issues.push('artifact_counts_mismatch');
  if (sectionStations.some(station => !finite(station))) issues.push('station_invalid');
  return [...new Set(issues)];
}

export function exportCivilCrossSectionArtifact(input: {
  projectId: string;
  revisionId: string;
  revisionValue: unknown;
  expectedRevisionId: string;
  expectedRevisionSha256: string;
  document: CivilDocument;
  artifactName?: string;
}): CivilCrossSectionArtifact {
  if (!identifier(input.projectId) || !identifier(input.revisionId) || input.revisionId !== input.expectedRevisionId) throw new Error('CIVIL_CROSS_SECTION_STALE_REVISION');
  const revisionSha256 = designRevisionSha256(input.revisionValue);
  if (!SHA256.test(input.expectedRevisionSha256) || revisionSha256 !== input.expectedRevisionSha256) throw new Error('CIVIL_CROSS_SECTION_STALE_REVISION_HASH');
  const documentIssues = validateCivilDocument(input.document);
  if (documentIssues.length) throw new Error(`CIVIL_CROSS_SECTION_DOCUMENT_INVALID:${documentIssues[0]}`);
  if (input.document.alignments.length === 0 || input.document.crossSections.length === 0) throw new Error('CIVIL_CROSS_SECTION_DATA_REQUIRED');
  const payload = payloadFor({ projectId: input.projectId, revisionId: input.revisionId, revisionSha256, document: input.document });
  const issues = payloadIssues(payload); if (issues.length) throw new Error(`CIVIL_CROSS_SECTION_PAYLOAD_INVALID:${issues[0]}`);
  const contentHash = designRevisionSha256(payload);
  const bytes = text.encode(canonicalDesignJson({ payload, contentHash }));
  return { payload, contentHash, bytes, artifactSha256: sha256(bytes), artifactName: input.artifactName ?? 'civil-cross-sections.json', artifactMime: 'application/json', sourceDocumentSha256: payload.binding.sourceDocumentSha256 };
}

export function parseCivilCrossSectionArtifact(bytes: Uint8Array): CivilCrossSectionParseResult {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('CIVIL_CROSS_SECTION_ARTIFACT_EMPTY');
  let parsed: unknown;
  try { parsed = JSON.parse(decoder.decode(bytes)) as unknown; } catch { throw new Error('CIVIL_CROSS_SECTION_ARTIFACT_JSON_INVALID'); }
  if (!isRecord(parsed) || !isRecord(parsed.payload) || typeof parsed.contentHash !== 'string' || !SHA256.test(parsed.contentHash)) throw new Error('CIVIL_CROSS_SECTION_ARTIFACT_ENVELOPE_INVALID');
  if (canonicalDesignJson(parsed) !== decoder.decode(bytes)) throw new Error('CIVIL_CROSS_SECTION_ARTIFACT_NON_CANONICAL');
  const issues = payloadIssues(parsed.payload); if (issues.length) throw new Error(`CIVIL_CROSS_SECTION_ARTIFACT_INVALID:${issues[0]}`);
  if (designRevisionSha256(parsed.payload) !== parsed.contentHash) throw new Error('CIVIL_CROSS_SECTION_CONTENT_HASH_MISMATCH');
  return { payload: parsed.payload as CivilCrossSectionArtifactPayload, contentHash: parsed.contentHash, artifactSha256: sha256(bytes) };
}

export function verifyCivilCrossSectionArtifact(input: { artifact: CivilCrossSectionParseResult; document: CivilDocument; projectId: string; revisionId: string; revisionSha256: string }): CivilCrossSectionVerification {
  const issues: string[] = [];
  try {
    issues.push(...payloadIssues(input.artifact.payload));
    if (input.artifact.contentHash !== designRevisionSha256(input.artifact.payload)) issues.push('content_hash_mismatch');
    if (input.artifact.payload.binding.projectId !== input.projectId || input.artifact.payload.binding.revisionId !== input.revisionId || input.artifact.payload.binding.revisionSha256 !== input.revisionSha256) issues.push('stale_revision_binding');
    if (input.artifact.payload.binding.sourceDocumentSha256 !== sourceDocumentSha256(input.document)) issues.push('source_document_hash_mismatch');
    const expected = payloadFor({ projectId: input.projectId, revisionId: input.revisionId, revisionSha256: input.revisionSha256, document: input.document });
    if (canonicalDesignJson(expected) !== canonicalDesignJson(input.artifact.payload)) issues.push('source_cross_section_set_mismatch');
  } catch { issues.push('verifier_exception'); }
  return issues.length ? { status: 'failed', verifierId: 'civil-cross-section-structural.v1', issues: [...new Set(issues)] } : { status: 'passed', verifierId: 'civil-cross-section-structural.v1', issues: [] };
}

export function buildCivilCrossSectionProbeReceipt(input: {
  artifact: CivilCrossSectionArtifact;
  exporterId: string;
  exporterSourceSha256: string;
  parserId: string;
  parserSourceSha256: string;
  parserResult: { status: 'verified'; sourceArtifactSha256: string; outputBytes: Uint8Array; stableIds: CivilCrossSectionProbeReceipt['stableIds']; stationsM: number[]; pointCounts: number[] };
  verifierEvidenceBytes: Uint8Array;
}): Uint8Array {
  const { artifact, parserResult } = input;
  const ids = artifact.payload;
  if (input.exporterId !== CIVIL_CROSS_SECTION_EXPORTER_ID || input.parserId !== CIVIL_CROSS_SECTION_PARSER_ID || sha256(artifact.bytes) !== artifact.artifactSha256 || !SHA256.test(input.exporterSourceSha256) || !SHA256.test(input.parserSourceSha256) || parserResult.status !== 'verified' || parserResult.sourceArtifactSha256 !== artifact.artifactSha256 || parserResult.outputBytes.byteLength === 0 || input.verifierEvidenceBytes.byteLength === 0 || !validStableIds(parserResult.stableIds) || parserResult.stableIds.alignments.join('|') !== ids.alignments.map(item => item.id).join('|') || parserResult.stableIds.crossSections.join('|') !== ids.crossSections.map(item => item.id).join('|') || parserResult.stableIds.segments.join('|') !== ids.alignments.flatMap(item => item.segmentIds).join('|') || parserResult.stationsM.join('|') !== ids.crossSections.map(item => item.stationM).join('|') || parserResult.pointCounts.join('|') !== ids.crossSections.map(item => item.pointCount).join('|')) throw new Error('CIVIL_CROSS_SECTION_PROBE_RESULT_MISMATCH');
  const receipt: CivilCrossSectionProbeReceipt = {
    schema: 'nexyfab.civil-cross-section-probe.v1', capabilityId: 'civil.cross-section.internal', format: 'json', projectId: ids.binding.projectId, revisionId: ids.binding.revisionId, revisionSha256: ids.binding.revisionSha256, sourceDocumentSha256: ids.binding.sourceDocumentSha256, artifactSha256: artifact.artifactSha256, artifactBytes: artifact.bytes.byteLength, exporterId: input.exporterId, exporterSourceSha256: input.exporterSourceSha256, parserId: input.parserId, parserSourceSha256: input.parserSourceSha256, parserResult: 'verified', parserOutputSha256: sha256(parserResult.outputBytes), verifierId: 'civil-cross-section-structural.v1', verifierEvidenceSha256: sha256(input.verifierEvidenceBytes), stableIds: parserResult.stableIds, stationsM: parserResult.stationsM, pointCounts: parserResult.pointCounts, externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false,
  };
  return text.encode(canonicalDesignJson(receipt));
}

export function claimCivilCrossSectionProbe(input: {
  artifact: CivilCrossSectionArtifact;
  evidenceBytes: Uint8Array;
  exporterSourceBytes: Uint8Array;
  parserSourceBytes: Uint8Array;
  parserOutputBytes: Uint8Array;
  verifierEvidenceBytes: Uint8Array;
}): CivilCrossSectionProbeReceipt & { evidenceSha256: string; claim: 'internal-cross-section-verified' } {
  let evidence: CivilCrossSectionProbeReceipt;
  try { evidence = JSON.parse(decoder.decode(input.evidenceBytes)) as CivilCrossSectionProbeReceipt; } catch { throw new Error('CIVIL_CROSS_SECTION_EVIDENCE_INVALID'); }
  if (canonicalDesignJson(evidence) !== decoder.decode(input.evidenceBytes)) throw new Error('CIVIL_CROSS_SECTION_EVIDENCE_NON_CANONICAL');
  if (evidence.schema !== 'nexyfab.civil-cross-section-probe.v1' || evidence.capabilityId !== 'civil.cross-section.internal' || evidence.format !== 'json' || evidence.exporterId !== CIVIL_CROSS_SECTION_EXPORTER_ID || evidence.parserId !== CIVIL_CROSS_SECTION_PARSER_ID || evidence.projectId !== input.artifact.payload.binding.projectId || evidence.revisionId !== input.artifact.payload.binding.revisionId || evidence.revisionSha256 !== input.artifact.payload.binding.revisionSha256 || evidence.sourceDocumentSha256 !== input.artifact.payload.binding.sourceDocumentSha256 || evidence.artifactSha256 !== input.artifact.artifactSha256 || sha256(input.artifact.bytes) !== evidence.artifactSha256 || evidence.artifactBytes !== input.artifact.bytes.byteLength || evidence.parserResult !== 'verified' || evidence.externalInteroperability !== 'HOLD' || evidence.fieldEvidence !== 'NOT_RUN' || evidence.releaseReady !== false || !SHA256.test(evidence.artifactSha256) || !SHA256.test(evidence.revisionSha256) || !SHA256.test(evidence.sourceDocumentSha256) || !SHA256.test(evidence.exporterSourceSha256) || !SHA256.test(evidence.parserSourceSha256) || !SHA256.test(evidence.parserOutputSha256) || !SHA256.test(evidence.verifierEvidenceSha256) || input.exporterSourceBytes.byteLength === 0 || input.parserSourceBytes.byteLength === 0 || input.parserOutputBytes.byteLength === 0 || input.verifierEvidenceBytes.byteLength === 0 || sha256(input.exporterSourceBytes) !== evidence.exporterSourceSha256 || sha256(input.parserSourceBytes) !== evidence.parserSourceSha256 || sha256(input.parserOutputBytes) !== evidence.parserOutputSha256 || sha256(input.verifierEvidenceBytes) !== evidence.verifierEvidenceSha256 || !validStableIds(evidence.stableIds) || !Array.isArray(evidence.stationsM) || !evidence.stationsM.every(finite) || !Array.isArray(evidence.pointCounts) || !evidence.pointCounts.every(value => Number.isSafeInteger(value) && value >= 2)) throw new Error('CIVIL_CROSS_SECTION_EVIDENCE_BINDING_MISMATCH');
  const expectedIds = input.artifact.payload;
  if (evidence.stableIds.alignments.join('|') !== expectedIds.alignments.map(item => item.id).join('|') || evidence.stableIds.crossSections.join('|') !== expectedIds.crossSections.map(item => item.id).join('|') || evidence.stableIds.segments.join('|') !== expectedIds.alignments.flatMap(item => item.segmentIds).join('|') || evidence.stationsM.join('|') !== expectedIds.crossSections.map(item => item.stationM).join('|') || evidence.pointCounts.join('|') !== expectedIds.crossSections.map(item => item.pointCount).join('|')) throw new Error('CIVIL_CROSS_SECTION_EVIDENCE_CARDINALITY_MISMATCH');
  return { ...evidence, evidenceSha256: sha256(input.evidenceBytes), claim: 'internal-cross-section-verified' };
}
