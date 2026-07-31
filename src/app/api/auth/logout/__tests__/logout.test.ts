/**
 * logout.test.ts — **로그아웃은 끝났음을 보장한다** (260802).
 *
 * ## 무엇이 안 됐나 — 실측
 * ```
 * ① 라우트가 refreshToken 을 본문에서만 읽었다 — 그건 httpOnly 쿠키라 클라가 못 보낸다
 * ② 못 읽으면 **쿠키를 안 지우고** ok:true 를 줬다
 * ③ 유일한 호출부가 본문 없이 POST → req.json() 예외 → **500**, 쿠키 그대로
 * ④ 쿠키 삭제에 domain 을 안 줬다 — 로그인은 COOKIE_DOMAIN 으로 굽는다
 * ```
 * 결과: **로그아웃해도 로그인 상태**였고 30일 리프레시가 살아 있었다.
 *
 * 이 테스트는 「예쁘게 동작하나」가 아니라 **틀리면 로그인 상태로 남는 것**만 잡는다.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const execCalls: Array<{ sql: string; args: unknown[] }> = [];
let authUser: { userId: string } | null = { userId: 'u1' };

vi.mock('@/lib/db-adapter', () => ({
  getDbAdapter: () => ({
    async execute(sql: string, ...args: unknown[]) { execCalls.push({ sql: sql.replace(/\s+/g, ' ').trim(), args }); },
    async queryOne() { return null; },
    async queryAll() { return []; },
  }),
}));
vi.mock('@/lib/auth-middleware', () => ({ getAuthUser: async () => authUser }));
vi.mock('@/lib/audit', () => ({ logAudit: () => {} }));
vi.mock('@/lib/client-ip', () => ({ getTrustedClientIp: () => '203.0.113.1' }));

const { POST } = await import('../route');

/** 최소한의 NextRequest 대역 — 쿠키와 본문만 있으면 된다. */
function req(opts: { body?: string; cookies?: Record<string, string> } = {}) {
  const jar = opts.cookies ?? {};
  return {
    cookies: { get: (k: string) => (k in jar ? { value: jar[k] } : undefined) },
    headers: new Headers(),
    json: async () => {
      if (opts.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
      return JSON.parse(opts.body);
    },
  } as never;
}

const setCookieNames = (res: Response): string[] =>
  (res.headers.getSetCookie?.() ?? []).map((c) => c.split('=')[0]);

const clearedCookie = (res: Response, name: string): string | undefined =>
  (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith(`${name}=`));

describe('로그아웃 — 항상 쿠키를 지운다', () => {
  beforeEach(() => { execCalls.length = 0; authUser = { userId: 'u1' }; });

  it('★본문이 없어도 200 이고 쿠키를 지운다 — 종전엔 500 이었고 쿠키가 남았다', async () => {
    const res = await POST(req({ cookies: { nf_refresh_token: 'rt-abc' } }));
    expect(res.status).toBe(200);
    const names = setCookieNames(res);
    expect(names, 'access token 이 안 지워졌다').toContain('nf_access_token');
    expect(names, 'refresh token 이 안 지워졌다').toContain('nf_refresh_token');
  });

  it('★쿠키가 하나도 없어도 지우기를 시도한다 — 「지울 게 없다」로 넘기지 않는다', async () => {
    const res = await POST(req({ body: '{}' }));
    expect(res.status).toBe(200);
    expect(setCookieNames(res)).toContain('nf_access_token');
  });

  it('★삭제 쿠키는 만료돼 있다 — 값만 비우면 브라우저가 안 지운다', async () => {
    const res = await POST(req({ body: '{}' }));
    const c = clearedCookie(res, 'nf_access_token') ?? '';
    expect(c).toMatch(/Max-Age=0/i);
    expect(c).toMatch(/Expires=/i);
  });

  it('관리자 상승 쿠키도 함께 끊는다 — 세션이 끝났는데 상승만 남으면 안 된다', async () => {
    const res = await POST(req({ body: '{}' }));
    expect(setCookieNames(res)).toContain('nf_admin_elev');
  });
});

describe('리프레시 토큰 폐기', () => {
  beforeEach(() => { execCalls.length = 0; authUser = { userId: 'u1' }; });

  it('★쿠키의 리프레시 토큰을 폐기한다 — 본문만 보던 종전엔 영원히 못 찾았다', async () => {
    await POST(req({ cookies: { nf_refresh_token: 'rt-abc' } }));
    const revoke = execCalls.find((c) => c.sql.includes('nf_refresh_tokens') && c.sql.includes('token_hash'));
    expect(revoke, '토큰 해시로 폐기하지 않았다').toBeTruthy();
  });

  it('★토큰을 못 찾아도 **그 사용자의 활성 리프레시를 전부** 폐기한다', async () => {
    await POST(req({ body: '{}' }));
    const revokeAll = execCalls.find((c) => c.sql.includes('nf_refresh_tokens') && c.sql.includes('user_id'));
    expect(revokeAll, '쿠키만 지우고 30일 리프레시를 남겼다').toBeTruthy();
    expect(revokeAll?.args).toContain('u1');
  });

  it('로그인돼 있지 않으면 전체 폐기를 하지 않는다 — 남의 세션을 끊으면 안 된다', async () => {
    authUser = null;
    await POST(req({ body: '{}' }));
    expect(execCalls.filter((c) => c.sql.includes('nf_refresh_tokens'))).toHaveLength(0);
  });

  it('관리자 상승 레코드도 서버에서 지운다 — 쿠키만 지우면 DB 에 남는다', async () => {
    await POST(req({ body: '{}' }));
    expect(execCalls.some((c) => c.sql.includes('nf_admin_elevation'))).toBe(true);
  });
});

describe('정직 고지', () => {
  beforeEach(() => { execCalls.length = 0; authUser = { userId: 'u1' }; });

  it('★액세스 토큰이 즉시 폐기되지 않는다는 사실을 응답에 남긴다', async () => {
    const res = await POST(req({ body: '{}' }));
    const j = (await res.json()) as { accessTokenResidualSec?: number; note?: string };
    // stateless JWT 는 서버가 못 지운다 — 숨기면 「끊었다」고 오해한다.
    expect(j.accessTokenResidualSec).toBe(900);
    expect(j.note).toContain('15분');
  });
});
