/**
 * admin-elevation.ts — **관리자 화면은 비밀번호 하나로 열리지 않는다** (260802).
 *
 * ## 무엇이 문제였나 — 실측
 * nexyfab 의 관리자 API 63개는 `authUser.globalRole === 'super_admin'` 으로 막혀 있다.
 * 공유 토큰이 아니라 **계정 역할**이라 nexygames 가 겪은 「ADMIN_TOKEN 하나를 돌려 쓰는」
 * 문제는 없다. 다만 2FA(`totp_enabled`)가 **선택**이라, 관리자가 안 켜 두면
 * **비밀번호가 새는 순간 관리자 콘솔이 열린다.**
 *
 * 그래서 이메일 OTP 를 **관리자 전용 step-up 인증**으로 둔다 — 인증 앱 없이도 되고,
 * 로그인 자체는 그대로 두므로 일반 사용자 흐름을 건드리지 않는다.
 *
 * ## 설계에서 고른 것과 그 이유
 *
 * ### 1. 상승을 **액세스 토큰 해시**에 묶는다
 * 인증이 JWT 쿠키라 서버 세션 레코드가 없다. 별도 쿠키를 하나 더 두는 대신
 * `sha256(accessToken)` 을 키로 쓴다 — 그러면 **로그아웃·재로그인·토큰 회전에서
 * 상승이 자동으로 죽는다.** 폐기 절차를 따로 만들면 그걸 잊는 날이 온다.
 *
 * ### 2. 코드를 **평문으로 저장하지 않는다**
 * 기존 `nf_verification_codes` 는 코드를 PK 로 평문 저장한다(이메일 인증용).
 * 그 방식을 관리자 인증에 그대로 복제하지 않는다 — DB 가 새면 그 순간 관리자가 된다.
 * `HMAC-SHA256(JWT_SECRET, code)` 로 저장한다. 6자리는 10^6 이라 **단순 해시면
 * 오프라인 전수조사가 몇 초**지만, 서버 비밀이 섞이면 비밀 없이는 못 돌린다.
 *
 * ### 3. 이메일 인증 테이블을 **재사용하지 않는다**
 * 같은 테이블을 쓰면 「회원가입 이메일 인증 코드」로 관리자 상승이 가능해진다 —
 * 용도가 다른 자격을 한 그릇에 담으면 그게 곧 권한 혼동이다.
 *
 * ### 4. 실패를 **조용히 통과시키지 않는다**
 * 메일 발송이 실패하면 상승을 주지 않는다. 「코드를 보냈다」고만 하고 못 보냈으면
 * 사용자는 오지 않는 메일을 기다린다.
 *
 * ## ⚠ 잠김 위험 — 명시적으로 남긴다
 * 관리자가 한 명인데 메일이 안 가면 **콘솔에 못 들어간다.** 그래서 인프라 접근이
 * 있어야만 바꿀 수 있는 `ADMIN_OTP_REQUIRED=false` 를 둔다. 이것은 뒷문이 아니라
 * **Railway 콘솔에 로그인할 수 있는 사람만 쓰는 운영 밸브**다 — 공유 비밀이 아니다.
 */
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getDbAdapter } from './db-adapter';

/** 코드 유효 시간. 짧을수록 좋지만 메일 지연을 견뎌야 한다. */
export const OTP_TTL_MS = 5 * 60 * 1000;
/** 상승 유효 시간 — 이 시간이 지나면 다시 코드를 받는다. */
export const ELEVATION_TTL_MS = 8 * 60 * 60 * 1000;
/** 코드 오입력 허용 횟수. 넘으면 코드를 폐기한다(무제한이면 6자리는 곧 뚫린다). */
export const MAX_OTP_ATTEMPTS = 5;

/** 강제 여부. 기본은 **켜짐** — 끄려면 인프라에서 명시적으로 꺼야 한다. */
export function isAdminOtpRequired(): boolean {
  return process.env.ADMIN_OTP_REQUIRED !== 'false';
}

function secret(): string {
  const s = process.env.JWT_SECRET;
  // ⚠ 비밀이 없으면 **약한 해시로 조용히 내려가지 않는다.** 그러면 저장된 코드가
  //   사실상 평문이 되는데 로그에는 아무 일도 안 남는다.
  if (!s) throw new Error('[admin-elevation] JWT_SECRET 이 없다 — OTP 를 안전하게 저장할 수 없다');
  return s;
}

/** 코드 해시. **서버 비밀을 섞는다** — 6자리 평문 해시는 오프라인에서 곧 풀린다. */
export function hashOtp(code: string): string {
  return createHmac('sha256', secret()).update(code).digest('hex');
}

