/**
 * simulator 리스크 시나리오 지역화 — **en 사용자에게도 한국어가 나가던 결함** (260801).
 *
 * B/C 유형(ko/en 이분)과 달리 이건 언어 분기가 **아예 없어서** en 사용자조차 한국어를
 * 그대로 봤다. simDict 는 6개 site 언어(ko/en/ja/cn/es/ar)를 모두 갖는데
 * RISK_SCENARIOS 의 name/description 만 예외였다.
 */
import { describe, expect, it } from 'vitest';
import { simDict, INDUSTRY_SPECIAL_I18N, RISK_SCENARIO_I18N } from './simulatorDict';

const SITE_LANGS = ['ko', 'en', 'ja', 'cn', 'es', 'ar'] as const;
const SCENARIO_IDS = ['us_china_tariff', 'port_strike', 'energy_crisis', 'supply_shortage', 'currency_shock', 'climate_disaster'];
const HANGUL = /[가-힣]/;

describe('★리스크 시나리오가 6개 site 언어를 모두 갖는다', () => {
  it('★모든 시나리오가 6개 언어 전부에 name·description 을 갖는다', () => {
    const missing: string[] = [];
    for (const id of SCENARIO_IDS) {
      const row = RISK_SCENARIO_I18N[id];
      if (!row) { missing.push(`${id} (항목 없음)`); continue; }
      for (const lang of SITE_LANGS) {
        if (!row[lang]?.name || !row[lang]?.description) missing.push(`${id}.${lang}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('★en 을 포함해 ko 가 아닌 모든 언어에서 한글이 남지 않는다 — 이게 실제 결함이었다', () => {
    const leaked: string[] = [];
    for (const id of SCENARIO_IDS) {
      for (const lang of SITE_LANGS) {
        if (lang === 'ko') continue;
        const row = RISK_SCENARIO_I18N[id]?.[lang];
        if (row && (HANGUL.test(row.name) || HANGUL.test(row.description))) leaked.push(`${id}.${lang}`);
      }
    }
    expect(leaked).toEqual([]);
  });

  it('simDict 도 riskScenarioTitle/riskActiveCount/riskClearAll 을 6개 언어 모두 갖는다', () => {
    for (const lang of SITE_LANGS) {
      const t = (simDict as Record<string, Record<string, string>>)[lang];
      expect(t.riskScenarioTitle, `${lang}.riskScenarioTitle`).toBeTruthy();
      expect(t.riskActiveCount, `${lang}.riskActiveCount`).toBeTruthy();
      expect(t.riskClearAll, `${lang}.riskClearAll`).toBeTruthy();
    }
  });

  it('ko 값은 원본과 같다 — 번역 과정에서 원문이 바뀌지 않았는지', () => {
    expect(RISK_SCENARIO_I18N.us_china_tariff.ko.name).toBe('미중 관세전쟁');
    expect(RISK_SCENARIO_I18N.climate_disaster.ko.description).toBe('주요 생산지 자연재해로 공장 2개월 가동 중단');
  });

  it('산업 특화 프리셋 표시명도 6개 언어를 모두 제공한다', () => {
    for (const id of ['semiconductor', 'medical_device', 'automotive_tier']) {
      for (const lang of SITE_LANGS) {
        expect(INDUSTRY_SPECIAL_I18N[id]?.[lang], `${id}.${lang}`).toBeTruthy();
      }
    }
    for (const id of ['semiconductor', 'medical_device', 'automotive_tier']) {
      for (const lang of SITE_LANGS.filter((value) => value !== 'ko')) {
        expect(HANGUL.test(INDUSTRY_SPECIAL_I18N[id]?.[lang] ?? ''), `${id}.${lang}`).toBe(false);
      }
    }
  });
});
