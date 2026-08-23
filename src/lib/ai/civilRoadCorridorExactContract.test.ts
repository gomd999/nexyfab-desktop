import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalDesignJson, designRevisionSha256 } from '@/lib/designArtifactBinding';
import {
  buildCivilRoadCorridorReceipt,
  claimCivilRoadCorridorReceipt,
  exportCivilRoadCorridorExactArtifact,
  parseCivilRoadCorridorExactArtifact,
  verifyCivilRoadCorridorExact,
  type CivilRoadCorridorInput,
} from './civilRoadCorridorExactContract';

const encoder = new TextEncoder(); const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const revisionValue = { project: 'road-corridor', revision: 5, source: 'survey-tin' }; const workspaceRevisionId = 'road-corridor:r5'; const workspaceContentHash = designRevisionSha256(revisionValue); const arcLength = 100 * Math.PI / 2;
const artifact = (id: string, kind: 'tin' | 'alignment', value: string) => ({ id, kind, bytes: encoder.encode(value) });

function input(): CivilRoadCorridorInput {
  const tinArtifact = artifact('artifact:tin', 'tin', 'TIN-R5'); const alignmentArtifact = artifact('artifact:alignment', 'alignment', 'ALIGNMENT-R5');
  return {
    workspaceRevisionId, expectedWorkspaceRevisionId: workspaceRevisionId, workspaceRevisionValue: revisionValue, expectedWorkspaceContentHash: workspaceContentHash,
    tinArtifact, alignmentArtifact, expectedTinArtifactSha256: sha(tinArtifact.bytes), expectedAlignmentArtifactSha256: sha(alignmentArtifact.bytes),
    crs: { epsg: 5186, horizontalDatum: 'Korea2000', verticalDatum: 'KVD2002' },
    horizontalSegments: [
      { id: 'alignment:line-01', kind: 'line', startStationM: 0, endStationM: 100, startXY: [0, 0], endXY: [100, 0] },
      { id: 'alignment:arc-01', kind: 'arc', startStationM: 100, endStationM: 100 + arcLength, centerXY: [100, 100], radiusM: 100, startAngleDeg: -90, endAngleDeg: 0, clockwise: false },
    ],
    verticalProfile: { id: 'profile:road', points: [{ id: 'pvi:0', stationM: 0, elevationM: 100 }, { id: 'pvi:1', stationM: 100, elevationM: 101 }, { id: 'pvi:2', stationM: 100 + arcLength, elevationM: 102 }] },
    sections: [
      { id: 'section:0', stationM: 0, leftWidthM: 3.5, rightWidthM: 3.5, leftCrossfallPercent: -2, rightCrossfallPercent: 2, leftDaylightSlope: 3, rightDaylightSlope: 3, pavementElevationM: 100 },
      { id: 'section:end', stationM: 100 + arcLength, leftWidthM: 3.5, rightWidthM: 3.5, leftCrossfallPercent: -2, rightCrossfallPercent: 2, leftDaylightSlope: 3, rightDaylightSlope: 3, pavementElevationM: 102 },
    ],
    superelevations: [{ id: 'superelevation:01', startStationM: 100, endStationM: 100 + arcLength, leftCrossfallPercent: -4, rightCrossfallPercent: 4 }],
    tinSamples: [{ id: 'tin-sample:0', stationM: 0, leftGroundElevationM: 99, rightGroundElevationM: 99 }, { id: 'tin-sample:end', stationM: 100 + arcLength, leftGroundElevationM: 100, rightGroundElevationM: 100 }],
    maximumGradePercent: 3, maximumCrossfallPercent: 8,
  };
}

