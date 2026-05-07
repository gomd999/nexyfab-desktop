/**
 * shipping.ts — International shipping primitives for NexyFab.
 *
 * Two things matter on a cross-border manufacturing invoice that domestic
 * orders ignore:
 *
 *   1. **HS Code** (Harmonized System) — a 6/8/10-digit tariff
 *      classification. Customs uses this to compute duty. Without one, the
 *      shipment either gets held at port or the carrier guesses (badly).
 *
 *   2. **Incoterms 2020** — the contractual rule that decides who pays for
 *      freight, insurance, and import duty, and at which point the risk of
 *      loss transfers from seller to buyer. We support the three that
 *      cover ~95% of B2B small/medium parts shipments.
 *
 * Anything else (CIF/CFR/FCA/DPU…) can be modeled later. We deliberately
 * don't try to be a full Incoterms engine.
 */

// ─── HS Code ─────────────────────────────────────────────────────────────────
//
// HS codes are 6 digits at the international (WCO) level, extended to 8/10
// at the national level (HTS in the US, KCS in Korea, CN code in EU). We
// store whatever the seller gave us and validate the shape only.

const HS_RE = /^\d{6}(\d{2})?(\d{2})?$/;

export function isValidHsCode(code: string): boolean {
  return HS_RE.test(code.replace(/[\s.-]/g, ''));
}

/** Strip dots/dashes/spaces so storage is canonical: "8479.89.99" → "84798999". */
export function normalizeHsCode(code: string): string {
  return code.replace(/[\s.-]/g, '');
}

// ─── Incoterms 2020 (subset) ─────────────────────────────────────────────────

export type Incoterm = 'EXW' | 'DAP' | 'DDP';

export interface IncotermProfile {
  code:         Incoterm;
  /** One-line label suitable for an invoice. */
  label:        string;
  /** Who arranges and pays the international freight. */
  freightPaidBy: 'seller' | 'buyer';
  /** Who clears import customs and pays duty/VAT in the destination country. */
  importDutyPaidBy: 'seller' | 'buyer';
  /** Where does title/risk transfer from seller to buyer? */
  riskTransfersAt: 'seller-warehouse' | 'destination-named-place' | 'destination-cleared';
  /** Plain-English explanation for the invoice footnote. */
  description: string;
}

export const INCOTERMS: Record<Incoterm, IncotermProfile> = {
  EXW: {
    code:             'EXW',
    label:            'EXW (Ex Works)',
    freightPaidBy:    'buyer',
    importDutyPaidBy: 'buyer',
    riskTransfersAt:  'seller-warehouse',
    description:      'Buyer collects from the seller’s premises and bears all freight, insurance, and import-clearance costs.',
  },
  DAP: {
    code:             'DAP',
    label:            'DAP (Delivered At Place)',
    freightPaidBy:    'seller',
    importDutyPaidBy: 'buyer',
    riskTransfersAt:  'destination-named-place',
    description:      'Seller pays freight to the named destination. Buyer is the importer of record and pays import duty / VAT.',
  },
  DDP: {
    code:             'DDP',
    label:            'DDP (Delivered Duty Paid)',
    freightPaidBy:    'seller',
    importDutyPaidBy: 'seller',
    riskTransfersAt:  'destination-cleared',
    description:      'Seller delivers to the buyer’s door including all import duty and taxes. Maximum obligation on the seller.',
  },
};

export function isIncoterm(s: unknown): s is Incoterm {
  return typeof s === 'string' && (s === 'EXW' || s === 'DAP' || s === 'DDP');
}

export function incotermProfile(code: Incoterm | string | null | undefined): IncotermProfile | null {
  if (!isIncoterm(code)) return null;
  return INCOTERMS[code];
}

// ─── Convenience: derive who-pays-what for an order ──────────────────────────

export interface ShipmentResponsibility {
  freight:    'seller' | 'buyer';
  importDuty: 'seller' | 'buyer';
  /** True when the *seller* (us / our partner) must clear customs at destination. */
  sellerActsAsImporter: boolean;
}

export function responsibilityFor(code: Incoterm): ShipmentResponsibility {
  const p = INCOTERMS[code];
  return {
    freight:              p.freightPaidBy,
    importDuty:           p.importDutyPaidBy,
    sellerActsAsImporter: p.importDutyPaidBy === 'seller',
  };
}
