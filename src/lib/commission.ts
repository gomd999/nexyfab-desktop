/**
 * Single source of truth for NexyFab commission rate.
 *
 * Marketing & default contracts: 8% flat (the headline rate, mentioned in
 * partner agreement v1.0 §5).
 *
 * Enterprise tier customers can negotiate volume-based discounts via the
 * sliding tier below — only applied when plan='enterprise'. All other
 * surfaces (escrow, settlements display, partner dashboard) read the
 * authoritative rate stored on `nf_contracts.commission_rate` so they
 * never drift from what was contractually agreed.
 *
 * Floor: 3%. Marketing rate must never appear lower than this.
 */

export const COMMISSION_PCT_DEFAULT = 8;
export const COMMISSION_PCT_FLOOR = 3;

/**
 * Resolve commission rate (in percent) for a new contract.
 *
 * - Standard / Pro / Team plans: flat 8%.
 * - Enterprise plan: sliding 4-7% by amount, with first-contract -1pt
 *   incentive (handled at the call site).
 *
 * The contract row stores the resolved rate so settlements, escrow, and
 * partner dashboards can use the same number without re-deriving.
 */
export function getCommissionRatePct(amountKrw: number, plan: string = 'standard'): number {
  if (plan === 'enterprise') {
    if (amountKrw <= 20_000_000)  return 7;
    if (amountKrw <= 50_000_000)  return 6;
    if (amountKrw <= 100_000_000) return 5.5;
    if (amountKrw <= 200_000_000) return 5;
    if (amountKrw <= 500_000_000) return 4.5;
    return 4;
  }
  return COMMISSION_PCT_DEFAULT;
}
