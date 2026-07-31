/**
 * output-lang.test.ts — **산출물 언어를 숨기지 않는다** (260802).
 *
 * ## 배경 실측
 * `labelKo 836 · labelEn 86 · messageKo 49` — 영어 커버리지 약 10%, ja·zh·es·ar 은 0.
 * 그런데 사이트는 6언어로 팔리고, 패키지 라우트는 `options.lang === 'en'` **하나만**
 * 알아들었다. `es` 로 요청하면 **조용히 무시**됐다.
 *
 * 「요청이 없었던 것」과 「요청을 못 들어준 것」은 다르다. 후자를 문서에 안 적으면
 * 사용자는 자기 언어로 받은 줄 알고, 한국어 문서를 열고 나서야 안다.
 */
import { describe, expect, it } from 'vitest';
import { normalizeOutputLang, translationCoverage, outputLangNoticeHtml, CONTENT_LANG } from './output-lang.mjs';

const norm = normalizeOutputLang as unknown as (v: unknown) => string | null;
const cov = translationCoverage as unknown as (l: string | null) => string;
const notice = outputLangNoticeHtml as unknown as (l: string | null) => string;

describe('출력 언어 정규화', () => {
  it('라우트 표기와 ISO 표기를 둘 다 받는다', () => {
    expect(norm('kr')).toBe('ko');
    expect(norm('cn')).toBe('zh');
    expect(norm('zh')).toBe('zh');
    expect(norm('es-ES')).toBe('es');
    expect(norm('AR')).toBe('ar');
  });

  it('★모르는 값에 기본값을 지어내지 않는다 — null 이어야 「요청 없음」과 구별된다', () => {
    expect(norm('fr')).toBeNull();
    expect(norm('')).toBeNull();
    expect(norm(undefined)).toBeNull();
  });
});

describe('번역 상태를 부풀리지 않는다', () => {
  it('★`en` 은 full 이 아니라 partial 이다 — GA 시트명·표두만 영어다', () => {
    expect(cov('en')).toBe('partial');
  });

  it('본문 언어만 full 이다', () => {
    expect(CONTENT_LANG).toBe('ko');
    expect(cov('ko')).toBe('full');
  });

  it('나머지 네 언어는 none 이다 — 번역이 하나도 없다', () => {
    for (const l of ['ja', 'zh', 'es', 'ar']) expect(cov(l), l).toBe('none');
  });
});

describe('고지', () => {
  it('★고지가 **그 사람의 언어**로 나간다 — 한국어로 적으면 읽을 수 없다', () => {
    expect(notice('es')).toContain('coreano');
    expect(notice('ja')).toContain('韓国語');
    expect(notice('zh')).toContain('韩文');
    expect(notice('ar')).toContain('بالكورية');
    expect(notice('en')).toContain('Korean');
  });

  it('★`en` 고지는 「일부만 영어」라고 말한다 — 「번역됨」으로 읽히면 안 된다', () => {
    const h = notice('en');
    expect(h).toContain('sheet names');
    expect(h).toContain('not a translated document');
  });

  it('★`<html lang>` 을 바꾸지 않는다 — 본문이 한국어인데 lang=ar 이면 스크린리더가 아랍어로 읽는다', () => {
    const h = notice('ar');
    // 고지 블록 자체에만 lang/dir 을 준다.
    expect(h).toContain('dir="rtl"');
    expect(h).toContain('lang="ar"');
    expect(h, '문서 전체를 아랍어로 선언하면 안 된다').not.toContain('<html');
  });

  it('요청 언어·본문 언어·번역 상태를 한국어로도 병기한다 — 받는 쪽이 한국인 담당자일 수 있다', () => {
    const h = notice('es');
    expect(h).toContain('요청 언어');
    expect(h).toContain('<code>es</code>');
    expect(h).toContain('<code>none</code>');
  });

  it('한국어 요청에는 고지가 없다 — 할 말이 없을 때 만들어 내지 않는다', () => {
    expect(notice('ko')).toBe('');
    expect(notice(null)).toBe('');
  });
});
