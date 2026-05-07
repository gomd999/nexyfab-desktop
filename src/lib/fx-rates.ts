/**
 * Live FX Rate fetcher — Frankfurter API (무료, API 키 불필요)
 * https://www.frankfurter.app
 *
 * 캐시 전략: 6시간 in-memory cache (Edge/Node 환경 모두 동작)
 * USD 기준 모든 지원 통화 환율 반환.
 *
 * 참고: 실제 결제 금액은 Airwallex가 자체 FX 적용 — 이 환율은
 *       "오늘 기준 약 얼마예요" 안내용(UX)으로만 사용.
 */

import type { CurrencyCode } from './country-pricing';

// ─── Cache ────────────────────────────────────────────────────────────────────

interface FxCache {
  rates:     Record<string, number>;
  base:      string;
  fetchedAt: number;
}

// module-level singleton (서버 인스턴스 내 공유)
let _cache: FxCache | null = null;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6시간

// ─── Supported currencies ─────────────────────────────────────────────────────

const SUPPORTED: CurrencyCode[] = [
  'KRW','JPY','CNY','INR','IDR','PHP','VND','THB','MYR','SGD',
  'AUD','BRL','MXN','GBP','EUR','TRY','AED','SAR','EGP','NGN',
];

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchRates(): Promise<FxCache> {
  const symbols = SUPPORTED.filter(c => c !== 'USD').join(',');
  const res = await fetch(
    `https://api.frankfurter.app/latest?from=USD&to=${symbols}`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
  const data = await res.json() as { base: string; rates: Record<string, number> };
  return {
    rates:     { ...data.rates, USD: 1 },
    base:      'USD',
    fetchedAt: Date.now(),
  };
}

/** USD 기준 환율 반환 (캐시 히트 시 즉시 반환) */
export async function getFxRates(): Promise<Record<string, number>> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL) {
    return _cache.rates;
  }
  try {
    _cache = await fetchRates();
    return _cache.rates;
  } catch (err) {
    console.warn('[fx-rates] fetch failed, using fallback:', err);
    // fallback: 하드코딩 환율 (Frankfurter 다운 시)
    return FALLBACK_RATES;
  }
}

/** amount(USD) → 목표 통화 변환 */
export function convertUsd(usdAmount: number, toCurrency: string, rates: Record<string, number>): number {
  const rate = rates[toCurrency] ?? 1;
  return usdAmount * rate;
}

/** 표시용 포맷 (소수점 0~2자리 자동) */
export function fmtConverted(amount: number, currency: string): string {
  // 0-decimal currencies
  const zero = ['KRW','JPY','VND','IDR','NGN'];
  // 3-decimal currencies (이번 지원 국가에서는 제거했지만 안전 처리)
  const three = ['KWD','BHD','OMR','JOD'];

  const decimals = zero.includes(currency) ? 0
    : three.includes(currency) ? 3
    : 2;

  return new Intl.NumberFormat('en-US', {
    style:                 'currency',
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    currencyDisplay:       'symbol',
  }).format(amount);
}

// ─── Staleness info ───────────────────────────────────────────────────────────

export function getFxCacheInfo(): { cachedAt: number | null; ageMinutes: number | null } {
  if (!_cache) return { cachedAt: null, ageMinutes: null };
  return {
    cachedAt:   _cache.fetchedAt,
    ageMinutes: Math.floor((Date.now() - _cache.fetchedAt) / 60_000),
  };
}

// ─── Fallback rates (approx 2025 rates, USD base) ────────────────────────────

export const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  KRW: 1_370,
  JPY: 153,
  CNY: 7.26,
  INR: 83.5,
  IDR: 15_900,
  PHP: 57.5,
  VND: 25_400,
  THB: 35.5,
  MYR: 4.67,
  SGD: 1.34,
  AUD: 1.53,
  BRL: 5.05,
  MXN: 17.2,
  GBP: 0.79,
  EUR: 0.92,
  TRY: 32.5,
  AED: 3.67,
  SAR: 3.75,
  EGP: 48.5,
  NGN: 1_560,
};
