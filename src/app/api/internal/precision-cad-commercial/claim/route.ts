import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { hmacCommercialTransport, type CommercialTransportEnvelope } from '../../../../../../packages/job-contracts/src/commercialPrecisionExecution';
import { CommercialExecutionOutboxStore } from '@/lib/precision-cad-agent/commercialExecutionOutboxStore';
import { loadTrustedCommercialWorkers } from '@/lib/precision-cad-agent/commercialWorkerReceipt';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
function auth(req: NextRequest): boolean { const expected = process.env.NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET ?? ''; const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''; const a = Buffer.from(expected); const b = Buffer.from(supplied); return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b); }
export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  let body: { owner?: unknown }; try { body = await readBoundedJson<{ owner?: unknown }>(req, 64 * 1024); } catch (error) { const bounded = boundedJsonError(error); return NextResponse.json({ ok: false, code: bounded?.code ?? 'INVALID_JSON' }, { status: bounded?.status ?? 400 }); }
  const owner = typeof body.owner === 'string' ? body.owner : ''; const transportSecret = process.env.NEXYFAB_COMMERCIAL_TRANSPORT_SECRET ?? ''; const callbackUrl = process.env.NEXYFAB_COMMERCIAL_CALLBACK_URL ?? '';
  const workers = loadTrustedCommercialWorkers(); if (!workers || !workers[owner]) return NextResponse.json({ ok: false, code: 'WORKER_IDENTITY_NOT_REGISTERED', releaseReady: false }, { status: 403 });
  if (!transportSecret || transportSecret.length < 32 || !callbackUrl) return NextResponse.json({ ok: false, code: 'COMMERCIAL_EXECUTION_NOT_CONFIGURED', releaseReady: false }, { status: 503 });
  try {
    const result = await new CommercialExecutionOutboxStore(getDbAdapter()).claim(owner, transportSecret);
    if (!result.ok) return NextResponse.json({ ok: false, code: result.code, releaseReady: false }, { status: result.code === 'NOT_FOUND' ? 404 : 409 });
    const transportJob = result.row.job;
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1') {
      // Receipt identity is server-owned. Resolve the immutable PG binding by
      // the authenticated job identity; never trust fields copied into JSON.
      const binding = await getDbAdapter().queryOne<Record<string, unknown>>(
        'SELECT r.workspace_id, r.workspace_revision, r.head_revision, r.head_sha256, v.generation_program_sha256 FROM nf_commercial_generation_runs r JOIN nf_commercial_generation_revisions v ON v.tenant_id = r.tenant_id AND v.project_id = r.project_id AND v.run_id = r.run_id AND v.revision = r.head_revision WHERE r.tenant_id = ? AND r.project_id = ? AND r.run_id = ? AND r.status = ?',
        result.row.job.tenantId, result.row.job.projectId, result.row.job.generationRunId, 'ACTIVE',
      );
      if (!binding || binding.workspace_id !== result.row.job.workspaceId || Number(binding.workspace_revision) !== result.row.job.workspaceRevision || binding.head_sha256 !== result.row.job.workspaceContentHash || Number(binding.head_revision) !== result.row.job.generationStateRevision || binding.generation_program_sha256 !== result.row.job.generationProgramSha256 || result.row.job.generationProgramSha256 === '0'.repeat(64)) return NextResponse.json({ ok: false, code: 'VERIFIED_GENERATION_BINDING_REQUIRED', status: 'HOLD', releaseReady: false }, { status: 409 });
    }
    const unsigned: Omit<CommercialTransportEnvelope, 'transportHmac'> = { schema: 'nexyfab.precision-cad-commercial-execution.v2', job: transportJob, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(), callbackUrl, leaseCapability: result.row.capability };
    return NextResponse.json({ ok: true, transport: { ...unsigned, transportHmac: await hmacCommercialTransport(transportSecret, unsigned) }, releaseReady: false }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return NextResponse.json({ ok: false, code: String(error).includes('migration_required') ? 'MIGRATION_REQUIRED' : 'CLAIM_FAILED', releaseReady: false }, { status: 503 }); }
}
