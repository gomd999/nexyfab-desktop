import { createHmac, timingSafeEqual } from 'node:crypto';
import { isSha256, serverEvidenceSha256 } from './serverEvidence';
import type { AiDesignGenerationStage } from './aiDesignGenerationOrchestrator';

export const AI_DESIGN_SERVER_EVIDENCE_RECEIPT_SCHEMA = 'nexyfab.ai-design-server-evidence-receipt.v1' as const;

export interface AiDesignServerEvidenceReceiptV1 {
  schema: typeof AI_DESIGN_SERVER_EVIDENCE_RECEIPT_SCHEMA;
  receiptId: string;
  projectId: string;
  sessionId: string;
  commandId: string;
  checkpointId: string;
  checkpointDigest: string;
  runtimeRevision: number;
  generationRevision: number | null;
  stage: AiDesignGenerationStage | 'understanding' | 'candidate_publication';
  outcome: 'PASS' | 'FAIL';
  inputDigest: string;
  outputDigest: string;
  producer: 'ai-design-server-runtime-v2';
  source: string;
  codes: readonly string[];
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export type IssueAiDesignServerEvidenceInput = Omit<
  AiDesignServerEvidenceReceiptV1,
  'schema' | 'receiptId' | 'producer' | 'issuedAt' | 'expiresAt' | 'signature'
>;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const SAFE_CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_CODES = 32;
const MIN_SECRET_BYTES = 32;
const MAX_TTL_MS = 60 * 60_000;

function validSecret(secret: string): boolean {
  return Buffer.byteLength(secret, 'utf8') >= MIN_SECRET_BYTES;
}

function unsigned(receipt: AiDesignServerEvidenceReceiptV1): Omit<AiDesignServerEvidenceReceiptV1, 'signature'> {
  const { signature: _signature, ...value } = receipt;
  return value;
}

function payload(value: Omit<AiDesignServerEvidenceReceiptV1, 'signature'>): string {
  return serverEvidenceSha256(value);
}

function validateInput(input: IssueAiDesignServerEvidenceInput): void {
  const ids = [input.projectId, input.sessionId, input.commandId, input.checkpointId, input.source];
  if (ids.some(value => !SAFE_ID.test(value))) throw new Error('AI_DESIGN_EVIDENCE_IDENTITY_INVALID');
  if (!isSha256(input.checkpointDigest) || !isSha256(input.inputDigest) || !isSha256(input.outputDigest)) {
    throw new Error('AI_DESIGN_EVIDENCE_DIGEST_INVALID');
  }
  if (!Number.isSafeInteger(input.runtimeRevision) || input.runtimeRevision < 0
    || (input.generationRevision !== null && (!Number.isSafeInteger(input.generationRevision) || input.generationRevision < 0))) {
    throw new Error('AI_DESIGN_EVIDENCE_REVISION_INVALID');
  }
  if (!['understanding', 'planning', 'candidate_generation', 'candidate_validation', 'candidate_publication'].includes(input.stage)) {
    throw new Error('AI_DESIGN_EVIDENCE_STAGE_INVALID');
  }
  if (!['PASS', 'FAIL'].includes(input.outcome) || input.codes.length > MAX_CODES || input.codes.some(code => !SAFE_CODE.test(code))) {
    throw new Error('AI_DESIGN_EVIDENCE_RESULT_INVALID');
  }
}

/** Issue only after a server worker or deterministic verifier produced the bound output. */
export function issueAiDesignServerEvidenceReceipt(
  input: IssueAiDesignServerEvidenceInput,
  secret: string,
  now = new Date(),
  ttlMs = 10 * 60_000,
): AiDesignServerEvidenceReceiptV1 {
  if (!validSecret(secret)) throw new Error('AI_DESIGN_EVIDENCE_SIGNING_SECRET_WEAK');
  validateInput(input);
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TTL_MS) throw new Error('AI_DESIGN_EVIDENCE_TTL_INVALID');
  const issuedAt = now.toISOString();
  const base = {
    schema: AI_DESIGN_SERVER_EVIDENCE_RECEIPT_SCHEMA,
    receiptId: `ai-evidence:${serverEvidenceSha256({ ...input, issuedAt }).slice(0, 48)}`,
    ...input,
    producer: 'ai-design-server-runtime-v2' as const,
    codes: [...new Set(input.codes)],
    issuedAt,
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  return { ...base, signature: createHmac('sha256', secret).update(payload(base)).digest('hex') };
}

export interface AiDesignEvidenceExpectedBinding {
  projectId: string;
  sessionId: string;
  commandId: string;
  checkpointId: string;
  checkpointDigest: string;
  runtimeRevision: number;
  generationRevision?: number | null;
  stage: AiDesignServerEvidenceReceiptV1['stage'];
  inputDigest?: string;
  outputDigest?: string;
  outcome?: AiDesignServerEvidenceReceiptV1['outcome'];
}

export function verifyAiDesignServerEvidenceReceipt(
  receipt: AiDesignServerEvidenceReceiptV1 | null | undefined,
  expected: AiDesignEvidenceExpectedBinding,
  secret: string,
  now = new Date(),
): readonly string[] {
  if (!validSecret(secret)) return ['AI_DESIGN_EVIDENCE_SIGNING_SECRET_REQUIRED'];
  if (!receipt || receipt.schema !== AI_DESIGN_SERVER_EVIDENCE_RECEIPT_SCHEMA) return ['AI_DESIGN_SERVER_EVIDENCE_REQUIRED'];
  const issues: string[] = [];
  try { validateInput(receipt); } catch (error) { issues.push(error instanceof Error ? error.message : 'AI_DESIGN_EVIDENCE_INVALID'); }
  if (receipt.projectId !== expected.projectId || receipt.sessionId !== expected.sessionId || receipt.commandId !== expected.commandId) issues.push('AI_DESIGN_EVIDENCE_SCOPE_MISMATCH');
  if (receipt.checkpointId !== expected.checkpointId || receipt.checkpointDigest !== expected.checkpointDigest) issues.push('AI_DESIGN_EVIDENCE_CHECKPOINT_MISMATCH');
  if (receipt.runtimeRevision !== expected.runtimeRevision || (expected.generationRevision !== undefined && receipt.generationRevision !== expected.generationRevision)) issues.push('AI_DESIGN_EVIDENCE_REVISION_MISMATCH');
  if (receipt.stage !== expected.stage) issues.push('AI_DESIGN_EVIDENCE_STAGE_MISMATCH');
  if (expected.inputDigest && receipt.inputDigest !== expected.inputDigest) issues.push('AI_DESIGN_EVIDENCE_INPUT_MISMATCH');
  if (expected.outputDigest && receipt.outputDigest !== expected.outputDigest) issues.push('AI_DESIGN_EVIDENCE_OUTPUT_MISMATCH');
  if (expected.outcome && receipt.outcome !== expected.outcome) issues.push('AI_DESIGN_EVIDENCE_OUTCOME_MISMATCH');
  const issued = Date.parse(receipt.issuedAt), expires = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || issued > now.getTime() + 30_000 || expires <= now.getTime() || expires <= issued || expires - issued > MAX_TTL_MS) {
    issues.push('AI_DESIGN_EVIDENCE_EXPIRED');
  }
  const expectedSignature = createHmac('sha256', secret).update(payload(unsigned(receipt))).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(receipt.signature)) issues.push('AI_DESIGN_EVIDENCE_SIGNATURE_INVALID');
  else {
    const actual = Buffer.from(receipt.signature, 'hex');
    const reference = Buffer.from(expectedSignature, 'hex');
    if (actual.length !== reference.length || !timingSafeEqual(actual, reference)) issues.push('AI_DESIGN_EVIDENCE_SIGNATURE_INVALID');
  }
  return [...new Set(issues)].sort();
}

