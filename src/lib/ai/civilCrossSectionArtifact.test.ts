import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import type { CivilDocument } from './civilDocument';
import {
  buildCivilCrossSectionProbeReceipt,
  claimCivilCrossSectionProbe,
  exportCivilCrossSectionArtifact,
  parseCivilCrossSectionArtifact,
  verifyCivilCrossSectionArtifact,
} from './civilCrossSectionArtifact';

const document = (): CivilDocument => ({
  schema: 'nexyfab.civil.v1', revision: 4, coordinateSystemId: 'site',
  crs: { epsg: 5186, horizontalDatum: 'Korea 2000', verticalDatum: 'KVD2002', units: 'm' },
  sourceEvidence: [{ id: 'survey-1', kind: 'survey', sourceRef: 'survey.csv', capturedAt: '2026-08-20T00:00:00Z' }],
  surveyControls: [], points: [], surfaces: [],
  alignments: [{ id: 'road-a', name: 'Road A', segments: [{ id: 'road-a-seg-1', kind: 'line', startM: [0, 0], endM: [100, 0], startStationM: 0 }] }],
  profiles: [], crossSections: [
    { id: 'road-a-xs-010', alignmentId: 'road-a', stationM: 10, points: [{ offsetM: -5, elevationM: 10.1, code: 'ETW' }, { offsetM: 0, elevationM: 10.2, code: 'CL' }, { offsetM: 5, elevationM: 10.1, code: 'ETW' }] },
    { id: 'road-a-xs-000', alignmentId: 'road-a', stationM: 0, points: [{ offsetM: -5, elevationM: 10, code: 'ETW' }, { offsetM: 0, elevationM: 10.1, code: 'CL' }, { offsetM: 5, elevationM: 10, code: 'ETW' }] },
  ],
  corridors: [], drainageNodes: [], drainageLinks: [], catchments: [], structures: [], stages: [],
});

const revisionValue = { workspace: 'civil-cross-section', revision: 4 };
const revisionSha256 = designRevisionSha256(revisionValue);
const bytesSha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const exportArtifact = () => exportCivilCrossSectionArtifact({ projectId: 'project-1', revisionId: 'civil:r4', revisionValue, expectedRevisionId: 'civil:r4', expectedRevisionSha256: revisionSha256, document: document() });

