import { createHash } from 'node:crypto';
import { designRevisionSha256 } from '@/lib/designArtifactBinding';
import { assertCivilLandscapeOutputEnabled, getCivilLandscapeOutputCapability } from './civilLandscapeOutputCapabilities';

const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value); return encoded === undefined ? 'null' : encoded;
};
const validIds = (value: unknown): value is { plants: string[]; plantingZones: string[]; soilVolumes: string[]; rows: string[] } => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ['plants', 'plantingZones', 'soilVolumes', 'rows'].every(key => {
    const items = record[key];
    return Array.isArray(items) && items.every(item => typeof item === 'string' && item.length > 0) && new Set(items).size === items.length;
  });
};

export interface BoundLandscapePlantingScheduleArtifact {
  capabilityId: 'landscape.planting.schedule.internal'; format: 'schedule'; projectId: string;
  workspaceRevisionId: string; workspaceContentHash: string; revisionId: string; revisionSha256: string;
  artifactName: string; artifactMime: string; artifactBytes: number; artifactSha256: string;
}

export function bindLandscapePlantingScheduleArtifact(input: {
  capabilityId: string; projectId: string; workspaceRevisionId?: string; revisionId?: string;
  workspaceRevisionValue?: unknown; revisionValue?: unknown; expectedWorkspaceRevisionId?: string; expectedRevisionId?: string;
  expectedWorkspaceContentHash?: string; expectedRevisionSha256?: string; artifactName: string; artifactMime: string;
  bytes: Uint8Array; expectedArtifactSha256?: string;
}): BoundLandscapePlantingScheduleArtifact {
  const capability = assertCivilLandscapeOutputEnabled(input.capabilityId);
  const workspaceRevisionId = input.workspaceRevisionId ?? input.revisionId ?? '';
  const expectedRevisionId = input.expectedWorkspaceRevisionId ?? input.expectedRevisionId ?? '';
  const revisionValue = input.workspaceRevisionValue ?? input.revisionValue;
  const workspaceContentHash = input.expectedWorkspaceContentHash ?? input.expectedRevisionSha256 ?? (revisionValue === undefined ? '' : designRevisionSha256(revisionValue));
  if (capability.id !== 'landscape.planting.schedule.internal' || capability.format !== 'schedule') throw new Error('LANDSCAPE_PLANTING_SCHEDULE_CAPABILITY_MISMATCH');
  if (!input.projectId.trim() || !workspaceRevisionId.trim() || !expectedRevisionId.trim() || !input.artifactName.trim() || input.bytes.byteLength === 0 || !input.artifactMime.toLowerCase().startsWith('application/json')) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_INPUT_INVALID');
  if (workspaceRevisionId !== expectedRevisionId) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_REVISION_MISMATCH');
  if (!SHA256.test(workspaceContentHash)) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_CONTENT_HASH_INVALID');
  if (revisionValue !== undefined && designRevisionSha256(revisionValue) !== workspaceContentHash) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_CONTENT_HASH_MISMATCH');
  const artifactSha256 = sha256(input.bytes);
  if (input.expectedArtifactSha256 !== undefined && input.expectedArtifactSha256 !== artifactSha256) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_ARTIFACT_HASH_MISMATCH');
  return { capabilityId: 'landscape.planting.schedule.internal', format: 'schedule', projectId: input.projectId, workspaceRevisionId, workspaceContentHash, revisionId: workspaceRevisionId, revisionSha256: workspaceContentHash, artifactName: input.artifactName, artifactMime: input.artifactMime, artifactBytes: input.bytes.byteLength, artifactSha256 };
}

export interface LandscapePlantingScheduleProbeReceipt {
  schema: 'nexyfab.landscape-planting-schedule-probe.v1'; capabilityId: 'landscape.planting.schedule.internal'; format: 'schedule';
  workspaceRevisionId: string; workspaceContentHash: string; artifactSha256: string; artifactBytes: number;
  exporterId: string; exporterSourceSha256: string; parserId: string; parserSourceSha256: string; parserResult: 'verified'; parserOutputSha256: string;
  verifierId: string; verifierEvidenceSha256: string; parsedRowCount: number; parsedObjectCount: number;
  stableIds: { plants: string[]; plantingZones: string[]; soilVolumes: string[]; rows: string[] };
  plantCatalogProvenance: 'HOLD'; nativeRoundtrip: 'HOLD'; externalInteroperability: 'HOLD'; fieldEvidence: 'NOT_RUN'; releaseReady: false;
}

