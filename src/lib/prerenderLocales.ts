export const SUPPORTED_LOCALES = ['kr', 'en', 'ja', 'cn', 'es', 'ar'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Web builds pre-render the two primary locales and generate the remaining
 * global locales on their first request. Desktop static export still requires
 * every locale because it has no server-side fallback.
 */
export function resolvePrerenderLocales(value: string | undefined, isStaticExport = false): SupportedLocale[] {
  if (isStaticExport) return [...SUPPORTED_LOCALES];
  const requested = (value?.trim() || 'kr,en')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter((item): item is SupportedLocale => (SUPPORTED_LOCALES as readonly string[]).includes(item));
  const unique = [...new Set(requested)];
  return unique.length > 0 ? unique : ['kr', 'en'];
}
