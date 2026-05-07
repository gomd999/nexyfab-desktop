'use client';

import { useState, useEffect, useCallback } from 'react';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export interface ResponsiveState {
  device: DeviceType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  height: number;
}

function getDevice(width: number): DeviceType {
  if (width < 768) return 'mobile';
  if (width <= 1024) return 'tablet';
  return 'desktop';
}

export function useResponsive(): ResponsiveState {
  const [state, setState] = useState<ResponsiveState>(() => {
    if (typeof window === 'undefined') {
      return { device: 'desktop', isMobile: false, isTablet: false, isDesktop: true, width: 1280, height: 800 };
    }
    const w = window.innerWidth;
    const h = window.innerHeight;
    const d = getDevice(w);
    return { device: d, isMobile: d === 'mobile', isTablet: d === 'tablet', isDesktop: d === 'desktop', width: w, height: h };
  });

  const handleResize = useCallback(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const d = getDevice(w);
    setState({ device: d, isMobile: d === 'mobile', isTablet: d === 'tablet', isDesktop: d === 'desktop', width: w, height: h });
  }, []);

  useEffect(() => {
    // Use matchMedia for efficient breakpoint detection
    const mqMobile = window.matchMedia('(max-width: 767px)');
    const mqTablet = window.matchMedia('(min-width: 768px) and (max-width: 1024px)');

    const onChange = () => handleResize();
    mqMobile.addEventListener('change', onChange);
    mqTablet.addEventListener('change', onChange);
    window.addEventListener('resize', handleResize);

    // Initial sync
    handleResize();

    return () => {
      mqMobile.removeEventListener('change', onChange);
      mqTablet.removeEventListener('change', onChange);
      window.removeEventListener('resize', handleResize);
    };
  }, [handleResize]);

  return state;
}
