/**
 * admin-elev-token.ts — **상승을 미들웨어에서도 확인할 수 있게 한다** (260802).
 *
 * ## 왜 토큰이 또 필요한가
 * 상승의 **진실은 DB**(`nf_admin_elevation`)다 — 폐기할 수 있어야 하기 때문이다.
 * 그런데 관리자 API 가 62개고 검사가 파일마다 흩어져 있어, 한 곳(미들웨어)에서
 * 막지 않으면 **새로 만든 라우트가 조용히 빠진다.** 미들웨어는 Edge 런타임이라
 * DB 를 못 쓴다. 그래서 **서명된 짧은 토큰**을 쿠키로 함께 발급한다.
 *
 * ## 두 겹으로 본다 — 어느 쪽도 혼자서는 부족하다
 *  · 미들웨어(이 토큰): **모든 관리자 경로**를 덮는다. 빠뜨릴 수 없다.
 *  · 라우트 가드(DB): **폐기 가능**하다. 토큰이 아직 안 만료돼도 DB 에서 지우면 막힌다.
 *
 * ## ⚠ 토큰은 액세스 토큰에 묶는다
 * 페이로드에 `ath = sha256(accessToken)` 을 넣고, 검증할 때 **현재 쿠키의 해시와 대조**한다.
 * 그래서 상승 쿠키만 훔쳐도 쓸 수 없고, 로그아웃·재로그인하면 자동으로 무효가 된다.
 *
 * ## ⚠ Node 전용 API 를 쓰지 않는다
 * `node:crypto` 를 쓰면 미들웨어에서 터진다. Web Crypto(`globalThis.crypto.subtle`)만 쓴다 —
 * 서버 라우트와 미들웨어가 **같은 코드**로 검증해야 둘이 갈리지 않는다.
 */

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

/** `sha256(hex)` — 미들웨어와 라우트가 **같은 함수**로 계산해야 대조가 성립한다. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const ELEV_COOKIE = 'nf_admin_elev';

export interface ElevPayload {
  /** 사용자 id */ sub: string;
  /** `sha256(accessToken)` — 이 상승이 묶인 세션 */ ath: string;
  /** 만료 (epoch ms) */ exp: number;
}

/** 상승 토큰 발급. **비밀이 없으면 만들지 않는다** — 서명 없는 토큰은 토큰이 아니다. */
export async function mintElevToken(payload: ElevPayload, secret: string | undefined): Promise<string> {
  if (!secret) throw new Error('[admin-elev-token] JWT_SECRET 이 없다 — 서명할 수 없다');
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(secret, body));
  return `${body}.${sig}`;
}

/**
 * 검증. 실패 사유를 구별해 돌려준다 — 로그에서 「왜 막혔나」를 알 수 있어야 한다.
 *
 * ⚠ 서명 비교는 **길이가 달라도 일찍 끝나지 않게** 전 바이트를 훑는다.
 */
export async function verifyElevToken(
  token: string | undefined | null,
  secret: string | undefined,
  now = Date.now(),
): Promise<{ ok: true; payload: ElevPayload } | { ok: false; reason: 'missing' | 'malformed' | 'bad_sig' | 'expired' | 'no_secret' }> {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!token) return { ok: false, reason: 'missing' };
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: 'malformed' };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected: Uint8Array;
  try { expected = await hmac(secret, body); } catch { return { ok: false, reason: 'bad_sig' }; }
  let got: Uint8Array;
  try { got = b64urlDecode(sig); } catch { return { ok: false, reason: 'malformed' }; }
  // 상수 시간 비교 — 길이 차이도 결과에만 반영하고 루프를 줄이지 않는다.
  let diff = expected.length ^ got.length;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ (got[i] ?? 0);
  if (diff !== 0) return { ok: false, reason: 'bad_sig' };

  let payload: ElevPayload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as ElevPayload; }
  catch { return { ok: false, reason: 'malformed' }; }
  if (!payload?.sub || !payload?.ath || !(Number(payload.exp) > 0)) return { ok: false, reason: 'malformed' };
  if (Number(payload.exp) <= now) return { ok: false, reason: 'expired' };
  return { ok: true, payload };
}

/**
 * 상승 쿠키가 **현재 세션의 것**인가.
 * @param accessToken 현재 요청의 액세스 토큰
 * ⚠ `ath` 를 대조하지 않으면 상승 쿠키만 훔쳐도 관리자가 된다.
 */
export async function elevMatchesSession(payload: ElevPayload, accessToken: string | null | undefined): Promise<boolean> {
  if (!accessToken) return false;
  return payload.ath === (await sha256Hex(accessToken));
}
