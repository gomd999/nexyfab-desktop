/**
 * tax-engine.ts — Order tax calculation for NexyFab B2B manufacturing.
 *
 * Scope (Phase 7-4a.4): replace what Stripe Tax would have auto-calculated
 * with a self-owned engine that's good enough to ship in Day-1 markets
 * (KR + English-speaking US/SG/AU). Non-goals: EU OSS registration,
 * country-specific e-Invoice generation beyond KR.
 *
 * Logic summary (seller = Korea, NexyFab KR entity):
 *   Buyer KR, biz-registered   → 10% VAT, e-tax invoice required
 *   Buyer KR, consumer         → 10% VAT included
 *   Buyer outside KR, B2B w/ valid tax ID → 0% (export, reverse charge)
 *   Buyer outside KR, B2C      → 0% (no nexus in Day-1; revisit at scale)
 *
 * VAT ID validation is a stub that should hit VIES (EU) / HMRC (UK) /
 * etc. in production — we fail-open here so a temporary upstream outage
 * doesn't block commerce; the id is still recorded on the invoice.
 */

import { TAX_CONFIG, type CountryCode, type CurrencyCode } from './country-pricing';
import type { Money } from './money';
import { roundForCurrency } from './money';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TaxContext {
  sellerCountry:  CountryCode;     // Default: 'KR' (NexyFab entity)
  buyerCountry:   CountryCode;
  /** Present when buyer is B2B and has supplied a tax registration number. */
  buyerTaxId?:    string | null;
  /** Optional hint: buyer explicitly classified as business. Defaults to (!!buyerTaxId). */
  isB2B?:         boolean;
}

export type TaxTreatment =
  | 'domestic_vat'          // Normal VAT/GST charged to a domestic buyer
  | 'export_zero_rated'     // Cross-border, 0% on the invoice
  | 'reverse_charge'        // EU/UK B2B — buyer self-assesses VAT
  | 'b2c_export_no_nexus'   // Cross-border consumer sale, seller has no nexus
  | 'exempt';               // No tax applies

export interface TaxBreakdown {
  subtotal:   Money;
  tax:        Money;
  total:      Money;
  rate:       number;        // 0.10 = 10%
  treatment:  TaxTreatment;
  /** Canonical tax label shown on the invoice (VAT / GST / JCT …). */
  taxName:    string;
  /** Set when the local regime requires an e-tax invoice (Korea NTS, Italy SdI…). */
  eInvoiceRequired: boolean;
  /** Human-readable rationale; shown in admin and audit trail. */
  notes:      string;
}

// ─── Calculation ─────────────────────────────────────────────────────────────

export function calculateTax(subtotal: Money, ctx: TaxContext): TaxBreakdown {
  const sellerCountry = ctx.sellerCountry || 'KR';
  const buyerCountry  = ctx.buyerCountry;
  const isB2B         = ctx.isB2B ?? Boolean(ctx.buyerTaxId);

  const sellerTax = TAX_CONFIG[sellerCountry];
  const buyerTax  = TAX_CONFIG[buyerCountry];

  const isDomestic = sellerCountry === buyerCountry;

  // ── Domestic: seller's own regime applies ─────────────────────────────
  if (isDomestic && sellerTax) {
    return buildBreakdown(subtotal, sellerTax.rate, {
      treatment:        'domestic_vat',
      taxName:          sellerTax.name || 'VAT',
      eInvoiceRequired: Boolean(sellerTax.eInvoice) && isB2B,
      notes:            `${sellerTax.name} ${(sellerTax.rate * 100).toFixed(0)}% (domestic)`,
    });
  }

  // ── Cross-border B2B with valid VAT ID → reverse charge / export ─────
  if (!isDomestic && isB2B && ctx.buyerTaxId) {
    // EU/UK/NO/CH use the reverse-charge label explicitly; rest of world
    // treats it as a plain zero-rated export. Either way, tax = 0.
    const reverseChargeRegions = ['DE','FR','IT','ES','NL','GB','NO','CH','IE','BE','AT','SE','FI','DK','PL','PT','CZ'];
    const treatment: TaxTreatment = reverseChargeRegions.includes(buyerCountry)
      ? 'reverse_charge'
      : 'export_zero_rated';
    return buildBreakdown(subtotal, 0, {
      treatment,
      taxName:          buyerTax?.name || 'VAT',
      eInvoiceRequired: false,
      notes: treatment === 'reverse_charge'
        ? `Reverse charge — buyer VAT ID ${ctx.buyerTaxId} self-assesses in ${buyerCountry}`
        : `Zero-rated export to ${buyerCountry} (buyer tax ID ${ctx.buyerTaxId})`,
    });
  }

  // ── Cross-border consumer: Day-1 assumption = no nexus in buyer's country ─
  if (!isDomestic) {
    return buildBreakdown(subtotal, 0, {
      treatment:        'b2c_export_no_nexus',
      taxName:          buyerTax?.name || 'VAT',
      eInvoiceRequired: false,
      notes:            `Cross-border consumer sale to ${buyerCountry}; seller has no tax nexus there. Review annually as volume grows (EU OSS threshold €10k, US state-by-state).`,
    });
  }

  // Fallback — should not happen if TAX_CONFIG covers the seller country.
  return buildBreakdown(subtotal, 0, {
    treatment:        'exempt',
    taxName:          '',
    eInvoiceRequired: false,
    notes:            `No tax rule configured for ${sellerCountry}→${buyerCountry}`,
  });
}

