import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { persist } from 'zustand/middleware'
import type { ShapeResult } from '../shapes'
import type { SketchProfile, SketchConfig, SketchTool } from '../sketch/types'
import type { ArrayPattern } from '../features/instanceArray'

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
  explodeFactor: number
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
  setExplodeFactor: (factor: number) => void
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
      explodeFactor: 0,

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

      setExplodeFactor: (factor) =>
        set((state) => {
          state.explodeFactor = factor
        }),
    })),
    {
      name: 'nexyfab-scene',
      partialize: (state) => ({
        selectedId: state.selectedId,
        params: state.params,
        materialId: state.materialId,
        color: state.color,
      }),
    }
  )
)
