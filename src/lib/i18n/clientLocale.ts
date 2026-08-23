'use client';

import { useEffect, useState } from 'react';
import { toIsoLang, type IsoLang } from './normalize';

/** Resolve the language used by non-/[lang] client screens. */
export function readClientLocale(): IsoLang {
  if (typeof window === 'undefined') return 'en';
  const cookies = new Map(document.cookie
    .split(';')
    .map((part) => part.trim().split('='))
    .filter(([key]) => Boolean(key)) as Array<[string, string]>);
  for (const key of ['nf_lang', 'NEXT_LOCALE', 'nf_locale', 'nf_language', 'locale', 'lang']) {
    const cookieValue = cookies.get(key);
    if (cookieValue) return toIsoLang(decodeURIComponent(cookieValue));
  }
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const storedLocale = storage.getItem('nf_lang');
      if (storedLocale) return toIsoLang(storedLocale);
    } catch { /* storage can be unavailable in private browsing */ }
  }
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = storage.getItem('currentUser');
      if (raw) {
        const user = JSON.parse(raw) as { language?: string };
        if (user.language) return toIsoLang(user.language);
      }
    } catch { /* storage can be unavailable in private browsing */ }
  }
  return toIsoLang(window.navigator.language || 'en');
}

/** Hydration-safe locale state for client-only screens without a lang route. */
export function useClientLocale(): IsoLang {
  const [locale, setLocale] = useState<IsoLang>('en');
  useEffect(() => {
    const timer = window.setTimeout(() => setLocale(readClientLocale()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);
  return locale;
}
