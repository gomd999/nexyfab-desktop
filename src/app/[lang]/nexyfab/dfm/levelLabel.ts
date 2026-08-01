// Sibling module (not inside page.tsx) — Next.js Page files may only export the
// default component + a small allow-list (generateMetadata, etc). Exporting a
// helper straight from page.tsx fails `next build`'s TypeScript route-type
// check even though local `tsc --noEmit` doesn't catch it.
import type { DfmCheckItem } from '@/lib/dfm-rules';

const LEVEL_COLORS: Record<DfmCheckItem['level'], { bg: string; fg: string; labelKo: string; labelEn: string }> = {
  error:   { bg: '#fee2e2', fg: '#991b1b', labelKo: '오류', labelEn: 'Error' },
  warning: { bg: '#fef3c7', fg: '#92400e', labelKo: '경고', labelEn: 'Warning' },
  info:    { bg: '#dbeafe', fg: '#1e40af', labelKo: '정보', labelEn: 'Info' },
};

export function levelLabel(level: DfmCheckItem['level'], isKo: boolean): string {
  return isKo ? LEVEL_COLORS[level].labelKo : LEVEL_COLORS[level].labelEn;
}

export { LEVEL_COLORS };
