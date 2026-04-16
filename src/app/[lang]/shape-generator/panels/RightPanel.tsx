'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { useUIStore } from '../store/uiStore';
import { useAnalysisStore } from '../store/analysisStore';
import { useSceneStore } from '../store/sceneStore';
import { useResponsive } from '../responsive/useResponsive';
import { useTheme } from '../ThemeContext';
import ShapeChat from '../ShapeChat';
import AIAssistantSidebar from '../analysis/AIAssistantSidebar';
import type { ShapeResult } from '../shapes';
import type { DesignContext } from '../ShapeChat';
import type { OptimizeResult, ModifyResult } from '../ShapeChat';
import type { AssemblyMate } from '../assembly/AssemblyMates';
import type { InterferenceResult } from '../assembly/InterferenceDetection';
import type { MassProperties } from '../analysis/massProperties';
import type { GeometryMetrics } from '../estimation/CostEstimator';
import type { PrintAnalysisOptions, OrientationOptimizationResult } from '../analysis/printAnalysis';
import type { ManufacturingProcess } from '../analysis/dfmAnalysis';
import type { FEAMaterial } from '../analysis/simpleFEA';
import type { GDTAnnotation, DimensionAnnotation } from '../annotations/GDTTypes';
import type { ArrayPattern } from '../features/instanceArray';
import type { UnitSystem } from '../units';

