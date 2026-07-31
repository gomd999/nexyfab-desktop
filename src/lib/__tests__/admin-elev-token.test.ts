/**
 * admin-elev-token.test.ts — **미들웨어 초크포인트가 실제로 막는가** (260802).
 *
 * ## 배경
 * 관리자 API 62개의 권한 검사가 파일마다 흩어져 있어(로컬 requireAdmin 5벌 + 인라인 16곳),
 * step-up 을 62곳에 붙이면 **반드시 빠뜨리고 새 라우트는 더 확실히 빠진다.**
 * 그래서 미들웨어를 초크포인트로 둔다. 다만 Edge 라 DB 를 못 읽으므로 **서명 토큰**을 쓴다.
 *
 * DB 레코드(폐기 가능)와 서명 쿠키(전 경로 커버)는 **둘 다** 필요하다 —
 * 쿠키만이면 폐기가 안 되고, DB만이면 라우트마다 붙여야 한다.
 *
 * ## 이 테스트가 잡는 것
 * 서명이 없거나 틀렸는데 통과하면 **초크포인트가 장식**이 된다. 그 경우들을 전부 세운다.
 */
import { describe, expect, it } from 'vitest';
import {
  mintElevToken, verifyElevToken, elevMatchesSession, sha256Hex, ELEV_COOKIE,
} from '../admin-elev-token';

const SECRET = 'test-secret-0123456789';
const payload = (over: Partial<{ sub: string; ath: string; exp: number }> = {}) => ({
  sub: 'u1', ath: 'a'.repeat(64), exp: Date.now() + 60_000, ...over,
});

describe('상승 토큰 — 서명', () => {
  it('정상 토큰은 검증을 통과하고 페이로드를 돌려준다', async () => {
    const t = await mintElevToken(payload(), SECRET);
    const v = await verifyElevToken(t, SECRET);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.payload.sub).toBe('u1');
  });

  it('★비밀이 다르면 통과하지 못한다 — 서명이 실제로 검사된다', async () => {
    const t = await mintElevToken(payload(), SECRET);
    const v = await verifyElevToken(t, 'another-secret');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('bad_sig');
  });

  it('★페이로드를 고치면 통과하지 못한다 — 만료를 늘려 붙일 수 없다', async () => {
    const t = await mintElevToken(payload({ exp: Date.now() + 1000 }), SECRET);
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify(payload({ exp: Date.now() + 99_999_999 })))
      .toString('base64url');
    const v = await verifyElevToken(`${forged}.${sig}`, SECRET);
    expect(v.ok).toBe(false);
    expect(body).not.toBe(forged);
  });

  it('★서명을 떼면 통과하지 못한다 — 「없으면 통과」가 아니다', async () => {
    const t = await mintElevToken(payload(), SECRET);
    const body = t.split('.')[0];
    for (const bad of [body, `${body}.`, '', 'garbage']) {
      const v = await verifyElevToken(bad, SECRET);
      expect(v.ok, `"${bad.slice(0, 12)}" 가 통과했다`).toBe(false);
    }
  });

  it('쿠키가 아예 없으면 `missing` — 사유가 구별돼야 로그에서 원인을 안다', async () => {
    const v = await verifyElevToken(undefined, SECRET);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('missing');
  });

  it('★서버 비밀이 없으면 **통과시키지 않는다** — 검증 불가를 통과로 읽으면 전부 열린다', async () => {
    const t = await mintElevToken(payload(), SECRET);
    const v = await verifyElevToken(t, undefined);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('no_secret');
  });

  it('비밀 없이는 발급도 하지 않는다 — 서명 없는 토큰은 토큰이 아니다', async () => {
    await expect(mintElevToken(payload(), undefined)).rejects.toThrow(/JWT_SECRET/);
  });

  it('만료된 토큰은 통과하지 못한다', async () => {
    const t = await mintElevToken(payload({ exp: 1_000 }), SECRET);
    const v = await verifyElevToken(t, SECRET, 2_000);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe('expired');
  });
});

describe('상승 토큰 — 세션 결속', () => {
  it('★현재 액세스 토큰과 묶인다 — 상승 쿠키만 훔쳐도 쓸 수 없다', async () => {
    const access = 'access-token-abc';
    const p = payload({ ath: await sha256Hex(access) });
    expect(await elevMatchesSession(p, access)).toBe(true);
    expect(await elevMatchesSession(p, 'different-access-token')).toBe(false);
  });

  it('액세스 토큰이 없으면 결속이 성립하지 않는다', async () => {
    const p = payload({ ath: await sha256Hex('x') });
    expect(await elevMatchesSession(p, null)).toBe(false);
    expect(await elevMatchesSession(p, '')).toBe(false);
  });

  it('토큰 원문이 페이로드에 들어가지 않는다 — 쿠키가 새도 세션을 훔칠 수 없다', async () => {
    const access = 'super-secret-access';
    const t = await mintElevToken(payload({ ath: await sha256Hex(access) }), SECRET);
    expect(t).not.toContain(access);
    expect(Buffer.from(t.split('.')[0], 'base64url').toString()).not.toContain(access);
  });
});

describe('Edge 호환', () => {
  it('★Node 전용 API 를 쓰지 않는다 — 미들웨어에서 터지면 전 관리자 경로가 500 이 된다', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('../admin-elev-token.ts', import.meta.url), 'utf8'));
    expect(src, "node:crypto 를 쓰면 Edge 미들웨어에서 못 쓴다").not.toContain("from 'node:crypto'");
    expect(src).toContain('crypto.subtle');
  });

  it('쿠키 이름이 고정돼 있다 — 발급·검증이 다른 이름을 쓰면 조용히 안 맞는다', () => {
    expect(ELEV_COOKIE).toBe('nf_admin_elev');
  });
});
