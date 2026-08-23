import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../scripts/drawing-to-3d/interior-finish-schedule-export.mjs';
import { parseInteriorFinishSchedule } from '../../../scripts/drawing-to-3d/interior-finish-schedule-import.mjs';
import { bindInteriorFinishScheduleArtifact, buildInteriorFinishScheduleProbeReceipt, claimInteriorFinishScheduleProbe } from './interiorFinishSchedule';

const probePath = 'scripts/drawing-to-3d/interior-finish-schedule-probe.mjs';
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Probe = {
  capabilityId: 'interior.finish.schedule'; format: 'schedule'; workspaceRevisionId: string; workspaceContentHash: string; architectureRevision: number; architectureContentHash: string; interiorRevision: number; interiorContentHash: string;
  exporterId: string; parserId: string; verifierId: string; artifactSha256: string; artifactBytes: number; artifactBase64: string; parserOutputBase64: string; verifierEvidenceBase64: string; parsedRowCount: number; parsedObjectCount: number; stableIds: { spaces: string[]; finishes: string[]; rows: string[] };
};
const runProbe = () => JSON.parse(execFileSync(process.execPath, [probePath], { encoding: 'utf8' })) as Probe;
const sourceBytes = (probe: Probe) => ({ exporterSourceBytes: readFileSync(probe.exporterId), parserSourceBytes: readFileSync(probe.parserId), parserOutputBytes: Buffer.from(probe.parserOutputBase64, 'base64'), verifierEvidenceBytes: Buffer.from(probe.verifierEvidenceBase64, 'base64') });

