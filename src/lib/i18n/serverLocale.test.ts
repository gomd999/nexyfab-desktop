import { describe, expect, it } from 'vitest';
import { localizedApiMessage, resolveServerLocale } from './serverLocale';

function request(acceptLanguage?: string): Pick<Request, 'headers'> {
  return { headers: new Headers(acceptLanguage ? { 'accept-language': acceptLanguage } : undefined) };
}

describe('server locale resolution', () => {
  it.each([
    ['kr', 'kr', 'ko'], ['ko', 'kr', 'ko'], ['ko-KR', 'kr', 'ko'],
    ['cn', 'cn', 'zh'], ['zh', 'cn', 'zh'], ['zh-CN', 'cn', 'zh'],
    ['en', 'en', 'en'], ['jp', 'ja', 'ja'], ['ja-JP', 'ja', 'ja'], ['es-ES', 'es', 'es'], ['ar-SA', 'ar', 'ar'],
  ])('normalizes %s', (requested, route, iso) => {
    const locale = resolveServerLocale(request(), requested);
    expect(locale.route).toBe(route);
    expect(locale.iso).toBe(iso);
  });

  it('uses the highest-priority supported Accept-Language value', () => {
    expect(resolveServerLocale(request('fr-FR;q=0.9, zh-CN;q=0.8, en;q=0.7')).route).toBe('cn');
    expect(resolveServerLocale(request('de, ar;q=0.5')).route).toBe('ar');
  });

  it('prefers an explicit body locale over the header', () => {
    expect(resolveServerLocale(request('ja-JP'), 'es').route).toBe('es');
  });

  it('provides localized API messages for every supported route locale', () => {
    for (const lang of ['kr', 'en', 'ja', 'cn', 'es', 'ar'] as const) {
      const locale = resolveServerLocale(request(), lang);
      expect(localizedApiMessage(locale, 'messageRequired')).toBeTruthy();
    }
  });
});
