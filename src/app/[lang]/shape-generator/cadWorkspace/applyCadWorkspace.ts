import { analytics } from '@/lib/analytics'
import { useUIStore } from '../store/uiStore'
import { useSceneStore } from '../store/sceneStore'
import type { CadWorkspaceId } from './cadWorkspaceIds'

export { CAD_WORKSPACE_ORDER, type CadWorkspaceId, isCadWorkspaceId } from './cadWorkspaceIds'

export type ApplyCadWorkspaceResult = { ok: true } | { ok: false; reason: 'sketch' }

const WORKSPACE_ANALYTICS_THROTTLE_MS = 2500
let lastWorkspaceTrack: { id: string; at: number } | null = null

function trackWorkspaceChange(id: CadWorkspaceId) {
  const now = Date.now()
  if (
    lastWorkspaceTrack &&
    lastWorkspaceTrack.id === id &&
    now - lastWorkspaceTrack.at < WORKSPACE_ANALYTICS_THROTTLE_MS
  ) {
    return
  }
  lastWorkspaceTrack = { id, at: now }
  analytics.shapeGeneratorWorkspace(id)
}

function applyToolWorkspace(id: Exclude<CadWorkspaceId, 'design' | 'optimize'>) {
  const photo = id === 'render'
  useSceneStore.getState().setRenderMode(photo ? 'photorealistic' : 'standard')
  useUIStore.setState((s) => {
    s.cadWorkspace = id
    s.showGenDesign = id === 'generative'
    s.showMotionStudy = id === 'animation'
    s.showFEA = id === 'simulation'
    s.showThermalPanel = id === 'thermal'
    s.showModalAnalysis = id === 'modal'
    s.showMfgPipeline = id === 'manufacture'
    s.showAutoDrawing = id === 'drawing'
    s.showECADPanel = id === 'electronics'
  })
}

/**
 * Fusion-style workspace: maps each workspace to the existing tab + panel + render mode.
 * Design / Optimize clears tool workspaces — see uiStore.setActiveTab.
 * Other workspaces keep the current design|optimize tab and only swap panels + render mode.
 */
export function applyCadWorkspace(
  id: CadWorkspaceId,
  opts?: { isSketchMode?: boolean }
): ApplyCadWorkspaceResult {
  if (id === 'optimize' && opts?.isSketchMode) {
    return { ok: false, reason: 'sketch' }
  }

  const ui = useUIStore.getState()

  if (id === 'design' || id === 'optimize') {
    ui.setActiveTab(id)
    trackWorkspaceChange(id)
    return { ok: true }
  }

  applyToolWorkspace(id)
  trackWorkspaceChange(id)
  return { ok: true }
}
