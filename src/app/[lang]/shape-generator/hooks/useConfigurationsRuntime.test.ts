// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSceneStore } from '../store/sceneStore';
import type { FeatureHistory, HistoryNode } from '../useFeatureStack';
import { useConfigurationsRuntime } from './useConfigurationsRuntime';

const root: HistoryNode = {
  id: 'root', type: 'baseShape', label: 'Base', icon: 'base', params: {}, enabled: true,
  expanded: true, parentId: null, children: ['feature-1'], editingActive: false, timestamp: 1,
};
const feature: HistoryNode = {
  id: 'feature-1', type: 'feature', label: 'Hole', icon: 'feature', params: {}, enabled: false,
  expanded: true, parentId: 'root', children: [], editingActive: false, timestamp: 2,
};
const history: FeatureHistory = {
  nodes: [root, feature], rootId: root.id, activeNodeId: feature.id, editingNodeId: null,
};

afterEach(() => {
  useSceneStore.setState({ params: {}, paramExpressions: {} });
  vi.restoreAllMocks();
});

describe('useConfigurationsRuntime', () => {
  it('preserves legacy add, activate, rename, and delete behavior', () => {
    useSceneStore.setState({ params: { width: 42 }, paramExpressions: { width: '=base * 2' } });
    const updateNode = vi.fn();
    const { result, unmount } = renderHook(() => useConfigurationsRuntime({
      enabled: false,
      featureHistory: history,
      getOrderedNodes: () => [root, feature],
      updateNode,
    }));

    act(() => result.current.handleConfigurationAdd(' Production '));
    expect(result.current.configurations).toHaveLength(1);
    expect(result.current.configurations[0]).toMatchObject({
      name: 'Production', params: { width: 42 }, featureEnabled: { 'feature-1': false },
    });
    expect(result.current.getConfigurationsBlock().activeConfigurationId)
      .toBe(result.current.configurations[0]!.id);

    act(() => result.current.handleConfigurationSelect(result.current.configurations[0]!.id));
    expect(updateNode).toHaveBeenCalledWith('feature-1', { enabled: false });

    act(() => result.current.handleConfigurationRename(result.current.configurations[0]!.id, 'Machined'));
    expect(result.current.configurations[0]!.name).toBe('Machined');

    act(() => result.current.handleConfigurationDelete(result.current.configurations[0]!.id));
    expect(result.current.configurations).toEqual([]);
    expect(result.current.activeConfigurationId).toBeNull();
    unmount();
  });

  it('routes v2 selection through ConfigurationTable without mutating feature nodes', () => {
    useSceneStore.setState({ params: { width: 10 }, paramExpressions: {} });
    const updateNode = vi.fn();
    const { result, unmount } = renderHook(() => useConfigurationsRuntime({
      enabled: true,
      featureHistory: history,
      getOrderedNodes: () => [root, feature],
      updateNode,
    }));

    act(() => result.current.handleConfigurationAdd('V2'));
    const id = result.current.configurations[0]!.id;
    act(() => result.current.handleConfigurationSelect(id));
    expect(result.current.configurationTableRef.current?.getActiveId()).toBe(id);
    expect(updateNode).not.toHaveBeenCalled();
    unmount();
  });
});
