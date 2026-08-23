import { NextRequest, NextResponse } from 'next/server';
import { getDbAdapter, toBool } from '@/lib/db-adapter';
import { signJWT } from '@/lib/jwt';
import { rateLimitAsync, rateLimitHeaders } from '@/lib/rate-limit';
import { checkOrigin } from '@/lib/csrf';
import { logAudit } from '@/lib/audit';
import { recordLoginAndCheck } from '@/lib/login-security';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { createHash, randomBytes } from 'crypto';
import type { UserRow } from '@/lib/db-types';
import { SERVICE_NAME } from '@/lib/service-config';
import { accessTokenCookie, browserSessionCookie, refreshTokenCookie } from '@/lib/cookie-config';
import { tryClaimDemoOnAuth } from '@/lib/demo-session';
import { parseUserStageColumn } from '@/lib/stage-engine';
import { getTrustedClientIp } from '@/lib/client-ip';
import * as OTPAuth from 'otpauth';
import { boundedJsonError, readBoundedJson } from '@/lib/boundedJsonBody';

const MAX_LOGIN_BODY_BYTES = 16 * 1024;

const AUTH_URL = process.env.NEXYSYS_AUTH_URL || '';

export async function POST(req: NextRequest) {
  // CSRF origin check
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Rate limit: 10 requests/minute per IP
  const ip = getTrustedClientIp(req.headers);
  const rateLimitResult = await rateLimitAsync(`login:${ip}`, 10, 60_000);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
      {
        status: 429,
        headers: rateLimitHeaders(rateLimitResult, 10),
      },
    );
  }

  let body: { email?: string; password?: string };
  try { body = await readBoundedJson(req, MAX_LOGIN_BODY_BYTES); }
  catch (error) {
    if (boundedJsonError(error)?.code === 'PAYLOAD_TOO_LARGE') return NextResponse.json({ error: 'Request too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    throw error;
  }
  if (typeof body.email === 'string') {
    const normalizedEmail = body.email.trim().toLowerCase();
    const emailKey = createHash('sha256').update(normalizedEmail).digest('hex');
    const accountLimit = await rateLimitAsync(`login-account:${emailKey}`, 10, 60_000);
    if (!accountLimit.allowed) {
      return NextResponse.json(
        { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
        { status: 429, headers: rateLimitHeaders(accountLimit, 10) },
      );
    }
  }

  // Demo / local DB mode
  if (!AUTH_URL) {
    // NODE_ENV가 development이면 항상 demo 허용
    if (process.env.NODE_ENV === 'development') {
      // 기존 demo 로직 통과
    } else if (process.env.ALLOW_DEMO_AUTH !== 'true') {
      return NextResponse.json({ error: '서비스 준비 중입니다. 관리자에게 문의하세요.' }, { status: 503 });
    }

    const loginSchema = z.object({
      email: z.string().email().max(255),
      password: z.string().min(1).max(200),
    });
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    const { email, password } = parsed.data;

    const db = getDbAdapter();

    const LOCKOUT_THRESHOLD = 5; // failed attempts before lockout
    const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

    // Look up existing user
    const dbUser = await db.queryOne<UserRow>('SELECT * FROM nf_users WHERE email = ?', email);

    if (!dbUser) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    // Check if account is locked
    if (dbUser.locked_until && Date.now() < dbUser.locked_until) {
      return NextResponse.json(
        { error: 'Invalid email or password.' },
        { status: 401 },
      );
    }

    // password_hash가 있으면 bcrypt 검증, 없으면 (소셜 로그인 사용자) 거부
    if (!dbUser.password_hash) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const passwordMatch = await bcrypt.compare(password, dbUser.password_hash);
    if (!passwordMatch) {
      // 실패 이력 기록
      void recordLoginAndCheck(
        { userId: dbUser.id, ip, country: null, userAgent: req.headers.get('user-agent'), method: 'email', success: false },
        req.headers,
      );
      // Increment failed attempts
      const newAttempts = (dbUser.failed_login_attempts ?? 0) + 1;
      const shouldLock = newAttempts >= LOCKOUT_THRESHOLD;

      await db.execute(
        'UPDATE nf_users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
        newAttempts,
        shouldLock ? Date.now() + LOCKOUT_DURATION_MS : null,
        dbUser.id,
      );

      if (shouldLock) {
        return NextResponse.json(
          { error: 'Too many failed attempts. Account locked for 15 minutes.' },
          { status: 423 },
        );
      }

      const remaining = LOCKOUT_THRESHOLD - newAttempts;
      return NextResponse.json(
        { error: `Invalid email or password. ${remaining} attempt(s) remaining before lockout.` },
        { status: 401 },
      );
    }

    // Subscription gate: features remain usable after expiry, but login is
    // blocked 3 days past the subscription end date. null = no expiry.
    if (dbUser.subscription_ends_at != null) {
      const subEnd = Number(dbUser.subscription_ends_at);
      if (Number.isFinite(subEnd) && Date.now() > subEnd + 3 * 24 * 60 * 60 * 1000) {
        return NextResponse.json(
          { error: '구독이 만료되었습니다. 연장은 관리자에게 문의하세요.' },
          { status: 403 },
        );
      }
    }

    /** 복구 코드로 통과한 경우 남은 개수(응답에 실어 재발급을 유도한다). */
    let recoveryRemaining: number | null = null;

    // Check if 2FA is enabled
    if (toBool(dbUser.totp_enabled)) {
      const totpCode = (body as { totpCode?: string }).totpCode;
      const recoveryCode = (body as { recoveryCode?: string }).recoveryCode;

      /**
       * 복구 코드 경로 (260802 추가).
       *
       * ⚠ 종전엔 TOTP 만 받아 **휴대폰을 잃으면 계정에 영영 못 들어갔다.**
       *   복구 코드는 **2FA 단계만** 대신한다 — 이메일+비밀번호는 이미 위에서 확인됐다.
       *   그렇지 않으면 복구 코드 하나가 곧 계정이 된다.
       */
      if (recoveryCode) {
        const { consumeRecoveryCode } = await import('@/lib/recovery-codes');
        const r = await consumeRecoveryCode(dbUser.id, recoveryCode);
        if (!r.ok) {
          logAudit({ userId: dbUser.id, action: 'auth.recovery_code_failed', resourceId: dbUser.id, ip });
          return NextResponse.json({ error: '복구 코드가 올바르지 않거나 이미 사용되었습니다.' }, { status: 401 });
        }
        logAudit({ userId: dbUser.id, action: 'auth.recovery_code_used', resourceId: dbUser.id, metadata: { remaining: r.remaining }, ip });
        // ⚠ 남은 개수를 응답에 실어 **소진되기 전에** 재발급하도록 알린다.
        recoveryRemaining = r.remaining;
      } else if (!totpCode) {
        // Return a challenge — client must re-submit with totpCode
        return NextResponse.json(
          { requires2FA: true, message: 'Please provide your 2FA code.' },
          { status: 200 } // 200 so client knows to show 2FA input
        );
      }

      // Guard: totp_secret must exist if 2FA is enabled
      if (!recoveryCode && !dbUser.totp_secret) {
        console.error('[login] User has totp_enabled but totp_secret is missing:', dbUser.id);
        return NextResponse.json(
          { error: '2FA 설정 오류입니다. 고객센터에 문의하세요.' },
          { status: 500 },
        );
      }

      // Validate TOTP code (복구 코드로 통과했으면 건너뛴다)
      if (!recoveryCode) {
      const totp = new OTPAuth.TOTP({
        issuer: 'NexyFab',
        label: dbUser.email,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: OTPAuth.Secret.fromBase32(dbUser.totp_secret as string),
      });

      const delta = totp.validate({ token: totpCode as string, window: 1 });
      if (delta === null) {
        return NextResponse.json({ error: 'Invalid 2FA code' }, { status: 401 });
      }
      }
    }

    // Successful login — reset failed attempts, lockout, track login, and update service tag
    const loginNow = Date.now();
    const currentServices: string[] = JSON.parse(
      (await db.queryOne<{ services: string }>('SELECT services FROM nf_users WHERE id = ?', dbUser.id))?.services || '[]',
    );
    if (!currentServices.includes(SERVICE_NAME)) currentServices.push(SERVICE_NAME);
    const planCol = `${SERVICE_NAME}_plan`;
    await db.execute(
      `UPDATE nf_users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?, login_count = COALESCE(login_count, 0) + 1, last_login_ip = ?,
        services = ?, ${planCol} = COALESCE(${planCol}, 'free'), updated_at = ? WHERE id = ?`,
      loginNow, ip, JSON.stringify(currentServices), loginNow, dbUser.id,
    );

    // 보안 검사: IP 이상 탐지
    const ua = req.headers.get('user-agent');
    const { blocked } = await recordLoginAndCheck(
      { userId: dbUser.id, ip, country: null, userAgent: ua, method: 'email', success: true },
      req.headers,
    );
    if (blocked) {
      return NextResponse.json(
        { error: '비정상적인 로그인이 감지되어 계정이 일시 잠금되었습니다. 이메일을 확인해 주세요.' },
        { status: 423 },
      );
    }

    const token = await signJWT(
      {
        sub: dbUser.id,
        email: dbUser.email,
        plan: dbUser.plan,
        emailVerified: toBool(dbUser.email_verified),
        service: SERVICE_NAME,
        nexyfabStage: parseUserStageColumn((dbUser as { stage?: string | null }).stage),
      },
      15 * 60, // 15분
    );

    // Refresh token 발급 — 기존 세션 모두 무효화 (동시 접속 방지)
    const REFRESH_TOKEN_TTL = 30 * 24 * 3600 * 1000;
    const rawRefreshToken = randomBytes(40).toString('hex');
    const refreshTokenHash = createHash('sha256').update(rawRefreshToken).digest('hex');
    const now = Date.now();
    await db.execute(
      "UPDATE nf_refresh_tokens SET revoked = TRUE WHERE user_id = ? AND revoked = FALSE",
      dbUser.id,
    );
    /**
     * ⚠ 260802: 세션 목록(`/api/auth/sessions`)이 보여 줄 정보를 **여기서** 남긴다.
     *   기록하지 않으면 목록 화면이 비어 「어디서 로그인됐는지」를 알 수 없다.
     *   user_agent 는 **자기신고**라 소비처에서 그렇게 표시해야 한다.
     */
    const uaRaw = (req.headers.get('user-agent') ?? '').slice(0, 300);
    await db.execute(
      `INSERT INTO nf_refresh_tokens (id, user_id, token_hash, expires_at, revoked, created_at, user_agent, ip, last_used_at)
       VALUES (?, ?, ?, ?, FALSE, ?, ?, ?, ?)`,
      `rt-${crypto.randomUUID()}`,
      dbUser.id,
      refreshTokenHash,
      now + REFRESH_TOKEN_TTL,
      now,
      uaRaw,
      ip,
      now,
    );

    /**
     * 새 기기 로그인 알림 (260802).
     *
     * ⚠ 지문은 **user_agent + IP 대역**으로 만든다. 정확한 기기 식별이 아니라
     *   「전에 본 적 없는 조합인가」만 본다 — 위조 가능한 값이라 그 이상을 주장하지 않는다.
     * ⚠ 알림 실패가 로그인을 막지 않는다. 로그인은 이미 성공했다.
     */
    try {
      const { createHash: _h } = await import('crypto');
      const fp = _h('sha256').update(`${uaRaw}|${String(ip).split('.').slice(0, 3).join('.')}`).digest('hex').slice(0, 32);
      const prev = await db.queryOne<{ last_login_fingerprint: string | null }>(
        'SELECT last_login_fingerprint FROM nf_users WHERE id = ?', dbUser.id,
      );
      const isNewDevice = !!prev?.last_login_fingerprint && prev.last_login_fingerprint !== fp;
      await db.execute('UPDATE nf_users SET last_login_fingerprint = ? WHERE id = ?', fp, dbUser.id);
      if (isNewDevice) {
        const { sendEmail: _send } = await import('@/lib/email');
        _send({
          to: dbUser.email,
          subject: '[NexyFab] 새로운 기기에서 로그인되었습니다',
          html: `<div style="font-family:system-ui,sans-serif;max-width:520px">`
            + `<h2 style="margin:0 0 8px">새로운 기기에서 로그인</h2>`
            + `<p style="color:#475569">${new Date(now).toISOString()} · IP ${ip}</p>`
            + `<p style="color:#475569;font-size:13px">기기(자기신고): ${uaRaw.slice(0, 120) || '알 수 없음'}</p>`
            + `<p><b>본인이 아니라면 즉시 비밀번호를 바꾸고 다른 기기의 로그인을 해제하세요.</b></p>`
            + `<p style="color:#64748b;font-size:13px">계정 → 보안 → 로그인 세션에서 해제할 수 있습니다.</p></div>`,
          text: `새로운 기기에서 로그인되었습니다 (${new Date(now).toISOString()}, IP ${ip}). 본인이 아니라면 즉시 비밀번호를 바꾸세요.`,
        }).catch((e) => console.error('[login] 새 기기 알림 실패:', e));
      }
    } catch (e) {
      console.error('[login] 새 기기 판정 실패(로그인은 계속):', e);
    }

    const user = {
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      plan: dbUser.plan,
      projectCount: dbUser.project_count,
      emailVerified: toBool(dbUser.email_verified),
      nexyfabStage: parseUserStageColumn((dbUser as { stage?: string | null }).stage),
    };

    logAudit({ userId: dbUser.id, action: 'auth.login', ip });

    const response = NextResponse.json({
      expiresIn: 900,
      user,
      ...(recoveryRemaining !== null ? { recoveryCodesRemaining: recoveryRemaining } : {}),
    });

    const rc = refreshTokenCookie(rawRefreshToken);
    response.cookies.set(rc.name, rc.value, rc.options);
    const ac = accessTokenCookie(token);
    response.cookies.set(ac.name, ac.value, ac.options);
    const bs = browserSessionCookie();
    response.cookies.set(bs.name, bs.value, bs.options);
    // 데모 세션 쿠키가 있으면 데이터 이관 — 사용자가 데모 모드에서 RFQ 입력 후
    // 가입 안 하고 잠깐 자리 비웠다 로그인 한 케이스도 자동 합류 가능.
    await tryClaimDemoOnAuth(req, response, dbUser.id);

    return response;
  }

  // Production: proxy to auth-server
  try {
    const upstream = await fetch(`${AUTH_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await upstream.json() as { user?: { id?: string } };
    if (upstream.ok && data.user?.id) {
      logAudit({ userId: String(data.user.id), action: 'auth.login', ip });
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch {
    return NextResponse.json({ error: 'Auth server unreachable' }, { status: 503 });
  }
}
