import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const iso = z.string().datetime({ offset: false });
const postSchema = z.object({
  schema: z.literal('nexyfab.robot-post-integration-evidence.v1'),
  postIntegrationStatus: z.literal('passed'), programHash: sha, targetHash: sha,
  catalogManifestSha256: sha, releaseReady: z.literal(false), errors: z.array(z.string()).length(0),
  counts: z.object({ selectedOccurrences: z.literal(18), motionFrames: z.literal(156), checkedMotionFrames: z.literal(156), collisionFrames: z.literal(0), preciseInterferences: z.literal(0) }).passthrough(),
}).passthrough();
const exactCadSchema = z.object({
  schema: z.literal('nexyfab.robot-exact-cad-evidence.v1'), programHash: sha,
  signerId: z.string().min(1), signerIdentitySha256: sha, kernelStackIdentitySha256: sha,
  kernelEvidenceSha256: sha, revisionManifestSha256: sha, assemblyStepSha256: sha,
  drawingPackageSha256: sha, generatedAt: iso, partCount: z.literal(25), jointCount: z.literal(6),
  checks: z.object({ partRoundtrip: z.literal(true), assemblyXcafRoundtrip: z.literal(true), motion: z.literal(true), interference: z.literal(true), drawing: z.literal(true), units: z.literal(true), topology: z.literal(true) }).strict(),
  signature: z.string().min(1),
}).strict();
const manufacturingSchema = z.object({
  schema: z.literal('nexyfab.robot-manufacturing-validation.v1'), programHash: sha,
  catalogArtifactSetSha256: sha, reviewerId: z.string().min(1), generatedAt: iso,
  selectedComponentCount: z.literal(18),
  checks: z.object({ dfm: z.literal(true), toleranceStack: z.literal(true), bom: z.literal(true), fasteners: z.literal(true), cableRouting: z.literal(true), materials: z.literal(true), processPlan: z.literal(true) }).strict(),
  signature: z.string().min(1),
}).strict();

type ExactCad = z.infer<typeof exactCadSchema>;
type Manufacturing = z.infer<typeof manufacturingSchema>;
export type TrustedRobotExactCadKeys = Record<string, { publicKey: string }>;
export type RobotReleaseEvidenceAuditV2 = {
  schema: 'nexyfab.robot-release-evidence-audit.v2'; status: 'ready_for_final_review' | 'not_ready';
  releaseTargetHash: string | null; programHash: string | null; postIntegrationSha256: string;
  exactCadEvidenceSha256: string | null; manufacturingEvidenceSha256: string | null;
  exactCadEvidenceValid: boolean; manufacturingEvidenceValid: boolean; externalCadRequired: false;
  releaseReady: false; errors: string[]; blockers: string[];
  sideEffects: { persisted: false; cadModified: false; quoteCreated: false; rfqSent: false };
};

export function parseTrustedRobotExactCadKeys(raw: string | undefined): TrustedRobotExactCadKeys {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([id, entry]) => {
      const publicKey = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as { publicKey?: unknown }).publicKey : null;
      if (!id.trim() || typeof publicKey !== 'string' || !fingerprint(publicKey)) return [];
      return [[id, { publicKey: createPublicKey(publicKey).export({ type: 'spki', format: 'pem' }).toString() }]];
    }));
  } catch { return {}; }
}

export const robotExactCadEvidencePayload = (value: Omit<ExactCad, 'signature'>) => canonical(value);
export const robotManufacturingEvidencePayloadV2 = (value: Omit<Manufacturing, 'signature'>) => canonical(value);

