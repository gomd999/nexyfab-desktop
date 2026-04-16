import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { ensureOcctReady, setOcctGlobalMode } from '../features/occtEngine'

// ─── State ───────────────────────────────────────────────────────────────────

type ViewMode = 'gallery' | 'workspace'
type ActiveTab = 'design' | 'optimize'
type AnnotationPlacementMode = 'none' | 'gdt' | 'dimension'
export type AIAssistantTab = 'chat' | 'advisor' | 'suggestions'

interface UIState {
  viewMode: ViewMode
  activeTab: ActiveTab
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
  // ── Analysis modal panels (migrated from page.tsx local state) ──
  showCOTSPanel: boolean
  showCamUpgrade: boolean
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
  | 'showCOTSPanel'
  | 'showCamUpgrade'
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
  setShowCOTSPanel: (v: boolean) => void
  setShowCamUpgrade: (v: boolean) => void
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
  immer((set) => ({
    // State
    viewMode: 'workspace',
    activeTab: 'design',
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
    showCOTSPanel: false,
    showCamUpgrade: false,
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

    setActiveTab: (tab) =>
      set((state) => {
        state.activeTab = tab
      }),

    setSimpleMode: (v) =>
      set((state) => {
        state.simpleMode = v
      }),

    enableSimpleMode: () =>
      set((state) => {
        state.simpleMode = true
        // 고급 패널 전부 닫기
        state.showFEA = false
        state.showDFM = false
        state.showMassProps = false
        state.showAnnotationPanel = false
        state.showValidation = false
        state.showPrintAnalysis = false
        state.showSheetMetalPanel = false
        state.showArrayPanel = false
        state.showAIAssistant = false
        state.showPluginManager = false
        state.showBranchCompare = false
        state.showPlanes = false
        state.showPerf = false
        state.multiView = false
        state.showVersionPanel = false
        state.showHistoryPanel = false
        state.showAssemblyPanel = false
        state.showGenDesign = false
        state.showECADPanel = false
        state.showThermalPanel = false
        state.showMotionStudy = false
        state.showModalAnalysis = false
        state.showParametricSweep = false
        state.showToleranceStackup = false
        state.showSurfaceQuality = false
        state.showAutoDrawing = false
        state.showMfgPipeline = false
        state.showVersionDiff = false
      }),

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

    setShowFEA: (v) =>
      set((state) => {
        state.showFEA = v
      }),

    setShowDFM: (v) =>
      set((state) => {
        state.showDFM = v
      }),

    setShowMassProps: (v) =>
      set((state) => {
        state.showMassProps = v
      }),

    setShowAnnotationPanel: (v) =>
      set((state) => {
        state.showAnnotationPanel = v
      }),

    setShowValidation: (v) =>
      set((state) => {
        state.showValidation = v
      }),

    setShowLibrary: (v) =>
      set((state) => {
        state.showLibrary = v
      }),

    setShowPrintAnalysis: (v) =>
      set((state) => {
        state.showPrintAnalysis = v
      }),

    setShowSheetMetalPanel: (v) =>
      set((state) => {
        state.showSheetMetalPanel = v
      }),

    setShowCostPanel: (v) =>
      set((state) => {
        state.showCostPanel = v
      }),

    setShowArrayPanel: (v) =>
      set((state) => {
        state.showArrayPanel = v
      }),

    setShowPluginManager: (v) =>
      set((state) => {
        state.showPluginManager = v
      }),

    setShowScriptPanel: (v) =>
      set((state) => {
        state.showScriptPanel = v
      }),

    setShowBranchCompare: (v) =>
      set((state) => {
        state.showBranchCompare = v
      }),

    setShowRecovery: (v) =>
      set((state) => {
        state.showRecovery = v
      }),

    setShowCOTSPanel: (v) => set((state) => { state.showCOTSPanel = v }),
    setShowCamUpgrade: (v) => set((state) => { state.showCamUpgrade = v }),
    setShowGenDesign: (v) => set((state) => { state.showGenDesign = v }),
    setShowECADPanel: (v) => set((state) => { state.showECADPanel = v }),
    setShowThermalPanel: (v) => set((state) => { state.showThermalPanel = v }),
    setShowMotionStudy: (v) => set((state) => { state.showMotionStudy = v }),
    setShowModalAnalysis: (v) => set((state) => { state.showModalAnalysis = v }),
    setShowParametricSweep: (v) => set((state) => { state.showParametricSweep = v }),
    setShowToleranceStackup: (v) => set((state) => { state.showToleranceStackup = v }),
    setShowSurfaceQuality: (v) => set((state) => { state.showSurfaceQuality = v }),
    setShowAutoDrawing: (v) => set((state) => { state.showAutoDrawing = v }),
    setShowMfgPipeline: (v) => set((state) => { state.showMfgPipeline = v }),
    setShowVersionDiff: (v) => set((state) => { state.showVersionDiff = v }),

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
        state.showAIAssistant = false
        state.showShortcuts = false
        state.showCommandPalette = false
        state.showPlanes = false
        state.showPerf = false
        state.multiView = false
        state.showVersionPanel = false
        state.showHistoryPanel = false
        state.showAssemblyPanel = false
        state.showFEA = false
        state.showDFM = false
        state.showMassProps = false
        state.showAnnotationPanel = false
        state.showValidation = false
        state.showLibrary = false
        state.showPrintAnalysis = false
        state.showSheetMetalPanel = false
        state.showCostPanel = false
        state.showArrayPanel = false
        state.showPluginManager = false
        state.showScriptPanel = false
        state.showBranchCompare = false
        state.showRecovery = false
        state.showCOTSPanel = false
        state.showCamUpgrade = false
        state.showGenDesign = false
        state.showECADPanel = false
        state.showThermalPanel = false
        state.showMotionStudy = false
        state.showModalAnalysis = false
        state.showParametricSweep = false
        state.showToleranceStackup = false
        state.showSurfaceQuality = false
        state.showAutoDrawing = false
        state.showMfgPipeline = false
        state.showVersionDiff = false
      }),
  }))
)
