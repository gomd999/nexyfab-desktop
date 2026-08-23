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

export type InteriorFfeStableIds = { spaces: string[]; furniture: string[]; rows: string[] };
export type InteriorFfeCounts = { spaceCount: number; furnitureCount: number; rowCount: number; objectCount: number };
const exactKeys = (value: unknown, expected: readonly string[]) => record(value) && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.every((id) => typeof id === 'string' && ID.test(id)) && new Set(ids).size === ids.length;
function stableIdsValid(value: unknown, counts: InteriorFfeCounts): value is InteriorFfeStableIds {
  if (!exactKeys(value, ['spaces', 'furniture', 'rows'])) return false;
  const ids = value as InteriorFfeStableIds;
  return validIds(ids.spaces) && validIds(ids.furniture) && validIds(ids.rows)
    && ids.rows.length === counts.rowCount && ids.rows.length === counts.objectCount && ids.furniture.length === counts.furnitureCount && ids.spaces.length === counts.spaceCount;
}
const countsValid = (value: unknown): value is InteriorFfeCounts => exactKeys(value, ['spaceCount', 'furnitureCount', 'rowCount', 'objectCount']) && Object.values(value as Record<string, unknown>).every((item) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0);
const vectorValid = (value: unknown, positive: boolean) => Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item) && (!positive || item > 0));
const decodeCanonical = (bytes: Uint8Array): unknown | null => { try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); const value = JSON.parse(text) as unknown; return canonicalJson(value) === text ? value : null; } catch { return null; } };

function parserOutputMatches(bytes: Uint8Array, stableIds: InteriorFfeStableIds, counts: InteriorFfeCounts, binding: BoundInteriorFfeScheduleArtifact): boolean {
  const output = decodeCanonical(bytes);
  if (!record(output) || !exactKeys(output, ['schema', 'capabilityId', 'format', 'workspaceRevisionId', 'workspaceContentHash', 'architectureRevision', 'architectureContentHash', 'interiorRevision', 'interiorContentHash', 'spaces', 'furniture', 'rows', 'counts', 'stableIds', 'nativeInteroperability', 'externalCatalogProvenance', 'priceEvidence', 'boqEvidence', 'fieldEvidence', 'releaseReady'])) return false;
  const spaces = output.spaces, furniture = output.furniture, rows = output.rows;
  if (output.workspaceRevisionId !== binding.workspaceRevisionId || output.workspaceContentHash !== binding.workspaceContentHash || output.architectureRevision !== binding.architectureRevision || output.architectureContentHash !== binding.architectureContentHash || output.interiorRevision !== binding.interiorRevision || output.interiorContentHash !== binding.interiorContentHash || !Array.isArray(spaces) || !Array.isArray(furniture) || !Array.isArray(rows) || !countsValid(output.counts) || !stableIdsValid(output.stableIds, counts) || canonicalJson(output.stableIds) !== canonicalJson(stableIds) || canonicalJson(output.counts) !== canonicalJson(counts) || canonicalJson(rows) !== canonicalJson(furniture)) return false;
  if (spaces.some((item) => !exactKeys(item, ['id']) || typeof item.id !== 'string' || !ID.test(item.id)) || furniture.length !== counts.furnitureCount || spaces.length !== counts.spaceCount || rows.length !== counts.rowCount) return false;
  const spaceSet = new Set(spaces.map((item) => item.id));
  return furniture.every((item) => exactKeys(item, ['id', 'spaceId', 'positionMm', 'sizeMm', 'clearanceMm', 'rotationDeg', 'quantity']) && typeof item.id === 'string' && ID.test(item.id) && typeof item.spaceId === 'string' && spaceSet.has(item.spaceId) && vectorValid(item.positionMm, false) && vectorValid(item.sizeMm, true) && typeof item.clearanceMm === 'number' && Number.isFinite(item.clearanceMm) && item.clearanceMm >= 0 && typeof item.rotationDeg === 'number' && Number.isFinite(item.rotationDeg) && item.quantity === 1)
    && output.nativeInteroperability === 'HOLD' && output.externalCatalogProvenance === 'HOLD' && output.priceEvidence === 'HOLD' && output.boqEvidence === 'HOLD' && output.fieldEvidence === 'NOT_RUN' && output.releaseReady === false;
}
function verifierEvidenceMatches(bytes: Uint8Array, exporterId: string, parserId: string, verifierId: string, stableIds: InteriorFfeStableIds, counts: InteriorFfeCounts): boolean {
  const value = decodeCanonical(bytes);
  if (!record(value) || !exactKeys(value, ['schema', 'exporterId', 'parserId', 'verifierId', 'counts', 'stableIds', 'nativeInteroperability', 'externalCatalogProvenance', 'priceEvidence', 'boqEvidence', 'fieldEvidence', 'releaseReady'])) return false;
  return value.schema === 'nexyfab.interior-ffe-schedule-verifier-evidence.v1' && value.exporterId === exporterId && value.parserId === parserId && value.verifierId === verifierId && countsValid(value.counts) && canonicalJson(value.counts) === canonicalJson(counts) && stableIdsValid(value.stableIds, counts) && canonicalJson(value.stableIds) === canonicalJson(stableIds) && value.nativeInteroperability === 'HOLD' && value.externalCatalogProvenance === 'HOLD' && value.priceEvidence === 'HOLD' && value.boqEvidence === 'HOLD' && value.fieldEvidence === 'NOT_RUN' && value.releaseReady === false;
}

