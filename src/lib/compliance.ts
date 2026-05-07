/**
 * compliance.ts — Minimum-viable compliance hooks for NexyFab.
 *
 * Scope (Phase 7-4a.6):
 *   1. Sanctions screening at partner onboarding. We reject suppliers
 *      whose country is under a comprehensive OFAC/EU/UN embargo. This
 *      is NOT a full SDN name-check — swap in a real provider
 *      (ComplyAdvantage, Refinitiv, Dow Jones) before scaling further,
 *      but shipping a country-level block is strictly better than
 *      shipping nothing.
 *   2. GDPR / PIPL / CCPA consent records. We persist the fact that a
 *      user accepted a specific DPA version at a specific time so we
 *      can produce it on request.
 *
 * Fail mode: screening failures are **fail-closed** for partner signup
 * (block with a clear reason) and **fail-open** for buyer-side actions
 * (log + allow), since the asymmetric risk is different.
 */

import type { CountryCode } from './country-pricing';

// ─── Sanctions: comprehensive country embargoes ──────────────────────────────
//
// Country-level restrictions as of early 2026. Keep conservative — we'd
// rather reject a borderline case and ask humans than process a shipment
// that triggers an OFAC enforcement action.
//
// Sources:
//   https://ofac.treasury.gov/sanctions-programs-and-country-information
//   https://www.consilium.europa.eu/en/policies/sanctions-against-russia/
//
// NOTE: Russia is NOT on this list because current OFAC/EU policy is
// sectoral, not comprehensive — individual entity checks are required
// instead. That's out of scope here.

const COMPREHENSIVELY_SANCTIONED: CountryCode[] = [
  'CU',  // Cuba
  'IR',  // Iran
  'KP',  // North Korea (DPRK)
  'SY',  // Syria
];

// Occupied Ukrainian regions require separate handling — we don't have
// sub-country codes in our data model, so partners in UA are allowed
// through and the risk is logged for manual review.

export interface SanctionsScreenInput {
  country:      CountryCode;
  name?:        string;
  /** IBAN/bank country — if the account lives in a sanctioned country we
   *  reject even when the business address is elsewhere. */
  bankCountry?: CountryCode;
}

export interface SanctionsScreenResult {
  pass:    boolean;
  reason?: string;
  /** Names the specific program that triggered the decision, for logs. */
  program?: 'OFAC-COUNTRY' | 'EU-COUNTRY' | 'UN-COUNTRY' | 'BANK-COUNTRY' | 'NONE';
}

export function screenSanctions(input: SanctionsScreenInput): SanctionsScreenResult {
  if (COMPREHENSIVELY_SANCTIONED.includes(input.country)) {
    return {
      pass:    false,
      program: 'OFAC-COUNTRY',
      reason:  `Supplier country ${input.country} is under a comprehensive OFAC/EU embargo.`,
    };
  }
  if (input.bankCountry && COMPREHENSIVELY_SANCTIONED.includes(input.bankCountry)) {
    return {
      pass:    false,
      program: 'BANK-COUNTRY',
      reason:  `Bank account country ${input.bankCountry} is under a comprehensive embargo.`,
    };
  }
  return { pass: true, program: 'NONE' };
}

// ─── Data Processing Agreement (DPA) consent ─────────────────────────────────

/**
 * Current DPA version. Bump when the contract language changes so old
 * acceptance records don't silently migrate onto the new terms.
 */
export const CURRENT_DPA_VERSION = '2026.04.1';

export interface DpaConsent {
  userId:        string;
  version:       string;
  acceptedAt:    number;
  /** The legal basis we're recording under (GDPR, PIPL, CCPA). */
  regime:        'GDPR' | 'PIPL' | 'CCPA' | 'OTHER';
  ip?:           string;
  userAgent?:    string;
}

/** Map a buyer country to the dominant privacy regime for that user. */
export function regimeForCountry(country: CountryCode): DpaConsent['regime'] {
  const GDPR = new Set(['DE','FR','IT','ES','NL','GB','IE','BE','AT','SE','FI','DK','PL','PT','CZ','NO','CH']);
  if (GDPR.has(country)) return 'GDPR';
  if (country === 'CN') return 'PIPL';
  if (country === 'US') return 'CCPA';
  return 'OTHER';
}
