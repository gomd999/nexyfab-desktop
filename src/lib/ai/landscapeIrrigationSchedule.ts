import { createHash } from 'node:crypto';
import { designRevisionSha256 } from '@/lib/designArtifactBinding';
import { getCivilLandscapeOutputCapability, assertCivilLandscapeOutputEnabled } from './civilLandscapeOutputCapabilities';

const SHA256 = /^[a-f0-9]{64}$/;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
};

export interface BoundLandscapeIrrigationScheduleArtifact {
  capabilityId: 'landscape.irrigation.schedule.internal';
  format: 'schedule';
  projectId: string;
  workspaceRevisionId: string;
  workspaceContentHash: string;
  /** Aliases keep the artifact compatible with the civil output binding vocabulary. */
  revisionId: string;
  revisionSha256: string;
  artifactName: string;
  artifactMime: string;
  artifactBytes: number;
  artifactSha256: string;
}

function normalizeBindingInput(input: {
  capabilityId: string;
  projectId: string;
  workspaceRevisionId?: string;
  revisionId?: string;
  workspaceRevisionValue?: unknown;
  revisionValue?: unknown;
  expectedWorkspaceRevisionId?: string;
  expectedRevisionId?: string;
  expectedWorkspaceContentHash?: string;
  expectedRevisionSha256?: string;
  artifactName: string;
  artifactMime: string;
  bytes: Uint8Array;
  expectedArtifactSha256?: string;
}) {
  const workspaceRevisionId = input.workspaceRevisionId ?? input.revisionId ?? '';
  const expectedRevisionId = input.expectedWorkspaceRevisionId ?? input.expectedRevisionId ?? '';
  const revisionValue = input.workspaceRevisionValue ?? input.revisionValue;
  const workspaceContentHash = input.expectedWorkspaceContentHash ?? input.expectedRevisionSha256 ?? (revisionValue === undefined ? '' : designRevisionSha256(revisionValue));
  return { ...input, workspaceRevisionId, expectedRevisionId, workspaceContentHash, revisionValue };
}

export function bindLandscapeIrrigationScheduleArtifact(input: {
  capabilityId: string;
  projectId: string;
  workspaceRevisionId?: string;
  revisionId?: string;
  workspaceRevisionValue?: unknown;
  revisionValue?: unknown;
  expectedWorkspaceRevisionId?: string;
  expectedRevisionId?: string;
  expectedWorkspaceContentHash?: string;
  expectedRevisionSha256?: string;
  artifactName: string;
  artifactMime: string;
  bytes: Uint8Array;
  expectedArtifactSha256?: string;
}): BoundLandscapeIrrigationScheduleArtifact {
  const normalized = normalizeBindingInput(input);
  const capability = assertCivilLandscapeOutputEnabled(input.capabilityId);
  if (capability.id !== 'landscape.irrigation.schedule.internal' || capability.format !== 'schedule') throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_CAPABILITY_MISMATCH');
  if (!normalized.projectId.trim() || !normalized.workspaceRevisionId.trim() || !normalized.expectedRevisionId.trim() || !normalized.artifactName.trim() || normalized.bytes.byteLength === 0 || !normalized.artifactMime.toLowerCase().startsWith('application/json')) throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_INPUT_INVALID');
  if (normalized.workspaceRevisionId !== normalized.expectedRevisionId) throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_REVISION_MISMATCH');
  if (!SHA256.test(normalized.workspaceContentHash)) throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_CONTENT_HASH_INVALID');
  if (normalized.revisionValue !== undefined && designRevisionSha256(normalized.revisionValue) !== normalized.workspaceContentHash) throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_CONTENT_HASH_MISMATCH');
  const artifactSha256 = sha256(normalized.bytes);
  if (normalized.expectedArtifactSha256 !== undefined && normalized.expectedArtifactSha256 !== artifactSha256) throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_ARTIFACT_HASH_MISMATCH');
  return {
    capabilityId: 'landscape.irrigation.schedule.internal', format: 'schedule', projectId: normalized.projectId,
    workspaceRevisionId: normalized.workspaceRevisionId, workspaceContentHash: normalized.workspaceContentHash,
    revisionId: normalized.workspaceRevisionId, revisionSha256: normalized.workspaceContentHash,
    artifactName: normalized.artifactName, artifactMime: normalized.artifactMime,
    artifactBytes: normalized.bytes.byteLength, artifactSha256,
  };
}

