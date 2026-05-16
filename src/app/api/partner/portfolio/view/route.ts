/**
 * POST /api/partner/portfolio/view
 *
 * Fire-and-forget portfolio-view event. Called by the customer-side
 * marketplace / partner-profile pages whenever a buyer opens a partner's
 * public page. The corresponding count is surfaced on the partner Hub
 * (cardPortfolioViews).
 *
 * Body:
 *   { partnerEmail: string; source?: string }
 *
 * Auth is optional — public views are valid signal. The viewer's
 * authenticated user id is captured when present so we can later add
 * "X teams viewed your portfolio this week" features.
 *
 * Spam protection
 *   • A per-(viewer, partner) cooldown of 30 minutes is applied so
 *     refresh loops don't inflate the count. For anonymous viewers we
 *     hash the IP+UA pair as the dedupe key.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter } from '@/lib/db-adapter';
import {
  ensurePortfolioViewTable,
  recordPortfolioView,
} from '@/lib/partner-portfolio-views';

const COOLDOWN_MS = 30 * 60 * 1000;

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as
    | { partnerEmail?: string; source?: string }
    | null;
  const partnerEmail = body?.partnerEmail?.trim().toLowerCase();
  if (!partnerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail)) {
    return NextResponse.json({ error: 'Invalid partnerEmail' }, { status: 400 });
  }

  await ensurePortfolioViewTable();

  // Identify the viewer for cooldown — auth user id wins, else hashed
  // (IP + UA) so anonymous traffic isn't double-counted.
  const authUser = await getAuthUser(req).catch(() => null);
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('cf-connecting-ip') ||
    '';
  const ua = req.headers.get('user-agent') ?? '';
  const ipHash = ip
    ? createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)
    : null;

  const db = getDbAdapter();
  const since = Date.now() - COOLDOWN_MS;

  // Cooldown check — skip the insert if this viewer already counted.
  const dupe = await db.queryOne<{ n: number }>(
    `SELECT COUNT(*) as n FROM nf_partner_portfolio_views
       WHERE partner_email = ?
         AND viewed_at >= ?
         AND (
           (viewer_user_id IS NOT NULL AND viewer_user_id = ?)
           OR (viewer_ip_hash IS NOT NULL AND viewer_ip_hash = ?)
         )`,
    partnerEmail,
    since,
    authUser?.userId ?? '',
    ipHash ?? '',
  ).catch(() => null);

  if ((dupe?.n ?? 0) > 0) {
    return NextResponse.json({ ok: true, deduped: true });
  }

  await recordPortfolioView({
    partnerEmail,
    viewerUserId: authUser?.userId ?? null,
    viewerIpHash: ipHash,
    source: body?.source,
  });

  return NextResponse.json({ ok: true });
}
