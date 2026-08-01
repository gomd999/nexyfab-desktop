/**
 * AutoQuoteCard 의 "이 추천으로 진행 →" / "이 옵션 선택" 버튼 텍스트가
 * highlighted 여부로만 분기되고 dict(t) 를 전혀 거치지 않아, en/ja/cn/es/ar
 * 사용자에게도 한국어가 그대로 노출되던 결함(260802). simulator RISK_SCENARIOS,
 * quick-quote MATERIALS/PROCESSES 와 동일 유형.
 */
import { describe, expect, it } from 'vitest';
import { dict } from './AutoQuoteCard';

const SITE_LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;
const HANGUL = /[가-힣]/;

describe('★AutoQuoteCard dict 가 6개 site 언어 모두 applyPrimary/applyAlt 를 갖는다', () => {
    it('★모든 언어가 applyPrimary/applyAlt 를 갖는다', () => {
        const missing: string[] = [];
        for (const lang of SITE_LANGS) {
            const t = (dict as Record<string, Record<string, string>>)[lang];
            if (!t?.applyPrimary) missing.push(`${lang}.applyPrimary`);
            if (!t?.applyAlt) missing.push(`${lang}.applyAlt`);
        }
        expect(missing).toEqual([]);
    });

    it('★ko 를 제외한 모든 언어에서 한글이 남지 않는다 — 이게 실제 결함이었다', () => {
        const leaked: string[] = [];
        for (const lang of SITE_LANGS) {
            if (lang === 'ko') continue;
            const t = (dict as Record<string, Record<string, string>>)[lang];
            if (HANGUL.test(t.applyPrimary) || HANGUL.test(t.applyAlt)) leaked.push(lang);
        }
        expect(leaked).toEqual([]);
    });

    it('ko 값은 원본과 같다', () => {
        expect(dict.ko.applyPrimary).toBe('이 추천으로 진행 →');
        expect(dict.ko.applyAlt).toBe('이 옵션 선택');
    });
});
