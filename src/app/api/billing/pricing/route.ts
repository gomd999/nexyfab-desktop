/**
 * GET /api/billing/pricing
 *
 * 국가별 가격 정책:
 *   지원 국가 22개 (tier1): 각국 현지 통화 고정 가격 반환
 *   비지원 국가 (tier2):    USD 기준 + Airwallex 카드 결제
 *
 * Query params:
 *   ?country=KR         — 국가 코드 강제 지정
 *   ?currency=BRL       — (tier2 전용) 표시 통화 변경
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  detectCountryFromRequest,
  getCurrencyForCountry,
  getPlanPrice,
  getUsagePrice,
  getPaymentMethodsForCountry,
  getTaxConfig,
  formatPrice,
  isTier1Country,
  SUPPORTED_COUNTRIES,
  PLAN_PRICES,
  type CountryCode,
  type CurrencyCode,
  type Plan,
} from '@/lib/country-pricing';
import {
  getFxRates,
  convertUsd,
  fmtConverted,
  getFxCacheInfo,
} from '@/lib/fx-rates';

const PLANS: Plan[] = ['free', 'pro', 'team', 'enterprise'];
const USAGE_METRICS = ['rfq_submission', 'render_3d', 'team_seat', 'api_call_1k', 'storage_gb'];

export async function GET(req: NextRequest) {
  const queryCountry  = req.nextUrl.searchParams.get('country') as CountryCode | null;
  const queryCurrency = req.nextUrl.searchParams.get('currency') as CurrencyCode | null;

  const country: CountryCode = queryCountry ?? detectCountryFromRequest(req.headers);
  // 모든 국가 현지 통화. COUNTRY_CURRENCY에 없으면 USD fallback.
  const tier         = isTier1Country(country) ? 'tier1' : 'tier2';
  const baseCurrency: CurrencyCode = getCurrencyForCountry(country); // 항상 현지통화
  const isNative     = true; // 전체 현지통화 정책

  // tier2에서 유저가 원하면 표시 통화 변경 가능
  const displayCurrency: CurrencyCode = queryCurrency ?? baseCurrency;

  const taxCfg = getTaxConfig(country);
  const methods = getPaymentMethodsForCountry(country);

  // tier2 국가의 표시 통화 변환용 (tier1은 baseCurrency 고정이라 불필요)
  let fxRates: Record<string, number> = {};
  let fxInfo = getFxCacheInfo();
  if (tier === 'tier2' && queryCurrency && queryCurrency !== baseCurrency) {
    fxRates = await getFxRates();
    fxInfo  = getFxCacheInfo();
  }

  // ── 플랜 가격 ──────────────────────────────────────────────────────────
  const plans = PLANS.map(plan => {
    const basePrice = isNative
      ? getPlanPrice(plan, baseCurrency)
      : (PLAN_PRICES['USD'][plan] as number);

    // 세금
    const taxMult   = baseCurrency === 'KRW' || baseCurrency === 'JPY' || baseCurrency === 'IDR' || baseCurrency === 'VND' ? 1 : 100;
    const taxAmount = taxCfg.included ? 0 : Math.round(basePrice * taxCfg.rate * taxMult) / taxMult;
    const totalPrice = basePrice + taxAmount;

    // 환율 제안 (다언어 국가, 현지 통화가 USD가 아닐 때)
    let fxSuggestion: null | { currency: string; amount: number; formatted: string; rateNote: string } = null;
    if (!isNative && displayCurrency !== 'USD' && fxRates[displayCurrency]) {
      const localAmt = convertUsd(totalPrice, displayCurrency, fxRates);
      fxSuggestion = {
        currency:  displayCurrency,
        amount:    localAmt,
        formatted: fmtConverted(localAmt, displayCurrency),
        rateNote:  `1 USD ≈ ${fmtConverted(fxRates[displayCurrency], displayCurrency)}`,
      };
    }

    return {
      plan,
      isNativeCurrency:    isNative,
      currency:            baseCurrency,
      basePrice,
      taxAmount,
      totalPrice,
      basePriceFormatted:  isNative ? formatPrice(basePrice, baseCurrency) : `$${basePrice}`,
      totalPriceFormatted: isNative ? formatPrice(totalPrice, baseCurrency) : `$${totalPrice}`,
      taxInfo: taxCfg.rate > 0
        ? `${taxCfg.nameLocal || taxCfg.name} ${Math.round(taxCfg.rate * 100)}% ${taxCfg.included ? '포함' : '별도'}`
        : null,
      fxSuggestion,
    };
  });

  // ── 초과 사용 요금 ─────────────────────────────────────────────────────
  const usageOverages = USAGE_METRICS.map(metric => {
    const price = isNative
      ? getUsagePrice(metric, baseCurrency)
      : getUsagePrice(metric, 'USD');

    let fxSuggestion = null;
    if (!isNative && displayCurrency !== 'USD' && fxRates[displayCurrency]) {
      const localAmt = convertUsd(price, displayCurrency, fxRates);
      fxSuggestion = {
        currency: displayCurrency,
        amount:   localAmt,
        formatted: fmtConverted(localAmt, displayCurrency),
      };
    }

    return {
      metric,
      price,
      priceFormatted: isNative ? formatPrice(price, baseCurrency) : `$${price}`,
      fxSuggestion,
    };
  });

  return NextResponse.json({
    country,
    currency:         baseCurrency,
    displayCurrency,
    isNativeCurrency: isNative,
    tax:              taxCfg,
    plans,
    usageOverages,
    paymentMethods: methods.map(m => ({
      id: m.id, label: m.label, labelEn: m.labelEn,
      icon: m.icon, provider: m.provider, note: m.note ?? null,
    })),
    availableCurrencies: Object.keys(PLAN_PRICES),
    fxMeta: isNative ? null : {
      base:       'USD',
      displayIn:  displayCurrency,
      rate:       fxRates[displayCurrency] ?? null,
      cachedAt:   fxInfo.cachedAt,
      ageMinutes: fxInfo.ageMinutes,
      disclaimer: '실시간 환율은 참고용입니다. 실제 청구 금액은 Airwallex FX 기준으로 처리됩니다.',
    },
    tier,
    // Tier 2: 카드결제만 지원, USD 기준
    ...(tier === 'tier2' && {
      tier2Note: 'Your country is billed in USD via Airwallex card payment. Local payment methods are not available.',
    }),
    supportedCountries: SUPPORTED_COUNTRIES,
  });
}
