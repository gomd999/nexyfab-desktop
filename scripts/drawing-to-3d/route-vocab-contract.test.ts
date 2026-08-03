/**
 * route-vocab-contract.test.ts — **라우트가 자기 어휘 목록을 들지 않는다** (260803).
 *
 * ## 왜 이 파일이 있는가 — 같은 결손의 다섯 번째 판이다
 * ```
 *   260802 ①  ASSEMBLY_SCHEMA 의 type enum 이 9종 하드코딩      → ALL_TYPES 로 고침
 *   260802 ②  PART_PARAMS 키 19개 하드코딩                      → PARAMS 로 고침
 *   260803 ③  TYPE_HINTS 17종 결손                              → 전수 보충
 *   260803 ④  extract-preset RESPONSE_SCHEMA 에 description 누락 → 추가
 *   260803 ⑤  **assemble 라우트가 어휘 16종을 따로 하드코딩**    → 이 파일
 * ```
 * ⑤ 실측: `ALL_TYPES` 38종 중 **22종이 라이브 프롬프트에 아예 없었다**
 * (`slab_with_openings`·`composite`·`revolve`·`cone`·`torus`·`pipe_elbow`·`coil_spring` …).
 * 즉 라이브 라우트는 **어휘의 42%만** 쓸 수 있었다.
 *
 * ⚠ 더 나쁜 것: 260803 에 「사각 개구는 `slab_with_openings`」 힌트를 넣고
 *   `textToAssembly` 로 측정해 「고쳤다」고 보고했는데, **라이브 라우트에는 그 어휘가
 *   없어서 실제로는 안 고쳐진 상태**였다. 측정 경로와 제품 경로가 달랐다.
 *   → 이 회귀는 **경로가 갈리는 것 자체**를 막는다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_TYPES } from './schemas.mjs';
import { VOCAB_SPEC } from './from-text.mjs';

const routeSrc = readFileSync(
  join(process.cwd(), 'src', 'app', 'api', 'nexyfab', 'drawing', 'assemble', 'route.ts'),
  'utf8',
);
const types = ALL_TYPES as unknown as string[];
const vocab = (VOCAB_SPEC as unknown as () => string)();

describe('★어휘는 한 곳에서만 만든다', () => {
  it('라우트가 VOCAB_SPEC 을 쓴다 — 자기 목록을 만들지 않는다', () => {
    expect(routeSrc).toContain('VOCAB_SPEC()');
  });

  it('★프롬프트에 어휘 개수를 손으로 적지 않는다 — 세는 순간 갈린다', () => {
    // "어휘 16종:" 같은 하드코딩된 개수 선언이 없어야 한다
    expect(routeSrc).not.toMatch(/어휘\s*\d+\s*종\s*:/);
  });

  it('VOCAB_SPEC 이 전 어휘를 싣는다', () => {
    const missing = types.filter((t) => !vocab.includes(t));
    expect(missing, `VOCAB_SPEC 에 없는 어휘: ${missing.join(', ')}`).toEqual([]);
  });

  it('한 줄에 한 어휘 — 행 수가 어휘 수와 같다', () => {
    expect(vocab.split('\n').length).toBe(types.length);
  });
});

describe('★template-first — 템플릿이 1순위다', () => {
  it('프롬프트가 템플릿을 1순위로 제시한다', () => {
    expect(routeSrc).toMatch(/\*\*1순위 — 템플릿/);
  });

  it('부품 직접 조립이 마지막 순위다 — 종전에는 이게 기본이고 템플릿이 "예외 2" 였다', () => {
    const iTpl = routeSrc.indexOf('1순위 — 템플릿');
    const iParts = routeSrc.indexOf('3순위 — 부품 직접 조립');
    expect(iTpl).toBeGreaterThan(0);
    expect(iParts).toBeGreaterThan(iTpl);
    expect(routeSrc).not.toContain('예외 2 —');
  });

  it('★자유형으로 간 사유(templateMiss)를 받아 응답·실패로그에 싣는다', () => {
    expect(routeSrc).toContain('templateMiss');
    // 다음 아키타입 우선순위의 근거가 되도록 실패 지문으로도 남긴다
    expect(routeSrc).toMatch(/stage:\s*'template-miss'/);
  });

  it('자유형 경로에 접촉 경고가 있다 — 부유가 가장 흔한 실패다', () => {
    expect(routeSrc).toMatch(/떠 있으면 실패|접촉\*\* 배치/);
  });
});
