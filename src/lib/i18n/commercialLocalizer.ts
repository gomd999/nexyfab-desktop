import catalogJson from './commercialTranslations.generated.json';
import { createCatalogLocalizer, type LocalizedCatalog } from './catalogLocalizer';

/** Static, runtime-network-free localizer for migrated bilingual commercial UI. */
export function createCommercialLocalizer(lang: string | undefined | null) {
  return createCatalogLocalizer(lang, catalogJson as LocalizedCatalog);
}

/** Localize a legacy pair of structurally identical ko/en dictionaries without runtime network calls. */
export function localizeCommercialDictionary<T>(lang: string | undefined | null, korean: T, english: T): T {
  const L = createCommercialLocalizer(lang);
  const walk = (ko: unknown, en: unknown): unknown => {
    if (typeof en === 'string') return L(typeof ko === 'string' ? ko : en, en);
    if (typeof en === 'function') {
      return (...args: unknown[]) => walk(typeof ko === 'function' ? ko(...args) : undefined, en(...args));
    }
    if (Array.isArray(en)) return en.map((item, index) => walk(Array.isArray(ko) ? ko[index] : undefined, item));
    if (en && typeof en === 'object') {
      return Object.fromEntries(Object.entries(en).map(([key, value]) => [
        key,
        walk(ko && typeof ko === 'object' ? (ko as Record<string, unknown>)[key] : undefined, value),
      ]));
    }
    return en;
  };
  return walk(korean, english) as T;
}
