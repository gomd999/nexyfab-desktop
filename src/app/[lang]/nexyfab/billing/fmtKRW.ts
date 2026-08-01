// Sibling module (not inside page.tsx) — Next.js Page files may only export the
// default component + a small allow-list (generateMetadata, etc). Exporting a
// helper straight from page.tsx fails `next build`'s TypeScript route-type
// check even though local `tsc --noEmit` doesn't catch it.
//
// Unit suffix must follow the page's ko/en branch: this used to append the
// Korean word '원' unconditionally, so non-Korean users saw prices like
// "49,000원" with no English rendering of the currency unit at all — see
// page.i18n.test.tsx.
export function fmtKRW(n: number | null, isKo: boolean): string {
  if (n === null || n === 0) return isKo ? '무료' : 'Free';
  return isKo ? n.toLocaleString('ko-KR') + '원' : n.toLocaleString() + ' KRW';
}
