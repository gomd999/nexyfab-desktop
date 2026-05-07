/**
 * Optional authenticated CAD audit ping — same sink as telemetry-driven `cad.*` actions.
 *
 * When to use which:
 * - **Telemetry POST** (`/api/nexyfab/telemetry`): default for browser-buffered errors/warnings/info
 *   including drawing/mesh/CAM export signals (also mirrored to `cad.*` for Pro+).
 * - **This route**: explicit one-off audit rows from trusted callers (e.g. admin tools,
 *   server actions) without batching; same `CadAuditAction` names as enterprise CAD audit.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getTrustedClientIpOrUndefined } from '@/lib/client-ip';
import { CadAuditAction, logCadPipelineAudit } from '@/lib/enterprise-cad-audit';

const ALLOWED_ACTIONS = new Set<string>(Object.values(CadAuditAction));

export async function POST(req: NextRequest) {
  try {
    const authUser = await getAuthUser(req).catch(() => null);
    if (!authUser) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const raw = (await req.json().catch(() => null)) as {
      action?: string;
      resourceId?: string;
      metadata?: Record<string, unknown>;
    } | null;
    const body = raw ?? {};
    const action = typeof body.action === 'string' ? body.action.trim() : '';
    if (!action || !ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ ok: false, error: 'Invalid action' }, { status: 400 });
    }
    const ip = getTrustedClientIpOrUndefined(req.headers);
    logCadPipelineAudit({
      userId: authUser.userId,
      plan: authUser.plan,
      action,
      resourceId: typeof body.resourceId === 'string' ? body.resourceId.slice(0, 128) : undefined,
      metadata: body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
        ? body.metadata
        : undefined,
      ip,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
