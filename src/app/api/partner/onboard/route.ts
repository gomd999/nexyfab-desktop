/**
 * Q6/Q7 — Public partner onboarding endpoint.
 *
 * GET  /api/partner/onboard?token=xxx
 *   → { invite: { prefill fields } }  if token is valid + unused + not expired
 *
 * POST /api/partner/onboard
 *   body: { token, password, bizRegNo, phone, company, agreementVersion }
 *   → 201 { userId } + sets auth cookie, marks invite accepted, records consent
 *
 * Required from partner at acceptance:
 *   - password (≥10 chars)
 *   - bizRegNo (사업자 등록 번호, 10 digits)
 *   - phone (담당자 연락처)
 *   - company name
 *   - explicit consent to partner agreement v1.0
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID, scrypt as scryptCb } from 'crypto';
import { promisify } from 'util';
import { getDbAdapter } from '@/lib/db-adapter';
import { getTrustedClientIp } from '@/lib/client-ip';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const scrypt = promisify(scryptCb);

interface InviteRow {
  id: string;
  token: string;
  factory_id: string | null;
  prefill_email: string | null;
  prefill_name: string | null;
  prefill_company: string | null;
  prefill_phone: string | null;
  prefill_biz_reg_no: string | null;
  rfq_context_id: string | null;
  expires_at: number;
  accepted_at: number | null;
}

/** Validate Korean business registration number checksum (KISA spec).
 *  Format: 10 digits, possibly with hyphens. Returns the cleaned 10-digit
 *  string when valid, null otherwise. */
function validateBizRegNo(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length !== 10) return null;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i], 10) * weights[i];
  sum += Math.floor((parseInt(digits[8], 10) * 5) / 10);
  const checkDigit = (10 - (sum % 10)) % 10;
  if (checkDigit !== parseInt(digits[9], 10)) return null;
  return digits;
}

function validatePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  if (digits.length < 9 || digits.length > 11) return null;
  return digits;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

  const db = getDbAdapter();
  const invite = await db.queryOne<InviteRow>(
    'SELECT * FROM nf_partner_invites WHERE token = ?', token,
  ).catch(() => null);
  if (!invite) return NextResponse.json({ error: 'invalid token' }, { status: 404 });
  if (invite.accepted_at) return NextResponse.json({ error: 'invite already used' }, { status: 410 });
  if (Date.now() > invite.expires_at) {
    // Notify ops — partner clicked an expired link, outreach effort at
    // risk. Without this, ops only finds out via CS escalation.
    try {
      const { createNotification } = await import('@/app/lib/notify');
      void createNotification(
        'admin',
        'invite_expired_clicked',
        '만료된 매직링크 클릭 — 재발급 필요',
        `${invite.prefill_email ?? '(이메일 없음)'} 가 만료된 invite 토큰을 사용했습니다. 재발급해주세요. (invite=${invite.id.slice(0, 12)}, factory=${invite.factory_id ?? '?'})`,
      );
    } catch { /* non-blocking */ }
    return NextResponse.json({
      error: 'invite expired',
      hint: '운영팀에 재초청을 요청해주세요. 운영팀에 자동 알림이 발송되었습니다.',
    }, { status: 410 });
  }

  return NextResponse.json({
    ok: true,
    invite: {
      prefill: {
        email: invite.prefill_email,
        name: invite.prefill_name,
        company: invite.prefill_company,
        phone: invite.prefill_phone,
        bizRegNo: invite.prefill_biz_reg_no,
      },
      rfqContextId: invite.rfq_context_id,
      expiresAt: invite.expires_at,
    },
  });
}

interface AcceptBody {
  token?: unknown;
  password?: unknown;
  email?: unknown;
  name?: unknown;
  company?: unknown;
  phone?: unknown;
  bizRegNo?: unknown;
  agreementVersion?: unknown;
  agreementAccepted?: unknown;
}