export function buildLandscapePlantingScheduleProbeReceipt(input: {
  binding: BoundLandscapePlantingScheduleArtifact; exporterId: string; exporterSourceBytes: Uint8Array; parserId: string; parserSourceBytes: Uint8Array;
  parserResult: { status: 'verified'; sourceArtifactSha256: string; outputBytes: Uint8Array; parsedRowCount: number; parsedObjectCount: number; stableIds: LandscapePlantingScheduleProbeReceipt['stableIds'] };
  verifierId: string; verifierEvidenceBytes: Uint8Array;
}): Uint8Array {
  const capability = getCivilLandscapeOutputCapability(input.binding.capabilityId);
  const cardinality = input.parserResult.stableIds.rows.length;
  const exporterSourceSha256 = sha256(input.exporterSourceBytes);
  const parserSourceSha256 = sha256(input.parserSourceBytes);
  if (!capability || capability.id !== 'landscape.planting.schedule.internal' || !capability.exporterPath || !capability.parserPath || capability.verifierPaths.length === 0) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_VERIFIER_REQUIRED');
  if (input.exporterSourceBytes.byteLength === 0 || input.parserSourceBytes.byteLength === 0 || input.parserResult.sourceArtifactSha256 !== input.binding.artifactSha256 || input.parserResult.outputBytes.byteLength === 0 || !Number.isSafeInteger(input.parserResult.parsedRowCount) || !Number.isSafeInteger(input.parserResult.parsedObjectCount) || input.parserResult.parsedRowCount !== cardinality || input.parserResult.parsedObjectCount !== cardinality || !validIds(input.parserResult.stableIds) || !capability.verifierPaths.includes(input.verifierId) || input.verifierEvidenceBytes.byteLength === 0) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_RESULT_MISMATCH');
  const receipt: LandscapePlantingScheduleProbeReceipt = {
    schema: 'nexyfab.landscape-planting-schedule-probe.v1', capabilityId: input.binding.capabilityId, format: 'schedule', workspaceRevisionId: input.binding.workspaceRevisionId, workspaceContentHash: input.binding.workspaceContentHash, artifactSha256: input.binding.artifactSha256, artifactBytes: input.binding.artifactBytes, exporterId: input.exporterId, exporterSourceSha256, parserId: input.parserId, parserSourceSha256, parserResult: 'verified', parserOutputSha256: sha256(input.parserResult.outputBytes), verifierId: input.verifierId, verifierEvidenceSha256: sha256(input.verifierEvidenceBytes), parsedRowCount: input.parserResult.parsedRowCount, parsedObjectCount: input.parserResult.parsedObjectCount, stableIds: input.parserResult.stableIds, plantCatalogProvenance: 'HOLD', nativeRoundtrip: 'HOLD', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false,
  };
  return new TextEncoder().encode(canonicalJson(receipt));
}

export function claimLandscapePlantingScheduleProbe(input: { binding: BoundLandscapePlantingScheduleArtifact; evidenceBytes: Uint8Array; exporterSourceBytes: Uint8Array; parserSourceBytes: Uint8Array; parserOutputBytes: Uint8Array; verifierEvidenceBytes: Uint8Array }): LandscapePlantingScheduleProbeReceipt & { evidenceSha256: string; claim: 'internal-planting-schedule-probe-verified' } {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(input.evidenceBytes); } catch { throw new Error('LANDSCAPE_PLANTING_SCHEDULE_EVIDENCE_INVALID_UTF8'); }
  let evidence: LandscapePlantingScheduleProbeReceipt;
  try { evidence = JSON.parse(text) as LandscapePlantingScheduleProbeReceipt; } catch { throw new Error('LANDSCAPE_PLANTING_SCHEDULE_EVIDENCE_INVALID'); }
  if (canonicalJson(evidence) !== text) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_EVIDENCE_NON_CANONICAL');
  const capability = getCivilLandscapeOutputCapability(input.binding.capabilityId);
  const cardinality = evidence.stableIds?.rows?.length;
  const sourceBytesValid = input.exporterSourceBytes.byteLength > 0 && input.parserSourceBytes.byteLength > 0 && input.parserOutputBytes.byteLength > 0 && input.verifierEvidenceBytes.byteLength > 0;
  if (!capability || !sourceBytesValid || evidence.schema !== 'nexyfab.landscape-planting-schedule-probe.v1' || evidence.capabilityId !== input.binding.capabilityId || evidence.format !== input.binding.format || evidence.artifactSha256 !== input.binding.artifactSha256 || evidence.workspaceRevisionId !== input.binding.workspaceRevisionId || evidence.workspaceContentHash !== input.binding.workspaceContentHash || evidence.parserResult !== 'verified' || !SHA256.test(evidence.artifactSha256) || !SHA256.test(evidence.workspaceContentHash) || !SHA256.test(evidence.exporterSourceSha256) || !SHA256.test(evidence.parserSourceSha256) || !SHA256.test(evidence.parserOutputSha256) || !SHA256.test(evidence.verifierEvidenceSha256) || sha256(input.exporterSourceBytes) !== evidence.exporterSourceSha256 || sha256(input.parserSourceBytes) !== evidence.parserSourceSha256 || sha256(input.parserOutputBytes) !== evidence.parserOutputSha256 || sha256(input.verifierEvidenceBytes) !== evidence.verifierEvidenceSha256 || !validIds(evidence.stableIds) || !Number.isSafeInteger(evidence.parsedRowCount) || !Number.isSafeInteger(evidence.parsedObjectCount) || evidence.parsedRowCount !== cardinality || evidence.parsedObjectCount !== cardinality || !capability.verifierPaths.includes(evidence.verifierId) || evidence.plantCatalogProvenance !== 'HOLD' || evidence.nativeRoundtrip !== 'HOLD' || evidence.externalInteroperability !== 'HOLD' || evidence.fieldEvidence !== 'NOT_RUN' || evidence.releaseReady !== false) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_EVIDENCE_BINDING_MISMATCH');
  if (evidence.exporterId !== capability.exporterPath || evidence.parserId !== capability.parserPath || evidence.artifactBytes !== input.binding.artifactBytes) throw new Error('LANDSCAPE_PLANTING_SCHEDULE_STALE_REVISION');
  return { ...evidence, evidenceSha256: sha256(input.evidenceBytes), claim: 'internal-planting-schedule-probe-verified' };
}

export { canonicalJson };
