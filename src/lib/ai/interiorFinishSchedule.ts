import { createHash } from 'node:crypto';
import { getArchitectureInteriorOutputCapability } from './architectureInteriorOutputCapabilities';

const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
type StableIds = { spaces: string[]; finishes: string[]; rows: string[] };
function stableIdsValid(value: unknown, rowCount: number, objectCount: number): value is StableIds {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'finishes,rows,spaces' || !Number.isSafeInteger(rowCount) || rowCount < 0 || !Number.isSafeInteger(objectCount) || objectCount < 0) return false;
  const stableIds = value as StableIds;
  return ['spaces', 'finishes', 'rows'].every((key) => Array.isArray(stableIds[key as keyof StableIds]) && stableIds[key as keyof StableIds].every((id) => typeof id === 'string' && ID.test(id)) && new Set(stableIds[key as keyof StableIds]).size === stableIds[key as keyof StableIds].length) && stableIds.rows.length === rowCount && stableIds.rows.length === objectCount;
}
function parserOutputMatches(bytes: Uint8Array, stableIds: StableIds, parsedRowCount: number, parsedObjectCount: number, binding: BoundInteriorFinishScheduleArtifact): boolean {
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return false; }
  let output: unknown; try { output = JSON.parse(text) as unknown; } catch { return false; }
  if (!record(output) || canonicalJson(output) !== text) return false;
  const outputIds = output.stableIds;
  const counts = output.counts;
  return Boolean(output.workspaceRevisionId === binding.workspaceRevisionId && output.workspaceContentHash === binding.workspaceContentHash
    && output.architectureRevision === binding.architectureRevision && output.architectureContentHash === binding.architectureContentHash
    && output.interiorRevision === binding.interiorRevision && output.interiorContentHash === binding.interiorContentHash
    && stableIdsValid(outputIds, parsedRowCount, parsedObjectCount) && record(counts) && stableIdsValid(stableIds, parsedRowCount, parsedObjectCount) && canonicalJson(outputIds) === canonicalJson(stableIds)
    && counts.rowCount === parsedRowCount && counts.objectCount === parsedObjectCount
    && Array.isArray(output.rows) && output.rows.length === parsedRowCount);
}
function verifierEvidenceMatches(bytes: Uint8Array, exporterId: string, parserId: string, verifierId: string, stableIds: StableIds, rowCount: number, objectCount: number): boolean {
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return false; }
  let value: unknown; try { value = JSON.parse(text) as unknown; } catch { return false; }
  const expectedKeys = ['exporterId', 'parserId', 'verifierId', 'parsedRowCount', 'parsedObjectCount', 'stableIds', 'nativeInteroperability', 'externalCatalogProvenance', 'boqEvidence', 'fieldEvidence', 'releaseReady'].sort();
  if (!record(value) || Object.keys(value).sort().join(',') !== expectedKeys.join(',') || canonicalJson(value) !== text || !stableIdsValid(value.stableIds, rowCount, objectCount)) return false;
  return value.exporterId === exporterId && value.parserId === parserId && value.verifierId === verifierId && value.parsedRowCount === rowCount && value.parsedObjectCount === objectCount && canonicalJson(value.stableIds) === canonicalJson(stableIds) && value.nativeInteroperability === 'HOLD' && value.externalCatalogProvenance === 'HOLD' && value.boqEvidence === 'HOLD' && value.fieldEvidence === 'NOT_RUN' && value.releaseReady === false;
}

export interface BoundInteriorFinishScheduleArtifact {
  capabilityId: 'interior.finish.schedule'; format: 'schedule'; projectId: string;
  workspaceRevisionId: string; workspaceContentHash: string; architectureRevision: number; architectureContentHash: string;
  interiorRevision: number; interiorContentHash: string; artifactName: string; artifactMime: string; artifactBytes: number; artifactSha256: string;
}

