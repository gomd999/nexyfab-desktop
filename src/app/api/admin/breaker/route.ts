/**
 * GET    /api/admin/breaker          — current breaker + provider health
 * POST   /api/admin/breaker          — super_admin: trip manual breaker
 *   body: { reason: string, untilMs?: number }
 * DELETE /api/admin/breaker?scope=…  — super_admin: clear a scope
 *
 * The cron auto-trips hourly/daily on cost overruns; this endpoint is for
 * the operator to (a) manually break (e.g. during incident response),
 * (b) inspect current state, (c) clear a stuck breaker after fixing the
 * underlying issue.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin, verifySuperAdmin } from '@/lib/admin-auth';
import { getActiveBreaker, tripBreaker, clearBreaker, type BreakerScope } from '@/lib/cost-breaker';
import { getProviderHealth, resetProviderHealth } from '@/lib/provider-health';
import { recordAdminAudit } from '@/lib/admin-audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SCOPES = new Set<BreakerScope>(['hourly', 'daily', 'manual']);

export async function GET(req: NextRequest) {
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const breaker = await getActiveBreaker();
  const providerHealth = getProviderHealth();

  return NextResponse.json({
    ok: true,
    breaker: breaker ? {
      scope: breaker.scope,
      untilMs: breaker.untilMs,
      remainingMs: Math.max(0, breaker.untilMs - Date.now()),
      reason: breaker.reason,
    } : null,
    providers: providerHealth,
  });
}

export async function POST(req: NextRequest) {
  const superAdmin = await verifySuperAdmin(req);
  if (!superAdmin) {
    return NextResponse.json({ error: 'Forbidden — super_admin required' }, { status: 403 });
  }
  let body: { reason?: unknown; untilMs?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : '운영자 수동 차단';
  const untilMs = typeof body.untilMs === 'number' && body.untilMs > Date.now()
    ? body.untilMs
    : undefined;

  const result = await tripBreaker('manual', reason, superAdmin.userId, untilMs);

  await recordAdminAudit(req, {
    adminUserId: superAdmin.userId,
    action: 'breaker.trip',
    target: 'manual',
    metadata: { reason, untilMs: result.untilMs },
  });

  return NextResponse.json({ ok: true, scope: 'manual', untilMs: result.untilMs });
}

export async function DELETE(req: NextRequest) {
  const superAdmin = await verifySuperAdmin(req);
  if (!superAdmin) {
    return NextResponse.json({ error: 'Forbidden — super_admin required' }, { status: 403 });
  }
  const url = new URL(req.url);
  const scope = url.searchParams.get('scope') as BreakerScope | null;
  const resetHealthParam = url.searchParams.get('resetHealth');

  if (scope) {
    if (!VALID_SCOPES.has(scope)) {
      return NextResponse.json({
        error: `scope must be one of: ${Array.from(VALID_SCOPES).join(', ')}`,
      }, { status: 400 });
    }
    await clearBreaker(scope);
    await recordAdminAudit(req, {
      adminUserId: superAdmin.userId,
      action: 'breaker.clear',
      target: scope,
      metadata: {},
    });
  }

  // Optional: also reset provider health tracker (clears the in-memory
  // degraded state so the chain re-tries skipped providers immediately).
  if (resetHealthParam === '1' || resetHealthParam === 'true') {
    resetProviderHealth(url.searchParams.get('provider') ?? undefined);
    await recordAdminAudit(req, {
      adminUserId: superAdmin.userId,
      action: 'provider_health.reset',
      target: url.searchParams.get('provider') ?? 'all',
      metadata: {},
    });
  }

  return NextResponse.json({ ok: true });
}