describe('civil road/corridor exact contract', () => {
  it('binds alignment, profile, sections, superelevation and TIN daylight deterministically', () => {
    const first = exportCivilRoadCorridorExactArtifact(input()); const second = exportCivilRoadCorridorExactArtifact(input());
    expect(first.artifactSha256).toBe(second.artifactSha256); expect(first.payload.units).toEqual({ horizontal: 'm', vertical: 'm', station: 'm', slope: '%' }); expect(first.payload.centerline.length).toBeGreaterThan(2); expect(first.payload.daylight[0]!.leftOffsetM).toBeLessThan(-3.5); expect(first.payload.designCriteriaApproval).toBe('HOLD'); expect(first.payload.releaseReady).toBe(false);
    const parsed = parseCivilRoadCorridorExactArtifact(first.bytes, first.payload.binding); expect(verifyCivilRoadCorridorExact({ artifact: parsed, ...first.payload.binding })).toMatchObject({ status: 'passed' });
    const parserOutputBytes = encoder.encode(canonicalDesignJson(parsed)); const verifierEvidenceBytes = encoder.encode(canonicalDesignJson({ schema: 'nexyfab.civil-road-corridor-verification.v1', verifierId: 'civil-road-corridor-structural.v1', status: 'passed', artifactSha256: first.artifactSha256, contentHash: first.contentHash, releaseReady: false })); const receiptBytes = buildCivilRoadCorridorReceipt({ artifact: first, parserOutputBytes, verifierEvidenceBytes }); expect(claimCivilRoadCorridorReceipt({ artifact: first, receiptBytes, parserOutputBytes, verifierEvidenceBytes }).claim).toBe('internal-civil-road-corridor-verified');
  });
  it('rejects station gap/overlap, self-intersection, radius/grade/crossfall and stale artifacts', () => {
    const gap = input(); gap.horizontalSegments[1]!.startStationM = 99; expect(() => exportCivilRoadCorridorExactArtifact(gap)).toThrow('STATION_GAP_OVERLAP');
    const selfCross = input(); selfCross.horizontalSegments[0] = { id: 'alignment:line-01', kind: 'line', startStationM: 0, endStationM: 100, startXY: [0, 0], endXY: [100, 100] }; expect(() => exportCivilRoadCorridorExactArtifact(selfCross)).toThrow('LINE_INVALID');
    const radius = input(); const radiusSegment = radius.horizontalSegments[1]!; if (radiusSegment.kind === 'arc') radiusSegment.radiusM = 50; expect(() => exportCivilRoadCorridorExactArtifact(radius)).toThrow('ARC_STATION_INVALID');
    const grade = input(); grade.verticalProfile.points[1]!.elevationM = 110; expect(() => exportCivilRoadCorridorExactArtifact(grade)).toThrow('GRADE_INVALID');
    const crossfall = input(); crossfall.sections[0]!.leftCrossfallPercent = 20; expect(() => exportCivilRoadCorridorExactArtifact(crossfall)).toThrow('SECTION_INVALID');
    const stale = input(); stale.expectedWorkspaceContentHash = 'c'.repeat(64); expect(() => exportCivilRoadCorridorExactArtifact(stale)).toThrow('STALE_REVISION_HASH');
    const artifactTamper = input(); artifactTamper.tinArtifact.bytes = encoder.encode('TIN-R6'); expect(() => exportCivilRoadCorridorExactArtifact(artifactTamper)).toThrow('STALE_ARTIFACT_HASH');
  });
  it('rejects parser non-canonical/tamper and receipt evidence tamper', () => {
    const exported = exportCivilRoadCorridorExactArtifact(input()); const envelope = JSON.parse(new TextDecoder().decode(exported.bytes)) as { payload: Record<string, unknown>; contentHash: string }; envelope.payload.releaseReady = true; expect(() => parseCivilRoadCorridorExactArtifact(encoder.encode(canonicalDesignJson(envelope)), exported.payload.binding)).toThrow('INVALID'); expect(() => parseCivilRoadCorridorExactArtifact(encoder.encode(`${new TextDecoder().decode(exported.bytes)}\n`))).toThrow('NON_CANONICAL');
    const parsed = parseCivilRoadCorridorExactArtifact(exported.bytes); const parserOutputBytes = encoder.encode(canonicalDesignJson(parsed)); const verifierEvidenceBytes = encoder.encode(canonicalDesignJson({ schema: 'nexyfab.civil-road-corridor-verification.v1', verifierId: 'civil-road-corridor-structural.v1', status: 'passed', artifactSha256: exported.artifactSha256, contentHash: exported.contentHash, releaseReady: false })); const receiptBytes = buildCivilRoadCorridorReceipt({ artifact: exported, parserOutputBytes, verifierEvidenceBytes }); expect(() => claimCivilRoadCorridorReceipt({ artifact: exported, receiptBytes, parserOutputBytes: encoder.encode('{"tampered":true}'), verifierEvidenceBytes })).toThrow('PARSER_OUTPUT_MISMATCH');
    const forgedEnvelope = JSON.parse(new TextDecoder().decode(exported.bytes)) as { payload: typeof exported.payload; contentHash: string }; forgedEnvelope.payload.daylight[0]!.leftOffsetM = -999; forgedEnvelope.contentHash = designRevisionSha256(forgedEnvelope.payload); const forgedBytes = encoder.encode(canonicalDesignJson(forgedEnvelope)); const forged = { ...exported, payload: forgedEnvelope.payload, contentHash: forgedEnvelope.contentHash, bytes: forgedBytes, artifactSha256: sha(forgedBytes) }; const forgedParsed = parseCivilRoadCorridorExactArtifact(forgedBytes); expect(verifyCivilRoadCorridorExact({ artifact: forgedParsed, ...forged.payload.binding })).toMatchObject({ status: 'failed', issues: expect.arrayContaining(['road_corridor_daylight_computation_mismatch']) }); expect(() => buildCivilRoadCorridorReceipt({ artifact: forged, parserOutputBytes: encoder.encode(canonicalDesignJson(forgedParsed)), verifierEvidenceBytes })).toThrow('VERIFICATION_FAILED');
  });
  it('pairs daylight TIN samples by station rather than array position', () => {
    const value = input();
    value.tinSamples.reverse();
    const originalOrder = value.tinSamples.map(sample => sample.id);
    const exported = exportCivilRoadCorridorExactArtifact(value);
    expect(exported.payload.daylight.find(item => item.stationM === 0)?.leftGroundElevationM).toBe(99);
    expect(value.tinSamples.map(sample => sample.id)).toEqual(originalOrder);
  });
});
