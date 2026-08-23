// Lang normalization helpers.
//
// Route params use 2-letter codes ('kr', 'en', 'ja', 'cn', 'es', 'ar') while
// some UI code historically compares against ISO codes ('ko'). Centralise the
// mapping so comparisons like `lang === 'ko'` on a /kr/ route stop silently
// failing.

export type RouteLang = 'kr' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
export type IsoLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export const SUPPORTED_LANGS: RouteLang[] = ['kr', 'en', 'ja', 'cn', 'es', 'ar'];
export const DEFAULT_LANG: RouteLang = 'en';

const LEGACY_ROUTE_LANGS: Readonly<Record<string, RouteLang>> = {
  ko: 'kr',
  zh: 'cn',
  jp: 'ja',
};

const ROUTE_TO_ISO: Record<RouteLang, IsoLang> = {
  kr: 'ko', en: 'en', ja: 'ja', cn: 'zh', es: 'es', ar: 'ar',
};

const ISO_TO_ROUTE: Record<IsoLang, RouteLang> = {
  ko: 'kr', en: 'en', ja: 'ja', zh: 'cn', es: 'es', ar: 'ar',
};

export function isSupportedLang(value: string): value is RouteLang {
  return (SUPPORTED_LANGS as string[]).includes(value);
}

export function toRouteLang(value: string | undefined | null): RouteLang {
  if (!value) return DEFAULT_LANG;
  // Accept values from browser/OS locale APIs as well as URL segments. The
  // public URL is always the six-segment route vocabulary, while persisted
  // users and OAuth providers commonly send ko-KR/zh-Hans style values.
  const normalized = value.trim().toLowerCase().replace(/_/g, '-');
  if (isSupportedLang(normalized)) return normalized;
  if (normalized in LEGACY_ROUTE_LANGS) return LEGACY_ROUTE_LANGS[normalized];
  if (normalized in ISO_TO_ROUTE) return ISO_TO_ROUTE[normalized as IsoLang];
  const base = normalized.split('-')[0];
  if (base in ISO_TO_ROUTE) return ISO_TO_ROUTE[base as IsoLang];
  return DEFAULT_LANG;
}

/**
 * Canonicalises only the first URL segment. Query strings are handled by the
 * caller so this helper stays usable in Edge middleware and unit tests.
 */
export function canonicalizeLocalePath(pathname: string): string {
  const match = pathname.match(/^\/(ko|zh|jp)(?=\/|$)/);
  if (!match) return pathname;
  return `/${LEGACY_ROUTE_LANGS[match[1]]}${pathname.slice(match[0].length)}`;
}

/**
 * Maps a URL lang segment (`kr`, `cn`, …) or legacy ISO (`ko`, `zh`) to a stable UI locale id.
 *
 * **Commercial CAD / new features:** use the return value as the key for inline string tables
 * that define **all six** locales together: `ko`, `en`, `ja`, `zh`, `es`, `ar`
 * (same set as `SUPPORTED_LANGS` via `ROUTE_TO_ISO`). Do not add user-visible strings for only
 * English and Korean — ship every feature with six entries or block the PR.
 */
export function toIsoLang(value: string | undefined | null): IsoLang {
  const route = toRouteLang(value);
  return ROUTE_TO_ISO[route];
}

// Preferred gate for Korean UI branches. Accepts 'kr' (route), 'ko' (iso), or
// legacy 'ko_KR'/'ko-KR' variants.
export function isKorean(lang: string | undefined | null): boolean {
  if (!lang) return false;
  return lang === 'kr' || lang === 'ko' || lang.toLowerCase().startsWith('ko');
}

// Preferred gate for Chinese UI branches. Accepts 'cn' (route), 'zh' (iso), or
// legacy 'zh_CN'/'zh-CN'/'zh-Hans' variants.
export function isChinese(lang: string | undefined | null): boolean {
  if (!lang) return false;
  return lang === 'cn' || lang === 'zh' || lang.toLowerCase().startsWith('zh');
}

// Direction for RTL languages. Used by layout/<html dir=...>.
export function langDir(lang: string | undefined | null): 'ltr' | 'rtl' {
  return toRouteLang(lang) === 'ar' ? 'rtl' : 'ltr';
}
