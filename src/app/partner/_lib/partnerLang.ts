// Partner-portal language helper. The partner portal lives outside the
// customer [lang] segment, so we read the preference from (in order):
//   1. ?lang= query param   — set by cross-surface entries from customer
//   2. localStorage.nf_partner_lang   — persisted between visits
//   3. document.documentElement.lang  — last-resort default
//
// Returns a normalised 2-letter route lang (ko/en/ja/cn/es/ar). Once
// resolved we patch <html lang> + <html dir> on the client so Arabic
// flips to RTL even though the SSR'd html tag was rendered with the
// Korean default in layout.tsx.

'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

export type PartnerLang = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';
const STORAGE_KEY = 'nf_partner_lang';
const VALID: PartnerLang[] = ['ko', 'en', 'ja', 'cn', 'es', 'ar'];

function normalise(input: string | null | undefined): PartnerLang | null {
  if (!input) return null;
  const lower = input.toLowerCase().slice(0, 2);
  // Aliases: kr→ko, zh→cn.
  if (lower === 'kr') return 'ko';
  if (lower === 'zh') return 'cn';
  return (VALID as readonly string[]).includes(lower) ? (lower as PartnerLang) : null;
}

/**
 * Resolves the active partner-portal language. Defaults to 'ko' until the
 * first effect tick because most existing partner pages are Korean-only
 * — that keeps the SSR HTML stable for screen-readers and skip-links.
 */
function applyHtmlLang(lang: PartnerLang) {
  try {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  } catch { /* SSR / sandboxed */ }
}

export function usePartnerLang(): PartnerLang {
  const search = useSearchParams();
  const [lang, setLang] = useState<PartnerLang>('ko');

  useEffect(() => {
    const fromQuery = normalise(search?.get('lang'));
    if (fromQuery) {
      setLang(fromQuery);
      applyHtmlLang(fromQuery);
      try { window.localStorage.setItem(STORAGE_KEY, fromQuery); } catch { /* ignore */ }
      return;
    }
    try {
      const stored = normalise(window.localStorage.getItem(STORAGE_KEY));
      if (stored) {
        setLang(stored);
        applyHtmlLang(stored);
        return;
      }
    } catch { /* ignore */ }
    const fromHtml = normalise(document.documentElement.lang);
    if (fromHtml) {
      setLang(fromHtml);
      applyHtmlLang(fromHtml);
    }
  }, [search]);

  return lang;
}

export function isKoreanPartner(lang: PartnerLang): boolean {
  return lang === 'ko';
}
