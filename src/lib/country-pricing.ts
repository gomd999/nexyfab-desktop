/**
 * Country-aware pricing for Nexysys products
 *
 * 선정 기준: 인구 1억 이상 OR 경제적 중요도가 높은 국가 (제조업 SaaS 타겟 시장)
 *
 * 포함 국가 (22개):
 *   아시아:  KR, JP, CN, IN, ID, PH, VN, TH, MY, SG
 *   오세아니아: AU
 *   아메리카: US, BR, MX
 *   유럽:    GB, DE, FR, TR
 *   중동/아프리카: AE, SA, EG, NG
 *
 * 제외 (인구 소규모 + 결제 인프라 미성숙):
 *   QA, KW, BH, OM, JO, LB, IQ, LY, TN, MA, DZ, IT, ES, NL
 *   (이탈리아/스페인/네덜란드는 EUR 통화로 자동 처리)
 *
 * 결제 PG 매핑:
 *   Airwallex: KR(카드), JP, CN, ID, PH, VN, TH, MY, SG, AU, US, GB, DE, FR, AE, SA
 *   Toss Payments: KR (카카오·네이버·토스페이)
 *   Razorpay:  IN (UPI, RuPay, NetBanking) — Airwallex India 미지원
 *   Stripe:    BR, MX (PIX, Boleto, OXXO) — Airwallex 중남미 커버리지 제한
 *   iyzico:    TR (로컬 카드)
 *   Paystack:  NG — Airwallex 나이지리아 미지원
 *   HyperPay:  SA (Mada), 중동 로컬 카드
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type CountryCode =
  // 아시아
  | 'KR' | 'JP' | 'CN' | 'IN' | 'ID' | 'PH' | 'VN' | 'TH' | 'MY' | 'SG'
  // 오세아니아
  | 'AU'
  // 아메리카
  | 'US' | 'BR' | 'MX'
  // 유럽
  | 'GB' | 'DE' | 'FR' | 'TR'
  // 중동/아프리카
  | 'AE' | 'SA' | 'EG' | 'NG'
  | string;

export type CurrencyCode =
  // 아시아
  | 'KRW' | 'JPY' | 'CNY' | 'INR' | 'IDR' | 'PHP' | 'VND' | 'THB' | 'MYR' | 'SGD'
  // 오세아니아
  | 'AUD'
  // 아메리카
  | 'USD' | 'BRL' | 'MXN'
  // 유럽
  | 'GBP' | 'EUR' | 'TRY'
  // 중동/아프리카
  | 'AED' | 'SAR' | 'EGP' | 'NGN';

export type Plan = 'free' | 'pro' | 'team' | 'enterprise';

// ─── Currency config ──────────────────────────────────────────────────────────

export interface CurrencyConfig {
  code:     CurrencyCode;
  symbol:   string;
  locale:   string;
  decimals: number;   // Airwallex smallest-unit multiplier exponent
  awCode:   string;
  rtl:      boolean;  // right-to-left display
}

export const CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  // ── 아시아 ──────────────────────────────────────────────────────────────
  KRW: { code: 'KRW', symbol: '₩',    locale: 'ko-KR', decimals: 0, awCode: 'KRW', rtl: false },
  JPY: { code: 'JPY', symbol: '¥',    locale: 'ja-JP', decimals: 0, awCode: 'JPY', rtl: false },
  CNY: { code: 'CNY', symbol: '¥',    locale: 'zh-CN', decimals: 2, awCode: 'CNY', rtl: false },
  INR: { code: 'INR', symbol: '₹',    locale: 'hi-IN', decimals: 2, awCode: 'INR', rtl: false },
  IDR: { code: 'IDR', symbol: 'Rp',   locale: 'id-ID', decimals: 0, awCode: 'IDR', rtl: false },
  PHP: { code: 'PHP', symbol: '₱',    locale: 'fil-PH',decimals: 2, awCode: 'PHP', rtl: false },
  VND: { code: 'VND', symbol: '₫',    locale: 'vi-VN', decimals: 0, awCode: 'VND', rtl: false },
  THB: { code: 'THB', symbol: '฿',    locale: 'th-TH', decimals: 2, awCode: 'THB', rtl: false },
  MYR: { code: 'MYR', symbol: 'RM',   locale: 'ms-MY', decimals: 2, awCode: 'MYR', rtl: false },
  SGD: { code: 'SGD', symbol: 'S$',   locale: 'en-SG', decimals: 2, awCode: 'SGD', rtl: false },
  // ── 오세아니아 ──────────────────────────────────────────────────────────
  AUD: { code: 'AUD', symbol: 'A$',   locale: 'en-AU', decimals: 2, awCode: 'AUD', rtl: false },
  // ── 아메리카 ────────────────────────────────────────────────────────────
  USD: { code: 'USD', symbol: '$',    locale: 'en-US', decimals: 2, awCode: 'USD', rtl: false },
  BRL: { code: 'BRL', symbol: 'R$',   locale: 'pt-BR', decimals: 2, awCode: 'BRL', rtl: false },
  MXN: { code: 'MXN', symbol: 'MX$',  locale: 'es-MX', decimals: 2, awCode: 'MXN', rtl: false },
  // ── 유럽 ────────────────────────────────────────────────────────────────
  GBP: { code: 'GBP', symbol: '£',   locale: 'en-GB', decimals: 2, awCode: 'GBP', rtl: false },
  EUR: { code: 'EUR', symbol: '€',    locale: 'de-DE', decimals: 2, awCode: 'EUR', rtl: false },
  TRY: { code: 'TRY', symbol: '₺',   locale: 'tr-TR', decimals: 2, awCode: 'TRY', rtl: false },
  // ── 중동/아프리카 ────────────────────────────────────────────────────────
  // AED: 소수점 2자리, RTL
  AED: { code: 'AED', symbol: 'د.إ', locale: 'ar-AE', decimals: 2, awCode: 'AED', rtl: true },
  // SAR: 소수점 2자리, RTL
  SAR: { code: 'SAR', symbol: '﷼',   locale: 'ar-SA', decimals: 2, awCode: 'SAR', rtl: true },
  // EGP: 소수점 2자리, RTL
  EGP: { code: 'EGP', symbol: 'ج.م', locale: 'ar-EG', decimals: 2, awCode: 'EGP', rtl: true },
  // NGN: 소수점 2자리
  NGN: { code: 'NGN', symbol: '₦',   locale: 'en-NG', decimals: 2, awCode: 'NGN', rtl: false },
};

// ─── Country → Currency ───────────────────────────────────────────────────────

export const COUNTRY_CURRENCY: Record<string, CurrencyCode> = {
  KR: 'KRW', JP: 'JPY', CN: 'CNY', IN: 'INR', ID: 'IDR',
  PH: 'PHP', VN: 'VND', TH: 'THB', MY: 'MYR', SG: 'SGD',
  AU: 'AUD',
  US: 'USD', BR: 'BRL', MX: 'MXN',
  GB: 'GBP',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR',
  TR: 'TRY',
  AE: 'AED', SA: 'SAR', EG: 'EGP', NG: 'NGN',
};

export function getCurrencyForCountry(country: CountryCode): CurrencyCode {
  return COUNTRY_CURRENCY[country] ?? 'USD';
}

/** RTL 여부 (아랍어권) */
export function isRtlCountry(country: CountryCode): boolean {
  return ['AE', 'SA', 'EG', 'QA', 'KW', 'BH', 'OM', 'JO', 'IQ', 'LB', 'YE', 'LY', 'TN', 'MA', 'DZ'].includes(country);
}

