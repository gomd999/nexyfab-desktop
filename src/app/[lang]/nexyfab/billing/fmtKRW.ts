// Sibling module (not inside page.tsx) — Next.js Page files may only export the
// default component + a small allow-list (generateMetadata, etc). Exporting a
// helper straight from page.tsx fails `next build`'s TypeScript route-type
// check even though local `tsc --noEmit` doesn't catch it.
//
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

// Unit suffix must follow the page language: this used to append the
// Korean word '원' unconditionally, so non-Korean users saw prices like
// "49,000원" with no English rendering of the currency unit at all — see
// page.i18n.test.tsx.
export function fmtKRW(n: number | null, language: boolean | string): string {
  const iso = typeof language === 'boolean' ? (language ? 'ko' : 'en') : toIsoLang(language);
  const free: Record<IsoLang, string> = { ko: '무료', en: 'Free', ja: '無料', zh: '免费', es: 'Gratis', ar: 'مجاني' };
  if (n === null || n === 0) return free[iso];
  const locale: Record<IsoLang, string> = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', es: 'es-ES', ar: 'ar-SA' };
  const value = new Intl.NumberFormat(locale[iso], { maximumFractionDigits: 0 }).format(n);
  const suffix: Record<IsoLang, string> = { ko: '원', en: ' KRW', ja: ' KRW', zh: ' 韩元', es: ' KRW', ar: ' وون كوري' };
  return value + suffix[iso];
}
