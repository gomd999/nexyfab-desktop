/**
 * HelpClient 지역화 회귀 — **비-ko/en 사용자에게 영어가 나가던 결함 + CTA 링크가
 * /en/... 으로 새던 결함** (260802).
 *
 * 이전: `lang === 'ko' ? 'ko' : 'en'` 2분기라 ja/zh/es/ar 사용자는 페이지 텍스트를
 * 영어로 봤고, 동시에 "관련 페이지" CTA 버튼도 자기 언어 경로가 아닌 /en/... 로
 * 이동했다(TrustClient.tsx 에서 이미 확인된 것과 동일한 결함 패턴).
 * SECTIONS/dict 를 6개 site 언어(ko/en/ja/zh/es/ar) 전부로 채우고 toIsoLang/
 * toRouteLang 로 배선했다.
 */
import { describe, expect, it } from 'vitest';
import { SECTIONS, dict } from './HelpClient';

const SITE_LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;
const HANGUL = /[가-힣]/;

describe('★HelpClient 가 6개 site 언어를 모두 갖는다', () => {
  it('★모든 섹션이 6개 언어 전부에 title·blurb·steps 를 갖는다', () => {
    const missing: string[] = [];
    for (const s of SECTIONS) {
      for (const lang of SITE_LANGS) {
        if (!s.title[lang]) missing.push(`${s.id}.title.${lang}`);
        if (!s.blurb[lang]) missing.push(`${s.id}.blurb.${lang}`);
        s.steps.forEach((st, i) => {
          if (!st[lang]) missing.push(`${s.id}.steps[${i}].${lang}`);
        });
        if (s.cta && !s.cta.label[lang]) missing.push(`${s.id}.cta.label.${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('★top-level dict 가 6개 언어 전부에 필수 키를 갖는다', () => {
    const keys = ['title', 'subtitle', 'expand', 'collapse', 'cta', 'contact', 'contactLink', 'intro', 'trust', 'trustLink'] as const;
    const missing: string[] = [];
    for (const lang of SITE_LANGS) {
      const t = dict[lang];
      if (!t) { missing.push(`dict.${lang} (없음)`); continue; }
      for (const k of keys) {
        if (!t[k]) missing.push(`dict.${lang}.${k}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('★en을 포함해 ko가 아닌 모든 언어에서 한글이 남지 않는다 — 이게 실제 결함이었다', () => {
    const leaked: string[] = [];
    for (const s of SECTIONS) {
      for (const lang of SITE_LANGS) {
        if (lang === 'ko') continue;
        if (HANGUL.test(s.title[lang])) leaked.push(`${s.id}.title.${lang}`);
        if (HANGUL.test(s.blurb[lang])) leaked.push(`${s.id}.blurb.${lang}`);
        s.steps.forEach((st, i) => {
          if (HANGUL.test(st[lang])) leaked.push(`${s.id}.steps[${i}].${lang}`);
        });
        if (s.cta && HANGUL.test(s.cta.label[lang])) leaked.push(`${s.id}.cta.label.${lang}`);
      }
      for (const lang of SITE_LANGS) {
        if (lang === 'ko') continue;
        const t = dict[lang];
        for (const [k, v] of Object.entries(t)) {
          if (k === 'contactLink') continue; // email address, not translated
          if (HANGUL.test(v)) leaked.push(`dict.${lang}.${k}`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });

  it('ko 값은 원본과 같다 — 번역 과정에서 원문이 바뀌지 않았는지', () => {
    expect(SECTIONS[0].id).toBe('first-design');
    expect(SECTIONS[0].title.ko).toBe('첫 설계 만들기');
    expect(SECTIONS[0].blurb.ko).toBe('브라우저에서 바로 3D 모델을 만듭니다. 설치 불필요.');
    expect(SECTIONS[0].steps[0].ko).toBe('홈(허브) 또는 기계 분야의 "전문가형 CAD" 카드 클릭 → shape generator 열림');
    expect(SECTIONS[0].cta?.label.ko).toBe('3D 모델러 열기');
    expect(SECTIONS[6].id).toBe('pro-tips');
    expect(SECTIONS[6].steps[4].ko).toBe('신뢰성 자료 (테스트 통과율, OCCT burn-in) → /trust 페이지 참조');
    expect(dict.ko.title).toBe('사용 가이드');
    expect(dict.ko.intro).toBe('7개 카드 중 궁금한 것을 펼쳐보세요. 카드 안에 단계별 안내가 있고, 관련 페이지로 바로 가는 버튼도 있습니다.');
  });

  it('en 값도 원본과 같다', () => {
    expect(SECTIONS[0].title.en).toBe('Create your first design');
    expect(dict.en.title).toBe('User Guide');
  });

  it('모든 섹션 id가 고유하고 7개다', () => {
    expect(SECTIONS).toHaveLength(7);
    expect(new Set(SECTIONS.map(s => s.id)).size).toBe(7);
  });
});
