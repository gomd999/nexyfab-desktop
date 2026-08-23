import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';
import { summarizeTrustedReviewerRegistry } from '@/lib/reference/nativeCadExpertReview';
import type { TrustedRobotExactCadKeys } from './robotReleaseEvidenceAuditV2';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const releaseBlocker = z.enum(['nexyfab_exact_cad_evidence_required', 'manufacturing_validation_required', 'final_expert_release_review_required']);
const postSchema = z.object({
  schema: z.literal('nexyfab.robot-post-integration-evidence.v1'), postIntegrationStatus: z.literal('passed'),
  integrationAuthorized: z.literal(true), selectedOccurrencesVerified: z.literal(true), precisionStatus: z.literal('passed'),
  lineageId: z.string().min(1), revision: z.number().int().positive(), programHash: sha, preciseReportHash: sha,
  applicationReceiptHash: sha, applicationHash: sha, targetHash: sha, catalogManifestSha256: sha, housingSha256: sha,
  releaseReady: z.literal(false), errors: z.array(z.string()).length(0),
  blockers: z.array(releaseBlocker).length(3).refine(values => new Set(values).size === 3, 'all three distinct release blockers are required'),
  counts: z.object({ selectedOccurrences: z.literal(18), auxiliaryOccurrences: z.literal(4), appliedOccurrences: z.literal(22), catalogUnresolved: z.literal(0), motionFrames: z.literal(156), checkedMotionFrames: z.literal(156), collisionFrames: z.literal(0), coordinatedMotionFrames: z.literal(49), checkedCoordinatedMotionFrames: z.literal(49), coordinatedCollisionFrames: z.literal(0), preciseInterferences: z.literal(0) }).strict(),
  sideEffects: z.object({ persisted: z.literal(false), sourceModified: z.literal(false), workspaceModified: z.literal(false), quoteCreated: z.literal(false), rfqSent: z.literal(false) }).strict(),
}).passthrough();

export type RobotReleaseWorkPacketV2 = {
  schema: 'nexyfab.robot-release-evidence-work-packet.v3'; packetHash: string; programHash: string;
  postIntegrationSha256: string; integrationTargetHash: string; catalogManifestSha256: string;
  lineageId: string; revision: number; preciseReportHash: string; applicationHash: string;
  applicationReceiptHash: string; housingSha256: string;
  externalCadRequired: false; sourceBytesEmbedded: false; privateKeysEmbedded: false; releaseReady: false;
  registryPreflight: { exactCadSignerKeys: number; manufacturingReviewerKeys: number; finalReview: ReturnType<typeof summarizeTrustedReviewerRegistry> };
  exactCadTask: { outputSchema: 'nexyfab.robot-exact-cad-evidence.v3'; requiredChecks: string[]; requiredCounts: { jointCount: 6; partCount: 29 }; signaturePayloadFunction: 'robotExactCadEvidencePayload'; trustedRegistryEnvironment: 'NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS' };
  manufacturingTask: { outputSchema: 'nexyfab.robot-manufacturing-validation.v3'; requiredChecks: string[]; selectedComponentCount: 22; driveComponentCount: 18; auxiliaryComponentCount: 4; signaturePayloadFunction: 'robotManufacturingEvidencePayloadV3'; trustedRegistryEnvironment: 'NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS' };
  finalReviewTask: { startsOnlyAfterReleaseAuditReady: true; requiredRoles: ['domain-reviewer', 'independent-reviewer']; trustedRegistryEnvironment: 'NEXYFAB_CAD_REVIEWER_KEYS'; releaseExecutionIncluded: false };
  errors: string[];
};

export function buildRobotReleaseWorkPacketV2(postBytes: Uint8Array, exactKeys: TrustedRobotExactCadKeys, manufacturingKeys: TrustedRobotExactCadKeys, finalReview: TrustedReviewerKeys): RobotReleaseWorkPacketV2 {
  const errors: string[] = [];
  let raw: unknown = null;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(postBytes)); }
  catch { errors.push('post-integration report must be valid UTF-8 JSON'); }
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) errors.push(...parsed.error.issues.map(issue => `post.${issue.path.join('.')}: ${issue.message}`));
  const programHash = parsed.success ? parsed.data.programHash : '0'.repeat(64);
  const body = {
    programHash, postIntegrationSha256: digest(postBytes),
    integrationTargetHash: parsed.success ? parsed.data.targetHash : '0'.repeat(64),
    catalogManifestSha256: parsed.success ? parsed.data.catalogManifestSha256 : '0'.repeat(64),
    lineageId: parsed.success ? parsed.data.lineageId : '',
    revision: parsed.success ? parsed.data.revision : 0,
    preciseReportHash: parsed.success ? parsed.data.preciseReportHash : '0'.repeat(64),
    applicationHash: parsed.success ? parsed.data.applicationHash : '0'.repeat(64),
    applicationReceiptHash: parsed.success ? parsed.data.applicationReceiptHash : '0'.repeat(64),
    housingSha256: parsed.success ? parsed.data.housingSha256 : '0'.repeat(64),
    exactCadTask: { outputSchema: 'nexyfab.robot-exact-cad-evidence.v3' as const, requiredChecks: ['partRoundtrip', 'assemblyXcafRoundtrip', 'motion', 'interference', 'drawing', 'units', 'topology'], requiredCounts: { jointCount: 6 as const, partCount: 29 as const }, signaturePayloadFunction: 'robotExactCadEvidencePayload' as const, trustedRegistryEnvironment: 'NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS' as const },
    manufacturingTask: { outputSchema: 'nexyfab.robot-manufacturing-validation.v3' as const, requiredChecks: ['dfm', 'toleranceStack', 'bom', 'fasteners', 'cableRouting', 'materials', 'processPlan'], selectedComponentCount: 22 as const, driveComponentCount: 18 as const, auxiliaryComponentCount: 4 as const, signaturePayloadFunction: 'robotManufacturingEvidencePayloadV3' as const, trustedRegistryEnvironment: 'NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS' as const },
    finalReviewTask: { startsOnlyAfterReleaseAuditReady: true as const, requiredRoles: ['domain-reviewer', 'independent-reviewer'] as ['domain-reviewer', 'independent-reviewer'], trustedRegistryEnvironment: 'NEXYFAB_CAD_REVIEWER_KEYS' as const, releaseExecutionIncluded: false as const },
  };
  return { schema: 'nexyfab.robot-release-evidence-work-packet.v3', packetHash: digest(new TextEncoder().encode(canonical(body))), ...body, externalCadRequired: false, sourceBytesEmbedded: false, privateKeysEmbedded: false, releaseReady: false, registryPreflight: { exactCadSignerKeys: Object.keys(exactKeys).length, manufacturingReviewerKeys: Object.keys(manufacturingKeys).length, finalReview: summarizeTrustedReviewerRegistry(finalReview) }, errors: [...new Set(errors)] };
}

function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
