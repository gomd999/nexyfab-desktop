// Global tax rate table — EU VAT (MOSS), JP consumption tax, GST/HST,
// AU GST, Korean VAT, US sales tax (state-level deferred to Stripe Tax
// equivalent / partner). Used by the billing engine to add tax_amount on
// invoice creation when the customer is in a taxed jurisdiction.
//
// Source: EU MOSS official rates (2025), national tax authority publications.
// Sub-region complexity (Spain canary islands, Greece north, etc.) is
// excluded — Airwallex / Stripe Tax handles those if enabled.

export interface TaxRule {
  /** Standard rate as decimal (0.10 = 10%). */
  rate: number;
  /** Label shown on invoices. */
  label: string;
  /** True if B2B reverse-charge mechanism applies (EU VAT). */
  reverseCharge?: boolean;
  /** ISO currency the rate is *invoiced* in by convention. */
  invoiceCurrency: 'KRW' | 'EUR' | 'JPY' | 'USD' | 'GBP' | 'AUD' | 'CAD';
}

/** ISO 3166-1 alpha-2 → tax rule. Unknown country → no tax (caller adds). */
export const TAX_RULES: Record<string, TaxRule> = {
  // ── Korea ──
  KR: { rate: 0.10, label: 'VAT (부가세)', invoiceCurrency: 'KRW' },
  // ── Japan ──
  JP: { rate: 0.10, label: 'Consumption Tax (消費税)', invoiceCurrency: 'JPY' },
  // ── EU MOSS (B2C) ──
  AT: { rate: 0.20, label: 'USt (Austria)',     invoiceCurrency: 'EUR', reverseCharge: true },
  BE: { rate: 0.21, label: 'TVA (Belgium)',     invoiceCurrency: 'EUR', reverseCharge: true },
  BG: { rate: 0.20, label: 'DDS (Bulgaria)',    invoiceCurrency: 'EUR', reverseCharge: true },
  HR: { rate: 0.25, label: 'PDV (Croatia)',     invoiceCurrency: 'EUR', reverseCharge: true },
  CY: { rate: 0.19, label: 'VAT (Cyprus)',      invoiceCurrency: 'EUR', reverseCharge: true },
  CZ: { rate: 0.21, label: 'DPH (Czechia)',     invoiceCurrency: 'EUR', reverseCharge: true },
  DK: { rate: 0.25, label: 'Moms (Denmark)',    invoiceCurrency: 'EUR', reverseCharge: true },
  EE: { rate: 0.22, label: 'KM (Estonia)',      invoiceCurrency: 'EUR', reverseCharge: true },
  FI: { rate: 0.255, label: 'ALV (Finland)',    invoiceCurrency: 'EUR', reverseCharge: true },
  FR: { rate: 0.20, label: 'TVA (France)',      invoiceCurrency: 'EUR', reverseCharge: true },
  DE: { rate: 0.19, label: 'USt (Germany)',     invoiceCurrency: 'EUR', reverseCharge: true },
  GR: { rate: 0.24, label: 'ΦΠΑ (Greece)',     invoiceCurrency: 'EUR', reverseCharge: true },
  HU: { rate: 0.27, label: 'ÁFA (Hungary)',     invoiceCurrency: 'EUR', reverseCharge: true },
  IE: { rate: 0.23, label: 'VAT (Ireland)',     invoiceCurrency: 'EUR', reverseCharge: true },
  IT: { rate: 0.22, label: 'IVA (Italy)',       invoiceCurrency: 'EUR', reverseCharge: true },
  LV: { rate: 0.21, label: 'PVN (Latvia)',      invoiceCurrency: 'EUR', reverseCharge: true },
  LT: { rate: 0.21, label: 'PVM (Lithuania)',   invoiceCurrency: 'EUR', reverseCharge: true },
  LU: { rate: 0.17, label: 'TVA (Luxembourg)',  invoiceCurrency: 'EUR', reverseCharge: true },
  MT: { rate: 0.18, label: 'VAT (Malta)',       invoiceCurrency: 'EUR', reverseCharge: true },
  NL: { rate: 0.21, label: 'BTW (Netherlands)', invoiceCurrency: 'EUR', reverseCharge: true },
  PL: { rate: 0.23, label: 'VAT (Poland)',      invoiceCurrency: 'EUR', reverseCharge: true },
  PT: { rate: 0.23, label: 'IVA (Portugal)',    invoiceCurrency: 'EUR', reverseCharge: true },
  RO: { rate: 0.19, label: 'TVA (Romania)',     invoiceCurrency: 'EUR', reverseCharge: true },
  SK: { rate: 0.23, label: 'DPH (Slovakia)',    invoiceCurrency: 'EUR', reverseCharge: true },
  SI: { rate: 0.22, label: 'DDV (Slovenia)',    invoiceCurrency: 'EUR', reverseCharge: true },
  ES: { rate: 0.21, label: 'IVA (Spain)',       invoiceCurrency: 'EUR', reverseCharge: true },
  SE: { rate: 0.25, label: 'Moms (Sweden)',     invoiceCurrency: 'EUR', reverseCharge: true },
  // ── Non-EU EEA ──
  NO: { rate: 0.25, label: 'MVA (Norway)',      invoiceCurrency: 'EUR' },
  CH: { rate: 0.081, label: 'MWST (Switzerland)', invoiceCurrency: 'EUR' },
  // ── UK ──
  GB: { rate: 0.20, label: 'VAT (UK)',          invoiceCurrency: 'GBP' },
  // ── Anglo ──
  AU: { rate: 0.10, label: 'GST (Australia)',   invoiceCurrency: 'AUD' },
  NZ: { rate: 0.15, label: 'GST (New Zealand)', invoiceCurrency: 'AUD' },
  CA: { rate: 0.05, label: 'GST (Canada)',      invoiceCurrency: 'CAD' },
  // ── APAC ──
  SG: { rate: 0.09, label: 'GST (Singapore)',   invoiceCurrency: 'USD' },
  IN: { rate: 0.18, label: 'GST (India)',       invoiceCurrency: 'USD' },
  // United States — sales tax is state-level and SaaS-taxability varies.
  // We defer to gateway-side Stripe Tax / TaxJar when those integrations
  // land; for now, no automatic tax line for US invoices.
  US: { rate: 0,    label: 'Sales Tax (deferred to gateway)', invoiceCurrency: 'USD' },
};

