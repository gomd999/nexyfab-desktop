import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { FEAResult, FEABoundaryCondition } from '../analysis/simpleFEA'
import type { FEADisplayMode } from '../analysis/FEAOverlay'
import type { DFMResult, DFMIssue } from '../analysis/dfmAnalysis'
import type { PrintAnalysisResult } from '../analysis/printAnalysis'
import type { ValidationResult } from '../analysis/geometryValidation'
import type { GDTAnnotation, DimensionAnnotation } from '../annotations/GDTTypes'

// ─── State ───────────────────────────────────────────────────────────────────

interface AnalysisState {
  feaResult: FEAResult | null
  feaConditions: FEABoundaryCondition[]
  feaDisplayMode: FEADisplayMode
  feaDeformationScale: number
  dfmResults: DFMResult[] | null
  dfmHighlightedIssue: DFMIssue | null
  printAnalysis: PrintAnalysisResult | null
  printBuildDir: [number, number, number]
  printOverhangAngle: number
  validationResult: ValidationResult | null
  gdtAnnotations: GDTAnnotation[]
  dimensionAnnotations: DimensionAnnotation[]
  showCenterOfMass: [number, number, number] | null
}

// ─── Actions ─────────────────────────────────────────────────────────────────

interface AnalysisActions {
  setFeaResult: (result: FEAResult | null) => void
  setFeaConditions: (conditions: FEABoundaryCondition[]) => void
  setFeaDisplayMode: (mode: FEADisplayMode) => void
  setFeaDeformationScale: (scale: number) => void
  setDfmResults: (results: DFMResult[] | null) => void
  setDfmHighlightedIssue: (issue: DFMIssue | null) => void
  setPrintAnalysis: (result: PrintAnalysisResult | null) => void
  setPrintBuildDir: (dir: [number, number, number]) => void
  setPrintOverhangAngle: (angle: number) => void
  setValidationResult: (result: ValidationResult | null) => void
  setGdtAnnotations: (annotations: GDTAnnotation[]) => void
  setDimensionAnnotations: (annotations: DimensionAnnotation[]) => void
  setShowCenterOfMass: (pos: [number, number, number] | null) => void
  clearAnalysis: () => void
  addGDTAnnotation: (a: GDTAnnotation) => void
  updateGDTAnnotation: (id: string, update: Partial<GDTAnnotation>) => void
  removeGDTAnnotation: (id: string) => void
  addDimensionAnnotation: (a: DimensionAnnotation) => void
  removeDimensionAnnotation: (id: string) => void
}

type AnalysisStore = AnalysisState & AnalysisActions

// ─── Store ───────────────────────────────────────────────────────────────────

export const useAnalysisStore = create<AnalysisStore>()(
  immer((set) => ({
    // State
    feaResult: null,
    feaConditions: [],
    feaDisplayMode: 'stress',
    feaDeformationScale: 100,
    dfmResults: null,
    dfmHighlightedIssue: null,
    printAnalysis: null,
    printBuildDir: [0, 1, 0],
    printOverhangAngle: 45,
    validationResult: null,
    gdtAnnotations: [],
    dimensionAnnotations: [],
    showCenterOfMass: null,

    // Actions
    setFeaResult: (result) =>
      set((state) => {
        state.feaResult = result
      }),

    setFeaConditions: (conditions) =>
      set((state) => {
        state.feaConditions = conditions
      }),

    setFeaDisplayMode: (mode) =>
      set((state) => {
        state.feaDisplayMode = mode
      }),

    setFeaDeformationScale: (scale) =>
      set((state) => {
        state.feaDeformationScale = scale
      }),

    setDfmResults: (results) =>
      set((state) => {
        state.dfmResults = results
      }),

    setDfmHighlightedIssue: (issue) =>
      set((state) => {
        state.dfmHighlightedIssue = issue
      }),

    setPrintAnalysis: (result) =>
      set((state) => {
        state.printAnalysis = result
      }),

    setPrintBuildDir: (dir) =>
      set((state) => {
        state.printBuildDir = dir
      }),

    setPrintOverhangAngle: (angle) =>
      set((state) => {
        state.printOverhangAngle = angle
      }),

    setValidationResult: (result) =>
      set((state) => {
        state.validationResult = result
      }),

    setGdtAnnotations: (annotations) =>
      set((state) => {
        state.gdtAnnotations = annotations
      }),

    setDimensionAnnotations: (annotations) =>
      set((state) => {
        state.dimensionAnnotations = annotations
      }),

    setShowCenterOfMass: (pos) =>
      set((state) => {
        state.showCenterOfMass = pos
      }),

    clearAnalysis: () =>
      set((state) => {
        state.feaResult = null
        state.dfmResults = null
        state.printAnalysis = null
        state.validationResult = null
        state.dfmHighlightedIssue = null
        state.showCenterOfMass = null
        state.gdtAnnotations = []
        state.dimensionAnnotations = []
        state.feaConditions = []
      }),

    addGDTAnnotation: (a) =>
      set((state) => {
        state.gdtAnnotations.push(a)
      }),

    updateGDTAnnotation: (id, update) =>
      set((state) => {
        const idx = state.gdtAnnotations.findIndex((ann) => ann.id === id)
        if (idx !== -1) {
          Object.assign(state.gdtAnnotations[idx], update)
        }
      }),

    removeGDTAnnotation: (id) =>
      set((state) => {
        state.gdtAnnotations = state.gdtAnnotations.filter((ann) => ann.id !== id)
      }),

    addDimensionAnnotation: (a) =>
      set((state) => {
        state.dimensionAnnotations.push(a)
      }),

    removeDimensionAnnotation: (id) =>
      set((state) => {
        state.dimensionAnnotations = state.dimensionAnnotations.filter((ann) => ann.id !== id)
      }),
  }))
)
