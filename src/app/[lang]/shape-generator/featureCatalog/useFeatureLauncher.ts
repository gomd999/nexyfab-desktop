'use client';

/**
 * useFeatureLauncher — React state machine around launchFeature().
 *
 * Wires a catalog click (`launch(id)`) to: register loaders → lazy-load
 * the module chunk → resolve the entry function → expose the result for
 * a panel to drive. Tracks idle / loading / ready / failed status.
 *
 * Loaders are registered once on mount (idempotent), so the hook is
 * self-sufficient — a host just renders <CatalogRibbon onPick={launch}/>.
 */

import { useCallback, useEffect, useState } from 'react';
import { launchFeature, type LaunchedFeature } from './featureLauncher';
import { registerAllFeatureLoaders } from './featureLoaders';
import { hasLoader } from './moduleResolver';

export type LaunchStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface FeatureLauncherState {
  activeId: string | null;
  status: LaunchStatus;
  launched: LaunchedFeature | null;
  error: string | null;
  launch: (id: string) => Promise<void>;
  reset: () => void;
  isWired: (id: string) => boolean;
}

export function useFeatureLauncher(): FeatureLauncherState {
  useEffect(() => {
    registerAllFeatureLoaders();
  }, []);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<LaunchStatus>('idle');
  const [launched, setLaunched] = useState<LaunchedFeature | null>(null);
  const [error, setError] = useState<string | null>(null);

  const launch = useCallback(async (id: string) => {
    setActiveId(id);
    setError(null);
    if (!hasLoader(id)) {
      setStatus('failed');
      setLaunched(null);
      setError(`Feature "${id}" is not wired to a loader yet.`);
      return;
    }
    setStatus('loading');
    try {
      const result = await launchFeature(id);
      setLaunched(result);
      setStatus('ready');
    } catch (e) {
      setStatus('failed');
      setLaunched(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const reset = useCallback(() => {
    setActiveId(null);
    setStatus('idle');
    setLaunched(null);
    setError(null);
  }, []);

  return { activeId, status, launched, error, launch, reset, isWired: hasLoader };
}
