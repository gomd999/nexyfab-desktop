/**
 * recovery-codes.ts — **2FA 를 켠 사람이 휴대폰을 잃어도 돌아올 수 있게 한다** (260802).
 *
 * ## 왜 필요했나 — 실측
 * TOTP 2FA 는 있는데 **복구 수단이 없었다.** 휴대폰을 잃으면 계정에 **영영 못 들어간다** —
 * 관리자가 DB 를 직접 손대는 것 말고는 방법이 없었다.
 * 2FA 를 권장하려면 이게 먼저다. **되돌릴 수 없는 잠김을 만드는 기능은 권장할 수 없다.**
 *
 * ## 설계
 * · 코드는 **한 번만 보여 주고** 해시로 저장한다(비밀번호와 같은 취급).
 * · **HMAC(JWT_SECRET)** 로 해시한다 — 코드 공간이 작아(10자) 단순 해시는
 *   DB 유출 시 오프라인에서 곧 풀린다. `admin-elevation.ts` 와 같은 판단이다.
 * · **단회용**이다. 쓴 코드는 `used_at` 을 찍고 다시 통하지 않는다.
 * · 재발급하면 **기존 코드를 전부 무효화**한다 — 두 벌이 살아 있으면 어느 것이
 *   유효한지 사용자도 우리도 모른다.
 *
 * ## ⚠ 비밀번호를 대신하지 않는다
 * 복구 코드는 **2FA 단계만** 대신한다. 이메일+비밀번호는 여전히 맞아야 한다.
 * 그렇지 않으면 복구 코드 하나가 곧 계정이 된다.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getDbAdapter } from './db-adapter';

/** 발급 개수. 너무 적으면 금방 떨어지고, 많으면 보관이 어려워진다. */
export const RECOVERY_CODE_COUNT = 10;

function secret(): string {
  const s = process.env.JWT_SECRET;
  // ⚠ 비밀이 없으면 약한 해시로 조용히 내려가지 않는다 — 저장된 코드가 사실상 평문이 된다.
  if (!s) throw new Error('[recovery-codes] JWT_SECRET 이 없다 — 복구 코드를 안전하게 저장할 수 없다');
  return s;
}

/** 정규화 — 사용자는 공백·하이픈·대소문자를 섞어 입력한다. */
export function normalizeCode(input: string): string {
  return String(input ?? '').replace(/[\s-]/g, '').toUpperCase();
}

export function hashCode(code: string): string {
  return createHmac('sha256', secret()).update(normalizeCode(code)).digest('hex');
}

/**
 * 사람이 옮겨 적을 코드. `ABCD-EFGH` 형태.
 *
 * ⚠ 혼동 문자(0/O, 1/I/L)를 뺀다 — 손으로 적어 두는 값이라 오독이 곧 잠김이 된다.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * 새 복구 코드 세트를 발급한다. **기존 코드는 전부 폐기**된다.
 * @returns 평문 코드 배열 — **이때만** 볼 수 있다.
 */
export async function issueRecoveryCodes(userId: string, now = Date.now()): Promise<string[]> {
  const db = getDbAdapter();
  // ⚠ 먼저 지운다 — 넣고 지우면 실패 시 두 벌이 남는다.
  await db.execute('DELETE FROM nf_recovery_codes WHERE user_id = ?', userId);
  const codes: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const code = generateCode();
    codes.push(code);
    await db.execute(
      'INSERT INTO nf_recovery_codes (id, user_id, code_hash, used_at, created_at) VALUES (?, ?, ?, NULL, ?)',
      `rc-${crypto.randomUUID()}`, userId, hashCode(code), now,
    );
  }
  return codes;
}

/** 남은(미사용) 코드 수. 화면에서 「N개 남음」을 보여 주는 데 쓴다. */
export async function remainingRecoveryCodes(userId: string): Promise<number> {
  const db = getDbAdapter();
  const row = await db.queryOne<{ c: number }>(
    'SELECT COUNT(*) AS c FROM nf_recovery_codes WHERE user_id = ? AND used_at IS NULL', userId,
  );
  return Number(row?.c ?? 0);
}

/**
 * 코드를 **소비**한다(맞으면 즉시 사용 처리).
 * @returns 성공 여부와 남은 개수
 *
 * ⚠ 맞았는데 소비하지 않으면 **재사용 가능한 비밀번호**가 된다.
 */
export async function consumeRecoveryCode(
  userId: string, input: string, now = Date.now(),
): Promise<{ ok: boolean; remaining: number }> {
  const db = getDbAdapter();
  const code = normalizeCode(input);
  if (!/^[A-Z0-9]{8}$/.test(code)) return { ok: false, remaining: await remainingRecoveryCodes(userId) };

  const target = hashCode(code);
  const rows = await db.queryAll<{ id: string; code_hash: string }>(
    'SELECT id, code_hash FROM nf_recovery_codes WHERE user_id = ? AND used_at IS NULL', userId,
  );
  // 상수 시간 비교로 하나씩 확인한다(개수가 10이라 전수 비교가 부담이 아니다).
  const hit = rows.find((r) => safeEqualHex(target, String(r.code_hash)));
  if (!hit) return { ok: false, remaining: rows.length };

  await db.execute('UPDATE nf_recovery_codes SET used_at = ? WHERE id = ?', now, hit.id);
  return { ok: true, remaining: rows.length - 1 };
}