export interface BoundInteriorFfeScheduleArtifact {
  capabilityId: 'interior.ffe.schedule'; format: 'schedule'; projectId: string;
  workspaceRevisionId: string; workspaceContentHash: string; architectureRevision: number; architectureContentHash: string;
  interiorRevision: number; interiorContentHash: string; artifactName: string; artifactMime: string; artifactBytes: number; artifactSha256: string;
}

export function bindInteriorFfeScheduleArtifact(input: {
  capabilityId: string; projectId: string; workspaceRevisionId: string; workspaceContentHash: string;
  architectureRevision: number; architectureContentHash: string; interiorRevision: number; interiorContentHash: string;
  artifactName: string; artifactMime: string; bytes: Uint8Array; expectedArtifactSha256?: string;
}): BoundInteriorFfeScheduleArtifact {
  const capability = getArchitectureInteriorOutputCapability(input.capabilityId);
  if (!capability || capability.id !== 'interior.ffe.schedule' || capability.format !== 'schedule' || capability.status === 'TARGET' || capability.runState !== 'VERIFIED') throw new Error('INTERIOR_FFE_SCHEDULE_CAPABILITY_UNAVAILABLE');
  if (!input.projectId.trim() || !input.workspaceRevisionId.trim() || !input.artifactName.trim() || input.bytes.byteLength === 0 || !input.artifactMime.toLowerCase().startsWith('application/json')) throw new Error('INTERIOR_FFE_SCHEDULE_INPUT_INVALID');
  if (!Number.isSafeInteger(input.architectureRevision) || input.architectureRevision < 0 || !Number.isSafeInteger(input.interiorRevision) || input.interiorRevision < 0 || !SHA256.test(input.workspaceContentHash) || !SHA256.test(input.architectureContentHash) || !SHA256.test(input.interiorContentHash)) throw new Error('INTERIOR_FFE_SCHEDULE_BINDING_INVALID');
  const artifactSha256 = sha256(input.bytes);
  if (input.expectedArtifactSha256 !== undefined && input.expectedArtifactSha256 !== artifactSha256) throw new Error('INTERIOR_FFE_SCHEDULE_ARTIFACT_HASH_MISMATCH');
  return { capabilityId: 'interior.ffe.schedule', format: 'schedule', projectId: input.projectId, workspaceRevisionId: input.workspaceRevisionId, workspaceContentHash: input.workspaceContentHash, architectureRevision: input.architectureRevision, architectureContentHash: input.architectureContentHash, interiorRevision: input.interiorRevision, interiorContentHash: input.interiorContentHash, artifactName: input.artifactName, artifactMime: input.artifactMime, artifactBytes: input.bytes.byteLength, artifactSha256 };
}

