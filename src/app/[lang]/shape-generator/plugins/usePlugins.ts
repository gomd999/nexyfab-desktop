'use client';

import { useEffect, useRef, useSyncExternalStore, useCallback } from 'react';
import * as THREE from 'three';
import { pluginRegistry } from './PluginRegistry';
import type { PluginContext, ToolbarButton, CustomShapeDefinition } from './PluginAPI';
import { springManifest, springInit } from './examples/springPlugin';
import { massPropertiesManifest, massPropertiesInit } from './examples/massPropertiesPlugin';

interface UsePluginsOptions {
  getSelectedShape: () => string;
  getParams: () => Record<string, number>;
  getGeometry: () => THREE.BufferGeometry | null;
  setParam: (key: string, value: number) => void;
  addFeature: (type: string) => void;
  showToast: (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;
}

export function usePlugins(options: UsePluginsOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Subscribe to registry changes
  const plugins = useSyncExternalStore(
    (cb) => pluginRegistry.subscribe(cb),
    () => pluginRegistry.getSnapshot(),
    () => pluginRegistry.getSnapshot(), // SSR snapshot
  );

  // Build a PluginContext factory
  const createContext = useCallback((): PluginContext => ({
    getSelectedShape: () => optionsRef.current.getSelectedShape(),
    getParams: () => optionsRef.current.getParams(),
    getGeometry: () => optionsRef.current.getGeometry(),
    setParam: (key, value) => optionsRef.current.setParam(key, value),
    addFeature: (type) => optionsRef.current.addFeature(type),
    showToast: (type, message) => optionsRef.current.showToast(type, message),
    // These are overridden per-plugin by the registry
    registerToolbarButton: () => {},
    registerPanel: () => {},
    registerShape: () => {},
  }), []);

  // Auto-load built-in example plugins on mount
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    // Register built-in example plugins
    if (!pluginRegistry.getPlugin(springManifest.id)) {
      pluginRegistry.registerPlugin(springManifest, springInit, createContext);
    }
    if (!pluginRegistry.getPlugin(massPropertiesManifest.id)) {
      pluginRegistry.registerPlugin(massPropertiesManifest, massPropertiesInit, createContext);
    }
  }, [createContext]);

  // Gather aggregated items from enabled plugins
  const toolbarButtons: ToolbarButton[] = pluginRegistry.getToolbarButtons();
  const customShapes: CustomShapeDefinition[] = pluginRegistry.getCustomShapes();

  return {
    plugins,
    toolbarButtons,
    customShapes,
    createContext,
  };
}
