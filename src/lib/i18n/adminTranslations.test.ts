import { describe, expect, it } from 'vitest';
import { ADMIN_COPY, ADMIN_NAV_KEYS, resolveAdminLocale } from './adminTranslations';

describe('admin i18n base contract', () => {
  it('provides every navigation key in all six locales', () => {
    for (const locale of ['ko', 'en', 'ja', 'zh', 'es', 'ar'] as const) {
      for (const key of ADMIN_NAV_KEYS) expect(ADMIN_COPY[locale].nav[key]).toBeTruthy();
    }
  });

  it('normalizes route aliases and preserves the Arabic locale', () => {
    expect(resolveAdminLocale('kr')).toBe('ko');
    expect(resolveAdminLocale('cn')).toBe('zh');
    expect(resolveAdminLocale('ar')).toBe('ar');
    expect(resolveAdminLocale('unknown')).toBe('ko');
  });
});
