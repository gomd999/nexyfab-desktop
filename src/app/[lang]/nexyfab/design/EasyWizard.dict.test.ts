/**
 * EasyWizard.tsx 템플릿 부제(EASY_DESC) 지역화 — **ja/zh/es/ar 사용자에게도 영어가
 * 나가던 결함** (260802, 같은 파일의 CATEGORIES·simulator RISK_SCENARIOS 와 동일 유형).
 *
 * 예전엔 모듈 레벨 EASY_DESC 가 `{ ko, en }` 두 필드만 갖고, 렌더 지점에서
 * `ko ? desc.ko : desc.en` 으로 골랐다 — ko가 아니면 전부 en 을 받았으므로 ja/zh/es/ar
 * 는 자기 언어를 전혀 보지 못했다. CATEGORIES 는 이미 loc() 로 고쳐져 있었는데
 * EASY_DESC 만 예전 2분기 그대로 남아 있었다.
 */
import { describe, expect, it } from 'vitest';
import { EASY_DESC } from './EasyWizard';

const SITE_LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;
const HANGUL = /[가-힣]/;

describe('★EasyWizard 템플릿 부제(EASY_DESC)가 6개 언어를 모두 갖는다', () => {
  it('★모든 항목이 6개 언어 전부에 텍스트를 갖는다', () => {
    const missing: string[] = [];
    for (const [id, desc] of Object.entries(EASY_DESC)) {
      for (const lang of SITE_LANGS) {
        if (!desc[lang]) missing.push(`${id}.${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('★ko 가 아닌 모든 언어에서 한글이 남지 않는다 — 이게 실제 결함이었다', () => {
    const leaked: string[] = [];
    for (const [id, desc] of Object.entries(EASY_DESC)) {
      for (const lang of SITE_LANGS) {
        if (lang === 'ko') continue;
        if (HANGUL.test(desc[lang])) leaked.push(`${id}.${lang}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('ko 값은 원본과 같다 — 번역 과정에서 원문이 바뀌지 않았는지', () => {
    expect(EASY_DESC.pergola.ko).toBe('기둥과 서까래로 만든 그늘막 — 마당·테라스에');
    expect(EASY_DESC.excavator_bucket.ko).toBe('굴착기 버킷');
  });
});
