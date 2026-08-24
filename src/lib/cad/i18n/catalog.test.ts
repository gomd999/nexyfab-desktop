import { describe, expect, it } from 'vitest';
import { CAD_CATALOG, resolveCadMessage, validateCadCatalogs } from './catalog';

describe('CAD local catalog', () => {
  it('has six-locale parity and matching placeholders', () => expect(validateCadCatalogs()).toEqual({ missing: [], unused: [], placeholderMismatches: [] }));
  it('falls back to English with explicit metadata', () => {
    const result = resolveCadMessage({ code: 'CAD_FEATURE_UNSUPPORTED', params: { feature: 'loft' } }, 'xx');
    expect(result).toMatchObject({ locale: 'en', resolvedLocale: 'en', fallback: true, missing: false, unverified: false });
    expect(result.text).toContain('loft');
  });
  it('marks unreviewed locales and preserves typed placeholders', () => {
    const result = resolveCadMessage({ code: 'CAD_REVISION_STALE', params: { revision: 7 } }, 'ja');
    expect(result).toMatchObject({ unverified: true, fallback: false });
    expect(result.text).toContain('7');
    expect(CAD_CATALOG.ar.CAD_REVISION_STALE).toContain('{{revision}}');
  });
  it('marks missing locale keys and falls back to English explicitly', () => {
    const catalogs = {
      ...CAD_CATALOG,
      ja: { ...CAD_CATALOG.ja, CAD_RELEASE_HOLD: undefined as never },
    };
    const result = resolveCadMessage({ code: 'CAD_RELEASE_HOLD', params: { reason: 'registry' } }, 'ja', catalogs);
    expect(result).toMatchObject({ locale: 'ja', resolvedLocale: 'en', fallback: true, missing: true, unverified: true });
    expect(result.text).toContain('Release is on hold');
  });
  it('escapes placeholder text and rejects malformed catalogs without throwing', () => {
    const result = resolveCadMessage({ code: 'CAD_FEATURE_UNSUPPORTED', params: { feature: 'A&B' } }, 'en');
    expect(result.text).toContain('A&amp;B');
    expect(validateCadCatalogs(new Proxy({}, { ownKeys: () => { throw new Error('trap'); } }))).toEqual({
      missing: ['*:catalog'], unused: [], placeholderMismatches: [],
    });
    expect(validateCadCatalogs({
      ...CAD_CATALOG,
      en: { ...CAD_CATALOG.en, CAD_RELEASE_HOLD: '<b>bad</b>' },
    })).toMatchObject({ missing: ['en:CAD_RELEASE_HOLD'] });
  });
});
