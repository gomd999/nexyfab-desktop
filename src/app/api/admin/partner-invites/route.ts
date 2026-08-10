/**
 * Q6 — Admin: create partner invite (magic link).
 *
 * POST /api/admin/partner-invites
 *   body: { factoryId?, prefillEmail?, prefillName?, prefillCompany?, prefillPhone?, prefillBizRegNo?, rfqContextId? }
 *   → 201 { invite: { id, token, url, expiresAt } }
 *
 * The returned URL is the magic link the operator pastes into KakaoTalk
 * or email. Tokens are single-use, expire in 7 days.
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, randomBytes } from 'crypto';
import { getAuthUser } from '@/lib/auth-middleware';
import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import { hashPartnerInviteToken } from '@/lib/partner-invite-token';
import { checkOrigin } from '@/lib/csrf';
import { getTrustedClientIp } from '@/lib/client-ip';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

let tableEnsured = false;
async function ensureTable(db: ReturnType<typeof getDbAdapter>): Promise<void> {
  if (tableEnsured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_partner_invites (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      factory_id TEXT,
      prefill_email TEXT,
      prefill_name TEXT,
      prefill_company TEXT,
      prefill_phone TEXT,
      prefill_biz_reg_no TEXT,
      rfq_context_id TEXT,
      created_by TEXT,
      created_at BIGINT NOT NULL,
      expires_at BIGINT NOT NULL,
      accepted_at BIGINT,
      accepted_by_email TEXT,
      accepted_by_ip TEXT,
      final_biz_reg_no TEXT,
      final_phone TEXT,
      final_company TEXT,
      resulting_user_id TEXT
    )
  `).catch(() => {});
  await db.execute('CREATE INDEX IF NOT EXISTS idx_partner_invites_token ON nf_partner_invites(token)').catch(() => {});
  tableEnsured = true;
}

export async function POST(req: NextRequest) {
  if (!checkOrigin(req)) return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 });
  const auth = await getAuthUser(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = await verifyAdmin(req).catch(() => false);
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });
  const limit = await rateLimitAsync(
    `admin-partner-invite:${auth.userId}:${getTrustedClientIp(req.headers)}`, 30, 60 * 60 * 1000,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many invites' },
      { status: 429, headers: rateLimitHeaders(limit, 30) },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const db = getDbAdapter();
  await ensureTable(db);

  const id = `pinv_${randomUUID()}`;
  const token = randomBytes(24).toString('base64url');
  const storedToken = hashPartnerInviteToken(token);
  const now = Date.now();
  const expiresAt = now + INVITE_TTL_MS;

  const factoryId = typeof body.factoryId === 'string' ? body.factoryId.trim().slice(0, 160) : null;
  const prefillEmail = typeof body.prefillEmail === 'string' ? body.prefillEmail.trim().toLowerCase() : null;
  const prefillName = typeof body.prefillName === 'string' ? body.prefillName.trim().slice(0, 80) : null;
  const prefillCompany = typeof body.prefillCompany === 'string' ? body.prefillCompany.trim().slice(0, 120) : null;
  const prefillPhone = typeof body.prefillPhone === 'string' ? body.prefillPhone.replace(/[^\d-]/g, '').slice(0, 20) : null;
  const prefillBizRegNo = typeof body.prefillBizRegNo === 'string' ? body.prefillBizRegNo.replace(/[^\d-]/g, '').slice(0, 13) : null;
  const rfqContextId = typeof body.rfqContextId === 'string' ? body.rfqContextId.trim().slice(0, 160) : null;

  await db.execute(
    `INSERT INTO nf_partner_invites
       (id, token, factory_id, prefill_email, prefill_name, prefill_company,
        prefill_phone, prefill_biz_reg_no, rfq_context_id, created_by,
        created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, storedToken, factoryId, prefillEmail, prefillName, prefillCompany,
    prefillPhone, prefillBizRegNo, rfqContextId, auth.userId, now, expiresAt,
  );

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://nexyfab.com';
  const url = `${baseUrl}/partner/onboard?invite=${encodeURIComponent(token)}`;

  return NextResponse.json({
    ok: true,
    invite: { id, token, url, expiresAt },
  }, { status: 201 });
}