describe('interior finish schedule Wave 4 slice', () => {
  it('runs exporter to independent parser and binds workspace/space/finish/host IDs', () => {
    const probe = runProbe();
    const artifactBytes = Buffer.from(probe.artifactBase64, 'base64');
    expect(sha256(artifactBytes)).toBe(probe.artifactSha256);
    expect(probe.stableIds.spaces).toHaveLength(2);
    expect(probe.stableIds.rows).toHaveLength(probe.parsedRowCount);
    const binding = bindInteriorFinishScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'probe-project', workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash, architectureRevision: probe.architectureRevision, architectureContentHash: probe.architectureContentHash, interiorRevision: probe.interiorRevision, interiorContentHash: probe.interiorContentHash, artifactName: 'finish-schedule.json', artifactMime: 'application/json', bytes: artifactBytes });
    const sources = sourceBytes(probe);
    const evidenceBytes = buildInteriorFinishScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: sources.parserOutputBytes, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: sources.verifierEvidenceBytes });
    expect(claimInteriorFinishScheduleProbe({ binding, evidenceBytes, ...sources })).toMatchObject({ claim: 'internal-finish-schedule-probe-verified', nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false });
  });

  it('fails closed for duplicate/missing host, stale, unknown, non-canonical, and invalid UTF-8 input', () => {
    const probe = runProbe();
    const bytes = Buffer.from(probe.artifactBase64, 'base64');
    const artifact = JSON.parse(bytes.toString('utf8')) as Record<string, any>;
    expect(() => parseInteriorFinishSchedule(canonicalJson({ ...artifact, unexpected: true }), { workspaceRevisionId: probe.workspaceRevisionId })).toThrow('ARTIFACT_UNKNOWN_KEY');
    const duplicate = structuredClone(artifact); duplicate.finishes.push({ ...duplicate.finishes[0] }); duplicate.rows.push({ ...duplicate.rows[0] });
    expect(() => parseInteriorFinishSchedule(canonicalJson(duplicate), { workspaceRevisionId: probe.workspaceRevisionId })).toThrow('DUPLICATE_ID');
    const missingHost = structuredClone(artifact); missingHost.finishes[0].hostId = ''; missingHost.rows[0].hostId = '';
    expect(() => parseInteriorFinishSchedule(canonicalJson(missingHost), { workspaceRevisionId: probe.workspaceRevisionId })).toThrow('FINISH_HOST_ID');
    const wrongHost = structuredClone(artifact); wrongHost.finishes[1].hostId = 'ceiling-office'; wrongHost.rows.find((row: { id: string }) => row.id === wrongHost.finishes[1].id).hostId = 'ceiling-office';
    expect(() => parseInteriorFinishSchedule(canonicalJson(wrongHost), { workspaceRevisionId: probe.workspaceRevisionId })).toThrow('FINISH_HOST_ASSOCIATION');
    expect(() => parseInteriorFinishSchedule(new Uint8Array([0xc3, 0x28]), { workspaceRevisionId: probe.workspaceRevisionId })).toThrow('UTF8_INVALID');
    expect(() => parseInteriorFinishSchedule(canonicalJson(artifact), { workspaceRevisionId: 'stale' })).toThrow('REVISION_MISMATCH');
    expect(() => parseInteriorFinishSchedule(canonicalJson(artifact), { workspaceRevisionId: probe.workspaceRevisionId, architectureRevision: probe.architectureRevision + 1 })).toThrow('ARCHITECTURE_REVISION_MISMATCH');
    expect(() => parseInteriorFinishSchedule(canonicalJson(artifact), { workspaceRevisionId: probe.workspaceRevisionId, architectureContentHash: 'f'.repeat(64) })).toThrow('ARCHITECTURE_CONTENT_HASH_MISMATCH');
    expect(() => bindInteriorFinishScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash, architectureRevision: probe.architectureRevision, architectureContentHash: probe.architectureContentHash, interiorRevision: probe.interiorRevision, interiorContentHash: probe.interiorContentHash, artifactName: 'schedule.json', artifactMime: 'text/plain', bytes })).toThrow('INPUT_INVALID');
  });

  it('re-hashes exporter/parser/output/evidence bytes and rejects tampering or promoted truth', () => {
    const probe = runProbe();
    const artifactBytes = Buffer.from(probe.artifactBase64, 'base64');
    const binding = bindInteriorFinishScheduleArtifact({ capabilityId: probe.capabilityId, projectId: 'p', workspaceRevisionId: probe.workspaceRevisionId, workspaceContentHash: probe.workspaceContentHash, architectureRevision: probe.architectureRevision, architectureContentHash: probe.architectureContentHash, interiorRevision: probe.interiorRevision, interiorContentHash: probe.interiorContentHash, artifactName: 'schedule.json', artifactMime: 'application/json', bytes: artifactBytes });
    const sources = sourceBytes(probe);
    const evidence = buildInteriorFinishScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: sources.parserOutputBytes, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: sources.verifierEvidenceBytes });
    const staleParserOutput = JSON.parse(new TextDecoder().decode(sources.parserOutputBytes)); staleParserOutput.workspaceRevisionId = 'stale-revision';
    expect(() => buildInteriorFinishScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: new TextEncoder().encode(canonicalJson(staleParserOutput)), parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: sources.verifierEvidenceBytes })).toThrow('RESULT_MISMATCH');
    const wrongVerifierSource = JSON.parse(new TextDecoder().decode(sources.verifierEvidenceBytes)); wrongVerifierSource.exporterId = 'scripts/drawing-to-3d/wrong-exporter.mjs';
    expect(() => buildInteriorFinishScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: sources.parserOutputBytes, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: probe.stableIds }, verifierId: probe.verifierId, verifierEvidenceBytes: new TextEncoder().encode(canonicalJson(wrongVerifierSource)) })).toThrow('RESULT_MISMATCH');
    expect(() => buildInteriorFinishScheduleProbeReceipt({ binding, exporterId: probe.exporterId, exporterSourceBytes: sources.exporterSourceBytes, parserId: probe.parserId, parserSourceBytes: sources.parserSourceBytes, parserResult: { status: 'verified', sourceArtifactSha256: probe.artifactSha256, outputBytes: sources.parserOutputBytes, parsedRowCount: probe.parsedRowCount, parsedObjectCount: probe.parsedObjectCount, stableIds: { ...probe.stableIds, rows: [...probe.stableIds.rows, 'forged'] } }, verifierId: probe.verifierId, verifierEvidenceBytes: sources.verifierEvidenceBytes })).toThrow('RESULT_MISMATCH');
    const promoted = JSON.parse(new TextDecoder().decode(evidence));
    expect(() => claimInteriorFinishScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson({ ...promoted, releaseReady: true })), ...sources })).toThrow('EVIDENCE_BINDING_MISMATCH');
    expect(() => claimInteriorFinishScheduleProbe({ binding, evidenceBytes: new Uint8Array([0xc3, 0x28]), ...sources })).toThrow('EVIDENCE_INVALID_UTF8');
    expect(() => claimInteriorFinishScheduleProbe({ binding, evidenceBytes: new TextEncoder().encode(canonicalJson({ ...promoted, stableIds: { ...promoted.stableIds, rows: ['forged'] } })), ...sources })).toThrow('EVIDENCE_BINDING_MISMATCH');
    for (const key of ['exporterSourceBytes', 'parserSourceBytes', 'parserOutputBytes', 'verifierEvidenceBytes'] as const) expect(() => claimInteriorFinishScheduleProbe({ binding, evidenceBytes: evidence, ...sources, [key]: new Uint8Array([1, 2, 3]) })).toThrow('EVIDENCE_BINDING_MISMATCH');
  });
});
