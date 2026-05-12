import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ensureOcctReady, setOcctGlobalMode } from '../features/occtEngine'
import { cacheClear } from '../features/pipelineCache'
import { useSceneStore } from './sceneStore'
import type { CadWorkspaceId } from '../cadWorkspace/cadWorkspaceIds'

// ─── Panel exclusivity groups ────────────────────────────────────────────────
// Why: Previously each panel was a flat boolean. Opening one analysis panel
// did not auto-close another, and tab switches required manually listing every
// panel to reset (see the long `state.show* = false` blocks in setActiveTab /
// enableSimpleMode / closeAllPanels). New panels were repeatedly missed from
// those lists, causing two analysis panels to sometimes overlay each other.
//
// Now: panels declared in `analysisPanelKeys` are mutually exclusive — opening
// one auto-closes the others. The dedicated helpers below replace the manual
// reset blocks, so adding a new panel only requires updating this list.

const analysisPanelKeys = [
  'showFEA',
  'showDFM',
  'showDraftAnalysis',
  'showHoleWizard',
  'showMassProps',
  'showAnnotationPanel',
  'showValidation',
  'showPrintAnalysis',
  'showSheetMetalPanel',
  'showCostPanel',
  'showArrayPanel',
  'showPluginManager',
  'showBranchCompare',
  'showCOTSPanel',
  'showProcessRouter',
  'showAISupplierMatch',
  'showCostCopilot',
  'showAIHistory',
  'showOpenScad',
  'showGenDesign',
  'showECADPanel',
  'showThermalPanel',
  'showMotionStudy',
  'showModalAnalysis',
  'showParametricSweep',
  'showToleranceStackup',
  'showSurfaceQuality',
  'showAutoDrawing',
  'showMfgPipeline',
  'showVersionDiff',
] as const
type AnalysisPanelKey = (typeof analysisPanelKeys)[number]

// Modal/upgrade dialogs — these stack on top of panels and have their own
// open/close lifecycle (one-shot CTA dialogs), so they keep individual setters
// rather than going through the exclusive-panel helper. Listed here for
// documentation only:
//   showCamUpgrade, showDFMFixUpgrade, showDFMInsightsUpgrade,
//   showProcessRouterUpgrade, showAISupplierMatchUpgrade,
//   showCostCopilotUpgrade, showCollabEditUpgrade, showExportOptimizeUpgrade

// Independent toggles (orthogonal to analysis panels):
//  - showAIAssistant, showShortcuts, showCommandPalette, showPlanes, showPerf,
//    multiView, showVersionPanel, showHistoryPanel, showAssemblyPanel,
//    showLibrary, showScriptPanel, showRecovery
// These are NOT in either list above and remain independent.

/**
 * Open `key` in the analysis-panel group, auto-closing all peers. When `v` is
 * `false`, only `key` is cleared (peers untouched). Use this from setShow*
 * setters; do NOT mutate the boolean directly when it belongs to the group,
 * or you reintroduce the multi-open bug.
 */
function setExclusivePanel(
  state: Record<AnalysisPanelKey, boolean>,
  key: AnalysisPanelKey,
  v: boolean,
): void {
  if (v) {
    for (const k of analysisPanelKeys) {
      state[k] = k === key
    }
  } else {
    state[key] = false
  }
}

// ─── State ───────────────────────────────────────────────────────────────────

type ViewMode = 'gallery' | 'workspace'
type ActiveTab = 'design' | 'optimize'
type AnnotationPlacementMode = 'none' | 'gdt' | 'dimension'
export type AIAssistantTab = 'chat' | 'advisor' | 'suggestions'