describe('civil internal cross-section artifact', () => {
  it('exports deterministically from real alignments/cross-sections and verifies the binding', () => {
    const first = exportArtifact(), second = exportArtifact();
    expect(new TextDecoder().decode(first.bytes)).toBe(new TextDecoder().decode(second.bytes));
    expect(first.payload.alignments.map(item => item.id)).toEqual(['road-a']);
    expect(first.payload.crossSections.map(item => item.id)).toEqual(['road-a-xs-000', 'road-a-xs-010']);
    expect(first.payload.crossSections.map(item => item.stationM)).toEqual([0, 10]);
    expect(first.payload.crossSections.map(item => item.pointCount)).toEqual([3, 3]);
    const parsed = parseCivilCrossSectionArtifact(first.bytes);
    expect(verifyCivilCrossSectionArtifact({ artifact: parsed, document: document(), projectId: 'project-1', revisionId: 'civil:r4', revisionSha256 })).toEqual({ status: 'passed', verifierId: 'civil-cross-section-structural.v1', issues: [] });
  });

  it('rejects stale workspace, malformed references, non-finite data, and tampering', () => {
    expect(() => exportCivilCrossSectionArtifact({ projectId: 'project-1', revisionId: 'civil:r3', revisionValue, expectedRevisionId: 'civil:r4', expectedRevisionSha256: revisionSha256, document: document() })).toThrow('CIVIL_CROSS_SECTION_STALE_REVISION');
    const malformed = document(); malformed.crossSections[0]!.alignmentId = 'missing-alignment';
    expect(() => exportCivilCrossSectionArtifact({ projectId: 'project-1', revisionId: 'civil:r4', revisionValue, expectedRevisionId: 'civil:r4', expectedRevisionSha256: revisionSha256, document: malformed })).toThrow('CIVIL_CROSS_SECTION_DOCUMENT_INVALID');
    const nonFinite = document(); nonFinite.crossSections[0]!.points[0]!.elevationM = Number.NaN;
    expect(() => exportCivilCrossSectionArtifact({ projectId: 'project-1', revisionId: 'civil:r4', revisionValue, expectedRevisionId: 'civil:r4', expectedRevisionSha256: revisionSha256, document: nonFinite })).toThrow('CIVIL_CROSS_SECTION_DOCUMENT_INVALID');
    const artifact = exportArtifact();
    const parsedEnvelope = JSON.parse(new TextDecoder().decode(artifact.bytes)) as Record<string, unknown>;
    const tampered = { ...(parsedEnvelope.payload as Record<string, unknown>), counts: { alignmentCount: 99, crossSectionCount: 2, pointCount: 6 } };
    const tamperedBytes = new TextEncoder().encode(canonicalDesignJson({ payload: tampered, contentHash: parsedEnvelope.contentHash }));
    expect(() => parseCivilCrossSectionArtifact(tamperedBytes)).toThrow('CIVIL_CROSS_SECTION_ARTIFACT_INVALID');
    expect(() => parseCivilCrossSectionArtifact(new TextEncoder().encode(JSON.stringify({ payload: parsedEnvelope.payload, contentHash: parsedEnvelope.contentHash })))).toThrow('CIVIL_CROSS_SECTION_ARTIFACT_NON_CANONICAL');
    expect(() => parseCivilCrossSectionArtifact(Uint8Array.from([123, 34, 255, 34, 58, 48, 125]))).toThrow('CIVIL_CROSS_SECTION_ARTIFACT_JSON_INVALID');
  });

  it('binds probe source/parser/artifact hashes and keeps external/field claims closed', () => {
    const artifact = exportArtifact();
    const parsed = parseCivilCrossSectionArtifact(artifact.bytes);
    const outputBytes = new TextEncoder().encode(canonicalDesignJson(parsed.payload));
    const exporterSourceBytes = new TextEncoder().encode('civil-cross-section-exporter-source');
    const parserSourceBytes = new TextEncoder().encode('civil-cross-section-parser-source');
    const verifierEvidenceBytes = new TextEncoder().encode('civil-cross-section-structural.v1:passed');
    const evidenceBytes = buildCivilCrossSectionProbeReceipt({
      artifact, exporterId: 'src/lib/ai/civilCrossSectionArtifact.ts', exporterSourceSha256: bytesSha256(exporterSourceBytes), parserId: 'src/lib/ai/civilCrossSectionArtifact.ts', parserSourceSha256: bytesSha256(parserSourceBytes),
      parserResult: { status: 'verified', sourceArtifactSha256: artifact.artifactSha256, outputBytes, stableIds: { alignments: ['road-a'], crossSections: ['road-a-xs-000', 'road-a-xs-010'], segments: ['road-a-seg-1'] }, stationsM: [0, 10], pointCounts: [3, 3] }, verifierEvidenceBytes,
    });
    const claimInput = { artifact, evidenceBytes, exporterSourceBytes, parserSourceBytes, parserOutputBytes: outputBytes, verifierEvidenceBytes };
    expect(claimCivilCrossSectionProbe(claimInput)).toMatchObject({ claim: 'internal-cross-section-verified', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false });
    const evidence = JSON.parse(new TextDecoder().decode(evidenceBytes)) as Record<string, unknown>;
    expect(() => claimCivilCrossSectionProbe({ ...claimInput, evidenceBytes: new TextEncoder().encode(canonicalDesignJson({ ...evidence, artifactSha256: 'f'.repeat(64) })) })).toThrow('CIVIL_CROSS_SECTION_EVIDENCE_BINDING_MISMATCH');
    expect(() => claimCivilCrossSectionProbe({ ...claimInput, parserOutputBytes: new TextEncoder().encode('tampered-parser-output') })).toThrow('CIVIL_CROSS_SECTION_EVIDENCE_BINDING_MISMATCH');
  });
});
