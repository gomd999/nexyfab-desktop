import { toIsoLang } from '@/lib/i18n/normalize';

/**
 * Inline 6-language string picker for modeler components migrating away from
 * the 2-language `isKo ? '한글' : 'English'` pattern (which silently served
 * English to ja/zh/es/ar users). Maps route codes (kr/cn) → ISO via toIsoLang
 * and falls back to English for any missing/unknown locale.
 *
 * Usage: `loc(lang, { ko: '회전', en: 'Rotation', ja: '回転', zh: '旋转', es: 'Rotación', ar: 'تدوير' })`
 *
 * ja/zh/es/ar are optional so a partial entry still type-checks (falls back to
 * en), but fill all six for complete coverage. (2026-06-13 modeler i18n)
 */
export function loc(
  lang: string | undefined | null,
  m: { ko: string; en: string; ja?: string; zh?: string; es?: string; ar?: string },
): string {
  return m[toIsoLang(lang)] ?? m.en;
}
