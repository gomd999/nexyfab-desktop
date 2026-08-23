import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import type { CivilDocument } from './civilDocument';
import { buildCivilProfileProbeReceipt, claimCivilProfileProbe, exportCivilProfileArtifact, parseCivilProfileArtifact, verifyCivilProfileArtifact } from './civilProfileArtifact';

const endSpiral = 139.2699081698724;
const endAlignment = 164.2699081698724;
const profileEnd = endAlignment + 50;
const makeDocument = (): CivilDocument => ({
  schema: 'nexyfab.civil.v1', revision: 4, coordinateSystemId: 'site', crs: { epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'KVD2002', units: 'm' },
  sourceEvidence: [], surveyControls: [], points: [], surfaces: [],
  alignments: [{ id: 'road-a', name: 'Road A', segments: [
    { id: 'road-a-line', kind: 'line', startM: [0, 0], endM: [100, 0], startStationM: 0 },
    { id: 'road-a-arc', kind: 'arc', centerM: [100, 25], radiusM: 25, startAngleDeg: -90, endAngleDeg: 0, clockwise: false, startStationM: 100 },
    { id: 'road-a-spiral', kind: 'spiral', startM: [125, 25], endM: [150, 25], startRadiusM: null, endRadiusM: 120, startStationM: endSpiral },
    { id: 'road-a-end', kind: 'line', startM: [150, 25], endM: [200, 25], startStationM: endAlignment },
  ] }],
  profiles: [{ id: 'road-a-pvi', alignmentId: 'road-a', kind: 'proposed', points: [{ stationM: 0, elevationM: 10 }, { stationM: 100, elevationM: 10.5 }, { stationM: profileEnd, elevationM: 11 }] }],
  crossSections: [], corridors: [], drainageNodes: [], drainageLinks: [], catchments: [], structures: [], stages: [],
});
const revisionValue = { workspace: 'civil-profile', revision: 4 };
const revisionSha256 = designRevisionSha256(revisionValue);
const exportArtifact = () => exportCivilProfileArtifact({ projectId: 'project-1', revisionId: 'civil:r4', revisionValue, expectedRevisionId: 'civil:r4', expectedRevisionSha256: revisionSha256, document: makeDocument() });
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

