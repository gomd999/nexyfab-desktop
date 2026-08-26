import { describe, expect, it } from 'vitest';
import { ruleBasedResult } from './route';
import type { IsoLang } from '@/lib/i18n/normalize';

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/u;

describe('quote accuracy rule fallback', () => {
  it.each(['ko', 'en', 'ja', 'zh', 'es', 'ar'] as IsoLang[])('returns primary narrative in %s', locale => {
    const result = ruleBasedResult({
      entries: [{ process: 'CNC', draftAmount: 130, acceptedAmount: 100 }],
    }, locale);
    expect(result.summary).toBeTruthy();
    expect(result.processBias[0]?.recommendation).toBeTruthy();
    expect(result.suggestions[0]?.title).toBeTruthy();
    if (locale !== 'ko') {
      expect(`${result.summary} ${result.processBias[0]?.recommendation} ${result.suggestions[0]?.title} ${result.suggestions[0]?.detail}`).not.toMatch(HANGUL);
    }
  });
});
