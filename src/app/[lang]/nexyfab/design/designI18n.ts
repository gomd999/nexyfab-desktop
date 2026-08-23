import { loc } from '@/lib/i18n/loc';

/** Typed six-locale copy used by the design/CAD panels. */
export type DesignCopy = {
  ko: string;
  en: string;
  ja: string;
  zh: string;
  es: string;
  ar: string;
};

export function designLoc(lang: string | undefined | null, copy: DesignCopy): string {
  return loc(lang, copy);
}

/** A safe migration helper for legacy Korean/English API data. */
export function designPair(lang: string | undefined | null, ko: string | undefined, en: string | undefined): string {
  const korean = ko ?? en ?? '';
  const english = en ?? ko ?? '';
  return designLoc(lang, { ko: korean, en: english, ja: english, zh: english, es: english, ar: english });
}

export function designList(lang: string | undefined | null, copy: {
  ko: string[];
  en: string[];
  ja: string[];
  zh: string[];
  es: string[];
  ar: string[];
}): string[] {
  const key = (lang ?? 'en').toLowerCase().replace(/^kr$/, 'ko').replace(/^cn$/, 'zh') as keyof typeof copy;
  return copy[key] ?? copy.en;
}
