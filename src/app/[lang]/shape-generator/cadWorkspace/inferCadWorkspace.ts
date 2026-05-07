import type { CadWorkspaceId } from './cadWorkspaceIds'

/** When multiple panels are open, first match in this order wins (command palette overlap). */
export function inferCadWorkspaceFromUi(input: {
  activeTab: 'design' | 'optimize'
  showGenDesign: boolean
  showMotionStudy: boolean
  showFEA: boolean
  showThermalPanel: boolean
  showModalAnalysis: boolean
  showMfgPipeline: boolean
  showAutoDrawing: boolean
  showECADPanel: boolean
  renderMode: 'standard' | 'photorealistic'
}): CadWorkspaceId {
  if (input.showGenDesign) return 'generative'
  if (input.showMotionStudy) return 'animation'
  if (input.showFEA) return 'simulation'
  if (input.showThermalPanel) return 'thermal'
  if (input.showModalAnalysis) return 'modal'
  if (input.showMfgPipeline) return 'manufacture'
  if (input.showAutoDrawing) return 'drawing'
  if (input.showECADPanel) return 'electronics'
  if (input.renderMode === 'photorealistic') return 'render'
  return input.activeTab
}