export interface InteriorFfeScheduleProbeReceipt {
  schema: 'nexyfab.interior-ffe-schedule-probe.v1'; capabilityId: 'interior.ffe.schedule'; format: 'schedule';
  workspaceRevisionId: string; workspaceContentHash: string; architectureRevision: number; architectureContentHash: string; interiorRevision: number; interiorContentHash: string;
  artifactSha256: string; artifactBytes: number; exporterId: string; exporterSourceSha256: string; parserId: string; parserSourceSha256: string; parserResult: 'verified'; parserOutputSha256: string; verifierId: string; verifierEvidenceSha256: string; counts: InteriorFfeCounts; parsedRowCount: number; parsedObjectCount: number; stableIds: InteriorFfeStableIds;
  nativeInteroperability: 'HOLD'; externalCatalogProvenance: 'HOLD'; priceEvidence: 'HOLD'; boqEvidence: 'HOLD'; fieldEvidence: 'NOT_RUN'; releaseReady: false;
}

export function buildInteriorFfeScheduleProbeReceipt(input: {
  binding: BoundInteriorFfeScheduleArtifact; exporterId: string; exporterSourceBytes: Uint8Array; parserId: string; parserSourceBytes: Uint8Array;
  parserResult: { status: 'verified'; sourceArtifactSha256: string; outputBytes: Uint8Array; counts: InteriorFfeCounts; parsedRowCount: number; parsedObjectCount: number; stableIds: InteriorFfeStableIds };
  verifierId: string; verifierEvidenceBytes: Uint8Array;
}): Uint8Array {
  const capability = getArchitectureInteriorOutputCapability(input.binding.capabilityId);
  const result = input.parserResult;
  if (!capability || !capability.exporterPath || !capability.parserPath || capability.verifierPaths.length === 0 || input.exporterSourceBytes.byteLength === 0 || input.parserSourceBytes.byteLength === 0 || input.verifierEvidenceBytes.byteLength === 0 || result.outputBytes.byteLength === 0 || result.sourceArtifactSha256 !== input.binding.artifactSha256 || !countsValid(result.counts) || result.parsedRowCount !== result.counts.rowCount || result.parsedObjectCount !== result.counts.objectCount || !stableIdsValid(result.stableIds, result.counts) || !parserOutputMatches(result.outputBytes, result.stableIds, result.counts, input.binding) || !verifierEvidenceMatches(input.verifierEvidenceBytes, input.exporterId, input.parserId, input.verifierId, result.stableIds, result.counts) || !capability.verifierPaths.includes(input.verifierId)) throw new Error('INTERIOR_FFE_SCHEDULE_RESULT_MISMATCH');
  const receipt: InteriorFfeScheduleProbeReceipt = { schema: 'nexyfab.interior-ffe-schedule-probe.v1', capabilityId: input.binding.capabilityId, format: input.binding.format, workspaceRevisionId: input.binding.workspaceRevisionId, workspaceContentHash: input.binding.workspaceContentHash, architectureRevision: input.binding.architectureRevision, architectureContentHash: input.binding.architectureContentHash, interiorRevision: input.binding.interiorRevision, interiorContentHash: input.binding.interiorContentHash, artifactSha256: input.binding.artifactSha256, artifactBytes: input.binding.artifactBytes, exporterId: input.exporterId, exporterSourceSha256: sha256(input.exporterSourceBytes), parserId: input.parserId, parserSourceSha256: sha256(input.parserSourceBytes), parserResult: 'verified', parserOutputSha256: sha256(result.outputBytes), verifierId: input.verifierId, verifierEvidenceSha256: sha256(input.verifierEvidenceBytes), counts: result.counts, parsedRowCount: result.parsedRowCount, parsedObjectCount: result.parsedObjectCount, stableIds: result.stableIds, nativeInteroperability: 'HOLD', externalCatalogProvenance: 'HOLD', priceEvidence: 'HOLD', boqEvidence: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false };
  return new TextEncoder().encode(canonicalJson(receipt));
}

