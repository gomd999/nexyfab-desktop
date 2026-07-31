import { toIsoLang } from './normalize';

/**
 * 6언어 인라인 문자열 선택기.
 *
 * ## 왜 여기로 올렸나 (260802)
 * 원래 `app/[lang]/shape-generator/lib/loc.ts` 에 있었다 — 모델러 전용 위치다.
 * 그래서 그 밖의 화면(`nexyfab/*`·`components/*`)은 이 헬퍼가 있는 줄 모르고
 * **`isKo ? '한글' : 'English'` 2분기를 계속 새로 썼다.** 실측: 남은 부채 파일 18개에
 * 그런 분기가 **762곳**이다.
 *
 * 도구가 한쪽 폴더에만 있으면 나머지는 각자 만든다 — 이 세션에서 반복해 나온 형태라
 * **앱 공용 위치로 올린다.** 기존 경로는 재수출로 남겨 import 를 깨지 않는다.
 *
 * ## 규약
 * 라우트 표기(`kr`·`cn`)를 `toIsoLang` 으로 ISO(`ko`·`zh`)에 맞춘다 —
 * 이걸 안 거치면 `/cn/` 사용자가 조용히 영어를 본다.
 *
 * ⚠ `ja`/`zh`/`es`/`ar` 은 선택이라 부분 입력도 타입이 통과한다(영어로 폴백).
 *   **그건 편의지 허가가 아니다** — 여섯을 다 채우는 것이 규칙이다
 *   (`scripts/i18n/lang-coverage.test.ts` 래칫이 새 위반을 막는다).
 */
export function loc(
  lang: string | undefined | null,
  m: { ko: string; en: string; ja?: string; zh?: string; es?: string; ar?: string },
): string {
  return m[toIsoLang(lang)] ?? m.en;
}