export function bindInteriorFinishScheduleArtifact(input: {
  capabilityId: string; projectId: string; workspaceRevisionId: string; workspaceContentHash: string;
  architectureRevision: number; architectureContentHash: string; interiorRevision: number; interiorContentHash: string;
  artifactName: string; artifactMime: string; bytes: Uint8Array; expectedArtifactSha256?: string;
}): BoundInteriorFinishScheduleArtifact {
  const capability = getArchitectureInteriorOutputCapability(input.capabilityId);
  if (!capability || capability.id !== 'interior.finish.schedule' || capability.format !== 'schedule' || capability.status === 'TARGET' || capability.runState !== 'VERIFIED') throw new Error('INTERIOR_FINISH_SCHEDULE_CAPABILITY_UNAVAILABLE');
  if (!input.projectId.trim() || !input.workspaceRevisionId.trim() || !input.artifactName.trim() || input.bytes.byteLength === 0 || !input.artifactMime.toLowerCase().startsWith('application/json')) throw new Error('INTERIOR_FINISH_SCHEDULE_INPUT_INVALID');
  if (!Number.isSafeInteger(input.architectureRevision) || input.architectureRevision < 0 || !Number.isSafeInteger(input.interiorRevision) || input.interiorRevision < 0 || !SHA256.test(input.workspaceContentHash) || !SHA256.test(input.architectureContentHash) || !SHA256.test(input.interiorContentHash)) throw new Error('INTERIOR_FINISH_SCHEDULE_BINDING_INVALID');
  const artifactSha256 = sha256(input.bytes);
  if (input.expectedArtifactSha256 !== undefined && input.expectedArtifactSha256 !== artifactSha256) throw new Error('INTERIOR_FINISH_SCHEDULE_ARTIFACT_HASH_MISMATCH');
  return { capabilityId: 'interior.finish.schedule', format: 'schedule', projectId: input.projectId, workspaceRevisionId: input.workspaceRevisionId, workspaceContentHash: input.workspaceContentHash, architectureRevision: input.architectureRevision, architectureContentHash: input.architectureContentHash, interiorRevision: input.interiorRevision, interiorContentHash: input.interiorContentHash, artifactName: input.artifactName, artifactMime: input.artifactMime, artifactBytes: input.bytes.byteLength, artifactSha256 };
}

export interface InteriorFinishScheduleProbeReceipt {
  schema: 'nexyfab.interior-finish-schedule-probe.v1'; capabilityId: 'interior.finish.schedule'; format: 'schedule';
  workspaceRevisionId: string; workspaceContentHash: string; architectureRevision: number; architectureContentHash: string; interiorRevision: number; interiorContentHash: string;
  artifactSha256: string; artifactBytes: number; exporterId: string; exporterSourceSha256: string; parserId: string; parserSourceSha256: string; parserResult: 'verified'; parserOutputSha256: string; verifierId: string; verifierEvidenceSha256: string; parsedRowCount: number; parsedObjectCount: number; stableIds: StableIds;
  nativeInteroperability: 'HOLD'; externalCatalogProvenance: 'HOLD'; boqEvidence: 'HOLD'; fieldEvidence: 'NOT_RUN'; releaseReady: false;
}

export function buildInteriorFinishScheduleProbeReceipt(input: {
  binding: BoundInteriorFinishScheduleArtifact; exporterId: string; exporterSourceBytes: Uint8Array; parserId: string; parserSourceBytes: Uint8Array;
  parserResult: { status: 'verified'; sourceArtifactSha256: string; outputBytes: Uint8Array; parsedRowCount: number; parsedObjectCount: number; stableIds: StableIds };
  verifierId: string; verifierEvidenceBytes: Uint8Array;
}): Uint8Array {
  const capability = getArchitectureInteriorOutputCapability(input.binding.capabilityId);
  if (!capability || !capability.exporterPath || !capability.parserPath || capability.verifierPaths.length === 0 || input.exporterSourceBytes.byteLength === 0 || input.parserSourceBytes.byteLength === 0 || input.verifierEvidenceBytes.byteLength === 0 || input.parserResult.outputBytes.byteLength === 0 || input.parserResult.sourceArtifactSha256 !== input.binding.artifactSha256 || !stableIdsValid(input.parserResult.stableIds, input.parserResult.parsedRowCount, input.parserResult.parsedObjectCount) || !parserOutputMatches(input.parserResult.outputBytes, input.parserResult.stableIds, input.parserResult.parsedRowCount, input.parserResult.parsedObjectCount, input.binding) || !verifierEvidenceMatches(input.verifierEvidenceBytes, input.exporterId, input.parserId, input.verifierId, input.parserResult.stableIds, input.parserResult.parsedRowCount, input.parserResult.parsedObjectCount) || !capability.verifierPaths.includes(input.verifierId)) throw new Error('INTERIOR_FINISH_SCHEDULE_RESULT_MISMATCH');
  const receipt: InteriorFinishScheduleProbeReceipt = { schema: 'nexyfab.interior-finish-schedule-probe.v1', capabilityId: input.binding.capabilityId, format: input.binding.format, workspaceRevisionId: input.binding.workspaceRevisionId, workspaceContentHash: input.binding.workspaceContentHash, architectureRevision: input.binding.architectureRevision, architectureContentHash: input.binding.architectureContentHash, interiorRevision: input.binding.interiorRevision, interiorContentHash: input.binding.interiorContentHash, artifactSha256: input.binding.artifactSha256, artifactBytes: input.binding.artifactBytes, exporterId: input.exporterId, exporterSourceSha256: sha256(input.exporterSourceBytes), parserId: input.parserId, parserSourceSha256: sha256(input.parserSourceBytes), parserResult: 'verified', parserOutputSha256: sha256(input.parserResult.outputBytes), verifierId: input.verifierId, verifierEvidenceSha256: sha256(input.verifierEvidenceBytes), parsedRowCount: input.parserResult.parsedRowCount, parsedObjectCount: input.parserResult.parsedObjectCount, stableIds: input.parserResult.stableIds, nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false };
  return new TextEncoder().encode(canonicalJson(receipt));
}

