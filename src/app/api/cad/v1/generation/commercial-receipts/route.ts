import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter } from '@/lib/db-adapter';
import { createDbVerifiedAgenticCommercialReceiptStore } from '@/lib/ai/verifiedAgenticCommercialReceiptStore';
import { loadVerifiedAgenticCommercialReceiptForGeneration } from '@/lib/ai/loadVerifiedAgenticCommercialReceiptForGeneration';
import { loadServerAgenticCommercialTrust } from '@/lib/ai/serverAgenticCommercialTrust';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getAuthUser } from '@/lib/auth-middleware';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { resolveArtifactTenantId } from '@/lib/artifacts/directArtifactUploadStore';
import { getStorage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Body = { receiptId?: string; projectId?: string; evidenceIds?: string[]; registry?: unknown; clock?: unknown; mode?: unknown };

export async function POST(request: NextRequest) {
  try {
    const body = await readBoundedJson<Body>(request, 256 * 1024);
    if (body.registry !== undefined || body.clock !== undefined || body.mode !== undefined) return NextResponse.json({ ok: false, status: 'HOLD', code: 'CALLER_TRUST_CLOCK_MODE_REJECTED' }, { status: 400 });
    if (!body.receiptId || !body.projectId || !Array.isArray(body.evidenceIds) || body.evidenceIds.length === 0) return NextResponse.json({ ok: false, status: 'HOLD', code: 'STORED_EVIDENCE_IDS_REQUIRED' }, { status: 400 });
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({ ok: false, status: 'HOLD', code: 'UNAUTHORIZED' }, { status: 401 });
    const db = getDbAdapter(); const access = await resolveProjectAccess(db, body.projectId, auth);
    if (!access || !access.canEdit) return NextResponse.json({ ok: false, status: 'HOLD', code: 'PROJECT_EDITOR_REQUIRED' }, { status: 403 });
    // The server must load evidence IDs and construct/verify the signed receipt.
    // Until that authoritative evidence loader is configured, never synthesize PASS.
    return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, code: 'EXTERNAL_VERIFIER_RECEIPT_NOT_AVAILABLE', receiptId: body.receiptId }, { status: 409 });
  } catch (error) { const bounded = boundedJsonError(error); return NextResponse.json({ ok: false, status: 'HOLD', code: bounded?.code ?? 'RECEIPT_REQUEST_INVALID' }, { status: bounded?.status ?? 400 }); }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request); if (!auth) return NextResponse.json({ ok: false, status: 'HOLD', code: 'UNAUTHORIZED' }, { status: 401 });
    const projectId = request.nextUrl.searchParams.get('projectId') ?? '';
    const receiptId = request.nextUrl.searchParams.get('receiptId') ?? '';
    const db = getDbAdapter(); const access = await resolveProjectAccess(db, projectId, auth);
    if (!access) return NextResponse.json({ ok: false, status: 'HOLD', code: 'RECEIPT_NOT_FOUND' }, { status: 404 });
    const tenantId = resolveArtifactTenantId(access.row.org_id, access.ownerUserId);
    const trust = loadServerAgenticCommercialTrust(); if (!trust.ok) return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, code: 'SERVER_TRUST_NOT_CONFIGURED' }, { status: 503 });
    const stored = await createDbVerifiedAgenticCommercialReceiptStore(db, getStorage()).get(tenantId, projectId, receiptId);
    if (!stored) return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, code: 'VERIFIED_FINAL_RECEIPT_NOT_FOUND' }, { status: 404 });
    const generationBinding = await db.queryOne<{ generation_revision: number; generation_program_sha256: string; receipt_sha256: string }>('SELECT generation_revision, generation_program_sha256, receipt_sha256 FROM nf_commercial_generation_receipt_bindings WHERE tenant_id = ? AND project_id = ? AND run_id = ? AND receipt_id = ? AND workspace_revision = ? AND target_sha256 = ? AND status = ?', tenantId, projectId, stored.generationRunId, receiptId, stored.revision, stored.targetSha256, 'VERIFIED');
    if (!generationBinding || generationBinding.receipt_sha256 !== stored.finalEnvelopeSha256) return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, code: 'VERIFIED_GENERATION_BINDING_REQUIRED' }, { status: 409 });
    const verification = await loadVerifiedAgenticCommercialReceiptForGeneration(createDbVerifiedAgenticCommercialReceiptStore(db, getStorage()), { tenantId, projectId, receiptId, executionId: stored.executionId, generationRunId: stored.generationRunId, generationStateRevision: Number(generationBinding.generation_revision), generationProgramSha256: generationBinding.generation_program_sha256, revision: stored.revision, modelContentHash: stored.modelContentHash, targetSha256: stored.targetSha256 }, trust.context);
    if (!verification.ok) return NextResponse.json({ ok: false, status: 'HOLD', releaseReady: false, code: 'VERIFIED_FINAL_RECEIPT_RUNTIME_RECHECK_FAILED', issues: verification.issues }, { status: 409 });
    return NextResponse.json({ ok: true, status: verification.status, releaseReady: verification.releaseReady, receipt: { receiptId: stored.receiptId, projectId: stored.projectId, executionId: stored.executionId, generationRunId: stored.generationRunId, targetSha256: stored.targetSha256, receiptSha256: verification.finalEnvelopeSha256, issuedAt: stored.issuedAt, expiresAt: stored.expiresAt } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ ok: false, status: 'HOLD', code: 'RECEIPT_LOOKUP_FAILED' }, { status: 400 }); }
}