describe('civil internal alignment/profile artifact', () => {
  it('preserves line/arc/spiral stable ids, coverage and PVI deterministically', () => {
    const first = exportArtifact(); const second = exportArtifact();
    expect(new TextDecoder().decode(first.bytes)).toBe(new TextDecoder().decode(second.bytes));
    expect(first.payload.alignments[0]?.segments.map((segment) => [segment.id, segment.kind])).toEqual([['road-a-line', 'line'], ['road-a-arc', 'arc'], ['road-a-spiral', 'spiral'], ['road-a-end', 'line']]);
    expect(first.payload.alignments[0]?.endStationM).toBe(endAlignment + 50);
    expect(first.payload.profiles[0]?.points.map((point) => point.stationM)).toEqual([0, 100, profileEnd]);
    const parsed = parseCivilProfileArtifact(first.bytes);
    expect(verifyCivilProfileArtifact({ artifact: parsed, document: makeDocument(), projectId: 'project-1', revisionId: 'civil:r4', revisionSha256 })).toEqual({ status: 'passed', verifierId: 'civil-profile-structural.v1', issues: [] });
  });

  it('fails closed for stale, missing, duplicate, deep unknown, non-finite, malformed UTF-8 and terminal spiral data', () => {
    expect(() => exportCivilProfileArtifact({ ...exportArtifactInput(), revisionId: 'civil:r3' })).toThrow('CIVIL_PROFILE_STALE_REVISION');
    const missing = makeDocument(); missing.profiles = [];
    expect(() => exportCivilProfileArtifact({ ...exportArtifactInput(), document: missing })).toThrow('CIVIL_PROFILE_DATA_REQUIRED');
    const terminal = makeDocument(); terminal.alignments[0]!.segments.pop();
    expect(() => exportCivilProfileArtifact({ ...exportArtifactInput(), document: terminal })).toThrow('CIVIL_PROFILE_TERMINAL_SPIRAL_COVERAGE_UNKNOWN');
    const artifact = exportArtifact(); const envelope = JSON.parse(new TextDecoder().decode(artifact.bytes)) as Record<string, any>;
    const duplicate = structuredClone(envelope); duplicate.payload.alignments[0].segments[1].id = duplicate.payload.alignments[0].segments[0].id;
    expect(() => parseCivilProfileArtifact(new TextEncoder().encode(canonicalDesignJson(duplicate)))).toThrow('CIVIL_PROFILE_ARTIFACT_INVALID');
    const unknown = structuredClone(envelope); unknown.payload.profiles[0].points[0].unknown = true;
    expect(() => parseCivilProfileArtifact(new TextEncoder().encode(canonicalDesignJson(unknown)))).toThrow('CIVIL_PROFILE_ARTIFACT_INVALID');
    expect(() => parseCivilProfileArtifact(Uint8Array.from([123, 34, 255, 34, 58, 48, 125]))).toThrow('CIVIL_PROFILE_ARTIFACT_JSON_INVALID');
  });

  it('binds source/parser/verifier bytes and rejects hash/cardinality/geometry tampering', () => {
    const artifact = exportArtifact(); const parsed = parseCivilProfileArtifact(artifact.bytes); const outputBytes = new TextEncoder().encode(canonicalDesignJson(parsed.payload));
    const exporterSourceBytes = new TextEncoder().encode('civil-profile-exporter-source'); const parserSourceBytes = new TextEncoder().encode('civil-profile-parser-source'); const verifierEvidenceBytes = new TextEncoder().encode(canonicalDesignJson({ exporterId: 'scripts/drawing-to-3d/civil-profile-export.mjs', parserId: 'scripts/drawing-to-3d/civil-profile-import.mjs', verifierId: 'scripts/drawing-to-3d/civil-profile-probe.mjs', stableIds: { alignments: ['road-a'], segments: ['road-a-line', 'road-a-arc', 'road-a-spiral', 'road-a-end'], profiles: ['road-a-pvi'], pvis: ['road-a-pvi:pvi-0000', 'road-a-pvi:pvi-0001', 'road-a-pvi:pvi-0002'] }, alignmentStationCoverageM: [{ id: 'road-a', startStationM: 0, endStationM: profileEnd }], profileStationCoverageM: [{ id: 'road-a-pvi', alignmentId: 'road-a', startStationM: 0, endStationM: profileEnd }], requiredArtifactKinds: [], externalInteroperability: 'HOLD', nativeFormats: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false }));
    const stableIds = { alignments: ['road-a'], segments: ['road-a-line', 'road-a-arc', 'road-a-spiral', 'road-a-end'], profiles: ['road-a-pvi'], pvis: ['road-a-pvi:pvi-0000', 'road-a-pvi:pvi-0001', 'road-a-pvi:pvi-0002'] };
    const evidenceBytes = buildCivilProfileProbeReceipt({ artifact, exporterId: 'scripts/drawing-to-3d/civil-profile-export.mjs', exporterSourceSha256: hash(exporterSourceBytes), parserId: 'scripts/drawing-to-3d/civil-profile-import.mjs', parserSourceSha256: hash(parserSourceBytes), parserResult: { status: 'verified', sourceArtifactSha256: artifact.artifactSha256, outputBytes, stableIds }, verifierEvidenceBytes });
    const claimInput = { artifact, evidenceBytes, exporterSourceBytes, parserSourceBytes, parserOutputBytes: outputBytes, verifierEvidenceBytes };
    expect(claimCivilProfileProbe(claimInput)).toMatchObject({ claim: 'internal-profile-verified', requiredArtifactKinds: [], externalInteroperability: 'HOLD', nativeFormats: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false });
    expect(() => claimCivilProfileProbe({ ...claimInput, parserOutputBytes: new TextEncoder().encode('tampered') })).toThrow('CIVIL_PROFILE_EVIDENCE_BINDING_MISMATCH');
    expect(() => buildCivilProfileProbeReceipt({ artifact, exporterId: 'scripts/drawing-to-3d/civil-profile-export.mjs', exporterSourceSha256: hash(exporterSourceBytes), parserId: 'scripts/drawing-to-3d/civil-profile-import.mjs', parserSourceSha256: hash(parserSourceBytes), parserResult: { status: 'verified', sourceArtifactSha256: artifact.artifactSha256, outputBytes, stableIds }, verifierEvidenceBytes: new TextEncoder().encode('{') })).toThrow('CIVIL_PROFILE_PROBE_RESULT_MISMATCH');
    const promotedEvidence = JSON.parse(new TextDecoder().decode(verifierEvidenceBytes)) as Record<string, unknown>; promotedEvidence.releaseReady = true;
    expect(() => buildCivilProfileProbeReceipt({ artifact, exporterId: 'scripts/drawing-to-3d/civil-profile-export.mjs', exporterSourceSha256: hash(exporterSourceBytes), parserId: 'scripts/drawing-to-3d/civil-profile-import.mjs', parserSourceSha256: hash(parserSourceBytes), parserResult: { status: 'verified', sourceArtifactSha256: artifact.artifactSha256, outputBytes, stableIds }, verifierEvidenceBytes: new TextEncoder().encode(canonicalDesignJson(promotedEvidence)) })).toThrow('CIVIL_PROFILE_PROBE_RESULT_MISMATCH');
    const geometry = makeDocument(); const line = geometry.alignments[0]!.segments[0]; if (line.kind !== 'arc') line.endM = [101, 0];
    expect(verifyCivilProfileArtifact({ artifact: parsed, document: geometry, projectId: 'project-1', revisionId: 'civil:r4', revisionSha256 })).toMatchObject({ status: 'failed', issues: expect.arrayContaining(['source_document_hash_mismatch']) });
  });

  it('replays the checked-in exporter/parser/probe and rebinds every raw evidence byte in the TS claim path', () => {
    const root = resolve(process.cwd());
    const probe = JSON.parse(execFileSync(process.execPath, ['scripts/drawing-to-3d/civil-profile-probe.mjs'], { cwd: root, encoding: 'utf8' })) as Record<string, unknown>;
    const bytes = (key: string) => Buffer.from(String(probe[key]), 'base64');
    const artifactBytes = bytes('artifactBase64'); const parserOutputBytes = bytes('parserOutputBase64'); const verifierEvidenceBytes = bytes('verifierEvidenceBase64');
    expect(hash(artifactBytes)).toBe(probe.artifactSha256); expect(hash(parserOutputBytes)).toBe(probe.parserOutputSha256); expect(hash(verifierEvidenceBytes)).toBe(probe.verifierEvidenceSha256);
    const exporterSourceBytes = readFileSync(resolve(String(probe.exporterId))); const parserSourceBytes = readFileSync(resolve(String(probe.parserId)));
    expect(hash(exporterSourceBytes)).toBe(probe.exporterSourceSha256); expect(hash(parserSourceBytes)).toBe(probe.parserSourceSha256);
    const parsed = parseCivilProfileArtifact(artifactBytes);
    const artifact = { payload: parsed.payload, contentHash: parsed.contentHash, bytes: artifactBytes, artifactSha256: hash(artifactBytes), artifactName: 'civil-profiles.json', artifactMime: 'application/json' as const, sourceDocumentSha256: parsed.payload.binding.sourceDocumentSha256 };
    const evidenceBytes = buildCivilProfileProbeReceipt({ artifact, exporterId: String(probe.exporterId), exporterSourceSha256: String(probe.exporterSourceSha256), parserId: String(probe.parserId), parserSourceSha256: String(probe.parserSourceSha256), parserResult: { status: 'verified', sourceArtifactSha256: artifact.artifactSha256, outputBytes: parserOutputBytes, stableIds: probe.stableIds as any }, verifierEvidenceBytes });
    const claim = claimCivilProfileProbe({ artifact, evidenceBytes, exporterSourceBytes, parserSourceBytes, parserOutputBytes, verifierEvidenceBytes });
    expect(claim).toMatchObject({ claim: 'internal-profile-verified', verifierId: 'scripts/drawing-to-3d/civil-profile-probe.mjs', requiredArtifactKinds: [], releaseReady: false });
    expect(() => claimCivilProfileProbe({ artifact, evidenceBytes, exporterSourceBytes: Buffer.from(`${exporterSourceBytes}tampered`), parserSourceBytes, parserOutputBytes, verifierEvidenceBytes })).toThrow('CIVIL_PROFILE_EVIDENCE_BINDING_MISMATCH');
    const tamperedEvidence = JSON.parse(new TextDecoder().decode(evidenceBytes)) as Record<string, unknown>;
    expect(() => claimCivilProfileProbe({ artifact, evidenceBytes: new TextEncoder().encode(canonicalDesignJson({ ...tamperedEvidence, exporterId: 'fake-probe.mjs' })), exporterSourceBytes, parserSourceBytes, parserOutputBytes, verifierEvidenceBytes })).toThrow('CIVIL_PROFILE_EVIDENCE_BINDING_MISMATCH');
  });
});

function exportArtifactInput() { return { projectId: 'project-1', revisionId: 'civil:r4', revisionValue, expectedRevisionId: 'civil:r4', expectedRevisionSha256: revisionSha256, document: makeDocument() }; }
