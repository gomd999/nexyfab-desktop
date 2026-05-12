import { useMemo, useCallback } from 'react';
import type { FeatureInstance } from '../features/types';

/**
 * Step 5.4 of the MainWorkspace decomposition plan.
 *
 * Bundles the three NURBS-control-point props the canvas needs into a
 * single hook. Before this, ShapeGeneratorInner had two IIFE wrappers and
 * a callback whose only purpose was to look up the currently-selected
 * feature each render. The hook memoizes by `selectedFeatureId` so the
 * canvas only re-renders these props when the selection actually changes.
 */
export interface UseNurbsCpEditArgs {
  selectedFeatureId: string | null;
  features: FeatureInstance[];
  updateFeatureParam: (id: string, key: string, value: number) => void;
}

export interface UseNurbsCpEditResult {
  nurbsCPEdit: boolean;
  nurbsCPParams: Record<string, number> | undefined;
  onNurbsCPParamChange: (key: string, value: number) => void;
}

export function useNurbsCpEdit(args: UseNurbsCpEditArgs): UseNurbsCpEditResult {
  const { selectedFeatureId, features, updateFeatureParam } = args;

  const selected = useMemo(() => {
    if (!selectedFeatureId) return null;
    return features.find(f => f.id === selectedFeatureId) ?? null;
  }, [selectedFeatureId, features]);

  const nurbsCPEdit = !!(selected && selected.type === 'nurbsSurface' && selected.enabled);
  const nurbsCPParams = selected?.type === 'nurbsSurface' ? selected.params : undefined;

  const onNurbsCPParamChange = useCallback((key: string, value: number) => {
    if (selectedFeatureId) updateFeatureParam(selectedFeatureId, key, value);
  }, [selectedFeatureId, updateFeatureParam]);

  return { nurbsCPEdit, nurbsCPParams, onNurbsCPParamChange };
}
