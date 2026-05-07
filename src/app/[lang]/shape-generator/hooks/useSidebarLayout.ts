'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { PREF_KEYS, prefGetJson, prefSetJson } from '@/lib/platform';
import { useResponsive } from '../responsive/useResponsive';
const OVERLAY_BREAKPOINT = 1600;

export const RAIL_WIDTH = 44;
const DEFAULT_LEFT = 240;
const DEFAULT_RIGHT = 340;
const MIN_LEFT = 180;
const MIN_RIGHT = 260;
const MAX_LEFT = 400;
const MAX_RIGHT = 520;

export type OverlayPref = 'auto' | 'always' | 'never';

interface SidebarPrefs {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  swapSides: boolean;
  overlayPref: OverlayPref;
}

const DEFAULT_PREFS: SidebarPrefs = {
  leftWidth: DEFAULT_LEFT,
  rightWidth: DEFAULT_RIGHT,
  leftCollapsed: false,
  rightCollapsed: false,
  swapSides: false,
  overlayPref: 'always',
};

function load(): SidebarPrefs {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const parsed = prefGetJson<Partial<SidebarPrefs>>(PREF_KEYS.sidebarLayout);
    if (!parsed) return DEFAULT_PREFS;
    return {
      leftWidth: clamp(parsed.leftWidth ?? DEFAULT_LEFT, MIN_LEFT, MAX_LEFT),
      rightWidth: clamp(parsed.rightWidth ?? DEFAULT_RIGHT, MIN_RIGHT, MAX_RIGHT),
      leftCollapsed: !!parsed.leftCollapsed,
      rightCollapsed: !!parsed.rightCollapsed,
      swapSides: !!parsed.swapSides,
      overlayPref: (parsed.overlayPref ?? 'auto') as OverlayPref,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface SidebarLayout {
  /** Current width of left panel when not collapsed. */
  leftWidth: number;
  /** Current width of right panel when not collapsed. */
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  swapSides: boolean;
  overlayPref: OverlayPref;
  /** Effective overlay mode after resolving preference + viewport. */
  overlay: boolean;
  /** Effective rendering width of left slot (rail width if collapsed). */
  leftSlotWidth: number;
  /** Effective rendering width of right slot. */
  rightSlotWidth: number;

  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  toggleLeftCollapsed: () => void;
  toggleRightCollapsed: () => void;
  toggleSwapSides: () => void;
  cycleOverlayPref: () => void;
}

export function useSidebarLayout(): SidebarLayout {
  const [prefs, setPrefs] = useState<SidebarPrefs>(() => load());
  const { width, isDesktop } = useResponsive();

  useEffect(() => {
    try {
      prefSetJson(PREF_KEYS.sidebarLayout, prefs);
    } catch {
      /* quota — ignore */
    }
  }, [prefs]);

  const overlay = true; // Forced floating glassmorphism for B2B standard


  const leftSlotWidth = prefs.leftCollapsed ? RAIL_WIDTH : prefs.leftWidth;
  const rightSlotWidth = prefs.rightCollapsed ? RAIL_WIDTH : prefs.rightWidth;

  const setLeftWidth = useCallback((w: number) => {
    setPrefs(p => ({ ...p, leftWidth: clamp(w, MIN_LEFT, MAX_LEFT) }));
  }, []);
  const setRightWidth = useCallback((w: number) => {
    setPrefs(p => ({ ...p, rightWidth: clamp(w, MIN_RIGHT, MAX_RIGHT) }));
  }, []);
  const toggleLeftCollapsed = useCallback(() => {
    setPrefs(p => ({ ...p, leftCollapsed: !p.leftCollapsed }));
  }, []);
  const toggleRightCollapsed = useCallback(() => {
    setPrefs(p => ({ ...p, rightCollapsed: !p.rightCollapsed }));
  }, []);
  const toggleSwapSides = useCallback(() => {
    setPrefs(p => ({ ...p, swapSides: !p.swapSides }));
  }, []);
  const cycleOverlayPref = useCallback(() => {
    setPrefs(p => {
      const next: OverlayPref =
        p.overlayPref === 'auto' ? 'always' : p.overlayPref === 'always' ? 'never' : 'auto';
      return { ...p, overlayPref: next };
    });
  }, []);

  return {
    leftWidth: prefs.leftWidth,
    rightWidth: prefs.rightWidth,
    leftCollapsed: prefs.leftCollapsed,
    rightCollapsed: prefs.rightCollapsed,
    swapSides: prefs.swapSides,
    overlayPref: prefs.overlayPref,
    overlay,
    leftSlotWidth,
    rightSlotWidth,
    setLeftWidth,
    setRightWidth,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    toggleSwapSides,
    cycleOverlayPref,
  };
}
