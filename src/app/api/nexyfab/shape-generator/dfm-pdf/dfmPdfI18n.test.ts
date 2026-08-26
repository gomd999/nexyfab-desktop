import { describe, expect, it } from 'vitest';
import { dfmPdfSeverityLabel, formatDfmPdfDifficulty, formatDfmPdfFacts, getDfmPdfCopy, resolveDfmPdfLocale } from './dfmPdfI18n';

const LOCALES = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;

describe('DFM PDF six-language copy', () => {
  it.each(LOCALES)('provides complete %s labels and localized facts', locale => {
    const copy = getDfmPdfCopy(locale);
    expect(Object.values(copy).flatMap(value => typeof value === 'string' ? [value] : Object.values(value)).every(Boolean)).toBe(true);
    const facts = formatDfmPdfFacts({ volume_cm3: 12.5, surface_area_cm2: 40, bbox: { w: 10, h: 20, d: 30 }, triangleCount: 1_234 }, locale);
    expect(facts).toHaveLength(4);
    expect(dfmPdfSeverityLabel('warning', locale)).toBe(copy.warning);
    expect(formatDfmPdfDifficulty('moderate', locale)).toBe(copy.difficulties.moderate);
  });

  it('prefers an explicit body locale and normalizes browser aliases', () => {
    expect(resolveDfmPdfLocale('kr', 'es-ES,es;q=0.9')).toBe('ko');
    expect(resolveDfmPdfLocale(undefined, 'zh-CN,zh;q=0.9')).toBe('zh');
    expect(resolveDfmPdfLocale(undefined, 'fr-FR,fr;q=0.9')).toBe('en');
  });
});
