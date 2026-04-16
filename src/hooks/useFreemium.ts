/**
 * useFreemium.ts
 *
 * Client-side Freemium gate hook.
 *
 * Tracks monthly usage counts in localStorage (ephemeral — server enforces
 * server-side limits independently). Use this for immediate UI feedback
 * without a round-trip.
 *
 * Plan hierarchy: free < pro < team < enterprise
 *
 * Free limits:
 *   ai_advisor:       5 per month
 *   cam_export:       Pro required (hard gate)
 *   supplier_match:   Pro required (hard gate)
 *   rfq_bundle:       Pro required (hard gate)
 */

import { useAuthStore } from './useAuth';

export type FreemiumFeature = 'ai_advisor' | 'cam_export' | 'supplier_match' | 'rfq_bundle';
export type UserPlan = 'free' | 'pro' | 'team' | 'enterprise';

const PLAN_RANK: Record<UserPlan, number> = { free: 0, pro: 1, team: 2, enterprise: 3 };

// -1 means "Pro required" (hard gate, not a monthly count limit)
const FREE_MONTHLY_LIMITS: Record<FreemiumFeature, number> = {
  ai_advisor:      5,
  cam_export:      -1,
  supplier_match:  -1,
  rfq_bundle:      -1,
};

function getCurrentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getStorageKey(feature: FreemiumFeature): string {
  return `nf_usage_${feature}_${getCurrentMonthKey()}`;
}

function getUsageCount(feature: FreemiumFeature): number {
  if (typeof window === 'undefined') return 0;
  return parseInt(localStorage.getItem(getStorageKey(feature)) ?? '0', 10);
}

function incrementUsage(feature: FreemiumFeature): void {
  if (typeof window === 'undefined') return;
  const key = getStorageKey(feature);
  const count = parseInt(localStorage.getItem(key) ?? '0', 10);
  localStorage.setItem(key, String(count + 1));
}

function meetsMinPlan(userPlan: string | undefined, required: UserPlan): boolean {
  return (PLAN_RANK[(userPlan as UserPlan) ?? 'free'] ?? 0) >= PLAN_RANK[required];
}

export interface FreemiumCheckResult {
  /** Feature is allowed (either Pro+ or within free limits) */
  allowed: boolean;
  /** User needs Pro (hard gate) */
  requiresPro: boolean;
  /** Over monthly usage limit */
  overLimit: boolean;
  /** Current usage count (meaningful only for count-limited features) */
  used: number;
  /** Monthly limit (meaningful only for count-limited features; -1 = Pro required) */
  limit: number;
}

/**
 * Returns a check function and a consume function.
 *
 * Usage:
 *   const { check, consume } = useFreemium();
 *   const result = check('ai_advisor');
 *   if (!result.allowed) { showUpgradeModal(result); return; }
 *   consume('ai_advisor'); // increment counter after actual use
 */
export function useFreemium() {
  const { user } = useAuthStore();
  const plan = (user?.plan ?? 'free') as UserPlan;
  const isPro = meetsMinPlan(plan, 'pro');

  function check(feature: FreemiumFeature): FreemiumCheckResult {
    // Pro+ users: always allowed
    if (isPro) return { allowed: true, requiresPro: false, overLimit: false, used: 0, limit: -1 };

    const limit = FREE_MONTHLY_LIMITS[feature];

    // Hard gate: Pro required
    if (limit === -1) {
      return { allowed: false, requiresPro: true, overLimit: false, used: 0, limit: -1 };
    }

    // Monthly count gate
    const used = getUsageCount(feature);
    const overLimit = used >= limit;
    return { allowed: !overLimit, requiresPro: false, overLimit, used, limit };
  }

  function consume(feature: FreemiumFeature): void {
    if (!isPro) incrementUsage(feature);
  }

  function getRemainingCount(feature: FreemiumFeature): number {
    if (isPro) return Infinity;
    const limit = FREE_MONTHLY_LIMITS[feature];
    if (limit === -1) return 0;
    return Math.max(0, limit - getUsageCount(feature));
  }

  return { check, consume, getRemainingCount, isPro, plan };
}
