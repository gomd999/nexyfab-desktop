import { randomUUID, timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';
import { getDbAdapter } from '@/lib/db-adapter';
import { createDbExternalCommercialVerificationRequestStore, externalVerificationRequestSha } from '@/lib/ai/externalCommercialVerificationRequest';
import { loadExternalCommercialVerifierRegistry } from '@/lib/ai/externalCommercialVerifierRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function authorized(request: NextRequest): boolean { const configured = process.env.NEXYFAB_EXTERNAL_VERIFIER_INTERNAL_SECRET; const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''; if (!configured || !supplied) return false; const a = Buffer.from(configured); const b = Buffer.from(supplied); return a.length === b.length && timingSafeEqual(a, b); }
type Body = { requestId?: unknown };
export async function POST(request: NextRequest) {
  try {
    if (!authorized(request)) return NextResponse.json({ ok: false, status: 'HOLD', code: 'INTERNAL_VERIFIER_UNAUTHORIZED' }, { status: 403 });
    const body = await readBoundedJson<Body>(request, 32 * 1024); if (typeof body.requestId !== 'string') return NextResponse.json({ ok: false, status: 'HOLD', code: 'REQUEST_ID_REQUIRED' }, { status: 400 });
    const registry = loadExternalCommercialVerifierRegistry(); if (!registry) return NextResponse.json({ ok: false, status: 'HOLD', code: 'EXTERNAL_VERIFIER_REGISTRY_NOT_CONFIGURED' }, { status: 503 });
    const verifier = registry.identities[0]; const db = getDbAdapter(); const store = createDbExternalCommercialVerificationRequestStore(db); const requestValue = await store.get(body.requestId); if (!requestValue) return NextResponse.json({ ok: false, status: 'HOLD', code: 'REQUEST_NOT_FOUND' }, { status: 404 });
    const now = Date.now(); if (requestValue.status !== 'PENDING' || Date.parse(requestValue.expiresAt) <= now) return NextResponse.json({ ok: false, status: 'HOLD', code: 'REQUEST_NOT_CLAIMABLE' }, { status: 409 });
    const leaseId = randomUUID(); const claimed = await store.claim(requestValue.requestId, verifier.keyId, verifier.fingerprintSha256, leaseId, now, now + 5 * 60 * 1000); if (!claimed) return NextResponse.json({ ok: false, status: 'PENDING', code: 'REQUEST_ALREADY_CLAIMED' }, { status: 409 });
    return NextResponse.json({ ok: true, status: 'CLAIMED', request: { requestId: requestValue.requestId, requestSha256: externalVerificationRequestSha(requestValue), claimLeaseId: leaseId, tenantId: requestValue.tenantId, projectId: requestValue.projectId, executionId: requestValue.executionId, generationRunId: requestValue.generationRunId, revision: requestValue.revision, modelContentHash: requestValue.modelContentHash, targetSha256: requestValue.targetSha256, evidence: requestValue.evidence, evidenceManifestSha256: requestValue.evidenceManifestSha256, sequence: requestValue.sequence, issuedAt: requestValue.issuedAt, expiresAt: requestValue.expiresAt }, verifier: { keyId: verifier.keyId, fingerprintSha256: verifier.fingerprintSha256 } }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { const bounded = boundedJsonError(error); return NextResponse.json({ ok: false, status: 'HOLD', code: bounded?.code ?? 'CLAIM_FAILED' }, { status: bounded?.status ?? 400 }); }
}
