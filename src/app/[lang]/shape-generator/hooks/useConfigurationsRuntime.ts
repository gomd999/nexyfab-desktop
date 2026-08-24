'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { ConfigurationTable } from '../configurations/ConfigurationTable';
import { migrateFromV1 } from '../configurations/migrateFromV1';
import {
  ConfigStore,
  migrateToYjs,
  type ConfigStore as ConfigStoreType,
} from '../configurations/ConfigStore';
import { setConfigurationTable as setPipelineConfigurationTable } from '../features/featureContext';
import type { NfabConfigurationV1 } from '../io/nfabFormat';
import { useSceneStore } from '../store/sceneStore';
import type { FeatureHistory, HistoryNode } from '../useFeatureStack';

interface UseConfigurationsRuntimeOptions {
  enabled: boolean;
  featureHistory: FeatureHistory;
  getOrderedNodes: () => HistoryNode[];
  updateNode: (id: string, updates: Partial<HistoryNode>) => void;
}

/**
 * Owns the legacy/v2 configuration bridge while the UI incrementally migrates
 * to ConfigurationTable. The legacy state remains available to .nfab I/O and
 * existing panels; the v2 table remains the feature-pipeline authority.
 */
export function useConfigurationsRuntime({
  enabled,
  featureHistory,
  getOrderedNodes,
  updateNode,
}: UseConfigurationsRuntimeOptions) {
  const [configurations, setConfigurations] = useState<NfabConfigurationV1[]>([]);
  const [activeConfigurationId, setActiveConfigurationId] = useState<string | null>(null);
  const configurationTableRef = useRef<ConfigurationTable | null>(null);

  if (enabled && configurationTableRef.current === null) {
    configurationTableRef.current = migrateFromV1(configurations, activeConfigurationId);
  }

  // The collab bridge can attach a Y.Doc here when the host starts carrying it.
  const configCollabDocRef = useRef<Y.Doc | null>(null);
  const configStoreRef = useRef<ConfigStoreType | null>(null);
  if (enabled && configurationTableRef.current && configStoreRef.current === null) {
    const doc = configCollabDocRef.current;
    if (doc) {
      const localBootstrap = ConfigStore.local(configurationTableRef.current);
      configStoreRef.current = migrateToYjs(localBootstrap, doc);
    } else {
      configStoreRef.current = ConfigStore.local(configurationTableRef.current);
    }
  }

  useEffect(() => {
    setPipelineConfigurationTable(enabled ? configurationTableRef.current : null);
    return () => setPipelineConfigurationTable(null);
  }, [enabled]);

  const getConfigurationsBlock = useCallback(
    () => ({ configurations, activeConfigurationId }),
    [configurations, activeConfigurationId],
  );

  const restoreConfigurationsSnapshot = useCallback(
    (configs: NfabConfigurationV1[] | undefined, activeId: string | null | undefined) => {
      setConfigurations(configs ?? []);
      setActiveConfigurationId(activeId ?? null);
    },
    [],
  );

  const handleConfigurationSelect = useCallback((id: string | null) => {
    if (enabled && configurationTableRef.current) {
      configurationTableRef.current.activate(id);
      setActiveConfigurationId(id);
      return;
    }

    setActiveConfigurationId(id);
    if (id == null) return;
    const config = configurations.find(candidate => candidate.id === id);
    if (!config) return;
    useSceneStore.setState(state => ({
      params: { ...config.params },
      ...(config.paramExpressions !== undefined
        ? { paramExpressions: { ...config.paramExpressions } }
        : { paramExpressions: { ...state.paramExpressions } }),
    }));
    for (const [nodeId, nodeEnabled] of Object.entries(config.featureEnabled)) {
      updateNode(nodeId, { enabled: nodeEnabled });
    }
    for (const node of getOrderedNodes()) {
      if (node.id === featureHistory.rootId || node.type === 'baseShape') continue;
      if (Object.prototype.hasOwnProperty.call(config.featureEnabled, node.id)) continue;
      updateNode(node.id, { enabled: true });
    }
  }, [configurations, enabled, featureHistory.rootId, getOrderedNodes, updateNode]);

  const handleConfigurationAdd = useCallback((name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const scene = useSceneStore.getState();
    const featureEnabled: Record<string, boolean> = {};
    for (const node of getOrderedNodes()) {
      if (node.id === featureHistory.rootId || node.type === 'baseShape') continue;
      featureEnabled[node.id] = node.enabled;
    }
    const id = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `cfg-${Date.now()}`;
    const newConfiguration: NfabConfigurationV1 = {
      id,
      name: trimmed,
      params: { ...scene.params },
      ...(Object.keys(scene.paramExpressions).length > 0
        ? { paramExpressions: { ...scene.paramExpressions } }
        : {}),
      featureEnabled,
    };

    if (enabled && configurationTableRef.current) {
      const table = configurationTableRef.current;
      const migrated = migrateFromV1([newConfiguration], id).get(id);
      if (migrated) {
        table.add(migrated.name, { id: migrated.id });
        for (const [featureId, slot] of Object.entries(migrated.overrides)) {
          if (slot.suppressed) table.setSuppressed(id, featureId, true);
        }
        for (const [variable, value] of Object.entries(migrated.expressionVars)) {
          table.setExpressionVar(id, variable, value);
        }
      }
      table.activate(id);
    }

    setConfigurations(previous => [...previous, newConfiguration]);
    setActiveConfigurationId(id);
  }, [enabled, featureHistory.rootId, getOrderedNodes]);

  const handleConfigurationRename = useCallback((configurationId: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (enabled && configurationTableRef.current) {
      configurationTableRef.current.rename(configurationId, trimmed);
    }
    setConfigurations(previous => previous.map(configuration => (
      configuration.id === configurationId ? { ...configuration, name: trimmed } : configuration
    )));
  }, [enabled]);

  const handleConfigurationDelete = useCallback((id: string) => {
    if (enabled && configurationTableRef.current) configurationTableRef.current.remove(id);
    setConfigurations(previous => previous.filter(configuration => configuration.id !== id));
    setActiveConfigurationId(current => (current === id ? null : current));
  }, [enabled]);

  const configurationsSig = useMemo(
    () => JSON.stringify(configurations) + String(activeConfigurationId),
    [configurations, activeConfigurationId],
  );

  const configurationTreePurgeBootRef = useRef(true);
  useEffect(() => {
    if (configurationTreePurgeBootRef.current) {
      configurationTreePurgeBootRef.current = false;
      return;
    }
    if (featureHistory.nodes.length === 1 && configurations.length > 0) {
      setConfigurations([]);
      setActiveConfigurationId(null);
    }
  }, [featureHistory.nodes.length, featureHistory.rootId, configurations.length]);

  return {
    configurations,
    setConfigurations,
    activeConfigurationId,
    setActiveConfigurationId,
    useConfigurationTableRuntime: enabled,
    configurationTableRef,
    getConfigurationsBlock,
    restoreConfigurationsSnapshot,
    handleConfigurationSelect,
    handleConfigurationAdd,
    handleConfigurationRename,
    handleConfigurationDelete,
    configurationsSig,
  };
}
