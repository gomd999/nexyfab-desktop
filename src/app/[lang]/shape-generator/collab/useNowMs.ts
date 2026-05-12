'use client';

import { useEffect, useState } from 'react';

/** Wall-clock tick for stale checks; avoids calling `Date.now()` during render. */
export function useNowMs(intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