function buildBreakdown(
  subtotal: Money,
  rate: number,
  rest: Omit<TaxBreakdown, 'subtotal' | 'tax' | 'total' | 'rate'>,
): TaxBreakdown {
  const currency: CurrencyCode = subtotal.currency as CurrencyCode;
  const taxValue = roundForCurrency(subtotal.value * rate, currency);
  return {
    subtotal,
    tax:   { value: taxValue, currency },
    total: { value: roundForCurrency(subtotal.value + taxValue, currency), currency },
    rate,
    ...rest,
  };
}

// ─── VAT ID validation stub ──────────────────────────────────────────────────

export interface VatIdValidationResult {
  valid:     boolean;
  country:   CountryCode;
  id:        string;
  /** Name returned by the authoritative registry (VIES/HMRC) when available. */
  name?:     string;
  /** Source that answered; 'unchecked' means we fail-opened. */
  source:    'vies' | 'hmrc' | 'gst-in' | 'abn-au' | 'unchecked';
  error?:    string;
}

/**
 * Validate a buyer tax ID against the authoritative registry where we have
 * one. Fails open: if the registry is down or we don't support the country,
 * we return `valid: true, source: 'unchecked'` rather than blocking the
 * checkout. The id is still recorded on the invoice for audit.
 *
 * Hook real backends here:
 *   EU: https://ec.europa.eu/taxation_customs/vies/#/vat-validation
 *   UK: https://api.service.hmrc.gov.uk/organisations/vat/check-vat-number
 *   AU: https://abr.business.gov.au/
 *   IN: GST portal (needs API key)
 */
export async function validateVatId(
  country: CountryCode,
  id: string,
): Promise<VatIdValidationResult> {
  const cleaned = id.replace(/[\s-]/g, '').toUpperCase();
  if (!cleaned) return { valid: false, country, id, source: 'unchecked', error: 'Empty ID' };

  // For now: shape-only validation by country, real calls left as a TODO
  // behind env flags (VIES_ENABLED, HMRC_ENABLED).
  const shapeOk = matchesShape(country, cleaned);
  return {
    valid:   shapeOk,
    country,
    id:      cleaned,
    source:  'unchecked',
    error:   shapeOk ? undefined : `ID does not match expected shape for ${country}`,
  };
}

function matchesShape(country: CountryCode, id: string): boolean {
  // Loose structural checks — enough to catch typos before a production
  // registry call. Not a substitute for real validation.
  const rules: Record<string, RegExp> = {
    KR: /^\d{10}$/,                              // 사업자등록번호
    DE: /^DE\d{9}$/,
    FR: /^FR[A-Z0-9]{2}\d{9}$/,
    IT: /^IT\d{11}$/,
    ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/,
    NL: /^NL\d{9}B\d{2}$/,
    GB: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/,
    AU: /^\d{11}$/,                              // ABN
    SG: /^(\d{9}[A-Z]|[A-Z]\d{8}[A-Z]|T\d{2}[A-Z]{2}\d{4}[A-Z]|\d{8}[A-Z])$/, // UEN loose
    US: /^\d{2}-?\d{7}$/,                        // EIN
    IN: /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9][A-Z]\d[A-Z]?$/, // GSTIN loose
  };
  const rule = rules[country];
  return rule ? rule.test(id) : id.length >= 6; // unknown country → lax
}