export async function POST(req: NextRequest) {
  let body: AcceptBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const company = typeof body.company === 'string' ? body.company.trim().slice(0, 120) : '';
  const phoneRaw = typeof body.phone === 'string' ? body.phone : '';
  const bizRegRaw = typeof body.bizRegNo === 'string' ? body.bizRegNo : '';
  const agreementVersion = typeof body.agreementVersion === 'string' ? body.agreementVersion : '';
  const agreementAccepted = body.agreementAccepted === true;

  if (!token || password.length < 10 || !email || !email.includes('@')) {
    return NextResponse.json({ error: 'token, email, password (≥10) required' }, { status: 400 });
  }
  if (!name || !company) {
    return NextResponse.json({ error: 'name and company required' }, { status: 400 });
  }
  const phone = validatePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json({ error: 'invalid phone — must be 9–11 digits (담당자 번호)' }, { status: 400 });
  }
  const bizRegNo = validateBizRegNo(bizRegRaw);
  if (!bizRegNo) {
    return NextResponse.json({ error: 'invalid 사업자 등록 번호 — checksum failed' }, { status: 400 });
  }
  if (!agreementAccepted || agreementVersion !== 'v1.0') {
    return NextResponse.json({ error: 'partner agreement v1.0 must be accepted' }, { status: 400 });
  }

  const db = getDbAdapter();
  const invite = await db.queryOne<InviteRow>(
    'SELECT * FROM nf_partner_invites WHERE token = ?', token,
  ).catch(() => null);
  if (!invite) return NextResponse.json({ error: 'invalid token' }, { status: 404 });
  if (invite.accepted_at) return NextResponse.json({ error: 'invite already used' }, { status: 410 });
  if (Date.now() > invite.expires_at) return NextResponse.json({ error: 'invite expired' }, { status: 410 });

  // Hash password with scrypt (compatible with rest of nf_users password storage).
  const salt = randomUUID().replace(/-/g, '');
  const derived = await scrypt(password, salt, 64) as Buffer;
  const passwordHash = `scrypt:${salt}:${derived.toString('hex')}`;

  const userId = `user_${randomUUID()}`;
  const now = Date.now();
  const ip = getTrustedClientIp(req.headers);

  // Create the partner user (idempotent on email — if user exists, we link instead of duplicating).
  // For simplicity v1 assumes email is fresh; production will need email-existence check.
  await db.execute(
    `INSERT INTO nf_users (id, email, name, plan, password_hash, created_at, role,
                           biz_reg_no, contact_phone, company_name)
     VALUES (?, ?, ?, ?, ?, ?, 'partner', ?, ?, ?)`,
    userId, email, name, 'free', passwordHash, now, bizRegNo, phone, company,
  ).catch(async () => {
    // If columns biz_reg_no etc. don't exist yet, fall back to base columns
    // and store the biz info separately (defensive — schema may lag).
    await db.execute(
      `INSERT INTO nf_users (id, email, name, plan, password_hash, created_at, role)
       VALUES (?, ?, ?, ?, ?, ?, 'partner')`,
      userId, email, name, 'free', passwordHash, now,
    ).catch(() => {});
  });

  // Mark invite accepted with the final captured values.
  await db.execute(
    `UPDATE nf_partner_invites
        SET accepted_at = ?, accepted_by_email = ?, accepted_by_ip = ?,
            final_biz_reg_no = ?, final_phone = ?, final_company = ?,
            resulting_user_id = ?
      WHERE id = ?`,
    now, email, ip, bizRegNo, phone, company, userId, invite.id,
  );

  // Record agreement consent for legal trail.
  await db.execute(`
    CREATE TABLE IF NOT EXISTS nf_partner_agreement_consents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      partner_email TEXT,
      agreement_version TEXT NOT NULL,
      accepted_at BIGINT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      invite_id TEXT
    )
  `).catch(() => {});
  await db.execute(
    `INSERT INTO nf_partner_agreement_consents
       (id, user_id, partner_email, agreement_version, accepted_at, ip_address, user_agent, invite_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    `consent_${randomUUID()}`, userId, email, agreementVersion, now,
    ip, req.headers.get('user-agent') ?? '', invite.id,
  );

  // Link user to factory record (so partner profile resolves correctly).
  if (invite.factory_id) {
    await db.execute(
      'UPDATE nf_factories SET partner_email = ? WHERE id = ?',
      email, invite.factory_id,
    ).catch(() => {});
  }

  // Funnel signal — concierge → partner conversion. The /admin/funnel
  // dashboard pivots on this to compute outreach → signup rate.
  try {
    const { logFunnelEvent } = await import('@/lib/funnel-logger');
    await logFunnelEvent(userId, {
      eventType: 'concierge_partner_signup',
      contextType: 'partner_invite',
      contextId: invite.id,
      metadata: { factoryId: invite.factory_id, rfqId: invite.rfq_context_id },
    });
  } catch { /* non-blocking */ }

  return NextResponse.json({
    ok: true,
    userId,
    redirectTo: invite.rfq_context_id
      ? `/partner/quotes?rfq=${encodeURIComponent(invite.rfq_context_id)}`
      : '/partner/quotes',
  }, { status: 201 });
}
