import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'
import type { ShapeResult } from '../shapes'
import type { SketchProfile, SketchConfig, SketchTool } from '../sketch/types'
import type { ArrayPattern } from '../features/instanceArray'
import type { RenderSettings } from '../rendering/RenderPanel'

// ─── State ───────────────────────────────────────────────────────────────────

interface SceneState {
  selectedId: string
  params: Record<string, number>
  paramExpressions: Record<string, string>
  materialId: string
  color: string
  isSketchMode: boolean
  sketchViewMode: '2d' | '3d' | 'drawing'
  sketchPlane: 'xy' | 'xz' | 'yz'
  sketchProfile: SketchProfile
  sketchConfig: SketchConfig
  sketchTool: SketchTool
  sketchResult: ShapeResult | null
  previewResult: ShapeResult | null
  isPreviewMode: boolean
  arrayPattern: ArrayPattern | null
  renderMode: 'standard' | 'photorealistic'
  renderSettings: RenderSettings | null
  explodeFactor: number
  /** Command toolbar chrome: dark (default) or high-contrast light ribbon. */
  ribbonTheme: 'dark' | 'lightRibbon'
  /**
   * Round 33: split-screen layout for power users (planner/engineer dual
   * view). 'off' = single 3D viewport (default); 'side-notes' = scratch-pad
   * notes panel pinned to the left; 'side-spec' = sketch/spec view alongside
   * the 3D viewport. Persisted so the user's preferred layout sticks across
   * sessions; toggled via Ctrl+\\ keyboard shortcut.
   */
  splitMode: 'off' | 'side-notes' | 'side-spec'
  /**
   * Cross-panel highlight cursor. Set when a downstream view (DFM warning,
   * Mass Props, etc.) wants to draw the user's eye to a specific feature in
   * the design tree. FeatureTree reads this and renders a glow on the
   * matching row. Cleared by the consumer (or by selecting another feature).
   */
  highlightedFeatureId: string | null
}

// ─── Actions ─────────────────────────────────────────────────────────────────

interface SceneActions {
  setSelectedId: (id: string) => void
  setParams: (params: Record<string, number>) => void
  setParam: (key: string, value: number) => void
  setParamExpressions: (exprs: Record<string, string>) => void
  setParamExpression: (key: string, expr: string) => void
  setMaterialId: (id: string) => void
  setColor: (color: string) => void
  setSketchMode: (active: boolean) => void
  setSketchViewMode: (mode: '2d' | '3d' | 'drawing') => void
  setSketchPlane: (plane: 'xy' | 'xz' | 'yz') => void
  setSketchProfile: (profile: SketchProfile) => void
  setSketchConfig: (config: SketchConfig) => void
  setSketchTool: (tool: SketchTool) => void
  setSketchResult: (result: ShapeResult | null) => void
  setPreviewResult: (result: ShapeResult | null) => void
  setIsPreviewMode: (active: boolean) => void
  setArrayPattern: (pattern: ArrayPattern | null) => void
  setRenderMode: (mode: 'standard' | 'photorealistic') => void
  setRenderSettings: (settings: RenderSettings | null) => void
  setExplodeFactor: (factor: number) => void
  setRibbonTheme: (theme: 'dark' | 'lightRibbon') => void
  setSplitMode: (mode: 'off' | 'side-notes' | 'side-spec') => void
  toggleSplitMode: () => void
  setHighlightedFeatureId: (id: string | null) => void
}

type SceneStore = SceneState & SceneActions

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULT_SKETCH_PROFILE: SketchProfile = { segments: [], closed: false }
const DEFAULT_SKETCH_CONFIG: SketchConfig = {
  mode: 'extrude',
  depth: 50,
  revolveAngle: 360,
  revolveAxis: 'y',
  segments: 32,
}

// ─── Store ───────────────────────────────────────────────────────────────────

