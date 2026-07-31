/**
 * admin-elevation.test.ts — **관리자 step-up 인증** (260802).
 *
 * ## 무엇을 지키나
 * nexyfab 관리자 API 63개는 계정 역할(`super_admin`)로 막혀 있지만 2FA 가 **선택**이라,
 * 관리자가 안 켜 두면 **비밀번호 하나로 관리자 콘솔이 열린다.**
 * 이메일 OTP 를 step-up 으로 두어 그 경로를 막는다.
 *
 * 이 테스트가 잡는 것은 「동작하나」가 아니라 **「틀리면 위험한 것들」**이다:
 *  · 코드가 평문으로 저장되지 않는가
 *  · 서버 비밀 없이 해시를 재현할 수 있는가(있으면 DB 유출 = 관리자 탈취)
 *  · 시도 상한이 실제로 막는가
 *  · 상승이 **다른 토큰·다른 계정**으로 새지 않는가
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';

/** 인메모리 DB 대역 — 실제 어댑터를 쓰면 테스트가 스키마 마이그레이션에 묶인다. */
type Row = Record<string, unknown>;
const tables: { otp: Row[]; elev: Row[] } = { otp: [], elev: [] };

vi.mock('../db-adapter', () => ({
  getDbAdapter: () => ({
    async execute(sql: string, ...args: unknown[]) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('DELETE FROM nf_admin_otp WHERE user_id')) {
        tables.otp = tables.otp.filter((r) => r.user_id !== args[0]);
      } else if (s.startsWith('DELETE FROM nf_admin_otp WHERE expires_at')) {
        tables.otp = tables.otp.filter((r) => Number(r.expires_at) > Number(args[0]));
      } else if (s.startsWith('INSERT INTO nf_admin_otp')) {
        tables.otp.push({ user_id: args[0], code_hash: args[1], expires_at: args[2], attempts: 0, created_at: args[3] });
      } else if (s.startsWith('UPDATE nf_admin_otp SET attempts')) {
        for (const r of tables.otp) if (r.user_id === args[0]) r.attempts = Number(r.attempts) + 1;
      } else if (s.startsWith('DELETE FROM nf_admin_elevation WHERE access_hash')) {
        tables.elev = tables.elev.filter((r) => r.access_hash !== args[0]);
      } else if (s.startsWith('DELETE FROM nf_admin_elevation WHERE expires_at')) {
        tables.elev = tables.elev.filter((r) => Number(r.expires_at) > Number(args[0]));
      } else if (s.startsWith('INSERT INTO nf_admin_elevation')) {
        tables.elev.push({ access_hash: args[0], user_id: args[1], expires_at: args[2], created_at: args[3] });
      }
    },
    async queryOne<T>(sql: string, ...args: unknown[]): Promise<T | null> {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.includes('FROM nf_admin_otp')) return (tables.otp.find((r) => r.user_id === args[0]) ?? null) as T | null;
      if (s.includes('FROM nf_admin_elevation')) return (tables.elev.find((r) => r.access_hash === args[0]) ?? null) as T | null;
      return null;
    },
    async queryAll() { return []; },
  }),
}));

const load = async () => await import('../admin-elevation');

