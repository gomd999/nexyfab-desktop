'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/hooks/useAuth';

/**
 * Proactively refresh the 15-minute access token so long-lived surfaces (the
 * 3D modeler, Studio) don't silently expire mid-session. Without this the token
 * lapses after 15 min and every authenticated call — cloud sync, STEP/STL
 * import — returns 401 "Unauthorized" (and autosave shows "Cloud sync failed").
 *
 * Fires every 12 min (before the 15-min expiry) and once when the tab regains
 * focus after being idle. It starts only after the central cookie-backed
 * session probe confirms an authenticated user.
 */
export function useSessionKeepalive() {
  const sessionStatus = useAuthStore((state) => state.sessionStatus);

  useEffect(() => {
    // Wait for the cookie-backed session probe. In particular, do not POST the
    // protected refresh endpoint for a guest or for stale persisted auth state.
    if (sessionStatus !== 'authenticated') return;

    let lastRun = 0;
    const refresh = () => {
      lastRun = Date.now();
      fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => { /* offline / guest — ignore */ });
    };
    // Refresh ONCE immediately on mount — the page may have loaded with a token
    // that expires before the first 12-min tick (e.g. logged in 14 min ago), and
    // without this the first authenticated call (cloud sync / import) 401s.
    refresh();
    const id = setInterval(refresh, 12 * 60 * 1000);
    // Returning to the tab after a while? Top up if it's been > 5 min.
    const onFocus = () => { if (Date.now() - lastRun > 5 * 60 * 1000) refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [sessionStatus]);
}
