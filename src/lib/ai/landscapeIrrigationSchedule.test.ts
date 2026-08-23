import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../scripts/drawing-to-3d/landscape-irrigation-schedule-export.mjs';
import { parseLandscapeIrrigationSchedule } from '../../../scripts/drawing-to-3d/landscape-irrigation-schedule-import.mjs';
import {
  bindLandscapeIrrigationScheduleArtifact,
  buildLandscapeIrrigationScheduleProbeReceipt,
  claimLandscapeIrrigationScheduleProbe,
} from './landscapeIrrigationSchedule';

// The executable probe imports the checked-in exporter and independent parser.
const probePath = 'scripts/drawing-to-3d/landscape-irrigation-schedule-probe.mjs';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Probe = {
  capabilityId: 'landscape.irrigation.schedule.internal'; format: 'schedule'; workspaceRevisionId: string; workspaceContentHash: string;
  exporterId: string; exporterSourceSha256: string; parserId: string; parserSourceSha256: string; verifierId: string;
  artifactSha256: string; artifactBytes: number; artifactBase64: string; parserOutputSha256: string; parserOutputBase64: string;
  verifierEvidenceSha256: string; verifierEvidenceBase64: string; parsedRowCount: number; parsedObjectCount: number;
  stableIds: { nodes: string[]; pipes: string[]; zones: string[]; rows: string[] };
};
const runProbe = () => JSON.parse(execFileSync(process.execPath, [probePath], { encoding: 'utf8' })) as Probe;