interface UIState {
  viewMode: ViewMode
  activeTab: ActiveTab
  /** Fusion-style ribbon workspace (Design / Render / Generative / …). */
  cadWorkspace: CadWorkspaceId
  simpleMode: boolean   // 간편 모드: 초보자용, 고급 패널 숨김
  showAIAssistant: boolean  // 통합 AI 사이드바 (chat + advisor + suggestions)
  aiAssistantTab: AIAssistantTab
  showShortcuts: boolean
  showCommandPalette: boolean
  showPlanes: boolean
  showPerf: boolean
  multiView: boolean
  showVersionPanel: boolean
  showHistoryPanel: boolean
  showAssemblyPanel: boolean
  showFEA: boolean
  showDFM: boolean
  showDraftAnalysis: boolean
  showHoleWizard: boolean
  showMassProps: boolean
  showAnnotationPanel: boolean
  showValidation: boolean
  showLibrary: boolean
  showPrintAnalysis: boolean
  showSheetMetalPanel: boolean
  showCostPanel: boolean
  showArrayPanel: boolean
  showPluginManager: boolean
  showScriptPanel: boolean
  showBranchCompare: boolean
  showRecovery: boolean
  // F5 — Configuration Table panel (Excel-style multi-config view).
  showConfigurationTable: boolean
  // F7 — DRC custom rule panel.
  showDrcPanel: boolean
  // F9 — PLM/ERP connector config panel.
  showPlmConfig: boolean
  // F1 — Sketch text panel.
  showSketchText: boolean
  // K6 — Smart fastener panel (auto bolt+washer+nut detection).
  showSmartFastener: boolean
  // A7 — SCAD authoring mode: 'quick' = deterministic JSON-intent path (current
  // shape-chat UX, low cost), 'agent' = free-form OpenSCAD coding agent
  // (multi-turn render-fix loop, Pro feature). Default 'quick' so free users
  // never accidentally burn agent budget.
  scadAuthoringMode: 'quick' | 'agent'
  // ── Analysis modal panels (migrated from page.tsx local state) ──
  showCOTSPanel: boolean
  showCamUpgrade: boolean
  showDFMFixUpgrade: boolean
  showDFMInsightsUpgrade: boolean
  showProcessRouter: boolean
  showProcessRouterUpgrade: boolean
  showAISupplierMatch: boolean
  showAISupplierMatchUpgrade: boolean
  showCostCopilot: boolean
  showCostCopilotUpgrade: boolean
  showAIHistory: boolean
  showOpenScad: boolean
  showCollabEditUpgrade: boolean
  showExportOptimizeUpgrade: boolean
  showGenDesign: boolean
  showECADPanel: boolean
  showThermalPanel: boolean
  showMotionStudy: boolean
  showModalAnalysis: boolean
  showParametricSweep: boolean
  showToleranceStackup: boolean
  showSurfaceQuality: boolean
  showAutoDrawing: boolean
  showMfgPipeline: boolean
  showVersionDiff: boolean
  annotationPlacementMode: AnnotationPlacementMode
  shareOpenKey: number
  tabletLeftOpen: boolean
  mobileTab: string | null
  // ── OCCT global engine (phase 2d-3) ──
  occtMode: boolean
  occtReady: boolean
  occtInitPending: boolean
  occtInitError: string | null
}

// ─── Panel boolean keys ───────────────────────────────────────────────────────

type PanelKey =
  | 'showAIAssistant'
  | 'showShortcuts'
  | 'showCommandPalette'
  | 'showPlanes'
  | 'showPerf'
  | 'multiView'
  | 'showVersionPanel'
  | 'showHistoryPanel'
  | 'showAssemblyPanel'
  | 'showFEA'
  | 'showDFM'
  | 'showDraftAnalysis'
  | 'showHoleWizard'
  | 'showMassProps'
  | 'showAnnotationPanel'
  | 'showValidation'
  | 'showLibrary'
  | 'showPrintAnalysis'
  | 'showSheetMetalPanel'
  | 'showCostPanel'
  | 'showArrayPanel'
  | 'showPluginManager'
  | 'showScriptPanel'
  | 'showBranchCompare'
  | 'showRecovery'
  | 'showConfigurationTable'
  | 'showDrcPanel'
  | 'showPlmConfig'
  | 'showSketchText'
  | 'showSmartFastener'
  | 'showCOTSPanel'
  | 'showCamUpgrade'
  | 'showDFMFixUpgrade'
  | 'showDFMInsightsUpgrade'
  | 'showProcessRouter'
  | 'showProcessRouterUpgrade'
  | 'showAISupplierMatch'
  | 'showAISupplierMatchUpgrade'
  | 'showCostCopilot'
  | 'showCostCopilotUpgrade'
  | 'showAIHistory'
  | 'showCollabEditUpgrade'
  | 'showExportOptimizeUpgrade'
  | 'showGenDesign'
  | 'showECADPanel'
  | 'showThermalPanel'
  | 'showMotionStudy'
  | 'showModalAnalysis'
  | 'showParametricSweep'
  | 'showToleranceStackup'
  | 'showSurfaceQuality'
  | 'showAutoDrawing'
  | 'showMfgPipeline'
  | 'showVersionDiff'
  | 'tabletLeftOpen'