/** 액세스 토큰 → 상승 레코드 키. 토큰 자체는 저장하지 않는다. */
export function accessKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 요청에서 액세스 토큰을 꺼낸다 — `getAuthUser` 와 **같은 순서**로 본다. */
export function readAccessToken(req: NextRequest): string | null {
  const cookie = req.cookies.get('nf_access_token')?.value;
  if (cookie) return cookie;
  const h = req.headers.get('authorization');
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
}

/** 6자리 코드. `Math.random` 을 쓰지 않는다 — 예측 가능한 인증 코드는 인증이 아니다. */
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 길이가 달라도 타이밍이 새지 않게 비교한다. */
function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

export interface OtpIssue { code: string; expiresAt: number }

/**
 * 새 코드를 만들어 저장한다. **사용자당 하나만** 유효하다(직전 코드는 폐기).
 * @returns 평문 코드 — **메일로 보내는 용도로만 쓰고 어디에도 남기지 않는다.**
 */
export async function issueOtp(userId: string, now = Date.now()): Promise<OtpIssue> {
  const db = getDbAdapter();
  const code = generateOtp();
  const expiresAt = now + OTP_TTL_MS;
  await db.execute('DELETE FROM nf_admin_otp WHERE user_id = ?', userId);
  await db.execute(
    'INSERT INTO nf_admin_otp (user_id, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)',
    userId, hashOtp(code), expiresAt, now,
  );
  return { code, expiresAt };
}

export type VerifyResult =
  | { ok: true; expiresAt: number }
  | { ok: false; reason: 'no_code' | 'expired' | 'too_many_attempts' | 'mismatch' };

/**
 * 코드를 검증하고 성공하면 **이 액세스 토큰에** 상승을 부여한다.
 *
 * ⚠ 실패 사유를 구별해 돌려준다 — 「틀렸다」와 「만료됐다」와 「시도 초과」는
 *   사용자가 해야 할 일이 다르다. 다만 **호출측이 그대로 노출할지는 따로 판단**한다.
 */
export async function verifyOtpAndElevate(
  userId: string, accessToken: string, code: string, now = Date.now(),
): Promise<VerifyResult> {
  const db = getDbAdapter();
  const row = await db.queryOne<{ code_hash: string; expires_at: number; attempts: number }>(
    'SELECT code_hash, expires_at, attempts FROM nf_admin_otp WHERE user_id = ?', userId,
  );
  if (!row) return { ok: false, reason: 'no_code' };
  if (Number(row.expires_at) <= now) {
    await db.execute('DELETE FROM nf_admin_otp WHERE user_id = ?', userId);
    return { ok: false, reason: 'expired' };
  }
  if (Number(row.attempts) >= MAX_OTP_ATTEMPTS) {
    await db.execute('DELETE FROM nf_admin_otp WHERE user_id = ?', userId);
    return { ok: false, reason: 'too_many_attempts' };
  }
  if (!safeEqualHex(hashOtp(String(code ?? '')), String(row.code_hash))) {
    // 시도 횟수를 **먼저** 올린다 — 실패하고 안 올리면 무제한 시도가 된다.
    await db.execute('UPDATE nf_admin_otp SET attempts = attempts + 1 WHERE user_id = ?', userId);
    return { ok: false, reason: 'mismatch' };
  }
  // 단회용 — 맞았어도 코드는 즉시 폐기한다.
  await db.execute('DELETE FROM nf_admin_otp WHERE user_id = ?', userId);
  const expiresAt = now + ELEVATION_TTL_MS;
  const key = accessKey(accessToken);
  await db.execute('DELETE FROM nf_admin_elevation WHERE access_hash = ?', key);
  await db.execute(
    'INSERT INTO nf_admin_elevation (access_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    key, userId, expiresAt, now,
  );
  return { ok: true, expiresAt };
}

/**
 * 이 요청이 **상승된 관리자 세션**인가.
 *
 * @returns 남은 시간(ms) 또는 `null`
 * ⚠ `user_id` 를 함께 대조한다 — 토큰만 맞으면 되게 두면 계정이 바뀌어도 상승이 남는다.
 */
export async function elevationRemainingMs(
  userId: string, accessToken: string | null, now = Date.now(),
): Promise<number | null> {
  if (!accessToken) return null;
  const db = getDbAdapter();
  const row = await db.queryOne<{ user_id: string; expires_at: number }>(
    'SELECT user_id, expires_at FROM nf_admin_elevation WHERE access_hash = ?', accessKey(accessToken),
  );
  if (!row) return null;
  if (String(row.user_id) !== String(userId)) return null;
  const left = Number(row.expires_at) - now;
  return left > 0 ? left : null;
}

/** 만료된 코드·상승을 지운다(cron 또는 요청 경로에서 가볍게 호출). */
export async function pruneExpired(now = Date.now()): Promise<void> {
  const db = getDbAdapter();
  await db.execute('DELETE FROM nf_admin_otp WHERE expires_at <= ?', now);
  await db.execute('DELETE FROM nf_admin_elevation WHERE expires_at <= ?', now);
}
