import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TrustedReviewerKeys } from '@/lib/reference/nativeCadExpertReview';
import { summarizeTrustedReviewerRegistry } from '@/lib/reference/nativeCadExpertReview';
import type { TrustedRobotExactCadKeys } from './robotReleaseEvidenceAuditV2';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const postSchema = z.object({ schema: z.literal('nexyfab.robot-post-integration-evidence.v1'), postIntegrationStatus: z.literal('passed'), programHash: sha, targetHash: sha, catalogManifestSha256: sha, releaseReady: z.literal(false), errors: z.array(z.string()).length(0), counts: z.object({ selectedOccurrences: z.literal(18), motionFrames: z.literal(156), checkedMotionFrames: z.literal(156), collisionFrames: z.literal(0), preciseInterferences: z.literal(0) }).passthrough() }).passthrough();

export type RobotReleaseWorkPacketV2 = {
  schema: 'nexyfab.robot-release-evidence-work-packet.v2'; packetHash: string; programHash: string;
  postIntegrationSha256: string; integrationTargetHash: string; catalogManifestSha256: string;
  externalCadRequired: false; sourceBytesEmbedded: false; privateKeysEmbedded: false; releaseReady: false;
  registryPreflight: { exactCadSignerKeys: number; manufacturingReviewerKeys: number; finalReview: ReturnType<typeof summarizeTrustedReviewerRegistry> };
  exactCadTask: { outputSchema: 'nexyfab.robot-exact-cad-evidence.v1'; requiredChecks: string[]; requiredCounts: { jointCount: 6; partCount: 25 }; signaturePayloadFunction: 'robotExactCadEvidencePayload'; trustedRegistryEnvironment: 'NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS' };
  manufacturingTask: { outputSchema: 'nexyfab.robot-manufacturing-validation.v1'; requiredChecks: string[]; selectedComponentCount: 18; signaturePayloadFunction: 'robotManufacturingEvidencePayloadV2'; trustedRegistryEnvironment: 'NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS' };
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
    exactCadTask: { outputSchema: 'nexyfab.robot-exact-cad-evidence.v1' as const, requiredChecks: ['partRoundtrip', 'assemblyXcafRoundtrip', 'motion', 'interference', 'drawing', 'units', 'topology'], requiredCounts: { jointCount: 6 as const, partCount: 25 as const }, signaturePayloadFunction: 'robotExactCadEvidencePayload' as const, trustedRegistryEnvironment: 'NEXYFAB_ROBOT_EXACT_CAD_SIGNER_KEYS' as const },
    manufacturingTask: { outputSchema: 'nexyfab.robot-manufacturing-validation.v1' as const, requiredChecks: ['dfm', 'toleranceStack', 'bom', 'fasteners', 'cableRouting', 'materials', 'processPlan'], selectedComponentCount: 18 as const, signaturePayloadFunction: 'robotManufacturingEvidencePayloadV2' as const, trustedRegistryEnvironment: 'NEXYFAB_ROBOT_MANUFACTURING_REVIEWER_KEYS' as const },
    finalReviewTask: { startsOnlyAfterReleaseAuditReady: true as const, requiredRoles: ['domain-reviewer', 'independent-reviewer'] as ['domain-reviewer', 'independent-reviewer'], trustedRegistryEnvironment: 'NEXYFAB_CAD_REVIEWER_KEYS' as const, releaseExecutionIncluded: false as const },
  };
  return { schema: 'nexyfab.robot-release-evidence-work-packet.v2', packetHash: digest(new TextEncoder().encode(canonical(body))), ...body, externalCadRequired: false, sourceBytesEmbedded: false, privateKeysEmbedded: false, releaseReady: false, registryPreflight: { exactCadSignerKeys: Object.keys(exactKeys).length, manufacturingReviewerKeys: Object.keys(manufacturingKeys).length, finalReview: summarizeTrustedReviewerRegistry(finalReview) }, errors: [...new Set(errors)] };
}

function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