describe('landscape internal irrigation schedule Wave 4 slice', () => {
  it('runs the actual exporter/parser and binds exact IDs/counts to workspace content', () => {
    const probe = runProbe();
    const artifactBytes = Buffer.from(probe.artifactBase64, 'base64');
    const parserOutputBytes = Buffer.from(probe.parserOutputBase64, 'base64');
    const verifierEvidenceBytes = Buffer.from(probe.verifierEvidenceBase64, 'base64');
    expect(sha256(artifactBytes)).toBe(probe.artifactSha256);
    expect(artifactBytes.byteLength).toBe(probe.artifactBytes);
    expect(sha256(parserOutputBytes)).toBe(probe.parserOutputSha256);
    expect(sha256(verifierEvidenceBytes)).toBe(probe.verifierEvidenceSha256);
    expect(probe.parsedRowCount).toBe(probe.parsedObjectCount);
    expect(probe.stableIds.rows).toHaveLength(probe.parsedRowCount);
    const binding = bindLandscapeIrrigationScheduleArtifact({
      capabilityId: probe.capabilityId, projectId: 'probe-project', workspaceRevisionId: probe.workspaceRevisionId,
      expectedWorkspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceContentHash: probe.workspaceContentHash,
      artifactName: 'irrigation-schedule.json', artifactMime: 'application/json', bytes: artifactBytes,
    });
    const evidenceBytes = buildLandscapeIrrigationScheduleProbeReceipt({
      binding, exporterId: probe.exporterId, exporterSourceSha256: probe.exporterSourceSha256,
      parserId: probe.parserId, parserSourceSha256: probe.parserSourceSha256,
      parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: parserOutputBytes, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds },
      verifierId: probe.verifierId, verifierEvidenceBytes,
    });
    expect(claimLandscapeIrrigationScheduleProbe({ binding, evidenceBytes })).toMatchObject({
      claim: 'internal-schedule-probe-verified', releaseReady: false, hydraulicEvidence: 'NOT_RUN', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN',
    });
  });

  it('fails closed for artifact tampering and revision/content mismatch', () => {
    const probe = runProbe();
    const bytes = Buffer.from(probe.artifactBase64, 'base64');
    const content = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    const tamperedBytes = Buffer.from(JSON.stringify({ ...content, releaseReady: true }), 'utf8');
    expect(() => bindLandscapeIrrigationScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceContentHash: probe.workspaceContentHash, artifactName: 'schedule.json', artifactMime: 'application/json', bytes: tamperedBytes })).not.toThrow();
    expect(sha256(tamperedBytes)).not.toBe(probe.artifactSha256);
    expect(() => bindLandscapeIrrigationScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceContentHash: probe.workspaceContentHash, artifactName: 'schedule.json', artifactMime: 'application/json', bytes: tamperedBytes, expectedArtifactSha256: probe.artifactSha256 })).toThrow('LANDSCAPE_IRRIGATION_SCHEDULE_ARTIFACT_HASH_MISMATCH');
    expect(() => bindLandscapeIrrigationScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceRevisionId: 'stale', expectedWorkspaceContentHash: probe.workspaceContentHash, artifactName: 'schedule.json', artifactMime: 'application/json', bytes })).toThrow('LANDSCAPE_IRRIGATION_SCHEDULE_REVISION_MISMATCH');
    expect(() => bindLandscapeIrrigationScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceContentHash: 'a'.repeat(64), workspaceRevisionValue: { changed: true }, artifactName: 'schedule.json', artifactMime: 'application/json', bytes })).toThrow('LANDSCAPE_IRRIGATION_SCHEDULE_CONTENT_HASH_MISMATCH');
    const binding = bindLandscapeIrrigationScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceContentHash: probe.workspaceContentHash, artifactName: 'schedule.json', artifactMime: 'application/json', bytes });
    const evidence = JSON.parse(new TextDecoder().decode(buildLandscapeIrrigationScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceSha256: probe.exporterSourceSha256, parserId: probe.parserId, parserSourceSha256: probe.parserSourceSha256, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: Buffer.from(probe.parserOutputBase64, 'base64'), parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: Buffer.from(probe.verifierEvidenceBase64, 'base64') }))) as Record<string, unknown>;
    expect(() => claimLandscapeIrrigationScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(JSON.stringify({ ...evidence, artifactSha256: 'b'.repeat(64) })) })).toThrow('LANDSCAPE_IRRIGATION_SCHEDULE_EVIDENCE_BINDING_MISMATCH');
    expect(() => claimLandscapeIrrigationScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson({ ...evidence, stableIds: { ...(evidence.stableIds as Record<string, unknown>), rows: [...(evidence.stableIds as { rows: string[] }).rows.slice(0, -1), (evidence.stableIds as { rows: string[] }).rows[0]] } })) })).toThrow('LANDSCAPE_IRRIGATION_SCHEDULE_EVIDENCE_BINDING_MISMATCH');
    expect(() => claimLandscapeIrrigationScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson({ ...evidence, parsedRowCount: (evidence.parsedRowCount as number) + 1 })) })).toThrow('LANDSCAPE_IRRIGATION_SCHEDULE_EVIDENCE_BINDING_MISMATCH');
  });

  it('uses the independent parser to reject consistently edited but invalid graph content', () => {
    const probe = runProbe();
    const artifact = JSON.parse(Buffer.from(probe.artifactBase64, 'base64').toString('utf8')) as Record<string, any>;
    const pipe = artifact.pipes[0];
    pipe.fromNodeId = 'missing-node';
    const editedRow = artifact.rows.find((row: { id: string }) => row.id === pipe.id);
    editedRow.value = pipe;
    expect(() => parseLandscapeIrrigationSchedule(canonicalJson(artifact), { workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash })).toThrow('PIPE_ENDPOINT_MISMATCH');
    const duplicateMember = JSON.parse(Buffer.from(probe.artifactBase64, 'base64').toString('utf8')) as Record<string, any>;
    duplicateMember.zones[0].emitterNodeIds.push(duplicateMember.zones[0].emitterNodeIds[0]);
    const zoneRow = duplicateMember.rows.find((row: { id: string }) => row.id === duplicateMember.zones[0].id);
    zoneRow.value = duplicateMember.zones[0];
    expect(() => parseLandscapeIrrigationSchedule(canonicalJson(duplicateMember), { workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash })).toThrow('ZONE_DUPLICATE_MEMBER');
  });
});
