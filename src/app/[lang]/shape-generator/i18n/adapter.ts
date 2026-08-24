import { langDir, toIsoLang } from '@/lib/i18n/normalize';
import { resolveCadMessage, type ResolvedCadMessage } from '@/lib/cad/i18n/catalog';
import type { CadMessage } from '@/lib/cad/i18n/message';
import { formatCadInstant, formatCadNumber, formatCadQuantity, type CanonicalInstant, type CanonicalQuantity } from '@/lib/cad/i18n/format';

export interface ShapeGeneratorLocaleMetadata { locale: ReturnType<typeof toIsoLang>; direction: 'ltr' | 'rtl'; }

function boundedLang(value: string | undefined | null): string | undefined {
  return typeof value === 'string' && value.length <= 64 ? value : undefined;
}

export function shapeGeneratorLocale(lang: string | undefined | null): ShapeGeneratorLocaleMetadata {
  const safeLang = boundedLang(lang);
  return { locale: toIsoLang(safeLang), direction: langDir(safeLang) };
}
export function translateCadMessage(message: CadMessage, lang: string | undefined | null): ResolvedCadMessage {
  return resolveCadMessage(message, toIsoLang(boundedLang(lang)));
}
export { formatCadInstant, formatCadNumber, formatCadQuantity };
export type { CanonicalInstant, CanonicalQuantity };