export const useSceneStore = create<SceneStore>()(
  persist(
    immer((set) => ({
      // State
      selectedId: 'box',
      params: {},
      paramExpressions: {},
      materialId: 'aluminum',
      color: '#4FC3F7',
      isSketchMode: true,
      sketchViewMode: '2d',
      sketchPlane: 'xy',
      sketchProfile: DEFAULT_SKETCH_PROFILE,
      sketchConfig: DEFAULT_SKETCH_CONFIG,
      sketchTool: 'line' as SketchTool,
      sketchResult: null,
      previewResult: null,
      isPreviewMode: false,
      arrayPattern: null,
      renderMode: 'standard',
      renderSettings: null,
      explodeFactor: 0,
      ribbonTheme: 'lightRibbon' as const,
      splitMode: 'off' as const,
      highlightedFeatureId: null,

      // Actions
      setSelectedId: (id) =>
        set((state) => {
          state.selectedId = id
        }),

      setParams: (params) =>
        set((state) => {
          state.params = params
        }),

      setParam: (key, value) =>
        set((state) => {
          state.params[key] = value
        }),

      setParamExpressions: (exprs) =>
        set((state) => {
          state.paramExpressions = exprs
        }),

      setParamExpression: (key, expr) =>
        set((state) => {
          state.paramExpressions[key] = expr
        }),

      setMaterialId: (id) =>
        set((state) => {
          state.materialId = id
        }),

      setColor: (color) =>
        set((state) => {
          state.color = color
        }),

      setSketchMode: (active) =>
        set((state) => {
          state.isSketchMode = active
        }),

      setSketchViewMode: (mode) =>
        set((state) => {
          state.sketchViewMode = mode
        }),

      setSketchPlane: (plane) =>
        set((state) => {
          state.sketchPlane = plane
        }),

      setSketchProfile: (profile) =>
        set((state) => {
          state.sketchProfile = profile
        }),

      setSketchConfig: (config) =>
        set((state) => {
          state.sketchConfig = config
        }),

      setSketchTool: (tool) =>
        set((state) => {
          state.sketchTool = tool
        }),

      setSketchResult: (result) =>
        set((state) => {
          state.sketchResult = result
        }),

      setPreviewResult: (result) =>
        set((state) => {
          state.previewResult = result
        }),

      setIsPreviewMode: (active) =>
        set((state) => {
          state.isPreviewMode = active
        }),

      setArrayPattern: (pattern) =>
        set((state) => {
          state.arrayPattern = pattern
        }),

      setRenderMode: (mode) =>
        set((state) => {
          state.renderMode = mode
        }),

      setRenderSettings: (settings) =>
        set((state) => {
          state.renderSettings = settings
        }),

      setExplodeFactor: (factor) =>
        set((state) => {
          state.explodeFactor = factor
        }),

      setRibbonTheme: (theme) =>
        set((state) => {
          state.ribbonTheme = theme
        }),

      setSplitMode: (mode) =>
        set((state) => {
          state.splitMode = mode
        }),

      // Cycles off → side-notes → side-spec → off, used by the Ctrl+\ shortcut.
      // Keeping the cycle inside the store so the keybinding handler can stay
      // a one-liner.
      toggleSplitMode: () =>
        set((state) => {
          const next: Record<typeof state.splitMode, typeof state.splitMode> = {
            'off': 'side-notes',
            'side-notes': 'side-spec',
            'side-spec': 'off',
          };
          state.splitMode = next[state.splitMode];
        }),

      setHighlightedFeatureId: (id) =>
        set((state) => {
          state.highlightedFeatureId = id
        }),
    })),
    {
      name: 'nexyfab-scene',
      partialize: (state) => ({
        selectedId: state.selectedId,
        params: state.params,
        materialId: state.materialId,
        color: state.color,
        renderMode: state.renderMode,
        // Strip volatile blob: URLs from customHdri before persisting — those
        // are tied to the document lifetime and become 404s after reload,
        // which crashes RGBELoader. The rest of renderSettings (preset,
        // exposure, shadow intensity) survives normally.
        renderSettings: state.renderSettings
          ? {
              ...state.renderSettings,
              customHdriUrl: state.renderSettings.customHdriUrl?.startsWith('blob:')
                ? undefined
                : state.renderSettings.customHdriUrl,
              customHdriName: state.renderSettings.customHdriUrl?.startsWith('blob:')
                ? undefined
                : state.renderSettings.customHdriName,
            }
          : null,
        splitMode: state.splitMode,
      }),
    }
  )
)
