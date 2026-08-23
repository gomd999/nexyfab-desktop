import { createHmac, timingSafeEqual } from 'node:crypto';
import { isSha256, serverEvidenceSha256 } from './serverEvidence';

export interface CommercialFinalizationReceipt {
  schema: 'nexyfab.commercial-finalization-receipt.v2';
  runId: string;
  revision: number;
  partId: string;
  programSha256: string;
  kernelCheckpointHash: string;
  topologyCheckpointHash: string;
  partEvidenceSha256: string;
  verifier: 'generation-artifact-verifier-v1';
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

type ReceiptInput = {
  runId: string;
  revision: number;
  partId: string;
  programSha256: string;
  kernelCheckpointHash: string;
  topologyCheckpointHash: string;
  partEvidence: unknown;
};

const payload = (receipt: Omit<CommercialFinalizationReceipt, 'signature'>) => serverEvidenceSha256(receipt);
const validSecret = (secret: string) => Buffer.byteLength(secret, 'utf8') >= 32;

export function issueCommercialFinalizationReceipt(input: ReceiptInput, secret: string, now = new Date(), ttlMs = 10 * 60_000): CommercialFinalizationReceipt {
  if (!validSecret(secret)) throw new Error('GENERATION_EVIDENCE_SIGNING_SECRET_WEAK');
  if (!input.runId.trim() || !input.partId.trim() || !Number.isSafeInteger(input.revision) || input.revision < 0
    || !isSha256(input.programSha256) || !isSha256(input.kernelCheckpointHash) || !isSha256(input.topologyCheckpointHash)) {
    throw new Error('GENERATION_EVIDENCE_RECEIPT_INPUT_INVALID');
  }
  const unsigned: Omit<CommercialFinalizationReceipt, 'signature'> = {
    schema: 'nexyfab.commercial-finalization-receipt.v2',
    runId: input.runId,
    revision: input.revision,
    partId: input.partId,
    programSha256: input.programSha256,
    kernelCheckpointHash: input.kernelCheckpointHash,
    topologyCheckpointHash: input.topologyCheckpointHash,
    partEvidenceSha256: serverEvidenceSha256(input.partEvidence),
    verifier: 'generation-artifact-verifier-v1',
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
  };
  return { ...unsigned, signature: createHmac('sha256', secret).update(payload(unsigned)).digest('hex') };
}

export function verifyCommercialFinalizationReceipt(receipt: CommercialFinalizationReceipt | undefined, expected: ReceiptInput, secret: string, now = new Date()): string[] {
  if (!validSecret(secret)) return ['GENERATION_EVIDENCE_SIGNING_SECRET_REQUIRED'];
  if (!receipt || receipt.schema !== 'nexyfab.commercial-finalization-receipt.v2') return ['COMMERCIAL_SERVER_EVIDENCE_REQUIRED'];
  const errors: string[] = [];
  if (receipt.runId !== expected.runId || receipt.revision !== expected.revision || receipt.partId !== expected.partId) errors.push('GENERATION_EVIDENCE_SCOPE_MISMATCH');
  if (receipt.programSha256 !== expected.programSha256) errors.push('GENERATION_PROGRAM_BINDING_MISMATCH');
  if (receipt.kernelCheckpointHash !== expected.kernelCheckpointHash || receipt.topologyCheckpointHash !== expected.topologyCheckpointHash) errors.push('GENERATION_EXACT_CAD_CHECKPOINT_MISMATCH');
  if (receipt.partEvidenceSha256 !== serverEvidenceSha256(expected.partEvidence)) errors.push('CLIENT_ASSERTED_MEASUREMENT_REJECTED');
  const expires = Date.parse(receipt.expiresAt), issued = Date.parse(receipt.issuedAt);
  if (!Number.isFinite(expires) || !Number.isFinite(issued) || issued > now.getTime() + 30_000 || expires <= now.getTime() || expires <= issued) errors.push('GENERATION_EVIDENCE_RECEIPT_EXPIRED');
  const { signature, ...unsigned } = receipt;
  const expectedSignature = createHmac('sha256', secret).update(payload(unsigned)).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(signature)) errors.push('RELEASE_EVIDENCE_SIGNATURE_INVALID');
  else {
    const actual = Buffer.from(signature, 'hex'), reference = Buffer.from(expectedSignature, 'hex');
    if (actual.length !== reference.length || !timingSafeEqual(actual, reference)) errors.push('RELEASE_EVIDENCE_SIGNATURE_INVALID');
  }
  return [...new Set(errors)].sort();
}
