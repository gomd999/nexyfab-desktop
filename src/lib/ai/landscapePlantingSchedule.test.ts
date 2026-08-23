import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../scripts/drawing-to-3d/landscape-planting-schedule-export.mjs';
import { parseLandscapePlantingSchedule } from '../../../scripts/drawing-to-3d/landscape-planting-schedule-import.mjs';
import { bindLandscapePlantingScheduleArtifact, buildLandscapePlantingScheduleProbeReceipt, claimLandscapePlantingScheduleProbe } from './landscapePlantingSchedule';

const probePath = 'scripts/drawing-to-3d/landscape-planting-schedule-probe.mjs';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Probe = {
  capabilityId: 'landscape.planting.schedule.internal'; format: 'schedule'; workspaceRevisionId: string; workspaceContentHash: string;
  exporterId: string; exporterSourceSha256: string; parserId: string; parserSourceSha256: string; verifierId: string;
  artifactSha256: string; artifactBytes: number; artifactBase64: string; parserOutputSha256: string; parserOutputBase64: string;
  verifierEvidenceSha256: string; verifierEvidenceBase64: string; parsedRowCount: number; parsedObjectCount: number;
  stableIds: { plants: string[]; plantingZones: string[]; soilVolumes: string[]; rows: string[] };
};
const runProbe = () => JSON.parse(execFileSync(process.execPath, [probePath], { encoding: 'utf8' })) as Probe;
const sourceBytes = (probe: Probe) => ({ exporterSourceBytes: readFileSync(probe.exporterId), parserSourceBytes: readFileSync(probe.parserId), parserOutputBytes: Buffer.from(probe.parserOutputBase64, 'base64'), verifierEvidenceBytes: Buffer.from(probe.verifierEvidenceBase64, 'base64') });

