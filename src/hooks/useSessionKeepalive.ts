'use client';

import { useEffect } from 'react';

/**
 * Proactively refresh the 15-minute access token so long-lived surfaces (the
 * 3D modeler, Studio) don't silently expire mid-session. Without this the token
 * lapses after 15 min and every authenticated call — cloud sync, STEP/STL
 * import — returns 401 "Unauthorized" (and autosave shows "Cloud sync failed").
 *
 * Fires every 12 min (before the 15-min expiry) and once when the tab regains
 * focus after being idle. A 401 (guest / no refresh cookie) is harmless.
 */
export function useSessionKeepalive() {
  useEffect(() => {
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
    const id = setInterval(refresh, 12 * 60 * 1000);
    // Returning to the tab after a while? Top up if it's been > 5 min.
    const onFocus = () => { if (Date.now() - lastRun > 5 * 60 * 1000) refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, []);
}
