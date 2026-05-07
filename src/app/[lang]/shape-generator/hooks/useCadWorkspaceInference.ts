'use client';

import { useEffect } from 'react';
import { useUIStore } from '../store/uiStore';
import { useSceneStore } from '../store/sceneStore';
import { inferCadWorkspaceFromUi } from '../cadWorkspace/inferCadWorkspace';

/**
 * Keeps `cadWorkspace` aligned with open workspace panels + photorealistic render mode.
 * Command palette / panel close paths do not call applyCadWorkspace; this reconciles the dropdown.
 */
export function useCadWorkspaceInference() {
  const activeTab = useUIStore((s) => s.activeTab);
  const showGenDesign = useUIStore((s) => s.showGenDesign);
  const showMotionStudy = useUIStore((s) => s.showMotionStudy);
  const showFEA = useUIStore((s) => s.showFEA);
  const showThermalPanel = useUIStore((s) => s.showThermalPanel);
  const showModalAnalysis = useUIStore((s) => s.showModalAnalysis);
  const showMfgPipeline = useUIStore((s) => s.showMfgPipeline);
  const showAutoDrawing = useUIStore((s) => s.showAutoDrawing);
  const showECADPanel = useUIStore((s) => s.showECADPanel);
  const renderMode = useSceneStore((s) => s.renderMode);

  useEffect(() => {
    const inferred = inferCadWorkspaceFromUi({
      activeTab,
      showGenDesign,
      showMotionStudy,
      showFEA,
      showThermalPanel,
      showModalAnalysis,
      showMfgPipeline,
      showAutoDrawing,
      showECADPanel,
      renderMode,
    });
    const cur = useUIStore.getState().cadWorkspace;
    if (cur !== inferred) {
      useUIStore.setState((d) => {
        d.cadWorkspace = inferred;
      });
    }
  }, [
    activeTab,
    showGenDesign,
    showMotionStudy,
    showFEA,
    showThermalPanel,
    showModalAnalysis,
    showMfgPipeline,
    showAutoDrawing,
    showECADPanel,
    renderMode,
  ]);
}