// ─── Actions ─────────────────────────────────────────────────────────────────

interface UIActions {
  setViewMode: (mode: ViewMode) => void
  setActiveTab: (tab: ActiveTab) => void
  /** Design/Optimize tab + clear ribbon tool panels; does not change scene renderMode (.nfab hydrate). */
  hydrateMainTabFromProject: (tab: ActiveTab) => void
  setSimpleMode: (v: boolean) => void
  /** 간편 모드 진입: 고급 패널 전부 닫고 simpleMode=true */
  enableSimpleMode: () => void
  /** 전문가 모드 복귀: simpleMode=false */
  disableSimpleMode: () => void
  setShowAIAssistant: (v: boolean) => void
  setAIAssistantTab: (tab: AIAssistantTab) => void
  /** Open sidebar at a specific tab in one call. */
  openAIAssistant: (tab?: AIAssistantTab) => void
  setShowShortcuts: (v: boolean) => void
  setShowCommandPalette: (v: boolean) => void
  setShowPlanes: (v: boolean) => void
  setShowPerf: (v: boolean) => void
  setMultiView: (v: boolean) => void
  setShowVersionPanel: (v: boolean) => void
  setShowHistoryPanel: (v: boolean) => void
  setShowAssemblyPanel: (v: boolean) => void
  setShowFEA: (v: boolean) => void
  setShowDFM: (v: boolean) => void
  setShowDraftAnalysis: (v: boolean) => void
  setShowHoleWizard: (v: boolean) => void
  setShowMassProps: (v: boolean) => void
  setShowAnnotationPanel: (v: boolean) => void
  setShowValidation: (v: boolean) => void
  setShowLibrary: (v: boolean) => void
  setShowPrintAnalysis: (v: boolean) => void
  setShowSheetMetalPanel: (v: boolean) => void
  setShowCostPanel: (v: boolean) => void
  setShowArrayPanel: (v: boolean) => void
  setShowPluginManager: (v: boolean) => void
  setShowScriptPanel: (v: boolean) => void
  setShowBranchCompare: (v: boolean) => void
  setShowRecovery: (v: boolean) => void
  setShowConfigurationTable: (v: boolean) => void
  setShowDrcPanel: (v: boolean) => void
  setShowPlmConfig: (v: boolean) => void
  setShowSketchText: (v: boolean) => void
  setShowSmartFastener: (v: boolean) => void
  setScadAuthoringMode: (m: 'quick' | 'agent') => void
  setShowCOTSPanel: (v: boolean) => void
  setShowCamUpgrade: (v: boolean) => void
  setShowDFMFixUpgrade: (v: boolean) => void
  setShowDFMInsightsUpgrade: (v: boolean) => void
  setShowProcessRouter: (v: boolean) => void
  setShowProcessRouterUpgrade: (v: boolean) => void
  setShowAISupplierMatch: (v: boolean) => void
  setShowAISupplierMatchUpgrade: (v: boolean) => void
  setShowCostCopilot: (v: boolean) => void
  setShowCostCopilotUpgrade: (v: boolean) => void
  setShowAIHistory: (v: boolean) => void
  setShowOpenScad: (v: boolean) => void
  setShowCollabEditUpgrade: (v: boolean) => void
  setShowExportOptimizeUpgrade: (v: boolean) => void
  setShowGenDesign: (v: boolean) => void
  setShowECADPanel: (v: boolean) => void
  setShowThermalPanel: (v: boolean) => void
  setShowMotionStudy: (v: boolean) => void
  setShowModalAnalysis: (v: boolean) => void
  setShowParametricSweep: (v: boolean) => void
  setShowToleranceStackup: (v: boolean) => void
  setShowSurfaceQuality: (v: boolean) => void
  setShowAutoDrawing: (v: boolean) => void
  setShowMfgPipeline: (v: boolean) => void
  setShowVersionDiff: (v: boolean) => void
  setAnnotationPlacementMode: (mode: AnnotationPlacementMode) => void
  setShareOpenKey: (key: number) => void
  setTabletLeftOpen: (v: boolean) => void
  setMobileTab: (tab: string | null) => void
  togglePanel: (panel: PanelKey) => void
  closeAllPanels: () => void
  /** Enable/disable the global OCCT topology engine. Awaits WASM init on
   *  first enable; subsequent toggles are instant. On failure, leaves
   *  occtMode=false and populates occtInitError. */
  setOcctMode: (on: boolean) => Promise<void>
}