export interface LandscapeIrrigationScheduleProbeReceipt {
  schema: 'nexyfab.landscape-irrigation-schedule-probe.v1';
  capabilityId: 'landscape.irrigation.schedule.internal';
  format: 'schedule';
  workspaceRevisionId: string;
  workspaceContentHash: string;
  artifactSha256: string;
  artifactBytes: number;
  exporterId: string;
  exporterSourceSha256: string;
  parserId: string;
  parserSourceSha256: string;
  parserResult: 'verified';
  parserOutputSha256: string;
  verifierId: string;
  verifierEvidenceSha256: string;
  parsedRowCount: number;
  parsedObjectCount: number;
  stableIds: { nodes: string[]; pipes: string[]; zones: string[]; rows: string[] };
  hydraulicEvidence: 'NOT_RUN';
  externalInteroperability: 'HOLD';
  fieldEvidence: 'NOT_RUN';
  releaseReady: false;
}

const validIds = (value: unknown): value is LandscapeIrrigationScheduleProbeReceipt['stableIds'] => {
  if (!value || typeof value !== 'object') return false;
  const ids = value as Record<string, unknown>;
  return ['nodes', 'pipes', 'zones', 'rows'].every(key => {
    const items = ids[key];
    return Array.isArray(items) && items.every((item: unknown) => typeof item === 'string' && item.length > 0) && new Set(items).size === items.length;
  });
};

export function buildLandscapeIrrigationScheduleProbeReceipt(input: {
  binding: BoundLandscapeIrrigationScheduleArtifact;
  exporterId: string;
  exporterSourceSha256: string;
  parserId: string;
  parserSourceSha256: string;
  parserResult: { status: 'verified'; sourceArtifactSha256: string; outputBytes: Uint8Array; parsedRowCount: number; parsedObjectCount: number; stableIds: LandscapeIrrigationScheduleProbeReceipt['stableIds'] };
  verifierId: string;
  verifierEvidenceBytes: Uint8Array;
}): Uint8Array {
  const capability = getCivilLandscapeOutputCapability(input.binding.capabilityId);
  if (!capability || capability.id !== 'landscape.irrigation.schedule.internal' || !capability.exporterPath || !capability.parserPath || capability.verifierPaths.length === 0) throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_VERIFIER_REQUIRED');
  const parsedCardinality = input.parserResult.stableIds.rows.length;
  if (!SHA256.test(input.exporterSourceSha256) || !SHA256.test(input.parserSourceSha256) || !SHA256.test(input.parserResult.sourceArtifactSha256) || input.parserResult.sourceArtifactSha256 !== input.binding.artifactSha256 || input.parserResult.status !== 'verified' || input.parserResult.outputBytes.byteLength === 0 || !Number.isSafeInteger(input.parserResult.parsedRowCount) || input.parserResult.parsedRowCount < 0 || !Number.isSafeInteger(input.parserResult.parsedObjectCount) || input.parserResult.parsedObjectCount < 0 || input.parserResult.parsedRowCount !== parsedCardinality || input.parserResult.parsedObjectCount !== parsedCardinality || !validIds(input.parserResult.stableIds) || !capability.verifierPaths.includes(input.verifierId) || input.verifierEvidenceBytes.byteLength === 0) throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_RESULT_MISMATCH');
  const receipt: LandscapeIrrigationScheduleProbeReceipt = {
    schema: 'nexyfab.landscape-irrigation-schedule-probe.v1', capabilityId: input.binding.capabilityId, format: 'schedule',
    workspaceRevisionId: input.binding.workspaceRevisionId, workspaceContentHash: input.binding.workspaceContentHash,
    artifactSha256: input.binding.artifactSha256, artifactBytes: input.binding.artifactBytes,
    exporterId: input.exporterId, exporterSourceSha256: input.exporterSourceSha256, parserId: input.parserId, parserSourceSha256: input.parserSourceSha256, parserResult: 'verified', parserOutputSha256: sha256(input.parserResult.outputBytes), verifierId: input.verifierId, verifierEvidenceSha256: sha256(input.verifierEvidenceBytes), parsedRowCount: input.parserResult.parsedRowCount, parsedObjectCount: input.parserResult.parsedObjectCount, stableIds: input.parserResult.stableIds, hydraulicEvidence: 'NOT_RUN', externalInteroperability: 'HOLD', fieldEvidence: 'NOT_RUN', releaseReady: false,
  };
  return new TextEncoder().encode(canonicalJson(receipt));
}