// ─── PPP Plan prices ──────────────────────────────────────────────────────────
// KRW 마스터 기준. PPP + 경쟁력 있는 현지 가격으로 수동 조정.

/** 연간 결제 할인율 (20% 할인 = 0.8 곱) */
export const ANNUAL_DISCOUNT = 0.8;

export const PLAN_PRICES: Record<CurrencyCode, Record<Plan, number>> = {
  // ── 아시아 ──────────────────────────────────────────────────────────────
  // 기준: Pro $20/월, Team $30/월, Enterprise $199/월
  KRW: { free: 0, pro: 29_000,   team: 42_000,   enterprise: 299_000  },
  JPY: { free: 0, pro: 3_000,    team: 4_500,    enterprise: 29_800   },
  CNY: { free: 0, pro: 148,      team: 218,      enterprise: 1_280    },
  INR: { free: 0, pro: 1_699,    team: 2_499,    enterprise: 14_999   }, // PPP 반영 (USD $20 → ₹1,699)
  IDR: { free: 0, pro: 309_000,  team: 469_000,  enterprise: 2_990_000 },
  PHP: { free: 0, pro: 1_099,    team: 1_649,    enterprise: 9_999    },
  VND: { free: 0, pro: 499_000,  team: 749_000,  enterprise: 4_699_000 },
  THB: { free: 0, pro: 699,      team: 1_049,    enterprise: 6_590    },
  MYR: { free: 0, pro: 89,       team: 129,      enterprise: 829      },
  SGD: { free: 0, pro: 28,       team: 42,       enterprise: 259      },
  // ── 오세아니아 ──────────────────────────────────────────────────────────
  AUD: { free: 0, pro: 32,       team: 48,       enterprise: 299      },
  // ── 아메리카 ────────────────────────────────────────────────────────────
  USD: { free: 0, pro: 20,       team: 30,       enterprise: 199      },
  BRL: { free: 0, pro: 99,       team: 149,      enterprise: 929      },
  MXN: { free: 0, pro: 349,      team: 519,      enterprise: 3_290    },
  // ── 유럽 ────────────────────────────────────────────────────────────────
  GBP: { free: 0, pro: 16,       team: 24,       enterprise: 159      },
  EUR: { free: 0, pro: 19,       team: 28,       enterprise: 179      },
  TRY: { free: 0, pro: 599,      team: 899,      enterprise: 5_599    }, // 인플레이션 반영
  // ── 중동/아프리카 ────────────────────────────────────────────────────────
  AED: { free: 0, pro: 75,       team: 110,      enterprise: 729      }, // ~$20 / ~$30
  SAR: { free: 0, pro: 75,       team: 110,      enterprise: 729      }, // ~$20 / ~$30
  EGP: { free: 0, pro: 659,      team: 989,      enterprise: 6_299    }, // PPP 반영
  NGN: { free: 0, pro: 16_499,   team: 24_999,   enterprise: 149_999  }, // PPP 반영
};