export function claimInteriorFfeScheduleProbe(input: { binding: BoundInteriorFfeScheduleArtifact; evidenceBytes: Uint8Array; exporterSourceBytes: Uint8Array; parserSourceBytes: Uint8Array; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): InteriorFfeScheduleProbeReceipt & { evidenceSha256: string; claim: 'internal-ffe-schedule-probe-verified' } {
  let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(input.evidenceBytes); } catch { throw new Error('INTERIOR_FFE_SCHEDULE_EVIDENCE_INVALID_UTF8'); }
  let evidence: InteriorFfeScheduleProbeReceipt; try { evidence = JSON.parse(text) as InteriorFfeScheduleProbeReceipt; } catch { throw new Error('INTERIOR_FFE_SCHEDULE_EVIDENCE_INVALID'); }
  if (canonicalJson(evidence) !== text || !exactKeys(evidence, ['schema', 'capabilityId', 'format', 'workspaceRevisionId', 'workspaceContentHash', 'architectureRevision', 'architectureContentHash', 'interiorRevision', 'interiorContentHash', 'artifactSha256', 'artifactBytes', 'exporterId', 'exporterSourceSha256', 'parserId', 'parserSourceSha256', 'parserResult', 'parserOutputSha256', 'verifierId', 'verifierEvidenceSha256', 'counts', 'parsedRowCount', 'parsedObjectCount', 'stableIds', 'nativeInteroperability', 'externalCatalogProvenance', 'priceEvidence', 'boqEvidence', 'fieldEvidence', 'releaseReady'])) throw new Error('INTERIOR_FFE_SCHEDULE_EVIDENCE_NON_CANONICAL');
  const capability = getArchitectureInteriorOutputCapability(input.binding.capabilityId);
  const validBytes = [input.exporterSourceBytes, input.parserSourceBytes, input.parserOutputBytes, input.verifierEvidenceBytes].every((bytes) => bytes.byteLength > 0);
  const counts = evidence.counts;
  if (!capability || !validBytes || evidence.schema !== 'nexyfab.interior-ffe-schedule-probe.v1' || evidence.capabilityId !== input.binding.capabilityId || evidence.format !== input.binding.format || evidence.workspaceRevisionId !== input.binding.workspaceRevisionId || evidence.workspaceContentHash !== input.binding.workspaceContentHash || evidence.architectureRevision !== input.binding.architectureRevision || evidence.architectureContentHash !== input.binding.architectureContentHash || evidence.interiorRevision !== input.binding.interiorRevision || evidence.interiorContentHash !== input.binding.interiorContentHash || evidence.artifactSha256 !== input.binding.artifactSha256 || evidence.artifactBytes !== input.binding.artifactBytes || evidence.parserResult !== 'verified' || !countsValid(counts) || evidence.parsedRowCount !== counts.rowCount || evidence.parsedObjectCount !== counts.objectCount || !stableIdsValid(evidence.stableIds, counts) || !SHA256.test(evidence.artifactSha256) || !SHA256.test(evidence.workspaceContentHash) || !SHA256.test(evidence.architectureContentHash) || !SHA256.test(evidence.interiorContentHash) || !SHA256.test(evidence.exporterSourceSha256) || !SHA256.test(evidence.parserSourceSha256) || !SHA256.test(evidence.parserOutputSha256) || !SHA256.test(evidence.verifierEvidenceSha256) || sha256(input.exporterSourceBytes) !== evidence.exporterSourceSha256 || sha256(input.parserSourceBytes) !== evidence.parserSourceSha256 || sha256(input.parserOutputBytes) !== evidence.parserOutputSha256 || sha256(input.verifierEvidenceBytes) !== evidence.verifierEvidenceSha256 || !parserOutputMatches(input.parserOutputBytes, evidence.stableIds, counts, input.binding) || !verifierEvidenceMatches(input.verifierEvidenceBytes, evidence.exporterId, evidence.parserId, evidence.verifierId, evidence.stableIds, counts) || !capability.verifierPaths.includes(evidence.verifierId) || evidence.nativeInteroperability !== 'HOLD' || evidence.externalCatalogProvenance !== 'HOLD' || evidence.priceEvidence !== 'HOLD' || evidence.boqEvidence !== 'HOLD' || evidence.fieldEvidence !== 'NOT_RUN' || evidence.releaseReady !== false) throw new Error('INTERIOR_FFE_SCHEDULE_EVIDENCE_BINDING_MISMATCH');
  if (evidence.exporterId !== capability.exporterPath || evidence.parserId !== capability.parserPath) throw new Error('INTERIOR_FFE_SCHEDULE_STALE_REVISION');
  return { ...evidence, evidenceSha256: sha256(input.evidenceBytes), claim: 'internal-ffe-schedule-probe-verified' };
}

export { canonicalJson };
