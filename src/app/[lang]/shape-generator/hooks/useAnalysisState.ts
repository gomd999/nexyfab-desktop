/**
 * useAnalysisState — extracted from shape-generator/page.tsx
 *
 * Consolidates all FEA / DFM / print-analysis / mass-properties / annotation
 * state bindings that were previously inlined in ShapeGeneratorInner.
 * All reads/writes are delegated to the existing Zustand stores
 * (useAnalysisStore, useUIStore) — no new state is introduced here.
 */

import { useAnalysisStore } from '../store/analysisStore';
import { useUIStore } from '../store/uiStore';

export function useAnalysisState() {
  // ── FEA ──────────────────────────────────────────────────────────────────
  const feaResult            = useAnalysisStore(s => s.feaResult);
  const setFeaResult         = useAnalysisStore(s => s.setFeaResult);
  const feaConditions        = useAnalysisStore(s => s.feaConditions);
  const setFeaConditions     = useAnalysisStore(s => s.setFeaConditions);
  const feaDisplayMode       = useAnalysisStore(s => s.feaDisplayMode);
  const setFeaDisplayMode    = useAnalysisStore(s => s.setFeaDisplayMode);
  const feaDeformationScale  = useAnalysisStore(s => s.feaDeformationScale);
  const setFeaDeformationScale = useAnalysisStore(s => s.setFeaDeformationScale);
  const showFEA              = useUIStore(s => s.showFEA);
  const setShowFEA           = useUIStore(s => s.setShowFEA);

  // ── DFM ──────────────────────────────────────────────────────────────────
  const dfmResults           = useAnalysisStore(s => s.dfmResults);
  const setDfmResults        = useAnalysisStore(s => s.setDfmResults);
  const dfmHighlightedIssue  = useAnalysisStore(s => s.dfmHighlightedIssue);
  const setDfmHighlightedIssue = useAnalysisStore(s => s.setDfmHighlightedIssue);
  const showDFM              = useUIStore(s => s.showDFM);
  const setShowDFM           = useUIStore(s => s.setShowDFM);

  // ── Print Analysis ────────────────────────────────────────────────────────
  const printAnalysis        = useAnalysisStore(s => s.printAnalysis);
  const setPrintAnalysis     = useAnalysisStore(s => s.setPrintAnalysis);
  const printBuildDir        = useAnalysisStore(s => s.printBuildDir);
  const setPrintBuildDir     = useAnalysisStore(s => s.setPrintBuildDir);
  const printOverhangAngle   = useAnalysisStore(s => s.printOverhangAngle);
  const setPrintOverhangAngle = useAnalysisStore(s => s.setPrintOverhangAngle);
  const showPrintAnalysis    = useUIStore(s => s.showPrintAnalysis);
  const setShowPrintAnalysis = useUIStore(s => s.setShowPrintAnalysis);

  // ── Mass Properties ───────────────────────────────────────────────────────
  const showMassProps        = useUIStore(s => s.showMassProps);
  const setShowMassProps     = useUIStore(s => s.setShowMassProps);
  const showCenterOfMass     = useAnalysisStore(s => s.showCenterOfMass);
  const setShowCenterOfMass  = useAnalysisStore(s => s.setShowCenterOfMass);

  // ── Geometry Validation ───────────────────────────────────────────────────
  const validationResult     = useAnalysisStore(s => s.validationResult);
  const setValidationResult  = useAnalysisStore(s => s.setValidationResult);
  const showValidation       = useUIStore(s => s.showValidation);
  const setShowValidation    = useUIStore(s => s.setShowValidation);

  // ── GD&T Annotations ─────────────────────────────────────────────────────
  const gdtAnnotations          = useAnalysisStore(s => s.gdtAnnotations);
  const addGDTAnnotation        = useAnalysisStore(s => s.addGDTAnnotation);
  const updateGDTAnnotation     = useAnalysisStore(s => s.updateGDTAnnotation);
  const removeGDTAnnotation     = useAnalysisStore(s => s.removeGDTAnnotation);
  const dimensionAnnotations    = useAnalysisStore(s => s.dimensionAnnotations);
  const addDimensionAnnotation  = useAnalysisStore(s => s.addDimensionAnnotation);
  const removeDimensionAnnotation = useAnalysisStore(s => s.removeDimensionAnnotation);
  const updateDimensionAnnotation = useAnalysisStore(s => s.setDimensionAnnotations);
  const showAnnotationPanel     = useUIStore(s => s.showAnnotationPanel);
  const setShowAnnotationPanel  = useUIStore(s => s.setShowAnnotationPanel);
  const annotationPlacementMode = useUIStore(s => s.annotationPlacementMode);
  const setAnnotationPlacementMode = useUIStore(s => s.setAnnotationPlacementMode);

  return {
    // FEA
    feaResult, setFeaResult,
    feaConditions, setFeaConditions,
    feaDisplayMode, setFeaDisplayMode,
    feaDeformationScale, setFeaDeformationScale,
    showFEA, setShowFEA,
    // DFM
    dfmResults, setDfmResults,
    dfmHighlightedIssue, setDfmHighlightedIssue,
    showDFM, setShowDFM,
    // Print
    printAnalysis, setPrintAnalysis,
    printBuildDir, setPrintBuildDir,
    printOverhangAngle, setPrintOverhangAngle,
    showPrintAnalysis, setShowPrintAnalysis,
    // Mass
    showMassProps, setShowMassProps,
    showCenterOfMass, setShowCenterOfMass,
    // Validation
    validationResult, setValidationResult,
    showValidation, setShowValidation,
    // GD&T
    gdtAnnotations, addGDTAnnotation, updateGDTAnnotation, removeGDTAnnotation,
    dimensionAnnotations, addDimensionAnnotation, removeDimensionAnnotation, updateDimensionAnnotation,
    showAnnotationPanel, setShowAnnotationPanel,
    annotationPlacementMode, setAnnotationPlacementMode,
  };
}
