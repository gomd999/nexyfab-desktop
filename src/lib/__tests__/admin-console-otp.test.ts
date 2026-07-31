/**
 * admin-console-otp.test.ts — **40페이지 콘솔이 비밀번호 하나로 열리던 것**을 막는다 (260802).
 *
 * ## 실측으로 드러난 것
 * ```
 * /admin/*                    40페이지  ← 공유 비밀번호 ADMIN_PASSWORD 하나
 * /[lang]/nexyfab/admin/*      5페이지  ← 계정 역할 + 이메일 OTP (먼저 붙였던 곳)
 * ```
 * 보안을 건 곳이 **작은 쪽**이었다. 실제 콘솔은 40페이지 쪽이다.
 *
 * ## 이 테스트가 잡는 것
 * 가장 위험한 것은 **설정이 없을 때 조용히 열리는 것**이다 —
 * 「2단계를 켰다」고 믿는 상태로 비밀번호 하나로 열려 있게 된다.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

type Row = { user_id: string; code_hash: string; expires_at: number; attempts: number };
let rows: Row[] = [];

vi.mock('../db-adapter', () => ({
  getDbAdapter: () => ({
    async execute(sql: string, ...args: unknown[]) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('DELETE FROM nf_admin_otp')) rows = rows.filter((r) => r.user_id !== args[0]);
      else if (s.startsWith('INSERT INTO nf_admin_otp')) {
        rows.push({ user_id: String(args[0]), code_hash: String(args[1]), expires_at: Number(args[2]), attempts: 0 });
      } else if (s.startsWith('UPDATE nf_admin_otp SET attempts')) {
        for (const r of rows) if (r.user_id === args[0]) r.attempts += 1;
      }
    },
    async queryOne<T>(_sql: string, ...args: unknown[]): Promise<T | null> {
      return (rows.find((r) => r.user_id === args[0]) ?? null) as T | null;
    },
    async queryAll() { return []; },
  }),
}));

const m = await import('../admin-console-otp');

const env = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };

beforeEach(() => {
  rows = [];
  process.env.JWT_SECRET = 'test-secret-aaaa';
  env('ADMIN_OTP_REQUIRED', undefined);
  env('OPS_ALERT_EMAIL', 'ops@example.com');
});

describe('★강제 여부를 정직하게 구별한다', () => {
  it('수신 주소가 있으면 enforced', () => {
    expect(m.consoleOtpMode()).toBe('enforced');
  });

  it('★수신 주소가 없으면 **unconfigured** — 「껐다」와 구별한다', () => {
    env('OPS_ALERT_EMAIL', undefined);
    // 「끄기」는 결정이고 「설정이 없어 못 함」은 사고다. 같은 값으로 뭉치면
    // 운영자는 2단계가 켜진 줄 안다.
    expect(m.consoleOtpMode()).toBe('unconfigured');
  });

  it('명시적으로 끄면 disabled_by_env', () => {
    env('ADMIN_OTP_REQUIRED', 'false');
    expect(m.consoleOtpMode()).toBe('disabled_by_env');
  });

  it('오타로 꺼지지 않는다 — `0`·`no` 는 여전히 강제', () => {
    for (const v of ['0', 'no', 'off', 'FALSE']) {
      env('ADMIN_OTP_REQUIRED', v);
      expect(m.consoleOtpMode(), `${v} 로 꺼졌다`).toBe('enforced');
    }
  });

  it('수신 주소를 쉼표로 여러 개 받는다', () => {
    env('OPS_ALERT_EMAIL', 'a@x.com, b@y.com ,');
    expect(m.opsRecipients()).toEqual(['a@x.com', 'b@y.com']);
  });
});

describe('코드', () => {
  it('★평문으로 저장하지 않는다', async () => {
    const { code } = await m.issueConsoleOtp();
    expect(rows[0].code_hash).not.toBe(code);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('★서버 비밀이 없으면 해시를 재현할 수 없다', async () => {
    const { code } = await m.issueConsoleOtp();
    const stored = rows[0].code_hash;
    process.env.JWT_SECRET = 'different';
    delete process.env.ADMIN_SESSION_SECRET;
    expect(m.hashOtp(code)).not.toBe(stored);
  });

  it('맞는 코드는 통과하고 **단회용**이다', async () => {
    const { code } = await m.issueConsoleOtp();
    expect((await m.verifyConsoleOtp(code)).ok).toBe(true);
    expect((await m.verifyConsoleOtp(code)).ok, '같은 코드가 두 번 통했다').toBe(false);
  });

  it('★시도 상한이 실제로 막는다 — 6자리는 무제한이면 곧 뚫린다', async () => {
    await m.issueConsoleOtp();
    for (let i = 0; i < m.CONSOLE_OTP_MAX_ATTEMPTS; i++) {
      expect((await m.verifyConsoleOtp('000000')).ok).toBe(false);
    }
    expect(rows, '상한을 넘겼는데 코드가 살아 있다').toHaveLength(0);
  });

  it('만료된 코드는 통하지 않는다', async () => {
    const { code } = await m.issueConsoleOtp(1_000);
    const r = await m.verifyConsoleOtp(code, 1_000 + m.CONSOLE_OTP_TTL_MS + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired');
  });

  it('발급 전에 검증하면 `no_code` — 「틀렸다」와 구별해야 화면이 옳게 안내한다', async () => {
    const r = await m.verifyConsoleOtp('123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_code');
  });
});
