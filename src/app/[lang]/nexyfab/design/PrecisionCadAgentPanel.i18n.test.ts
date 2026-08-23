import { describe, expect, it } from 'vitest';
import { PRECISION_CAD_AGENT_COPY, PRECISION_CAD_RESULT_COPY } from './PrecisionCadAgentPanel';

const locales = ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const;

describe('Precision CAD agent i18n', () => {
  it('covers every supported locale for controls, status, artifacts, and exact-promotion truth', () => {
    expect(Object.keys(PRECISION_CAD_AGENT_COPY).sort()).toEqual([...locales].sort());
    expect(Object.keys(PRECISION_CAD_RESULT_COPY).sort()).toEqual([...locales].sort());
    for (const locale of locales) {
      expect(Object.values(PRECISION_CAD_AGENT_COPY[locale]).every(value => typeof value === 'object' || value.trim().length > 0)).toBe(true);
      expect(Object.values(PRECISION_CAD_RESULT_COPY[locale]).every(value => value.trim().length > 0)).toBe(true);
    }
  });
});