// ─── Usage overage prices ─────────────────────────────────────────────────────

export const USAGE_PRICES: Record<CurrencyCode, Record<string, number>> = {
  KRW: { rfq_submission: 500,   render_3d: 200,   team_seat: 15_000, api_call_1k: 1_000,  storage_gb: 500   },
  JPY: { rfq_submission: 50,    render_3d: 20,    team_seat: 1_500,  api_call_1k: 100,    storage_gb: 50    },
  CNY: { rfq_submission: 2.5,   render_3d: 1,     team_seat: 68,     api_call_1k: 5,      storage_gb: 2.5   },
  INR: { rfq_submission: 29,    render_3d: 12,    team_seat: 750,    api_call_1k: 50,     storage_gb: 29    },
  IDR: { rfq_submission: 5_500, render_3d: 2_200, team_seat: 165_000, api_call_1k: 11_000, storage_gb: 5_500 },
  PHP: { rfq_submission: 19,    render_3d: 8,     team_seat: 580,    api_call_1k: 38,     storage_gb: 19    },
  VND: { rfq_submission: 9_000, render_3d: 3_600, team_seat: 270_000, api_call_1k: 18_000, storage_gb: 9_000 },
  THB: { rfq_submission: 12,    render_3d: 5,     team_seat: 360,    api_call_1k: 24,     storage_gb: 12    },
  MYR: { rfq_submission: 1.5,   render_3d: 0.6,   team_seat: 44,     api_call_1k: 3,      storage_gb: 1.5   },
  SGD: { rfq_submission: 0.45,  render_3d: 0.18,  team_seat: 13,     api_call_1k: 0.9,    storage_gb: 0.45  },
  AUD: { rfq_submission: 0.5,   render_3d: 0.2,   team_seat: 14,     api_call_1k: 1,      storage_gb: 0.5   },
  USD: { rfq_submission: 0.35,  render_3d: 0.15,  team_seat: 10,     api_call_1k: 0.75,   storage_gb: 0.35  },
  BRL: { rfq_submission: 1.75,  render_3d: 0.70,  team_seat: 52,     api_call_1k: 3.5,    storage_gb: 1.75  },
  MXN: { rfq_submission: 6,     render_3d: 2.5,   team_seat: 180,    api_call_1k: 12,     storage_gb: 6     },
  GBP: { rfq_submission: 0.28,  render_3d: 0.11,  team_seat: 8,      api_call_1k: 0.55,   storage_gb: 0.28  },
  EUR: { rfq_submission: 0.32,  render_3d: 0.13,  team_seat: 9,      api_call_1k: 0.62,   storage_gb: 0.32  },
  TRY: { rfq_submission: 10,    render_3d: 4,     team_seat: 305,    api_call_1k: 20,     storage_gb: 10    },
  AED: { rfq_submission: 1.29,  render_3d: 0.55,  team_seat: 36,     api_call_1k: 2.75,   storage_gb: 1.29  },
  SAR: { rfq_submission: 1.29,  render_3d: 0.55,  team_seat: 36,     api_call_1k: 2.75,   storage_gb: 1.29  },
  EGP: { rfq_submission: 17,    render_3d: 7,     team_seat: 490,    api_call_1k: 35,     storage_gb: 17    },
  NGN: { rfq_submission: 290,   render_3d: 115,   team_seat: 8_500,  api_call_1k: 575,    storage_gb: 290   },
};

// ─── Payment methods ──────────────────────────────────────────────────────────

export type PaymentProvider =
  | 'airwallex'   // 기본
  | 'toss'        // 한국 간편결제
  | 'razorpay'    // 인도
  | 'stripe'      // 브라질, 멕시코 (Airwallex 커버리지 제한)
  | 'iyzico'      // 터키
  | 'paystack'    // 나이지리아
  | 'hyperpay'    // 사우디 Mada
  | 'konbini';    // 일본 편의점

export interface PaymentMethodConfig {
  id:        string;
  label:     string;    // 현지어
  labelEn:   string;
  provider:  PaymentProvider;
  awMethod?: string;    // Airwallex payment_method_type (provider=airwallex일 때만)
  icon:      string;
  countries: string[];
  note?:     string;    // 추가 설명 (연동 필요 여부 등)
}

