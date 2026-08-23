import { toIsoLang, type IsoLang } from './normalize';

export type LocalizedCatalog = Record<string, Record<Exclude<IsoLang, 'ko' | 'en'>, string>>;

// The generated commercial catalog contains a bare `{{0}}` entry for numeric
// count labels (for example, `3個`). It is intentionally not a wildcard for
// arbitrary tokens: matching it against units or identifiers would append a
// count suffix to values such as `₩/kg` and `material`.
const isCountLikeValue = (value: string) => /^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(value.trim());

export function createCatalogLocalizer(lang: string | undefined | null, catalog: LocalizedCatalog) {
  const locale = toIsoLang(lang);
  const templates = Object.entries(catalog)
    .filter(([key]) => /\{\{\d+\}\}/.test(key))
    .map(([key, translations]) => {
      const chunks = key.split(/\{\{\d+\}\}/);
      const placeholders = key.match(/\{\{\d+\}\}/g) ?? [];
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = chunks.map((chunk, index) => `${escape(chunk)}${index < placeholders.length ? '(.+?)' : ''}`).join('');
      return { key, regex: new RegExp(`^${source}$`, 's'), translations };
    });

  return function localize<T>(korean: T, english: T): T {
    if (locale === 'ko') return korean;
    if (locale === 'en' || typeof english !== 'string') return english;
    const exact = catalog[english]?.[locale];
    if (exact) return exact as T;
    for (const template of templates) {
      const match = english.match(template.regex);
      if (!match) continue;
      if (template.key === '{{0}}' && !isCountLikeValue(match[1] ?? '')) continue;
      return template.translations[locale].replace(/\{\{(\d+)\}\}/g, (_, index: string) => match[Number(index) + 1] ?? '') as T;
    }
    return english;
  };
}

export function createFlatCatalogLocalizer(
  lang: string | undefined | null,
  catalog: Record<string, string> | undefined,
) {
  const locale = toIsoLang(lang);
  const entries = Object.entries(catalog ?? {});
  const templates = entries
    .filter(([key]) => /\{\{\d+\}\}/.test(key))
    .map(([key, translation]) => {
      const chunks = key.split(/\{\{\d+\}\}/);
      const placeholders = key.match(/\{\{\d+\}\}/g) ?? [];
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const source = chunks.map((chunk, index) => `${escape(chunk)}${index < placeholders.length ? '(.+?)' : ''}`).join('');
      return { key, regex: new RegExp(`^${source}$`, 's'), translation };
    });
  return function localize<T>(korean: T, english: T): T {
    if (locale === 'ko') return korean;
    if (locale === 'en' || typeof english !== 'string') return english;
    if (catalog?.[english]) return catalog[english] as T;
    for (const template of templates) {
      const match = english.match(template.regex);
      if (!match) continue;
      if (template.key === '{{0}}' && !isCountLikeValue(match[1] ?? '')) continue;
      return template.translation.replace(/\{\{(\d+)\}\}/g, (_, index: string) => match[Number(index) + 1] ?? '') as T;
    }
    return english;
  };
}
