/**
 * 코호트 프로비저닝 — **남의 비밀번호를 덮어쓰지 않는가** (260801).
 *
 * 이 라우트는 운영 계정을 직접 건드린다. 그래서 검사의 중심은 기능이 아니라 **안 하는 것**이다:
 *   · 기존 계정의 비밀번호를 어떤 경우에도 쓰지 않는다
 *   · 로그인을 막는 `subscription_ends_at` 을 건드리지 않는다
 *   · 과거 만료를 조용히 받아들이지 않는다(부여 즉시 강등)
 *   · 「대조 못 함」을 「맞음」으로 세지 않는다
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/admin-auth', () => ({ verifyAdmin: vi.fn() }));
vi.mock('@/lib/db-adapter', () => ({ getDbAdapter: vi.fn() }));

import { verifyAdmin } from '@/lib/admin-auth';
import { getDbAdapter } from '@/lib/db-adapter';
import bcrypt from 'bcryptjs';

let POST: typeof import('../route').POST;

/** 실행된 SQL 을 전부 모아 두고, **무엇을 안 했는지**까지 검사할 수 있게 한다. */
function fakeDb(existing: Record<string, { id: string; plan: string | null; password_hash: string | null; plan_expires_at: number | null }>) {
  const sql: Array<{ q: string; args: unknown[] }> = [];
  const db = {
    queryOne: vi.fn(async (_q: string, email: string) => existing[email] ?? null),
    queryAll: vi.fn(async () => []),
    execute: vi.fn(async (q: string, ...args: unknown[]) => { sql.push({ q, args }); return { changes: 1 }; }),
  };
  vi.mocked(getDbAdapter).mockReturnValue(db as unknown as ReturnType<typeof getDbAdapter>);
  return { db, sql };
}

const FUTURE = '2099-09-10T00:00:00Z';
const req = (body: unknown) =>
  new Request('http://test/api/admin/cohort/provision', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as Parameters<typeof POST>[0];

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  vi.mocked(verifyAdmin).mockResolvedValue(true);
  ({ POST } = await import('../route'));
});

describe('접근 통제', () => {
  it('관리자가 아니면 403', async () => {
    vi.mocked(verifyAdmin).mockResolvedValue(false);
    fakeDb({});
    expect((await POST(req({ members: [{ email: 'a@b.c', expiresAt: FUTURE }] }))).status).toBe(403);
  });
});

describe('★기존 계정의 비밀번호를 건드리지 않는다', () => {
  it('★명단 비번이 실제와 달라도 덮어쓰지 않고, 다르다고 알려 준다', async () => {
    const hash = await bcrypt.hash('진짜비밀번호', 4);
    const { sql } = fakeDb({ 'a@b.c': { id: 'u1', plan: 'free', password_hash: hash, plan_expires_at: null } });
    const res = await POST(req({ members: [{ email: 'a@b.c', password: '1234', expiresAt: FUTURE }] }));
    const j = await res.json();
    expect(j.rows[0].password).toBe('untouched');
    expect(j.rows[0].listedPasswordMatches).toBe(false);
    expect(j.summary.passwordMismatch).toBe(1);
    // 어떤 UPDATE 도 password_hash 를 건드리지 않았는지 — 문구가 아니라 실제 SQL 로 확인한다
    expect(sql.some(s => /password_hash/i.test(s.q))).toBe(false);
  });

  it('★명단 비번이 실제와 같아도 쓰지 않는다 — 무의미한 쓰기는 하지 않는다', async () => {
    const hash = await bcrypt.hash('1234', 4);
    const { sql } = fakeDb({ 'a@b.c': { id: 'u1', plan: 'free', password_hash: hash, plan_expires_at: null } });
    const j = await (await POST(req({ members: [{ email: 'a@b.c', password: '1234', expiresAt: FUTURE }] }))).json();
    expect(j.rows[0].listedPasswordMatches).toBe(true);
    expect(j.rows[0].password).toBe('untouched');
    expect(sql.some(s => /password_hash/i.test(s.q))).toBe(false);
  });

  it('★해시가 없으면(OAuth 전용) 대조 불가로 남긴다 — 맞았다고 하지 않는다', async () => {
    fakeDb({ 'a@b.c': { id: 'u1', plan: 'free', password_hash: null, plan_expires_at: null } });
    const j = await (await POST(req({ members: [{ email: 'a@b.c', password: '1234', expiresAt: FUTURE }] }))).json();
    expect(j.rows[0].listedPasswordMatches).toBeNull();
    expect(j.summary.passwordUnverified).toBe(1);
    expect(j.summary.passwordMismatch).toBe(0);   // 대조 불가는 불일치가 아니다
  });
});

describe('★로그인을 막는 컬럼을 건드리지 않는다', () => {
  it('★subscription_ends_at 은 어떤 경로로도 쓰이지 않는다 — 만료는 강등이지 잠금이 아니다', async () => {
    const { sql } = fakeDb({ 'a@b.c': { id: 'u1', plan: 'free', password_hash: null, plan_expires_at: null } });
    await POST(req({ members: [{ email: 'a@b.c', expiresAt: FUTURE }, { email: 'new@b.c', password: 'x', expiresAt: FUTURE }] }));
    expect(sql.some(s => /subscription_ends_at/i.test(s.q))).toBe(false);
    expect(sql.length).toBeGreaterThan(0);   // 전제: 뭔가는 실행됐다(공허한 통과 방지)
  });
});

