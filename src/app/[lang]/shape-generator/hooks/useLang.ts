import { usePathname } from 'next/navigation';
import type { shapeDict } from '../shapeDict';

type Lang = keyof typeof shapeDict;

export type { Lang };

export function useLang(): Lang {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const map: Record<string, Lang> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
  return map[seg] ?? 'en';
}
