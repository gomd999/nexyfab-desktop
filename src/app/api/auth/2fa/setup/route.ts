import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/auth-middleware';
import { getDbAdapter, toBool } from '@/lib/db-adapter';
import { rateLimit } from '@/lib/rate-limit';
import * as OTPAuth from 'otpauth';
import type { UserRow } from '@/lib/db-types';

export const dynamic = 'force-dynamic';

// GET — generate TOTP secret and QR code URL
export async function GET(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDbAdapter();
  const user = await db.queryOne<UserRow>('SELECT * FROM nf_users WHERE id = ?', authUser.userId);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (toBool(user.totp_enabled)) {
    return NextResponse.json({ error: '2FA is already enabled' }, { status: 400 });
  }

  // Generate new TOTP secret
  const totp = new OTPAuth.TOTP({
    issuer: 'NexyFab',
    label: user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: new OTPAuth.Secret(),
  });

  const secret = totp.secret.base32;
  const otpauthUrl = totp.toString(); // otpauth:// URL for QR code

  // Store secret temporarily (not enabled yet — user must verify first)
  await db.execute('UPDATE nf_users SET totp_secret = ? WHERE id = ?', secret, authUser.userId);

  return NextResponse.json({
    secret,
    otpauthUrl,
    // Frontend should render this URL as QR code using a library like qrcode
  });
}

// POST — verify TOTP code and enable 2FA
export async function POST(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // 브루트포스 방지: 5회/분
  if (!rateLimit(`2fa-verify:${authUser.userId}`, 5, 60_000).allowed) {
    return NextResponse.json({ error: '시도 횟수 초과. 1분 후 다시 시도하세요.' }, { status: 429 });
  }

  const body = await req.json() as { code?: string };
  const { code } = body;

  if (!code || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: 'Invalid verification code format' }, { status: 400 });
  }

  const db = getDbAdapter();
  const user = await db.queryOne<UserRow>('SELECT * FROM nf_users WHERE id = ?', authUser.userId);
  if (!user || !user.totp_secret) {
    return NextResponse.json({ error: 'No 2FA setup in progress. Call GET first.' }, { status: 400 });
  }

  const totp = new OTPAuth.TOTP({
    issuer: 'NexyFab',
    label: user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.totp_secret),
  });

  const delta = totp.validate({ token: code, window: 1 });
  if (delta === null) {
    return NextResponse.json({ error: 'Invalid verification code' }, { status: 400 });
  }

  await db.execute('UPDATE nf_users SET totp_enabled = 1 WHERE id = ?', authUser.userId);

  return NextResponse.json({ ok: true, message: '2FA enabled successfully' });
}

// DELETE — disable 2FA
export async function DELETE(req: NextRequest) {
  const authUser = await getAuthUser(req);
  if (!authUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!rateLimit(`2fa-disable:${authUser.userId}`, 5, 60_000).allowed) {
    return NextResponse.json({ error: '시도 횟수 초과. 1분 후 다시 시도하세요.' }, { status: 429 });
  }

  const body = await req.json() as { code?: string; password?: string };
  if (!body.code || !/^\d{6}$/.test(body.code)) {
    return NextResponse.json({ error: 'Current 2FA code required to disable' }, { status: 400 });
  }

  const db = getDbAdapter();
  const user = await db.queryOne<UserRow>('SELECT * FROM nf_users WHERE id = ?', authUser.userId);
  if (!user || !user.totp_secret || !toBool(user.totp_enabled)) {
    return NextResponse.json({ error: '2FA is not enabled' }, { status: 400 });
  }

  const totp = new OTPAuth.TOTP({
    issuer: 'NexyFab',
    label: user.email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(user.totp_secret),
  });

  const delta = totp.validate({ token: body.code, window: 1 });
  if (delta === null) {
    return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 });
  }

  await db.execute('UPDATE nf_users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?', authUser.userId);

  return NextResponse.json({ ok: true, message: '2FA disabled' });
}
