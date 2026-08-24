import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getDbAdapter } from '@/lib/db-adapter';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { getStorage } from '@/lib/storage';
import { getAgenticCommercialReceipt } from '@/lib/ai/agenticCommercialReceiptStore';
import { createDbExternalCommercialEvidenceStore } from '@/lib/ai/externalCommercialEvidenceStore';
import { createDbExternalCommercialVerificationRequestStore, createExternalVerificationRequest, externalVerificationRequestSha } from '@/lib/ai/externalCommercialVerificationRequest';
import { decodeAgenticCommercialReceiptEnvelope } from '@/lib/ai/agenticCommercialReceiptCodec';
import { createDbCommercialGenerationStateStore } from '@/lib/ai/commercialGenerationStateStore';
import { commercialPostgresMigrationAtLeast } from '@/lib/commercial-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Body = { receiptId?: unknown; projectId?: unknown; revision?: unknown; modelContentHash?: unknown; evidenceIds?: unknown; registry?: unknown; verifierUrl?: unknown; rawEvidence?: unknown; clock?: unknown; mode?: unknown };
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export async function POST(request: NextRequest) {
  try {
    const body = await readBoundedJson<Body>(request, 256 * 1024);
    if (body.registry !== undefined || body.verifierUrl !== undefined || body.rawEvidence !== undefined || body.clock !== undefined || body.mode !== undefined) return NextResponse.json({ ok: false, status: 'HOLD', code: 'PUBLIC_VERIFIER_INPUT_REJECTED' }, { status: 400 });
    if (typeof body.receiptId !== 'string' || typeof body.projectId !== 'string' || !ID.test(body.receiptId) || !ID.test(body.projectId) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0 || typeof body.modelContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.modelContentHash) || !Array.isArray(body.evidenceIds) || body.evidenceIds.length !== 6 || body.evidenceIds.some(id => typeof id !== 'string' || !ID.test(id))) return NextResponse.json({ ok: false, status: 'HOLD', code: 'STORED_BINDING_AND_EVIDENCE_IDS_REQUIRED' }, { status: 400 });
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({ ok: false, status: 'HOLD', code: 'UNAUTHORIZED' }, { status: 401 });
    if (process.env.NEXYFAB_COMMERCIAL_MODE === '1' && !commercialPostgresMigrationAtLeast(process.env, 2026082208)) return NextResponse.json({ ok: false, status: 'HOLD', code: 'COMMERCIAL_GENERATION_MIGRATION_REQUIRED' }, { status: 503 });
    const db = getDbAdapter(); const access = await resolveProjectAccess(db, body.projectId, auth); if (!access || !access.canEdit) return NextResponse.json({ ok: false, status: 'HOLD', code: 'PROJECT_EDITOR_REQUIRED' }, { status: 403 });
    const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId);
    const receipt = await getAgenticCommercialReceipt(db, getStorage(), tenantId, body.projectId, body.receiptId);
    if (!receipt) return NextResponse.json({ ok: false, status: 'HOLD', code: 'SOURCE_RECEIPT_NOT_FOUND' }, { status: 404 });
    let decoded: ReturnType<typeof decodeAgenticCommercialReceiptEnvelope>;
    try { decoded = decodeAgenticCommercialReceiptEnvelope(receipt.receiptBytes); if (decoded.kind !== 'candidate') throw new Error('not_candidate'); } catch { return NextResponse.json({ ok: false, status: 'HOLD', code: 'CANDIDATE_ENVELOPE_REQUIRED' }, { status: 409 }); }
    const project = decoded.payload.project as Record<string, unknown> | undefined;
    if (decoded.payload.executionId !== receipt.executionId || decoded.payload.generationRunId !== receipt.generationRunId || decoded.payload.targetSha256 !== receipt.targetSha256 || project?.projectId !== body.projectId || !Number.isSafeInteger(project.revision) || typeof project.modelContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(project.modelContentHash) || project.revision !== body.revision || project.modelContentHash !== body.modelContentHash) return NextResponse.json({ ok: false, status: 'HOLD', code: 'CANDIDATE_ENVELOPE_BINDING_INVALID' }, { status: 409 });
    const generation = await db.queryOne<Record<string, unknown>>('SELECT r.workspace_id, r.workspace_revision, r.head_revision, v.generation_program_sha256 FROM nf_commercial_generation_runs r JOIN nf_commercial_generation_revisions v ON v.tenant_id = r.tenant_id AND v.project_id = r.project_id AND v.run_id = r.run_id AND v.revision = r.head_revision WHERE r.tenant_id = ? AND r.project_id = ? AND r.run_id = ?', tenantId, body.projectId, receipt.generationRunId);
    if (!generation || generation.workspace_id !== project.workspaceId || Number(generation.workspace_revision) !== project.revision || Number(generation.head_revision) !== decoded.payload.generationStateRevision || generation.generation_program_sha256 !== decoded.payload.generationProgramSha256) return NextResponse.json({ ok: false, status: 'HOLD', code: 'GENERATION_2207_BINDING_INVALID' }, { status: 409 });
    const requestValue = await createExternalVerificationRequest({ requestId: `external-${body.receiptId}`, tenantId, projectId: body.projectId, executionId: receipt.executionId, generationRunId: receipt.generationRunId, revision: project.revision as number, modelContentHash: project.modelContentHash, targetSha256: receipt.targetSha256, issuedAt: receipt.issuedAt, expiresAt: receipt.expiresAt, evidenceIds: body.evidenceIds, store: createDbExternalCommercialEvidenceStore(db, getStorage()) });
    if (requestValue.evidence.find(item => item.role === 'common_receipt')?.sha256 !== receipt.receiptSha256) return NextResponse.json({ ok: false, status: 'HOLD', code: 'COMMON_RECEIPT_EVIDENCE_BINDING_INVALID' }, { status: 409 });
    const receiptBinding = await createDbCommercialGenerationStateStore(db).bindReceipt({ tenantId, projectId: body.projectId, runId: receipt.generationRunId, receiptId: body.receiptId, receiptSha256: receipt.receiptSha256, generationRevision: Number(generation.head_revision), workspaceRevision: project.revision as number, generationProgramSha256: typeof decoded.payload.generationProgramSha256 === 'string' ? decoded.payload.generationProgramSha256 : '', targetSha256: receipt.targetSha256, status: 'PENDING' });
    if (!receiptBinding.ok && receiptBinding.code !== 'RECEIPT_BINDING_CONFLICT') return NextResponse.json({ ok: false, status: 'HOLD', code: receiptBinding.code }, { status: 409 });
    const saved = await createDbExternalCommercialVerificationRequestStore(db).put(requestValue); if (!saved.ok) return NextResponse.json({ ok: false, status: 'HOLD', code: saved.code }, { status: 409 });
    return NextResponse.json({ ok: true, status: requestValue.status, releaseReady: false, request: { requestId: requestValue.requestId, requestSha256: externalVerificationRequestSha(requestValue), evidenceManifestSha256: requestValue.evidenceManifestSha256, expiresAt: requestValue.expiresAt } }, { status: 202, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { const bounded = boundedJsonError(error); return NextResponse.json({ ok: false, status: 'HOLD', code: bounded?.code ?? 'EXTERNAL_REQUEST_INVALID' }, { status: bounded?.status ?? 400 }); }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({ ok: false, status: 'HOLD', code: 'UNAUTHORIZED' }, { status: 401 });
    const projectId = request.nextUrl.searchParams.get('projectId') ?? ''; const requestId = request.nextUrl.searchParams.get('requestId') ?? '';
    const db = getDbAdapter(); const access = await resolveProjectAccess(db, projectId, auth); if (!access) return NextResponse.json({ ok: false, status: 'HOLD', code: 'REQUEST_NOT_FOUND' }, { status: 404 });
    const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId); const stored = await createDbExternalCommercialVerificationRequestStore(db).get(requestId, tenantId, projectId);
    if (!stored) return NextResponse.json({ ok: false, status: 'HOLD', code: 'REQUEST_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ ok: true, status: stored.status, releaseReady: false, request: { requestId: stored.requestId, executionId: stored.executionId, generationRunId: stored.generationRunId, evidenceManifestSha256: stored.evidenceManifestSha256, sequence: stored.sequence, issuedAt: stored.issuedAt, expiresAt: stored.expiresAt } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ ok: false, status: 'HOLD', code: 'REQUEST_LOOKUP_FAILED' }, { status: 400 }); }
}