describe('landscape internal planting schedule Wave 4 slice', () => {
  it('runs exporter to independent parser and binds plant/zone/soil IDs plus metrics', () => {
    const probe = runProbe();
    const artifactBytes = Buffer.from(probe.artifactBase64, 'base64');
    const parserOutputBytes = Buffer.from(probe.parserOutputBase64, 'base64');
    const verifierEvidenceBytes = Buffer.from(probe.verifierEvidenceBase64, 'base64');
    expect(sha256(artifactBytes)).toBe(probe.artifactSha256);
    expect(artifactBytes.byteLength).toBe(probe.artifactBytes);
    expect(sha256(parserOutputBytes)).toBe(probe.parserOutputSha256);
    expect(sha256(verifierEvidenceBytes)).toBe(probe.verifierEvidenceSha256);
    expect(probe.stableIds.rows).toHaveLength(probe.parsedRowCount);
    const binding = bindLandscapePlantingScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'probe-project', workspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceContentHash: probe.workspaceContentHash, artifactName: 'planting-schedule.json', artifactMime: 'application/json', bytes: artifactBytes });
    const sources = sourceBytes(probe);
    const evidenceBytes = buildLandscapePlantingScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: parserOutputBytes, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes });
    expect(claimLandscapePlantingScheduleProbe({ binding, evidenceBytes, ...sources })).toMatchObject({ claim: 'internal-planting-schedule-probe-verified', plantCatalogProvenance: 'HOLD', nativeRoundtrip: 'HOLD', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false });
  });

  it('fails closed for tamper, stale revision, unknown shape keys, duplicate IDs, and invalid UTF-8', () => {
    const probe = runProbe();
    const bytes = Buffer.from(probe.artifactBase64, 'base64');
    const artifact = JSON.parse(bytes.toString('utf8')) as Record<string, any>;
    expect(() => parseLandscapePlantingSchedule(canonicalJson({ ...artifact, unexpected: true }), { workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash })).toThrow('ARTIFACT_UNKNOWN_KEY');
    const duplicate = JSON.parse(bytes.toString('utf8')) as Record<string, any>;
    duplicate.plants.push({ ...duplicate.plants[0], id: duplicate.plantingZones[0].id });
    expect(() => parseLandscapePlantingSchedule(canonicalJson(duplicate), { workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash })).toThrow('DUPLICATE_ID');
    const degenerate = JSON.parse(bytes.toString('utf8')) as Record<string, any>;
    degenerate.plantingZones[0].boundaryM = [[0, 0], [1, 0], [2, 0]];
    degenerate.rows.find((row: { objectType: string }) => row.objectType === 'plantingZone').value = degenerate.plantingZones[0];
    expect(() => parseLandscapePlantingSchedule(canonicalJson(degenerate), { workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash })).toThrow('BOUNDARY_DEGENERATE');
    expect(() => parseLandscapePlantingSchedule(new Uint8Array([0xc3, 0x28]), { workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash })).toThrow('UTF8_INVALID');
    expect(() => parseLandscapePlantingSchedule(new Uint8Array(Buffer.from(canonicalJson({ ...artifact, releaseReady: true }), 'utf8')), { workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash })).toThrow('RELEASE_TRUTH');
    expect(() => bindLandscapePlantingScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceRevisionId: 'stale', expectedWorkspaceContentHash: probe.workspaceContentHash, artifactName: 'schedule.json', artifactMime: 'application/json', bytes })).toThrow('LANDSCAPE_PLANTING_SCHEDULE_REVISION_MISMATCH');
    expect(() => bindLandscapePlantingScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceContentHash: probe.workspaceContentHash, expectedArtifactSha256: 'f'.repeat(64), artifactName: 'schedule.json', artifactMime: 'application/json', bytes })).toThrow('LANDSCAPE_PLANTING_SCHEDULE_ARTIFACT_HASH_MISMATCH');
  });

  it('rejects edited graph references and evidence status promotion', () => {
    const probe = runProbe();
    const artifact = JSON.parse(Buffer.from(probe.artifactBase64, 'base64').toString('utf8')) as Record<string, any>;
    artifact.plantingZones[0].plantIds = ['missing-plant'];
    const editedRow = artifact.rows.find((row: { id: string }) => row.id === artifact.plantingZones[0].id);
    editedRow.value = artifact.plantingZones[0];
    expect(() => parseLandscapePlantingSchedule(canonicalJson(artifact), { workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash })).toThrow('PLANTING_ZONE_REFERENCE');
    const bytes = Buffer.from(probe.artifactBase64, 'base64');
    const binding = bindLandscapePlantingScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceRevisionId: probe.workspaceRevisionId, expectedWorkspaceContentHash: probe.workspaceContentHash, artifactName: 'schedule.json', artifactMime: 'application/json', bytes });
    const sources = sourceBytes(probe);
    const evidence = JSON.parse(new TextDecoder().decode(buildLandscapePlantingScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: sources.parserOutputBytes, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: sources.verifierEvidenceBytes }))) as Record<string, unknown>;
    expect(() => claimLandscapePlantingScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson({ ...evidence, releaseReady: true })), ...sources })).toThrow('EVIDENCE_BINDING_MISMATCH');
    expect(() => claimLandscapePlantingScheduleProbe({ binding, evidenceBytes: new Uint8Array([0xc3, 0x28]), ...sources })).toThrow('EVIDENCE_INVALID_UTF8');
    expect(() => claimLandscapePlantingScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson(evidence)), ...sources, exporterSourceBytes: new Uint8Array([1]) })).toThrow('EVIDENCE_BINDING_MISMATCH');
    expect(() => claimLandscapePlantingScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson(evidence)), ...sources, parserSourceBytes: new Uint8Array([4]) })).toThrow('EVIDENCE_BINDING_MISMATCH');
    expect(() => claimLandscapePlantingScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson(evidence)), ...sources, parserOutputBytes: new Uint8Array([2]) })).toThrow('EVIDENCE_BINDING_MISMATCH');
    expect(() => claimLandscapePlantingScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson(evidence)), ...sources, verifierEvidenceBytes: new Uint8Array([3]) })).toThrow('EVIDENCE_BINDING_MISMATCH');
  });
});