describe('기간 부여', () => {
  it('기존 회원은 plan 과 plan_expires_at 을 함께 갱신한다', async () => {
    const { sql } = fakeDb({ 'a@b.c': { id: 'u1', plan: 'free', password_hash: null, plan_expires_at: null } });
    const j = await (await POST(req({ members: [{ email: 'a@b.c', expiresAt: FUTURE }] }))).json();
    expect(j.rows[0].action).toBe('updated');
    expect(j.rows[0].planBefore).toBe('free');
    expect(j.rows[0].planAfter).toBe('pro');
    const upd = sql.find(s => /UPDATE nf_users/i.test(s.q))!;
    expect(upd.q).toMatch(/plan_expires_at/);
    expect(upd.q).toMatch(/plan_fallback/);
    expect(upd.args).toContain(Date.parse(FUTURE));
  });

  it('없는 계정은 만들고 비밀번호를 설정한다', async () => {
    const { sql } = fakeDb({});
    const j = await (await POST(req({ members: [{ email: 'new@b.c', password: '1234', expiresAt: FUTURE }] }))).json();
    expect(j.rows[0].action).toBe('created');
    expect(j.rows[0].password).toBe('set');
    expect(sql.some(s => /INSERT INTO nf_users/i.test(s.q))).toBe(true);
  });

  it('★신규인데 비밀번호가 없으면 만들지 않는다 — 로그인 못 하는 계정을 남기지 않는다', async () => {
    const { sql } = fakeDb({});
    const j = await (await POST(req({ members: [{ email: 'new@b.c', expiresAt: FUTURE }] }))).json();
    expect(j.rows[0].action).toBe('error');
    expect(sql.some(s => /INSERT/i.test(s.q))).toBe(false);
  });

  it('★이미 같은 상태면 unchanged — 쓰지 않는다', async () => {
    const { sql } = fakeDb({ 'a@b.c': { id: 'u1', plan: 'pro', password_hash: null, plan_expires_at: Date.parse(FUTURE) } });
    const j = await (await POST(req({ members: [{ email: 'a@b.c', expiresAt: FUTURE }] }))).json();
    expect(j.rows[0].action).toBe('unchanged');
    expect(sql.length).toBe(0);
  });
});

describe('★잘못된 입력을 조용히 받아들이지 않는다', () => {
  it('★과거 만료는 거부 — 부여하자마자 강등되는 것을 실수와 구별할 수 없다', async () => {
    const { sql } = fakeDb({ 'a@b.c': { id: 'u1', plan: 'free', password_hash: null, plan_expires_at: null } });
    const j = await (await POST(req({ members: [{ email: 'a@b.c', expiresAt: '2020-01-01T00:00:00Z' }] }))).json();
    expect(j.rows[0].action).toBe('error');
    expect(j.rows[0].note).toContain('과거');
    expect(sql.length).toBe(0);
  });

  it('읽을 수 없는 날짜를 오늘로 때우지 않는다', async () => {
    fakeDb({});
    const j = await (await POST(req({ members: [{ email: 'a@b.c', password: 'x', expiresAt: '언젠가' }] }))).json();
    expect(j.rows[0].action).toBe('error');
    expect(j.rows[0].expiresAfter).toBeNull();
  });

  it('한 건이 실패해도 나머지는 처리하고, ok=false 로 알린다', async () => {
    fakeDb({ 'good@b.c': { id: 'u1', plan: 'free', password_hash: null, plan_expires_at: null } });
    const j = await (await POST(req({ members: [
      { email: 'bad-email', expiresAt: FUTURE },
      { email: 'good@b.c', expiresAt: FUTURE },
    ] }))).json();
    expect(j.ok).toBe(false);
    expect(j.summary.errors).toBe(1);
    expect(j.summary.updated).toBe(1);
  });

  it('허용되지 않은 플랜을 거부한다', async () => {
    fakeDb({});
    expect((await POST(req({ members: [{ email: 'a@b.c', expiresAt: FUTURE }], plan: 'god' }))).status).toBe(400);
  });
});

describe('★dryRun 은 정말 아무것도 쓰지 않는다', () => {
  it('★계획만 돌려주고 SQL 은 실행하지 않는다', async () => {
    const { sql } = fakeDb({ 'a@b.c': { id: 'u1', plan: 'free', password_hash: null, plan_expires_at: null } });
    const j = await (await POST(req({ dryRun: true, members: [
      { email: 'a@b.c', expiresAt: FUTURE },
      { email: 'new@b.c', password: '1234', expiresAt: FUTURE },
    ] }))).json();
    expect(sql.length).toBe(0);
    expect(j.dryRun).toBe(true);
    expect(j.summary.updated).toBe(1);
    expect(j.summary.created).toBe(1);
  });
});
