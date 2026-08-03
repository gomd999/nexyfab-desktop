/**
 * extract-preset-fallback.test.ts — **이미지 경로가 막다른 길이 되지 않는다** (260803).
 *
 * 라이브에서 노트북 거치대 사진을 올리면 "이 분야 템플릿과 맞는 형상을 찾지 못했어요"로 끝났다.
 * 원인은 mech 템플릿 18종이 전부 중공업이라 **소비재 아키타입이 0개**인 것이다.
 * 해법은 템플릿을 늘리는 게 아니라(그건 끝이 없다) **같은 vision 호출에서 부품 서술을 받아**
 * 조립 경로로 넘기는 것이다.
 *
 * ⚠ 이 회귀가 지키는 핵심은 **`description` 이 응답 스키마에 있는가**이다.
 *   구조화 출력은 **스키마에 없는 키를 조용히 떨군다.** 프롬프트로 아무리 시켜도 소용없다 —
 *   260802 에 `h_section`·`cone` 파라미터가 정확히 이 이유로 통째로 사라졌고,
 *   증상은 「LLM 이 안 줬다」가 아니라 **「우리가 버렸다」**였다.
 *
 * 실측(260803, 실 vision 호출): MVP 제트엔진 사진 → `templateId:'none'` · `confidence:0.2`
 * → `description` 104자 수신 → 조립 경로 7부품 · openscad ✅ · 질량 31.10kg · 드롭 2건 보고.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'scripts', 'drawing-to-3d', 'extract-preset.mjs'), 'utf8');
const routeSrc = readFileSync(
  join(process.cwd(), 'src', 'app', 'api', 'nexyfab', 'drawing', 'extract-preset', 'route.ts'),
  'utf8',
);

describe('★description 이 응답 스키마에 있다 — 없으면 조용히 떨어진다', () => {
  it('RESPONSE_SCHEMA 에 description 이 선언돼 있다', () => {
    const schemaBlock = src.slice(src.indexOf('const RESPONSE_SCHEMA'), src.indexOf('function buildPrompt'));
    expect(schemaBlock).toMatch(/description:\s*\{\s*type:\s*'STRING'\s*\}/);
  });

  it('프롬프트가 description 을 **항상** 채우라고 지시한다', () => {
    const promptBlock = src.slice(src.indexOf('function buildPrompt'), src.indexOf('async function callGemini'));
    expect(promptBlock).toContain('description');
    // templateId 가 맞았을 때 생략하면 조립 경로가 재료를 잃는다
    expect(promptBlock).toMatch(/항상 채워라|무관하게/);
  });

  it('지어낸 치수를 금지하는 지시가 남아 있다 — 서술이 곧 형상이 된다', () => {
    const promptBlock = src.slice(src.indexOf('function buildPrompt'), src.indexOf('async function callGemini'));
    expect(promptBlock).toMatch(/읽히는 것만|추측하지/);
  });
});

describe('★라우트가 미매칭·저신뢰에서 조립 경로로 넘긴다', () => {
  it('두 막다른 길이 하나의 폴백 분기로 합쳐졌다', () => {
    expect(routeSrc).toContain('needsFallback');
    expect(routeSrc).toMatch(/templateId === 'none' \|\| !tpl \|\| confidence < MIN_CONFIDENCE/);
  });

  it('폴백 성공 시 via:\'description\' 으로 구분해 보고한다 — 템플릿 매칭이 아니다', () => {
    expect(routeSrc).toMatch(/via:\s*'description'/);
  });

  it('★폴백 결과에는 치수 출처 경고가 붙는다', () => {
    expect(routeSrc).toContain('provenanceWarning');
    expect(routeSrc).toMatch(/통상값으로 채워졌을 수 있습니다/);
  });

  it('조립 경로까지 실패하면 정직하게 안내한다 — 억지 형상을 만들지 않는다', () => {
    const fb = routeSrc.slice(routeSrc.indexOf('const needsFallback'));
    expect(fb).toMatch(/ok:\s*false/); // 폴백 실패 시 정직 반려 경로가 남아 있다
  });

  it('서술이 부실하면 억지로 만들지 않는다', () => {
    expect(routeSrc).toMatch(/desc\.length < 10/);
  });
});
