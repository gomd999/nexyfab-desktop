'use client';

import { useEffect } from 'react';
import { captureUtmFromUrl } from '@/lib/utm-tracker';

/**
 * Renders nothing — its sole purpose is to call captureUtmFromUrl on mount
 * so any utm_* params in the landing URL get persisted to sessionStorage
 * before they're lost to client-side navigation.
 *
 * Mounted in [lang]/layout.tsx so every page entry is covered.
 */
export default function UtmListener() {
  useEffect(() => {
    captureUtmFromUrl();
  }, []);
  return null;
}
