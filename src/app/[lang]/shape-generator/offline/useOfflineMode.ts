'use client';

/**
 * useOfflineMode.ts — Detect online/offline + Tauri environment.
 *
 * The Tauri desktop build (Phase 2 Week 4) ships with bundled OCCT
 * WASM so users can sketch + extrude + export STL with no network.
 * The web build needs network for everything. This hook surfaces
 * the right state to the UI so we can:
 *   - hide AI features when offline
 *   - show "offline mode" banner
 *   - swap the CTA from "AI assist" → "Manual mode"
 *
 * Detection:
 *   - `navigator.onLine` (cheap, native)
 *   - Optional periodic fetch ping (more accurate, opt-in)
 *   - Tauri detection via `window.__TAURI__` (set by Tauri runtime)
 */

import { useCallback, useEffect, useState } from 'react';

export interface OfflineModeState {
  /** True when navigator reports offline. */
  isOffline: boolean;
  /** True when running inside Tauri desktop app. */
  isTauri: boolean;
  /** Combined: can the user still do *useful* work? Tauri + offline
   *  → still useful (sketch + export); web + offline → not useful. */
  canWorkOffline: boolean;
  /** Last time we successfully reached the network. null = unknown. */
  lastOnlineAt: number | null;
  /** Manually re-check the network. */
  recheck: () => Promise<void>;
}

export interface UseOfflineModeOptions {
  /** Custom URL to fetch for ping. Default: NEXYFAB_HEALTH_URL or /api/health. */
  pingUrl?: string;
  /** Ping interval in ms. 0 = disabled. Default 0 (just rely on browser event). */
  pingIntervalMs?: number;
}

function detectTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;
}

async function pingNetwork(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      // Don't send credentials — keep ping cheap.
      credentials: 'omit',
    });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export function useOfflineMode(opts: UseOfflineModeOptions = {}): OfflineModeState {
  const [isOffline, setIsOffline] = useState<boolean>(
    typeof navigator === 'undefined' ? false : !navigator.onLine,
  );
  const [lastOnlineAt, setLastOnlineAt] = useState<number | null>(
    typeof navigator === 'undefined' || navigator.onLine ? Date.now() : null,
  );
  const [isTauri, setIsTauri] = useState(false);

  // Tauri detection happens after mount (window object).
  useEffect(() => {
    setIsTauri(detectTauri());
  }, []);

  const recheck = useCallback(async () => {
    const url = opts.pingUrl ?? '/api/health';
    const online = await pingNetwork(url);
    setIsOffline(!online);
    if (online) setLastOnlineAt(Date.now());
  }, [opts.pingUrl]);

  // Listen to browser-level events.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => {
      setIsOffline(false);
      setLastOnlineAt(Date.now());
    };
    const onOffline = () => {
      setIsOffline(true);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Periodic ping (opt-in).
  useEffect(() => {
    const interval = opts.pingIntervalMs ?? 0;
    if (interval <= 0) return;
    const id = window.setInterval(() => { void recheck(); }, interval);
    return () => window.clearInterval(id);
  }, [opts.pingIntervalMs, recheck]);

  // canWorkOffline = Tauri OR online. The web build offline = blocked
  // for most features (server-side AI / persistence / partners).
  const canWorkOffline = isTauri || !isOffline;

  return {
    isOffline,
    isTauri,
    canWorkOffline,
    lastOnlineAt,
    recheck,
  };
}