export interface TaxComputation {
  rule: TaxRule | null;
  taxAmount: number;
  netAmount: number;
  grossAmount: number;
  note?: string;
}

/**
 * Compute the tax line for an invoice. `vatId` triggers EU reverse-charge
 * (B2B sale → no tax, customer accounts for it).
 */
export function computeTax(
  country: string | null | undefined,
  netAmount: number,
  vatId?: string | null,
): TaxComputation {
  if (!country) {
    return { rule: null, taxAmount: 0, netAmount, grossAmount: netAmount };
  }
  const rule = TAX_RULES[country.toUpperCase()];
  if (!rule) {
    return { rule: null, taxAmount: 0, netAmount, grossAmount: netAmount };
  }
  // EU B2B with valid VAT ID → reverse charge mechanism.
  if (rule.reverseCharge && vatId && vatId.length >= 8) {
    return {
      rule,
      taxAmount: 0,
      netAmount,
      grossAmount: netAmount,
      note: 'Reverse charge applies — VAT to be accounted for by the customer (EU Directive 2006/112/EC Art. 196)',
    };
  }
  const taxAmount = Math.round(netAmount * rule.rate * 100) / 100;
  return {
    rule,
    taxAmount,
    netAmount,
    grossAmount: netAmount + taxAmount,
  };
}

/** Best-effort EU VAT ID format check (length + country prefix). */
export function isValidVatIdFormat(vatId: string): boolean {
  if (!vatId) return false;
  const normalized = vatId.replace(/[\s-]/g, '').toUpperCase();
  // Country code 2 letters + 8-12 alphanumeric.
  return /^[A-Z]{2}[0-9A-Z]{8,12}$/.test(normalized);
}
