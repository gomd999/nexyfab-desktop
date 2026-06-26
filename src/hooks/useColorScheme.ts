'use client';

/**
 * useColorScheme — react to prefers-color-scheme: light/dark.
 *
 * The site's main viewports are dark by design (CAD use case, ribbon-against-
 * scene contrast). But pop-up dialogs (upgrade prompt, STL export) appear
 * over arbitrary content; respecting the user's system theme makes them
 * less jarring on light-mode browsers. Round 37 introduces this hook so
 * the few remaining hard-coded-dark dialogs can flip palette.
 *
 * Behavior:
 *   - Returns 'light' | 'dark'. Defaults to 'dark' on SSR (no media query).
 *   - Subscribes to MediaQueryList changes — flips live when user toggles
 *     OS dark mode without reload.
 *
 * NOT a full theming system. Just the system preference. If we ever need
 * an in-app override that beats the OS, layer it on top here.
 */
import { useEffect, useState } from 'react';

export type ColorScheme = 'light' | 'dark';

export function useColorScheme(): ColorScheme {
  // MUST start at the SSR value ('dark') so the first client render matches the
  // server HTML — reading matchMedia in the initializer made the client hydrate
  // as 'light' on light systems while the server emitted 'dark' (React #418
  // hydration mismatch). Resolve the real scheme after mount instead.
  const [scheme, setScheme] = useState<ColorScheme>('dark');

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    setScheme(mq.matches ? 'light' : 'dark'); // sync to the actual system scheme post-hydration
    const handler = (e: MediaQueryListEvent) => setScheme(e.matches ? 'light' : 'dark');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return scheme;
}

/**
 * Common palette pairs used across pop-up dialogs.
 * Update only here — every dialog inherits the change.
 */
export interface DialogPalette {
  overlay: string;
  bg: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  inputBg: string;
  inputBorder: string;
  inputBorderFocus: string;
  buttonSecondaryBg: string;
  buttonSecondaryText: string;
}

export function dialogPalette(scheme: ColorScheme): DialogPalette {
  if (scheme === 'light') {
    return {
      overlay: 'rgba(15, 23, 42, 0.45)',
      bg: '#ffffff',
      border: '#e2e8f0',
      textPrimary: '#0f172a',
      textSecondary: '#475569',
      inputBg: '#f8fafc',
      inputBorder: '#cbd5e1',
      inputBorderFocus: '#388bfd',
      buttonSecondaryBg: '#f1f5f9',
      buttonSecondaryText: '#334155',
    };
  }
  return {
    overlay: 'rgba(0, 0, 0, 0.6)',
    bg: '#161b22',
    border: '#30363d',
    textPrimary: '#e6edf3',
    textSecondary: '#8b949e',
    inputBg: '#0d1117',
    inputBorder: '#21262d',
    inputBorderFocus: '#388bfd',
    buttonSecondaryBg: 'transparent',
    buttonSecondaryText: '#c9d1d9',
  };
}
