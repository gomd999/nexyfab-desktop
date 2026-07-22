// ─── NexyFab API Key 생성·해시 (순수 함수) ────────────────────────────────────
// 정직/보안 원칙:
//   - 평문 키는 발급 순간 1회만 노출하고 절대 저장하지 않는다.
//   - DB 에는 sha256 해시(key_hash) + 표시용 짧은 접두(key_prefix)만 저장한다.
//   - 인증은 요청 키를 동일하게 해시해 key_hash 와 대조한다(auth-middleware.ts).
// 이 모듈은 DB·요청 의존성이 없어 단위 테스트가 쉽다.
import { randomBytes, createHash } from 'crypto';

/** 공개 접두 — 모든 라이브 키는 이 문자열로 시작한다. */
export const API_KEY_PREFIX = 'nf_live_';

/** 표시용 접두 길이("nf_live_" + 8 hex = 16자). 목록/UI 에서 키 식별에만 사용. */
export const API_KEY_DISPLAY_PREFIX_LEN = 16;

/** 요청 평문 키 → 저장/대조용 sha256 hex 해시. */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export interface GeneratedApiKey {
  /** 평문 키(nf_live_…) — 호출자에게 1회만 반환, 저장 금지. */
  raw: string;
  /** DB 저장용 sha256 해시. */
  hash: string;
  /** 표시용 접두(예: nf_live_1a2b3c4d). */
  prefix: string;
}

/**
 * 암호학적 난수로 새 API 키를 만든다.
 * raw = nf_live_<32 random bytes hex>. hash 와 prefix 만 DB 에 저장한다.
 */
export function generateApiKey(): GeneratedApiKey {
  const raw = `${API_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
  return {
    raw,
    hash: hashApiKey(raw),
    prefix: raw.slice(0, API_KEY_DISPLAY_PREFIX_LEN),
  };
}

/** 문자열이 라이브 API 키 형태인지(형식 검사만; 유효성은 DB 대조). */
export function looksLikeApiKey(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith(API_KEY_PREFIX) && token.length >= 24;
}
