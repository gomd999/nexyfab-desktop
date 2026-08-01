/**
 * quick-quote 재질/공정 목록 지역화 — en/ja/cn/es/ar 사용자에게도 한국어가 나가던 결함(260802).
 *
 * simulator RISK_SCENARIOS(260801) 와 동일 유형: 페이지 자체는 dict 로 지역화돼 있었지만
 * MATERIALS/PROCESSES 의 label 만 언어 분기가 아예 없는 한국어 리터럴 문자열이었다.
 */
import { describe, expect, it } from 'vitest';
import { MATERIALS, PROCESSES, type SiteLang } from './quickQuoteDict';

const SITE_LANGS: SiteLang[] = ['ko', 'en', 'ja', 'cn', 'es', 'ar'];
const HANGUL = /[가-힣]/;

describe('★quick-quote 재질/공정 목록이 6개 site 언어를 모두 갖는다', () => {
    it('★MATERIALS 전 항목이 6개 언어 label 을 갖는다', () => {
        const missing: string[] = [];
        for (const m of MATERIALS) {
            for (const lang of SITE_LANGS) {
                if (!m.label[lang]) missing.push(`${m.id}.${lang}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('★PROCESSES 전 항목이 6개 언어 label 을 갖는다', () => {
        const missing: string[] = [];
        for (const p of PROCESSES) {
            for (const lang of SITE_LANGS) {
                if (!p.label[lang]) missing.push(`${p.id}.${lang}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('★ko 를 제외한 모든 언어에서 한글이 남지 않는다 — 이게 실제 결함이었다', () => {
        const leaked: string[] = [];
        for (const item of [...MATERIALS, ...PROCESSES]) {
            for (const lang of SITE_LANGS) {
                if (lang === 'ko') continue;
                if (HANGUL.test(item.label[lang])) leaked.push(`${item.id}.${lang}`);
            }
        }
        expect(leaked).toEqual([]);
    });

    it('ko 값은 원본과 같다 — 번역 과정에서 원문이 바뀌지 않았는지', () => {
        expect(MATERIALS.find(m => m.id === 'steel_s45c')?.label.ko).toBe('일반강철 (S45C)');
        expect(MATERIALS.find(m => m.id === 'titanium')?.label.ko).toBe('티타늄 (Ti-6Al-4V)');
        expect(PROCESSES.find(p => p.id === 'injection_molding')?.label.ko).toBe('사출 성형');
        expect(PROCESSES.find(p => p.id === 'forging')?.label.ko).toBe('단조');
    });
});
