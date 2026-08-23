'use client';

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

/**
 * Invisible component that refreshes the user's plan on window focus.
 * Catches Stripe webhook plan changes without requiring re-login.
 * Also handles ?upgraded=true URL param for immediate post-checkout refresh.
 */
export default function PlanRefresher() {
  const refreshPlan = useAuthStore((s) => s.refreshPlan);
  const user = useAuthStore((s) => s.user);
  const sessionStatus = useAuthStore((s) => s.sessionStatus);
  const lastRefresh = useRef(0);

  useEffect(() => {
    if (!user || sessionStatus !== 'authenticated') return;

    // Check URL for post-checkout redirect
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === 'true') {
      refreshPlan();
      // Clean URL
      params.delete('upgraded');
      params.delete('plan');
      const clean = params.toString();
      const newUrl = window.location.pathname + (clean ? `?${clean}` : '');
      window.history.replaceState({}, '', newUrl);
    }

    // Refresh plan on window focus (throttled to once per 60s)
    const onFocus = () => {
      const now = Date.now();
      if (now - lastRefresh.current > 60_000) {
        lastRefresh.current = now;
        refreshPlan();
      }
    };

    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [user, sessionStatus, refreshPlan]);

  return null;
}
