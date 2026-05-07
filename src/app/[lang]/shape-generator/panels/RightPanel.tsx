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
import type { DesignContext, OptimizeResult, ModifyResult, ChatResult } from '../ShapeChat';
import type { AssemblyMate } from '../assembly/AssemblyMates';
import type { PlacedPart } from '../assembly/PartPlacementPanel';
import type { BomPartResult } from '../ShapePreview';
import type { InterferenceResult } from '../assembly/InterferenceDetection';
import type { MassProperties } from '../analysis/massProperties';
import type { GeometryMetrics } from '../estimation/CostEstimator';
import type { PrintAnalysisOptions, OrientationOptimizationResult } from '../analysis/printAnalysis';
import type { ManufacturingProcess, DFMIssue } from '../analysis/dfmAnalysis';
import type { DFMExplanation, CostDelta } from '../analysis/dfmExplainer';
import type { FEAMaterial } from '../analysis/simpleFEA';
import type { GDTAnnotation, DimensionAnnotation } from '../annotations/GDTTypes';
import type { ArrayPattern } from '../features/instanceArray';
import type { UnitSystem } from '../units';

// ─── Dynamic imports ──────────────────────────────────────────────────────────
const PrintAnalysisPanel = dynamic(() => import('../analysis/PrintAnalysisPanel'), { ssr: false });
const DFMPanelDynamic = dynamic(() => import('../analysis/DFMPanel'), { ssr: false });
const DraftAnalysisPanelDynamic = dynamic(() => import('../analysis/DraftAnalysisPanel'), { ssr: false });
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
  /** 레거시/표시용 — 어셈블리 패널 표시는 `interferenceCheckPartCount >= 2`로 판단. */
  bomPartsLength: number;
  /** 간섭 검사에 쓰는 파트 수(placedParts→bodyBom→bom 우선, ShapeGeneratorInner와 동일) */
  interferenceCheckPartCount: number;
  /** 어셈블리 패널 Solver 탭 — BOM→`solveAssembly` 동기화용(배치 2개 이상일 때). */
  assemblyPlacedParts?: PlacedPart[];
  /** 멀티 바디 메시 BOM — 배치가 2개 미만일 때 솔버 동기화 기하 소스. */
  assemblySolverBomParts?: BomPartResult[];

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
  onApplyDFMFix?: (issueType: string, suggestion: { paramKey: string; value: number; label: { ko: string; en: string } }) => void;
  onJumpToDFMFeature?: (issueType: string) => void;
  /** AI DFM Explainer — fetches LLM explanation (null if freemium-blocked). */
  onExplainDFMIssue?: (issue: DFMIssue) => Promise<DFMExplanation | null>;
  /** Local cost-delta preview for a parameter hint (e.g. thickness +1mm). */
  onPreviewDFMCostDelta?: (hint: { key: string; delta: number }) => CostDelta | null;
  /** Feature-based process recommendations from useProcessRecommendation */
  processRecommendations?: Array<{ process: ManufacturingProcess; confidence: number; reasons: string[]; emoji: string }>;

  // ── Callbacks: Draft Analysis ──
  onDraftAnalyze: (pullDirection: [number, number, number], minDraftDeg: number) => void;

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
  /** 간섭 검사 진행 중 취소(워커 종료 + 메인 스레드 cooperative abort) */
  onCancelInterference?: () => void;
  /** Geometry mate solver → update part placement transforms */
  onApplyMatesToPlacement?: () => void;
  /** `ShapeGeneratorInner`: 메이트 배치 적용 후 AssemblyPanel 솔버 상태 리싱크 */
  assemblySolverResyncNonce?: number;

  // ── Callbacks: Cost / Quote ──
  onGetQuote: () => void;

  // ── Callbacks: Array Panel ──
  onApplyArray: (pattern: ArrayPattern) => void;

  // ── Callbacks: AI Chat (aligned with ShapeChat / AIAssistantSidebar) ──
  onChatApplySingle: Parameters<typeof ShapeChat>[0]['onApplySingle'];
  onChatApplyBom: Parameters<typeof ShapeChat>[0]['onApplyBom'];
  onBomPreview: Parameters<typeof ShapeChat>[0]['onBomPreview'];
  onChatApplySketch: Parameters<typeof ShapeChat>[0]['onApplySketch'];
  onChatApplyOptimize: (opt: OptimizeResult) => void;
  onChatApplyModify: (mod: ModifyResult) => void;
  onModifyAutoApplied?: (actionCount: number) => void;
  onAiPreview: (data: ChatResult) => void;
  onCancelPreview: () => void;

  // ── AIAdvisor (Suggestions tab) ──
  onTextToCAD: (shapeId: string, params: Record<string, number>) => void;

  // ── Chat history persistence ──
  chatHistory?: import('../ShapeChat').ChatMessage[];
  onChatHistoryChange?: (msgs: import('../ShapeChat').ChatMessage[]) => void;

  // ── Layout (optional) ──
  layoutWidth?: number;
  collapsed?: boolean;
  overlay?: boolean;
  side?: 'left' | 'right';
  onToggleCollapse?: () => void;
  onResize?: (nextWidth: number) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

