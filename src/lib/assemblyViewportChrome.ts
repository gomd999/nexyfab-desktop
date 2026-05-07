import type { AssemblyViewportLoadBand } from './assemblyLoadPolicy';

/** UI strings for the assembly viewport load badge (i18n from caller). */
export type AssemblyViewportChromeLabels = {
  assemblyLoadBadgeLight: string;
  assemblyLoadTitleLight: string;
  assemblyLoadBadgeWarn: string;
  assemblyLoadTitleWarn: string;
  assemblyLoadBadgeHeavy: string;
  assemblyLoadTitleHeavy: string;
  assemblyLoadBadgeExtreme: string;
  assemblyLoadTitleExtreme: string;
};

export type AssemblyViewportChrome = { badge: string; title: string; color: string };

/**
 * Maps `assemblyViewportLoadBand(partCount)` to a compact badge + tooltip for the 3D viewport chrome.
 * Returns `null` when no hint is needed (`normal`).
 */
export function assemblyViewportChrome(
  band: AssemblyViewportLoadBand,
  tt: AssemblyViewportChromeLabels,
): AssemblyViewportChrome | null {
  switch (band) {
    case 'normal':
      return null;
    case 'light':
      return { badge: tt.assemblyLoadBadgeLight, title: tt.assemblyLoadTitleLight, color: '#6e7681' };
    case 'warn':
      return { badge: tt.assemblyLoadBadgeWarn, title: tt.assemblyLoadTitleWarn, color: '#a78bfa' };
    case 'heavy':
      return { badge: tt.assemblyLoadBadgeHeavy, title: tt.assemblyLoadTitleHeavy, color: '#fb923c' };
    case 'extreme':
      return { badge: tt.assemblyLoadBadgeExtreme, title: tt.assemblyLoadTitleExtreme, color: '#f87171' };
  }
}
