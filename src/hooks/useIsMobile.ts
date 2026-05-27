'use client';

// Mobile detection hook — reacts to viewport resize + pointer-coarse media
// query. Mobile flag is true when either dimension OR pointer-type indicates
// touch-primary use. Used by shell-v2 chrome to collapse rails, expose
// bottom bars, and switch ribbon to a vertical accordion.

import { useEffect, useState } from 'react';

const MOBILE_BREAKPOINT_PX = 768;

function detect(): boolean {
  if (typeof window === 'undefined') return false;
  const narrow = window.innerWidth < MOBILE_BREAKPOINT_PX;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return narrow || coarse;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => detect());
  useEffect(() => {
    const onResize = () => setIsMobile(detect());
    window.addEventListener('resize', onResize);
    const mq = window.matchMedia?.('(pointer: coarse)');
    mq?.addEventListener?.('change', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      mq?.removeEventListener?.('change', onResize);
    };
  }, []);
  return isMobile;
}
