import type { UserPlan } from '@/hooks/useAuth';
import { getPlanLimits } from './planLimits';

/** One completed DFM worker run on the free (logged-out / free plan) tier, per browser. */
const LS_KEY = 'nexyfab_free_dfm_consumed_v1';

export function hasFreeDfmCredit(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(LS_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Call after a successful unpaid DFM analysis (worker returned results). */
export function markFreeDfmConsumed(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_KEY, '1');
  } catch {
    /* private mode */
  }
}

export function dfmAnalysisAllowed(plan: UserPlan | undefined): boolean {
  return getPlanLimits(plan).dfmAnalysis || hasFreeDfmCredit();
}

export function consumeFreeDfmCreditIfUnpaid(plan: UserPlan | undefined): void {
  if (getPlanLimits(plan).dfmAnalysis) return;
  markFreeDfmConsumed();
}
