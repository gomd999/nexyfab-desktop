/**
 * recovery-codes.test.ts — **2FA 를 켜도 계정을 잃지 않는다** (260802).
 *
 * ## 왜 만들었나
 * TOTP 2FA 는 있는데 복구 수단이 없었다 — **휴대폰을 잃으면 계정에 영영 못 들어간다.**
 * 되돌릴 수 없는 잠김을 만드는 기능은 권장할 수 없다.
 *
 * 여기서 잡는 것은 「동작하나」가 아니라 **틀리면 계정이 열리거나 잠기는 것**이다.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

type Row = { id: string; user_id: string; code_hash: string; used_at: number | null };
let rows: Row[] = [];

vi.mock('../db-adapter', () => ({
  getDbAdapter: () => ({
    async execute(sql: string, ...args: unknown[]) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('DELETE FROM nf_recovery_codes')) rows = rows.filter((r) => r.user_id !== args[0]);
      else if (s.startsWith('INSERT INTO nf_recovery_codes')) {
        rows.push({ id: String(args[0]), user_id: String(args[1]), code_hash: String(args[2]), used_at: null });
      } else if (s.startsWith('UPDATE nf_recovery_codes SET used_at')) {
        const r = rows.find((x) => x.id === args[1]);
        if (r) r.used_at = Number(args[0]);
      }
    },
    async queryOne<T>(sql: string, ...args: unknown[]): Promise<T | null> {
      if (sql.includes('COUNT(*)')) {
        return { c: rows.filter((r) => r.user_id === args[0] && r.used_at == null).length } as T;
      }
      return null;
    },
    async queryAll<T>(sql: string, ...args: unknown[]): Promise<T[]> {
      if (sql.includes('nf_recovery_codes')) {
        return rows.filter((r) => r.user_id === args[0] && r.used_at == null) as unknown as T[];
      }
      return [];
    },
  }),
}));

const m = await import('../recovery-codes');

beforeEach(() => { rows = []; process.env.JWT_SECRET = 'test-secret-aaaa'; });

describe('발급', () => {
  it('정해진 개수를 발급하고 **평문은 저장하지 않는다**', async () => {
    const codes = await m.issueRecoveryCodes('u1');
    expect(codes).toHaveLength(m.RECOVERY_CODE_COUNT);
    const dump = JSON.stringify(rows);
    for (const c of codes) expect(dump, '평문이 DB 에 남았다').not.toContain(c.replace('-', ''));
  });

  it('★서버 비밀 없이는 해시를 재현할 수 없다 — 코드 공간이 작아 단순 해시는 곧 풀린다', async () => {
    const codes = await m.issueRecoveryCodes('u1');
    const stored = rows[0].code_hash;
    const same = m.hashCode(codes[0]);
    process.env.JWT_SECRET = 'other-secret';
    expect(m.hashCode(codes[0]), '비밀을 바꿨는데 같은 해시가 나온다').not.toBe(same);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('비밀이 없으면 **약한 해시로 내려가지 않고 던진다**', () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => m.hashCode('ABCD-EFGH')).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = saved;
  });

  it('★재발급하면 기존 코드가 전부 무효 — 두 벌이 살아 있으면 어느 것이 유효한지 모른다', async () => {
    const first = await m.issueRecoveryCodes('u1');
    await m.issueRecoveryCodes('u1');
    const r = await m.consumeRecoveryCode('u1', first[0]);
    expect(r.ok, '이전 세트가 아직 통한다').toBe(false);
  });

  it('★혼동 문자(0/O/1/I/L)를 쓰지 않는다 — 손으로 적는 값이라 오독이 곧 잠김이다', () => {
    const joined = Array.from({ length: 200 }, () => m.generateCode()).join('');
    for (const ch of ['0', 'O', '1', 'I', 'L']) {
      expect(joined, `혼동 문자 ${ch} 가 들어갔다`).not.toContain(ch);
    }
  });
});

describe('소비', () => {
  it('맞는 코드는 통과하고 **즉시 소비**된다 — 재사용되면 비밀번호가 된다', async () => {
    const codes = await m.issueRecoveryCodes('u1');
    expect((await m.consumeRecoveryCode('u1', codes[0])).ok).toBe(true);
    expect((await m.consumeRecoveryCode('u1', codes[0])).ok, '같은 코드가 두 번 통했다').toBe(false);
  });

  it('공백·하이픈·소문자를 정규화한다 — 사용자는 그대로 옮겨 적지 않는다', async () => {
    const codes = await m.issueRecoveryCodes('u1');
    const messy = codes[0].toLowerCase().replace('-', ' ');
    expect((await m.consumeRecoveryCode('u1', messy)).ok).toBe(true);
  });

  it('★다른 사용자의 코드로는 통과하지 못한다', async () => {
    const codes = await m.issueRecoveryCodes('u1');
    await m.issueRecoveryCodes('u2');
    expect((await m.consumeRecoveryCode('u2', codes[0])).ok).toBe(false);
  });

  it('형식이 틀리면 조회 없이 거부한다', async () => {
    await m.issueRecoveryCodes('u1');
    expect((await m.consumeRecoveryCode('u1', 'short')).ok).toBe(false);
  });

  it('남은 개수를 알려 준다 — 소진되기 전에 재발급하도록', async () => {
    const codes = await m.issueRecoveryCodes('u1');
    const r = await m.consumeRecoveryCode('u1', codes[0]);
    expect(r.remaining).toBe(m.RECOVERY_CODE_COUNT - 1);
    expect(await m.remainingRecoveryCodes('u1')).toBe(m.RECOVERY_CODE_COUNT - 1);
  });
});
