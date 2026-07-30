/**
 * ai-path-live.test.ts — AI 경로 **실제 성공률** (260802, 옵트인).
 *
 * ## 왜 옵트인인가
 * 실제 LLM 을 부른다 — 비용이 들고 실행마다 결과가 다르다. CI 에서 자동으로 돌리면
 * 요금과 불안정성이 함께 붙는다. `NEXYFAB_AI_LIVE=1` 일 때만 돈다.
 *
 * ⚠ **skip 은 통과가 아니다.** 그래서 LLM 없이 도는 결정론 회귀를 따로 두었다
 *   (`ai-prompt-contract.test.ts`) — 260802 에 발견한 원인 4개 중 3개를 그쪽이 잡는다.
 *
 * ## 260802 실측 (수정 전 → 후)
 * ```
 * 전   ok 1 · gate_fail 4 · max_tokens 3    p50 90,916ms
 * 후   ok 7 · 1건은 측정 도구 문제           p50  8,257ms
 * ```
 * 남은 1건은 제품 실패가 아니었다: 옹벽 요청에 모델이 `civilAlignment` 를 냈고,
 * 그건 프롬프트가 지시한 **정확한 동작**이다. 하네스가 `parts` 만 세서 실패로 찍었다 —
 * **측정 도구를 먼저 의심한다**는 규약이 또 맞았다.
 */

import { describe, expect, it } from 'vitest';

const LIVE = process.env.NEXYFAB_AI_LIVE === '1';

/** 도메인별 고정 프롬프트 — 바꾸면 과거 수치와 비교가 안 된다. */
const CASES: Array<[string, string]> = [
  ['기계', '두께 12mm 강판 300x200 에 M10 볼트홀 6개'],
  ['기계', '지름 50mm 길이 400mm 스테인리스 축'],
  ['기계', '앵글 50x50x5 로 만든 1000mm 프레임 4변'],
  ['토목', '높이 3m 길이 10m 옹벽 — 저판 두께 400mm'],
  ['건축', '가로 6m 세로 4m 높이 3m 방 한 칸, 벽 두께 200mm'],
  ['조경', '폭 1.5m 길이 5m 목재 데크 — 장선 간격 400mm'],
  ['인테리어', '길이 2400 깊이 600 높이 900 카운터'],
  ['기계', '외경 100 내경 80 길이 500 파이프'],
];

(LIVE ? describe : describe.skip)('AI 경로 실측 성공률 (NEXYFAB_AI_LIVE=1)', () => {
  it('★8건 중 6건 이상이 게이트를 통과한다 (260802 실측 7~8건)', async () => {
    const { textToAssembly } = await import('./from-text.mjs') as unknown as {
      textToAssembly: (d: string) => Promise<{ assembly?: { parts?: unknown[]; civilAlignment?: unknown } }>;
    };
    const { buildAssembly } = await import('./assembly.mjs') as unknown as {
      buildAssembly: (a: unknown) => { gateErrors?: string[] };
    };
    const fails: string[] = [];
    let ok = 0;
    for (const [dom, text] of CASES) {
      try {
        const { assembly } = await textToAssembly(text);
        /**
         * ⚠ `civilAlignment` 도 **성공**이다. 선형(옹벽·노선) 요청은 `parts` 가 아니라
         *   `civilAlignment` 로 가는 것이 프롬프트가 지시한 정확한 동작이다.
         *   `parts` 만 세면 올바른 동작을 실패로 찍는다(첫 측정에서 실제로 그랬다).
         */
        if (assembly?.civilAlignment) { ok += 1; continue; }
        const errs = buildAssembly(assembly)?.gateErrors ?? [];
        if (!errs.length && (assembly?.parts ?? []).length > 0) ok += 1;
        else fails.push(`${dom}: ${errs[0] ?? 'parts 비어있음'}`);
      } catch (e) { fails.push(`${dom}: ${String((e as Error)?.message ?? e).slice(0, 60)}`); }
    }
    // LLM 은 실행마다 다르다 — 8건 전부를 요구하지 않고 **회귀만** 막는다.
    expect(ok, `성공 ${ok}/8 · 실패: ${fails.join(' | ')}`).toBeGreaterThanOrEqual(6);
  }, 900_000);
});
