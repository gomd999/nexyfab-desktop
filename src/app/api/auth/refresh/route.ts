import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter, toBool } from '@/lib/db-adapter';
import { signJWT } from '@/lib/jwt';
import { createHash, randomBytes } from 'crypto';
import { SERVICE_NAME } from '@/lib/service-config';
import { accessTokenCookie, browserSessionCookie, clearAuthCookies, refreshTokenCookie } from '@/lib/cookie-config';
import { parseUserStageColumn } from '@/lib/stage-engine';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_REFRESH_BODY_BYTES = 16 * 1024;

export const dynamic = 'force-dynamic';

const REFRESH_TOKEN_TTL = 30 * 24 * 3600 * 1000; // 30일 (ms)

export async function POST(req: NextRequest) {
  try {
    if (req.cookies.get('nf_refresh_token')?.value && req.cookies.get('nf_browser_session')?.value !== 'v1') {
      const response = NextResponse.json({ error: 'Browser session expired' }, { status: 401 });
      clearAuthCookies(response);
      return response;
    }
    let body: { refreshToken?: string };
    try { body = await readBoundedJson(req, MAX_REFRESH_BODY_BYTES); }
    catch (error) {
      if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
      throw error;
    }
    // body 우선, 없으면 쿠키에서 읽기
    const rawToken = body.refreshToken
      || req.cookies.get('nf_refresh_token')?.value;
    if (!rawToken || typeof rawToken !== 'string') {
      return NextResponse.json({ error: 'Missing refresh token' }, { status: 400 });
    }

    const db = getDbAdapter();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const row = await db.queryOne<{
      id: string; user_id: string; email: string; plan: string; email_verified: number | boolean; expires_at: number;
      stage: string | null;
    }>(
      `SELECT rt.*, u.email, u.plan, u.email_verified, u.stage
       FROM nf_refresh_tokens rt
       JOIN nf_users u ON u.id = rt.user_id
       WHERE rt.token_hash = ? AND rt.revoked = FALSE AND rt.expires_at > ?`,
      tokenHash, Date.now(),
    );

    if (!row) {
      return NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 });
    }

    // Surface billing status to the client so the app can show a "card declined"
    // or "subscription cancelling" banner on the next render. Read the most
    // recent active-or-pending subscription row; absence is fine (free user).
    const subRow = await db.queryOne<{ status: string; current_period_end: number }>(
      `SELECT status, current_period_end FROM nf_aw_subscriptions
        WHERE user_id = ?
          AND status IN ('active', 'past_due', 'cancel_pending')
        ORDER BY updated_at DESC LIMIT 1`,
      row.user_id,
    ).catch(() => null);
    const billingStatus: 'active' | 'past_due' | 'cancel_pending' | null =
      subRow?.status === 'past_due' ? 'past_due'
      : subRow?.status === 'cancel_pending' ? 'cancel_pending'
      : subRow?.status === 'active' ? 'active'
      : null;

    // Token rotation: 기존 토큰 폐기 후 새 토큰 발급 (atomic transaction)
    const newRawToken = randomBytes(40).toString('hex');
    const newTokenHash = createHash('sha256').update(newRawToken).digest('hex');
    const now = Date.now();

    await db.transaction(async (db) => {
      await db.execute('UPDATE nf_refresh_tokens SET revoked = TRUE WHERE id = ?', row.id);

      await db.execute(
        `INSERT INTO nf_refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at)
         VALUES (?, ?, ?, ?, FALSE, ?)`,
        `rt-${crypto.randomUUID()}`,
        row.user_id,
        newTokenHash,
        now + REFRESH_TOKEN_TTL,
        now,
      );
    });

    const accessToken = await signJWT(
      {
        sub: row.user_id,
        email: row.email,
        plan: row.plan,
        emailVerified: toBool(row.email_verified),
        service: SERVICE_NAME,
        nexyfabStage: parseUserStageColumn(row.stage),
      },
      15 * 60, // 15분
    );

    const response = NextResponse.json({
      expiresIn: 15 * 60,
      plan: row.plan,
      nexyfabStage: parseUserStageColumn(row.stage),
      billingStatus,
      ...(subRow?.current_period_end ? { periodEndMs: subRow.current_period_end } : {}),
    });

    const rc = refreshTokenCookie(newRawToken);
    response.cookies.set(rc.name, rc.value, rc.options);
    const ac = accessTokenCookie(accessToken);
    response.cookies.set(ac.name, ac.value, ac.options);
    const bs = browserSessionCookie();
    response.cookies.set(bs.name, bs.value, bs.options);

    return response;
  } catch (err) {
    console.error('[auth/refresh] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