export function claimInteriorFinishScheduleProbe(input: { binding: BoundInteriorFinishScheduleArtifact; evidenceBytes: Uint8Array; exporterSourceBytes: Uint8Array; parserSourceBytes: Uint8Array; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): InteriorFinishScheduleProbeReceipt & { evidenceSha256: string; claim: 'internal-finish-schedule-probe-verified' } {
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(input.evidenceBytes); } catch { throw new Error('INTERIOR_FINISH_SCHEDULE_EVIDENCE_INVALID_UTF8'); }
  let evidence: InteriorFinishScheduleProbeReceipt; try { evidence = JSON.parse(text) as InteriorFinishScheduleProbeReceipt; } catch { throw new Error('INTERIOR_FINISH_SCHEDULE_EVIDENCE_INVALID'); }
  if (canonicalJson(evidence) !== text) throw new Error('INTERIOR_FINISH_SCHEDULE_EVIDENCE_NON_CANONICAL');
  const capability = getArchitectureInteriorOutputCapability(input.binding.capabilityId);
  const validBytes = [input.exporterSourceBytes, input.parserSourceBytes, input.parserOutputBytes, input.verifierEvidenceBytes].every((bytes) => bytes.byteLength > 0);
  if (!capability || !validBytes || evidence.schema !== 'nexyfab.interior-finish-schedule-probe.v1' || evidence.capabilityId !== input.binding.capabilityId || evidence.format !== input.binding.format || evidence.workspaceRevisionId !== input.binding.workspaceRevisionId || evidence.workspaceContentHash !== input.binding.workspaceContentHash || evidence.architectureRevision !== input.binding.architectureRevision || evidence.architectureContentHash !== input.binding.architectureContentHash || evidence.interiorRevision !== input.binding.interiorRevision || evidence.interiorContentHash !== input.binding.interiorContentHash || evidence.artifactSha256 !== input.binding.artifactSha256 || evidence.artifactBytes !== input.binding.artifactBytes || evidence.parserResult !== 'verified' || !stableIdsValid(evidence.stableIds, evidence.parsedRowCount, evidence.parsedObjectCount) || !SHA256.test(evidence.artifactSha256) || !SHA256.test(evidence.workspaceContentHash) || !SHA256.test(evidence.architectureContentHash) || !SHA256.test(evidence.interiorContentHash) || !SHA256.test(evidence.exporterSourceSha256) || !SHA256.test(evidence.parserSourceSha256) || !SHA256.test(evidence.parserOutputSha256) || !SHA256.test(evidence.verifierEvidenceSha256) || sha256(input.exporterSourceBytes) !== evidence.exporterSourceSha256 || sha256(input.parserSourceBytes) !== evidence.parserSourceSha256 || sha256(input.parserOutputBytes) !== evidence.parserOutputSha256 || sha256(input.verifierEvidenceBytes) !== evidence.verifierEvidenceSha256 || !parserOutputMatches(input.parserOutputBytes, evidence.stableIds, evidence.parsedRowCount, evidence.parsedObjectCount, input.binding) || !verifierEvidenceMatches(input.verifierEvidenceBytes, evidence.exporterId, evidence.parserId, evidence.verifierId, evidence.stableIds, evidence.parsedRowCount, evidence.parsedObjectCount) || !capability.verifierPaths.includes(evidence.verifierId) || evidence.nativeInteroperability !== 'HOLD' || evidence.externalCatalogProvenance !== 'HOLD' || evidence.boqEvidence !== 'HOLD' || evidence.fieldEvidence !== 'NOT_RUN' || evidence.releaseReady !== false) throw new Error('INTERIOR_FINISH_SCHEDULE_EVIDENCE_BINDING_MISMATCH');
  if (evidence.exporterId !== capability.exporterPath || evidence.parserId !== capability.parserPath) throw new Error('INTERIOR_FINISH_SCHEDULE_STALE_REVISION');
  return { ...evidence, evidenceSha256: sha256(input.evidenceBytes), claim: 'internal-finish-schedule-probe-verified' };
}

export { canonicalJson };
