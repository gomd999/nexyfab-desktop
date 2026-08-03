/**
 * ai-prompt-contract.test.ts — AI 경로가 **어휘와 갈리지 않는가** (260802).
 *
 * ## 왜 이 파일이 있는가
 * AI 경로 성공률을 처음 재 보니 **8건 중 1건(12.5%)** 이었다. 원인 4개 중 **3개는 LLM 을
 * 한 번도 부르지 않고 잡을 수 있는 것**이었다 — 프롬프트·스키마가 어휘(38종)와 갈려 있었다.
 *
 * | 결함 | 증상 |
 * |---|---|
 * | 프롬프트 어휘 목록이 **9종 하드코딩** | LLM 이 `base_plate`·`top_plate` 를 지어냄 — 환각이 아니라 **안 알려 준 것** |
 * | `TYPE_LIST` 가 힌트 없는 **18종에 `undefined`** 전송 | 그 어휘는 사실상 고를 수 없었다 |
 * | 응답 스키마 `type` enum 이 **9종** | 프롬프트로 알려 줘도 스키마가 막으면 못 고른다 |
 *
 * 전부 「어휘를 추가할 때 여기도 같이 고쳐야 하는」 구조였고, 그래서 갈렸다.
 * **이 회귀는 LLM 을 부르지 않는다** — 갈림 자체를 검사한다.
 *
 * ⚠ 실제 성공률은 LLM 호출이 필요해 `ai-path-live.test.ts`(옵트인)로 분리했다.
 *   CI 에서 skip 되며 **skip 은 통과가 아니다.** 그래서 여기 결정론 검사를 둔다.
 */

import { describe, expect, it } from 'vitest';
import { ASSEMBLY_SCHEMA } from './from-text.mjs';
import { ALL_TYPES, TYPE_HINTS, TYPE_SCHEMAS } from './schemas.mjs';
import { PARAMS } from './reconstruct.mjs';

const types = ALL_TYPES as unknown as string[];
const hints = TYPE_HINTS as unknown as Record<string, string | undefined>;
const params = PARAMS as unknown as Record<string, string[]>;
const schema = ASSEMBLY_SCHEMA as unknown as {
  properties: { parts: { items: { properties: { type: { enum: string[] }; params: { properties: Record<string, unknown> } } } } };
};
const partItem = schema.properties.parts.items.properties;

describe('AI 응답 스키마가 어휘와 갈리지 않는다', () => {
  it('★`type` enum = 전 어휘 — 스키마가 막으면 프롬프트로 알려 줘도 못 고른다', () => {
    expect([...partItem.type.enum].sort()).toEqual([...types].sort());
  });

  it('어휘가 늘면 enum 도 늘어난다 — 하드코딩 목록이 남아 있지 않다', () => {
    // 260801 에 추가한 어휘가 실제로 들어 있는지(하드코딩이면 빠져 있다).
    for (const t of ['cone', 'torus', 'extrude_profile', 'masonry_block', 'composite']) {
      expect(partItem.type.enum, t).toContain(t);
    }
  });
});

describe('프롬프트에 실리는 어휘 스펙에 `undefined` 가 없다', () => {
  it('★힌트가 없는 어휘는 **파라미터 이름**으로 대체된다', () => {
    /**
     * ⚠ 종전에는 `h_section: undefined` 가 LLM 에게 나갔다. 「설명이 없다」가 아니라
     *   **틀린 설명**을 준 것이다. 설명을 지어내지 않되, 빈 값을 보내지도 않는다.
     */
    const bad = types.filter((t) => {
      const spec = hints[t] ?? (params[t] ?? []).join(',');
      return !spec || spec.includes('undefined');
    });
    expect(bad, `스펙이 비었거나 undefined 인 어휘: ${bad.join(', ')}`).toEqual([]);
  });

  /**
   * ★260803 — **래칫을 전수로 올린다.**
   *
   * 이 검사는 260802 에 `≥21`(38종 중)로 들어왔고 **한 번도 올라가지 않았다.**
   * 그 사이 17종이 힌트 없이 남았고, 라이브에서 대가를 치렀다:
   * ```
   *   요청  : 힌지 마찰 와셔 — 외경 18 · 내경 8 · 두께 1   (= washer 파라미터와 정확히 일치)
   *   선택  : flange                                       ← 힌트가 있는 쪽
   *   결과  : 부품당 6건 × 10부품 = 게이트 에러 60건, 사용자 화면은 빨간 벽
   * ```
   * `PARAMS` 이름 폴백(위 검사)만으로는 **안 골린다**는 것이 실측으로 확인됐다 —
   * 모델은 **설명이 붙은 어휘**를 고른다. 그래서 「비어 있지 않다」가 아니라
   * **「전부 있다」**를 요구한다. 어휘를 추가하면 힌트도 반드시 같이 온다.
   *
   * ⚠ 이 수를 다시 `>=` 로 되돌리지 마라. 느슨한 래칫이 17종을 숨긴 장본인이다.
   */
  it('★전 어휘가 힌트를 갖는다 — 이름만 나열된 어휘는 모델이 고르지 않는다', () => {
    const missing = types.filter((t) => !hints[t]);
    expect(missing, `힌트 없는 어휘: ${missing.join(', ')}`).toEqual([]);
  });

  it('힌트가 그 어휘의 PARAMS 키를 전부 언급한다', () => {
    const bad = types
      .map((t) => [t, (params[t] ?? []).filter((k) => !(hints[t] ?? '').includes(k))] as const)
      .filter(([, miss]) => miss.length);
    expect(bad.map(([t, m]) => `${t}: ${m.join(',')}`)).toEqual([]);
  });
});

describe('파라미터 스키마 — 넓힐수록 좋아지지 않는다', () => {
  /**
   * ⚠⚠ 260802 에 **직접 겪은 역효과**다. 전 어휘 파라미터를 합쳐 62키 평면 객체로 넓혔더니
   *   `box` 에 `wireDia`(코일 스프링 파라미터)가 왔다 — 어느 키가 이 타입 것인지 신호가
   *   사라졌다. 그래서 골격 스키마는 **흔한 치수 키만** 두고, 타입별 파라미터는
   *   `TYPE_SCHEMAS` 로 따로 받는다.
   */
  it('★골격 스키마가 전 어휘 파라미터를 합친 유니온이 **아니다**', () => {
    const keys = Object.keys(partItem.params.properties);
    const allParamKeys = new Set(Object.values(params).flat());
    expect(keys.length, `골격 키 ${keys.length}개 — 유니온(${allParamKeys.size}개)으로 되돌아갔다`)
      .toBeLessThan(allParamKeys.size * 0.6);
  });

  it('타입별 스키마가 존재해 수리 경로가 쓸 수 있다', () => {
    const covered = types.filter((t) => (TYPE_SCHEMAS as Record<string, unknown>)[t]);
    // 전수를 요구하지 않는다(없는 어휘는 수리 대상에서 빠지고, 그건 고지된 한계다).
    expect(covered.length).toBeGreaterThanOrEqual(9);
  });
});
