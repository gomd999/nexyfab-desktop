/**
 * plan-expiry.test.ts — **관리자가 부여한 Pro 는 끝나야 한다** (260802).
 *
 * ## 무엇이 문제였나 — 실측
 * 관리자는 `PATCH /api/admin/users` 로 `plan` 을 바꿀 수 있었지만 **만료를 못 정했다.**
 * 즉 Pro 를 한 번 주면 **영구**였다. 기존 `pro_grace_until` 은 파트너 딜 유예 전용이고
 * `partner-pro-grace.ts` 만 쓴다 — 운영자가 손댈 자리가 아니었다.
 *
 * ## 두 기간을 **분리**한 이유
 *  · `proGraceUntil` — 딜 성사 시 `free` 를 한시적으로 `pro` 로 **올린다**
 *  · `planExpiresAt` — 운영자가 부여한 플랜이 **끝나면 내린다**
 * 하나로 합치면 운영자 조정이 딜 로직을 덮거나 그 반대가 된다.
 *
 * ## 이 테스트가 잡는 것
 * 컬럼만 추가하고 계산에서 안 읽으면 **아무 일도 일어나지 않는다.**
 * 「추가했다」와 「동작한다」는 다르다 — 그 간극을 여기서 막는다.
 */
import { describe, expect, it } from 'vitest';
import { resolveEffectivePlan } from '../partner-pro-grace';

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

const plan = (
  stored: string,
  grace: number | null,
  expires?: number | null,
  fallback?: string | null,
) => (resolveEffectivePlan as unknown as (
  s: string, g: number | null, e?: number | null, f?: string | null, n?: number,
) => string)(stored, grace, expires, fallback, NOW);

describe('플랜 만료', () => {
  it('만료가 없으면 종전과 같다 — 기존 동작을 깨지 않는다', () => {
    expect(plan('pro', null)).toBe('pro');
    expect(plan('free', null)).toBe('free');
    expect(plan('team', null)).toBe('team');
  });

  it('★만료가 지나면 내려간다 — 안 그러면 관리자가 준 Pro 가 영구다', () => {
    expect(plan('pro', null, NOW - HOUR)).toBe('free');
    expect(plan('team', null, NOW - 1)).toBe('free');
  });

  it('만료 전이면 유지된다', () => {
    expect(plan('pro', null, NOW + HOUR)).toBe('pro');
  });

  it('★만료 후 돌아갈 플랜을 지정할 수 있다 — 항상 free 로 떨어지는 게 아니다', () => {
    expect(plan('enterprise', null, NOW - 1, 'pro')).toBe('pro');
  });

  it('경계: 만료 시각 **정각**은 만료로 본다 — 「아직 유효」로 읽으면 하루가 새 나간다', () => {
    expect(plan('pro', null, NOW)).toBe('free');
  });
});

describe('파트너 유예와의 관계', () => {
  it('유예는 free 를 pro 로 올린다 (종전 동작)', () => {
    expect(plan('free', NOW + HOUR)).toBe('pro');
    expect(plan('free', NOW - HOUR)).toBe('free');
  });

  it('★만료로 내려간 뒤에도 **유예가 살아 있으면** pro 다 — 근거가 다른 두 규칙이다', () => {
    // 운영자가 준 Pro 는 끝났지만, 딜 유예는 그와 무관하게 유효할 수 있다.
    expect(plan('pro', NOW + HOUR, NOW - 1)).toBe('pro');
  });

  it('만료도 지나고 유예도 끝났으면 free', () => {
    expect(plan('pro', NOW - HOUR, NOW - HOUR)).toBe('free');
  });

  it('유예는 유료 플랜을 **덮지 않는다** — free 일 때만 올린다', () => {
    // 저장된 플랜이 team 이면 유예가 있어도 team 그대로여야 한다(강등 아님).
    expect(plan('team', NOW + HOUR)).toBe('team');
  });
});