export const PAYMENT_METHODS: PaymentMethodConfig[] = [
  // ── 한국 ──────────────────────────────────────────────────────────────
  { id: 'kr_card',         label: '신용/체크카드',  labelEn: 'Credit/Debit Card',       provider: 'airwallex', awMethod: 'card',         icon: '💳', countries: ['KR'] },
  { id: 'kakao_pay',       label: '카카오페이',     labelEn: 'KakaoPay',               provider: 'toss',                               icon: '🟡', countries: ['KR'] },
  { id: 'naver_pay',       label: '네이버페이',     labelEn: 'NaverPay',               provider: 'toss',                               icon: '🟢', countries: ['KR'] },
  { id: 'toss_pay',        label: '토스페이',      labelEn: 'TossPay',                provider: 'toss',      awMethod: 'toss_pay',     icon: '🔵', countries: ['KR'] },
  { id: 'kr_bank',         label: '계좌이체',      labelEn: 'Bank Transfer',           provider: 'airwallex', awMethod: 'bank_transfer',icon: '🏦', countries: ['KR'] },
  // ── 일본 ──────────────────────────────────────────────────────────────
  { id: 'jp_card',         label: 'クレジットカード', labelEn: 'Credit Card',            provider: 'airwallex', awMethod: 'card',         icon: '💳', countries: ['JP'] },
  { id: 'konbini',         label: 'コンビニ払い',   labelEn: 'Konbini (convenience store)', provider: 'konbini', awMethod: 'konbini',  icon: '🏪', countries: ['JP'] },
  { id: 'jp_bank',         label: '銀行振込',      labelEn: 'Bank Transfer',           provider: 'airwallex', awMethod: 'bank_transfer',icon: '🏦', countries: ['JP'] },
  // ── 중국 ──────────────────────────────────────────────────────────────
  { id: 'alipay',          label: '支付宝',        labelEn: 'Alipay',                 provider: 'airwallex', awMethod: 'alipay_cn',    icon: '🔵', countries: ['CN'] },
  { id: 'wechat_pay',      label: '微信支付',       labelEn: 'WeChat Pay',             provider: 'airwallex', awMethod: 'wechatpay',    icon: '🟢', countries: ['CN'] },
  // ── 인도 (Razorpay 별도 연동 필요) ───────────────────────────────────
  { id: 'upi',             label: 'UPI',           labelEn: 'UPI (Google Pay / PhonePe / BHIM)', provider: 'razorpay', icon: '🇮🇳', countries: ['IN'], note: 'Razorpay 연동 필요' },
  { id: 'in_card',         label: 'Credit / Debit Card', labelEn: 'Credit/Debit + RuPay', provider: 'razorpay', icon: '💳',           countries: ['IN'], note: 'Razorpay 연동 필요' },
  { id: 'netbanking',      label: 'Net Banking',   labelEn: 'Net Banking',            provider: 'razorpay',                           icon: '🏦', countries: ['IN'], note: 'Razorpay 연동 필요' },
  // ── 인도네시아 ────────────────────────────────────────────────────────
  { id: 'gopay',           label: 'GoPay',         labelEn: 'GoPay',                  provider: 'airwallex', awMethod: 'gopay',        icon: '🟢', countries: ['ID'] },
  { id: 'ovo',             label: 'OVO',           labelEn: 'OVO',                    provider: 'airwallex', awMethod: 'ovo',          icon: '🟣', countries: ['ID'] },
  { id: 'dana',            label: 'DANA',          labelEn: 'DANA',                   provider: 'airwallex', awMethod: 'dana',         icon: '🔵', countries: ['ID'] },
  { id: 'id_va',           label: 'Virtual Account', labelEn: 'Bank Virtual Account', provider: 'airwallex', awMethod: 'bca_va',       icon: '🏦', countries: ['ID'] },
  // ── 필리핀 ────────────────────────────────────────────────────────────
  { id: 'gcash',           label: 'GCash',         labelEn: 'GCash',                  provider: 'airwallex', awMethod: 'gcash',        icon: '🔵', countries: ['PH'] },
  { id: 'maya',            label: 'Maya',          labelEn: 'Maya (PayMaya)',          provider: 'airwallex', awMethod: 'paymaya',      icon: '🟢', countries: ['PH'] },
  // ── 베트남 ────────────────────────────────────────────────────────────
  { id: 'vnpay',           label: 'VNPay',         labelEn: 'VNPay',                  provider: 'airwallex', awMethod: 'vnpay',        icon: '🔴', countries: ['VN'] },
  { id: 'momo_vn',         label: 'MoMo',          labelEn: 'MoMo',                   provider: 'airwallex', awMethod: 'momo',         icon: '🟣', countries: ['VN'] },
  // ── 태국 ──────────────────────────────────────────────────────────────
  { id: 'promptpay',       label: 'พร้อมเพย์',      labelEn: 'PromptPay',              provider: 'airwallex', awMethod: 'promptpay',    icon: '🔵', countries: ['TH'] },
  { id: 'truemoney',       label: 'TrueMoney',     labelEn: 'TrueMoney Wallet',       provider: 'airwallex', awMethod: 'truemoney',    icon: '🔴', countries: ['TH'] },
  // ── 말레이시아 ────────────────────────────────────────────────────────
  { id: 'fpx',             label: 'FPX',           labelEn: 'FPX (Online Banking)',   provider: 'airwallex', awMethod: 'fpx',          icon: '🏦', countries: ['MY'] },
  { id: 'grabpay_my',      label: 'GrabPay',       labelEn: 'GrabPay',                provider: 'airwallex', awMethod: 'grabpay',      icon: '🟢', countries: ['MY', 'SG', 'PH'] },
  // ── 싱가포르 ──────────────────────────────────────────────────────────
  { id: 'paynow',          label: 'PayNow',        labelEn: 'PayNow',                 provider: 'airwallex', awMethod: 'paynow',       icon: '🔴', countries: ['SG'] },
  // ── 브라질 (Stripe 별도 연동 권장) ───────────────────────────────────
  { id: 'pix',             label: 'PIX',           labelEn: 'PIX (instant transfer)', provider: 'stripe',                             icon: '🔑', countries: ['BR'], note: 'Stripe 연동 필요' },
  { id: 'boleto',          label: 'Boleto',        labelEn: 'Boleto Bancário',        provider: 'stripe',                             icon: '📄', countries: ['BR'], note: 'Stripe 연동 필요' },
  { id: 'br_card',         label: 'Cartão',        labelEn: 'Credit Card',            provider: 'stripe',                             icon: '💳', countries: ['BR'], note: 'Stripe 연동 필요' },
  // ── 멕시코 (Stripe 별도 연동 권장) ───────────────────────────────────
  { id: 'oxxo',            label: 'OXXO',          labelEn: 'OXXO (convenience store)', provider: 'stripe',                          icon: '🏪', countries: ['MX'], note: 'Stripe 연동 필요' },
  { id: 'spei',            label: 'SPEI',          labelEn: 'SPEI (bank transfer)',   provider: 'stripe',                             icon: '🏦', countries: ['MX'], note: 'Stripe 연동 필요' },
  // ── 터키 (iyzico 별도 연동 권장) ─────────────────────────────────────
  { id: 'tr_card',         label: 'Kredi Kartı',   labelEn: 'Credit Card (Turkey)',   provider: 'iyzico',                             icon: '💳', countries: ['TR'], note: 'iyzico 연동 권장' },
  // ── UAE / 사우디 ──────────────────────────────────────────────────────
  { id: 'gulf_card',       label: 'بطاقة ائتمان',  labelEn: 'Credit/Debit Card',      provider: 'airwallex', awMethod: 'card',         icon: '💳', countries: ['AE', 'SA', 'EG'] },
  { id: 'apple_pay_gulf',  label: 'Apple Pay',     labelEn: 'Apple Pay',              provider: 'airwallex', awMethod: 'apple_pay',    icon: '🍎', countries: ['AE', 'SA'] },
  { id: 'mada',            label: 'مدى',           labelEn: 'Mada (Saudi debit)',      provider: 'hyperpay',  awMethod: 'mada',         icon: '💳', countries: ['SA'] },
  { id: 'stc_pay',         label: 'STC Pay',       labelEn: 'STC Pay',                provider: 'airwallex', awMethod: 'stc_pay',      icon: '📱', countries: ['SA'] },
  // ── 이집트 ────────────────────────────────────────────────────────────
  { id: 'fawry',           label: 'فوري',          labelEn: 'Fawry',                  provider: 'airwallex', awMethod: 'fawry',        icon: '🟡', countries: ['EG'] },
  { id: 'instapay_eg',     label: 'InstaPay',      labelEn: 'InstaPay (Egypt)',       provider: 'airwallex', awMethod: 'instapay',     icon: '⚡', countries: ['EG'] },
  // ── 나이지리아 (Paystack 별도 연동 필요) ─────────────────────────────
  { id: 'ng_card',         label: 'Debit Card',    labelEn: 'Debit Card (Nigeria)',   provider: 'paystack',                           icon: '💳', countries: ['NG'], note: 'Paystack 연동 필요' },
  { id: 'ng_bank',         label: 'Bank Transfer', labelEn: 'Bank Transfer (Nigeria)', provider: 'paystack',                         icon: '🏦', countries: ['NG'], note: 'Paystack 연동 필요' },
  { id: 'ussd',            label: 'USSD',          labelEn: 'USSD (*737#)',           provider: 'paystack',                           icon: '📱', countries: ['NG'], note: 'Paystack 연동 필요' },
  // ── 글로벌 fallback ───────────────────────────────────────────────────
  { id: 'card',            label: 'Credit / Debit Card', labelEn: 'Credit / Debit Card', provider: 'airwallex', awMethod: 'card',    icon: '💳', countries: ['AU', 'GB', 'DE', 'FR', 'US', 'default'] },
];