type UIStore = UIState & UIActions

// ─── Store ───────────────────────────────────────────────────────────────────

export const useUIStore = create<UIStore>()(
  immer((set, get) => ({
    // State
    viewMode: 'workspace',
    activeTab: 'design',
    cadWorkspace: 'design',
    simpleMode: false,
    showAIAssistant: false,
    aiAssistantTab: 'chat',
    showShortcuts: false,
    showCommandPalette: false,
    showPlanes: false,
    showPerf: false,
    multiView: false,
    showVersionPanel: false,
    showHistoryPanel: false,
    showAssemblyPanel: false,
    showFEA: false,
    showDFM: false,
    showDraftAnalysis: false,
    showHoleWizard: false,
    showMassProps: false,
    showAnnotationPanel: false,
    showValidation: false,
    showLibrary: false,
    showPrintAnalysis: false,
    showSheetMetalPanel: false,
    showCostPanel: false,
    showArrayPanel: false,
    showPluginManager: false,
    showScriptPanel: false,
    showBranchCompare: false,
    showRecovery: false,
    showConfigurationTable: false,
    showDrcPanel: false,
    showPlmConfig: false,
    showSketchText: false,
    showSmartFastener: false,
    scadAuthoringMode: 'quick',
    showCOTSPanel: false,
    showCamUpgrade: false,
    showDFMFixUpgrade: false,
    showDFMInsightsUpgrade: false,
    showProcessRouter: false,
    showProcessRouterUpgrade: false,
    showAISupplierMatch: false,
    showAISupplierMatchUpgrade: false,
    showCostCopilot: false,
    showCostCopilotUpgrade: false,
    showAIHistory: false,
    showOpenScad: false,
    showCollabEditUpgrade: false,
    showExportOptimizeUpgrade: false,
    showGenDesign: false,
    showECADPanel: false,
    showThermalPanel: false,
    showMotionStudy: false,
    showModalAnalysis: false,
    showParametricSweep: false,
    showToleranceStackup: false,
    showSurfaceQuality: false,
    showAutoDrawing: false,
    showMfgPipeline: false,
    showVersionDiff: false,
    annotationPlacementMode: 'none',
    shareOpenKey: 0,
    tabletLeftOpen: true,
    mobileTab: null,
    occtMode: false,
    occtReady: false,
    occtInitPending: false,
    occtInitError: null,

    // Actions
    setViewMode: (mode) =>
      set((state) => {
        state.viewMode = mode
      }),

    setActiveTab: (tab) => {
      set((state) => {
        state.activeTab = tab
        state.cadWorkspace = tab
        for (const k of analysisPanelKeys) state[k] = false
      })
      useSceneStore.getState().setRenderMode('standard')
    },

    hydrateMainTabFromProject: (tab) =>
      set((state) => {
        state.activeTab = tab
        state.cadWorkspace = tab
        for (const k of analysisPanelKeys) state[k] = false
      }),

    setSimpleMode: (v) =>
      set((state) => {
        state.simpleMode = v
      }),

    enableSimpleMode: () => {
      set((state) => {
        state.simpleMode = true
        state.cadWorkspace = 'design'
        // Close all advanced analysis panels (mutual-exclusion group).
        for (const k of analysisPanelKeys) state[k] = false
        // Plus a few independent toggles that should hide in simple mode.
        state.showAIAssistant = false
        state.showPlanes = false
        state.showPerf = false
        state.multiView = false
        state.showVersionPanel = false
        state.showHistoryPanel = false
        state.showAssemblyPanel = false
      })
      useSceneStore.getState().setRenderMode('standard')
    },

    disableSimpleMode: () =>
      set((state) => {
        state.simpleMode = false
      }),

    setShowAIAssistant: (v) =>
      set((state) => {
        state.showAIAssistant = v
      }),

    setAIAssistantTab: (tab) =>
      set((state) => {
        state.aiAssistantTab = tab
      }),

    openAIAssistant: (tab) =>
      set((state) => {
        state.showAIAssistant = true
        if (tab) state.aiAssistantTab = tab
      }),

    setShowShortcuts: (v) =>
      set((state) => {
        state.showShortcuts = v
      }),

    setShowCommandPalette: (v) =>
      set((state) => {
        state.showCommandPalette = v
      }),

    setShowPlanes: (v) =>
      set((state) => {
        state.showPlanes = v
      }),

    setShowPerf: (v) =>
      set((state) => {
        state.showPerf = v
      }),

    setMultiView: (v) =>
      set((state) => {
        state.multiView = v
      }),

    setShowVersionPanel: (v) =>
      set((state) => {
        state.showVersionPanel = v
      }),

    setShowHistoryPanel: (v) =>
      set((state) => {
        state.showHistoryPanel = v
      }),

    setShowAssemblyPanel: (v) =>
      set((state) => {
        state.showAssemblyPanel = v
      }),

    // ─── Analysis-panel setters (mutual-exclusion enforced) ──────────────────
    // Setting any one of these to `true` auto-closes the others in the group.
    // This replaces the bug-prone pattern where every caller had to remember
    // to close peer panels manually.
    setShowFEA: (v) => set((state) => { setExclusivePanel(state, 'showFEA', v) }),
    setShowDFM: (v) => set((state) => { setExclusivePanel(state, 'showDFM', v) }),
    setShowDraftAnalysis: (v) => set((state) => { setExclusivePanel(state, 'showDraftAnalysis', v) }),
    setShowHoleWizard: (v) => set((state) => { setExclusivePanel(state, 'showHoleWizard', v) }),
    setShowMassProps: (v) => set((state) => { setExclusivePanel(state, 'showMassProps', v) }),
    setShowAnnotationPanel: (v) => set((state) => { setExclusivePanel(state, 'showAnnotationPanel', v) }),
    setShowValidation: (v) => set((state) => { setExclusivePanel(state, 'showValidation', v) }),
    setShowPrintAnalysis: (v) => set((state) => { setExclusivePanel(state, 'showPrintAnalysis', v) }),
    setShowSheetMetalPanel: (v) => set((state) => { setExclusivePanel(state, 'showSheetMetalPanel', v) }),
    setShowArrayPanel: (v) => set((state) => { setExclusivePanel(state, 'showArrayPanel', v) }),
    setShowPluginManager: (v) => set((state) => { setExclusivePanel(state, 'showPluginManager', v) }),
    setShowBranchCompare: (v) => set((state) => { setExclusivePanel(state, 'showBranchCompare', v) }),
    setShowCOTSPanel: (v) => set((state) => { setExclusivePanel(state, 'showCOTSPanel', v) }),
    setShowProcessRouter: (v) => set((state) => { setExclusivePanel(state, 'showProcessRouter', v) }),
    setShowAISupplierMatch: (v) => set((state) => { setExclusivePanel(state, 'showAISupplierMatch', v) }),
    setShowCostCopilot: (v) => set((state) => { setExclusivePanel(state, 'showCostCopilot', v) }),
    setShowAIHistory: (v) => set((state) => { setExclusivePanel(state, 'showAIHistory', v) }),
    setShowOpenScad: (v) => set((state) => { setExclusivePanel(state, 'showOpenScad', v) }),
    setShowGenDesign: (v) => set((state) => { setExclusivePanel(state, 'showGenDesign', v) }),
    setShowECADPanel: (v) => set((state) => { setExclusivePanel(state, 'showECADPanel', v) }),
    setShowThermalPanel: (v) => set((state) => { setExclusivePanel(state, 'showThermalPanel', v) }),
    setShowMotionStudy: (v) => set((state) => { setExclusivePanel(state, 'showMotionStudy', v) }),
    setShowModalAnalysis: (v) => set((state) => { setExclusivePanel(state, 'showModalAnalysis', v) }),
    setShowParametricSweep: (v) => set((state) => { setExclusivePanel(state, 'showParametricSweep', v) }),
    setShowToleranceStackup: (v) => set((state) => { setExclusivePanel(state, 'showToleranceStackup', v) }),
    setShowSurfaceQuality: (v) => set((state) => { setExclusivePanel(state, 'showSurfaceQuality', v) }),
    setShowAutoDrawing: (v) => set((state) => { setExclusivePanel(state, 'showAutoDrawing', v) }),
    setShowMfgPipeline: (v) => set((state) => { setExclusivePanel(state, 'showMfgPipeline', v) }),
    setShowVersionDiff: (v) => set((state) => { setExclusivePanel(state, 'showVersionDiff', v) }),

    // ─── Independent toggles (orthogonal to analysis panels) ─────────────────
    setShowLibrary: (v) => set((state) => { state.showLibrary = v }),
    setShowCostPanel: (v) => set((state) => { state.showCostPanel = v }),
    setShowScriptPanel: (v) => set((state) => { state.showScriptPanel = v }),
    setShowRecovery: (v) => set((state) => { state.showRecovery = v }),
    setShowConfigurationTable: (v) => set((state) => { state.showConfigurationTable = v }),
    setShowDrcPanel: (v) => set((state) => { state.showDrcPanel = v }),
    setShowPlmConfig: (v) => set((state) => { state.showPlmConfig = v }),
    setShowSketchText: (v) => set((state) => { state.showSketchText = v }),
    setShowSmartFastener: (v) => set((state) => { state.showSmartFastener = v }),
    setScadAuthoringMode: (m) => set((state) => { state.scadAuthoringMode = m }),

    // ─── Modal/upgrade dialogs (overlay on top of panels) ────────────────────
    setShowCamUpgrade: (v) => set((state) => { state.showCamUpgrade = v }),
    setShowDFMFixUpgrade: (v) => set((state) => { state.showDFMFixUpgrade = v }),
    setShowDFMInsightsUpgrade: (v) => set((state) => { state.showDFMInsightsUpgrade = v }),
    setShowProcessRouterUpgrade: (v) => set((state) => { state.showProcessRouterUpgrade = v }),
    setShowAISupplierMatchUpgrade: (v) => set((state) => { state.showAISupplierMatchUpgrade = v }),
    setShowCostCopilotUpgrade: (v) => set((state) => { state.showCostCopilotUpgrade = v }),
    setShowCollabEditUpgrade: (v) => set((state) => { state.showCollabEditUpgrade = v }),
    setShowExportOptimizeUpgrade: (v) => set((state) => { state.showExportOptimizeUpgrade = v }),

    setAnnotationPlacementMode: (mode) =>
      set((state) => {
        state.annotationPlacementMode = mode
      }),

    setShareOpenKey: (key) =>
      set((state) => {
        state.shareOpenKey = key
      }),

    setTabletLeftOpen: (v) =>
      set((state) => {
        state.tabletLeftOpen = v
      }),

    setMobileTab: (tab) =>
      set((state) => {
        state.mobileTab = tab
      }),

    togglePanel: (panel) =>
      set((state) => {
        (state[panel] as boolean) = !(state[panel] as boolean)
      }),

    setOcctMode: async (on) => {
      if (get().occtMode !== on) {
        cacheClear();
      }
      if (!on) {
        setOcctGlobalMode(false)
        set((state) => {
          state.occtMode = false
          state.occtInitError = null
        })
        return
      }
      // Turning on: init WASM kernel if not already ready.
      set((state) => {
        state.occtInitPending = true
        state.occtInitError = null
      })
      try {
        await ensureOcctReady()
        setOcctGlobalMode(true)
        set((state) => {
          state.occtMode = true
          state.occtReady = true
          state.occtInitPending = false
        })
      } catch (err) {
        setOcctGlobalMode(false)
        set((state) => {
          state.occtMode = false
          state.occtReady = false
          state.occtInitPending = false
          state.occtInitError = err instanceof Error ? err.message : String(err)
        })
      }
    },

    closeAllPanels: () =>
      set((state) => {
        // Analysis panels (mutual-exclusion group)
        for (const k of analysisPanelKeys) state[k] = false
        // Independent toggles
        state.showAIAssistant = false
        state.showShortcuts = false
        state.showCommandPalette = false
        state.showPlanes = false
        state.showPerf = false
        state.multiView = false
        state.showVersionPanel = false
        state.showHistoryPanel = false
        state.showAssemblyPanel = false
        state.showLibrary = false
        state.showCostPanel = false
        state.showScriptPanel = false
        state.showRecovery = false
        // Pending upgrade modals
        state.showCamUpgrade = false
      }),
  }))
)
