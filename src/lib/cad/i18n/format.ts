import { toIsoLang } from '@/lib/i18n/normalize';
import type { CadLocale } from './message';

export type CanonicalUnit = 'mm' | 'deg' | 'kg' | 's';
export interface CanonicalQuantity { readonly value: number; readonly unit: CanonicalUnit; }
export interface CanonicalInstant { readonly iso: string; readonly timezone: string; }

const bcp47: Record<CadLocale, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', es: 'es-ES', ar: 'ar',
};
const UNITS = new Set<CanonicalUnit>(['mm', 'deg', 'kg', 's']);
const RFC3339_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u;
const MAX_OPTION_KEYS = 32;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function dataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function displayLocale(locale: string | undefined | null): string {
  const safe = typeof locale === 'string' && locale.length <= 64 ? locale : 'en';
  return bcp47[toIsoLang(safe)];
}

function safeNumberOptions(options: Intl.NumberFormatOptions): Intl.NumberFormatOptions {
  if (!isPlainRecord(options) || Object.keys(options).length > MAX_OPTION_KEYS) throw new Error('invalid_number_options');
  const detached: Record<string, unknown> = {};
  for (const key of Object.keys(options)) detached[key] = dataValue(options, key);
  return detached as Intl.NumberFormatOptions;
}

function validQuantity(value: unknown): value is CanonicalQuantity {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  const numeric = dataValue(value, 'value');
  const unit = dataValue(value, 'unit');
  return keys.length === 2
    && keys[0] === 'unit'
    && keys[1] === 'value'
    && typeof numeric === 'number'
    && Number.isFinite(numeric)
    && typeof unit === 'string'
    && UNITS.has(unit as CanonicalUnit);
}

function validCalendarParts(year: number, month: number, day: number, hour: number, minute: number, second: number, zone: string): boolean {
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > monthDays[month - 1]!) return false;
  if (zone !== 'Z') {
    const zoneHour = Number(zone.slice(1, 3));
    const zoneMinute = Number(zone.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) return false;
  }
  return true;
}

function validInstant(value: unknown): value is CanonicalInstant {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== 'iso' || keys[1] !== 'timezone') return false;
  const iso = dataValue(value, 'iso');
  const timezone = dataValue(value, 'timezone');
  if (typeof iso !== 'string' || iso.length > 64 || typeof timezone !== 'string' || timezone.length > 128) return false;
  if (!timezone.trim() || /[<>\u0000-\u001F\u007F]/u.test(timezone)) return false;
  const parts = RFC3339_INSTANT.exec(iso);
  if (!parts) return false;
  const validParts = validCalendarParts(
    Number(parts[1]), Number(parts[2]), Number(parts[3]), Number(parts[4]),
    Number(parts[5]), Number(parts[6]), parts[7]!,
  );
  if (!validParts) return false;
  return !Number.isNaN(new Date(iso).getTime());
}

export function formatCadNumber(
  value: number,
  locale: string | undefined | null,
  options: Intl.NumberFormatOptions = {},
): string {
  if (!Number.isFinite(value)) throw new Error('invalid_canonical_number');
  try {
    return new Intl.NumberFormat(displayLocale(locale), safeNumberOptions(options)).format(value);
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_number_options') throw error;
    throw new Error('invalid_number_options');
  }
}

/** Display-only formatting; the canonical quantity remains untouched. */
export function formatCadQuantity(quantity: CanonicalQuantity, locale: string | undefined | null): string {
  if (!validQuantity(quantity)) throw new Error('invalid_canonical_quantity');
  const record = quantity as unknown as Record<string, unknown>;
  return `${formatCadNumber(dataValue(record, 'value') as number, locale)} ${dataValue(record, 'unit') as CanonicalUnit}`;
}

/** Display an RFC3339 instant in the declared timezone without changing storage. */
export function formatCadInstant(instant: CanonicalInstant, locale: string | undefined | null): string {
  if (!validInstant(instant)) throw new Error('invalid_canonical_instant');
  try {
    const record = instant as unknown as Record<string, unknown>;
    return new Intl.DateTimeFormat(displayLocale(locale), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: dataValue(record, 'timezone') as string,
    }).format(new Date(dataValue(record, 'iso') as string));
  } catch {
    throw new Error('invalid_canonical_timezone');
  }
}