export function auditRobotReleaseEvidenceV2(postBytes: Uint8Array, exactCadBytes: Uint8Array | null, manufacturingBytes: Uint8Array | null, trustedExactCad: TrustedRobotExactCadKeys, trustedManufacturing: TrustedRobotExactCadKeys): RobotReleaseEvidenceAuditV2 {
  const errors: string[] = [], postHash = digest(postBytes);
  const post = postSchema.safeParse(decode(postBytes, 'post-integration evidence', errors));
  if (!post.success) errors.push(...post.error.issues.map(issue => `post.${issue.path.join('.')}: ${issue.message}`));
  const exactHash = exactCadBytes ? digest(exactCadBytes) : null, manufacturingHash = manufacturingBytes ? digest(manufacturingBytes) : null;
  const exact = exactCadSchema.safeParse(exactCadBytes ? decode(exactCadBytes, 'NexyFab exact CAD evidence', errors) : null);
  const manufacturing = manufacturingSchema.safeParse(manufacturingBytes ? decode(manufacturingBytes, 'manufacturing evidence', errors) : null);
  if (!exactCadBytes) errors.push('NexyFab exact CAD evidence missing'); else if (!exact.success) errors.push(...exact.error.issues.map(issue => `exactCad.${issue.path.join('.')}: ${issue.message}`));
  if (!manufacturingBytes) errors.push('manufacturing evidence missing'); else if (!manufacturing.success) errors.push(...manufacturing.error.issues.map(issue => `manufacturing.${issue.path.join('.')}: ${issue.message}`));
  let exactValid = false, manufacturingValid = false;
  if (post.success && exact.success) {
    const registration = trustedExactCad[exact.data.signerId];
    if (exact.data.programHash !== post.data.programHash) errors.push('exact CAD evidence program hash mismatch');
    if (!registration || fingerprint(registration.publicKey) !== exact.data.signerIdentitySha256) errors.push('exact CAD signer identity is not trusted');
    else if (!verifySignature(robotExactCadEvidencePayload(withoutSignature(exact.data)), exact.data.signature, registration.publicKey)) errors.push('exact CAD evidence signature invalid');
    else if (exact.data.programHash === post.data.programHash) exactValid = true;
  }
  if (post.success && manufacturing.success) {
    const registration = trustedManufacturing[manufacturing.data.reviewerId];
    if (manufacturing.data.programHash !== post.data.programHash) errors.push('manufacturing evidence program hash mismatch');
    if (!registration) errors.push('manufacturing reviewer is not trusted');
    else if (!verifySignature(robotManufacturingEvidencePayloadV2(withoutSignature(manufacturing.data)), manufacturing.data.signature, registration.publicKey)) errors.push('manufacturing reviewer signature invalid');
    else if (manufacturing.data.programHash === post.data.programHash) manufacturingValid = true;
  }
  const ready = post.success && exactValid && manufacturingValid && errors.length === 0;
  const releaseTargetHash = ready ? digest(new TextEncoder().encode(canonical({ exactCadEvidenceSha256: exactHash, manufacturingEvidenceSha256: manufacturingHash, postIntegrationSha256: postHash, programHash: post.data.programHash }))) : null;
  return {
    schema: 'nexyfab.robot-release-evidence-audit.v2', status: ready ? 'ready_for_final_review' : 'not_ready', releaseTargetHash,
    programHash: post.success ? post.data.programHash : null, postIntegrationSha256: postHash,
    exactCadEvidenceSha256: exactHash, manufacturingEvidenceSha256: manufacturingHash,
    exactCadEvidenceValid: exactValid, manufacturingEvidenceValid: manufacturingValid,
    externalCadRequired: false, releaseReady: false, errors: [...new Set(errors)],
    blockers: ready ? ['final_release_dual_signoff_required'] : [...(!exactValid ? ['nexyfab_exact_cad_evidence_required'] : []), ...(!manufacturingValid ? ['manufacturing_validation_required'] : []), 'final_release_dual_signoff_required'],
    sideEffects: { persisted: false, cadModified: false, quoteCreated: false, rfqSent: false },
  };
}

function decode(bytes: Uint8Array, label: string, errors: string[]) { try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { errors.push(`${label} must be valid UTF-8 JSON`); return null; } }
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex'); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`; return JSON.stringify(value); }
function withoutSignature<T extends { signature: string }>(value: T): Omit<T, 'signature'> { const { signature: _signature, ...rest } = value; return rest; }
function fingerprint(key: string) { try { return createHash('sha256').update(createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex'); } catch { return null; } }
function verifySignature(payload: string, signature: string, key: string) { try { return verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64')); } catch { return false; } }
