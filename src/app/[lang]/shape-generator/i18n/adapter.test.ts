import { describe, expect, it } from 'vitest';
import { shapeGeneratorLocale, translateCadMessage } from './adapter';

describe('Shape Generator Precision i18n adapter', () => {
  it('maps route aliases through the existing public normalizer', () => {
    expect(shapeGeneratorLocale('kr')).toEqual({ locale: 'ko', direction: 'ltr' });
    expect(shapeGeneratorLocale('cn')).toEqual({ locale: 'zh', direction: 'ltr' });
  });
  it('exposes Arabic RTL metadata', () => expect(shapeGeneratorLocale('ar').direction).toBe('rtl'));
  it('keeps malformed route values bounded and falls back to English', () => {
    expect(shapeGeneratorLocale(new Proxy({}, {}) as never)).toEqual({ locale: 'en', direction: 'ltr' });
    expect(translateCadMessage({ code: 'CAD_INPUT_INVALID', params: { reason: 'shape' } }, null)).toMatchObject({ locale: 'en', resolvedLocale: 'en' });
  });
  it('renders machine-code messages without storing translated text', () => {
    const message = { code: 'CAD_RECEIPT_INVALID' as const, params: { reason: 'hash' } };
    expect(translateCadMessage(message, 'en').text).toContain('hash');
    expect(message).toEqual({ code: 'CAD_RECEIPT_INVALID', params: { reason: 'hash' } });
  });
});
