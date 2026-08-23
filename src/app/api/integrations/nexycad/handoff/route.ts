import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { readBoundedJson, boundedJsonError } from '@/lib/boundedJsonBody';
import { checkOrigin } from '@/lib/csrf';
import { getDbAdapter } from '@/lib/db-adapter';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { logAudit } from '@/lib/audit';
import { resolveRequestOrgContext } from '@/lib/org-context';
import { resolveProjectAccess } from '@/lib/nfProjectAccess';
import { buildNexyCadLaunchUrl, loadNexyCadHandoffPrivateKey, signNexyCadProjectHandoff, type NexyCadProjectRole } from '@/lib/nexycad-handoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fail(status: number, code: string): NextResponse {
  return NextResponse.json({ ok: false, code }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!checkOrigin(request)) return fail(403, 'ORIGIN_REJECTED');
  const auth = await getAuthUser(request);
  if (!auth) return fail(401, 'AUTHENTICATION_REQUIRED');
  if (auth.apiKey) return fail(403, 'INTERACTIVE_SESSION_REQUIRED');
  if (!auth.emailVerified) return fail(403, 'VERIFIED_EMAIL_REQUIRED');
  const context = resolveRequestOrgContext(auth);
  if (!context.ok) return fail(409, context.code);

  let body: unknown;
  try {
    body = await readBoundedJson<unknown>(request, 2048);
  } catch (error) {
    const bounded = boundedJsonError(error);
    return fail(bounded?.status ?? 400, bounded?.code ?? 'BAD_REQUEST');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'BAD_REQUEST');
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some(name => name !== 'projectId') || typeof fields.projectId !== 'string' || fields.projectId.length < 1 || fields.projectId.length > 256 || fields.projectId.trim() !== fields.projectId) {
    return fail(400, 'BAD_REQUEST');
  }
  const projectId = fields.projectId;
  const access = await resolveProjectAccess(getDbAdapter(), projectId, auth);
  if (!access) return fail(404, 'PROJECT_NOT_FOUND');

  try {
    const privateKeyBase64 = process.env.NEXYCAD_HANDOFF_PRIVATE_KEY_PEM_BASE64?.trim() ?? '';
    const keyId = process.env.NEXYCAD_HANDOFF_KEY_ID?.trim() ?? '';
    const studioUrl = process.env.NEXYCAD_STUDIO_URL?.trim() ?? '';
    if (!privateKeyBase64 || !keyId || !studioUrl) return fail(503, 'NEXYCAD_HANDOFF_NOT_CONFIGURED');
    const role: NexyCadProjectRole = access.role === 'owner' ? 'OWNER' : access.role === 'editor' ? 'EDITOR' : 'VIEWER';
    const issued = signNexyCadProjectHandoff({
      issuer: process.env.NEXYCAD_HANDOFF_ISSUER?.trim() || 'https://nexyfab.com',
      audience: process.env.NEXYCAD_HANDOFF_AUDIENCE?.trim() || 'nexycad-commercial',
      subject: auth.userId,
      organizationId: context.orgId,
      projectId,
      projectRole: role,
      keyId,
      privateKey: loadNexyCadHandoffPrivateKey(privateKeyBase64),
    });
    const launchUrl = buildNexyCadLaunchUrl(studioUrl, issued.token);
    logAudit({
      userId: auth.userId,
      action: 'nexycad.handoff.issue',
      resourceId: projectId,
      ip: getTrustedClientIpOrUndefined(request.headers),
      metadata: { organizationId: context.orgId ?? 'personal', projectRole: role, expiresAt: issued.expiresAt },
    });
    return NextResponse.json({
      ok: true,
      launchUrl,
      expiresAt: issued.expiresAt,
      project: { id: projectId, role },
      consentRequired: true,
    }, { status: 201, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } });
  } catch (error) {
    console.error('[nexycad-handoff] issuance failed:', error instanceof Error ? error.message : String(error));
    return fail(503, 'NEXYCAD_HANDOFF_UNAVAILABLE');
  }
}
