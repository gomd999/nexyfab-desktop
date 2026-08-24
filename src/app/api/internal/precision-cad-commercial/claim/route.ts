import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { hmacCommercialTransport, validateCommercialTransport, type CommercialTransportEnvelope } from '../../../../../../packages/job-contracts/src/commercialPrecisionExecution';
import { CommercialExecutionOutboxStore } from '@/lib/precision-cad-agent/commercialExecutionOutboxStore';
import { loadTrustedCommercialWorkers } from '@/lib/precision-cad-agent/commercialWorkerReceipt';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getStorage } from '@/lib/storage';

export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';
function auth(req: NextRequest): boolean { const expected = process.env.NEXYFAB_COMMERCIAL_WORKER_CLAIM_SECRET ?? ''; const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''; const a = Buffer.from(expected); const b = Buffer.from(supplied); return a.length >= 32 && a.length === b.length && timingSafeEqual(a, b); }
export async function POST(req: NextRequest) {
  if (!auth(req)) return NextResponse.json({ ok: false, code: 'FORBIDDEN' }, { status: 403 });
  let body: { owner?: unknown }; try { body = await readBoundedJson<{ owner?: unknown }>(req, 64 * 1024); } catch (error) { const bounded = boundedJsonError(error); return NextResponse.json({ ok: false, code: bounded?.code ?? 'INVALID_JSON' }, { status: bounded?.status ?? 400 }); }
  const owner = typeof body.owner === 'string' ? body.owner : ''; const transportSecret = process.env.NEXYFAB_COMMERCIAL_TRANSPORT_SECRET ?? ''; const callbackUrl = process.env.NEXYFAB_COMMERCIAL_CALLBACK_URL ?? '';
  const workers = loadTrustedCommercialWorkers(); if (!workers || !workers[owner]) return NextResponse.json({ ok: false, code: 'WORKER_IDENTITY_NOT_REGISTERED', releaseReady: false }, { status: 403 });
  if (!transportSecret || transportSecret.length < 32 || !callbackUrl) return NextResponse.json({ ok: false, code: 'COMMERCIAL_EXECUTION_NOT_CONFIGURED', releaseReady: false }, { status: 503 });
  try {
    const configuredLeaseMs = Number(process.env.NEXYFAB_COMMERCIAL_WORKER_LEASE_MS ?? 15 * 60_000);
    const leaseMs = Number.isSafeInteger(configuredLeaseMs) && configuredLeaseMs >= 30_000 && configuredLeaseMs <= 30 * 60_000 ? configuredLeaseMs : 15 * 60_000;
    const result = await new CommercialExecutionOutboxStore(getDbAdapter()).claim(owner, transportSecret, Date.now(), leaseMs);
    if (!result.ok) return NextResponse.json({ ok: false, code: result.code, releaseReady: false }, { status: result.code === 'NOT_FOUND' ? 404 : 409 });
    const transportJob = result.row.job;
    const inputArtifact = transportJob.inputArtifact;
    if (!inputArtifact) {
      await new CommercialExecutionOutboxStore(getDbAdapter()).hold(transportJob.jobId, 'immutable_input_required');
      return NextResponse.json({ ok: false, code: 'IMMUTABLE_INPUT_REQUIRED', status: 'HOLD', releaseReady: false }, { status: 409 });
    }
    const inputRow = await getDbAdapter().queryOne<Record<string, unknown>>(
      'SELECT execution_id, tenant_id, project_id, artifact_id, object_key, content_sha256, byte_length, media_type FROM nf_precision_cad_commercial_input_artifacts WHERE job_id = ?',
      transportJob.jobId,
    );
    const inputRowMatches = inputRow
      && inputRow.execution_id === transportJob.executionId
      && inputRow.tenant_id === transportJob.tenantId
      && inputRow.project_id === transportJob.projectId
      && inputRow.artifact_id === inputArtifact.artifactId
      && inputRow.object_key === inputArtifact.objectKey
      && inputRow.content_sha256 === inputArtifact.contentSha256
      && Number(inputRow.byte_length) === inputArtifact.byteLength
      && inputRow.media_type === inputArtifact.mediaType;
    const storage = getStorage();
    const stored = storage.sha256 ? await storage.sha256(inputArtifact.objectKey).catch(() => null) : null;
    if (!inputRowMatches || !stored || stored.size !== inputArtifact.byteLength || stored.contentSha256 !== inputArtifact.contentSha256) {
      await new CommercialExecutionOutboxStore(getDbAdapter()).hold(transportJob.jobId, 'immutable_input_readback_failed');
      return NextResponse.json({ ok: false, code: 'IMMUTABLE_INPUT_READBACK_FAILED', status: 'HOLD', releaseReady: false }, { status: 409 });
    }
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1') {
      // Receipt identity is server-owned. Resolve the immutable PG binding by
      // the authenticated job identity; never trust fields copied into JSON.
      const binding = await getDbAdapter().queryOne<Record<string, unknown>>(
        'SELECT r.workspace_id, r.workspace_revision, r.head_revision, r.head_sha256, v.generation_program_sha256 FROM nf_commercial_generation_runs r JOIN nf_commercial_generation_revisions v ON v.tenant_id = r.tenant_id AND v.project_id = r.project_id AND v.run_id = r.run_id AND v.revision = r.head_revision WHERE r.tenant_id = ? AND r.project_id = ? AND r.run_id = ? AND r.status = ?',
        result.row.job.tenantId, result.row.job.projectId, result.row.job.generationRunId, 'ACTIVE',
      );
      if (!binding || binding.workspace_id !== result.row.job.workspaceId || Number(binding.workspace_revision) !== result.row.job.workspaceRevision || binding.head_sha256 !== result.row.job.workspaceContentHash || Number(binding.head_revision) !== result.row.job.generationStateRevision || binding.generation_program_sha256 !== result.row.job.generationProgramSha256 || result.row.job.generationProgramSha256 === '0'.repeat(64)) {
        await new CommercialExecutionOutboxStore(getDbAdapter()).hold(transportJob.jobId, 'verified_generation_binding_required');
        return NextResponse.json({ ok: false, code: 'VERIFIED_GENERATION_BINDING_REQUIRED', status: 'HOLD', releaseReady: false }, { status: 409 });
      }
    }
    const origin = new URL(req.url).origin;
    const artifactGatewayUrl = `${origin}/api/internal/precision-cad-commercial/artifacts`;
    const unsigned: Omit<CommercialTransportEnvelope, 'transportHmac'> = { schema: 'nexyfab.precision-cad-commercial-execution.v3', job: transportJob, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 120_000).toISOString(), callbackUrl, inputDownloadUrl: `${artifactGatewayUrl}?jobId=${encodeURIComponent(transportJob.jobId)}&artifactId=${encodeURIComponent(inputArtifact.artifactId)}`, artifactGatewayUrl, leaseCapability: result.row.capability };
    const transport: CommercialTransportEnvelope = { ...unsigned, transportHmac: await hmacCommercialTransport(transportSecret, unsigned) };
    const transportIssues = validateCommercialTransport(transport);
    if (transportIssues.length) {
      await new CommercialExecutionOutboxStore(getDbAdapter()).hold(transportJob.jobId, `transport_invalid:${transportIssues.join(',')}`);
      return NextResponse.json({ ok: false, code: 'TRANSPORT_INVALID', issues: transportIssues, status: 'HOLD', releaseReady: false }, { status: 409 });
    }
    return NextResponse.json({ ok: true, transport, releaseReady: false }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return NextResponse.json({ ok: false, code: String(error).includes('migration_required') ? 'MIGRATION_REQUIRED' : 'CLAIM_FAILED', releaseReady: false }, { status: 503 }); }
}