export function getPaymentMethodsForCountry(country: CountryCode): PaymentMethodConfig[] {
  const specific = PAYMENT_METHODS.filter(m => m.countries.includes(country));
  const hasCard  = specific.some(m => m.awMethod === 'card' || m.id.includes('card'));
  if (!hasCard) {
    const fallback = PAYMENT_METHODS.find(m => m.id === 'card');
    if (fallback) specific.push(fallback);
  }
  return specific;
}

// ─── Tax config ───────────────────────────────────────────────────────────────

export interface TaxConfig {
  rate:        number;
  name:        string;
  nameLocal:   string;
  included:    boolean;   // true = price includes tax
  requiresId:  boolean;   // B2B requires tax registration number
  eInvoice:    boolean;   // mandatory e-invoicing (세금계산서류)
  eInvoiceNote?: string;  // 주의사항
}

export const TAX_CONFIG: Record<string, TaxConfig> = {
  // ── 아시아 ──────────────────────────────────────────────────────────────
  KR: { rate: 0.10, name: 'VAT',  nameLocal: '부가가치세',  included: false, requiresId: true,  eInvoice: true,  eInvoiceNote: '국세청 전자세금계산서 의무 (바로빌/이지팩스)' },
  JP: { rate: 0.10, name: 'JCT',  nameLocal: '消費税',      included: true,  requiresId: false, eInvoice: false },
  CN: { rate: 0.06, name: 'VAT',  nameLocal: '增值税',       included: false, requiresId: true,  eInvoice: true,  eInvoiceNote: '전자발票 의무 (바이두/항신)' },
  IN: { rate: 0.18, name: 'GST',  nameLocal: 'GST',         included: false, requiresId: true,  eInvoice: true,  eInvoiceNote: '5천만루피+ 기업 e-Invoice 의무 (GST 포털)' },
  ID: { rate: 0.11, name: 'PPN',  nameLocal: 'PPN',         included: false, requiresId: true,  eInvoice: false },
  PH: { rate: 0.12, name: 'VAT',  nameLocal: 'VAT',         included: false, requiresId: true,  eInvoice: false },
  VN: { rate: 0.10, name: 'VAT',  nameLocal: 'Thuế GTGT',  included: false, requiresId: true,  eInvoice: true,  eInvoiceNote: '2022년부터 전자세금계산서 의무' },
  TH: { rate: 0.07, name: 'VAT',  nameLocal: 'ภาษีมูลค่าเพิ่ม', included: false, requiresId: true, eInvoice: false },
  MY: { rate: 0.08, name: 'SST',  nameLocal: 'SST',         included: false, requiresId: true,  eInvoice: false },
  SG: { rate: 0.09, name: 'GST',  nameLocal: 'GST',         included: false, requiresId: true,  eInvoice: false },
  // ── 오세아니아 ──────────────────────────────────────────────────────────
  AU: { rate: 0.10, name: 'GST',  nameLocal: 'GST',         included: false, requiresId: true,  eInvoice: false },
  // ── 아메리카 ────────────────────────────────────────────────────────────
  US: { rate: 0,    name: '',     nameLocal: '',             included: false, requiresId: false, eInvoice: false },
  BR: { rate: 0.10, name: 'ISS/PIS/COFINS', nameLocal: 'ISS', included: false, requiresId: true, eInvoice: true, eInvoiceNote: 'NF-e (Nota Fiscal Eletrônica) 의무' },
  MX: { rate: 0.16, name: 'IVA', nameLocal: 'IVA',          included: false, requiresId: true,  eInvoice: true,  eInvoiceNote: 'CFDI (Comprobante Fiscal Digital) 의무' },
  // ── 유럽 ────────────────────────────────────────────────────────────────
  GB: { rate: 0.20, name: 'VAT',  nameLocal: 'VAT',         included: false, requiresId: true,  eInvoice: false },
  DE: { rate: 0.19, name: 'VAT',  nameLocal: 'MwSt.',       included: false, requiresId: true,  eInvoice: false },
  FR: { rate: 0.20, name: 'VAT',  nameLocal: 'TVA',         included: false, requiresId: true,  eInvoice: false },
  TR: { rate: 0.20, name: 'KDV',  nameLocal: 'KDV',         included: false, requiresId: true,  eInvoice: true,  eInvoiceNote: 'e-Fatura 의무 (GİB 포털)' },
  // ── 중동/아프리카 ────────────────────────────────────────────────────────
  AE: { rate: 0.05, name: 'VAT',  nameLocal: 'ضريبة القيمة المضافة', included: false, requiresId: true, eInvoice: false },
  SA: { rate: 0.15, name: 'VAT',  nameLocal: 'ضريبة القيمة المضافة', included: false, requiresId: true, eInvoice: true, eInvoiceNote: '사우디 ZATCA e-Invoice (파투라/Fatoorah) 의무' },
  EG: { rate: 0.14, name: 'VAT',  nameLocal: 'ضريبة القيمة المضافة', included: false, requiresId: true, eInvoice: false },
  NG: { rate: 0.075, name: 'VAT', nameLocal: 'VAT',         included: false, requiresId: true,  eInvoice: false },
};

