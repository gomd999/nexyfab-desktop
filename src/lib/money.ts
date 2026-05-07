/**
 * money.ts — Multi-currency amount handling for orders/quotes/invoices.
 *
 * Why a dedicated module: payments span KRW (no decimals, Toss) and
 * USD/EUR/etc. (cents, Airwallex). Mixing those without a common shape
 * leads to off-by-100 bugs that only surface in production.
 *
 * The Money type is the canonical in-app amount: a `value` field in the
 * **major unit** (e.g., 19.99 USD, 25000 KRW) plus an ISO-4217 currency
 * code. Conversion to provider-specific minor units happens at the
 * boundary via `toMinorUnits()` (Airwallex: smallest unit; Toss: KRW
 * integer).
 *
 * FX lock-in: quotes capture an `FxQuote` at creation time so the
 * customer's accepted price doesn't move when the spot rate does later.
 * Default validity is 7 days (matches B2B quote norms).
 */

import { CURRENCIES, type CurrencyCode } from './country-pricing';
import { getFxRates, FALLBACK_RATES } from './fx-rates';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Money {
  /** Amount in major units (29000 KRW, 19.99 USD). */
  value:    number;
  currency: CurrencyCode;
}

export interface FxQuote {
  base:           CurrencyCode;     // e.g., 'USD'
  rates:          Partial<Record<CurrencyCode, number>>;
  /** Wall-clock ms when this quote was captured. */
  lockedAt:       number;
  /** Wall-clock ms after which the quote should not be honored. */
  validUntil:     number;
  source:         'frankfurter' | 'fallback' | 'manual';
}

const DEFAULT_VALIDITY_DAYS = 7;

// ─── Construction / parsing ───────────────────────────────────────────────────

export function money(value: number, currency: CurrencyCode): Money {
  return { value, currency };
}

/** Round a value to the currency's display precision. */
export function roundForCurrency(value: number, currency: CurrencyCode): number {
  const decimals = CURRENCIES[currency]?.decimals ?? 2;
  if (decimals === 0) return Math.round(value);
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}

// ─── Provider boundary ────────────────────────────────────────────────────────

/**
 * Convert major-unit Money → provider's smallest unit integer.
 * Airwallex/Stripe both want this (e.g., USD 19.99 → 1999, KRW 25000 → 25000).
 */
export function toMinorUnits(m: Money): number {
  const decimals = CURRENCIES[m.currency]?.decimals ?? 2;
  return Math.round(m.value * Math.pow(10, decimals));
}

export function fromMinorUnits(amount: number, currency: CurrencyCode): Money {
  const decimals = CURRENCIES[currency]?.decimals ?? 2;
  return { value: amount / Math.pow(10, decimals), currency };
}

// ─── Display ──────────────────────────────────────────────────────────────────

export function formatMoney(m: Money): string {
  const cfg = CURRENCIES[m.currency];
  if (!cfg) return `${m.value} ${m.currency}`;
  return new Intl.NumberFormat(cfg.locale, {
    style:                 'currency',
    currency:              cfg.code,
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  }).format(m.value);
}

// ─── FX quote (lock-in) ───────────────────────────────────────────────────────

/**
 * Capture a fresh FX snapshot the quote/order can be priced from.
 * Falls back to hardcoded rates if the live API fails — better to honor
 * a slightly stale rate than to block the partner from quoting.
 */
export async function captureFxQuote(
  base: CurrencyCode = 'USD',
  validityDays = DEFAULT_VALIDITY_DAYS,
): Promise<FxQuote> {
  let rates: Record<string, number>;
  let source: FxQuote['source'] = 'frankfurter';
  try {
    rates = await getFxRates();
  } catch {
    rates = FALLBACK_RATES;
    source = 'fallback';
  }
  const now = Date.now();
  return {
    base,
    rates: rates as Partial<Record<CurrencyCode, number>>,
    lockedAt:   now,
    validUntil: now + validityDays * 86_400_000,
    source,
  };
}

/** Treat a stored FxQuote as valid only when not yet expired. */
export function isFxQuoteValid(q: FxQuote, now = Date.now()): boolean {
  return now <= q.validUntil;
}

/**
 * Convert a Money amount using a captured FxQuote.
 * Source rates are USD-based (Frankfurter convention), so we route
 * everything through USD: amount → USD → target.
 */
export function convertMoney(amount: Money, target: CurrencyCode, fx: FxQuote): Money {
  if (amount.currency === target) return amount;
  const usdRateFrom = amount.currency === 'USD' ? 1 : fx.rates[amount.currency];
  const usdRateTo   = target === 'USD'        ? 1 : fx.rates[target];
  if (!usdRateFrom || !usdRateTo) {
    throw new Error(`[money] missing FX rate ${amount.currency}→${target}`);
  }
  const usd = amount.value / usdRateFrom;
  const out = usd * usdRateTo;
  return { value: roundForCurrency(out, target), currency: target };
}

// ─── Persistence helpers ──────────────────────────────────────────────────────
//
// Database rows store FxQuote as JSON in a single TEXT column to avoid
// table sprawl. These helpers keep the (de)serialization in one place.

export function serializeFxQuote(q: FxQuote): string {
  return JSON.stringify(q);
}

export function parseFxQuote(raw: string | null | undefined): FxQuote | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as FxQuote;
    if (!obj.base || !obj.rates || !obj.lockedAt || !obj.validUntil) return null;
    return obj;
  } catch {
    return null;
  }
}
