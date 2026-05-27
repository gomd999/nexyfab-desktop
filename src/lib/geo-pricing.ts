// Geo-pricing (PPP) — discount the base USD/KRW list price for users
// in low-income economies so the product is reachable without losing
// margin in developed markets. Anti-abuse: same country must match for
// (a) request IP, (b) billing address country, (c) card BIN country.

export interface GeoPricingTier {
  /** ISO 3166-1 alpha-2. */
  countries: string[];
  /** Multiplier applied to the base list price (0.4 = 40% of full price). */
  multiplier: number;
  /** Display label for the pricing page. */
  label: string;
}

/**
 * Tiers derived from World Bank GNI per capita 2024 bands + Notion/
 * Linear/Cursor public PPP matrices. Mid-income countries pay 60-80%,
 * low-income pay 40-50%. High-income countries pay full price.
 */
export const PPP_TIERS: GeoPricingTier[] = [
  {
    label: 'Tier 1 — Low-income (40%)',
    multiplier: 0.4,
    countries: [
      'IN','VN','PH','ID','TH','BD','PK','LK','NP','MM','KH','LA',
      'EG','MA','TN','NG','KE','GH','ET','TZ','UG','SN','ZA',
      'UA','BY','MD','GE','AM','AZ',
    ],
  },
  {
    label: 'Tier 2 — Lower-middle (60%)',
    multiplier: 0.6,
    countries: [
      'BR','MX','AR','CO','PE','EC','DO','GT',
      'TR','RS','BG','RO','MK','AL',
      'CN','MY',
    ],
  },
  {
    label: 'Tier 3 — Upper-middle (80%)',
    multiplier: 0.8,
    countries: [
      'PL','HU','CZ','SK','HR','LV','LT','EE',
      'PT','ES','IT','GR',
      'CL','UY','CR','PA',
      'TW','HK',
    ],
  },
  // Everything else → 100% (Tier 4: high-income).
];

/** Returns the multiplier for a country, defaulting to 1.0 (full price). */
export function pppMultiplier(country: string | null | undefined): number {
  if (!country) return 1;
  const cc = country.toUpperCase();
  for (const tier of PPP_TIERS) {
    if (tier.countries.includes(cc)) return tier.multiplier;
  }
  return 1;
}

export interface PppValidation {
  approved: boolean;
  reason?: string;
  effectiveMultiplier: number;
}

/**
 * Validate a PPP claim — IP, billing country, card BIN country must agree
 * for the discount to apply. Mismatch = full price (prevents abuse via
 * VPN). The check is intentionally simple; production sites typically
 * also gate by *active* card country, not just BIN.
 */
export function validatePppClaim(args: {
  ipCountry: string | null | undefined;
  billingCountry: string | null | undefined;
  cardBinCountry: string | null | undefined;
}): PppValidation {
  const { ipCountry, billingCountry, cardBinCountry } = args;
  // Treat any missing input as a downgrade — only certified matches earn PPP.
  if (!ipCountry || !billingCountry || !cardBinCountry) {
    return {
      approved: false,
      reason: 'Country signal incomplete — applying full price',
      effectiveMultiplier: 1,
    };
  }
  const match = ipCountry.toUpperCase() === billingCountry.toUpperCase()
    && billingCountry.toUpperCase() === cardBinCountry.toUpperCase();
  if (!match) {
    return {
      approved: false,
      reason: `Country mismatch — IP=${ipCountry}, billing=${billingCountry}, card=${cardBinCountry}`,
      effectiveMultiplier: 1,
    };
  }
  const mult = pppMultiplier(billingCountry);
  return {
    approved: mult < 1,
    effectiveMultiplier: mult,
  };
}
