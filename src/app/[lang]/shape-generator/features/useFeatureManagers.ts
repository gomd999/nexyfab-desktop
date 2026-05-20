'use client';

/**
 * useFeatureManagers.ts — React hooks for ConfigurationManager + EquationManager.
 *
 * The managers are module-level singletons (one per tab). These hooks
 * lazy-initialise them on first render and keep the module slot in
 * sync with the React component lifecycle.
 *
 * Callers (panels, settings menus) call these hooks to get a stable
 * reference. The pipeline `applyFeaturePipelineDetailed` reads from
 * the module slot directly via `featureContext`.
 */

import { useEffect, useRef } from 'react';
import { ConfigurationManager } from '../config/configurationManager';
import { EquationManager } from '../equations/equationManager';
import {
  setConfigurationManager,
  getConfigurationManager,
  setEquationManager,
  getEquationManager,
} from './featureContext';

export function useConfigurationManager(): ConfigurationManager {
  const ref = useRef<ConfigurationManager | null>(null);
  if (!ref.current) {
    const existing = getConfigurationManager();
    ref.current = existing ?? new ConfigurationManager();
  }
  useEffect(() => {
    setConfigurationManager(ref.current);
    return () => {
      if (getConfigurationManager() === ref.current) {
        setConfigurationManager(null);
      }
    };
  }, []);
  return ref.current;
}

export function useEquationManager(): EquationManager {
  const ref = useRef<EquationManager | null>(null);
  if (!ref.current) {
    const existing = getEquationManager();
    ref.current = existing ?? new EquationManager();
  }
  useEffect(() => {
    setEquationManager(ref.current);
    return () => {
      if (getEquationManager() === ref.current) {
        setEquationManager(null);
      }
    };
  }, []);
  return ref.current;
}
