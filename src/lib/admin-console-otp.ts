/**
 * admin-console-otp.ts — **40페이지짜리 `/admin` 콘솔에 2단계를 붙인다** (260802).
 *
 * ## 왜 필요한가 — 실측으로 드러난 것
 * ```
 * /admin/*                    40페이지  ← 공유 비밀번호 ADMIN_PASSWORD 하나로 열림
 * /[lang]/nexyfab/admin/*      5페이지  ← 계정 역할 + 이메일 OTP (먼저 붙였던 곳)
 * ```
 * **실제 관리자 콘솔은 40페이지 쪽**이고, 그건 비밀번호 하나로 열린다 —
 * nexygames 가 고쳤던 「공유 자격증명」 그 형태다.
 *
 * ## ⚠ 계정 콘솔과 **다른 메커니즘이 필요한 이유**
 * `/admin` 은 계정이 아니라 **공유 비밀번호**로 들어온다 — 코드를 보낼 개인 주소가 없다.
 * 그래서 `OPS_ALERT_EMAIL`(운영 알림 주소)로 보낸다.
 * 이건 「누구인지」가 아니라 **「그 메일함에 접근할 수 있는가」**를 확인하는 것이다.
 * 개인 계정 OTP 보다 약하지만, **비밀번호 하나보다는 확실히 강하다.**
 * 근본 해결은 계정 기반으로 통합하는 것이고, 그건 별도 작업으로 남긴다.
 *
 * ## 설정이 없으면 어떻게 하나 — **조용히 열지 않는다**
 * `OPS_ALERT_EMAIL` 이 없으면 2단계를 **적용할 수 없다.** 그때 조용히 통과시키면
 * 「2단계를 켰다」고 믿는 상태로 열려 있게 된다. 그래서 상태를 명시적으로 돌려주고,
 * 호출측이 사용자에게 그대로 알린다.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { getDbAdapter } from './db-adapter';

export const CONSOLE_OTP_TTL_MS = 5 * 60 * 1000;
export const CONSOLE_OTP_MAX_ATTEMPTS = 5;

/** 공유 콘솔이라 사용자 id 가 없다 — 고정 키를 쓴다. */
const CONSOLE_KEY = '__admin_console__';

function secret(): string {
  const s = process.env.ADMIN_SESSION_SECRET ?? process.env.JWT_SECRET;
  // ⚠ 비밀이 없으면 약한 해시로 내려가지 않는다 — 저장된 코드가 사실상 평문이 된다.
  if (!s) throw new Error('[admin-console-otp] ADMIN_SESSION_SECRET/JWT_SECRET 이 없다');
  return s;
}

export function hashOtp(code: string): string {
  return createHmac('sha256', secret()).update(String(code).trim()).digest('hex');
}

/** 코드를 보낼 주소들. 없으면 빈 배열 — 그 사실을 호출측이 알아야 한다. */
export function opsRecipients(): string[] {
  return (process.env.OPS_ALERT_EMAIL ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean);
}

export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/** 새 코드 발급(직전 코드는 폐기). `nf_admin_otp` 테이블을 공유 키로 재사용한다. */
export async function issueConsoleOtp(now = Date.now()): Promise<{ code: string; expiresAt: number }> {
  const db = getDbAdapter();
  const code = generateOtp();
  const expiresAt = now + CONSOLE_OTP_TTL_MS;
  await db.execute('DELETE FROM nf_admin_otp WHERE user_id = ?', CONSOLE_KEY);
  await db.execute(
    'INSERT INTO nf_admin_otp (user_id, code_hash, expires_at, attempts, created_at) VALUES (?, ?, ?, 0, ?)',
    CONSOLE_KEY, hashOtp(code), expiresAt, now,
  );
  return { code, expiresAt };
}

export type ConsoleVerify =
  | { ok: true }
  | { ok: false; reason: 'no_code' | 'expired' | 'too_many_attempts' | 'mismatch' };

/** 코드 검증(단회용). 맞으면 즉시 폐기한다. */
export async function verifyConsoleOtp(code: string, now = Date.now()): Promise<ConsoleVerify> {
  const db = getDbAdapter();
  const row = await db.queryOne<{ code_hash: string; expires_at: number; attempts: number }>(
    'SELECT code_hash, expires_at, attempts FROM nf_admin_otp WHERE user_id = ?', CONSOLE_KEY,
  );
  if (!row) return { ok: false, reason: 'no_code' };
  if (Number(row.expires_at) <= now) {
    await db.execute('DELETE FROM nf_admin_otp WHERE user_id = ?', CONSOLE_KEY);
    return { ok: false, reason: 'expired' };
  }
  if (Number(row.attempts) >= CONSOLE_OTP_MAX_ATTEMPTS) {
    await db.execute('DELETE FROM nf_admin_otp WHERE user_id = ?', CONSOLE_KEY);
    return { ok: false, reason: 'too_many_attempts' };
  }
  if (!safeEqualHex(hashOtp(code), String(row.code_hash))) {
    const used = Number(row.attempts) + 1;
    /**
     * ⚠ 상한에 **도달한 그 순간** 폐기한다. 다음 호출까지 살려 두면 그동안 코드가
     *   DB 에 유효한 상태로 남는다 — 「막았다」와 「다음에 막는다」는 다르다.
     */
    if (used >= CONSOLE_OTP_MAX_ATTEMPTS) {
      await db.execute('DELETE FROM nf_admin_otp WHERE user_id = ?', CONSOLE_KEY);
      return { ok: false, reason: 'too_many_attempts' };
    }
    await db.execute('UPDATE nf_admin_otp SET attempts = attempts + 1 WHERE user_id = ?', CONSOLE_KEY);
    return { ok: false, reason: 'mismatch' };
  }
  await db.execute('DELETE FROM nf_admin_otp WHERE user_id = ?', CONSOLE_KEY);
  return { ok: true };
}

/**
 * 2단계를 **강제할 수 있는 상태인가**.
 *
 * ⚠ 「끄기」와 「설정이 없어서 못 함」을 구별한다. 전자는 결정이고 후자는 사고다.
 */
export function consoleOtpMode(): 'enforced' | 'disabled_by_env' | 'unconfigured' {
  if (process.env.ADMIN_OTP_REQUIRED === 'false') return 'disabled_by_env';
  if (opsRecipients().length === 0) return 'unconfigured';
  return 'enforced';
}
