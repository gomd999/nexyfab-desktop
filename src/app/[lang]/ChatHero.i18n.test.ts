/**
 * ChatHero 계산 카드 지역화 — **en 사용자에게도 한국어가 나가던 결함** (260801).
 *
 * ChatHero 자체는 DICT(6개 site 언어: kr/en/ja/cn/es/ar)로 이미 완결된 다국어 페이지였는데,
 * 두 개의 모듈 레벨 상수만 예외였다 — 언어 분기가 **아예 없어서** en 사용자조차 한국어를
 * 그대로 봤다(simulator RISK_SCENARIOS, 7fa0516e 와 동일 유형):
 *  - CHECK_LABELS: 계산 결과 카드의 검토항목 이름(휨·전단·처짐…)
 *  - (구)summarizeFeatures 내 하드코딩: 3D 사양 카드의 feature 이름(박스·구멍·실린더…)
 *    → FEATURE_KIND_I18N 신설로 대체
 */
import { describe, expect, it } from 'vitest';
import { CHECK_LABELS_I18N, FEATURE_KIND_I18N } from './ChatHero';

const SITE_LANGS = ['kr', 'en', 'ja', 'cn', 'es', 'ar'] as const;
const CHECK_KEYS = [
  'flexure', 'shear', 'deflection', 'axial', 'buckling',
  'overturning', 'sliding', 'bearing', 'eccentricity',
  'moment', 'combined', 'drift', 'bolt_shear', 'bolt_bearing',
];
const FEATURE_KEYS = ['box', 'prism', 'hole', 'cylinder', 'sphere', 'cone', 'revolve'];
const HANGUL = /[가-힣]/;

describe('★CHECK_LABELS_I18N(계산 검토항목명)이 6개 site 언어를 모두 갖는다', () => {
  it('★모든 항목이 6개 언어 전부에 값을 갖는다', () => {
    const missing: string[] = [];
    for (const key of CHECK_KEYS) {
      const row = CHECK_LABELS_I18N[key];
      if (!row) { missing.push(`${key} (항목 없음)`); continue; }
      for (const lang of SITE_LANGS) {
        if (!row[lang]) missing.push(`${key}.${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('★en 을 포함해 kr 이 아닌 모든 언어에서 한글이 남지 않는다 — 이게 실제 결함이었다', () => {
    const leaked: string[] = [];
    for (const key of CHECK_KEYS) {
      for (const lang of SITE_LANGS) {
        if (lang === 'kr') continue;
        const v = CHECK_LABELS_I18N[key]?.[lang];
        if (v && HANGUL.test(v)) leaked.push(`${key}.${lang}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('kr 값은 원본과 같다 — 번역 과정에서 원문이 바뀌지 않았는지', () => {
    expect(CHECK_LABELS_I18N.flexure.kr).toBe('휨');
    expect(CHECK_LABELS_I18N.bolt_bearing.kr).toBe('지압');
  });
});

describe('★FEATURE_KIND_I18N(3D 사양 카드 feature명)이 6개 site 언어를 모두 갖는다', () => {
  it('★모든 항목이 6개 언어 전부에 값을 갖는다', () => {
    const missing: string[] = [];
    for (const key of FEATURE_KEYS) {
      const row = FEATURE_KIND_I18N[key];
      if (!row) { missing.push(`${key} (항목 없음)`); continue; }
      for (const lang of SITE_LANGS) {
        if (!row[lang]) missing.push(`${key}.${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('★en 을 포함해 kr 이 아닌 모든 언어에서 한글이 남지 않는다', () => {
    const leaked: string[] = [];
    for (const key of FEATURE_KEYS) {
      for (const lang of SITE_LANGS) {
        if (lang === 'kr') continue;
        const v = FEATURE_KIND_I18N[key]?.[lang];
        if (v && HANGUL.test(v)) leaked.push(`${key}.${lang}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('kr 값은 원본과 같다', () => {
    expect(FEATURE_KIND_I18N.box.kr).toBe('박스');
    expect(FEATURE_KIND_I18N.revolve.kr).toBe('회전체(단면 프로파일)');
  });
});
