import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../scripts/drawing-to-3d/interior-ffe-schedule-export.mjs';
import { parseInteriorFfeSchedule } from '../../../scripts/drawing-to-3d/interior-ffe-schedule-import.mjs';
import { bindInteriorFfeScheduleArtifact, buildInteriorFfeScheduleProbeReceipt, claimInteriorFfeScheduleProbe } from './interiorFfeSchedule';

const probePath = 'scripts/drawing-to-3d/interior-ffe-schedule-probe.mjs';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Probe = {
  capabilityId: 'interior.ffe.schedule'; format: 'schedule'; workspaceRevisionId: string; workspaceContentHash: string; architectureRevision: number; architectureContentHash: string; interiorRevision: number; interiorContentHash: string;
  exporterId: string; parserId: string; verifierId: string; artifactSha256: string; artifactBytes: number; artifactBase64: string; parserOutputBase64: string; verifierEvidenceBase64: string; parsedRowCount: number; parsedObjectCount: number; stableIds: { spaces: string[]; furniture: string[]; rows: string[] }; counts: { spaceCount: number; furnitureCount: number; rowCount: number; objectCount: number };
};
const runProbe = () => JSON.parse(execFileSync(process.execPath, [probePath], { encoding: 'utf8' })) as Probe;
const sourceBytes = (probe: Probe) => ({ exporterSourceBytes: readFileSync(probe.exporterId), parserSourceBytes: readFileSync(probe.parserId), parserOutputBytes: Buffer.from(probe.parserOutputBase64, 'base64'), verifierEvidenceBytes: Buffer.from(probe.verifierEvidenceBase64, 'base64') });

describe('interior FF&E schedule Wave 4 slice', () => {
  it('runs actual exporter to independent parser and binds space-hosted furniture geometry', () => {
    const probe = runProbe();
    const artifactBytes = Buffer.from(probe.artifactBase64, 'base64');
    expect(sha256(artifactBytes)).toBe(probe.artifactSha256);
    expect(probe.counts).toEqual({ spaceCount: 2, furnitureCount: 3, rowCount: 3, objectCount: 3 });
    expect(probe.stableIds.furniture).toEqual(['ffe-chair-office', 'ffe-desk-office', 'ffe-lounge-lobby']);
    const binding = bindInteriorFfeScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'probe-project', workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash, architectureRevision: probe.architectureRevision, architectureContentHash: probe.architectureContentHash, interiorRevision: probe.interiorRevision, interiorContentHash: probe.interiorContentHash, artifactName: 'ffe-schedule.json', artifactMime: 'application/json', bytes: artifactBytes });
    const sources = sourceBytes(probe);
    const evidenceBytes = buildInteriorFfeScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: sources.parserOutputBytes, counts: probe.counts, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: sources.verifierEvidenceBytes });
    expect(claimInteriorFfeScheduleProbe({ binding, evidenceBytes, ...sources })).toMatchObject({ claim: 'internal-ffe-schedule-probe-verified', counts: probe.counts, nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', priceEvidence: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false });
  });

  it('fails closed for unknown keys, duplicate IDs, missing hosts, geometry, stale hashes, and invalid UTF-8', () => {
    const probe = runProbe();
    const bytes = Buffer.from(probe.artifactBase64, 'base64');
    const artifact = JSON.parse(bytes.toString('utf8')) as Record<string, any>;
    expect(() => parseInteriorFfeSchedule(new TextEncoder().encode(canonicalJson({ ...artifact, unexpected: true })))).toThrow('ARTIFACT_UNKNOWN_KEY');
    const duplicate = structuredClone(artifact); duplicate.furniture.push({ ...duplicate.furniture[0] }); duplicate.rows.push({ ...duplicate.rows[0] });
    expect(() => parseInteriorFfeSchedule(new TextEncoder().encode(canonicalJson(duplicate)))).toThrow('DUPLICATE_ID');
    const missingHost = structuredClone(artifact); missingHost.furniture[0].spaceId = 'space-missing'; missingHost.rows[0].spaceId = 'space-missing';
    expect(() => parseInteriorFfeSchedule(new TextEncoder().encode(canonicalJson(missingHost)))).toThrow('FURNITURE_HOST_SPACE');
    const invalidGeometry = structuredClone(artifact); invalidGeometry.furniture[0].sizeMm[0] = 0; invalidGeometry.rows[0].sizeMm[0] = 0;
    expect(() => parseInteriorFfeSchedule(new TextEncoder().encode(canonicalJson(invalidGeometry)))).toThrow('FURNITURE_SIZE_GEOMETRY');
    expect(() => parseInteriorFfeSchedule(new Uint8Array([0xc3, 0x28]))).toThrow('UTF8_INVALID');
    expect(() => parseInteriorFfeSchedule(bytes, { workspaceRevisionId: 'stale' })).toThrow('REVISION_MISMATCH');
    expect(() => parseInteriorFfeSchedule(bytes, { architectureRevision: probe.architectureRevision + 1 })).toThrow('ARCHITECTURE_REVISION_MISMATCH');
    expect(() => parseInteriorFfeSchedule(bytes, { interiorContentHash: 'f'.repeat(64) })).toThrow('INTERIOR_CONTENT_HASH_MISMATCH');
  });

  it('re-hashes actual exporter/parser/output/evidence bytes and rejects promoted truth or tampering', () => {
    const probe = runProbe();
    const artifactBytes = Buffer.from(probe.artifactBase64, 'base64');
    const binding = bindInteriorFfeScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash, architectureRevision: probe.architectureRevision, architectureContentHash: probe.architectureContentHash, interiorRevision: probe.interiorRevision, interiorContentHash: probe.interiorContentHash, artifactName: 'schedule.json', artifactMime: 'application/json', bytes: artifactBytes, expectedArtifactSha256: probe.artifactSha256 });
    const sources = sourceBytes(probe);
    const evidence = buildInteriorFfeScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: sources.parserOutputBytes, counts: probe.counts, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: sources.verifierEvidenceBytes });
    const staleParserOutput = JSON.parse(new TextDecoder().decode(sources.parserOutputBytes)); staleParserOutput.workspaceRevisionId = 'stale-revision';
    expect(() => buildInteriorFfeScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: new TextEncoder().encode(canonicalJson(staleParserOutput)), counts: probe.counts, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: sources.verifierEvidenceBytes })).toThrow('RESULT_MISMATCH');
    const wrongVerifierSource = JSON.parse(new TextDecoder().decode(sources.verifierEvidenceBytes)); wrongVerifierSource.parserId = 'scripts/drawing-to-3d/wrong-parser.mjs';
    expect(() => buildInteriorFfeScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: sources.parserOutputBytes, counts: probe.counts, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: new TextEncoder().encode(canonicalJson(wrongVerifierSource)) })).toThrow('RESULT_MISMATCH');
    const promoted = JSON.parse(new TextDecoder().decode(evidence));
    expect(() => claimInteriorFfeScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson({ ...promoted, releaseReady: true })), ...sources })).toThrow('EVIDENCE_BINDING_MISMATCH');
    expect(() => claimInteriorFfeScheduleProbe({ binding, evidenceBytes: new Uint8Array([0xc3, 0x28]), ...sources })).toThrow('EVIDENCE_INVALID_UTF8');
    for (const key of ['exporterSourceBytes', 'parserSourceBytes', 'parserOutputBytes', 'verifierEvidenceBytes'] as const) expect(() => claimInteriorFfeScheduleProbe({ binding, evidenceBytes: evidence, ...sources, [key]: new Uint8Array([1, 2, 3]) })).toThrow('EVIDENCE_BINDING_MISMATCH');
  });
});
