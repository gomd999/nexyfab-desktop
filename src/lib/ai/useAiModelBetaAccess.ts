'use client';

import { useEffect, useState } from 'react';
import { aiModelBetaAccessEnabled } from './aiModelBetaAccess';

let runtimeAccessPromise: Promise<boolean> | null = null;

async function readRuntimeAccess(): Promise<boolean> {
  try {
    const response = await fetch('/api/nexyfab/ai-model-access/', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    if (!response.ok) return false;
    const payload = await response.json() as { enabled?: unknown };
    return payload.enabled === true;
  } catch {
    return false;
  }
}

/**
 * Railway makes service variables available at runtime, while NEXT_PUBLIC
 * replacement happens during the image build. Resolve both so entitlement
 * changes cannot leave a correctly configured production server with a stale
 * client-side lock state.
 */
export function useAiModelBetaAccess(): boolean {
  const buildTimeAccess = aiModelBetaAccessEnabled();
  const [enabled, setEnabled] = useState(buildTimeAccess);

  useEffect(() => {
    if (buildTimeAccess) return;
    let active = true;
    runtimeAccessPromise ??= readRuntimeAccess();
    void runtimeAccessPromise.then(value => {
      if (active && value) setEnabled(true);
    });
    return () => { active = false; };
  }, [buildTimeAccess]);

  return enabled;
}
