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
import { getTrustedClientIp } from '@/lib/client-ip';
import { getDbAdapter } from '@/lib/db-adapter';
import { rateLimit } from '@/lib/rate-limit';
import {
  ensurePortfolioViewTable,
  recordPortfolioView,
} from '@/lib/partner-portfolio-views';

import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_PORTFOLIO_VIEW_BODY_BYTES = 16 * 1024;

const COOLDOWN_MS = 30 * 60 * 1000;
const PORTFOLIO_VIEW_RATE_LIMIT = 60;
const PORTFOLIO_VIEW_RATE_WINDOW_MS = 60_000;
const MAX_SOURCE_LEN = 64;

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const trustedIp = getTrustedClientIp(req.headers);
  const rate = rateLimit(
    `partner-portfolio-view:${trustedIp}`,
    PORTFOLIO_VIEW_RATE_LIMIT,
    PORTFOLIO_VIEW_RATE_WINDOW_MS,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: 'Too many portfolio view requests' },
      { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) } },
    );
  }

  let body: { partnerEmail?: string; source?: string } | null = null;
  try { body = await readBoundedJson(req, MAX_PORTFOLIO_VIEW_BODY_BYTES); }
  catch (error) { if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 }); }
  const partnerEmail = body?.partnerEmail?.trim().toLowerCase();
  if (!partnerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail)) {
    return NextResponse.json({ error: 'Invalid partnerEmail' }, { status: 400 });
  }

  const db = getDbAdapter();
  // Only count views for a real factory/partner identity. This prevents the
  // public endpoint from being used to manufacture metrics for arbitrary
  // email addresses.
  let partner = await db.queryOne<{ id: string }>(
    `SELECT u.id
       FROM nf_users u
       JOIN nf_user_roles r ON r.user_id = u.id
      WHERE LOWER(TRIM(u.email)) = ?
        AND r.product = 'nexyfab'
        AND r.role = 'partner'
      LIMIT 1`,
    partnerEmail,
  ).catch(() => null);
  // SQLite/local deployments may also expose unclaimed directory factories.
  // PostgreSQL intentionally has no nf_factories base table, so this remains
  // a best-effort compatibility fallback after the portable role lookup.
  if (!partner) {
    partner = await db.queryOne<{ id: string }>(
      `SELECT id FROM nf_factories
        WHERE LOWER(TRIM(partner_email)) = ?
           OR LOWER(TRIM(contact_email)) = ?
        LIMIT 1`,
      partnerEmail,
      partnerEmail,
    ).catch(() => null);
  }
  if (!partner) {
    return NextResponse.json({ ok: false, error: 'Unknown partner' }, { status: 404 });
  }

  await ensurePortfolioViewTable();

  // Identify the viewer for cooldown — auth user id wins, else hashed
  // (IP + UA) so anonymous traffic isn't double-counted.
  const authUser = await getAuthUser(req).catch(() => null);
  const ip = trustedIp === 'unknown' ? '' : trustedIp;
  const ua = req.headers.get('user-agent') ?? '';
  const ipHash = ip
    ? createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)
    : null;

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
    source: typeof body?.source === 'string' ? body.source.trim().slice(0, MAX_SOURCE_LEN) : undefined,
  });

  return NextResponse.json({ ok: true });
}