export function getTaxConfig(country: CountryCode): TaxConfig {
  return TAX_CONFIG[country] ?? { rate: 0, name: '', nameLocal: '', included: false, requiresId: false, eInvoice: false };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

export function formatPrice(amount: number, currency: CurrencyCode): string {
  const cfg = CURRENCIES[currency];
  if (!cfg) return `${amount} ${currency}`;
  return new Intl.NumberFormat(cfg.locale, {
    style:                 'currency',
    currency:              cfg.code,
    minimumFractionDigits: cfg.decimals,
    maximumFractionDigits: cfg.decimals,
  }).format(amount);
}

/** KRW → 목표 통화 FX 환율 (대략적인 환율, 결제금액은 실시간 Airwallex FX 사용) */
const KRW_FX: Record<CurrencyCode, number> = {
  KRW: 1,
  JPY: 0.095,
  CNY: 0.0053,
  INR: 0.061,
  IDR: 5.5,
  PHP: 0.040,
  VND: 17.8,
  THB: 0.025,
  MYR: 0.0033,
  SGD: 0.00099,
  AUD: 0.0011,
  USD: 0.00073,
  BRL: 0.0036,
  MXN: 0.012,
  GBP: 0.00057,
  EUR: 0.00064,
  TRY: 0.022,
  AED: 0.00269,
  SAR: 0.00274,
  EGP: 0.036,
  NGN: 1.15,
};

export function convertFromKRW(krwAmount: number, toCurrency: CurrencyCode): number {
  const rate = KRW_FX[toCurrency] ?? KRW_FX.USD;
  const cfg  = CURRENCIES[toCurrency];
  const raw  = krwAmount * rate;
  if (!cfg || cfg.decimals === 0) return Math.round(raw);
  return Math.round(raw * 100) / 100;
}

export function getPlanPrice(plan: Plan, currency: CurrencyCode): number {
  return PLAN_PRICES[currency]?.[plan] ?? convertFromKRW(PLAN_PRICES.KRW[plan], currency);
}

export function getUsagePrice(metric: string, currency: CurrencyCode): number {
  return USAGE_PRICES[currency]?.[metric] ?? convertFromKRW(USAGE_PRICES.KRW[metric] ?? 0, currency);
}

// ─── Country metadata (UI용) ──────────────────────────────────────────────────

// ─── Native currency countries ────────────────────────────────────────────────
//
// 지원하는 22개국 전체를 현지 통화로 청구.
// 환전은 Airwallex/당사 정산 시 처리.
// Tier 2 (비지원 국가)만 USD fallback.
//
export const NATIVE_CURRENCY_COUNTRIES = new Set<CountryCode>([
  // ── 아시아 ──────────────────────────────────────────────────────────────
  'KR',  // KRW  — Toss + Airwallex
  'JP',  // JPY  — Airwallex (card, bank transfer)
  'CN',  // CNY  — Airwallex (Alipay, WeChat Pay)
  'IN',  // INR  — Razorpay (UPI, RuPay, NetBanking)
  'ID',  // IDR  — Airwallex (GoPay, OVO, DANA, VA)
  'PH',  // PHP  — Airwallex (GCash, Maya, GrabPay)
  'VN',  // VND  — Airwallex (VNPay, MoMo)
  'TH',  // THB  — Airwallex (PromptPay, TrueMoney)
  'MY',  // MYR  — Airwallex (FPX, GrabPay)
  'SG',  // SGD  — Airwallex (PayNow, GrabPay)
  // ── 오세아니아 ──────────────────────────────────────────────────────────
  'AU',  // AUD  — Airwallex (card, BECS)
  // ── 아메리카 ────────────────────────────────────────────────────────────
  'US',  // USD  — Airwallex (card, ACH)
  'BR',  // BRL  — Stripe (PIX, Boleto)
  'MX',  // MXN  — Stripe (OXXO, SPEI)
  // ── 유럽 ────────────────────────────────────────────────────────────────
  'GB',  // GBP  — Airwallex (card, Bacs)
  'DE',  // EUR  — Airwallex (card, SEPA)
  'FR',  // EUR  — Airwallex (card, SEPA)
  'TR',  // TRY  — iyzico (Kredi Kartı)
  // ── 중동/아프리카 ────────────────────────────────────────────────────────
  'AE',  // AED  — Airwallex (card, Apple Pay)
  'SA',  // SAR  — Airwallex (STC Pay) + HyperPay (Mada)
  'EG',  // EGP  — Airwallex (Fawry, InstaPay)
  'NG',  // NGN  — Paystack (card, bank, USSD)
]);

/**
 * 모든 국가를 현지 통화로 처리.
 * COUNTRY_CURRENCY에 없는 미지원 국가는 getCurrencyForCountry → 'USD' fallback.
 */
export function isNativeCurrencyCountry(_country: CountryCode): boolean {
  return true;
}

export interface CountryMeta {
  code:           CountryCode;
  nameKo:         string;
  nameEn:         string;
  flag:           string;
  currency:       CurrencyCode;
  population:     string;
  nativeCurrency: boolean;   // true = 고정 현지가, false = USD 기준 환율 제안
}

export const SUPPORTED_COUNTRIES: CountryMeta[] = [
  // ── 아시아 (인구순) ───────────────────────────────────────────────────
  { code: 'CN', nameKo: '중국',        nameEn: 'China',          flag: '🇨🇳', currency: 'CNY', population: '14.1억', nativeCurrency: true },
  { code: 'IN', nameKo: '인도',        nameEn: 'India',          flag: '🇮🇳', currency: 'INR', population: '14.3억', nativeCurrency: true },
  { code: 'ID', nameKo: '인도네시아',  nameEn: 'Indonesia',      flag: '🇮🇩', currency: 'IDR', population: '2.75억', nativeCurrency: true },
  { code: 'PH', nameKo: '필리핀',      nameEn: 'Philippines',    flag: '🇵🇭', currency: 'PHP', population: '1.15억', nativeCurrency: true },
  { code: 'VN', nameKo: '베트남',      nameEn: 'Vietnam',        flag: '🇻🇳', currency: 'VND', population: '9,800만', nativeCurrency: true },
  { code: 'JP', nameKo: '일본',        nameEn: 'Japan',          flag: '🇯🇵', currency: 'JPY', population: '1.24억', nativeCurrency: true },
  { code: 'TH', nameKo: '태국',        nameEn: 'Thailand',       flag: '🇹🇭', currency: 'THB', population: '7,100만', nativeCurrency: true },
  { code: 'MY', nameKo: '말레이시아',  nameEn: 'Malaysia',       flag: '🇲🇾', currency: 'MYR', population: '3,400만', nativeCurrency: true },
  { code: 'KR', nameKo: '한국',        nameEn: 'South Korea',    flag: '🇰🇷', currency: 'KRW', population: '5,200만', nativeCurrency: true },
  { code: 'SG', nameKo: '싱가포르',    nameEn: 'Singapore',      flag: '🇸🇬', currency: 'SGD', population: '590만',   nativeCurrency: true },
  // ── 아메리카 ──────────────────────────────────────────────────────────
  { code: 'US', nameKo: '미국',        nameEn: 'United States',  flag: '🇺🇸', currency: 'USD', population: '3.35억', nativeCurrency: true },
  { code: 'BR', nameKo: '브라질',      nameEn: 'Brazil',         flag: '🇧🇷', currency: 'BRL', population: '2.15억', nativeCurrency: true },
  { code: 'MX', nameKo: '멕시코',      nameEn: 'Mexico',         flag: '🇲🇽', currency: 'MXN', population: '1.30억', nativeCurrency: true },
  // ── 유럽 ──────────────────────────────────────────────────────────────
  { code: 'DE', nameKo: '독일',        nameEn: 'Germany',        flag: '🇩🇪', currency: 'EUR', population: '8,400만', nativeCurrency: true },
  { code: 'FR', nameKo: '프랑스',      nameEn: 'France',         flag: '🇫🇷', currency: 'EUR', population: '6,800만', nativeCurrency: true },
  { code: 'GB', nameKo: '영국',        nameEn: 'United Kingdom', flag: '🇬🇧', currency: 'GBP', population: '6,700만', nativeCurrency: true },
  { code: 'TR', nameKo: '터키',        nameEn: 'Turkey',         flag: '🇹🇷', currency: 'TRY', population: '8,500만', nativeCurrency: true },
  // ── 오세아니아 ────────────────────────────────────────────────────────
  { code: 'AU', nameKo: '호주',        nameEn: 'Australia',      flag: '🇦🇺', currency: 'AUD', population: '2,600만', nativeCurrency: true },
  // ── 중동/아프리카 ────────────────────────────────────────────────────
  { code: 'EG', nameKo: '이집트',      nameEn: 'Egypt',          flag: '🇪🇬', currency: 'EGP', population: '1.05억', nativeCurrency: true },
  { code: 'NG', nameKo: '나이지리아',  nameEn: 'Nigeria',        flag: '🇳🇬', currency: 'NGN', population: '2.20억', nativeCurrency: true },
  { code: 'SA', nameKo: '사우디아라비아', nameEn: 'Saudi Arabia', flag: '🇸🇦', currency: 'SAR', population: '3,600만', nativeCurrency: true },
  { code: 'AE', nameKo: 'UAE',         nameEn: 'UAE',            flag: '🇦🇪', currency: 'AED', population: '990만',  nativeCurrency: true },
];

// ─── Country detection ────────────────────────────────────────────────────────

export function detectCountryFromRequest(headers: Headers): CountryCode {
  return (
    headers.get('x-vercel-ip-country') ??
    headers.get('cf-ipcountry') ??
    headers.get('x-country') ??
    'US'
  ) as CountryCode;
}

/**
 * Tier 1: 22개 지원 국가 — PPP 현지화 가격 + 로컬 결제수단 + 세금 설정
 * Tier 2: 그 외 Airwallex 지원 국가 — USD 기준 카드결제
 */
export function isTier1Country(country: string): boolean {
  return SUPPORTED_COUNTRIES.some(c => c.code === country);
}

/** 이 국가가 추가 PG 연동이 필요한지 여부 */
export function requiresExternalPg(country: CountryCode): { required: boolean; pg?: string; reason?: string } {
  const map: Record<string, { pg: string; reason: string }> = {
    IN: { pg: 'Razorpay',  reason: 'Airwallex가 인도 UPI/RuPay를 미지원' },
    BR: { pg: 'Stripe',    reason: 'Airwallex 브라질 커버리지 제한 (PIX, Boleto)' },
    MX: { pg: 'Stripe',    reason: 'Airwallex 멕시코 커버리지 제한 (OXXO, SPEI)' },
    TR: { pg: 'iyzico',    reason: '터키 로컬 카드 최적화' },
    NG: { pg: 'Paystack',  reason: 'Airwallex 나이지리아 미지원' },
    SA: { pg: 'HyperPay',  reason: 'Mada 직불카드 (사우디 필수)' },
  };
  const info = map[country];
  return info ? { required: true, ...info } : { required: false };
}
