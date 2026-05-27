// Multi-currency support — picks the right invoicing currency from the
// user's country, converts KRW base prices to the local currency using
// daily FX rates, and falls back to USD when unknown.

import { TAX_RULES } from './tax-rates';

export type Currency = 'KRW' | 'USD' | 'EUR' | 'JPY' | 'GBP' | 'AUD' | 'CAD';

const FALLBACK_CURRENCY: Currency = 'USD';

// Country → currency. EU/EEA all → EUR.
export function currencyForCountry(country: string | null | undefined): Currency {
  if (!country) return FALLBACK_CURRENCY;
  const cc = country.toUpperCase();
  const rule = TAX_RULES[cc];
  if (rule) return rule.invoiceCurrency as Currency;
  // Common Anglosphere fallbacks.
  if (cc === 'US' || cc === 'MX' || cc === 'BR' || cc === 'CL') return 'USD';
  if (cc === 'CN' || cc === 'HK' || cc === 'TW' || cc === 'SG') return 'USD';
  return FALLBACK_CURRENCY;
}

/**
 * Approximate FX rates (KRW → target). Updated daily by /api/cron/fx-rates;
 * this is the fallback table for when the cron hasn't run yet or the rate
 * is unavailable. Rates as of 2026-05 mid-month.
 */
const FALLBACK_FX_FROM_KRW: Record<Currency, number> = {
  KRW: 1,
  USD: 1 / 1380,
  EUR: 1 / 1490,
  JPY: 1 / 9.0,
  GBP: 1 / 1730,
  AUD: 1 / 900,
  CAD: 1 / 1000,
};

/** In-process cache populated by setLiveFxRates() (called by the cron). */
let liveFx: Partial<Record<Currency, number>> = {};
let liveFxAt = 0;

export function setLiveFxRates(rates: Partial<Record<Currency, number>>): void {
  liveFx = rates;
  liveFxAt = Date.now();
}

/** Returns the current KRW→target multiplier, preferring live cache. */
export function fxFromKrw(target: Currency): number {
  if (target === 'KRW') return 1;
  const stale = Date.now() - liveFxAt > 36 * 60 * 60 * 1000;
  const live = !stale ? liveFx[target] : undefined;
  return live ?? FALLBACK_FX_FROM_KRW[target] ?? 1;
}

export interface PriceConversion {
  amount: number;
  currency: Currency;
  /** Amount in display-friendly minor units (e.g. cents/won). */
  displayAmount: number;
  displayLabel: string;
}

/**
 * Convert a KRW price into the user's local currency with sensible
 * rounding. JPY rounds to whole yen, KRW rounds to 100, others to 2dp.
 */
export function convertFromKrw(amountKrw: number, target: Currency): PriceConversion {
  const fx = fxFromKrw(target);
  const raw = amountKrw * fx;

  let displayAmount: number;
  let symbol: string;
  switch (target) {
    case 'KRW':
      displayAmount = Math.round(raw / 100) * 100;
      symbol = '₩';
      break;
    case 'JPY':
      displayAmount = Math.round(raw);
      symbol = '¥';
      break;
    case 'USD': displayAmount = Math.round(raw * 100) / 100; symbol = '$'; break;
    case 'EUR': displayAmount = Math.round(raw * 100) / 100; symbol = '€'; break;
    case 'GBP': displayAmount = Math.round(raw * 100) / 100; symbol = '£'; break;
    case 'AUD': displayAmount = Math.round(raw * 100) / 100; symbol = 'A$'; break;
    case 'CAD': displayAmount = Math.round(raw * 100) / 100; symbol = 'C$'; break;
  }

  const formatted =
    target === 'KRW' || target === 'JPY'
      ? displayAmount.toLocaleString('en-US', { maximumFractionDigits: 0 })
      : displayAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return {
    amount: amountKrw,
    currency: target,
    displayAmount,
    displayLabel: `${symbol}${formatted}`,
  };
}