export function claimLandscapeIrrigationScheduleProbe(input: { binding: BoundLandscapeIrrigationScheduleArtifact; evidenceBytes: Uint8Array }): LandscapeIrrigationScheduleProbeReceipt & { evidenceSha256: string; claim: 'internal-schedule-probe-verified' } {
  let evidence: LandscapeIrrigationScheduleProbeReceipt;
  try { evidence = JSON.parse(new TextDecoder().decode(input.evidenceBytes)) as LandscapeIrrigationScheduleProbeReceipt; } catch { throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_EVIDENCE_INVALID'); }
  if (canonicalJson(evidence) !== new TextDecoder().decode(input.evidenceBytes)) throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_EVIDENCE_NON_CANONICAL');
  const capability = getCivilLandscapeOutputCapability(input.binding.capabilityId);
  const evidenceCardinality = evidence.stableIds?.rows?.length;
  if (!capability || evidence.schema !== 'nexyfab.landscape-irrigation-schedule-probe.v1' || evidence.capabilityId !== input.binding.capabilityId || evidence.format !== input.binding.format || evidence.artifactSha256 !== input.binding.artifactSha256 || evidence.workspaceRevisionId !== input.binding.workspaceRevisionId || evidence.workspaceContentHash !== input.binding.workspaceContentHash || evidence.parserResult !== 'verified' || !SHA256.test(evidence.artifactSha256) || !SHA256.test(evidence.workspaceContentHash) || !SHA256.test(evidence.exporterSourceSha256) || !SHA256.test(evidence.parserSourceSha256) || !SHA256.test(evidence.parserOutputSha256) || !SHA256.test(evidence.verifierEvidenceSha256) || !validIds(evidence.stableIds) || !Number.isSafeInteger(evidence.parsedRowCount) || evidence.parsedRowCount < 0 || !Number.isSafeInteger(evidence.parsedObjectCount) || evidence.parsedObjectCount < 0 || evidence.parsedRowCount !== evidenceCardinality || evidence.parsedObjectCount !== evidenceCardinality || !capability.verifierPaths.includes(evidence.verifierId) || evidence.releaseReady !== false || evidence.hydraulicEvidence !== 'NOT_RUN' || evidence.externalInteroperability !== 'HOLD' || evidence.fieldEvidence !== 'NOT_RUN') throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_EVIDENCE_BINDING_MISMATCH');
  if (evidence.exporterId !== capability.exporterPath || evidence.parserId !== capability.parserPath || evidence.artifactBytes !== input.binding.artifactBytes) throw new Error('LANDSCAPE_IRRIGATION_SCHEDULE_STALE_REVISION');
  return { ...evidence, evidenceSha256: sha256(input.evidenceBytes), claim: 'internal-schedule-probe-verified' };
}