describe('관리자 OTP — 저장 방식', () => {
  beforeEach(() => { tables.otp = []; tables.elev = []; process.env.JWT_SECRET = 'test-secret-aaaa'; });

  it('★코드를 평문으로 저장하지 않는다 — DB 가 새면 그 순간 관리자가 된다', async () => {
    const m = await load();
    const { code } = await m.issueOtp('u1');
    expect(tables.otp).toHaveLength(1);
    const stored = String(tables.otp[0].code_hash);
    expect(stored).not.toBe(code);
    expect(stored).not.toContain(code);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('★서버 비밀이 없으면 해시를 재현할 수 없다 — 6자리 단순 해시는 오프라인에서 몇 초다', async () => {
    const m = await load();
    const { code } = await m.issueOtp('u1');
    const withSecret = String(tables.otp[0].code_hash);
    process.env.JWT_SECRET = 'different-secret';
    expect(m.hashOtp(code), '비밀을 바꿨는데 같은 해시가 나온다 — 비밀이 안 섞이고 있다').not.toBe(withSecret);
  });

  it('비밀이 아예 없으면 **약한 해시로 내려가지 않고 던진다**', async () => {
    const m = await load();
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => m.hashOtp('123456')).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = saved;
  });

  it('코드는 6자리이고 예측 가능한 난수를 쓰지 않는다', async () => {
    const m = await load();
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(m.generateOtp());
    for (const c of seen) expect(c).toMatch(/^\d{6}$/);
    // 200회에 중복이 거의 없어야 한다(10^6 공간). 상수를 반환하면 여기서 걸린다.
    expect(seen.size).toBeGreaterThan(190);
  });
});

describe('검증과 상승', () => {
  beforeEach(() => { tables.otp = []; tables.elev = []; process.env.JWT_SECRET = 'test-secret-aaaa'; });

  it('맞는 코드는 상승을 준다', async () => {
    const m = await load();
    const { code } = await m.issueOtp('u1');
    const r = await m.verifyOtpAndElevate('u1', 'tokenA', code);
    expect(r.ok).toBe(true);
    expect(await m.elevationRemainingMs('u1', 'tokenA')).toBeGreaterThan(0);
  });

  it('★코드는 **단회용**이다 — 같은 코드를 두 번 쓸 수 없다', async () => {
    const m = await load();
    const { code } = await m.issueOtp('u1');
    expect((await m.verifyOtpAndElevate('u1', 'tokenA', code)).ok).toBe(true);
    const again = await m.verifyOtpAndElevate('u1', 'tokenB', code);
    expect(again.ok).toBe(false);
  });

  it('★시도 상한이 실제로 막는다 — 무제한이면 6자리는 곧 뚫린다', async () => {
    const m = await load();
    await m.issueOtp('u1');
    for (let i = 0; i < m.MAX_OTP_ATTEMPTS; i++) {
      const r = await m.verifyOtpAndElevate('u1', 'tokenA', '000000');
      expect(r.ok).toBe(false);
    }
    // 상한을 넘기면 코드 자체가 폐기된다.
    const after = await m.verifyOtpAndElevate('u1', 'tokenA', '000000');
    expect(after.ok).toBe(false);
    expect(tables.otp, '상한을 넘겼는데 코드가 살아 있다').toHaveLength(0);
  });

  it('만료된 코드는 통하지 않는다', async () => {
    const m = await load();
    const { code } = await m.issueOtp('u1', 1_000);
    const r = await m.verifyOtpAndElevate('u1', 'tokenA', code, 1_000 + m.OTP_TTL_MS + 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expired');
  });

  it('★상승은 **그 토큰에만** 붙는다 — 다른 토큰으로 새지 않는다', async () => {
    const m = await load();
    const { code } = await m.issueOtp('u1');
    await m.verifyOtpAndElevate('u1', 'tokenA', code);
    expect(await m.elevationRemainingMs('u1', 'tokenB'), '다른 토큰이 상승을 물려받았다').toBeNull();
  });

  it('★상승은 **그 계정에만** 붙는다 — 토큰만 맞으면 되게 두면 계정이 바뀌어도 남는다', async () => {
    const m = await load();
    const { code } = await m.issueOtp('u1');
    await m.verifyOtpAndElevate('u1', 'tokenA', code);
    expect(await m.elevationRemainingMs('u2', 'tokenA')).toBeNull();
  });

  it('★토큰 자체를 저장하지 않는다 — 상승 레코드가 새도 세션을 훔칠 수 없다', async () => {
    const m = await load();
    const { code } = await m.issueOtp('u1');
    await m.verifyOtpAndElevate('u1', 'super-secret-token', code);
    const dump = JSON.stringify(tables.elev);
    expect(dump).not.toContain('super-secret-token');
    expect(dump).toContain(m.accessKey('super-secret-token'));
  });

  it('상승도 만료된다 — 무기한이면 step-up 의 의미가 없다', async () => {
    const m = await load();
    const { code } = await m.issueOtp('u1', 1_000);
    await m.verifyOtpAndElevate('u1', 'tokenA', code, 1_000);
    expect(await m.elevationRemainingMs('u1', 'tokenA', 1_000 + m.ELEVATION_TTL_MS + 1)).toBeNull();
  });

  it('코드를 받지 않고 검증하면 사유가 `no_code` 다 — 「틀렸다」와 구별해야 화면이 옳게 안내한다', async () => {
    const m = await load();
    const r = await m.verifyOtpAndElevate('u1', 'tokenA', '123456');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_code');
  });
});

describe('강제 스위치', () => {
  it('기본은 **켜짐** — 끄려면 인프라에서 명시적으로 꺼야 한다', async () => {
    const m = await load();
    const saved = process.env.ADMIN_OTP_REQUIRED;
    delete process.env.ADMIN_OTP_REQUIRED;
    expect(m.isAdminOtpRequired()).toBe(true);
    process.env.ADMIN_OTP_REQUIRED = 'false';
    expect(m.isAdminOtpRequired()).toBe(false);
    // ⚠ 오타로 꺼지지 않는다 — 'no'·'0' 따위는 여전히 켜진 상태다.
    process.env.ADMIN_OTP_REQUIRED = '0';
    expect(m.isAdminOtpRequired()).toBe(true);
    if (saved === undefined) delete process.env.ADMIN_OTP_REQUIRED; else process.env.ADMIN_OTP_REQUIRED = saved;
  });
});
