import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getDbAdapter } from '@/lib/db-adapter';
import { getStorage } from '@/lib/storage';
import type { CommercialExecutionJob, CommercialWorkerReceipt } from '../../../../../packages/job-contracts/src/commercialPrecisionExecution';
import { loadTrustedCommercialWorkers } from '@/lib/precision-cad-agent/commercialWorkerReceipt';
import { persistCommercialWorkerResult } from '@/lib/precision-cad-agent/commercialWorkerPersistenceCoordinator';
import type { NativeParserReceipt } from '@/lib/precision-cad-agent/commercialPersistenceReceipt';
import { loadServerAgenticCommercialTrust } from '@/lib/ai/serverAgenticCommercialTrust';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function auth(req: NextRequest): boolean { const expected = process.env.CRON_SECRET ?? ''; const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''; const a = Buffer.from(expected); const b = Buffer.from(supplied); return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b); }
type Body = { executionId?: string; parserReceipt?: NativeParserReceipt };
function json(status: number, body: Record<string, unknown>): NextResponse { return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }

export async function POST(req: NextRequest) {
  if (!auth(req)) return json(process.env.CRON_SECRET ? 403 : 503, { ok: false, code: process.env.CRON_SECRET ? 'FORBIDDEN' : 'CRON_AUTH_NOT_CONFIGURED', releaseReady: false });
  let body: Body;
  try { body = await readBoundedJson<Body>(req, 512 * 1024); } catch (error) { const bounded = boundedJsonError(error); return json(bounded?.status ?? 400, { ok: false, code: bounded?.code ?? 'INVALID_JSON', releaseReady: false }); }
  if (!body.executionId || !body.parserReceipt) return json(422, { ok: false, code: 'PARSER_RECEIPT_REQUIRED', releaseReady: false });
  try {
    const db = getDbAdapter();
    const workers = loadTrustedCommercialWorkers();
    const commonTrust = loadServerAgenticCommercialTrust();
    if (!workers || !commonTrust.ok) return json(503, { ok: false, code: 'TRUST_REGISTRY_NOT_CONFIGURED', releaseReady: false });
    const parserIdentity = commonTrust.identities.find(item => item.role === 'native_parser' && item.identityId === body.parserReceipt!.parserIdentity);
    if (!parserIdentity) return json(422, { ok: false, code: 'PARSER_NOT_TRUSTED', releaseReady: false });
    const parser = { parserIdentity: parserIdentity.identityId, publicKeyPem: parserIdentity.publicKeyPem, fingerprintSha256: parserIdentity.fingerprintSha256 };
    const row = await db.queryOne<Record<string, unknown>>('SELECT job_json FROM nf_precision_cad_commercial_outbox WHERE execution_id = ?', body.executionId);
    const callback = await db.queryOne<Record<string, unknown>>('SELECT receipt_json FROM nf_precision_cad_commercial_callbacks WHERE execution_id = ?', body.executionId);
    const artifacts = await db.queryAll<Record<string, unknown>>('SELECT artifact_id, artifact_role, object_key, content_sha256, byte_length FROM nf_precision_cad_commercial_worker_artifacts WHERE execution_id = ?', body.executionId);
    if (!row || !callback || typeof callback.receipt_json !== 'string' || artifacts.length !== 3) return json(202, { ok: false, code: 'AUTHORITATIVE_WORKER_RECEIPT_REQUIRED', releaseReady: false });
    const receipt = JSON.parse(callback.receipt_json) as CommercialWorkerReceipt;
    const job = JSON.parse(String(row.job_json)) as CommercialExecutionJob;
    const storage = getStorage();
    if (!storage.download || !storage.uploadRaw) return json(503, { ok: false, code: 'PRIVATE_ARTIFACT_STORE_NOT_CONFIGURED', releaseReady: false });
    const capabilityRow = await db.queryOne<Record<string, unknown>>('SELECT capability_hash FROM nf_precision_cad_commercial_outbox WHERE execution_id = ?', body.executionId);
    const inputArtifactSha256 = job.inputArtifact?.contentSha256;
    if (!inputArtifactSha256) return json(202, { ok: false, code: 'IMMUTABLE_INPUT_REQUIRED', releaseReady: false });
    const result = await persistCommercialWorkerResult({ db, artifactStore: { read: async key => { try { return new Uint8Array(await storage.download!(key)); } catch { return null; } }, putImmutable: async (key, bytes) => storage.uploadRaw!(Buffer.from(bytes), key, 'application/octet-stream') }, receipt, expected: { ...job, inputArtifactSha256, leaseCapabilityHash: String(capabilityRow?.capability_hash ?? '') }, trustedWorkers: workers, metadata: artifacts.map(item => ({ artifactId: String(item.artifact_id), role: String(item.artifact_role) as 'model' | 'report' | 'verification', objectKey: String(item.object_key), contentSha256: String(item.content_sha256), byteLength: Number(item.byte_length) })), parserReceipt: body.parserReceipt, trustedParser: parser });
    return result.ok ? json(200, { ok: true, status: result.status, executionId: result.executionId, workerReceiptHash: result.workerReceiptHash, persistenceReceiptHash: result.persistenceReceiptHash, releaseReady: false }) : json(202, { ok: false, status: 'HOLD', code: result.code, issues: result.issues, orphanKeys: result.orphanKeys ?? [], releaseReady: false });
  } catch (error) { return json(503, { ok: false, code: String(error).includes('migration_required') ? 'MIGRATION_REQUIRED' : 'PERSISTENCE_FAILED', releaseReady: false }); }
}