function RightPanel({
  lang, t,
  effectiveResult, geometryMetrics, massProperties, feaTotalFaces, unitSystem,
  assemblyMates, interferenceResults, interferenceLoading, assemblyPartNames, interferenceCheckPartCount, assemblyPlacedParts, assemblySolverBomParts,
  designContext, pendingChatMsg, isPreviewMode, isSketchMode,
  onPrintAnalyze, printOptimization, onOptimizeOrientation, onApplyOptimalOrientation, onExportPrintReady,
  onDFMAnalyze, onApplyDFMFix, onJumpToDFMFeature, onExplainDFMIssue, onPreviewDFMCostDelta, processRecommendations, onDraftAnalyze, onFEARunAnalysis,
  onAddGDT, onUpdateGDT, onRemoveGDT, onAddDimension, onUpdateDimension, onRemoveDimension,
  onApplyDimension,
  onAddMate, onRemoveMate, onUpdateMate, onDetectInterference, onCancelInterference, onApplyMatesToPlacement, assemblySolverResyncNonce,
  onGetQuote,
  onApplyArray,
  onChatApplySingle, onChatApplyBom, onBomPreview, onChatApplySketch,
  onChatApplyOptimize, onChatApplyModify, onModifyAutoApplied, onAiPreview, onCancelPreview,
  onTextToCAD,
  chatHistory, onChatHistoryChange,
  layoutWidth, collapsed, overlay, side, onToggleCollapse, onResize,
}: RightPanelProps) {
  const { theme } = useTheme();
  const { isMobile, isTablet } = useResponsive();

  // ── UIStore: show flags ──
  const showPrintAnalysis = useUIStore(s => s.showPrintAnalysis);
  const setShowPrintAnalysis = useUIStore(s => s.setShowPrintAnalysis);
  const showDFM = useUIStore(s => s.showDFM);
  const setShowDFM = useUIStore(s => s.setShowDFM);
  const showDraftAnalysis = useUIStore(s => s.showDraftAnalysis);
  const setShowDraftAnalysis = useUIStore(s => s.setShowDraftAnalysis);
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
  const draftResult = useAnalysisStore(s => s.draftResult);
  const setDraftResult = useAnalysisStore(s => s.setDraftResult);
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
          onApplyFix={onApplyDFMFix}
          onJumpToFeature={onJumpToDFMFeature}
          onExplainIssue={onExplainDFMIssue}
          onPreviewCostDelta={onPreviewDFMCostDelta}
          onClose={() => { setShowDFM(false); setDfmResults(null); setDfmHighlightedIssue(null); }}
          onHighlightIssue={setDfmHighlightedIssue}
          isKo={lang === 'ko'}
          processRecommendations={processRecommendations}
        />
      )}

      {/* ══════ RIGHT — Draft Analysis Panel ══════ */}
      {showDraftAnalysis && (
        <DraftAnalysisPanelDynamic
          result={draftResult}
          onAnalyze={onDraftAnalyze}
          onClose={() => { setShowDraftAnalysis(false); setDraftResult(null); }}
          isKo={lang === 'ko'}
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
      {showAssemblyPanel && interferenceCheckPartCount >= 2 && (
        <AssemblyPanel
          mates={assemblyMates}
          onAddMate={onAddMate}
          onRemoveMate={onRemoveMate}
          onUpdateMate={onUpdateMate}
          onDetectInterference={onDetectInterference}
          onCancelInterference={onCancelInterference}
          interferenceResults={interferenceResults}
          interferenceLoading={interferenceLoading}
          explodeFactor={explodeFactor}
          onExplodeFactorChange={setExplodeFactor}
          partNames={assemblyPartNames}
          interferenceCheckPartCount={interferenceCheckPartCount}
          isKo={lang === 'ko'}
          onClose={() => setShowAssemblyPanel(false)}
          onApplyMatesToPlacement={onApplyMatesToPlacement}
          placedParts={assemblyPlacedParts}
          solverBomParts={assemblySolverBomParts}
          solverResyncNonce={assemblySolverResyncNonce}
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

      {/* AI Assistant — now rendered in the viewport area, not here */}
    </>
  );
}

export default React.memo(RightPanel);