// ─── Dynamic imports ──────────────────────────────────────────────────────────
const PrintAnalysisPanel = dynamic(() => import('../analysis/PrintAnalysisPanel'), { ssr: false });
const DFMPanelDynamic = dynamic(() => import('../analysis/DFMPanel'), { ssr: false });
const FEAPanelDynamic = dynamic(() => import('../analysis/FEAPanel'), { ssr: false });
const AnnotationPanel = dynamic(() => import('../annotations/AnnotationPanel'), { ssr: false });
const MassPropertiesPanelDynamic = dynamic(() => import('../analysis/MassPropertiesPanel'), { ssr: false });
const AssemblyPanel = dynamic(() => import('../assembly/AssemblyPanel'), { ssr: false });
const CostPanel = dynamic(() => import('../estimation/CostPanel'), { ssr: false });
const SupplierPanel = dynamic(() => import('../estimation/SupplierPanel'), { ssr: false });
const ArrayPanelDynamic = dynamic(() => import('../ArrayPanel'), { ssr: false });

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RightPanelProps {
  lang: string;
  t: Record<string, string>;

  // Geometry / result data
  effectiveResult: ShapeResult | null;
  geometryMetrics: GeometryMetrics | null;
  massProperties: MassProperties | null;
  feaTotalFaces: number;
  unitSystem: UnitSystem;

  // Assembly state (local state in page.tsx)
  assemblyMates: AssemblyMate[];
  interferenceResults: InterferenceResult[];
  interferenceLoading: boolean;
  assemblyPartNames: string[];
  bomPartsLength: number; // to gate AssemblyPanel (bomParts.length > 1)

  // AI Chat state
  designContext: DesignContext;
  pendingChatMsg: string | null;
  isPreviewMode: boolean;
  isSketchMode: boolean;

  // ── Callbacks: Print Analysis ──
  onPrintAnalyze: (options: PrintAnalysisOptions) => void;
  printOptimization?: OrientationOptimizationResult | null;
  onOptimizeOrientation?: (overhangAngle: number, currentDirection: [number, number, number]) => void;
  onApplyOptimalOrientation?: (direction: [number, number, number]) => void;
  onExportPrintReady?: (settings: {
    process: 'fdm' | 'sla' | 'sls';
    layerHeight: number;
    infillPercent: number;
    printSpeed: number;
    buildDirection: [number, number, number];
  }) => void;

  // ── Callbacks: DFM ──
  onDFMAnalyze: (
    processes: ManufacturingProcess[],
    options: { minWallThickness: number; minDraftAngle: number; maxAspectRatio: number },
  ) => void;
  /** Feature-based process recommendations from useProcessRecommendation */
  processRecommendations?: Array<{ process: ManufacturingProcess; confidence: number; reasons: string[]; emoji: string }>;

  // ── Callbacks: FEA ──
  onFEARunAnalysis: (material: FEAMaterial) => void;

  // ── Callbacks: Annotations ──
  onAddGDT: (a: GDTAnnotation) => void;
  onUpdateGDT: (id: string, u: Partial<GDTAnnotation>) => void;
  onRemoveGDT: (id: string) => void;
  onAddDimension: (a: DimensionAnnotation) => void;
  onUpdateDimension: (id: string, u: Partial<DimensionAnnotation>) => void;
  onRemoveDimension: (id: string) => void;

  // ── Callbacks: Dimension Advisor ──
  onApplyDimension: (param: string, value: number) => void;

  // ── Callbacks: Assembly ──
  onAddMate: (mate: AssemblyMate) => void;
  onRemoveMate: (id: string) => void;
  onUpdateMate: (id: string, updates: Partial<AssemblyMate>) => void;
  onDetectInterference: () => void;

  // ── Callbacks: Cost / Quote ──
  onGetQuote: () => void;

  // ── Callbacks: Array Panel ──
  onApplyArray: (pattern: ArrayPattern) => void;

  // ── Callbacks: AI Chat ──
  onChatApplySingle: (r: { shapeId: string | null; params: Record<string, number>; features: Array<{ type: string; params: Record<string, number> }>; message: string }) => void;
  onChatApplyBom: (parts: Array<{ name: string; shapeId: string; params: Record<string, number>; features: Array<{ type: string; params: Record<string, number> }>; quantity: number; position?: [number, number, number]; rotation?: [number, number, number] }>, productName?: string) => void;
  onBomPreview: (parts: Array<{ name: string; shapeId: string; params: Record<string, number>; features?: Array<{ type: string; params: Record<string, number> }>; position?: [number, number, number]; rotation?: [number, number, number] }>, productName: string) => void;
  onChatApplySketch: Parameters<typeof ShapeChat>[0]['onApplySketch'];
  onChatApplyOptimize: (opt: OptimizeResult) => void;
  onChatApplyModify: (mod: ModifyResult) => void;
  onModifyAutoApplied?: (actionCount: number) => void;
  onAiPreview: (data: any) => void;
  onCancelPreview: () => void;

  // ── AIAdvisor (Suggestions tab) ──
  onTextToCAD: (shapeId: string, params: Record<string, number>) => void;

  // ── Chat history persistence ──
  chatHistory?: import('../ShapeChat').ChatMessage[];
  onChatHistoryChange?: (msgs: import('../ShapeChat').ChatMessage[]) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

function RightPanel({
  lang, t,
  effectiveResult, geometryMetrics, massProperties, feaTotalFaces, unitSystem,
  assemblyMates, interferenceResults, interferenceLoading, assemblyPartNames, bomPartsLength,
  designContext, pendingChatMsg, isPreviewMode, isSketchMode,
  onPrintAnalyze, printOptimization, onOptimizeOrientation, onApplyOptimalOrientation, onExportPrintReady,
  onDFMAnalyze, processRecommendations, onFEARunAnalysis,
  onAddGDT, onUpdateGDT, onRemoveGDT, onAddDimension, onUpdateDimension, onRemoveDimension,
  onApplyDimension,
  onAddMate, onRemoveMate, onUpdateMate, onDetectInterference,
  onGetQuote,
  onApplyArray,
  onChatApplySingle, onChatApplyBom, onBomPreview, onChatApplySketch,
  onChatApplyOptimize, onChatApplyModify, onModifyAutoApplied, onAiPreview, onCancelPreview,
  onTextToCAD,
  chatHistory, onChatHistoryChange,
}: RightPanelProps) {
  const { theme } = useTheme();
  const { isMobile, isTablet } = useResponsive();

  // ── UIStore: show flags ──
  const showPrintAnalysis = useUIStore(s => s.showPrintAnalysis);
  const setShowPrintAnalysis = useUIStore(s => s.setShowPrintAnalysis);
  const showDFM = useUIStore(s => s.showDFM);
  const setShowDFM = useUIStore(s => s.setShowDFM);
  const showFEA = useUIStore(s => s.showFEA);
  const setShowFEA = useUIStore(s => s.setShowFEA);
  const showAnnotationPanel = useUIStore(s => s.showAnnotationPanel);
  const setShowAnnotationPanel = useUIStore(s => s.setShowAnnotationPanel);
  const annotationPlacementMode = useUIStore(s => s.annotationPlacementMode);
  const setAnnotationPlacementMode = useUIStore(s => s.setAnnotationPlacementMode);
  const showMassProps = useUIStore(s => s.showMassProps);
  const setShowMassProps = useUIStore(s => s.setShowMassProps);
  const showAssemblyPanel = useUIStore(s => s.showAssemblyPanel);
  const setShowAssemblyPanel = useUIStore(s => s.setShowAssemblyPanel);
  const showCostPanel = useUIStore(s => s.showCostPanel);
  const setShowCostPanel = useUIStore(s => s.setShowCostPanel);
  const [showSupplierPanel, setShowSupplierPanel] = React.useState(false);
  const showArrayPanel = useUIStore(s => s.showArrayPanel);
  const setShowArrayPanel = useUIStore(s => s.setShowArrayPanel);
  const showAIAssistant = useUIStore(s => s.showAIAssistant);
  const activeTab = useUIStore(s => s.activeTab);

  // ── AnalysisStore: analysis data ──
  const printAnalysis = useAnalysisStore(s => s.printAnalysis);
  const setPrintAnalysis = useAnalysisStore(s => s.setPrintAnalysis);
  const dfmResults = useAnalysisStore(s => s.dfmResults);
  const setDfmResults = useAnalysisStore(s => s.setDfmResults);
  const setDfmHighlightedIssue = useAnalysisStore(s => s.setDfmHighlightedIssue);
  const feaResult = useAnalysisStore(s => s.feaResult);
  const setFeaResult = useAnalysisStore(s => s.setFeaResult);
  const feaConditions = useAnalysisStore(s => s.feaConditions);
  const setFeaConditions = useAnalysisStore(s => s.setFeaConditions);
  const feaDisplayMode = useAnalysisStore(s => s.feaDisplayMode);
  const setFeaDisplayMode = useAnalysisStore(s => s.setFeaDisplayMode);
  const feaDeformationScale = useAnalysisStore(s => s.feaDeformationScale);
  const setFeaDeformationScale = useAnalysisStore(s => s.setFeaDeformationScale);
  const gdtAnnotations = useAnalysisStore(s => s.gdtAnnotations);
  const dimensionAnnotations = useAnalysisStore(s => s.dimensionAnnotations);
  const showCenterOfMass = useAnalysisStore(s => s.showCenterOfMass);
  const setShowCenterOfMass = useAnalysisStore(s => s.setShowCenterOfMass);

  // ── SceneStore: dimension advisor needs selectedId, params, materialId ──
  const selectedId = useSceneStore(s => s.selectedId);
  const params = useSceneStore(s => s.params);
  const materialId = useSceneStore(s => s.materialId);
  const setMaterialId = useSceneStore(s => s.setMaterialId);
  const explodeFactor = useSceneStore(s => s.explodeFactor);
  const setExplodeFactor = useSceneStore(s => s.setExplodeFactor);
  const setArrayPattern = useSceneStore(s => s.setArrayPattern);

  return (
    <>
      {/* ══════ RIGHT — 3D Print Analysis Panel ══════ */}
      {showPrintAnalysis && (
        <PrintAnalysisPanel
          analysis={printAnalysis}
          onAnalyze={onPrintAnalyze}
          onClose={() => { setShowPrintAnalysis(false); setPrintAnalysis(null); }}
          isKo={lang === 'ko'}
          optimization={printOptimization}
          onOptimizeOrientation={onOptimizeOrientation}
          onApplyOptimalOrientation={onApplyOptimalOrientation}
          onExportPrintReady={onExportPrintReady}
        />
      )}

      {/* ══════ RIGHT — DFM Analysis Panel ══════ */}
      {showDFM && (
        <DFMPanelDynamic
          results={dfmResults}
          onAnalyze={onDFMAnalyze}
          onClose={() => { setShowDFM(false); setDfmResults(null); setDfmHighlightedIssue(null); }}
          onHighlightIssue={setDfmHighlightedIssue}
          isKo={lang === 'ko'}
          processRecommendations={processRecommendations}
        />
      )}

      {/* ══════ RIGHT — FEA Analysis Panel ══════ */}
      {showFEA && (
        <FEAPanelDynamic
          result={feaResult}
          conditions={feaConditions}
          onConditionsChange={setFeaConditions}
          onRunAnalysis={onFEARunAnalysis}
          onClose={() => { setShowFEA(false); setFeaResult(null); setFeaConditions([]); }}
          displayMode={feaDisplayMode}
          onDisplayModeChange={setFeaDisplayMode}
          deformationScale={feaDeformationScale}
          onDeformationScaleChange={setFeaDeformationScale}
          materialId={materialId}
          isKo={lang === 'ko'}
          totalFaces={feaTotalFaces}
        />
      )}

      {/* ══════ RIGHT — GD&T Annotation Panel ══════ */}
      {showAnnotationPanel && (
        <AnnotationPanel
          gdtAnnotations={gdtAnnotations}
          dimensionAnnotations={dimensionAnnotations}
          onAddGDT={onAddGDT}
          onUpdateGDT={onUpdateGDT}
          onRemoveGDT={onRemoveGDT}
          onAddDimension={onAddDimension}
          onUpdateDimension={onUpdateDimension}
          onRemoveDimension={onRemoveDimension}
          placementMode={annotationPlacementMode}
          onPlacementModeChange={setAnnotationPlacementMode}
          onClose={() => { setShowAnnotationPanel(false); setAnnotationPlacementMode('none'); }}
          isKo={lang === 'ko'}
        />
      )}

      {/* ══════ RIGHT — Mass Properties Panel ══════ */}
      {showMassProps && (
        <MassPropertiesPanelDynamic
          properties={massProperties}
          materialId={materialId}
          onMaterialChange={setMaterialId}
          unitSystem={unitSystem}
          isKo={lang === 'ko'}
          onClose={() => { setShowMassProps(false); setShowCenterOfMass(null); }}
          onShowCenterOfMass={setShowCenterOfMass}
          showingCenterOfMass={!!showCenterOfMass}
        />
      )}

      {/* ══════ RIGHT — Assembly Panel ══════ */}
      {showAssemblyPanel && bomPartsLength > 1 && (
        <AssemblyPanel
          mates={assemblyMates}
          onAddMate={onAddMate}
          onRemoveMate={onRemoveMate}
          onUpdateMate={onUpdateMate}
          onDetectInterference={onDetectInterference}
          interferenceResults={interferenceResults}
          interferenceLoading={interferenceLoading}
          explodeFactor={explodeFactor}
          onExplodeFactorChange={setExplodeFactor}
          partNames={assemblyPartNames}
          isKo={lang === 'ko'}
          onClose={() => setShowAssemblyPanel(false)}
        />
      )}

      {/* ══════ RIGHT — Cost Estimation Panel ══════ */}
      {showCostPanel && geometryMetrics && (
        <CostPanel
          metrics={geometryMetrics}
          materialId={materialId}
          lang={lang}
          onClose={() => setShowCostPanel(false)}
          onRequestQuote={onGetQuote}
          partName={selectedId || undefined}
          onOpenSuppliers={() => setShowSupplierPanel(true)}
          dfmIssues={dfmResults?.flatMap(r => r.issues.map(issue => ({
            severity: issue.severity,
            code: issue.type,
            description: issue.description,
            recommendation: issue.suggestion,
          })))}
        />
      )}

      {/* ══════ RIGHT — Supplier Matching Panel ══════ */}
      {showSupplierPanel && (
        <SupplierPanel
          materialId={materialId}
          lang={lang}
          onClose={() => setShowSupplierPanel(false)}
        />
      )}

      {/* ══════ RIGHT — Array/Pattern Panel ══════ */}
      {showArrayPanel && !isMobile && (
        <ArrayPanelDynamic
          onApply={(pattern) => { onApplyArray(pattern); }}
          onClose={() => { setShowArrayPanel(false); setArrayPattern(null); }}
          isKo={lang === 'ko'}
          t={t}
        />
      )}

      {/* ══════ RIGHT — Unified AI Assistant sidebar ══════ */}
      {showAIAssistant && !isMobile && (
        <AIAssistantSidebar
          lang={lang}
          t={t}
          theme={{ border: theme.border, panelBg: theme.panelBg, text: theme.text }}
          isTablet={isTablet}
          designContext={designContext}
          activeTab={activeTab}
          pendingChatMsg={pendingChatMsg}
          isPreviewMode={isPreviewMode}
          isSketchMode={isSketchMode}
          effectiveResult={effectiveResult}
          selectedId={selectedId}
          onChatApplySingle={onChatApplySingle as any}
          onChatApplyBom={onChatApplyBom as any}
          onBomPreview={onBomPreview as any}
          onChatApplySketch={onChatApplySketch}
          onChatApplyOptimize={onChatApplyOptimize}
          onChatApplyModify={onChatApplyModify}
          onModifyAutoApplied={onModifyAutoApplied}
          chatHistory={chatHistory}
          onChatHistoryChange={onChatHistoryChange}
          onAiPreview={onAiPreview}
          onCancelPreview={onCancelPreview}
          advisorShape={selectedId}
          advisorParams={params}
          advisorMaterial={materialId}
          onApplyDimension={onApplyDimension}
          dfmResults={dfmResults}
          materialId={materialId}
          onTextToCAD={onTextToCAD}
        />
      )}
    </>
  );
}

export default React.memo(RightPanel);
