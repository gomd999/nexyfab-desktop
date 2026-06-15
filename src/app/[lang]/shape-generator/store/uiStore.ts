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
  'showBucklingAnalysis',
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
  simpleMode: boolean   // 간편 모드: 초보자용, 고급 패널 숨김 (back-compat shim, = userPreset === 'basic')
  /**
   * Item 5 of the usability cleanup — replaces the binary simpleMode with a
   * 3-level role preset. Each preset closes / hides a different subset of
   * panels so the canvas density matches the user's role:
   *
   *   - 'basic'    : sketch + basic 3D only. No analysis surfaces. Same as
   *                  the old `simpleMode === true`. Aimed at first-time
   *                  visitors and quick-quote flows.
   *   - 'designer' : sketch + 3D + drawing + library + cost panel. Hides
   *                  validation analyses (FEA / Thermal / Modal / etc.).
   *                  Aimed at industrial designers and quick prototyping.
   *   - 'engineer' : all panels available. Same as the old simpleMode-off
   *                  default. Aimed at engineering validation.
   *
   * `simpleMode` stays in state and is kept in sync so existing call sites
   * (40+ `simpleMode &&` checks across Inner.tsx and panels) keep working.
   */
  userPreset: 'basic' | 'designer' | 'engineer'
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
  /** Phase-2 push/pull edit mode. When true and a face is selected,
   *  the viewport renders a normal-direction arrow hint (phase 2-A) and
   *  will eventually let users drag that arrow to mutate the upstream
   *  feature parameter (phase 2-B, gizmo wiring). */
  pushPullMode: boolean
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
  // ── Unified upgrade gate ──
  // Item 2 of usability cleanup. Replaces 8 separate `show*Upgrade` booleans
  // that all rendered the same UpgradeModal — only the `feature` prop
  // differed. Storing the active feature key here means UpgradeModalsDock
  // mounts a single modal, debugging answers one question ("which gate is
  // open?"), and adding a new gate is `openUpgradeGate('new_feature')` with
  // zero state plumbing. The legacy `show*Upgrade` booleans below are
  // back-compat aliases — their setters route through openUpgradeGate so
  // every call site keeps working unchanged.
  upgradeGateFeature: import('@/hooks/useFreemium').FreemiumFeature | null
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
  showBucklingAnalysis: boolean
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
  | 'showBucklingAnalysis'
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
  /** 간편 모드 진입: 고급 패널 전부 닫고 simpleMode=true (= applyUserPreset('basic')) */
  enableSimpleMode: () => void
  /** Item 5 — set the role preset and apply the matching panel visibility. */
  applyUserPreset: (preset: 'basic' | 'designer' | 'engineer') => void
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
  setPushPullMode: (v: boolean) => void
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
  // Unified upgrade gate actions (Item 2).
  openUpgradeGate: (feature: import('@/hooks/useFreemium').FreemiumFeature) => void
  closeUpgradeGate: () => void
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
  setShowBucklingAnalysis: (v: boolean) => void
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
    userPreset: 'engineer' as const,
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
    pushPullMode: false,
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
    upgradeGateFeature: null,
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
    showBucklingAnalysis: false,
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
        state.userPreset = 'basic'
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

    /**
     * Item 5 — apply a role preset. 'basic' = old simpleMode (everything
     * advanced hidden). 'designer' = keep prototyping panels (cost,
     * library, autoDrawing) but hide validation analyses. 'engineer' =
     * everything available, same as the default unfiltered state.
     *
     * `simpleMode` is updated to match so existing `simpleMode &&` checks
     * across Inner.tsx keep behaving correctly.
     */
    applyUserPreset: (preset) => {
      // Designer-preset visibility list — analyses to hide. Anything not
      // in this set stays at its current value (i.e. we don't *force* a
      // panel open, just close the ones a designer rarely needs).
      const designerHides: AnalysisPanelKey[] = [
        'showFEA',
        'showThermalPanel',
        'showModalAnalysis',
        'showBucklingAnalysis',
        'showParametricSweep',
        'showToleranceStackup',
        'showSurfaceQuality',
        'showGenDesign',
        'showECADPanel',
        'showMotionStudy',
        'showBranchCompare',
        'showVersionDiff',
      ];

      set((state) => {
        state.userPreset = preset;
        state.simpleMode = preset === 'basic';
        if (preset === 'basic') {
          // Same as enableSimpleMode — close everything advanced.
          for (const k of analysisPanelKeys) state[k] = false;
          state.showAIAssistant = false;
          state.showPlanes = false;
          state.showPerf = false;
          state.multiView = false;
          state.showVersionPanel = false;
          state.showHistoryPanel = false;
          state.showAssemblyPanel = false;
          state.cadWorkspace = 'design';
        } else if (preset === 'designer') {
          // Hide validation analyses but keep prototyping panels open if
          // the user had them open. Don't slam the perf/dev panels closed
          // either — designers may want a quick performance check.
          for (const k of designerHides) state[k] = false;
          state.showPerf = false;
        }
        // 'engineer' = no forced closes; whatever is open stays open.
      });

      if (preset === 'basic') {
        useSceneStore.getState().setRenderMode('standard');
      }
    },

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
    // Push/Pull mode is *not* a panel — it's a transient viewport edit
    // mode, so it doesn't participate in the exclusive-panel group.
    setPushPullMode: (v) => set((state) => { state.pushPullMode = v }),
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
    setShowBucklingAnalysis: (v) => set((state) => { setExclusivePanel(state, 'showBucklingAnalysis', v) }),
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
    // ─── Unified upgrade gate (Item 2) ───────────────────────────────────────
    // openUpgradeGate is the canonical entry point — new code should call
    // this. The legacy setShow*Upgrade setters route through it so the 30+
    // existing call sites work unchanged while UpgradeModalsDock reads from
    // upgradeGateFeature for the single rendered modal.
    openUpgradeGate: (feature) => set((state) => {
      state.upgradeGateFeature = feature;
      // Keep the matching back-compat boolean true too, so any code still
      // reading the old boolean (e.g. tests, debug overlays) sees the gate
      // is open. The reverse mapping is small and explicit.
      switch (feature) {
        case 'cam_export':           state.showCamUpgrade = true; break;
        case 'dfm_autofix':          state.showDFMFixUpgrade = true; break;
        case 'dfm_insights':         state.showDFMInsightsUpgrade = true; break;
        case 'process_router':       state.showProcessRouterUpgrade = true; break;
        case 'ai_supplier_match':    state.showAISupplierMatchUpgrade = true; break;
        case 'cost_copilot':         state.showCostCopilotUpgrade = true; break;
        case 'collaboration_edit':   state.showCollabEditUpgrade = true; break;
        case 'export_optimize':      state.showExportOptimizeUpgrade = true; break;
      }
    }),
    closeUpgradeGate: () => set((state) => {
      state.upgradeGateFeature = null;
      // Mirror the close across all back-compat booleans so a stale `true`
      // doesn't keep a modal mounted after the user dismissed.
      state.showCamUpgrade = false;
      state.showDFMFixUpgrade = false;
      state.showDFMInsightsUpgrade = false;
      state.showProcessRouterUpgrade = false;
      state.showAISupplierMatchUpgrade = false;
      state.showCostCopilotUpgrade = false;
      state.showCollabEditUpgrade = false;
      state.showExportOptimizeUpgrade = false;
    }),

    // Legacy setters — keep working but funnel through openUpgradeGate so
    // upgradeGateFeature stays in sync. Code that called these with `false`
    // (i.e. closing) hits closeUpgradeGate to clear the unified field.
    setShowCamUpgrade: (v) => set((state) => {
      state.showCamUpgrade = v;
      state.upgradeGateFeature = v ? 'cam_export' : (state.upgradeGateFeature === 'cam_export' ? null : state.upgradeGateFeature);
    }),
    setShowDFMFixUpgrade: (v) => set((state) => {
      state.showDFMFixUpgrade = v;
      state.upgradeGateFeature = v ? 'dfm_autofix' : (state.upgradeGateFeature === 'dfm_autofix' ? null : state.upgradeGateFeature);
    }),
    setShowDFMInsightsUpgrade: (v) => set((state) => {
      state.showDFMInsightsUpgrade = v;
      state.upgradeGateFeature = v ? 'dfm_insights' : (state.upgradeGateFeature === 'dfm_insights' ? null : state.upgradeGateFeature);
    }),
    setShowProcessRouterUpgrade: (v) => set((state) => {
      state.showProcessRouterUpgrade = v;
      state.upgradeGateFeature = v ? 'process_router' : (state.upgradeGateFeature === 'process_router' ? null : state.upgradeGateFeature);
    }),
    setShowAISupplierMatchUpgrade: (v) => set((state) => {
      state.showAISupplierMatchUpgrade = v;
      state.upgradeGateFeature = v ? 'ai_supplier_match' : (state.upgradeGateFeature === 'ai_supplier_match' ? null : state.upgradeGateFeature);
    }),
    setShowCostCopilotUpgrade: (v) => set((state) => {
      state.showCostCopilotUpgrade = v;
      state.upgradeGateFeature = v ? 'cost_copilot' : (state.upgradeGateFeature === 'cost_copilot' ? null : state.upgradeGateFeature);
    }),
    setShowCollabEditUpgrade: (v) => set((state) => {
      state.showCollabEditUpgrade = v;
      state.upgradeGateFeature = v ? 'collaboration_edit' : (state.upgradeGateFeature === 'collaboration_edit' ? null : state.upgradeGateFeature);
    }),
    setShowExportOptimizeUpgrade: (v) => set((state) => {
      state.showExportOptimizeUpgrade = v;
      state.upgradeGateFeature = v ? 'export_optimize' : (state.upgradeGateFeature === 'export_optimize' ? null : state.upgradeGateFeature);
    }),

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
      // Remember the choice so the kernel-of-record default (auto-enable on
      // boot) respects a user who deliberately switched back to the mesh path.
      if (typeof window !== 'undefined') {
        try { window.localStorage.setItem('nf_occt_pref', on ? 'on' : 'off'); } catch { /* private mode */ }
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
