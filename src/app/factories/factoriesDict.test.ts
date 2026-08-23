import { describe, expect, it } from 'vitest';
import { factoryDisplayLabel, INDUSTRY_LABELS, REGION_LABELS } from './factoriesDict';

describe('factory taxonomy labels', () => {
  it('keeps display translations complete while keys remain filter identifiers', () => {
    const locales = ['ko', 'en', 'ja', 'cn', 'es', 'ar'] as const;
    const industries = Object.keys(INDUSTRY_LABELS.en ?? {});
    const regions = Object.keys(REGION_LABELS.en ?? {});

    for (const key of [...industries, ...regions]) {
      expect(factoryDisplayLabel(key, 'ko')).toBeTruthy();
      for (const locale of locales.filter((value) => value !== 'ko')) {
        expect(factoryDisplayLabel(key, locale)).toBeTruthy();
      }
    }
  });
});
