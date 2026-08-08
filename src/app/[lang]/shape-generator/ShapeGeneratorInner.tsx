'use client';

// Main workspace shell (split from ShapeGeneratorApp for maintainability).

import React, { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import { isKorean } from '@/lib/i18n/normalize';
import { useUIStore } from './store/uiStore';
import { useSelectionStore } from './store/selectionStore';
import { useCanvasSelectionHandlers } from './hooks/useCanvasSelectionHandlers';
import { useCanvasFileImport } from './hooks/useCanvasFileImport';
import { useRadialCommand } from './hooks/useRadialCommand';
import { useNurbsCpEdit } from './hooks/useNurbsCpEdit';
import { useCanvasPinCommentHandlers } from './hooks/useCanvasPinCommentHandlers';
import { useSceneStore } from './store/sceneStore';
// Responsive layout imports
import { useResponsive } from './responsive/useResponsive';
import { useTouchGestures } from './responsive/useTouchGestures';
import { useRouter, usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import {
  BufferGeometry,
  Float32BufferAttribute,
  EdgesGeometry,
  Vector3,
  Euler,
  Plane,
  Scene,
  Quaternion,
  MathUtils,
  Matrix4,
} from 'three';
import { analytics } from '@/lib/analytics';
import { getSuppressCadPerfToasts } from '@/lib/cadPerfHints';
import { getAssemblyLoadGuidance } from '@/lib/assemblyLoadPolicy';
import { mateGraphSummary, preflightAssemblyMates } from '@/lib/assemblyMatePreflight';
import { preflightSketchConstraints } from '@/lib/sketchConstraintPreflight';
import { NF_R3F_VIEWPORT_DATA_ENGINE } from '@/lib/nexyfab/viewport';
// Shape design imports
import { SHAPES, SHAPE_MAP, applySceneParamsToSetters, type ShapeConfig, type ShapeResult, makeEdges, meshVolume, meshSurfaceArea, buildShapeResult, normalizeShapeParams } from './shapes';
import { shapeDict } from './shapeDict';
import { applyFeaturePipeline, classifyFeatureError, getFeatureDefinition } from './features';
import { reportError, reportInfo, reportWarning } from './lib/telemetry';
import DesktopTitleBar from './DesktopTitleBar';
import PdmMetaWorkspaceStrip from './PdmMetaWorkspaceStrip';
import { useCloudProjectAccessStore } from './store/cloudProjectAccessStore';
import { usePdmProjectMetaStore } from './store/pdmProjectMetaStore';
import { getDrawingTitlePartName } from '@/lib/nfabPartDisplay';
import { patchFetchForTauri, hasDesktopPower, isTauriApp } from '@/lib/tauri';
import {
  upsertRecentImportFile,
  isDesktopFirstRunComplete,
  resetDesktopFirstRun,
} from '@/lib/platform';
import { useNfabFileIO } from './hooks/useNfabFileIO';
import { useDesignPreviewWidth } from './hooks/useDesignPreviewWidth';
import { useContextMenu } from './hooks/useContextMenu';
import { useSketchRadialMenu } from './hooks/useSketchRadialMenu';
import { useViewportOverlays } from './hooks/useViewportOverlays';
import { useAssemblyPartDisplay } from './hooks/useAssemblyPartDisplay';
import { useSketchPaletteToggles } from './hooks/useSketchPaletteToggles';
import { useSketchInteractionMode } from './hooks/useSketchInteractionMode';
import { parseProject, NfabParseError, type NfabAssemblySnapshotV1, type NfabConfigurationV1, type NfabGlobalVariableV1, type NfabStudioViewV1 } from './io/nfabFormat';
import { ConfigurationTable as ConfigurationTableRuntime } from './configurations/ConfigurationTable';
import { migrateFromV1 as migrateConfigsFromV1 } from './configurations/migrateFromV1';
import { ConfigStore, migrateToYjs as migrateConfigStoreToYjs, type ConfigStore as ConfigStoreType } from './configurations/ConfigStore';
import { setConfigurationTable as setPipelineConfigurationTable, setEquationManager as setPipelineEquationManager } from './features/featureContext';
import { EquationManager } from './equations/equationManager';
import {
  parseParamInput,
  evaluateParamExpression,
  paramScopeFor,
  reevaluateFeatureParamExpressionsFixedPoint,
} from './equations/featureParamExpressions';
import type * as Y from 'yjs';
import { useSceneAutoSaveWatchers } from './hooks/useSceneAutoSaveWatchers';
import { applyBooleanAsync } from './features/boolean';
import { useCsgWorker } from './workers/useCsgWorker';
import { useFEAWorker } from './workers/useFEAWorker';
import { useDFMWorker } from './workers/useDFMWorker';
import { usePipelineWorker } from './workers/usePipelineWorker';
import { useInterferenceWorker } from './workers/useInterferenceWorker';
import { useFeatureStack, type FeatureHistory } from './useFeatureStack';
import { useShapeCart } from './useShapeCart';
import { exportBomCSV, exportBomExcel, estimateWeight, type BomRow } from './io/bomExport';
import { canExportStepViaBridge } from './io/stepExporter';
import { useToast } from './useToast';
import ToastContainer from './ToastContainer';
import SidebarResizer from './SidebarResizer';
import type { OptimizeResult, ModifyResult, ChatMessage, ChatResult, SingleResult } from './ShapeChat';
import { computeMassProperties, combineAssemblyMassProperties } from './analysis/massProperties';
import type { ElementSelectionInfo, FaceSelectionInfo } from './editing/selectionInfo';
import type { FeatureType } from './features/types';
const HoleWizardModal = dynamic(() => import('./features/HoleWizardModal'), { ssr: false });
const FeatureParams = dynamic(() => import('./FeatureParams'), { ssr: false });
const CommandToolbar = dynamic(() => import('./CommandToolbar'), { ssr: false });
const ShapeCart = dynamic(() => import('./ShapeCart'), { ssr: false });
const DesignFunnelBar = dynamic(() => import('./DesignFunnelBar'), { ssr: false });
const TimelineBar = dynamic(() => import('./TimelineBar'), { ssr: false });
const ShapeGeneratorToolbar = dynamic(() => import('./ShapeGeneratorToolbar'), { ssr: false });
import type { BomPartResult } from './ShapePreview';
// Sketch imports
import type { SketchProfile, SketchConfig, SketchConstraint, SketchDimension, SketchSegment } from './sketch/types';
import { profileToGeometry, profileToGeometryMulti, brepContourPoints } from './sketch/extrudeProfile';
import { occtExtrudeWithHoles, isOcctReady as isOcctReadySync, isOcctGlobalMode as isOcctGlobalModeSync } from './features/occtEngine';
import { solveConstraints, resolveDimensionTargetsWithErrors } from './sketch/constraintSolver';
import { computeSketchLiveStatus } from './sketch/sketchStatusLive';
import SketchCanvas from './sketch/SketchCanvas';
import {
  type SketchHistoryEntry,
  generateSketchThumbnail,
  saveSketchHistory } from './sketch/SketchHistory';
const Sketch3DCanvas = dynamic(() => import('./sketch/Sketch3DCanvas'), { ssr: false });
const DrawingView = dynamic(() => import('./sketch/DrawingView'), { ssr: false });
const MobileModelViewer = dynamic(() => import('./responsive/MobileModelViewer'), { ssr: false });
import { hasViewableGeometry, mobileViewerLabels } from './responsive/mobileViewer';
// Editing imports
import type { EditMode } from './editing/types';
// Custom hooks
import { useViewportState } from './hooks/useViewportState';
import { useOptimizationState, RESOLUTION_MAP } from './hooks/useOptimizationState';
import { useImportExport } from './hooks/useImportExport';
import { useManufacturingFlow } from './hooks/useManufacturingFlow';
import { useFreemiumGate } from './hooks/useFreemiumGate';
import { useAnalysisState } from './hooks/useAnalysisState';
import { useSketchState } from './hooks/useSketchState';
import { useFreemium } from '@/hooks/useFreemium';
import UpgradeModalsDock from './panels/UpgradeModalsDock';
import FirstTimeOnboardingShell from './onboarding/FirstTimeOnboardingShell';
import type { SampleTemplate } from './templates/sampleTemplates';
import AiAssistantShell from './ai/AiAssistantShell';
import { resolveFeatureEditPrompt } from './ai/featureEditFromPrompt';
import { modelContentRevision, selectionContextFromElement } from '@/lib/ai/selectionContext';
import { useIPShareFlow } from './hooks/useIPShareFlow';
import { useShapeGeneratorUI } from './hooks/useShapeGeneratorUI';
const QuoteWizard = dynamic(() => import('./onboarding/QuoteWizard'), { ssr: false });
const DesktopFirstRunWizard = dynamic(() => import('./onboarding/DesktopFirstRunWizard'), { ssr: false });
import { useAssemblyState, BODY_COLORS } from './hooks/useAssemblyState';
import { applyCSG, makeToolGeometry } from './editing/CSGOperations';
import type { CSGOperation, CSGToolParams } from './editing/CSGOperations';
import { splitBodyBoth } from './features/splitBodyBoth';
import { mergeBodyGeometries } from './features/mergeBodies';
// Topology optimization imports
import { genDesignDict } from './topology/genDesignDict';
import type { Face } from './topology/optimizer/types';
import { MATERIALS } from './topology/optimizer/types';
import { useTopologicalMap } from './topology/useTopologicalMap';
import { decodeShareLink } from './io/shareLink';
import { useSearchParams } from 'next/navigation';
import { getContextItemsEmpty, getContextItemsGeometry, getContextItemsSketch } from './ContextMenu';
import SketchPalette from './sketch/SketchPalette';
import { useSketchReferenceUnderlay } from './hooks/useSketchReferenceUnderlay';
// New module imports
import type { PrintAnalysisOptions, OrientationOptimizationResult } from './analysis/printAnalysis';
import type { ManufacturingProcess, DFMIssue } from './analysis/dfmAnalysis';
import { explainDFMIssue, calculateCostDelta, approximateMetricsAfterHint, type DFMExplanation, type CostDelta } from './analysis/dfmExplainer';
import { analyzeDraft } from './analysis/draftAnalysis';
import { useProcessRecommendation } from './analysis/useProcessRecommendation';
import type { FEAMaterial } from './analysis/simpleFEA';
import ManufacturingReadyCard from './analysis/ManufacturingReadyCard';
// Auto-save imports
import { useAutoSave } from './useAutoSave';
import type { AutoSaveState } from './useAutoSave';
const CommandPalette = dynamic(() => import('./CommandPalette'), { ssr: false });
import type { Command } from './CommandPalette';
import { buildPanelCommands } from './commandPaletteCommands';
import { buildWorkspaceCommands } from './commandWorkspaceCommands';
import WorkspaceEmptyHint from './WorkspaceEmptyHint';
import { MATERIAL_PRESETS } from './materials';
import { useTheme } from './ThemeContext';
import { useShellBridge } from './_shell/shellBridgeStore';
import { evaluateExpression, findBrokenExpressions, freezeBrokenExpressions, type ExprVariable } from './ExpressionEngine';
import { globalMacroRecorder } from './history/macroRecorder';
import { analyzeChangeImpact } from './analysis/changeImpact';
import ConfirmModal from '@/components/ConfirmModal';
import { resolveModelVars, type ModelVar } from './ModelParametersPanel';
import { buildExprGraph, propagateChanges } from './ExpressionGraph';
import { usePlugins } from './plugins/usePlugins';
import TransformInputPanel from './TransformInputPanel';
import { useCollab } from './collab/useCollab';
import type { CollabChatMessage } from './collab/useCollab';
import { useCollabFeatureTree } from './collab/useCollabFeatureTree';
import AwarenessPresencePanel from './collab/AwarenessPresencePanel';

/**
 * CRDT bridge feature flag. Defaults OFF — when off, real-time collaboration
 * uses the legacy SSE feature_sync path exactly as before. When set to '1',
 * the Yjs CollabDoc takes over feature tree sync, which gives proper CRDT
 * merge instead of last-write-wins. Per-deploy flag, not per-user, so we can
 * roll out per environment.
 */
const CRDT_ENABLED = process.env.NEXT_PUBLIC_NEXYFAB_CRDT === '1';
import CollabPresence from './collab/CollabPresence';
import CollabReconnectBanner from './collab/CollabReconnectBanner';
const CollabChat = dynamic(() => import('./collab/CollabChat'), { ssr: false });
const DesignVariantsPanel = dynamic(() => import('./panels/DesignVariantsPanel'), { ssr: false });
import { generateLinearSweep } from './panels/DesignVariantsPanel';
const CopilotPanel = dynamic(() => import('./copilot/CopilotPanel'), { ssr: false });
// Wave A · WA-D3 — AI design-brief entry + AiReviewQueuePanel (self-contained).
const DesignBriefPanel = dynamic(() => import('./design-brief/DesignBriefPanel'), { ssr: false });
// Wave A · WA-E / §GA3 — autonomy dashboard bound to autonomySessionStore.
const AutonomyDashboardConnected = dynamic(() => import('./_shell/AutonomyDashboardConnected'), { ssr: false });

import PipelineProgressOverlay from './PipelineProgressOverlay';
import HeaderOverlays from './panels/HeaderOverlays';
import AsyncWorkIndicator from './panels/AsyncWorkIndicator';
import TopBanners from './panels/TopBanners';
import OnboardingDock from './panels/OnboardingDock';
import Phase4PanelDock from './panels/Phase4PanelDock';
import { DirectEditHostBridge, type DirectEditSceneAdapter } from './directEdit/DirectEditHostBridge';
import { AssemblyExportBridge } from './io/AssemblyExportBridge';
import { ConfigurationsExportBridge } from './configurations/ConfigurationsExportBridge';
import { applyFeatureEnabledMap } from './configurations/featureSuppression';
import { generateDrawingsForConfigs } from './configurations/perConfigDrawing';
import { runPipeline } from './features/pipelineManager';
import { FEATURE_MAP } from './features';
import type { DrawingConfig } from './analysis/autoDrawing';
import { generateAssemblyDrawing, type AssemblyDrawingPart } from './analysis/assemblyDrawing';
import { buildDrawingSvgString } from './analysis/drawingExport';
import { useDrawingTemplatePrefs } from './analysis/drawingTemplatePrefs';
import HelpCluster from './panels/HelpCluster';
import ValidationResultsModal from './panels/ValidationResultsModal';
import Modal4Dock from './panels/Modal4Dock';
import IPShareConfirmModal from './panels/IPShareConfirmModal';
import MobileSendToDesktop from './panels/MobileSendToDesktop';
import StandardPartsLibrary from './panels/StandardPartsLibrary';
import ThreadHoleCalloutDock from './panels/ThreadHoleCalloutDock';
import SketchInputCluster from './panels/SketchInputCluster';
import BodyCsgDock from './panels/BodyCsgDock';
import ComposeIndicator from './panels/ComposeIndicator';
import CanvasGizmoOverlays from './panels/CanvasGizmoOverlays';
import { collectDowngrades } from './features/downgradeNotice';
import RefRelinkPanel from './panels/RefRelinkPanel';
import { useRefRelinkWiring } from './panels/useRefRelinkWiring';
import { runBrepExport, type BrepExportFormat } from './io/brepExportActions';
import StatusFooter from './panels/StatusFooter';
import AuthModelPlacementDock from './panels/AuthModelPlacementDock';
import SplitExportDock from './panels/SplitExportDock';
import FloatingAnalysisDock from './panels/FloatingAnalysisDock';
import { buildCol1RightInset, SCAD_AGENT_DOCK_INSET_PX } from './rightFloatStack';
import ManufacturingPanelDock from './panels/ManufacturingPanelDock';
import AdvancedAnalysisDock from './panels/AdvancedAnalysisDock';
import VersionDiffDock from './panels/VersionDiffDock';
import ScadAgentPanel from './panels/ScadAgentPanel';
import MobileAgentNotice from './panels/MobileAgentNotice';
import ScadModeToggle from './panels/ScadModeToggle';
const ConfigurationTable = dynamic(() => import('./panels/ConfigurationTable'), { ssr: false });
const ConfigurationTableV2 = dynamic(() => import('./configurations/ui/ConfigurationTableV2'), { ssr: false });
const DrcPanel = dynamic(() => import('./analysis/DrcPanel'), { ssr: false });
const PlmConfigPanel = dynamic(() => import('./integrations/PlmConfigPanel'), { ssr: false });
const SketchTextPanel = dynamic(() => import('./sketch/SketchTextPanel'), { ssr: false });
const SmartFastenerPanel = dynamic(() => import('./assembly/SmartFastenerPanel'), { ssr: false });
import type { AssemblyMate, MateType } from './assembly/AssemblyMates';
import { generateMateId } from './assembly/AssemblyMates';
import { useVersionHistory } from './history/useVersionHistory';
import type { DesignVersion } from './history/useVersionHistory';
import { useCommandHistory } from './history/useCommandHistory';
import { commandHistory } from './history/CommandHistory';
import {
  createFeatureParamCoalescer,
  makeArrayAddCommand,
  makeArrayRemoveCommand,
  makeArrayUpdateCommand,
  makeToggleCommand,
  makeInsertStandardPartCommand,
  makePlacePartWithMatesCommand,
  makeRemoveFeatureCommand,
  snapshotFeatureTree,
} from './history/undoableCommands';
import { captureCanvasSnapshot } from './history/useCanvasSnapshot';
import RightPanel from './panels/RightPanel';
import { mapDFMToParams, getBestDFMScore, getTopDFMIssues } from './analysis/dfmParamMapper';
import { useProactiveAdvisor } from './useProactiveAdvisor';
import { useCloudSaveFlow } from './useCloudSaveFlow';
import { DEFAULT_RENDER_SETTINGS, type RenderSettings } from './rendering/RenderPanel';
import { downloadScreenshot } from './rendering/useScreenshot';
import { useTutorial } from './onboarding/useTutorial';
const SketchContextTip = dynamic(() => import('./onboarding/SketchContextTip'), {
  ssr: false,
  loading: () => null });
import { useContextHelp } from './onboarding/useContextHelp';
import type { GeometryMetrics } from './estimation/CostEstimator';
import { estimateCosts } from './estimation/CostEstimator';
const ProcessRouterPanel = dynamic(() => import('./estimation/ProcessRouterPanel'), { ssr: false });
const AISupplierPanel = dynamic(() => import('./analysis/AISupplierPanel'), { ssr: false });
const CostCopilotPanel = dynamic(() => import('./analysis/CostCopilotPanel'), { ssr: false });
const AIHistoryPanel = dynamic(() => import('./analysis/AIHistoryPanel'), { ssr: false });
const OpenScadPanel = dynamic(() => import('./openscad/OpenScadPanel'), { ssr: false });
// GD&T Annotation imports
import type { GDTAnnotation, DimensionAnnotation } from './annotations/GDTTypes';
const ShapePreview = dynamic(() => import('./ShapePreview'), { ssr: false });
const MultiViewport = dynamic(() => import('./MultiViewport'), { ssr: false });
import LeftPanel from './panels/LeftPanel';
import { useSidebarLayout } from './hooks/useSidebarLayout';
const GenDesignViewer = dynamic(() => import('./topology/GenDesignViewer'), { ssr: false });
import { useAuthStore } from '@/hooks/useAuth';
import { userMeetsBmMatrixFeatureStage } from '@/lib/bm-matrix-stage-ui';
import type { Stage } from '@/lib/stage-engine';
import { useProjectsStore } from '@/hooks/useProjects';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { getPlanLimits } from './freemium/planLimits';
import { dfmAnalysisAllowed, consumeFreeDfmCreditIfUnpaid } from './freemium/freeDfmAllowance';
import { useDfmWarnings } from './hooks/useDfmWarnings';
const UpgradePrompt = dynamic(() => import('./freemium/UpgradePrompt'), { ssr: false });
const COTSPanel = dynamic(() => import('./cots/COTSPanel'), { ssr: false });
const CAMSimPanel = dynamic(() => import('./analysis/CAMSimPanel'), { ssr: false });
import type { COTSPart } from './cots/cotsData';
import { cotsToScad } from './cots/cotsGeometry';
import { usePinComments } from './comments/PinComments';
const CommentsPanel = dynamic(() => import('./comments/CommentsPanel'), { ssr: false });
import type { ActivityEvent } from './comments/CommentsPanel';
import WorkflowStepper from './WorkflowStepper';
const ManufacturerMatch = dynamic(() => import('./analysis/ManufacturerMatch'), {
  ssr: false,
  loading: () => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--nx-bg)', color: 'var(--nx-text-3)', fontSize: 13 }}>
      Loading Manufacturer Match...
    </div>
  ) });
import type { Manufacturer } from './analysis/ManufacturerMatch';
import { useCollabPolling } from '@/hooks/useCollabPolling';
import { useSessionKeepalive } from '@/hooks/useSessionKeepalive';
const StatusBar = dynamic(() => import('./StatusBar'), { ssr: false });
const BreadcrumbNav = dynamic(() => import('./BreadcrumbNav'), { ssr: false });
import type { BreadcrumbItem } from './BreadcrumbNav';
import SelectionFilterBar from './SelectionFilterBar';
import type { SelectionFilter } from './SelectionFilterBar';
import SelectionInfoBadge from './editing/SelectionInfoBadge';
import MatePickerOverlay from './editing/MatePickerOverlay';
import AIAssistantSidebar from './analysis/AIAssistantSidebar';
const IntakeWizard = dynamic(() => import('./intake/IntakeWizard'), { ssr: false });
const ComposeResultPanel = dynamic(() => import('./intake/ComposeResultPanel'), { ssr: false });
import type { ComposeResponse } from './intake/ComposeResultPanel';
import type { IntakeSpec } from './intake/intakeSpec';
import { mapToPresetId } from './library/materialMapping';
const PropertyManager = dynamic(() => import('./PropertyManager'), { ssr: false });
const EmptyCanvasGuide = dynamic(() => import('./EmptyCanvasGuide'), { ssr: false });
import FullscreenAutoHide from './FullscreenAutoHide';
import { ErrorBoundary } from '@/components/nexyfab/ErrorBoundary';
import { getToolCursor } from './hooks/useToolCursor';
// Advanced analysis panels (still inline-mounted: ParametricSweep, AutoDrawing)
const ParametricSweepPanel = dynamic(() => import('./analysis/ParametricSweepPanel'), { ssr: false });
const AutoDrawingPanel = dynamic(() => import('./analysis/AutoDrawingPanel'), { ssr: false });
const ScadCodePanel = dynamic(() => import('./openscad/ScadCodePanel'), { ssr: false });
const PushPullBanner = dynamic(() => import('./pushpull/PushPullBanner'), { ssr: false });
const GdtPicker = dynamic(() => import('./drawing/GdtPicker'), { ssr: false });
import type { PlacedPart } from './assembly/PartPlacementPanel';
import { placedPartsToBomResults } from './assembly/PartPlacementPanel';
import { inferAssemblyMates } from './assembly/inferAssemblyMates';
import { splitGeometryByConnectedComponent, connectedComponentCount } from './io/splitByComponent';
import { importedGeometriesToPlaced } from './assembly/importedParts';
import { fitPrimitive, fittedPartsFromGeometries } from './assembly/fitPrimitive';
import { bomPartWorldMatrixFromBom } from './assembly/bomPartWorldMatrix';
import { applyGeometryMatesToPlaced } from './assembly/applyGeometryMatesToPlaced';
import { useLang } from './hooks/useLang';
import { SHAPE_ICONS, TAB_LABELS, LOCAL_LABELS } from './constants/labels';
import CadWorkspaceSwitcher from './CadWorkspaceSwitcher';
import { applyCadWorkspace, isCadWorkspaceId } from './cadWorkspace/applyCadWorkspace';
import { useCadWorkspaceInference } from './hooks/useCadWorkspaceInference';
import { useGeometryGC } from './hooks/useGeometryGC';

// ─── Design tab: resizable 3D preview column (right) ───────────────────────────

/** First segment after `shape-generator` for bookmarkable sub-routes. */
function shapeGeneratorRouteSegment(pathname: string | null): 'sketch' | 'analysis' | '3d-edit' | null {
  if (!pathname) return null;
  const parts = pathname.split('/').filter(Boolean);
  const i = parts.indexOf('shape-generator');
  if (i === -1) return null;
  const next = parts[i + 1];
  if (next === 'sketch' || next === 'analysis' || next === '3d-edit') return next;
  return null;
}

/**
 * Serialize a BufferGeometry to a binary-STL base64 string so an imported mesh
 * can be AI-edited: we wrap it as `import("model.stl")` in OpenSCAD and let the
 * model add operations around it (mirrors the Studio flow). Handles indexed and
 * non-indexed geometry; normals are left zero (viewers/OpenSCAD recompute).
 */
function geometryToStlBase64(geo: BufferGeometry): string | null {
  const posAttr = geo.attributes.position;
  if (!posAttr) return null;
  const pos = posAttr.array as ArrayLike<number>;
  const idx = geo.index ? (geo.index.array as ArrayLike<number>) : null;
  const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9);
  if (triCount <= 0) return null;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, triCount, true);
  let off = 84;
  for (let t = 0; t < triCount; t++) {
    const ia = idx ? idx[t * 3] : t * 3;
    const ib = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const ic = idx ? idx[t * 3 + 2] : t * 3 + 2;
    off += 12; // normal left as (0,0,0)
    for (const vi of [ia, ib, ic]) {
      const b = vi * 3;
      dv.setFloat32(off, pos[b], true);
      dv.setFloat32(off + 4, pos[b + 1], true);
      dv.setFloat32(off + 8, pos[b + 2], true);
      off += 12;
    }
    off += 2; // attribute byte count
  }
  // Chunked base64 — avoids stack overflow from spreading a large Uint8Array.
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return typeof btoa === 'function' ? btoa(bin) : null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ShapeGeneratorInner() {
  const { theme, mode, toggleTheme } = useTheme();
  const lang = useLang();
  const t = shapeDict[lang];
  /** Bracket i18n keys (shapeName_*, param_*) — same object as `t`, widened for dynamic access. */
  const shapeLabels = t as unknown as Record<string, string>;
  const gt = genDesignDict[lang] as unknown as Record<string, string>;
  const lt = LOCAL_LABELS[lang] ?? LOCAL_LABELS.en;
  const langRef = useRef(lang);
  langRef.current = lang;
  const router = useRouter();
  // SCAD this part arrived with from Studio — lets the round-trip back to Studio
  // resume parametrically instead of degrading to a mesh.
  const studioScadRef = useRef<string | null>(null);
  const pathname = usePathname();
  const langSeg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const tabLabels = TAB_LABELS[lang] || TAB_LABELS.en;
  const searchParams = useSearchParams();
  const viewportBenchmarkParam = searchParams?.get('viewportBenchmark');
  const viewportBenchmarkTier = (
    searchParams?.get('expert') === '1' &&
    (viewportBenchmarkParam === 'S' || viewportBenchmarkParam === 'M' ||
      viewportBenchmarkParam === 'L' || viewportBenchmarkParam === 'XL')
  ) ? viewportBenchmarkParam : undefined;

  useGeometryGC();

  // ── View-only / readonly mode (opened via ?readonly=1 share link) ──
  const isReadOnly = searchParams?.get('readonly') === '1';

  // ══════════════════════════════════════════════════════════════════════════
  // LOCAL UI STATE (extracted hook — panels, fullscreen, drag, auth modal, callouts)
  // ══════════════════════════════════════════════════════════════════════════
  const {
    showQuoteWizard, setShowQuoteWizard,
    showCSGPanel, setShowCSGPanel,
    showARViewer, setShowARViewer,
    showFeatureGraph, setShowFeatureGraph,
    showNestingTool, setShowNestingTool,
    showThreadHolePanel, setShowThreadHolePanel,
    showPropertyManager, setShowPropertyManager,
    showModelParams, setShowModelParams,
    showBomExportMenu, setShowBomExportMenu,
    showCommentsPanel, setShowCommentsPanel,
    showChatPanel, setShowChatPanel,
    showCopilot, setShowCopilot,
    showRfqPanel, setShowRfqPanel,
    showCAMSimPanel, setShowCAMSimPanel,
    showMoldDesignPanel, setShowMoldDesignPanel,
    threadCallouts, setThreadCallouts,
    holeCallouts, setHoleCallouts,
    showVariantsPanel, setShowVariantsPanel,
    designVariants, setDesignVariants,
    activeVariantId, setActiveVariantId,
    showUserPartsPanel, setShowUserPartsPanel,
    showSessionTimelapse, setShowSessionTimelapse,
    showStockOptimizer, setShowStockOptimizer,
    rfqDone, setRfqDone,
    selectedStandardPart, setSelectedStandardPart,
    standardPartParams, setStandardPartParams,
    showAuthModal, setShowAuthModal,
    authModalMode, setAuthModalMode,
    show3DPreview, setShow3DPreview,
    isFullscreen,
    showFullscreenPrompt,
    toggleFullscreen,
    dismissFullscreenPrompt,
    isDragOver, setIsDragOver,
    isImporting, setIsImporting,
    isDragging, setIsDragging,
    dragCounterRef } = useShapeGeneratorUI();

  const { designPreviewWidth, handleDesignPreviewResize } = useDesignPreviewWidth();

  // ══════════════════════════════════════════════════════════════════════════
  // RESPONSIVE STATE
  // ══════════════════════════════════════════════════════════════════════════
  const { isMobile, isTablet } = useResponsive();
  const sidebarLayout = useSidebarLayout();
  const tabletLeftOpen = useUIStore(s => s.tabletLeftOpen);
  const setTabletLeftOpen = useUIStore(s => s.setTabletLeftOpen);
  const simpleMode = useUIStore(s => s.simpleMode);
  const enableSimpleMode = useUIStore(s => s.enableSimpleMode);
  const applyUserPreset = useUIStore(s => s.applyUserPreset);
  const disableSimpleMode = useUIStore(s => s.disableSimpleMode);
  // (showQuoteWizard / showCSGPanel / rfqDone moved to useShapeGeneratorUI at top of component)

  // ── Multi-body state (useAssemblyState 훅으로 통합) ──────────────────────
  const {
    bodies, setBodies,
    activeBodyId, setActiveBodyId,
    selectedBodyIds, setSelectedBodyIds,
    showBodyPanel, setShowBodyPanel,
    placedParts, setPlacedParts,
    showPartPlacement, setShowPartPlacement,
    assemblyMates, setAssemblyMates,
    interferenceResults, setInterferenceResults,
    interferenceLoading, setInterferenceLoading,
    onlineCount } = useAssemblyState();
  /** 메이트→배치 적용 후 Solver 탭 `solveAssembly` 상태를 `placedParts`와 다시 맞출 때 증가 (M3 B1). */
  const [assemblySolverResyncNonce, setAssemblySolverResyncNonce] = useState(0);
  // BODY_COLORS imported from useAssemblyState — the old local copy started
  // with 'var(--nx-accent-2)', which THREE.Color can't parse (broken
  // <Instance color>). The hook's palette is THREE-safe ('#8bb7f4' first).
  // ══════════════════════════════════════════════════════════════════════════
  // VIEW MODE: gallery vs workspace
  // ══════════════════════════════════════════════════════════════════════════
  const viewMode = useUIStore(s => s.viewMode);
  const setViewMode = useUIStore(s => s.setViewMode);
  const [pendingChatMsg, setPendingChatMsg] = useState<string | null>(null);

  // ── Tab state ──
  const activeTab = useUIStore(s => s.activeTab);
  const setActiveTab = useUIStore(s => s.setActiveTab);
  const cadWorkspace = useUIStore(s => s.cadWorkspace);

  // ══════════════════════════════════════════════════════════════════════════
  // SHAPE DESIGN STATE
  // ══════════════════════════════════════════════════════════════════════════

  const selectedId = useSceneStore(s => s.selectedId);
  const setSelectedId = useSceneStore(s => s.setSelectedId);
  const params = useSceneStore(s => s.params);
  const setParams = useSceneStore(s => s.setParams);
  // Debounced params for heavy geometry recalculation (avoids thrashing during slider drag)
  const [debouncedParams, setDebouncedParams] = useState(params);
  // Tauri: /api → https://nexyfab.com/api 자동 라우팅 (once on mount)
  useEffect(() => {
    if (hasDesktopPower('backendProxy')) patchFetchForTauri();
  }, []);

  const [showDesktopFirstRun, setShowDesktopFirstRun] = useState(false);
  // Controls the STL export options dialog (unit/origin chooser).
  const [stlExportDialogOpen, setStlExportDialogOpen] = useState(false);
  useEffect(() => {
    if (!isTauriApp()) return;
    if (!isDesktopFirstRunComplete()) setShowDesktopFirstRun(true);
  }, []);
  const handleReplayDesktopWelcome = useCallback(() => {
    resetDesktopFirstRun();
    setShowDesktopFirstRun(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedParams(params), 120);
    return () => clearTimeout(t);
  }, [params]);
  const setParam = useSceneStore(s => s.setParam);
  const paramExpressions = useSceneStore(s => s.paramExpressions);
  const setParamExpressions = useSceneStore(s => s.setParamExpressions);
  const setParamExpression = useSceneStore(s => s.setParamExpression);
  // ─ Expression Dependency Graph: propagate param changes through expression DAG ─
  const exprGraphRef = React.useRef(buildExprGraph({}, []));
  useEffect(() => {
    // Rebuild graph whenever expressions change
    const knownKeys = Object.keys(params);
    exprGraphRef.current = buildExprGraph(paramExpressions, knownKeys);
    // Propagate all values with base params as roots
    const { resolved, changed, errors: _errors } = propagateChanges(
      exprGraphRef.current,
      Object.keys(paramExpressions),
      params,
      params,
    );
    if (changed.length > 0) {
      // Apply resolved values back to params for downstream features
      const newParams = { ...params };
      let didChange = false;
      for (const key of changed) {
        if (key in newParams && Math.abs((newParams[key] ?? 0) - (resolved[key] ?? 0)) > 1e-9) {
          newParams[key] = resolved[key];
          didChange = true;
        }
      }
      if (didChange) setParams(newParams);
    }
  }, [paramExpressions]);
  const { features, addFeature, addFeatureWithEdges, addFeatureWithParams, addFeatureWithParamsAndEdges, addSketchFeature, removeFeature, updateFeatureParam, toggleFeature, moveFeature, undoLast, clearAll, history: featureHistory, rollbackTo, startEditing, finishEditing, toggleExpanded, ensureExpanded, addNode, removeNode, updateNode, featureErrors, setFeatureError: _setFeatureError, clearFeatureError, getOrderedNodes, replaceHistory } = useFeatureStack();

  // ── Phase A undo unification: tracked feature-param / suppress wrappers ────
  // updateFeatureParamCmd routes param edits through commandHistory with
  // commit-on-settle coalescing (one undo step per drag / typing burst, same
  // contract as the base-shape handleParamChange/handleParamCommit pair).
  // getOrderedNodes recreates whenever the node map changes, so the coalescer
  // reads it through a render-synced ref — the 500ms settle callback must see
  // the params AFTER the last setNodeMap commit, not the closure it was
  // created under.
  const getOrderedNodesRef = useRef(getOrderedNodes);
  getOrderedNodesRef.current = getOrderedNodes;
  const featureParamCoalescer = useMemo(() => createFeatureParamCoalescer({
    getParams: (featureId) =>
      getOrderedNodesRef.current().find(n => n.id === featureId)?.params ?? null,
    applyParam: (featureId, key, value) => updateFeatureParam(featureId, key, value),
    // Whole-params restore via updateNode also reverses the NURBS cp_* wipe
    // that updateFeatureParam performs on uCount/vCount edits.
    restoreParams: (featureId, params) =>
      updateNode(featureId, { params: { ...params }, error: undefined }),
    push: (cmd) => commandHistory.execute(cmd),
  }), [updateFeatureParam, updateNode]);
  const updateFeatureParamCmd = useCallback((id: string, key: string, value: number) => {
    featureParamCoalescer.edit(id, key, value);
  }, [featureParamCoalescer]);
  const toggleFeatureCmd = useCallback((id: string) => {
    commandHistory.execute(makeToggleCommand({
      commandId: `toggle-feature-${id}-${Date.now()}`,
      label: 'Suppress/unsuppress feature',
      labelKo: '피처 표시/숨김 전환',
      toggle: () => toggleFeature(id),
    }));
  }, [toggleFeature]);

  const { performCSG, loading: csgLoading, cancel: cancelCsg } = useCsgWorker();
  const { runFEA: runFEAWorker, loading: feaWorkerLoading, cancel: cancelFea } = useFEAWorker();
  const { analyzeDFM: analyzeDFMWorker, loading: dfmWorkerLoading, cancel: cancelDfm } = useDFMWorker();
  const { runPipeline: runPipelineWorker, loading: pipelineWorkerLoading, progress: pipelineProgress, progressLabel: pipelineProgressLabel, cancel: cancelPipeline, projectViews: projectViewsWorker } = usePipelineWorker();
  const {
    detect: detectInterferenceWorker,
    cancel: cancelInterferenceWorker,
    loading: interferenceWorkerHookLoading,
  } = useInterferenceWorker();
  // Ref-of-current-effectiveResult so the Shell tool listener (declared before
  // effectiveResult) can still reach the latest geometry. Synced via effect below.
  const effectiveResultRef = useRef<ShapeResult | null>(null);
  // Persistent result for an IMPORTED model. The import sets the transient
  // sketchResult, which many view/tab/mode transitions clear — making the
  // imported model vanish back to the parametric `result` (the box) when you
  // open Render or another tab. This survives those clears (kept in sync with
  // the persistent importedGeometry below) so the import stays put. Cleared
  // when a new model is started (e.g. handleSelectShape).
  const [importedResult, setImportedResult] = useState<ShapeResult | null>(null);
  // AI-edit-an-import support: the imported mesh serialized as base64 STL, plus
  // the current OpenSCAD program that wraps it (`import("model.stl"); …`). When
  // set, AI prompts modify this program (previousScad) and render with importStl
  // so the import is preserved and edited rather than replaced. Cleared when a
  // fresh parametric shape is started (handleSelectShape).
  const importStlRef = useRef<string | null>(null);
  const importScadRef = useRef<string>('import("model.stl");');
  // Tracks the geometry uuid we last showed the "too heavy for auto-DFM" hint
  // for, so the nudge fires once per heavy model rather than on every re-render.
  const heavyDfmHintRef = useRef<string | null>(null);
  // Forward ref to handleGenerateActiveProfile so the early-mounted tool
  // listener can fire it (the handler is declared later in this function).
  const handleGenerateActiveProfileRef = useRef<(() => void) | null>(null);
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  // Auto-clear stale selection when undo/rollback removes the selected feature.
  // Avoids "selection points to a feature that no longer exists" after history nav.
  useEffect(() => {
    if (selectedFeatureId && !features.some(f => f.id === selectedFeatureId)) {
      setSelectedFeatureId(null);
    }
  }, [features, selectedFeatureId]);
  const captureRef = useRef<(() => string | null) | null>(null);
  const [cartAdded, setCartAdded] = useState(false);
  const [bomParts, setBomParts] = useState<BomPartResult[]>([]);
  const [highlightedPartId, setHighlightedPartId] = useState<string | null>(null);
  const {
    hiddenParts: assemblyHiddenParts, setHiddenParts: setAssemblyHiddenParts,
    transparentParts: assemblyTransparentParts, setTransparentParts: setAssemblyTransparentParts,
    partColors: assemblyPartColors, setPartColors: setAssemblyPartColors,
  } = useAssemblyPartDisplay();
  const [bomLabel, setBomLabel] = useState('');
  const materialId = useSceneStore(s => s.materialId);
  const setMaterialId = useSceneStore(s => s.setMaterialId);

  // Sync placedParts → bomParts whenever placedParts changes
  React.useEffect(() => {
    if (placedParts.length > 0) {
      setBomParts(placedPartsToBomResults(placedParts));
      setBomLabel(lt.assemblyLabel);
    } else {
      setBomParts([]);
      setBomLabel('');
    }
  }, [placedParts, lang]);

  const getAssemblySnapshot = useCallback((): NfabAssemblySnapshotV1 => {
    const snap: NfabAssemblySnapshotV1 = { placedParts, mates: assemblyMates };
    if (bodies.length > 0) {
      snap.bodies = bodies;
      snap.activeBodyId = activeBodyId;
      if (selectedBodyIds.length > 0) snap.selectedBodyIds = selectedBodyIds;
    }
    if (assemblyHiddenParts.size > 0) snap.hiddenParts = Array.from(assemblyHiddenParts);
    if (assemblyTransparentParts.size > 0) snap.transparentParts = Array.from(assemblyTransparentParts);
    if (Object.keys(assemblyPartColors).length > 0) snap.partColors = { ...assemblyPartColors };
    return snap;
  }, [placedParts, assemblyMates, bodies, activeBodyId, selectedBodyIds, assemblyHiddenParts, assemblyTransparentParts, assemblyPartColors]);
  
  const restoreAssemblySnapshot = useCallback((snap?: NfabAssemblySnapshotV1) => {
    if (!snap) {
      setPlacedParts([]);
      setAssemblyMates([]);
      setBodies([]);
      setActiveBodyId(null);
      setSelectedBodyIds([]);
      setAssemblyHiddenParts(new Set());
      setAssemblyTransparentParts(new Set());
      setAssemblyPartColors({});
      return;
    }
    setPlacedParts(snap.placedParts);
    setAssemblyMates(snap.mates);
    setAssemblyHiddenParts(new Set(snap.hiddenParts ?? []));
    setAssemblyTransparentParts(new Set(snap.transparentParts ?? []));
    setAssemblyPartColors(snap.partColors ?? {});
    const rawBodies = snap.bodies ?? [];
    setBodies(rawBodies);
    if (rawBodies.length === 0) {
      setActiveBodyId(null);
      setSelectedBodyIds([]);
    } else {
      const aid = snap.activeBodyId;
      setActiveBodyId(
        aid !== undefined && aid !== null && rawBodies.some(b => b.id === aid)
          ? aid
          : rawBodies[0]!.id,
      );
      setSelectedBodyIds(
        (snap.selectedBodyIds ?? []).filter(id => rawBodies.some(b => b.id === id)),
      );
    }
  }, [setPlacedParts, setAssemblyMates, setBodies, setActiveBodyId, setSelectedBodyIds]);

  // ── Assembly mates / interference / exploded view ──
  const showAssemblyPanel = useUIStore(s => s.showAssemblyPanel);
  const setShowAssemblyPanel = useUIStore(s => s.setShowAssemblyPanel);
  const [showDesignBrief, setShowDesignBrief] = useState(false); // WA-D3 AI design-brief entry (declared before the URL-effect that reads it)
  const explodeFactor = useSceneStore(s => s.explodeFactor);

  // ── Render mode ──
  const renderMode = useSceneStore(s => s.renderMode);
  const setRenderMode = useSceneStore(s => s.setRenderMode);
  const persistedRenderSettings = useSceneStore(s => s.renderSettings);
  const setPersistedRenderSettings = useSceneStore(s => s.setRenderSettings);
  const renderSettings = persistedRenderSettings ?? DEFAULT_RENDER_SETTINGS;
  const setRenderSettings = useCallback((next: RenderSettings | ((prev: RenderSettings) => RenderSettings)) => {
    if (typeof next === 'function') {
      setPersistedRenderSettings(next(persistedRenderSettings ?? DEFAULT_RENDER_SETTINGS));
    } else {
      setPersistedRenderSettings(next);
    }
  }, [persistedRenderSettings, setPersistedRenderSettings]);
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [screenshotModal, setScreenshotModal] = useState<{ canvas: HTMLCanvasElement } | null>(null);

  const lastSyncedHistoryRef = useRef<string | null>(null);

  // ── Collaboration ──
  const [chatMessages, setChatMessages] = useState<CollabChatMessage[]>([]);
  const [activityFeed, setActivityFeed] = useState<ActivityEvent[]>([]);
  // (showChatPanel moved to useShapeGeneratorUI)
  const addActivity = useCallback((evt: Omit<ActivityEvent, 'id' | 'ts'>) => {
    setActivityFeed(prev => [...prev.slice(-199), { ...evt, id: `${Date.now()}-${Math.random().toString(36).slice(2,5)}`, ts: Date.now() }]);
  }, []);

  // Forward refs for values declared later in this component
  const collabAddToastRef = useRef<((type: 'info' | 'success' | 'warning' | 'error', msg: string) => void) | null>(null);
  const authUserRef = useRef<{ name?: string } | null>(null);

  // Forward refs to break initialization cycle with usePinComments
  const pinApplyRemoteAddRef = useRef<((c: unknown) => void) | null>(null);
  const pinApplyRemoteResolveRef = useRef<((id: string) => void) | null>(null);
  const pinApplyRemoteDeleteRef = useRef<((id: string) => void) | null>(null);
  const pinApplyRemoteReactRef = useRef<((id: string, emoji: string, userId: string) => void) | null>(null);
  const pinApplyRemoteReplyRef = useRef<((commentId: string, reply: unknown) => void) | null>(null);

  // Forward ref so the useCollab callbacks can reach the CRDT bridge that's
  // initialized AFTER useCollab. Populated in a useEffect once `crdtBridge` exists.
  const crdtBridgeRef = useRef<{
    applyRemoteUpdate: (b64: string) => boolean;
    encodeUpdate: () => string;
    doc: { applyAwarenessUpdate: (b64: string) => boolean };
  } | null>(null);
  const collabSendCrdtSyncResponseRef = useRef<((b64: string) => void) | null>(null);

  const {
    users: collabUsers, isConnected: collabConnected, demoMode: collabDemo,
    setDemoMode: setCollabDemo, sendCursor: collabSendCursor,
    sendParamChange: collabSendParamChange, sendShapeChange: collabSendShapeChange,
    sendCommentAdd: collabSendCommentAdd, sendCommentResolve: collabSendCommentResolve,
    sendCommentDelete: collabSendCommentDelete, sendCommentReact: collabSendCommentReact,
    sendCommentReply: collabSendCommentReply, sendTyping: collabSendTyping,
    sendChatMessage: collabSendChatMessage, typingUsers: collabTypingUsers,
    sendFeatureSync: collabSendFeatureSync,
    sendCrdtUpdate: collabSendCrdtUpdate,
    sendCrdtAwareness: collabSendCrdtAwareness,
    sendCrdtSyncResponse: collabSendCrdtSyncResponse,
    userIdRef: collabUserIdRef, userColorRef: collabUserColorRef,
    reconnectState: collabReconnectState, reconnectCountdown: collabReconnectCountdown,
    manualReconnect: collabManualReconnect, roomId: collabRoomId } = useCollab({
    onRemoteParamChange: useCallback((remoteParams: Record<string, number>) => {
      Object.entries(remoteParams).forEach(([k, v]) => setParam(k, v));
    }, [setParam]),
    onRemoteFeatureSync: useCallback((remoteHistory: unknown) => {
      // When the CRDT bridge is active, feature tree sync is owned by Yjs
      // (CollabDoc.featureTree). The legacy SSE feature_sync payload is then
      // ignored to prevent double-application overwrites.
      if (CRDT_ENABLED) return;
      if (!replaceHistory) return;
      lastSyncedHistoryRef.current = JSON.stringify(remoteHistory);
      const fh = remoteHistory as FeatureHistory | null | undefined;
      if (fh?.nodes?.length && fh.rootId && fh.activeNodeId) {
        replaceHistory(fh.nodes, fh.rootId, fh.activeNodeId);
      }
    }, [replaceHistory]),
    onRemoteShapeChange: useCallback((shapeId: string) => {
      const sd = SHAPE_MAP[shapeId];
      if (!sd) return;
      setSelectedId(shapeId);
      const p: Record<string, number> = {};
      sd.params.forEach(sp => { p[sp.key] = sp.default; });
      setParams(p);
    }, [setSelectedId, setParams]),
    onRemoteCommentAdd: useCallback((comment: unknown) => {
      pinApplyRemoteAddRef.current?.(comment);
      const c = comment as { author?: string; authorColor?: string; text?: string };
      addActivity({ type: 'comment_add', actor: c.author ?? 'Remote', actorColor: c.authorColor, detail: c.text });
      collabAddToastRef.current?.('info', `📌 ${c.author ?? 'Remote'}: ${(c.text ?? '').slice(0, 40)}${(c.text ?? '').length > 40 ? '...' : ''}`);
    }, [addActivity]),
    onRemoteCommentResolve: useCallback((id: string) => {
      pinApplyRemoteResolveRef.current?.(id);
      addActivity({ type: 'comment_resolve', actor: 'Remote' });
      collabAddToastRef.current?.('info', lt.remoteResolvedComment);
    }, [addActivity, lang]),
    onRemoteCommentDelete: useCallback((id: string) => {
      pinApplyRemoteDeleteRef.current?.(id);
      addActivity({ type: 'comment_delete', actor: 'Remote' });
    }, [addActivity]),
    onRemoteCommentReact: useCallback((id: string, emoji: string, userId: string) => {
      pinApplyRemoteReactRef.current?.(id, emoji, userId);
    }, []),
    onRemoteCommentReply: useCallback((commentId: string, reply: unknown) => {
      pinApplyRemoteReplyRef.current?.(commentId, reply);
      const r = reply as { author?: string; text?: string };
      collabAddToastRef.current?.('info', `💬 ${r.author ?? 'Remote'}: ${(r.text ?? '').slice(0, 40)}`);
    }, []),
    // Apply incoming Yjs CRDT update from a peer.
    onRemoteCrdtUpdate: useCallback((updateB64: string) => {
      const bridge = crdtBridgeRef.current;
      if (!bridge) return;
      const L = LOCAL_LABELS[langRef.current] ?? LOCAL_LABELS.en;
      // Empty string is the sentinel for `crdt_sync_request` — peer wants our state.
      if (updateB64 === '') {
        try {
          collabSendCrdtSyncResponseRef.current?.(bridge.encodeUpdate());
        } catch (e) {
          console.warn('[crdt] sync response failed:', e);
          collabAddToastRef.current?.('warning', L.crdtSyncReplyFailed);
        }
        return;
      }
      const ok = bridge.applyRemoteUpdate(updateB64);
      if (!ok) collabAddToastRef.current?.('warning', L.crdtRemoteUpdateFailed);
    }, []),
    onRemoteAwarenessUpdate: useCallback((updateB64: string) => {
      const bridge = crdtBridgeRef.current;
      if (!bridge) return;
      const L = LOCAL_LABELS[langRef.current] ?? LOCAL_LABELS.en;
      const ok = bridge.doc.applyAwarenessUpdate(updateB64);
      if (!ok) collabAddToastRef.current?.('warning', L.crdtAwarenessUpdateFailed);
    }, []),
    onChatMessage: useCallback((msg: CollabChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
      // @mention detection (authUserRef/collabUserIdRef resolved at call time via refs)
      const myName = authUserRef.current?.name ?? 'me';
      if (myName !== 'me' && msg.text.toLowerCase().includes(`@${myName.toLowerCase()}`)) {
        collabAddToastRef.current?.('info', `🔔 ${msg.name} ${lt.mentionedYou}: ${msg.text.slice(0, 40)}`);
        setShowCommentsPanel(true);
        setShowChatPanel(true);
      }
    }, [lang]) });

  // ── CRDT bridge (opt-in via NEXT_PUBLIC_NEXYFAB_CRDT=1) ──
  // Always instantiate the bridge — construction is cheap and avoids hooks-
  // count mismatches across renders. When CRDT_ENABLED is false the bridge
  // is simply not wired to any transport, so no traffic flows.
  const crdtBridge = useCollabFeatureTree();

  // Populate the forward ref so useCollab callbacks (declared before this)
  // can apply remote updates via the bridge.
  useEffect(() => {
    crdtBridgeRef.current = {
      applyRemoteUpdate: crdtBridge.applyRemoteUpdate,
      encodeUpdate: crdtBridge.encodeUpdate,
      doc: crdtBridge.doc,
    };
    collabSendCrdtSyncResponseRef.current = collabSendCrdtSyncResponse;
    return () => { crdtBridgeRef.current = null; };
  }, [crdtBridge, collabSendCrdtSyncResponse]);

  // Broadcast local CRDT doc updates to peers (only when CRDT is enabled).
  useEffect(() => {
    if (!CRDT_ENABLED) return;
    return crdtBridge.doc.onLocalUpdate(b64 => {
      collabSendCrdtUpdate(b64);
    });
  }, [crdtBridge, collabSendCrdtUpdate]);

  // Broadcast local awareness updates (cursor / presence). Always wired —
  // awareness is cheap and shows other users even when feature-tree CRDT is off.
  useEffect(() => {
    return crdtBridge.doc.onLocalAwarenessUpdate(b64 => {
      collabSendCrdtAwareness(b64);
    });
  }, [crdtBridge, collabSendCrdtAwareness]);

  // ── Awareness staleness GC — sweep peers idle >30s every 10s ──
  // SSE is one-way, so a peer who closed their tab never tells us. We rely on
  // their last `ts` (set by setLocalPresence) to detect abandonment.
  useEffect(() => {
    const STALE_AFTER_MS = 30_000;
    const SWEEP_INTERVAL_MS = 10_000;
    const t = setInterval(() => {
      crdtBridge.doc.gcStaleAwareness(STALE_AFTER_MS);
    }, SWEEP_INTERVAL_MS);
    return () => clearInterval(t);
  }, [crdtBridge]);

  // ── Cursor publishing — throttled pointermove on the R3F canvas ──
  // Converts viewport-local pointer coords to a flat XZ plane in mm (Y=0).
  // 50ms throttle keeps awareness traffic bounded while still feeling live.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const CURSOR_THROTTLE_MS = 50;
    /** Map normalized [-1..1] to mm scene scale. Tune to match typical zoom. */
    const SCENE_SCALE_MM = 200;
    let lastSent = 0;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;

    const publish = (clientX: number, clientY: number) => {
      const canvas = document.querySelector(
        `canvas[data-engine="${NF_R3F_VIEWPORT_DATA_ENGINE}"]`,
      ) as HTMLCanvasElement | null;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      // NDC: x in [-1..1] left→right, y in [1..-1] top→bottom (we flip).
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
      // Approximate world position on z=0 plane. Real unprojection needs camera
      // matrices; this approximation is fine for cursor markers on a known scale.
      const x = ndcX * SCENE_SCALE_MM;
      const z = ndcY * SCENE_SCALE_MM;
      crdtBridge.doc.setLocalPresence({ cursor: { x, y: 0, z } });
    };

    const onMove = (e: PointerEvent) => {
      const now = Date.now();
      if (now - lastSent >= CURSOR_THROTTLE_MS) {
        lastSent = now;
        publish(e.clientX, e.clientY);
        if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      } else if (!pendingTimer) {
        // Trailing edge: ensure the last move emits even if user stops moving.
        pendingTimer = setTimeout(() => {
          pendingTimer = null;
          lastSent = Date.now();
          publish(e.clientX, e.clientY);
        }, CURSOR_THROTTLE_MS - (now - lastSent));
      }
    };

    document.addEventListener('pointermove', onMove);
    return () => {
      document.removeEventListener('pointermove', onMove);
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, [crdtBridge]);

  useEffect(() => {
    if (!CRDT_ENABLED) return;
    // Push local feature-tree snapshot into the shared Yjs doc on every change.
    // The CollabDoc detects per-key writes and emits Yjs binary updates that
    // useCollab can ferry as `crdt_update` events to peers.
    if (!featureHistory?.nodes?.length) return;
    crdtBridge.pushLocalSnapshot(featureHistory, params, selectedId ?? null);
  }, [crdtBridge, featureHistory, params, selectedId]);

  useEffect(() => {
    if (!CRDT_ENABLED) return;
    if (!replaceHistory) return;
    // Apply remote snapshots — when a peer's Yjs update arrives, the bridge
    // surfaces a coalesced full snapshot. We adopt it via replaceHistory so
    // useFeatureStack rerenders. setParams covers slider value sync.
    return crdtBridge.onRemoteSnapshot(({ tree, order, params: remoteParams, selectedId: remoteSelected }) => {
      try {
        const nodes = order.map(id => tree[id]).filter(Boolean) as FeatureHistory['nodes'];
        if (nodes.length && featureHistory?.rootId) {
          replaceHistory(nodes, featureHistory.rootId, featureHistory.activeNodeId);
        }
        const targetShapeId = remoteSelected ?? selectedId;
        const snapSd = targetShapeId ? SHAPE_MAP[targetShapeId] : undefined;
        if (remoteSelected && remoteSelected !== selectedId) setSelectedId(remoteSelected);
        if (remoteParams != null && typeof remoteParams === 'object' && Object.keys(remoteParams).length > 0) {
          applySceneParamsToSetters(snapSd, remoteParams as Record<string, number>, {
            setParams,
            setParamExpressions,
          });
        }
      } catch (err) {
        reportError('unknown', err instanceof Error ? err : new Error(String(err)), { phase: 'crdt_remote_snapshot' });
      }
    });
  }, [crdtBridge, replaceHistory, setParams, setParamExpressions, setSelectedId, featureHistory?.rootId, featureHistory?.activeNodeId, selectedId]);

  // ── Yjs Awareness (presence: cursor + editingNodeId) ──
  // Lives at the doc level (ephemeral, not persisted). Wired regardless of
  // CRDT_ENABLED so the local presence state still exists; transport hooks
  // gate broadcast on the flag, matching the snapshot path above.
  const [awarenessPresences, setAwarenessPresences] = useState<Map<number, import('./collab/yjsDoc').PresenceState>>(
    () => new Map(),
  );

  useEffect(() => {
    return crdtBridge.doc.onPresenceChange(setAwarenessPresences);
  }, [crdtBridge]);

  useEffect(() => {
    if (!CRDT_ENABLED) return;
    // Seed local presence with stable identity so peers see who we are even
    // before the first cursor moves.
    const myName = authUserRef.current?.name ?? 'You';
    const myColor = collabUserColorRef.current;
    crdtBridge.doc.setLocalPresence({ name: myName, color: myColor });
  }, [crdtBridge]);

  // Track the actively-edited feature node so peers see "X is editing fillet".
  useEffect(() => {
    if (!CRDT_ENABLED) return;
    const editingId = featureHistory?.editingNodeId ?? undefined;
    crdtBridge.doc.setLocalPresence({ editingNodeId: editingId });
  }, [crdtBridge, featureHistory?.editingNodeId]);

  // Track which feature the user has currently selected (active node) so peers
  // see "X is looking at this feature" even when not editing.
  useEffect(() => {
    if (!CRDT_ENABLED) return;
    const selId = featureHistory?.activeNodeId ?? undefined;
    crdtBridge.doc.setLocalPresence({ selectedFeatureId: selId });
  }, [crdtBridge, featureHistory?.activeNodeId]);

  // ── Sketch mode ──
  const isSketchMode = useSceneStore(s => s.isSketchMode);
  const _setSketchMode = useSceneStore(s => s.setSketchMode);
  const setIsSketchMode = useCallback((v: boolean) => _setSketchMode(v), [_setSketchMode]);

  useCadWorkspaceInference();

  const urlWorkspaceOrTabAppliedRef = useRef(false);
  const urlApplyPathGateRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (pathname !== urlApplyPathGateRef.current) {
      urlApplyPathGateRef.current = pathname ?? null;
      urlWorkspaceOrTabAppliedRef.current = false;
    }
    if (isReadOnly) return;
    if (urlWorkspaceOrTabAppliedRef.current) return;
    const w = searchParams?.get('workspace');
    if (w && isCadWorkspaceId(w)) {
      urlWorkspaceOrTabAppliedRef.current = true;
      applyCadWorkspace(w, { isSketchMode });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      if (qs.has('workspace')) {
        qs.delete('workspace');
        const n = qs.toString();
        router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      }
      return;
    }
    const routeSeg = shapeGeneratorRouteSegment(pathname);
    if (routeSeg === 'sketch') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(true);
      applyCadWorkspace('design', { isSketchMode: true });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      const cur = searchParams?.toString() ?? '';
      if (n !== cur) router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (routeSeg === 'analysis') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      applyCadWorkspace('simulation', { isSketchMode: false });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      const cur = searchParams?.toString() ?? '';
      if (n !== cur) router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (routeSeg === '3d-edit') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      setShowAssemblyPanel(false);
      applyCadWorkspace('design', { isSketchMode: false });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      const cur = searchParams?.toString() ?? '';
      if (n !== cur) router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === 'sketch') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(true);
      applyCadWorkspace('design', { isSketchMode: true });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === 'assembly') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      applyCadWorkspace('design', { isSketchMode: false });
      setShowAssemblyPanel(true);
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === 'topology') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      applyCadWorkspace('generative', { isSketchMode: false });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === 'analysis') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      applyCadWorkspace('simulation', { isSketchMode: false });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === '3d-edit') {
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      setShowAssemblyPanel(false);
      applyCadWorkspace('design', { isSketchMode: false });
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === 'ai') {
      // Hub "Nexy AI Studio" deep-link: open the AI chat panel in the design
      // workspace. (HubFrame previously linked ?mode=ai, which no handler read,
      // so the button opened a plain modeler. 2026-06-09 fix.)
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      applyCadWorkspace('design', { isSketchMode: false });
      setShowChatPanel(true);
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('entry') === 'design-brief') {
      // WA-D3 deep-link: open the AI design-brief entry (+ AI review queue).
      urlWorkspaceOrTabAppliedRef.current = true;
      setIsSketchMode(false);
      applyCadWorkspace('design', { isSketchMode: false });
      setShowDesignBrief(true);
      const qs = new URLSearchParams(searchParams?.toString() ?? '');
      qs.delete('entry');
      const n = qs.toString();
      router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
      return;
    }
    if (searchParams?.get('tab') === 'optimize') {
      urlWorkspaceOrTabAppliedRef.current = true;
      applyCadWorkspace('optimize', { isSketchMode });
    }
  }, [searchParams, isSketchMode, isReadOnly, pathname, router, setIsSketchMode, setShowAssemblyPanel, setShowChatPanel, setShowDesignBrief]);

  const sketchViewMode = useSceneStore(s => s.sketchViewMode);
  const splitMode = useSceneStore(s => s.splitMode);
  const setSplitMode = useSceneStore(s => s.setSplitMode);
  const setSketchViewMode = useSceneStore(s => s.setSketchViewMode);

  // Track viewport mode (3d/sketch/drawing) so peers can see "X switched to
  // sketch mode" without having to follow their cursor.
  useEffect(() => {
    if (!CRDT_ENABLED) return;
    const mode: '3d' | 'sketch' | 'drawing' = isSketchMode
      ? (sketchViewMode === 'drawing' ? 'drawing' : 'sketch')
      : '3d';
    crdtBridge.doc.setLocalPresence({ viewportMode: mode });
  }, [crdtBridge, isSketchMode, sketchViewMode]);

  // Track activity status — flip to 'idle' after 60s of no presence updates,
  // back to 'active' when any update lands. Distinct from the 30s staleness
  // GC which removes the peer entirely.
  useEffect(() => {
    if (!CRDT_ENABLED) return;
    const IDLE_AFTER_MS = 60_000;
    crdtBridge.doc.setLocalPresence({ activity: 'active' });
    const id = setInterval(() => {
      const local = crdtBridge.doc.getLocalPresence();
      const stale = typeof local.ts === 'number' && Date.now() - local.ts >= IDLE_AFTER_MS;
      if (stale && local.activity !== 'idle') {
        crdtBridge.doc.setLocalPresence({ activity: 'idle' });
      } else if (!stale && local.activity !== 'active') {
        crdtBridge.doc.setLocalPresence({ activity: 'active' });
      }
    }, 15_000);
    return () => clearInterval(id);
  }, [crdtBridge]);
  const sketchPlane = useSceneStore(s => s.sketchPlane);
  const setSketchPlaneRaw = useSceneStore(s => s.setSketchPlane);
  const sketchFaceFrame = useSceneStore(s => s.sketchFaceFrame);
  const [showScadPanel, setShowScadPanel] = useState(false);
  const [showGdtPicker, setShowGdtPicker] = useState(false);
  const sketchProfile = useSceneStore(s => s.sketchProfile);
  const setSketchProfile = useSceneStore(s => s.setSketchProfile);
  const sketchConfig = useSceneStore(s => s.sketchConfig);
  const setSketchConfig = useSceneStore(s => s.setSketchConfig);
  const sketchTool = useSceneStore(s => s.sketchTool);
  const setSketchTool = useSceneStore(s => s.setSketchTool);
  // sketchOperation and sketchPlaneOffset come from useSketchState hook above

  // ── Sketch state (extracted hook) ──
  const {
    sketchProfiles, setSketchProfiles,
    activeProfileIdx, setActiveProfileIdx,
    sketchOperation, setSketchOperation,
    sketchPlaneOffset, setSketchPlaneOffset,
    sketchConstraints, setSketchConstraints,
    sketchDimensions, setSketchDimensions,
    selectedConstraintType, setSelectedConstraintType,
    autoSolve, setAutoSolve,
    constraintStatus, setConstraintStatus,
    constraintDiagnostic, setConstraintDiagnostic,
    sketchHistory, setSketchHistory,
    showSketchHistory, setShowSketchHistory,
    editingSketchFeatureId, setEditingSketchFeatureId,
    showSketchActionMenu, setShowSketchActionMenu } = useSketchState();

  // ── 스케치 2단계 플로우: 'draw'=그리기, 'setup3d'=3D변환설정 ──
  const [sketchStep, setSketchStep] = useState<'draw' | 'setup3d'>('draw');

  // ── Model parameters (user-defined named variables for parametric modeling) ──
  const [modelVars, setModelVars] = useState<ModelVar[]>([]);
  // (showModelParams moved to useShapeGeneratorUI)

  // When model vars change, re-evaluate all param expressions
  useEffect(() => {
    if (modelVars.length === 0) return;
    const mvVars: ExprVariable[] = modelVars.map(v => ({ name: v.name, value: v.value }));
    // Access current paramExpressions and params from store directly
    const currentExprs = useSceneStore.getState().paramExpressions;
    const currentParams = useSceneStore.getState().params;
    Object.entries(currentExprs).forEach(([key, expr]) => {
      const allVars: ExprVariable[] = [
        ...Object.entries(currentParams).filter(([k]) => k !== key).map(([name, value]) => ({ name, value })),
        ...mvVars,
      ];
      try {
        const val = evaluateExpression(expr, allVars);
        if (isFinite(val)) setParam(key, val);
      } catch { /* invalid expression — skip */ }
    });
  }, [modelVars, setParam]);

  // Render-synced ref so call-time handlers (expression commit command) read
  // the LATEST variable table, not the closure they were created under.
  const modelVarsRef = useRef(modelVars);
  modelVarsRef.current = modelVars;

  // Shared variable scope for FEATURE param expressions ("=W/2"): base-shape
  // params first, global model variables after (user-defined globals shadow a
  // base param on name collision); sibling params of the edited feature are
  // appended last by paramScopeFor and shadow both.
  const featureExprScope = useMemo<ExprVariable[]>(() => [
    ...Object.entries(params).map(([name, value]) => ({ name, value })),
    ...modelVars.map(v => ({ name: v.name, value: v.value })),
  ], [params, modelVars]);

  // Expose the global variable table to the EXISTING EquationManager engine
  // (features/featureContext slot). The pipeline's applyFeatureContext then
  // resolves any expression-typed (string) feature params — e.g. emitted by
  // ConfigurationTable overrides — against the same variables the UI shows.
  // Formula seeding is best-effort (the EquationManager's parser is the
  // positionDrivers one); on parse failure we fall back to the value already
  // resolved by resolveModelVars so the table never goes missing a name.
  useEffect(() => {
    if (modelVars.length === 0) {
      setPipelineEquationManager(null);
      return;
    }
    const em = new EquationManager();
    for (const v of modelVars) {
      try {
        em.set(v.name, v.expression);
      } catch {
        try { em.set(v.name, String(v.value)); } catch { /* invalid name — skip */ }
      }
    }
    setPipelineEquationManager(em);
    return () => setPipelineEquationManager(null);
  }, [modelVars]);

  const lastBrokenSnapshotRef = useRef<string>('');

  // (showPropertyManager moved to useShapeGeneratorUI)

  // ── Viewport state (extracted hook) ──
  const {
    showDimensions, setShowDimensions,
    measureActive, setMeasureActive,
    measureMode, setMeasureMode,
    sectionActive, setSectionActive,
    sectionAxis, setSectionAxis,
    sectionOffset, setSectionOffset,
    editMode, setEditMode,
    transformMode, setTransformMode,
    transformMatrix, setTransformMatrix,
    snapEnabled, setSnapEnabled,
    snapSize, setSnapSize,
    smartSnapEnabled, setSmartSnapEnabled,
    unitSystem, setUnitSystem } = useViewportState();

  // ── Selection filters (depends on editMode from viewport) ──
  const [selectionFilters, setSelectionFilters] = useState<SelectionFilter[]>(['body']);

  useEffect(() => {
    if (editMode === 'none') setSelectionFilters(['body']);
    else setSelectionFilters([editMode as SelectionFilter]);
  }, [editMode]);

  const toggleSelectionFilter = useCallback((f: SelectionFilter) => {
    setSelectionFilters([f]);
    if (f === 'body') setEditMode('none');
    else setEditMode(f as EditMode);
  }, [setEditMode]);

  const [sketchPalSlice, setSketchPalSlice] = useState(false);
  const [sketchSlicePlaneMm, setSketchSlicePlaneMm] = useState(60);
  const [viewportCameraPersisted, setViewportCameraPersisted] = useState<{
    position: [number, number, number];
    target: [number, number, number];
  } | null>(null);
  const [projectCameraToApply, setProjectCameraToApply] = useState<{
    position: [number, number, number];
    target: [number, number, number];
  } | null>(null);
  const [viewportGeometryFitSuppressed, setViewportGeometryFitSuppressed] = useState(false);

  const getStudioViewSnapshot = useCallback((): NfabStudioViewV1 | undefined => {
    const mv = useUIStore.getState().multiView;
    const hasMv = mv === true;
    const hasCam = viewportCameraPersisted != null;
    const isDefault =
      !sectionActive &&
      sectionAxis === 'y' &&
      Math.abs(sectionOffset - 0.5) < 1e-6 &&
      !sketchPalSlice &&
      Math.abs(sketchSlicePlaneMm - 60) < 1e-6 &&
      !hasMv &&
      !hasCam;
    if (isDefault) return undefined;
    return {
      sectionActive,
      sectionAxis,
      sectionOffset,
      sketchSlicePalette: sketchPalSlice,
      sketchSlicePlaneMm,
      ...(hasMv ? { multiView: true as const } : {}),
      ...(hasCam && viewportCameraPersisted
        ? {
            cameraPosition: viewportCameraPersisted.position,
            cameraTarget: viewportCameraPersisted.target,
          }
        : {}),
    };
  }, [sectionActive, sectionAxis, sectionOffset, sketchPalSlice, sketchSlicePlaneMm, viewportCameraPersisted]);

  const restoreStudioViewSnapshot = useCallback((sv?: NfabStudioViewV1) => {
    if (!sv) {
      setSectionActive(false);
      setSectionAxis('y');
      setSectionOffset(0.5);
      setSketchPalSlice(false);
      setSketchSlicePlaneMm(60);
      useUIStore.getState().setMultiView(false);
      setViewportCameraPersisted(null);
      setProjectCameraToApply(null);
      setViewportGeometryFitSuppressed(false);
      return;
    }
    setSectionActive(!!sv.sectionActive);
    if (sv.sectionAxis === 'x' || sv.sectionAxis === 'y' || sv.sectionAxis === 'z') setSectionAxis(sv.sectionAxis);
    if (typeof sv.sectionOffset === 'number' && Number.isFinite(sv.sectionOffset)) {
      setSectionOffset(Math.max(0, Math.min(1, sv.sectionOffset)));
    }
    setSketchPalSlice(!!sv.sketchSlicePalette);
    if (typeof sv.sketchSlicePlaneMm === 'number' && Number.isFinite(sv.sketchSlicePlaneMm)) {
      setSketchSlicePlaneMm(sv.sketchSlicePlaneMm);
    }
    if (typeof sv.multiView === 'boolean') {
      useUIStore.getState().setMultiView(sv.multiView);
    } else {
      useUIStore.getState().setMultiView(false);
    }
    const cp = sv.cameraPosition;
    const ct = sv.cameraTarget;
    if (
      cp &&
      ct &&
      cp.length === 3 &&
      ct.length === 3 &&
      cp.every(n => typeof n === 'number' && Number.isFinite(n)) &&
      ct.every(n => typeof n === 'number' && Number.isFinite(n))
    ) {
      const cam = {
        position: [cp[0], cp[1], cp[2]] as [number, number, number],
        target: [ct[0], ct[1], ct[2]] as [number, number, number],
      };
      setViewportCameraPersisted(cam);
      setProjectCameraToApply(cam);
      setViewportGeometryFitSuppressed(true);
    } else {
      setViewportCameraPersisted(null);
      setProjectCameraToApply(null);
      setViewportGeometryFitSuppressed(false);
    }
  }, [setSectionActive, setSectionAxis, setSectionOffset, setSketchPalSlice, setSketchSlicePlaneMm]);

  const handleViewportCameraCommit = useCallback(
    (position: [number, number, number], target: [number, number, number]) => {
      setViewportCameraPersisted({ position, target });
    },
    [],
  );

  const handleProjectCameraApplied = useCallback(() => {
    setProjectCameraToApply(null);
  }, []);

  // SCAD agent → render → push geometry into the main viewport via the
  // existing sketch-result slot. Errors surface through the standard
  // toast system so the user sees what went wrong without diving into
  // the agent panel.
  const handleApplyAgentScad = useCallback(async (scad: string) => {
    if (!scad.trim()) return;
    try {
      const { renderScadToGeometry } = await import('@/lib/ai/scad-agent/renderToGeometry');
      // Pass the imported mesh (if any) so a SCAD program that does
      // import("model.stl") edits the import instead of failing to find it.
      const result = await renderScadToGeometry(scad, undefined, importStlRef.current);
      const edgeGeo = makeEdges(result.geometry);
      const vol = meshVolume(result.geometry) / 1000;
      const sa = meshSurfaceArea(result.geometry) / 100;
      result.geometry.computeBoundingBox();
      const bb = result.geometry.boundingBox!;
      const newSketchResult = {
        geometry: result.geometry,
        edgeGeometry: edgeGeo,
        volume_cm3: vol,
        surface_area_cm2: sa,
        bbox: {
          w: Math.round(bb.max.x - bb.min.x),
          h: Math.round(bb.max.y - bb.min.y),
          d: Math.round(bb.max.z - bb.min.z),
        },
      };
      // A1 — wrap in commandHistory so Ctrl+Z reverts to prior canvas state.
      // Capture prevSketchResult lazily inside execute() so an undo→redo
      // chain doesn't lose intermediate user edits made before Ctrl+Z.
      let prevSketchResult: typeof newSketchResult | null = null;
      let prevIsSketchMode = isSketchMode;
      let prevViewMode = viewMode;
      commandHistory.execute({
        id: `agent-apply-scad-${Date.now()}`,
        label: 'Agent: apply SCAD',
        labelKo: '에이전트: SCAD 적용',
        execute: () => {
          prevSketchResult = useSceneStore.getState().sketchResult as typeof newSketchResult | null;
          prevIsSketchMode = isSketchMode;
          prevViewMode = viewMode;
          setSketchResult(newSketchResult);
          setIsSketchMode(false);
          setViewMode('workspace');
        },
        undo: () => {
          setSketchResult(prevSketchResult);
          setIsSketchMode(prevIsSketchMode);
          setViewMode(prevViewMode);
        },
      });
      addToast('success', `Agent: ${result.triangleCount.toLocaleString()} 삼각형 렌더링 완료`);
    } catch (e) {
      const err = e as Error;
      addToast('error', `렌더 실패: ${err.message}`);
      void import('@/lib/client-error-capture').then(m => m.captureClientError(err, {
        source: 'scad-agent',
        tags: { action: 'apply-agent-scad' },
      }));
    }
  }, [isSketchMode, viewMode]);

  /** W6 — Render an OCCT B-rep handle into the main viewport.
   *  Pulls the tessellated mesh from the agent's brep-mesh API and
   *  feeds it through the same setSketchResult pipeline as scad. */
  const handleShowBrepHandle = useCallback(async (handle: string) => {
    try {
      const res = await fetch(`/api/nexyfab/scad-agent/brep-mesh?handle=${encodeURIComponent(handle)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as {
        ok: boolean; vertices: number[]; triangles: number[];
        bbox: { min: [number, number, number]; max: [number, number, number] } | null;
      };
      const { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } = await import('three');
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(data.vertices, 3));
      geo.setIndex(new Uint32BufferAttribute(data.triangles, 1));
      geo.computeVertexNormals();
      geo.computeBoundingBox();
      // Preserve B-rep lineage: the browser holds only this mesh, but the exact
      // B-rep is still live in the server registry under `handle`. Stamping it
      // lets the adopted body export STEP losslessly (brep-step endpoint) instead
      // of re-meshing, and upgrade to a live browser handle once K-series lands.
      const { tagBrepProvenance } = await import('./features/agentBrepAdoption');
      tagBrepProvenance(geo, handle);
      const edgeGeo = makeEdges(geo);
      const vol = meshVolume(geo) / 1000;
      const sa = meshSurfaceArea(geo) / 100;
      const bb = geo.boundingBox!;
      const newSketchResult = {
        geometry: geo,
        edgeGeometry: edgeGeo,
        volume_cm3: vol,
        surface_area_cm2: sa,
        bbox: {
          w: Math.round(bb.max.x - bb.min.x),
          h: Math.round(bb.max.y - bb.min.y),
          d: Math.round(bb.max.z - bb.min.z),
        },
      };
      // A1 — same commandHistory wrapping as agent SCAD apply.
      let prevSketchResult: typeof newSketchResult | null = null;
      let prevIsSketchMode = isSketchMode;
      let prevViewMode = viewMode;
      commandHistory.execute({
        id: `agent-show-brep-${handle}-${Date.now()}`,
        label: `Agent: show ${handle}`,
        labelKo: `에이전트: ${handle} 표시`,
        execute: () => {
          prevSketchResult = useSceneStore.getState().sketchResult as typeof newSketchResult | null;
          prevIsSketchMode = isSketchMode;
          prevViewMode = viewMode;
          setSketchResult(newSketchResult);
          setIsSketchMode(false);
          setViewMode('workspace');
        },
        undo: () => {
          setSketchResult(prevSketchResult);
          setIsSketchMode(prevIsSketchMode);
          setViewMode(prevViewMode);
        },
      });
      addToast('success', `B-rep ${handle}: ${(data.triangles.length / 3).toLocaleString()} tris`);
    } catch (e) {
      const err = e as Error;
      addToast('error', `B-rep 표시 실패: ${err.message}`);
      void import('@/lib/client-error-capture').then(m => m.captureClientError(err, {
        source: 'scad-agent',
        tags: { action: 'show-brep-handle' },
        extra: { handle },
      }));
    }
  }, [isSketchMode, viewMode]);

  const handleGeometryFitRequest = useCallback(() => {
    setViewportGeometryFitSuppressed(false);
  }, []);

  // ── Configurations (named variants: params + feature suppress) — .nfab [CAD-데이터] ──
  const [configurations, setConfigurations] = useState<NfabConfigurationV1[]>([]);
  const [activeConfigurationId, setActiveConfigurationId] = useState<string | null>(null);

  // ── A3 (W3) flag-gated runtime — `?configs=v2` opts into the new
  // ConfigurationTable pipeline integration. When OFF (default), behaviour
  // is unchanged: the legacy state-mutating handlers stay as the
  // authoritative path (kept for back-compat until v2 graduates from
  // flag-gated to default in a later PR). When ON, a stable
  // `ConfigurationTable` instance backs the same state — handlers
  // dual-write so the panel UI (which still reads `configurations`) stays
  // in sync, but the pipeline re-evaluates through `applyFeatureContext`
  // → `ConfigurationTable.resolveActive` instead of through scene-store
  // mutation.
  //
  // **W6 (Track A6) cleanup** — the in-session `masterSceneSnapshotRef`
  // defensive layer (PR #42) was removed in this PR. A3 + A5 are the
  // production path: the v2 runtime never mutates the master tree, and
  // soak burn-in + CRDT divergence tests (W5) have validated that. The
  // legacy mutation branch below is still here for users on the
  // `?configs=v1`/default path; it remains the documented "save while a
  // non-master config is active to lose your original master" footgun
  // (configurations-spec §13.5), which users escape by switching to
  // `?configs=v2`.
  const useConfigurationTableRuntime = searchParams?.get('configs') === 'v2';
  const configurationTableRef = useRef<ConfigurationTableRuntime | null>(null);
  if (useConfigurationTableRuntime && configurationTableRef.current === null) {
    // Lazy init — hot-swap from the legacy state so a mid-session flag
    // flip preserves the user's variants.
    configurationTableRef.current = migrateConfigsFromV1(configurations, activeConfigurationId);
  }

  // ── A5 (W5) — ConfigStore adapter ────────────────────────────────────────
  // When a Y.Doc is available (collab session), we wrap the
  // ConfigurationTable in a Yjs-backed adapter so mutations route through
  // applyConfigOp + transact. The pipeline still reads through
  // `setPipelineConfigurationTable` because A2's ConfigurationTable is the
  // single resolver. In Yjs mode the adapter rebuilds the table from the
  // doc on every Y update.
  //
  // The doc itself is null today — A5 only ships the adapter; the future
  // collab session bridge (W7+) will populate this ref via useCollab once
  // the host carries a Y.Doc. The adapter falls back to local mode and
  // the behaviour is identical to the A3 path.
  const configCollabDocRef = useRef<Y.Doc | null>(null);
  const configStoreRef = useRef<ConfigStoreType | null>(null);
  if (useConfigurationTableRuntime && configurationTableRef.current && configStoreRef.current === null) {
    const doc = configCollabDocRef.current;
    if (doc) {
      // Collab pipeline — mutations route through applyConfigOp.
      const localBootstrap = ConfigStore.local(configurationTableRef.current);
      configStoreRef.current = migrateConfigStoreToYjs(localBootstrap, doc);
    } else {
      // Single-user — wraps the same ConfigurationTable instance.
      configStoreRef.current = ConfigStore.local(configurationTableRef.current);
    }
  }

  // Register / unregister the pipeline seam slot. This is the single
  // wire that makes `applyFeatureContext` route through the new table
  // (see features/featureContext.ts). The flag-off branch explicitly
  // nulls the slot so a tab opened in v2 then refreshed without the
  // flag drops back to the legacy path cleanly.
  useEffect(() => {
    if (useConfigurationTableRuntime && configurationTableRef.current) {
      setPipelineConfigurationTable(configurationTableRef.current);
    } else {
      setPipelineConfigurationTable(null);
    }
    return () => {
      setPipelineConfigurationTable(null);
    };
  }, [useConfigurationTableRuntime]);

  const getConfigurationsBlock = useCallback(
    () => ({
      configurations,
      activeConfigurationId,
    }),
    [configurations, activeConfigurationId],
  );

  const restoreConfigurationsSnapshot = useCallback(
    (configs: NfabConfigurationV1[] | undefined, activeId: string | null | undefined) => {
      setConfigurations(configs ?? []);
      setActiveConfigurationId(activeId ?? null);
    },
    [],
  );

  const handleConfigurationSelect = useCallback(
    (id: string | null) => {
      // ── A3 v2 path — flag on: route through ConfigurationTable, do
      //    NOT mutate sceneStore / node.enabled. The pipeline picks up
      //    the change via `applyFeatureContext` on the next re-eval,
      //    which `configurationsSig` (below) triggers when activeId
      //    changes. The list UI still reads `configurations`, so we
      //    only need to update activeConfigurationId.
      if (useConfigurationTableRuntime && configurationTableRef.current) {
        configurationTableRef.current.activate(id);
        setActiveConfigurationId(id);
        return;
      }

      // ── Legacy path (default) — scene-store mutation. ──
      // Users staying on the default (`?configs=v1`) path keep the
      // pre-W6 behaviour. The defensive masterSnapshot layer that used
      // to wrap this branch was removed in W6 (A6) cleanup; users who
      // need master-tree protection are expected to migrate to the v2
      // runtime by opting into `?configs=v2`.
      setActiveConfigurationId(id);

      // Deactivate path: drop back to working master (caller's
      // sceneStore is left as-is; legacy path has no in-session master
      // snapshot to restore from).
      if (id == null) {
        return;
      }

      // Activate path: apply the config (unchanged from prior behavior).
      const cfg = configurations.find(c => c.id === id);
      if (!cfg) return;
      useSceneStore.setState(s => ({
        params: { ...cfg.params },
        ...(cfg.paramExpressions !== undefined
          ? { paramExpressions: { ...cfg.paramExpressions } }
          : { paramExpressions: { ...s.paramExpressions } }),
      }));
      for (const [nodeId, en] of Object.entries(cfg.featureEnabled)) {
        updateNode(nodeId, { enabled: en });
      }
      // Nodes added after this variant was saved: default to enabled
      const nodes = getOrderedNodes();
      for (const n of nodes) {
        if (!featureHistory || n.id === featureHistory.rootId) continue;
        if (n.type === 'baseShape') continue;
        if (Object.prototype.hasOwnProperty.call(cfg.featureEnabled, n.id)) continue;
        updateNode(n.id, { enabled: true });
      }
    },
    [configurations, featureHistory, getOrderedNodes, updateNode, useConfigurationTableRuntime],
  );

  const handleConfigurationAdd = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const sc = useSceneStore.getState();
      const nodes = getOrderedNodes();
      const featureEnabled: Record<string, boolean> = {};
      for (const n of nodes) {
        if (!featureHistory || n.id === featureHistory.rootId) continue;
        if (n.type === 'baseShape') continue;
        featureEnabled[n.id] = n.enabled;
      }
      const id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `cfg-${Date.now()}`;
      const pe = sc.paramExpressions;
      const newCfg: NfabConfigurationV1 = {
        id,
        name: trimmed,
        params: { ...sc.params },
        ...(Object.keys(pe).length > 0 ? { paramExpressions: { ...pe } } : {}),
        featureEnabled,
      };

      // ── A3 v2 path — mirror into the ConfigurationTable runtime so
      //    the pipeline seam has the new entry. We still update the
      //    legacy `configurations` state because the panel UI binds
      //    to it; the table is the canonical source for the pipeline.
      if (useConfigurationTableRuntime && configurationTableRef.current) {
        const table = configurationTableRef.current;
        // `migrateFromV1` is the canonical mapper. We piggy-back on
        // it for a single-entry add so the mapping stays in one place.
        const subTable = migrateConfigsFromV1([newCfg], id);
        const entry = subTable.get(id);
        if (entry) {
          table.add(entry.name, { id: entry.id });
          for (const [featureId, slot] of Object.entries(entry.overrides)) {
            if (slot.suppressed) {
              table.setSuppressed(id, featureId, true);
            }
          }
          for (const [varName, value] of Object.entries(entry.expressionVars)) {
            table.setExpressionVar(id, varName, value);
          }
        }
        table.activate(id);
      }

      setConfigurations(prev => [...prev, newCfg]);
      setActiveConfigurationId(id);
    },
    [featureHistory, getOrderedNodes, useConfigurationTableRuntime],
  );

  const handleConfigurationRename = useCallback(
    (configId: string, name: string) => {
      const n = name.trim();
      if (!n) return;
      if (useConfigurationTableRuntime && configurationTableRef.current) {
        configurationTableRef.current.rename(configId, n);
      }
      setConfigurations(prev => prev.map(c => (c.id === configId ? { ...c, name: n } : c)));
    },
    [useConfigurationTableRuntime],
  );

  const handleConfigurationDelete = useCallback(
    (id: string) => {
      if (useConfigurationTableRuntime && configurationTableRef.current) {
        configurationTableRef.current.remove(id);
      }
      setConfigurations(prev => prev.filter(c => c.id !== id));
      setActiveConfigurationId(cur => (cur === id ? null : cur));
    },
    [useConfigurationTableRuntime],
  );

  const configurationsSig = useMemo(
    () => JSON.stringify(configurations) + String(activeConfigurationId),
    [configurations, activeConfigurationId],
  );

  /** Clear invalid variants when the design tree is reset to a single root (e.g. clear all). */
  const configurationTreePurgeBootRef = useRef(true);
  useEffect(() => {
    if (configurationTreePurgeBootRef.current) {
      configurationTreePurgeBootRef.current = false;
      return;
    }
    if (featureHistory.nodes.length === 1 && configurations.length > 0) {
      setConfigurations([]);
      setActiveConfigurationId(null);
    }
  }, [featureHistory.nodes.length, featureHistory.rootId, configurations.length]);

  // ── Sketch result (overrides parametric result when sketch was generated) ──
  const sketchResult = useSceneStore(s => s.sketchResult);
  const setSketchResult = useSceneStore(s => s.setSketchResult);

  // ── AI Preview state ──
  const previewResult = useSceneStore(s => s.previewResult);
  const setPreviewResult = useSceneStore(s => s.setPreviewResult);
  const isPreviewMode = useSceneStore(s => s.isPreviewMode);
  const setIsPreviewMode = useSceneStore(s => s.setIsPreviewMode);

  // ── Tutorial / Onboarding ──
  // Suppress the legacy auto welcome-banner/tutorial while the first-run sample
  // template picker owns the screen (empty part) — they used to stack on top of
  // it (the reported onboarding clutter). Manual tutorial start still works.
  const tutorial = useTutorial(features.length === 0);
  const contextHelp = useContextHelp();

  useEffect(() => {
    if (!featureHistory) return;
    const str = JSON.stringify(featureHistory);
    if (str !== lastSyncedHistoryRef.current) {
      lastSyncedHistoryRef.current = str;
      collabSendFeatureSync(featureHistory);
    }
  }, [featureHistory, collabSendFeatureSync]);

  // Context detection: enter context when modes change
  React.useEffect(() => {
    if (isSketchMode) contextHelp.enterContext('sketch');
    else if (isPreviewMode) contextHelp.enterContext('render');
    else contextHelp.leaveContext();
  }, [isSketchMode, isPreviewMode]);

  // Wrapped addFeature that also triggers feature context help.
  // Round 26 Phase 3: route through commandHistory inline so Ctrl+Z reverses
  // the add. We can't reuse handleAddFeatureCmd() (defined further below in
  // this component) without a forward-reference TDZ — inlining a single
  // commandHistory.execute is cheaper than a ref dance.
  const addFeatureWithContext = useCallback((type: FeatureType | 'moldTools') => {
    if (type === 'moldTools') {
      setShowMoldDesignPanel(true);
      return;
    }
    const featType = type as FeatureType;
    // Capture the picked edge at click time so fillet/chamfer round only the
    // selected edge (re-resolved into an OCCT EdgeFinder at pipeline time).
    // Frozen in this closure so undo→redo replays the same selection.
    let edgeSel: import('./editing/selectionInfo').EdgeSelectionInfo[] | undefined;
    let faceSel: import('./editing/selectionInfo').FaceSelectionInfo[] | undefined;
    if (featType === 'fillet' || featType === 'chamfer' || featType === 'variableFillet') {
      const el = useSelectionStore.getState().selectedElement;
      if (el && el.type === 'edge') edgeSel = [el];
    } else if (featType === 'shell') {
      // A picked face → shell opens exactly that face (re-resolved by signature).
      const el = useSelectionStore.getState().selectedElement;
      if (el && el.type === 'face') faceSel = [el];
    }
    commandHistory.execute({
      id: `add-feature-${featType}-${Date.now()}`,
      label: `Add feature: ${featType}`,
      labelKo: `피처 추가: ${featType}`,
      execute: () => { addFeatureWithEdges(featType, edgeSel, faceSel); },
      undo: () => { undoLast(); },
    });
    contextHelp.enterContext('feature');
  }, [addFeatureWithEdges, undoLast]);

  // addFeatureWithParams variant — same tracked treatment so dimension-driven
  // adds (e.g. hole diameter from quick-input) are also undoable atomically.
  const addFeatureWithParamsAndContext = useCallback(
    (type: FeatureType, overrides: Record<string, number>) => {
      commandHistory.execute({
        id: `add-feature-params-${type}-${Date.now()}`,
        label: `Add feature: ${type}`,
        labelKo: `피처 추가: ${type}`,
        execute: () => { addFeatureWithParams(type, overrides); },
        undo: () => { undoLast(); },
      });
      contextHelp.enterContext('feature');
    },
    [addFeatureWithParams, undoLast],
  );

  // ── Command History (Command Pattern undo/redo) ──
  const cmdHistory = useCommandHistory();

  // ── Fullscreen / drag / viewport misc state ──
  // (show3DPreview, isFullscreen, showFullscreenPrompt, isDragOver, isImporting,
  //  isDragging, dragCounterRef, toggleFullscreen, dismissFullscreenPrompt
  //  moved to useShapeGeneratorUI)
  const [cursor3DPos, _setCursor3DPos] = useState<{ x: number; y: number; z: number } | null>(null);

  // ── UI state ──
  const showAIAssistant = useUIStore(s => s.showAIAssistant);
  const scadAuthoringMode = useUIStore(s => s.scadAuthoringMode);
  const setShowAIAssistant = useUIStore(s => s.setShowAIAssistant);
  const openAIAssistant = useUIStore(s => s.openAIAssistant);
  const showShortcuts = useUIStore(s => s.showShortcuts);
  const setShowShortcuts = useUIStore(s => s.setShowShortcuts);
  const showCommandPalette = useUIStore(s => s.showCommandPalette);
  const setShowCommandPalette = useUIStore(s => s.setShowCommandPalette);
  const togglePanel = useUIStore(s => s.togglePanel);
  // Toolbar 🔍 버튼에서 dispatch하는 커스텀 이벤트 수신
  useEffect(() => {
    const open = () => setShowCommandPalette(true);
    window.addEventListener('nexyfab:open-command-palette', open);
    return () => window.removeEventListener('nexyfab:open-command-palette', open);
  }, [setShowCommandPalette]);
  const showPlanes = useUIStore(s => s.showPlanes);
  const setShowPlanes = useUIStore(s => s.setShowPlanes);
  const showPerf = useUIStore(s => s.showPerf);
  const _setShowPerf = useUIStore(s => s.setShowPerf);
  const occtMode = useUIStore(s => s.occtMode);
  const occtInitPending = useUIStore(s => s.occtInitPending);
  const occtInitError = useUIStore(s => s.occtInitError);
  const setOcctMode = useUIStore(s => s.setOcctMode);
  // Kernel of record (Phase 0): the OCCT B-rep kernel is the DEFAULT. It is
  // verified correct (test:occt:feasibility) and perf-cleared (WASM cold load
  // ~300 ms one-time, per-commit eval 25–59 ms — see occtCommitPerf). Auto-
  // enable on boot, deferred to idle so the 10 MB WASM load never blocks first
  // paint, and skip it if the user has deliberately switched back to the mesh
  // path (nf_occt_pref='off'). setOcctMode fails safe to mesh if the load errors.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let pref: string | null = null;
    try { pref = window.localStorage.getItem('nf_occt_pref'); } catch { /* private mode */ }
    if (pref === 'off') return;
    let enabled = false;
    const enable = () => {
      if (enabled) return;
      enabled = true;
      if (!useUIStore.getState().occtMode) void setOcctMode(true);
    };
    // F-4 후속 실측(260808g): requestIdleCallback 은 WebGL rAF 루프가 프레임을
    // 포화시키면 **무기한 굶는다**(헤드리스 실측 — 20s 동안 미호출, 저사양
    // 실기기도 동일 위험). idle 콜백만 믿으면 kernel-of-record 가 조용히
    // mesh 로 남으므로 3s 타임아웃으로 활성을 보증한다(먼저 온 쪽이 실행).
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const timeoutId = window.setTimeout(enable, 3_000);
    if (ric) ric(() => { window.clearTimeout(timeoutId); enable(); });
    return () => window.clearTimeout(timeoutId);
  }, [setOcctMode]);
  const multiView = useUIStore(s => s.multiView);
  const setMultiView = useUIStore(s => s.setMultiView);
  const showVersionPanel = useUIStore(s => s.showVersionPanel);
  const setShowVersionPanel = useUIStore(s => s.setShowVersionPanel);
  const [versionDiffPair, setVersionDiffPair] = useState<[import('./history/useVersionHistory').DesignVersion, import('./history/useVersionHistory').DesignVersion] | null>(null);
  const showHistoryPanel = useUIStore(s => s.showHistoryPanel);
  const setShowHistoryPanel = useUIStore(s => s.setShowHistoryPanel);
  const defaultPlanes = useMemo(() => [
    { id: 'xy', type: 'xy' as const, offset: 0, visible: true, label: 'XY Plane' },
    { id: 'xz', type: 'xz' as const, offset: 0, visible: true, label: 'XZ Plane' },
    { id: 'yz', type: 'yz' as const, offset: 0, visible: true, label: 'YZ Plane' },
  ], []);

  // ── Context menu state ──
  const { ctxMenu, openContextMenu, closeContextMenu } = useContextMenu();
  /** Radial marking menu (2D sketch context). */
  const { sketchRadial, openSketchRadial, closeSketchRadial } = useSketchRadialMenu();
  /** Sketch palette toggles ↔ SketchCanvas overlays. */
  const {
    grid: sketchPalGrid, setGrid: setSketchPalGrid,
    snap: sketchPalSnap, setSnap: setSketchPalSnap,
    dims: sketchPalDims, setDims: setSketchPalDims,
    constraints: sketchPalConst, setConstraints: setSketchPalConst,
    profile: sketchPalProfile, setProfile: setSketchPalProfile,
  } = useSketchPaletteToggles();
  const {
    lineStyle: sketchLineStyle, setLineStyle: setSketchLineStyle,
    pickFilter: sketchPickFilter, cyclePickFilter: cycleSketchPickFilter,
  } = useSketchInteractionMode(isSketchMode);
  const [sketchLookAtNonce, setSketchLookAtNonce] = useState(0);
  const sketchPickFilterHint = useMemo(() => {
    switch (sketchPickFilter) {
      case 'segments': return lt.sketchPickFilterSegments;
      case 'points': return lt.sketchPickFilterPoints;
      default: return lt.sketchPickFilterAll;
    }
  }, [sketchPickFilter, lt]);
  const ribbonTheme = useSceneStore(s => s.ribbonTheme);
  const setRibbonTheme = useSceneStore(s => s.setRibbonTheme);
  // 오른쪽 버튼 누른 위치 추적 (드래그 vs 단순 클릭 구분용)
  const rightMouseDownPos = useRef<{ x: number; y: number } | null>(null);

  // ── New module state (non-import parts) ──
  const showLibrary = useUIStore(s => s.showLibrary);
  const setShowLibrary = useUIStore(s => s.setShowLibrary);
  const showHoleWizard = useUIStore(s => s.showHoleWizard);
  const setShowHoleWizard = useUIStore(s => s.setShowHoleWizard);
  // (selectedStandardPart, standardPartParams moved to useShapeGeneratorUI)
  // ── FEA condition selection (3D marker click ↔ panel highlight) ──
  const [feaHighlightedConditionIdx, setFeaHighlightedConditionIdx] = React.useState<number | null>(null);
  // ── Analysis state (extracted hook) ──
  const {
    feaResult, setFeaResult,
    feaConditions, setFeaConditions: _setFeaConditions,
    feaDisplayMode, setFeaDisplayMode: _setFeaDisplayMode,
    feaDeformationScale, setFeaDeformationScale: _setFeaDeformationScale,
    showFEA, setShowFEA,
    dfmResults, setDfmResults,
    dfmHighlightedIssue, setDfmHighlightedIssue,
    showDFM, setShowDFM,
    draftResult, setDraftResult,
    draftMinDeg, setDraftMinDeg,
    showDraftAnalysis, setShowDraftAnalysis,
    printAnalysis, setPrintAnalysis,
    printBuildDir, setPrintBuildDir,
    printOverhangAngle, setPrintOverhangAngle,
    showPrintAnalysis, setShowPrintAnalysis,
    showMassProps, setShowMassProps,
    showCenterOfMass, setShowCenterOfMass,
    validationResult: _validationResult, setValidationResult,
    showValidation, setShowValidation,
    gdtAnnotations, addGDTAnnotation, updateGDTAnnotation, removeGDTAnnotation,
    dimensionAnnotations, addDimensionAnnotation, removeDimensionAnnotation, updateDimensionAnnotation,
    showAnnotationPanel: _showAnnotationPanel, setShowAnnotationPanel,
    annotationPlacementMode: _annotationPlacementMode, setAnnotationPlacementMode: _setAnnotationPlacementMode } = useAnalysisState();

  // ── Shared: Cart ──
  const { items: cartItems, addItem: addCartItem, removeItem: removeCartItem, clearCart } = useShapeCart();
  const { toasts, addToast, removeToast } = useToast();
  useSessionKeepalive(); // keep the 15-min access token fresh during long sessions
  useEffect(() => { collabAddToastRef.current = addToast; }, [addToast]);

  // Phase 6c — drawing template prefs (single user pref shared by
  // the assembly + configurations export bridges below). localStorage-
  // backed; default is the 3-view A4 landscape "cookbook" template.
  const [drawingTemplatePrefs] = useDrawingTemplatePrefs();

  const paletteCommands = useMemo<Command[]>(
    () => [
      ...buildWorkspaceCommands({
        lang,
        isSketchMode,
        onOptimizeBlockedBySketch: () => addToast('warning', lt.exitSketchBeforeOptimize),
        onAfterSelect: () => setShowCommandPalette(false),
      }),
      ...buildPanelCommands(togglePanel as (k: string) => void),
    ],
    [togglePanel, lang, isSketchMode, addToast, lt],
  );

  const {
    sketchRefImage,
    setSketchRefImage,
    sketchRefInputRef,
    sketchRefImporting,
    handleSketchRefFileChange,
    clearSketchRef,
  } = useSketchReferenceUnderlay({
    sketchPlane: sketchPlane as 'xy' | 'xz' | 'yz',
    addToast,
    sketchRefBadFileType: lt.sketchRefBadFileType,
    maxReferencePixels: 768,
  });

  // Detect broken expression dependencies after a feature is removed.
  // If a param expression references a variable that no longer exists in scope,
  // notify the user so they can fix or accept the break.
  useEffect(() => {
    const currentExprs = useSceneStore.getState().paramExpressions;
    const currentParams = useSceneStore.getState().params;
    if (Object.keys(currentExprs).length === 0) return;
    const availableNames = [
      ...Object.keys(currentParams),
      ...modelVars.map(v => v.name),
    ];
    const broken = findBrokenExpressions(currentExprs, availableNames);
    const snapshot = broken.map(b => `${b.key}:${b.missing.join(',')}`).join('|');
    if (snapshot && snapshot !== lastBrokenSnapshotRef.current) {
      lastBrokenSnapshotRef.current = snapshot;
      const first = broken[0];
      addToast('warning', lt.brokenExpression(first.key, first.expression, first.missing.join(', '), broken.length - 1));
      // D4: auto-freeze broken expressions to their current numeric value so
      // the model keeps building. The user retains the literal (visible in
      // ExpressionInput) and can re-author a new formula at their leisure.
      // Replaces the previous behaviour of leaving "Diameter = Hole1.D * 2"
      // dangling forever after Hole1 was deleted.
      const { paramExpressions: frozenExprs, converted } = freezeBrokenExpressions(
        currentExprs,
        currentParams,
        availableNames,
      );
      if (converted.length > 0) {
        useSceneStore.getState().setParamExpressions(frozenExprs);
        addToast('info', lt.brokenExpressionFrozen(converted.length));
      }
    } else if (!snapshot) {
      lastBrokenSnapshotRef.current = '';
    }
  }, [features, modelVars, addToast, lang, lt]);

  // ── Feature param "=expression" support (SolidWorks-style) ────────────────
  // The raw expression lives in the node's `paramExpressions` sidecar; the
  // evaluated number stays in `params` (pipeline/coalescer untouched). See
  // equations/featureParamExpressions.ts for the engine + the deleted-variable
  // policy (keep last value + error badge — never silent NaN).

  /** Commit raw typed input ("=W/2", "12", "") for a feature param as ONE
   *  undoable command: expression assign/edit, expression clear (plain number
   *  or empty input), and the accompanying numeric write all restore together
   *  on undo. Mirrors the makeArrayUpdateCommand before/after-snapshot style. */
  const setFeatureParamExpressionCmd = useCallback((featureId: string, key: string, raw: string) => {
    const node = getOrderedNodesRef.current().find(n => n.id === featureId);
    if (!node) return;
    const parsed = parseParamInput(raw);

    const beforeParams = { ...node.params };
    const beforeExprs = node.paramExpressions ? { ...node.paramExpressions } : undefined;
    const afterParams = { ...node.params };
    let afterExprs: Record<string, string> | undefined =
      node.paramExpressions ? { ...node.paramExpressions } : undefined;

    if (parsed.kind === 'expression') {
      const scope = paramScopeFor(node, key, [
        ...Object.entries(useSceneStore.getState().params).map(([name, value]) => ({ name, value })),
        ...modelVarsRef.current.map(v => ({ name: v.name, value: v.value })),
      ]);
      const r = evaluateParamExpression(parsed.expression, scope);
      if (!r.ok) {
        addToast('warning', lang === 'ko'
          ? `수식 오류: ${r.error}`
          : `Invalid expression: ${r.error}`);
        return;
      }
      afterParams[key] = r.value;
      afterExprs = { ...(afterExprs ?? {}), [key]: parsed.expression };
    } else {
      // Plain number / empty input → clear the driving expression; a number
      // also writes the literal value (expression → frozen literal).
      if (afterExprs) {
        delete afterExprs[key];
        if (Object.keys(afterExprs).length === 0) afterExprs = undefined;
      }
      if (parsed.kind === 'number') afterParams[key] = parsed.value;
    }

    const paramKeys = new Set([...Object.keys(beforeParams), ...Object.keys(afterParams)]);
    const paramsChanged = Array.from(paramKeys).some(k => beforeParams[k] !== afterParams[k]);
    const exprsChanged = JSON.stringify(beforeExprs ?? {}) !== JSON.stringify(afterExprs ?? {});
    if (!paramsChanged && !exprsChanged) return; // no-op — skip empty undo step

    // Don't let a pending slider coalesce interleave with this command.
    featureParamCoalescer.flush();
    commandHistory.execute({
      id: `feature-param-expr-${featureId}-${Date.now()}`,
      label: 'Edit parameter expression',
      labelKo: '파라미터 수식 편집',
      // State does NOT yet hold `after` — execute() applies it (and re-applies
      // on redo); undo restores the full pre-edit param + expression snapshot.
      execute: () => updateNode(featureId, { params: { ...afterParams }, paramExpressions: afterExprs, error: undefined }),
      undo: () => updateNode(featureId, { params: { ...beforeParams }, paramExpressions: beforeExprs, error: undefined }),
    });
  }, [featureParamCoalescer, updateNode, addToast, lang]);

  // Re-evaluate expression-driven feature params whenever the variable scope
  // (global variables / base params) or the tree changes. Writes go through
  // the RAW param setter — the undo step belongs to the edit that moved the
  // variable. Failed evaluations keep the last value (error badge in the
  // FeatureParams dialog); non-converging sibling cycles freeze (no writes).
  useEffect(() => {
    const nodes = getOrderedNodesRef.current().filter(
      n => n.paramExpressions && Object.keys(n.paramExpressions).length > 0,
    );
    if (nodes.length === 0) return;
    const { updates, converged } = reevaluateFeatureParamExpressionsFixedPoint(nodes, featureExprScope);
    if (!converged) return;
    for (const u of updates) updateFeatureParam(u.featureId, u.key, u.value);
  }, [featureExprScope, features, updateFeatureParam]);

  // PropertyManager expression drafts: its ExpressionInput reports text on
  // every keystroke (onExpressionChange) but only commits a value on
  // Enter/blur (onParamChange). Keystrokes land in this ref; the commit
  // routes the final draft through setFeatureParamExpressionCmd so one
  // undo step covers the whole authoring burst.
  const pmExprDraftRef = useRef<Record<string, string>>({});

  // ── Global variables ↔ .nfab persistence (scene.globalVariables) ──────────
  const getGlobalVariables = useCallback((): NfabGlobalVariableV1[] =>
    modelVarsRef.current.map(v => ({ name: v.name, expression: v.expression })), []);
  const restoreGlobalVariables = useCallback((vars: NfabGlobalVariableV1[] | undefined) => {
    if (!vars || vars.length === 0) {
      setModelVars([]);
      return;
    }
    // Values are re-derived from the expressions (resolveModelVars is the
    // same resolver the panel uses — later vars can reference earlier ones).
    setModelVars(resolveModelVars(vars.map((v, i) => ({
      id: `mv-nfab-${i}-${v.name}`,
      name: v.name,
      expression: v.expression,
      value: 0,
    }))));
  }, []);

  // 스케치 평면 전환 래퍼: 진행 중인 프로파일이 있으면 사용자에게 알림.
  // 평면을 바꿔도 기존 2D 좌표는 유지되지만 새 평면에 투영되므로 혼란을 방지.
  const setSketchPlane = useCallback((plane: 'xy' | 'xz' | 'yz') => {
    const cur = useSceneStore.getState().sketchPlane;
    if (cur === plane) return;
    const hasProfile = useSceneStore.getState().sketchProfile.segments.length > 0;
    setSketchPlaneRaw(plane);
    if (hasProfile) {
      addToast('info', lt.sketchPlaneSwitched(plane.toUpperCase()));
    }
  }, [setSketchPlaneRaw, addToast, lt]);

  // #wf3: warn when switching to Optimize while sketch mode is active
  const handleSetActiveTab = useCallback((tab: 'design' | 'optimize') => {
    const r = applyCadWorkspace(tab === 'design' ? 'design' : 'optimize', { isSketchMode });
    if (!r.ok && r.reason === 'sketch') {
      addToast('warning', lt.exitSketchBeforeOptimize);
    }
  }, [isSketchMode, addToast, lt]);

  // ── WebGL detection ──
  const [webglSupported, setWebglSupported] = useState(true);
  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) setWebglSupported(false);
    } catch {
      setWebglSupported(false);
    }
  }, []);

  // ── Pipeline errors (set by result useMemo, consumed by FeatureTree + toast) ──
  const [pipelineErrors, setPipelineErrors] = useState<Record<string, string>>({});

  // True while a sample template is loading its features in bulk. Each add fires
  // its own pipeline eval, so a dependent feature (fillet) can transiently fail
  // against base geometry that hasn't computed yet — a spurious error toast even
  // though the final tree recomputes fine. Suppress the toasts during that window.
  const templateLoadingRef = useRef(false);

  // ── Feature validation error (e.g. param out of range) → toast ──
  useEffect(() => {
    const errorIds = Object.keys(featureErrors);
    if (errorIds.length > 0) {
      const lastErrorId = errorIds[errorIds.length - 1];
      const msg = featureErrors[lastErrorId];
      if (!templateLoadingRef.current) addToast('error', lt.cannotApplyFeature(msg));
      clearFeatureError(lastErrorId);
    }
  }, [featureErrors]);

  // ── Pipeline error → toast (diff-based: only fire on newly-appearing errors) ──
  const prevPipelineErrorsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const prev = prevPipelineErrorsRef.current;
    const newlyFailed: string[] = [];
    for (const [id, msg] of Object.entries(pipelineErrors)) {
      if (prev[id] !== msg) newlyFailed.push(id);
    }
    prevPipelineErrorsRef.current = pipelineErrors;
    if (newlyFailed.length === 0) return;
    if (templateLoadingRef.current) return; // suppress transient errors during bulk template load
    // Show a toast for the most recent failure only (rest are visible as red badges in tree)
    const id = newlyFailed[newlyFailed.length - 1];
    const raw = pipelineErrors[id];
    const node = featureHistory.nodes.find(n => n.id === id);
    const diag = classifyFeatureError(node?.featureType ?? 'sketchExtrude', raw, { nodeId: id });
    const label = node?.label ?? 'Feature';
    addToast('error', lt.featureFailed(label, lang === 'ko' ? diag.hintKo : diag.hintEn));
  }, [pipelineErrors]);

  // ── Auth modal ──
  // (showAuthModal, authModalMode moved to useShapeGeneratorUI)

  // ── Freemium gates (extracted hook) ──
  const {
    authUser,
    planLimits,
    showUpgradePrompt, setShowUpgradePrompt,
    upgradeFeature, setUpgradeFeature,
    promptUpgrade,
    requirePro,
    requirePhotoReal,
    checkCartLimit,
    triggerProjectLimitPrompt } = useFreemiumGate();
  useEffect(() => { authUserRef.current = authUser ?? null; }, [authUser]);

  // Lay-user AI front door → FREE NL→intent→render path (not the Pro agent).
  // Posts the natural-language prompt to the deterministic intent endpoint
  // (free plan, monthly-metered) and renders the resulting SCAD into the
  // viewport via the same apply path the agent uses. Quota/unsupported errors
  // surface as toasts (or the upgrade path) instead of a broken action.
  const handleFreeAiPrompt = useCallback(async (prompt: string) => {
    const p = prompt.trim();
    if (!p) return;
    addToast('info', lang === 'ko' ? 'AI가 모델을 만드는 중…' : 'AI is generating your model…');
    try {
      // When a mesh has been imported, edit it: send the current wrapping
      // program as previousScad so the AI modifies `import("model.stl"); …`
      // instead of generating a brand-new shape from scratch.
      const editingImport = !!importStlRef.current;
      const resp = await fetch('/api/nexyfab/scad-intent-from-nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(useAuthStore.getState().token ? { Authorization: `Bearer ${useAuthStore.getState().token}` } : {}) },
        body: JSON.stringify(
          editingImport
            ? { prompt: p, freeform: true, previousScad: importScadRef.current }
            : { prompt: p },
        ),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({} as Record<string, unknown>));
        const code = typeof body.code === 'string' ? body.code : '';
        if (resp.status === 429 || code === 'MONTHLY_LIMIT') { promptUpgrade('AI 생성'); return; }
        if (resp.status === 422 || code === 'UNSUPPORTED' || code === 'CONVERTER_REJECT') {
          addToast('error', (typeof body.reason === 'string' && body.reason) || (typeof body.error === 'string' && body.error) || 'AI가 이 요청을 지원 형상으로 표현하지 못했어요.');
          return;
        }
        addToast('error', (typeof body.error === 'string' && body.error) || 'AI 생성에 실패했어요.');
        return;
      }
      const body = await resp.json() as { scad?: string; summary?: string; usage?: { used: number; limit: number; remaining: number } };
      if (!body.scad) { addToast('error', 'AI 응답에 모델이 없어요.'); return; }
      // Chain edits: remember the updated program so the next prompt refines it.
      if (editingImport) importScadRef.current = body.scad;
      await handleApplyAgentScad(body.scad);
      if (body.summary) addToast('info', body.summary);
      // Soft-cap nudge: a gentle reminder as the generous free monthly
      // allowance runs low — never blocks generation (the hard cap's 429
      // upgrade prompt only fires once it's fully spent, well past the aha).
      const u = body.usage;
      if (u && u.limit > 0 && u.remaining <= 5) {
        const ko = lang === 'ko';
        addToast('info', u.remaining > 0
          ? (ko ? `이번 달 무료 AI 생성 ${u.remaining}회 남았어요 · 무제한은 Pro` : `${u.remaining} free AI generations left this month · upgrade for unlimited`)
          : (ko ? '이번 달 무료 AI 생성을 다 썼어요 · 무제한은 Pro' : 'Free AI generations used up this month · upgrade for unlimited'));
      }
    } catch (e) {
      addToast('error', `AI 생성 실패: ${(e as Error).message}`);
    }
  }, [addToast, promptUpgrade, handleApplyAgentScad, lang]);

  // ── Shell-v2 AiChatPanel "Apply" bridge (orphan CustomEvents fixed) ──
  // AiChatPanel dispatches 'nexyfab:apply-ai-intent' / 'nexyfab:apply-ai-pattern'
  // which previously had no listener (the Apply button did nothing).
  //  · intent  = an IntentInput ({ shapeId, params, features }) — run it through
  //    the deterministic intentToScad converter and render via the same
  //    handleApplyAgentScad path the SCAD agent panel uses.
  //  · pattern = a design-pattern library reference ({ id, title }) — resolve
  //    its seedPrompt and route through handleFreeAiPrompt, the same free
  //    NL→intent→render front door the legacy chat flow uses.
  useEffect(() => {
    const onApplyIntent = (e: Event) => {
      const intent = (e as CustomEvent<Record<string, unknown> | undefined>).detail;
      if (!intent || typeof intent !== 'object') {
        addToast('warning', lang === 'ko' ? '적용할 AI 의도가 없습니다.' : 'No AI intent to apply.');
        return;
      }
      void (async () => {
        try {
          const { intentToScad } = await import('@/lib/openscad-render/intentToScad');
          const result = intentToScad(intent as unknown as Parameters<typeof intentToScad>[0]);
          if (!result.ok) { addToast('error', result.reason); return; }
          await handleApplyAgentScad(result.scad);
        } catch (err) {
          addToast('error', `AI intent apply failed: ${(err as Error).message}`);
        }
      })();
    };
    const onApplyPattern = (e: Event) => {
      const detail = (e as CustomEvent<{ id?: string; title?: string } | undefined>).detail;
      if (!detail?.id) {
        addToast('warning', lang === 'ko' ? '적용할 디자인 패턴이 없습니다.' : 'No design pattern to apply.');
        return;
      }
      void (async () => {
        try {
          const { listPatterns } = await import('@/lib/ai/scad-agent/designPatternLibrary');
          const pattern = listPatterns().find(p => p.id === detail.id);
          if (!pattern) {
            addToast('warning', `Unknown design pattern: ${detail.id}`);
            return;
          }
          await handleFreeAiPrompt(pattern.seedPrompt);
        } catch (err) {
          addToast('error', `AI pattern apply failed: ${(err as Error).message}`);
        }
      })();
    };
    window.addEventListener('nexyfab:apply-ai-intent', onApplyIntent);
    window.addEventListener('nexyfab:apply-ai-pattern', onApplyPattern);
    return () => {
      window.removeEventListener('nexyfab:apply-ai-intent', onApplyIntent);
      window.removeEventListener('nexyfab:apply-ai-pattern', onApplyPattern);
    };
  }, [handleApplyAgentScad, handleFreeAiPrompt, addToast, lang]);

  // ── Ctrl+\ split-screen toggle ──
  // Cycle splitMode: off → side-notes → side-spec → off. Skip when an input
  // is focused so the keystroke doesn't fight typing.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== '\\') return;
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      useSceneStore.getState().toggleSplitMode();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Esc clears in-flight mate selection (Phase F click-to-mate UX) ──
  // When the user has armed mate mode (mateFaceA set) or has the picker
  // overlay open (pendingMate set) Escape bails out of the workflow.
  // Skipped while an input is focused so dialog text editing isn't hijacked.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const tag = (document.activeElement?.tagName ?? '').toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable) return;
      const st = useSelectionStore.getState();
      if (!st.mateFaceA && !st.pendingMate) return;
      st.setMateFaceA(null);
      st.setPendingMate(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Demo signup request — open auth modal in signup mode ──
  // useNfabFileIO dispatches this when an unsigned user tries to cloud-save.
  // We open the auth modal; the pending-intent stash is set in the hook,
  // and the resume effect below picks it up after signup completes.
  useEffect(() => {
    const onRequest = () => {
      setAuthModalMode('signup');
      setShowAuthModal(true);
    };
    window.addEventListener('nexyfab:request-signup', onRequest);
    return () => window.removeEventListener('nexyfab:request-signup', onRequest);
  }, [setAuthModalMode, setShowAuthModal]);

  // ── Pending intent resume after upgrade or signup ──
  // 결제 후 돌아온 사용자 OR 데모→가입 사용자: stash해둔 cloud-save 의도를 한 번만
  // 자동 재시도. Round 28 부터 plan==='free' 도 허용 (서버가 FREE_PROJECT_LIMIT 으로
  // 알아서 게이트하므로 — 한도 초과면 paywall이 또 뜸, 정상 플로우).
  useEffect(() => {
    if (!authUser?.id) return;
    void import('@/lib/pending-intents').then(({ readPendingIntent, clearPendingIntent }) => {
      const intent = readPendingIntent();
      if (!intent) return;
      // Round 31: route by kind so each Pro-gated surface resumes correctly.
      // For non-cloud-save kinds we don't auto-execute (some are too
      // destructive/visible), but we surface a "you can run this now" toast
      // so the user knows their original click is still actionable.
      if (intent.kind !== 'cloud_save_project') {
        clearPendingIntent();
        const messages: Record<string, string> = {
          run_dfm_analysis:   lang === 'ko' ? 'DFM 분석을 다시 실행하실 수 있습니다.' : 'You can now run DFM analysis.',
          run_fea_analysis:   lang === 'ko' ? 'FEA 해석을 다시 실행하실 수 있습니다.' : 'You can now run FEA analysis.',
          export_format:      lang === 'ko' ? '내보내기를 다시 시도해주세요.' : 'You can now retry the export.',
          request_quote:      lang === 'ko' ? '견적 요청을 다시 시도해주세요.' : 'You can now request a quote.',
          create_share_link:  lang === 'ko' ? '보호된 공유 링크를 다시 생성하실 수 있습니다.' : 'You can now create the protected share link.',
        };
        const msg = messages[intent.kind];
        if (msg) addToast?.('success', msg);
        return;
      }
      clearPendingIntent();
      addToast?.('info', lang === 'ko' ? '업그레이드 완료 — 진행 중이던 저장을 재시도합니다.' : 'Upgrade complete — resuming your pending save.');
      // syncNow는 useCloudSaveFlow에서 export. 직접 호출은 불가능하므로
      // autosave가 다음 사이클에 자연 발사되도록 dirty flag만 살짝 흔든다.
      try {
        const k = '__nexyfab_resume_save_done';
        const w = window as unknown as Record<string, unknown>;
        if (!w[k]) {
          w[k] = true;
          // Dispatch a custom event picked up by the autosave watcher in
          // useSceneAutoSaveWatchers — flushes immediately without debounce.
          window.dispatchEvent(new CustomEvent('nexyfab:resume-cloud-save'));
        }
      } catch { /* ignore */ }
    });
  }, [authUser?.id, authUser?.plan, addToast, lang]);

  // ── Onboarding funnel: first_shape_created ──
  // selectedId가 처음으로 truthy해지는 순간 기록. setSelectedId 호출 지점이
  // 매우 분산돼 있어 effect 단일 watcher가 가장 robust한 wiring.
  useEffect(() => {
    if (!authUser?.id || !selectedId) return;
    const key = `nexyfab.funnel.firstShapeCreated.${authUser.id}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch { return; }
    void fetch('/api/nexyfab/funnel-event', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'first_shape_created',
        contextType: 'shape',
        contextId: selectedId,
      }),
    }).then(r => {
      if (r.ok) try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
    }).catch(() => { /* swallow */ });
  }, [authUser?.id, selectedId]);

  // ── Onboarding funnel: shape_generator_first_open ──
  // 로그인된 사용자가 처음 3D 툴 페이지에 들어왔을 때 한 번만 발사. localStorage
  // 키로 dedupe — 서버측 unique-user 집계도 첫 이벤트만 카운트되므로 클라이언트
  // 중복은 그래프 모양에는 영향 없지만 DB row 절약 차원.
  useEffect(() => {
    if (!authUser?.id) return;
    const key = `nexyfab.funnel.shapeGenFirstOpen.${authUser.id}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch { /* localStorage unavailable — fall through */ }
    void fetch('/api/nexyfab/funnel-event', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType: 'shape_generator_first_open' }),
    }).then(r => {
      if (r.ok) {
        try { localStorage.setItem(key, String(Date.now())); } catch { /* ignore */ }
      }
    }).catch(() => { /* funnel write must not block UX */ });
  }, [authUser?.id]);

  // ── CAM G-code freemium gate ──
  const { check: checkFreemium, isPro: isProPlan } = useFreemium();
  // ── Collaboration polling (Team+ plan only) ──
  const currentProjectId = useProjectsStore(s => s.projects[0]?.id ?? null);
  const { sessions: pollingSessions, mySessionId } = useCollabPolling(currentProjectId, planLimits.collaboration);

  // ── Collaboration read-only upsell (free users): surface the Pro prompt
  // the first time a real (non-demo) session becomes active. `collabEditUpsellShownRef`
  // keeps it once per page mount so the user isn't spammed across reconnects. ──
  const collabEditUpsellShownRef = useRef(false);
  // Pre-export optimization upsell: free users see the prompt the first time they
  // export a heavy format in a session. Pro users skip it silently.
  const exportOptimizeUpsellShownRef = useRef(false);

  // ── Cloud projects ──
  const saveProject = useProjectsStore(s => s.saveProject);
  const updateProject = useProjectsStore(s => s.updateProject);

  // ── CAM Simulation ──
  const [camSimResult, setCamSimResult] = useState<{ result: import('./analysis/camLite').CAMResult; operation: import('./analysis/camLite').CAMOperation } | null>(null);

  // ── Generative Design / ECAD overlays (visualization layers, not panels) ──
  const {
    genDesignResult, setGenDesignResult,
    showGenOverlay, setShowGenOverlay,
    thermalOverlayGeo, setThermalOverlayGeo,
    showThermalOverlay, setShowThermalOverlay,
  } = useViewportOverlays();

  // ── Analysis modal panels (centralised in useUIStore for closeAllPanels / simpleMode) ──
  const showCOTSPanel        = useUIStore(s => s.showCOTSPanel);
  const setShowCOTSPanel     = useUIStore(s => s.setShowCOTSPanel);
  const _showCamUpgrade       = useUIStore(s => s.showCamUpgrade);
  const setShowCamUpgrade    = useUIStore(s => s.setShowCamUpgrade);
  const _showDFMFixUpgrade    = useUIStore(s => s.showDFMFixUpgrade);
  const setShowDFMFixUpgrade = useUIStore(s => s.setShowDFMFixUpgrade);
  const _showDFMInsightsUpgrade    = useUIStore(s => s.showDFMInsightsUpgrade);
  const setShowDFMInsightsUpgrade = useUIStore(s => s.setShowDFMInsightsUpgrade);
  const showProcessRouter         = useUIStore(s => s.showProcessRouter);
  const setShowProcessRouter      = useUIStore(s => s.setShowProcessRouter);
  const _showProcessRouterUpgrade    = useUIStore(s => s.showProcessRouterUpgrade);
  const setShowProcessRouterUpgrade = useUIStore(s => s.setShowProcessRouterUpgrade);
  const showAISupplierMatch         = useUIStore(s => s.showAISupplierMatch);
  const setShowAISupplierMatch      = useUIStore(s => s.setShowAISupplierMatch);
  const _showAISupplierMatchUpgrade    = useUIStore(s => s.showAISupplierMatchUpgrade);
  const setShowAISupplierMatchUpgrade = useUIStore(s => s.setShowAISupplierMatchUpgrade);
  const showCostCopilot             = useUIStore(s => s.showCostCopilot);
  const setShowCostCopilot          = useUIStore(s => s.setShowCostCopilot);
  const _showCostCopilotUpgrade      = useUIStore(s => s.showCostCopilotUpgrade);
  const setShowCostCopilotUpgrade   = useUIStore(s => s.setShowCostCopilotUpgrade);
  const showAIHistory               = useUIStore(s => s.showAIHistory);
  const setShowAIHistory            = useUIStore(s => s.setShowAIHistory);
  const showOpenScad                = useUIStore(s => s.showOpenScad);
  // F5 — Configuration Table panel
  const showConfigurationTable      = useUIStore(s => s.showConfigurationTable);
  const setShowConfigurationTable   = useUIStore(s => s.setShowConfigurationTable);
  // F7 / F9 / F1 — DRC, PLM, sketch text panels
  const showDrcPanel                = useUIStore(s => s.showDrcPanel);
  const setShowDrcPanel             = useUIStore(s => s.setShowDrcPanel);
  const showPlmConfig               = useUIStore(s => s.showPlmConfig);
  const setShowPlmConfig            = useUIStore(s => s.setShowPlmConfig);
  const showSketchText              = useUIStore(s => s.showSketchText);
  const setShowSketchText           = useUIStore(s => s.setShowSketchText);
  // K6 — Smart Fastener panel
  const showSmartFastener           = useUIStore(s => s.showSmartFastener);
  const setShowSmartFastener        = useUIStore(s => s.setShowSmartFastener);
  const setShowOpenScad             = useUIStore(s => s.setShowOpenScad);
  // ── Face/edge selection — Step 1 of MainWorkspace decomposition.
  // Backing store is useSelectionStore so future canvas extractions don't
  // have to thread these as props. Locals alias the store fields so the
  // 40+ existing read/write sites compile unchanged.
  const selectedElement   = useSelectionStore(s => s.selectedElement);
  const setSelectedElement = useSelectionStore(s => s.setSelectedElement);
  const mateFaceA          = useSelectionStore(s => s.mateFaceA);
  const setMateFaceA       = useSelectionStore(s => s.setMateFaceA);
  // Phase F (click-to-mate UX): pending pair surfaces the MatePickerOverlay.
  // Owned by the selection store so the canvas, the overlay, and the host
  // share a single source of truth.
  const pendingMate        = useSelectionStore(s => s.pendingMate);
  const [selectionActive, setSelectionActive] = React.useState(false);
  // ── Idea-to-Design Intake Wizard (L1→L5 composition) ──
  const [showIntakeWizard, setShowIntakeWizard] = React.useState(false);
  const [composing, setComposing] = React.useState(false);
  const [composeSpec, setComposeSpec] = React.useState<IntakeSpec | null>(null);
  const [composeResult, setComposeResult] = React.useState<ComposeResponse | null>(null);

  // compose API 호출 (최초 + swap 재호출 공용)
  const runCompose = React.useCallback(
    async (spec: IntakeSpec, force?: { partId?: string; methodId?: string; materialId?: string }) => {
      setComposing(true);
      try {
        const res = await fetch('/api/nexyfab/compose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spec, force }) });
        const data = await res.json();
        if (!res.ok) {
          alert(lt.designFailed(String(data.error ?? res.status)));
          return null;
        }
        return data as ComposeResponse;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        alert(lt.networkError(msg));
        return null;
      } finally {
        setComposing(false);
      }
    },
    [lt]
  );
  const clearMeshSelection = useCallback(() => {
    setSelectedElement(null);
    setSelectionActive(false);
  }, []);

  /** One primary viewport click-mode at a time — measure vs face selection conflict otherwise. */
  const toggleMeasureMode = useCallback(() => {
    setMeasureActive(prev => {
      const next = !prev;
      if (next) {
        setSelectionActive(false);
        setSelectedElement(null);
      }
      return next;
    });
  }, [setMeasureActive]);

  const toggleFaceSelectionMode = useCallback(() => {
    setSelectionActive(prev => {
      const next = !prev;
      if (prev) {
        setSelectedElement(null);
        // Turning the toolbar "Face Select" toggle OFF → drop back to body
        // (editMode 'none'), which unmounts FaceScene. Without this the top
        // selection-filter chip would stay stuck on "면".
        setEditMode('none');
      } else {
        setMeasureActive(false);
        // Turning it ON must actually enter face-edit mode. FaceScene (real
        // face picking + Push/Pull) only mounts when editMode === 'face'
        // (ShapePreview), so the prominent "면 선택 ON" toggle and the top
        // selection-filter chip were previously disconnected — toggling the
        // toolbar did nothing on click. Sync them here. (2026-06-10 fix)
        setEditMode('face');
      }
      return next;
    });
  }, [setMeasureActive, setEditMode]);

  // Keep the toolbar "Face Select" toggle (selectionActive) in sync with the
  // top selection-filter chips: picking 면/엣지/정점 directly (editMode !==
  // 'none') reflects as ON; switching back to 바디 turns it OFF. Without this
  // the two controls drift apart and the toolbar lies about the current mode.
  useEffect(() => {
    setSelectionActive(editMode !== 'none');
  }, [editMode]);
  // ── AI pipeline chain: Process Router → Supplier Matcher pre-fill ──

  const [chainedSupplierProcess, setChainedSupplierProcess] = React.useState<string | undefined>(undefined);
  const _showCollabEditUpgrade    = useUIStore(s => s.showCollabEditUpgrade);
  const setShowCollabEditUpgrade = useUIStore(s => s.setShowCollabEditUpgrade);
  const _showExportOptimizeUpgrade    = useUIStore(s => s.showExportOptimizeUpgrade);
  const setShowExportOptimizeUpgrade = useUIStore(s => s.setShowExportOptimizeUpgrade);

  // Pro upsell: free users joining a real collab session get a one-time read-only notice.
  // Demo mode is free for everyone, so only fire when connected to a real session without Pro.
  // bm-matrix §1.2 #17: Stage D+ 는 협업 편집 해금 — Pro 업셀 생략.
  const collabEditStageOk = userMeetsBmMatrixFeatureStage((authUser?.nexyfabStage ?? 'A') as Stage, 17);
  useEffect(() => {
    if (collabEditUpsellShownRef.current) return;
    if (!collabConnected || collabDemo) return;
    if (isProPlan || collabEditStageOk) return;
    collabEditUpsellShownRef.current = true;
    setShowCollabEditUpgrade(true);
  }, [collabConnected, collabDemo, isProPlan, collabEditStageOk, setShowCollabEditUpgrade]);
  const showGenDesign        = useUIStore(s => s.showGenDesign);
  const setShowGenDesign     = useUIStore(s => s.setShowGenDesign);
  const showECADPanel        = useUIStore(s => s.showECADPanel);
  const setShowECADPanel     = useUIStore(s => s.setShowECADPanel);
  const showThermalPanel     = useUIStore(s => s.showThermalPanel);
  const setShowThermalPanel  = useUIStore(s => s.setShowThermalPanel);
  const showMotionStudy      = useUIStore(s => s.showMotionStudy);
  const setShowMotionStudy   = useUIStore(s => s.setShowMotionStudy);
  // Motion playback transforms: updated by MotionStudyPanel's onFrameUpdate callback
  const [motionPartTransforms, setMotionPartTransforms] = useState<Record<string, import('three').Matrix4> | null>(null);
  const showModalAnalysis    = useUIStore(s => s.showModalAnalysis);
  const setShowModalAnalysis = useUIStore(s => s.setShowModalAnalysis);
  const showBucklingAnalysis = useUIStore(s => s.showBucklingAnalysis);
  const setShowBucklingAnalysis = useUIStore(s => s.setShowBucklingAnalysis);
  const showParametricSweep  = useUIStore(s => s.showParametricSweep);
  const setShowParametricSweep = useUIStore(s => s.setShowParametricSweep);
  const showToleranceStackup = useUIStore(s => s.showToleranceStackup);
  const setShowToleranceStackup = useUIStore(s => s.setShowToleranceStackup);
  const showSurfaceQuality   = useUIStore(s => s.showSurfaceQuality);
  const setShowSurfaceQuality = useUIStore(s => s.setShowSurfaceQuality);
  const showAutoDrawing      = useUIStore(s => s.showAutoDrawing);
  const setShowAutoDrawing   = useUIStore(s => s.setShowAutoDrawing);
  const showMfgPipeline      = useUIStore(s => s.showMfgPipeline);
  const setShowMfgPipeline   = useUIStore(s => s.setShowMfgPipeline);

  const baseScadDockInsetPx = useMemo(
    () =>
      !isMobile && !simpleMode && scadAuthoringMode === 'agent'
        ? SCAD_AGENT_DOCK_INSET_PX
        : 0,
    [isMobile, simpleMode, scadAuthoringMode],
  );

  const col1RightInset = useMemo(
    () =>
      buildCol1RightInset(baseScadDockInsetPx, [
        { id: 'gen', active: showGenDesign },
        { id: 'motion', active: showMotionStudy },
        { id: 'modal', active: showModalAnalysis },
        { id: 'buckling', active: showBucklingAnalysis },
        { id: 'tol', active: showToleranceStackup },
        { id: 'surf', active: showSurfaceQuality },
        { id: 'mfgpipe', active: showMfgPipeline },
        { id: 'cam', active: !!(showCAMSimPanel && camSimResult) },
        { id: 'mold', active: showMoldDesignPanel },
        { id: 'rfq', active: showRfqPanel },
        { id: 'sweep', active: showParametricSweep },
        { id: 'draw', active: showAutoDrawing },
        { id: 'copilot', active: showCopilot },
      ]),
    [
      baseScadDockInsetPx,
      showGenDesign,
      showMotionStudy,
      showModalAnalysis,
      showBucklingAnalysis,
      showToleranceStackup,
      showSurfaceQuality,
      showMfgPipeline,
      showCAMSimPanel,
      camSimResult,
      showMoldDesignPanel,
      showRfqPanel,
      showParametricSweep,
      showAutoDrawing,
      showCopilot,
    ],
  );

  const showVersionDiff      = useUIStore(s => s.showVersionDiff);
  const setShowVersionDiff   = useUIStore(s => s.setShowVersionDiff);
  const [diffGeometries, _setDiffGeometries] = useState<{ a: BufferGeometry; b: BufferGeometry; labelA: string; labelB: string } | null>(null);

  // ── AI Advisor + Manufacturer Match + Manufacturing card (extracted later via useManufacturingFlow) ──

  // ── Plugin system ──
  const showPluginManager = useUIStore(s => s.showPluginManager);
  const setShowPluginManager = useUIStore(s => s.setShowPluginManager);
  // ── Script panel ──
  const showScriptPanel = useUIStore(s => s.showScriptPanel);
  const setShowScriptPanel = useUIStore(s => s.setShowScriptPanel);
  // ── Share link trigger key (incrementing opens ShareButton) ──
  const shareOpenKey = useUIStore(s => s.shareOpenKey);
  const setShareOpenKey = useUIStore(s => s.setShareOpenKey);
  // ── Sheet metal panel ──
  const showSheetMetalPanel = useUIStore(s => s.showSheetMetalPanel);
  const setShowSheetMetalPanel = useUIStore(s => s.setShowSheetMetalPanel);
  // ── Cost estimation panel ──
  const showCostPanel = useUIStore(s => s.showCostPanel);
  const setShowCostPanel = useUIStore(s => s.setShowCostPanel);
  // ── Array/Pattern panel ──
  const showArrayPanel = useUIStore(s => s.showArrayPanel);
  const _setShowArrayPanel = useUIStore(s => s.setShowArrayPanel);
  const arrayPattern = useSceneStore(s => s.arrayPattern);
  const setArrayPattern = useSceneStore(s => s.setArrayPattern);

  // ══════════════════════════════════════════════════════════════════════════
  // TOPOLOGY OPTIMIZATION STATE (extracted hook)
  // ══════════════════════════════════════════════════════════════════════════

  const {
    dimX, setDimX, dimY, setDimY, dimZ, setDimZ,
    materialKey, setMaterialKey,
    fixedFaces, setFixedFaces,
    loads, setLoads,
    volfrac, setVolfrac,
    resolution, setResolution,
    penal, setPenal,
    rmin, setRmin,
    maxIter, setMaxIter,
    selectionMode, setSelectionMode,
    isOptimizing, setIsOptimizing: _setIsOptimizing,
    progress, setProgress,
    optResult, setOptResult,
    resultMesh, setResultMesh,
    activeLoadForce, setActiveLoadForce,
    useCustomDomain, setUseCustomDomain,
    customDomainGeometry, setCustomDomainGeometry,
    handleGenerate } = useOptimizationState(addToast);

  // ═══ AUTO-SAVE & RECOVERY ═══
  const { hasRecovery, recoveryData, recoveredFromCrash, saveError, lastSavedAt, isSaving, save: autoSave, scheduleSave, dismissRecovery } = useAutoSave();
  const {
    cloudStatus,
    cloudSavedAt,
    cloudError,
    versionConflictNeedsReload,
    reloadToFetchServerProject,
    projectId: cloudProjectId,
    projectLimitReached,
    clearProjectLimitReached,
    scheduleSync: scheduleCloudSync,
    syncNow: _syncCloudNow,
    adoptProjectId,
  } = useCloudSaveFlow(!!authUser);

  // When server rejects new project creation due to free-plan limit, surface
  // the upgrade prompt instead of letting it fall through as a generic error.
  useEffect(() => {
    if (projectLimitReached) {
      triggerProjectLimitPrompt();
      clearProjectLimitReached();
    }
  }, [projectLimitReached, triggerProjectLimitPrompt, clearProjectLimitReached]);
  const pdmPartNumber = usePdmProjectMetaStore(s => s.partNumber);
  const drawingTitlePartName = useMemo(() => {
    const shapeLabel =
      (shapeLabels[`shapeName_${selectedId}`] as string | undefined) || selectedId;
    return getDrawingTitlePartName({
      partNumber: pdmPartNumber,
      shapeLabel: typeof shapeLabel === 'string' ? shapeLabel : String(selectedId),
      cloudProjectId,
    });
  }, [shapeLabels, selectedId, pdmPartNumber, cloudProjectId]);
  // ── Pin Comments (depends on cloudProjectId from useCloudSaveFlow) ──
  const {
    comments, isPlacingComment, setIsPlacingComment, focusedCommentId, setFocusedCommentId,
    addComment, resolveComment, deleteComment, reactToComment, addReply,
    applyRemoteCommentAdd: pinApplyRemoteAdd,
    applyRemoteCommentResolve: pinApplyRemoteResolve,
    applyRemoteCommentDelete: pinApplyRemoteDelete,
    applyRemoteCommentReact: pinApplyRemoteReact,
    applyRemoteCommentReply: pinApplyRemoteReply } = usePinComments({
    projectId: cloudProjectId,
    collabSend: {
      commentAdd: collabSendCommentAdd,
      commentResolve: collabSendCommentResolve,
      commentDelete: collabSendCommentDelete,
      commentReact: collabSendCommentReact,
      commentReply: collabSendCommentReply } });
  // Wire forward refs for collab → pinComments
  useEffect(() => { pinApplyRemoteAddRef.current = pinApplyRemoteAdd; }, [pinApplyRemoteAdd]);
  useEffect(() => { pinApplyRemoteResolveRef.current = pinApplyRemoteResolve; }, [pinApplyRemoteResolve]);
  useEffect(() => { pinApplyRemoteDeleteRef.current = pinApplyRemoteDelete; }, [pinApplyRemoteDelete]);
  useEffect(() => { pinApplyRemoteReactRef.current = pinApplyRemoteReact; }, [pinApplyRemoteReact]);
  useEffect(() => { pinApplyRemoteReplyRef.current = pinApplyRemoteReply; }, [pinApplyRemoteReply]);
  // (showCommentsPanel moved to useShapeGeneratorUI)
  const showRecovery = useUIStore(s => s.showRecovery);
  const setShowRecovery = useUIStore(s => s.setShowRecovery);
  useEffect(() => { if (hasRecovery && recoveryData) setShowRecovery(true); }, [hasRecovery, recoveryData]);
  // E2: visual diff modal for recovery — opt-in via "Compare" button.
  const [showRecoveryCompare, setShowRecoveryCompare] = useState(false);
  // ── Memoised feature serialisations (shared across auto-save, version, designContext) ──
  const featuresToSerialize = useMemo(
    () => features.map(f => ({ type: f.type, params: { ...f.params }, enabled: f.enabled })),
    [features],
  );
  const enabledFeaturesForContext = useMemo(
    () => features.filter(f => f.enabled).map(f => ({ type: f.type, params: { ...f.params } })),
    [features],
  );
  const aiModelRevision = useMemo(() => modelContentRevision({
    shapeId: selectedId,
    params,
    features: features.map(f => ({ id: f.id, type: f.type, params: f.params, enabled: f.enabled })),
    sketch: { segments: sketchProfile.segments, closed: sketchProfile.closed },
  }), [selectedId, params, features, sketchProfile.segments, sketchProfile.closed]);
  // ── 채팅 히스토리 (저장/복원용) ──────────────────────────────────────────
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const buildAutoSaveState = useCallback((): AutoSaveState => ({
    version: 1,
    timestamp: Date.now(),
    selectedId,
    params,
    features: featuresToSerialize,
    isSketchMode,
    sketchProfile: sketchProfile.segments.length > 0 ? { segments: sketchProfile.segments, closed: sketchProfile.closed } : undefined,
    sketchConfig,
    activeTab,
    cadWorkspace,
    renderMode,
    chatHistory: chatHistory.length > 0 ? chatHistory : undefined,
    assemblyOverrides:
      assemblyHiddenParts.size > 0 || assemblyTransparentParts.size > 0 || Object.keys(assemblyPartColors).length > 0
        ? {
            hiddenParts: Array.from(assemblyHiddenParts),
            transparentParts: Array.from(assemblyTransparentParts),
            partColors: { ...assemblyPartColors },
          }
        : undefined,
  }), [selectedId, params, featuresToSerialize, isSketchMode, sketchProfile, sketchConfig, activeTab, cadWorkspace, renderMode, chatHistory, assemblyHiddenParts, assemblyTransparentParts, assemblyPartColors]);
  useEffect(() => { if (saveError) addToast('warning', saveError); }, [saveError, addToast]);
  useEffect(() => { if (cloudError) addToast('warning', `☁ ${cloudError}`); }, [cloudError, addToast]);

  // ═══ .nfab NATIVE PROJECT FORMAT (save/load) + Manufacturing Route ═══
  const {
    desktopFilePath,
    desktopDirty,
    getCloudSceneObject,
    handleSaveNfab,
    handleSaveNfabCloud,
    handleLoadNfab,
    handleOpenRecentFile,
    applyLoadedNfabProject,
    syncCloudNfabProjectId,
    markDirty: markNfabDirty,
    resetFile: resetNfabFile,
    mfgCamPost, setMfgCamPost   } = useNfabFileIO({
    featureHistory,
    replaceHistory,
    saveProject,
    updateProject,
    addToast,
    lang,
    getAssemblySnapshot,
    restoreAssemblySnapshot,
    getStudioViewSnapshot,
    restoreStudioViewSnapshot,
    getConfigurationsBlock,
    restoreConfigurationsSnapshot,
    getGlobalVariables,
    restoreGlobalVariables,
  });

  // Global variable edits dirty the .nfab (they persist in scene.globalVariables).
  // Skip the mount pass — an unchanged project must not start dirty.
  const modelVarsDirtySkipRef = useRef(true);
  useEffect(() => {
    if (modelVarsDirtySkipRef.current) {
      modelVarsDirtySkipRef.current = false;
      return;
    }
    markNfabDirty();
  }, [modelVars, markNfabDirty]);

  // Wire scene → autosave + .nfab dirty (debounced + transition triggers)
  useSceneAutoSaveWatchers({
    viewMode,
    selectedId,
    params,
    features,
    isSketchMode,
    sketchProfile,
    sketchConfig,
    placedParts,
    assemblyMates,
    bodies,
    explodeFactor,
    sketchViewMode,
    ribbonTheme,
    sectionActive,
    sectionAxis,
    sectionOffset,
    sketchPalSlice,
    sketchSlicePlaneMm,
    multiView,
    viewportCameraPersisted,
    configurationsSig,
    cadWorkspace,
    renderMode,
    scheduleSave,
    autoSave,
    buildAutoSaveState,
    markNfabDirty,
    assemblyHiddenParts,
    assemblyTransparentParts,
    assemblyPartColors,
  });

  // Wire localStorage autosave → cloud sync (when logged in)
  useEffect(() => {
    if (viewMode !== 'workspace' || !authUser) return;
    // Pass the latest viewport thumbnail so the dashboard shows a real
    // preview instead of a placeholder. captureRef may not yet be wired on
    // initial mount — that's fine, the next save attempt will catch it.
    const thumb = captureRef.current ? captureRef.current() : null;
    // Persist the FULL .nfab payload to the cloud (assembly / configurations /
    // studio-view / feature history included), falling back to the lossy
    // AutoSaveState only before the feature history is ready on first mount.
    // This makes useCloudSaveFlow the single full-fidelity cloud writer — the
    // old path sent AutoSaveState, which dropped assembly/configs and got
    // clobbered against the .nfab tick. (2026-06-09 dual-writer unification.)
    const cloudScene = getCloudSceneObject() ?? buildAutoSaveState();
    scheduleCloudSync(cloudScene, selectedId ?? '', materialId, thumb);
    // 2026-06-09 dual-writer regression: when the 3-min .nfab tick was retired
    // this effect became the ONLY cloud writer, but its deps still covered just
    // the lossy AutoSaveState fields. Assembly / multi-body / configuration /
    // sketch edits — which getCloudSceneObject() serializes and the old tick
    // caught via cloudDirtyRef — never re-ran the effect, so those changes were
    // silently dropped from cloud autosave. Track them explicitly here.
  }, [selectedId, params, features, isSketchMode, materialId, viewMode, authUser, cadWorkspace, renderMode,
      placedParts, assemblyMates, bodies, configurationsSig, sketchProfile, sketchConfig, modelVars]);

  // Guest save nudge: a logged-out user's work lives only in THIS browser
  // (localStorage autosave — no cloud sync). Once they've built something real,
  // point them to sign-in / .nfab export so a cleared browser or device switch
  // doesn't silently lose it. Fires once per browser. (2026-06-09 storage
  // robustness.)
  const guestSaveHintShownRef = useRef(false);
  useEffect(() => {
    if (authUser || guestSaveHintShownRef.current) return;
    if (viewMode !== 'workspace' || !desktopDirty || features.length === 0) return;
    guestSaveHintShownRef.current = true;
    try {
      if (window.localStorage.getItem('nexyfab_guest_save_hint_v1') === '1') return;
      window.localStorage.setItem('nexyfab_guest_save_hint_v1', '1');
    } catch { /* ignore */ }
    addToast('info', lang === 'ko'
      ? '게스트 작업은 이 브라우저에만 저장됩니다. 로그인하면 클라우드에 안전하게 저장되고, File → .nfab로 파일 내보내기도 됩니다.'
      : 'Guest work is saved only in this browser. Sign in to save to the cloud, or export a file via File → .nfab.');
  }, [authUser, viewMode, desktopDirty, features.length, addToast, lang]);


  // 스케치 모드 진입/이탈 시 3D 편집 모드는 항상 'none'으로 리셋.
  // 기존에는 setIsSketchMode 호출부마다 setEditMode('none')을 수동으로 붙였으나
  // 누락되는 경로가 있어 단일 지점에서 강제.
  useEffect(() => {
    if (editMode !== 'none') setEditMode('none');
    if (isSketchMode) setSketchStep('draw'); // 스케치 진입 시 항상 draw 단계로 리셋
  }, [isSketchMode]);

  // 프로파일 닫힘 감지 — 새 2단계 UX에서는 자동팝업 없이 SketchPanel 버튼으로 처리
  const activeProfile = sketchProfiles[activeProfileIdx] ?? sketchProfile;
  useEffect(() => {
    // showSketchActionMenu는 더 이상 자동 트리거하지 않음 (SketchPanel의 "3D 변환 설정 →" 버튼 사용)
    if (!activeProfile.closed) {
      setShowSketchActionMenu(false);
    }
  }, [activeProfile.closed]);
  // Dirty-gated unload guard. Previously this fired the browser "Leave site?"
  // dialog on EVERY refresh/close while in the workspace, even with zero unsaved
  // edits — so users learned to dismiss it reflexively (cry-wolf). Now it only
  // prompts when there are actual unsaved changes (.nfab dirty flag or a save in
  // flight). A ref holds the latest dirty value so the listener isn't re-bound on
  // every keystroke. (2026-06-09 UX cleanup.)
  const unloadDirtyRef = useRef(false);
  unloadDirtyRef.current = desktopDirty || isSaving;
  useEffect(() => {
    if (viewMode !== 'workspace') return;
    const h = (e: BeforeUnloadEvent) => {
      if (!unloadDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [viewMode]);
  const handleRestoreRecovery = useCallback(() => {
    if (!recoveryData) return;
    setSelectedId(recoveryData.selectedId);
    applySceneParamsToSetters(SHAPE_MAP[recoveryData.selectedId], recoveryData.params, {
      setParams,
      setParamExpressions,
    });
    setIsSketchMode(recoveryData.isSketchMode);
    if (recoveryData.sketchProfile) setSketchProfile(recoveryData.sketchProfile as SketchProfile);
    if (recoveryData.sketchConfig) setSketchConfig(recoveryData.sketchConfig as SketchConfig);
    clearAll();
    if (recoveryData.features.length > 0) {
      setTimeout(() => {
        // Re-add each feature with its SAVED params + enabled flag. Previously
        // only f.type was restored (addFeature), so every recovered feature
        // came back with default params. Saved params are merged onto the
        // definition defaults so keys added to a feature after the save still
        // get a value; addNode returns the new node id, letting the enabled
        // flag apply without a deferred tree lookup.
        recoveryData.features.forEach(f => {
          const def = getFeatureDefinition(f.type as FeatureType);
          if (!def) return;
          const params: Record<string, number> = {};
          def.params.forEach(p => { params[p.key] = p.default; });
          Object.assign(params, f.params);
          const nodeId = addNode('feature', undefined, def.icon, params, f.type as FeatureType);
          if (f.enabled === false) updateNode(nodeId, { enabled: false });
        });
      }, 50);
    }
    const ws =
      recoveryData.cadWorkspace && isCadWorkspaceId(recoveryData.cadWorkspace)
        ? recoveryData.cadWorkspace
        : recoveryData.activeTab;
    applyCadWorkspace(ws, { isSketchMode: recoveryData.isSketchMode });
    if (recoveryData.renderMode === 'standard' || recoveryData.renderMode === 'photorealistic') {
      useSceneStore.getState().setRenderMode(recoveryData.renderMode);
    }
    if (recoveryData.assemblyOverrides) {
      const o = recoveryData.assemblyOverrides;
      setAssemblyHiddenParts(new Set(o.hiddenParts ?? []));
      setAssemblyTransparentParts(new Set(o.transparentParts ?? []));
      setAssemblyPartColors(o.partColors ?? {});
    }
    setShowRecovery(false);
    setViewMode('workspace');
  }, [recoveryData, clearAll, addNode, updateNode, setParamExpressions, setParams, setSelectedId]);
  const handleDismissRecovery = useCallback(() => { setShowRecovery(false); dismissRecovery(); }, [dismissRecovery]);

  // ═══ SHARE LINK RESTORE ═══
  useEffect(() => {
    const shareParam = searchParams?.get('share');
    if (!shareParam) return;
    const decoded = decodeShareLink(shareParam);
    if (!decoded) { addToast('error', lt.invalidShareLink); return; }
    const shapeConfig = SHAPE_MAP[decoded.shape];
    if (shapeConfig) {
      setSelectedId(decoded.shape);
      const raw = (decoded.params ?? {}) as Record<string, number>;
      applySceneParamsToSetters(shapeConfig, raw, {
        setParams,
        setParamExpressions,
      });
    }
    if (MATERIAL_PRESETS.some((m) => m.id === decoded.material)) {
      setMaterialId(decoded.material);
    }
    setViewMode('workspace');
    addToast('success', shapeLabels.openSharedDesign ?? 'Shared design loaded');
  }, []);

  // ═══ PROJECT LOAD (from dashboard ?projectId=xxx) ═══
  useEffect(() => {
    // Accept the legacy `?project=` alias too: the main projects list, the
    // nexyfab dashboard, and the in-modeler hub all link with `?project=`,
    // while this loader historically only read `?projectId=` — so clicking
    // "Open" on a saved project opened a blank workspace. (2026-06-09 fix.)
    const projectId = searchParams?.get('projectId') ?? searchParams?.get('project');
    if (!projectId) {
      useCloudProjectAccessStore.getState().reset();
      return;
    }
    fetch(`/api/nexyfab/projects/${projectId}`)
      .then(r => {
        if (!r.ok) {
          useCloudProjectAccessStore.getState().reset();
          return null;
        }
        return r.json() as Promise<{
          project?: {
            sceneData?: string;
            updatedAt: number;
            materialId?: string;
            role?: 'owner' | 'editor' | 'viewer';
            canEdit?: boolean;
          };
        }>;
      })
      .then(data => {
        if (!data?.project) return;
        const proj = data.project;
        useCloudProjectAccessStore.getState().setFromApiProject(projectId, {
          role: proj.role,
          canEdit: proj.canEdit,
        });
        if (!proj.sceneData) return;
        try {
          const raw: unknown = JSON.parse(proj.sceneData);
          if (raw && typeof raw === 'object' && (raw as { magic?: string }).magic === 'nfab') {
            const project = parseProject(proj.sceneData);
            adoptProjectId(projectId, proj.updatedAt);
            syncCloudNfabProjectId(projectId, proj.updatedAt);
            applyLoadedNfabProject(project);
            setViewMode('workspace');
            addToast('success', lt.designLoaded);
            return;
          }
          const state = raw as Record<string, unknown>;
          // Legacy AutoSaveState JSON (localStorage-style)
          if (state.selectedId && typeof state.selectedId === 'string' && SHAPE_MAP[state.selectedId]) {
            setSelectedId(state.selectedId);
            const legacySd = SHAPE_MAP[state.selectedId];
            if (legacySd) {
              const rawParams = state.params;
              const paramsOk =
                rawParams != null &&
                typeof rawParams === 'object' &&
                !Array.isArray(rawParams) &&
                !(rawParams instanceof Date);
              applySceneParamsToSetters(
                legacySd,
                paramsOk ? (rawParams as Record<string, number>) : {},
                { setParams, setParamExpressions },
              );
              if (rawParams != null && !paramsOk) {
                addToast('warning', (LOCAL_LABELS[langRef.current] ?? LOCAL_LABELS.en).legacySceneParamsSkipped);
              }
            }
          }
          if (typeof state.isSketchMode === 'boolean') setIsSketchMode(state.isSketchMode);
          if (state.activeTab === 'design' || state.activeTab === 'optimize') setActiveTab(state.activeTab);
          if (proj.materialId && MATERIAL_PRESETS.some((m: { id: string }) => m.id === proj.materialId)) {
            setMaterialId(proj.materialId);
          }
          if (Array.isArray(state.chatHistory) && state.chatHistory.length > 0) {
            setChatHistory(state.chatHistory as ChatMessage[]);
          }
          adoptProjectId(projectId, proj.updatedAt);
          syncCloudNfabProjectId(projectId, proj.updatedAt);
          setViewMode('workspace');
          addToast('success', lt.designLoaded);
        } catch (e) {
          addToast(
            'error',
            e instanceof NfabParseError
              ? (lang === 'ko' ? `프로젝트 형식 오류: ${e.message}` : `Invalid project: ${e.message}`)
              : lt.designLoadFailed,
          );
        }
      })
      .catch(() => {});
  // Intentionally keyed on URL only — avoid re-fetch loops when callback identities churn.
  }, [searchParams]);

  // ═══ SAMPLE LOAD (Hub "예제로 시작" → ?from=sample&intent=) ═══
  // Without this the sample link opened a blank workspace (the intent was
  // never read; one sample even used a non-existent shapeId). (2026-06-09)
  useEffect(() => {
    if (searchParams?.get('from') !== 'sample') return;
    const raw = searchParams?.get('intent');
    if (raw) {
      try {
        const intent = JSON.parse(decodeURIComponent(raw)) as { shapeId?: string; params?: Record<string, number> };
        const sid = intent.shapeId && SHAPE_MAP[intent.shapeId] ? intent.shapeId : 'box';
        // Force the 3D solid workspace — otherwise a restored guest/sketch
        // session leaves the modeler in sketch mode and the sample's solid
        // never renders in the center. (2026-06-09)
        setIsSketchMode(false);
        setSelectedId(sid);
        if (intent.params) {
          applySceneParamsToSetters(SHAPE_MAP[sid], intent.params, { setParams, setParamExpressions });
        }
        setViewMode('workspace');
        addToast('success', lang === 'ko' ? '예제를 불러왔습니다.' : 'Sample loaded.');
      } catch { /* ignore malformed intent */ }
    }
    const qs = new URLSearchParams(searchParams?.toString() ?? '');
    qs.delete('from'); qs.delete('sampleId'); qs.delete('intent');
    const n = qs.toString();
    router.replace(n ? `${pathname}?${n}` : pathname, { scroll: false });
     
  }, [searchParams]);

  // ═══ SHARED MODEL LOAD (from /view/{token} → sessionStorage) ═══
  useEffect(() => {
    const fromParam = searchParams?.get('from');
    if (fromParam !== 'shared') return;
    try {
      const meshB64 = sessionStorage.getItem('nexyfab_shared_mesh');
      const metaRaw = sessionStorage.getItem('nexyfab_shared_meta');
      if (!meshB64) return;
      sessionStorage.removeItem('nexyfab_shared_mesh');
      sessionStorage.removeItem('nexyfab_shared_meta');

      const json = atob(meshB64);
      const data = JSON.parse(json) as { positions: number[]; normals?: number[]; indices?: number[] };
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
      if (data.normals) geo.setAttribute('normal', new Float32BufferAttribute(data.normals, 3));
      if (data.indices) geo.setIndex(data.indices);
      if (!data.normals) geo.computeVertexNormals();
      geo.computeBoundingBox();

      const edgeGeo = new EdgesGeometry(geo, 15);
      const bb = geo.boundingBox!;
      const size = bb.getSize(new Vector3());
      const vol = meshVolume(geo) / 1000;
      const sa = meshSurfaceArea(geo) / 100;

      const meta = metaRaw ? JSON.parse(metaRaw) : {};
      setImportedGeometry(geo);
      setImportedFilename(meta.name || 'shared-model');
      setSketchResult({ geometry: geo, edgeGeometry: edgeGeo, volume_cm3: vol, surface_area_cm2: sa, bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) } });
      setIsSketchMode(false);
      setViewMode('workspace');
      addToast('success', lt.sharedModelLoaded);
    } catch (e) {
      console.error('Failed to load shared model:', e);
      addToast('error', lt.sharedModelLoadFailed);
    }
  }, []);

  // ═══ VERSION HISTORY ═══
  const {
    versions, saveVersion, restoreVersion: _restoreVersion, deleteVersion, renameVersion,
    branches, activeBranch, createBranch, switchBranch, mergeBranch, deleteBranch, compareBranches } = useVersionHistory();
  const showBranchCompare = useUIStore(s => s.showBranchCompare);
  const setShowBranchCompare = useUIStore(s => s.setShowBranchCompare);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sketchContainerRef = useRef<HTMLDivElement>(null);
  const [sketchSize, setSketchSize] = useState({ width: 800, height: 600 });
  useEffect(() => {
    const el = sketchContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) setSketchSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const captureCurrentThumbnail = useCallback((): string | undefined => {
    const canvas =
      canvasRef.current
      ?? (document.querySelector(`canvas[data-engine="${NF_R3F_VIEWPORT_DATA_ENGINE}"]`) as HTMLCanvasElement | null);
    if (!canvas) return undefined;
    try { return captureCanvasSnapshot(canvas, 200); } catch { return undefined; }
  }, []);
  const handleSaveVersionSnapshot = useCallback(() => {
    const thumbnail = captureCurrentThumbnail();
    saveVersion(selectedId, params, featuresToSerialize, thumbnail);
    addToast('success', lt.snapshotSaved);
  }, [selectedId, params, featuresToSerialize, captureCurrentThumbnail, saveVersion, addToast, lang]);
  const handleRestoreVersion = useCallback((version: DesignVersion) => {
    setSelectedId(version.shapeId);
    applySceneParamsToSetters(SHAPE_MAP[version.shapeId], version.params, {
      setParams,
      setParamExpressions,
    });
    clearAll();
    if (version.features.length > 0) { setTimeout(() => { version.features.forEach(f => addFeature(f.type as FeatureType)); }, 50); }
    setShowVersionPanel(false);
    addToast('success', lt.versionRestored);
  }, [clearAll, addFeature, addToast, lang, setParamExpressions, setParams, setSelectedId]);
  const prevVersionShapeRef = useRef(selectedId);
  const prevVersionFeatLenRef = useRef(features.length);
  useEffect(() => {
    if (viewMode !== 'workspace') return;
    const shapeChanged = prevVersionShapeRef.current !== selectedId;
    const featChanged = prevVersionFeatLenRef.current !== features.length;
    prevVersionShapeRef.current = selectedId;
    prevVersionFeatLenRef.current = features.length;
    if (shapeChanged || featChanged) { const thumbnail = captureCurrentThumbnail(); saveVersion(selectedId, params, featuresToSerialize, thumbnail); }
  }, [selectedId, features.length, viewMode, params, featuresToSerialize, captureCurrentThumbnail, saveVersion]);

  // ═══ BRANCH HANDLERS ═══
  const handleCreateBranch = useCallback((name: string) => { createBranch(name); addToast('success', lt.branchCreated(name)); }, [createBranch, addToast, lt]);
  const handleSwitchBranch = useCallback((branchId: string) => {
    const latestVersion = switchBranch(branchId);
    if (latestVersion) {
      setSelectedId(latestVersion.shapeId);
      applySceneParamsToSetters(SHAPE_MAP[latestVersion.shapeId], latestVersion.params, {
        setParams,
        setParamExpressions,
      });
      clearAll();
      if (latestVersion.features.length > 0) {
        setTimeout(() => { latestVersion.features.forEach(f => addFeature(f.type as FeatureType)); }, 50);
      }
    }
    const branchName = branches.find(b => b.id === branchId)?.name || branchId;
    addToast('success', lt.branchSwitched(branchName));
  }, [switchBranch, branches, clearAll, addFeature, addToast, lt, setParamExpressions, setParams, setSelectedId]);
  const handleDeleteBranch = useCallback((branchId: string) => { const branchName = branches.find(b => b.id === branchId)?.name || branchId; const ok = deleteBranch(branchId); if (ok) addToast('success', lt.branchDeleted(branchName)); }, [deleteBranch, branches, addToast, lt]);
  const handleMergeBranch = useCallback((sourceBranchId: string, targetBranchId: string) => { const merged = mergeBranch(sourceBranchId, targetBranchId); if (merged) { const srcName = branches.find(b => b.id === sourceBranchId)?.name || sourceBranchId; const tgtName = branches.find(b => b.id === targetBranchId)?.name || targetBranchId; addToast('success', lt.branchMerged(srcName, tgtName)); } }, [mergeBranch, branches, addToast, lt]);

  // ══════════════════════════════════════════════════════════════════════════
  // GALLERY → WORKSPACE TRANSITIONS
  // ══════════════════════════════════════════════════════════════════════════

  const _handleEnterWorkspace = useCallback((shapeId: string, initParams: Record<string, number>) => {
    const shapeDef = SHAPE_MAP[shapeId];
    if (shapeDef) {
      setSelectedId(shapeId);
      const { unknownKeys } = applySceneParamsToSetters(shapeDef, initParams, {
        setParams,
        setParamExpressions,
      });
      if (unknownKeys.length > 0) {
        const detail = unknownKeys.slice(0, 12).join(', ') + (unknownKeys.length > 12 ? '…' : '');
        addToast('warning', lt.ignoredUnknownParams(detail));
      }
    }
    clearAll();
    setSelectedFeatureId(null);
    setSketchResult(null);
    setEditMode('none');
    setIsSketchMode(false);
    setShowAIAssistant(false);
    setPendingChatMsg(null);
    setViewMode('workspace');
  }, [clearAll, addToast, lt, setParamExpressions, setParams, setSelectedId]);

  const _handleEnterBlankSketch = useCallback(() => {
    clearAll();
    setSelectedFeatureId(null);
    setSketchResult(null);
    setEditMode('none');
    setIsSketchMode(true);
    setSketchProfile({ segments: [], closed: false });
    setSketchViewMode('2d');
    openAIAssistant('chat');
    setPendingChatMsg(null);
    setViewMode('workspace');
  }, [clearAll]);

  const _handleChatFromGallery = useCallback((message: string) => {
    setPendingChatMsg(message);
    openAIAssistant('chat');
    // Don't force sketch mode — let the AI response decide
    setViewMode('workspace');
  }, [openAIAssistant]);

  const _handleBackToGallery = useCallback(() => {
    setViewMode('gallery');
    setPendingChatMsg(null);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // SHAPE DESIGN HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const shape = useMemo(() => SHAPES.find(s => s.id === selectedId) ?? SHAPES[0], [selectedId]);

  const handleSelectShape = useCallback((s: ShapeConfig) => {
    // Starting a fresh parametric shape — drop any imported model so it stops
    // taking precedence in effectiveResult (and stop AI-editing the import).
    setImportedResult(null);
    importStlRef.current = null;
    // Undo Phase B: shape changes flow ONLY through commandHistory — the
    // legacy useHistory snapshot stack has been retired (single source of
    // truth for Ctrl+Z).
    const prevSelectedId = selectedId;
    const prevParams = { ...params };
    const newP: Record<string, number> = {};
    const newE: Record<string, string> = {};
    s.params.forEach(sp => { newP[sp.key] = sp.default; newE[sp.key] = String(sp.default); });
    commandHistory.execute({
      id: `shape-change-${s.id}-${Date.now()}`,
      label: `Shape → ${s.id}`,
      labelKo: `형상 변경 → ${s.id}`,
      execute: () => {
        setSelectedId(s.id);
        setParams(newP);
        setParamExpressions(newE);
      },
      undo: () => {
        setSelectedId(prevSelectedId);
        setParams(prevParams);
        const e: Record<string, string> = {};
        Object.entries(prevParams).forEach(([k, v]) => { e[k] = String(v); });
        setParamExpressions(e);
      },
    });
    clearAll();
    setSelectedFeatureId(null);
    setSketchResult(null);
    setIsSketchMode(false);
    setEditMode('none');
    setShowManufacturingCard(false);
    collabSendShapeChange(s.id);
  }, [clearAll, selectedId, params, collabSendShapeChange, setIsSketchMode]);

  // ── LOD-during-drag: hide expensive edge overlay while a slider is held ──
  const [paramDragging, setParamDragging] = React.useState(false);
  const paramDragTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot of params at the *start* of a drag — used by handleParamCommit to
  // build a single undo step that spans the whole drag rather than one per
  // intermediate slider position. Cleared after each commit.
  const paramDragBeforeRef = React.useRef<Record<string, number> | null>(null);

  const handleParamChange = useCallback((key: string, value: number) => {
    // Capture pre-drag snapshot on the rising edge so the undo step can
    // restore the state the user actually saw before the slider moved.
    if (!paramDragging && !paramDragBeforeRef.current) {
      paramDragBeforeRef.current = { ...params };
    }
    setParam(key, value);
    setParamExpression(key, String(value));
    collabSendParamChange({ [key]: value });
    // Mark as dragging; auto-clear after 200ms idle (commit will also clear)
    if (!paramDragging) setParamDragging(true);
    if (paramDragTimerRef.current) clearTimeout(paramDragTimerRef.current);
    paramDragTimerRef.current = setTimeout(() => setParamDragging(false), 200);
  }, [setParam, setParamExpression, collabSendParamChange, paramDragging, params]);

  const handleExpressionChange = useCallback((key: string, expr: string) => {
    setParamExpression(key, expr);
    // Build variables from current params + model vars (excluding current key to avoid circular ref)
    const variables: ExprVariable[] = [
      ...Object.entries(params).filter(([k]) => k !== key).map(([name, value]) => ({ name, value })),
      ...modelVars.map(v => ({ name: v.name, value: v.value })),
    ];
    try {
      const result = evaluateExpression(expr, variables);
      if (isFinite(result)) {
        setParam(key, result);
      }
    } catch {
      // Invalid expression — don't update numeric value
    }
  }, [params, modelVars, setParam, setParamExpression]);

  // Commit on significant param changes (debounced via blur/enter): one
  // commandHistory entry per drag so Ctrl+Z reverses the whole drag in one
  // step (undo Phase B — commandHistory is the only history stack).
  const handleParamCommit = useCallback(() => {
    const before = paramDragBeforeRef.current;
    paramDragBeforeRef.current = null;
    if (before) {
      const after = { ...params };
      // Skip when nothing actually changed (e.g. user clicked a slider but
      // released without moving) — saves an empty undo step.
      const changed = Object.keys(after).some(k => after[k] !== before[k]);
      if (changed) {
        commandHistory.execute({
          id: `param-drag-${Date.now()}`,
          label: 'Edit parameters',
          labelKo: '파라미터 수정',
          // execute() is invoked once by .execute() itself with current state
          // already applied, and again on redo — we need to re-apply `after`.
          execute: () => {
            setParams(after);
            const e: Record<string, string> = {};
            Object.entries(after).forEach(([k, v]) => { e[k] = String(v); });
            setParamExpressions(e);
          },
          undo: () => {
            setParams(before);
            const e: Record<string, string> = {};
            Object.entries(before).forEach(([k, v]) => { e[k] = String(v); });
            setParamExpressions(e);
          },
        });
      }
    }
    if (paramDragTimerRef.current) { clearTimeout(paramDragTimerRef.current); paramDragTimerRef.current = null; }
    setParamDragging(false);
  }, [params, setParams, setParamExpressions]);

  const handleShapeReset = useCallback(() => {
    // Phase 5: track shape resets in commandHistory so Ctrl+Z restores the
    // user's prior parameters in one step.
    const prevParams = { ...params };
    const newP: Record<string, number> = {};
    const newE: Record<string, string> = {};
    shape.params.forEach(sp => { newP[sp.key] = sp.default; newE[sp.key] = String(sp.default); });
    commandHistory.execute({
      id: `shape-reset-${selectedId}-${Date.now()}`,
      label: 'Reset parameters',
      labelKo: '파라미터 초기화',
      execute: () => {
        setParams(newP);
        setParamExpressions(newE);
      },
      undo: () => {
        setParams(prevParams);
        const e: Record<string, string> = {};
        Object.entries(prevParams).forEach(([k, v]) => { e[k] = String(v); });
        setParamExpressions(e);
      },
    });
    clearAll();
    setSelectedFeatureId(null);
    // Reset formula values to defaults for new shape
    if (shape.formulaFields) {
      const fv: Record<string, string> = {};
      shape.formulaFields.forEach(ff => { fv[ff.key] = ff.default; });
      setFormulaValues(fv);
    } else {
      setFormulaValues({});
    }
  }, [shape, clearAll, selectedId, params]);

  // ── Formula values (for functionSurface / latheProfile etc.) ──────────────
  const [formulaValues, setFormulaValues] = React.useState<Record<string, string>>(() => {
    const fv: Record<string, string> = {};
    shape.formulaFields?.forEach(ff => { fv[ff.key] = ff.default; });
    return fv;
  });

  // Re-initialise when shape changes to a different formula-driven shape
  const prevShapeIdRef = React.useRef(selectedId);
  React.useEffect(() => {
    if (prevShapeIdRef.current !== selectedId) {
      prevShapeIdRef.current = selectedId;
      const fv: Record<string, string> = {};
      shape.formulaFields?.forEach(ff => { fv[ff.key] = ff.default; });
      setFormulaValues(fv);
    }
  }, [selectedId, shape]);

  const handleFormulaChange = useCallback((key: string, value: string) => {
    setFormulaValues(prev => ({ ...prev, [key]: value }));
  }, []);

  // Undo/redo — commandHistory is the SINGLE source of truth (undo Phase B).
  //
  // Phase A routed every user mutation (base params, feature add/remove/
  // param/suppress, assembly mates, COTS inserts, drag gestures, shape
  // switches) through commandHistory; Phase B retired the legacy useHistory
  // snapshot stack ({selectedId, params, featureIds} — it could not restore
  // feature params and duplicated every command-tracked mutation), so the
  // drains below no longer need a fallback.
  //
  // Sketch mode is the one deliberate exception: while a sketch session is
  // active, Ctrl+Z is handled by the sketch editor's own session-scoped stack
  // (see sketchUndoRef below) and these drains are not invoked.
  const handleHistoryUndo = useCallback(() => {
    // Commit any still-settling feature-param edit FIRST so Ctrl+Z within the
    // 500ms coalescing window undoes that edit (not the command before it).
    featureParamCoalescer.flush();
    cmdHistory.undo();
  }, [cmdHistory, featureParamCoalescer]);

  const handleHistoryRedo = useCallback(() => {
    featureParamCoalescer.flush();
    cmdHistory.redo();
  }, [cmdHistory, featureParamCoalescer]);

  // ─── Command-pattern wrappers (for tracked undo/redo via CommandHistory) ────

  const _handleParamChangeCmd = useCallback((key: string, value: number) => {
    const oldValue = params[key];
    if (oldValue === value) return;
    const id = `param-${key}-${Date.now()}`;
    commandHistory.execute({
      id,
      label: `Set ${key} = ${value}`,
      labelKo: `${key} = ${value} 설정`,
      execute: () => {
        setParam(key, value);
        setParamExpression(key, String(value));
      },
      undo: () => {
        setParam(key, oldValue);
        setParamExpression(key, String(oldValue));
      } });
  }, [params, setParam, setParamExpression]);

  // (Phase B: the unused `_handleShapeChangeCmd` duplicate of handleSelectShape
  // was deleted along with the legacy useHistory stack it pushed to.)

  // Tracked feature add — drops the legacy `_` prefix and is now wired into
  // every UI entry point that adds a feature (Round 26 Phase 2). Restoration
  // / version-load paths still call addFeature() directly so they don't
  // pollute the undo stack with state-restore noise.
  const handleAddFeatureCmd = useCallback((type: FeatureType) => {
    const id = `add-feature-${type}-${Date.now()}`;
    commandHistory.execute({
      id,
      label: `Add feature: ${type}`,
      labelKo: `피처 추가: ${type}`,
      execute: () => { addFeature(type); },
      undo: () => { undoLast(); } });
    // F4: emit a macro action for replay. No-op when not recording, so this
    // adds zero overhead in the common case.
    globalMacroRecorder.record({ kind: 'add-feature', featureType: type });
  }, [addFeature, undoLast]);

  // Shell-v2 Ribbon bridge: the new Shell's ribbon `onTool` dispatches a
  // `nexyfab:tool` CustomEvent with { id }. Map common tool ids to the
  // existing Inner handlers so clicking Extrude / Fillet / Line / etc.
  // from the new chrome triggers the real command stack.
  useEffect(() => {
    const FEATURE_TYPES: Record<string, FeatureType> = {
      'extrude': 'sketchExtrude',
      'revolve': 'revolve',
      'sweep': 'sweep',
      'loft': 'loft',
      'hole': 'hole',
      'fillet': 'fillet',
      'variableFillet': 'variableFillet',
      'chamfer': 'chamfer',
      'shell': 'shell',
      'draft': 'draft',
      'mirror': 'mirror',
      'combine': 'boolean',
      'pattern.linear': 'linearPattern',
    };
    const SKETCH_TOOLS: Record<string, 'line' | 'rect' | 'circle' | 'arc' | 'polygon' | 'spline' | 'trim' | 'offset' | 'mirror' | 'dimension' | 'constraint' | 'construction' | 'sweep-path'> = {
      'sketch.line': 'line',
      'sketch.rect': 'rect',
      'sketch.circle': 'circle',
      'sketch.arc': 'arc',
      'sketch.poly': 'polygon',
      'sketch.spline': 'spline',
      'sketch.trim': 'trim',
      'sketch.offset': 'offset',
      'sketch.mirror': 'mirror',
      'sketch.dim': 'dimension',
      'sketch.constraint': 'constraint',
      'sketch.project': 'construction',
      'sketch.sweep-path': 'sweep-path',
    };
    const onTool = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      if (id === 'sketch') {
        // "Sketch on face" — Phase 1 (axis-aligned fast-path) +
        // Phase 2 (arbitrary tilted face → store an oriented frame).
        //
        //   Axis-aligned face (|n.x|, |n.y|, |n.z| one dominant):
        //     route to the XY/XZ/YZ plane + offset; clear faceFrame.
        //   Tilted face:
        //     compute an orthonormal frame (origin, normal, u, v) and
        //     set sketchFaceFrame; pipeline applies that frame at the
        //     extrude step. sketchPlane is kept on its previous value
        //     so legacy consumers don't NPE.
        const sel = useSelectionStore.getState().selectedElement;
        const sceneSet = useSceneStore.getState();
        if (sel && sel.type === 'face') {
          const [nx, ny, nz] = sel.normal;
          const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
          const max = Math.max(ax, ay, az);
          const AXIS_ALIGN_TOL = 0.99; // cos(~8°) — close to a primary axis
          const isAxisAligned = max >= AXIS_ALIGN_TOL;
          if (isAxisAligned) {
            if (ax >= ay && ax >= az) {
              setSketchPlaneRaw('yz');
              setSketchPlaneOffset(sel.position[0]);
            } else if (ay >= ax && ay >= az) {
              setSketchPlaneRaw('xz');
              setSketchPlaneOffset(sel.position[1]);
            } else {
              setSketchPlaneRaw('xy');
              setSketchPlaneOffset(sel.position[2]);
            }
            sceneSet.setSketchFaceFrame(null);
          } else {
            // Build orthonormal frame from face normal. Pick a world axis
            // not parallel to the normal as the seed for the u-axis to
            // avoid the degenerate "cross product = 0" case.
            const n: [number, number, number] = [nx, ny, nz];
            const seed: [number, number, number] = ax < 0.9 ? [1, 0, 0] : [0, 1, 0];
            // u = normalize(seed - (seed·n) n)
            const sd = seed[0] * n[0] + seed[1] * n[1] + seed[2] * n[2];
            const uRaw: [number, number, number] = [
              seed[0] - sd * n[0],
              seed[1] - sd * n[1],
              seed[2] - sd * n[2],
            ];
            const uLen = Math.hypot(uRaw[0], uRaw[1], uRaw[2]) || 1;
            const u: [number, number, number] = [uRaw[0] / uLen, uRaw[1] / uLen, uRaw[2] / uLen];
            // v = n × u
            const v: [number, number, number] = [
              n[1] * u[2] - n[2] * u[1],
              n[2] * u[0] - n[0] * u[2],
              n[0] * u[1] - n[1] * u[0],
            ];
            sceneSet.setSketchFaceFrame({
              origin: sel.position,
              normal: n,
              uAxis: u,
              vAxis: v,
            });
          }
        } else {
          // No face selection → ensure a stale frame from a previous
          // sketch session doesn't bleed into the next one.
          sceneSet.setSketchFaceFrame(null);
        }
        setIsSketchMode(true);
        return;
      }
      if (id === 'sketch.finish') {
        setIsSketchMode(false);
        return;
      }
      // Cancel/discard the in-progress sketch: drop the drawn profile + result,
      // then leave sketch mode (vs. sketch.finish which keeps it). Mirror of
      // _handleEnterBlankSketch's profile reset.
      if (id === 'sketch.cancel') {
        setSketchProfile({ segments: [], closed: false });
        setSketchResult(null);
        setSelectedFeatureId(null);
        setIsSketchMode(false);
        return;
      }
      if (id === 'sketch.extrude-active') {
        handleGenerateActiveProfileRef.current?.();
        return;
      }
      // Phase-1 sketch-revolve ribbon entry. Flip config.mode to 'revolve'
      // then trigger the same active-profile generator the action menu
      // uses. The pipeline picks up mode='revolve' and routes through
      // `revolveGeometry` in extrudeProfile.ts.
      if (id === 'sketch.revolve') {
        const sc = useSceneStore.getState().sketchConfig;
        useSceneStore.getState().setSketchConfig({ ...sc, mode: 'revolve' });
        // Defer to next microtask so the store update settles before the
        // generator reads sketchConfig.
        setTimeout(() => handleGenerateActiveProfileRef.current?.(), 0);
        return;
      }
      if (id === 'measure') {
        setMeasureActive(v => !v);
        return;
      }
      // Inspect tools
      if (id === 'section') {
        setSectionActive(v => !v);
        return;
      }
      if (id === 'mass-props') {
        setShowMassProps(true);
        setShowCenterOfMass(null);
        return;
      }
      if (id === 'interference') {
        // Interference check requires multi-part input (assembly). Open the
        // Assembly panel where the existing interference workflow lives.
        setShowAssemblyPanel(true);
        return;
      }
      // Sheet Metal ribbon "Flatten" — the sheet-metal-tool bridge below
      // re-dispatches sm.flatten as this id, but the switch previously had no
      // case for it (dead end). The flatten UI lives in SheetMetalPanel's
      // Unfold tab (FlatPatternPanel with SVG/DXF export), so open that panel
      // instead of silently dropping the event.
      if (id === 'flat-pattern') {
        setShowSheetMetalPanel(true);
        return;
      }
      // Drawing route output buttons — open the AutoDrawingPanel where the
      // PDF/DXF export buttons live. Direct one-click export would need a
      // pre-baked DrawingResult; opening the panel lets the user review the
      // generated views first (closer to SolidWorks "Drawing → Save As PDF"
      // pattern). Ribbon was previously dead.
      if (id === 'output.pdf' || id === 'output.print') {
        setShowAutoDrawing(true);
        return;
      }
      // OpenSCAD code projection — feature tree → OpenSCAD code, read-only.
      // Toggleable so power users can keep it open while iterating.
      if (id === 'view.scad' || id === 'scad') {
        setShowScadPanel(v => !v);
        return;
      }
      // GD&T picker — opens a modal with 14 standard ASME/ISO symbols
      // (form / profile / orientation / location / runout) + tolerance,
      // modifier, datum inputs. Phase-1 emits clipboard / event; phase-2
      // wires the resulting feature control frame into the active drawing.
      if (id === 'note.gdt' || id === 'gdt' || id === 'drawing.gdt') {
        setShowGdtPicker(true);
        return;
      }
      // BOM export — assemble a CSV from the bridgeAssemblyItems list and
      // download. No assembly mounted → toast the user that BOM needs an
      // assembly first; ribbon dead-button otherwise.
      if (id === 'bom.export' || id === 'bom.show') {
        const items = useShellBridge.getState().assemblyItems;
        if (!items || items.length === 0) {
          addToast('info', isKorean(lang)
            ? 'BOM은 어셈블리에 부품이 추가된 후에 내보낼 수 있습니다.'
            : 'BOM export requires an assembly with at least one part.');
          return;
        }
        if (id === 'bom.show') {
          setShowAssemblyPanel(true);
          return;
        }
        // Build CSV. Quote any field containing comma / quote / newline.
        const quote = (v: string | number) => {
          const s = String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const rows = [
          ['#', 'Part', 'Qty', 'Mass (g)'].join(','),
          ...items.map((p, i) => [i + 1, quote(p.label), p.count, ((p as { massG?: number }).massG ?? 0).toFixed(2)].join(',')),
        ];
        const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${selectedId || 'assembly'}-bom.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        addToast('success', isKorean(lang) ? 'BOM CSV 내보내기 완료' : 'BOM CSV exported');
        return;
      }
      // Direct-edit push/pull — Phase-2A: toggle a viewport edit mode so
      // any subsequent face click pairs with the normal-arrow overlay
      // (drawn in the SelectionMesh layer). Phase-2B will hook the
      // pointer drag to the upstream feature parameter.
      if (id === 'push-pull') {
        const next = !useUIStore.getState().pushPullMode;
        useUIStore.getState().setPushPullMode(next);
        addToast('info', isKorean(lang)
          ? (next
              ? 'Push/Pull 모드 ON — 면을 선택하면 법선 화살표가 표시됩니다. 다시 누르면 끄기.'
              : 'Push/Pull 모드 OFF.')
          : (next
              ? 'Push/Pull mode ON — select a face to see the normal arrow. Click again to turn off.'
              : 'Push/Pull mode OFF.'));
        return;
      }
      // Drawing > Views — opens the same panel so the user can build sheet
      // views. Same panel hosts View tools (base / projection / section / detail).
      if (id === 'view.base' || id === 'view.projection' || id === 'view.section' || id === 'view.detail') {
        setShowAutoDrawing(true);
        return;
      }
      // Nexy AI tools — open the unified AI sidebar on the right tab. The
      // user types or accepts the suggested prompt from there. Pre-filling
      // a prompt would require an additional event channel into ShapeChat.
      if (id === 'ai.suggest') {
        openAIAssistant('suggestions');
        return;
      }
      if (id === 'ai.lighten' || id === 'ai.ribs') {
        openAIAssistant('chat');
        return;
      }
      if (id === 'ai.fillet') {
        openAIAssistant('advisor');
        return;
      }
      // Assembly mode mate buttons — preselect mate type via custom event
      // so AssemblyPanel opens with the right type already chosen.
      const MATE_TYPES: Record<string, string> = {
        'mate.coincident': 'coincident',
        'mate.concentric': 'concentric',
        'mate.distance': 'distance',
        'mate.angle': 'angle',
        // Phase 2 advanced mates (SolidWorks-parity roadmap)
        'mate.hinge': 'hinge',
        'mate.slider': 'slider',
        'mate.gear': 'gear',
        'mate.limitDistance': 'limitDistance',
        'mate.limitAngle': 'limitAngle',
        'mate.width': 'width',
      };
      if (MATE_TYPES[id]) {
        setShowAssemblyPanel(true);
        window.dispatchEvent(new CustomEvent('nexyfab:assembly-mate-type', { detail: { type: MATE_TYPES[id] } }));
        return;
      }
      // Remaining assembly tools just open the browser panel.
      if (
        id === 'asm.insert' ||
        id === 'asm.replace' ||
        id === 'asm.subassembly' ||
        id === 'motion.drive' ||
        id === 'asm.interference' ||
        id === 'asm.section' ||
        id === 'asm.measure' ||
        id === 'bom.show' ||
        id === 'bom.export'
      ) {
        setShowAssemblyPanel(true);
        return;
      }
      // Direct editing (Phase 1) — Delete Face / Offset Face operate on the
      // face selection captured BEFORE the tool is pressed (same flow as the
      // fillet/shell selection capture). Without a face selected the click
      // explains itself instead of dead-ending.
      if (id === 'direct.delete-face' || id === 'direct.offset-face') {
        const dd = t as unknown as Record<string, string>;
        const el = useSelectionStore.getState().selectedElement;
        let faceSel: FaceSelectionInfo[] | undefined;
        if (el && el.type === 'face') {
          faceSel = [el as FaceSelectionInfo];
        } else if (el && el.type === 'multi') {
          const faces = (el as import('./editing/selectionInfo').MultiSelectionInfo).faces;
          if (faces && faces.length > 0) faceSel = faces;
        }
        if (!faceSel) {
          addToast('info', dd.directEditSelectFaceFirst
            ?? 'Select a face first — click the boss/pocket/hole face(s), then press again.');
          return;
        }
        const featType: FeatureType = id === 'direct.delete-face' ? 'deleteFace' : 'offsetFace';
        // Offset Face moves ONE planar face; Delete Face takes the whole set.
        const frozen = featType === 'offsetFace' ? [faceSel[0]!] : faceSel;
        commandHistory.execute({
          id: `add-feature-${featType}-${Date.now()}`,
          label: `Add feature: ${featType}`,
          labelKo: `피처 추가: ${featType}`,
          execute: () => { addFeatureWithEdges(featType, undefined, frozen); },
          undo: () => { undoLast(); },
        });
        addToast('info', featType === 'deleteFace'
          ? (dd.directDeleteFaceAdded ?? 'Delete Face added — removes the selected face set and heals with planar caps')
          : (dd.directOffsetFaceAdded ?? 'Offset Face added — adjust the distance (±) in feature parameters'));
        return;
      }
      const ft = FEATURE_TYPES[id];
      if (ft) {
        handleAddFeatureCmd(ft);
        return;
      }
      const st = SKETCH_TOOLS[id];
      if (st) {
        setIsSketchMode(true);
        setSketchTool(st);
        return;
      }
    };
    window.addEventListener('nexyfab:tool', onTool);
    return () => window.removeEventListener('nexyfab:tool', onTool);
  }, [handleAddFeatureCmd, setIsSketchMode, setSketchTool, setMeasureActive, setSectionActive, setShowMassProps, setShowCenterOfMass, setShowAssemblyPanel, setShowSheetMetalPanel, openAIAssistant, addFeatureWithEdges, undoLast, addToast, t]);

  // F7 — DRC rule set state. Loaded from .drc.json or built inline.

  // Below — Shell-v2 bridge writers. Wire Inner's status into useShellBridge
  // so the new TitleBar mode chip and StatusBar reflect live values.
  // Keep these effects cheap (only set when value changes).
  const bridgeMode = useShellBridge(s => s.setMode);
  const bridgeUnits = useShellBridge(s => s.setUnits);
  const bridgeStats = useShellBridge(s => s.setStats);
  const bridgeCloud = useShellBridge(s => s.setCloud);
  const bridgeFeatureItems = useShellBridge(s => s.setFeatureItems);
  const bridgeAssemblyItems = useShellBridge(s => s.setAssemblyItems);
  const bridgeAssemblyMates = useShellBridge(s => s.setAssemblyMates);

  useEffect(() => {
    const editMode: 'modeling' | 'sketch' | 'assembly' = isSketchMode
      ? 'sketch'
      : showAssemblyPanel
        ? 'assembly'
        : 'modeling';
    bridgeMode({ isSketchMode, assemblyOpen: showAssemblyPanel, editMode });
  }, [isSketchMode, showAssemblyPanel, bridgeMode]);

  useEffect(() => {
    bridgeUnits(unitSystem);
  }, [unitSystem, bridgeUnits]);

  useEffect(() => {
    const status: 'idle' | 'saving' | 'saved' | 'error' | 'conflict' =
      versionConflictNeedsReload
        ? 'conflict'
        : saveError
          ? 'error'
          : isSaving
            ? 'saving'
            : (lastSavedAt || cloudSavedAt)
              ? 'saved'
              : 'idle';
    bridgeCloud({
      cloudStatus: status,
      cloudSavedAt: cloudSavedAt ?? null,
      autosaveSavedAt: lastSavedAt ?? null,
    });
  }, [isSaving, lastSavedAt, cloudSavedAt, saveError, versionConflictNeedsReload, bridgeCloud]);

  // Sketch solver bridge — TitleBar reads sketchSolverOk + sketchDof for the
  // "Fully constrained · DOF 0" pill, plus a floating SolverInfoChip reads
  // entities/constraints/dimensions/solveMs for the engineer-mode readout.
  const bridgeSketchSolver = useShellBridge(s => s.setSketchSolver);
  const bridgeSketchSnapshot = useShellBridge(s => s.setSketchSnapshot);
  const bridgeSketchSelectedEntity = useShellBridge(s => s.setSketchSelectedEntity);
  useEffect(() => {
    if (!isSketchMode) {
      bridgeSketchSolver({
        sketchSolverOk: null,
        sketchDof: null,
        sketchEntities: 0,
        sketchConstraints: 0,
        sketchDimensions: 0,
        sketchSolveMs: null,
        sketchStatus: null,
        sketchRedundantCount: 0,
      });
      bridgeSketchSnapshot({ entities: [], constraints: [], dimensions: [] });
      bridgeSketchSelectedEntity(null);
      return;
    }
    // Empty sketch → no status (honest "nothing to constrain" instead of a
    // fake "Fully constrained · DOF 0" green pill on entry).
    const hasContent = (sketchProfile?.segments?.length ?? 0) > 0;
    const ok = hasContent ? constraintStatus === 'ok' : null;
    const dof = hasContent ? constraintDiagnostic?.dof ?? null : null;
    bridgeSketchSolver({
      sketchSolverOk: ok,
      sketchDof: dof,
      sketchEntities: sketchProfile?.segments?.length ?? 0,
      sketchConstraints: sketchConstraints?.length ?? 0,
      sketchDimensions: sketchDimensions?.length ?? 0,
      sketchSolveMs: hasContent && typeof constraintDiagnostic?.solveMs === 'number' ? constraintDiagnostic.solveMs : null,
      sketchStatus: hasContent ? constraintStatus : null,
      sketchRedundantCount: constraintDiagnostic?.redundant?.length ?? 0,
    });
    // Publish real sketch entity / constraint / dimension lists so the
    // SketchLeftPane renders actual content instead of mockup placeholders.
    const unsatisfiedIds = new Set(constraintDiagnostic?.unsatisfiedIds ?? []);
    bridgeSketchSnapshot({
      entities: (sketchProfile?.segments ?? []).map((seg, i) => ({
        id: seg.id ?? `seg${i}`,
        type: seg.type,
        label: `${seg.type[0].toUpperCase()}${seg.type.slice(1)} ${i + 1}`,
        meta: seg.construction ? 'construction' : `${seg.points.length} pts`,
        construction: seg.construction === true,
        pointIds: seg.points.map(p => p.id).filter((id): id is string => !!id),
      })),
      constraints: (sketchConstraints ?? []).map((c, i) => ({
        id: (c as { id?: string }).id ?? `c${i}`,
        type: (c as { type?: string }).type ?? 'unknown',
        label: (c as { type?: string }).type ?? undefined,
        entityIds: (c as { entityIds?: string[] }).entityIds ?? [],
        satisfied: !unsatisfiedIds.has((c as { id?: string }).id ?? `c${i}`),
      })),
      dimensions: (() => {
        const dims = (sketchDimensions ?? []) as Array<{ id?: string; name?: string; value?: number; unit?: string; expression?: string; type?: string; entityIds?: string[]; position?: { x: number; y: number }; locked?: boolean }>;
        // Resolve expressions once per snapshot so the sidebar can show
        // {expr, evaluated value, error} as a single coherent row.
        const fullDims = dims.map((d, i) => ({
          id: d.id ?? `d${i + 1}`,
          name: d.name ?? `d${i + 1}`,
          type: (d.type as 'linear' | 'angular' | 'radial' | 'diameter') ?? 'linear',
          entityIds: d.entityIds ?? [],
          value: d.value ?? 0,
          position: d.position ?? { x: 0, y: 0 },
          locked: d.locked ?? false,
          expression: d.expression,
        }));
        const { targets, errors } = resolveDimensionTargetsWithErrors(fullDims);
        return dims.map((d, i) => {
          const id = d.id ?? `d${i + 1}`;
          return {
            id,
            name: d.name ?? `d${i + 1}`,
            value: targets.get(id) ?? d.value ?? 0,
            unit: d.unit ?? 'mm',
            expression: d.expression,
            expressionError: errors.get(id),
            entityIds: d.entityIds ?? [],
          };
        });
      })(),
    });
  }, [
    isSketchMode,
    constraintStatus,
    constraintDiagnostic?.dof,
    constraintDiagnostic?.solveMs,
    constraintDiagnostic?.redundant,
    constraintDiagnostic?.unsatisfiedIds,
    sketchProfile,
    sketchConstraints,
    sketchDimensions,
    bridgeSketchSolver,
    bridgeSketchSnapshot,
    bridgeSketchSelectedEntity,
  ]);

  // Selection bridge — drives Shell's floating "{feature} · {n} edges" bubble.
  const bridgeSelection = useShellBridge(s => s.setSelection);
  useEffect(() => {
    if (!selectedElement) {
      bridgeSelection({ selectionKind: null, selectionLabel: null, selectionCount: 0 });
      return;
    }
    const kind = selectedElement.type as 'face' | 'edge' | 'vertex' | 'multi';
    const count =
      selectedElement.type === 'multi'
        ? (selectedElement as { count?: number }).count ?? 1
        : 1;
    const label = selectedFeatureId ?? selectedId ?? kind;
    bridgeSelection({ selectionKind: kind, selectionLabel: label, selectionCount: count });
  }, [selectedElement, selectedFeatureId, selectedId, bridgeSelection]);

  // Selection bubble Edit / Suppress buttons: SelectionBubble dispatches these
  // global events but nothing listened, so the buttons did nothing. Route them
  // to the exact same guarded handlers the context-menu 'edit-feature' /
  // 'suppress' commands use — acting on the displayed feature (the bubble's
  // label IS selectedFeatureId above), and safely no-op when none is selected.
  // (2026-06-13 dead-wiring fix)
  useEffect(() => {
    const onEdit = () => { if (selectedFeatureId) startEditing(selectedFeatureId); };
    const onSuppress = () => { if (selectedFeatureId) toggleFeatureCmd(selectedFeatureId); };
    window.addEventListener('nexyfab:selection-edit', onEdit);
    window.addEventListener('nexyfab:selection-suppress', onSuppress);
    return () => {
      window.removeEventListener('nexyfab:selection-edit', onEdit);
      window.removeEventListener('nexyfab:selection-suppress', onSuppress);
    };
  }, [selectedFeatureId, startEditing, toggleFeatureCmd]);

  // Note: feature stats bridge writer is declared below after effectiveResult is in scope.
  const [drcRuleSet, setDrcRuleSet] = useState<import('./analysis/drcEngine').DrcRuleSet | null>(null);

  // F6 — confirm-impact dialog state. Shown before destructive feature
  // removal when analyzeChangeImpact reports `major`. Stores both the
  // featureId being deleted and a summary message for the modal body.
  const [removeConfirm, setRemoveConfirm] = useState<{
    featureId: string;
    summary: string;
  } | null>(null);

  /**
   * Internal: actually run the remove command. Public handleRemoveFeatureCmd
   * gates this with a confirm modal when impact analysis flags major impact.
   */
  const performRemoveFeature = useCallback((featureId: string) => {
    // Phase A fix: capture the FULL pre-removal tree (rootId/activeNodeId and
    // every node incl. sketchData / edgeSelections / faceSelections / original
    // position). removeNode also deletes descendants, and the old undo
    // re-added a bare feature at the END of the tree with numeric params only.
    // Restoring via replaceHistory puts everything back exactly where it was;
    // redo still works because replaceHistory preserves node ids.
    const snapshot = snapshotFeatureTree(
      getOrderedNodes(),
      featureHistory.rootId,
      featureHistory.activeNodeId,
    );
    // F4: emit macro action up-front so even a destructive sequence is
    // replayable. Removal undo is handled separately by commandHistory.
    globalMacroRecorder.record({ kind: 'remove-feature', featureId });
    commandHistory.execute(makeRemoveFeatureCommand({
      commandId: `remove-feature-${featureId}-${Date.now()}`,
      label: 'Remove feature',
      labelKo: '피처 제거',
      featureId,
      snapshot,
      removeFeature,
      replaceHistory,
      onRestored: () => addToast('success', lt.featureRestored),
      onRestoreFailed: () => addToast('warning', lt.featureCannotRestore),
    }));
  }, [removeFeature, featureHistory, replaceHistory, getOrderedNodes, addToast, lt]);

  // F6 — public wrapper. Runs analyzeChangeImpact and gates `major` impact
  // through a confirm modal so the user sees the cascade (broken
  // expressions / downstream features / affected mates) before committing.
  const handleRemoveFeatureCmd = useCallback((featureId: string) => {
    const impact = analyzeChangeImpact({
      targetFeatureId: featureId,
      features,
      paramExpressions: useSceneStore.getState().paramExpressions,
      assemblyMates,
    });
    if (impact.severity === 'major') {
      const parts: string[] = [];
      if (impact.summary.expressionCount > 0) {
        parts.push(`${impact.summary.expressionCount} expression(s)`);
      }
      if (impact.summary.downstreamCount > 0) {
        parts.push(`${impact.summary.downstreamCount} downstream feature(s)`);
      }
      if (impact.summary.mateCount > 0) {
        parts.push(`${impact.summary.mateCount} mate(s)`);
      }
      setRemoveConfirm({
        featureId,
        summary: parts.join(', '),
      });
      return;
    }
    performRemoveFeature(featureId);
  }, [features, assemblyMates, performRemoveFeature]);

  const handleMoveFeatureByIds = useCallback((fromId: string, toId: string) => {
    const ordered = getOrderedNodes().filter(n => n.type === 'feature' && n.featureType);
    const fromIdx = ordered.findIndex(n => n.id === fromId);
    const toIdx = ordered.findIndex(n => n.id === toId);
    if (fromIdx >= 0 && toIdx >= 0) moveFeature(fromIdx, toIdx);
  }, [moveFeature, getOrderedNodes]);

  // ── Base shape generation (sync, lightweight) ──────────────────────────────
  /** 베이스 generate() 예외의 실측 보존(F-0 진단) — 프로브 전용, 상태 변이 없음. */
  const baseGenErrorRef = useRef<string | null>(null);
  const baseShapeResult: ShapeResult | null = useMemo(() => {
    try {
      const resolvedParams: Record<string, number> = {};
      shape.params.forEach(sp => { resolvedParams[sp.key] = sp.key in debouncedParams ? debouncedParams[sp.key] : sp.default; });
      baseGenErrorRef.current = null;
      return shape.generate(resolvedParams, Object.keys(formulaValues).length > 0 ? formulaValues : undefined);
    } catch (e) {
      // 조용한 null 강등 금지(F-0 실측 — null 이 lastGood 폴백으로 옛 형상을
      // 남긴다): 원인 메시지를 보존해 프로브/텔레메트리로 노출한다.
      baseGenErrorRef.current = e instanceof Error ? `${e.message} | ${(e.stack ?? '').slice(0, 400)}` : String(e);
      return null;
    }
  }, [shape, debouncedParams, formulaValues]);

  // ── Feature pipeline (async, off main thread via Worker) ───────────────────
  const [result, setResult] = useState<ShapeResult | null>(null);
  /** Monotonic id so only the latest pipeline run may commit mesh/errors (debounce + worker races). */
  const pipelineRunGenerationRef = useRef(0);
  useEffect(() => {
    const gen = ++pipelineRunGenerationRef.current;

    if (!baseShapeResult) {
      setResult(null);
      return;
    }

    const hasEnabledFeatures = features.length > 0 && features.some(f => f.enabled);

    if (!hasEnabledFeatures) {
      // No features — base result is the final result; clear stale errors.
      setPipelineErrors(prev => (Object.keys(prev).length === 0 ? prev : {}));
      setResult(baseShapeResult);
      return;
    }

    // Run features asynchronously via the Web Worker.
    // occtMode is a dep so changing the topology engine triggers a re-run.
    // baseSpec lets the worker rebuild the base primitive as a real B-rep solid
    // in its own OCCT context, so a cylinder/sphere base fillet rounds the real
    // shape (not its bbox). occtBaseSolid ignores unsupported ids (e.g. box).
    runPipelineWorker(baseShapeResult.geometry, features, { occtMode, baseSpec: { shapeId: selectedId, params: debouncedParams } }).then(pipe => {
      if (gen !== pipelineRunGenerationRef.current) return;
      const finalGeometry = pipe.geometry;
      setPipelineErrors(prev => {
        const sameKeys = Object.keys(pipe.errors).length === Object.keys(prev).length
          && Object.keys(pipe.errors).every(k => prev[k] === pipe.errors[k]);
        return sameKeys ? prev : pipe.errors;
      });
      const edgeGeometry = makeEdges(finalGeometry);
      const volume_cm3 = meshVolume(finalGeometry) / 1000;
      const surface_area_cm2 = meshSurfaceArea(finalGeometry) / 100;
      finalGeometry.computeBoundingBox();
      const bb = finalGeometry.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new Vector3());
      const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
      setResult({ geometry: finalGeometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
    }).catch((err) => {
      // On worker failure fall back to the base result so the viewport is never blank.
      if (gen !== pipelineRunGenerationRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Pipeline superseded') return;
      const enabled = features.find(f => f.enabled) ?? features[0];
      const ft = enabled?.type ?? 'sketchExtrude';
      reportError('feature_pipeline', err instanceof Error ? err : new Error(msg), {
        stage: 'shape_generator_worker',
        diagnosticCode: classifyFeatureError(ft, msg, { nodeId: enabled?.id }).code,
        featureType: ft,
        enabledFeatureCount: features.filter(f => f.enabled).length,
      });
      setResult(baseShapeResult);
      addToast('warning', lt.pipelineFailed(msg));
    });
  }, [baseShapeResult, features, occtMode, runPipelineWorker]);

  // Merge pipeline errors into history nodes so FeatureTree can render diagnostics
  const featureHistoryWithErrors = useMemo(() => {
    if (!featureHistory) return featureHistory;
    const hasErrors = Object.keys(pipelineErrors).length > 0;
    const anyStaleError = featureHistory.nodes.some(n => n.error && !pipelineErrors[n.id]);
    if (!hasErrors && !anyStaleError) return featureHistory;
    return {
      ...featureHistory,
      nodes: featureHistory.nodes.map(n => {
        const live = pipelineErrors[n.id];
        if (live) return { ...n, error: live };
        if (n.error) return { ...n, error: undefined };
        return n;
      }) };
  }, [featureHistory, pipelineErrors]);

  // In sketch mode show only the extruded sketch; after extrude (sketch off) keep the
  // sketch body until the library shape / pipeline replaces it — otherwise the center
  // viewport falls back to `result` and the extrusion disappears from effective geometry.
  // While sketching, do NOT fall back to parametric `result` (avoids ghost shape).
  const effectiveResultRaw: ShapeResult | null = isSketchMode
    ? sketchResult
    : (sketchResult ?? importedResult ?? result);

  // E1: transient-null guard for the viewport. When a feature is rebuilding
  // (CSG running, pipeline mid-flight, undo replacing params), `result` can
  // briefly evaluate to null before the new geometry is uploaded. Without
  // this fallback the canvas blanks for 1-2 frames — the visual "flicker" the
  // deepseek review flagged. Hold the last good result so the previous mesh
  // stays visible until the new one is ready.
  const lastGoodEffectiveResultRef = useRef<ShapeResult | null>(null);
  if (effectiveResultRaw) lastGoodEffectiveResultRef.current = effectiveResultRaw;
  const effectiveResult: ShapeResult | null =
    effectiveResultRaw ?? lastGoodEffectiveResultRef.current;

  // ─── Topological Naming: rebuild stable face-ID map on every geometry rebuild ───
  const topoMap = useTopologicalMap();
  useEffect(() => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const activeFeatureId = features.length > 0 ? features[features.length - 1].id : undefined;
    const report = topoMap.update(geo, activeFeatureId);
    if (report.remaps.length === 0) return;

    const current = useSelectionStore.getState().selectedElement;
    if (!current || current.type === 'edge') return;
    const byPrevious = new Map(report.remaps.map(remap => [remap.previousRef, remap]));
    const selectedFaces = current.type === 'face' ? [current] : current.faces;
    const selectedRemaps = selectedFaces
      .map(face => face.persistentId ? byPrevious.get(face.persistentId) : undefined)
      .filter((remap): remap is NonNullable<typeof remap> => remap !== undefined);
    if (selectedRemaps.some(remap => remap.quality === 'ambiguous' || remap.quality === 'broken')) {
      useSelectionStore.getState().setSelectedElement(null);
      addToast(
        'error',
        lang === 'ko'
          ? '형상 재생성 후 선택한 면 참조가 끊겨 선택을 해제했습니다. 면을 다시 선택해 주세요.'
          : 'The selected face reference was lost after regeneration. Please select the face again.',
      );
      return;
    }

    const rename = new Map(
      selectedRemaps
        .filter(remap => remap.mappedRef && remap.mappedRef !== remap.previousRef)
        .map(remap => [remap.previousRef, remap.mappedRef!]),
    );
    if (rename.size === 0) return;
    useSelectionStore.getState().setSelectedElement(
      current.type === 'face'
        ? { ...current, persistentId: current.persistentId ? rename.get(current.persistentId) ?? current.persistentId : undefined }
        : {
            ...current,
            faces: current.faces.map(face => ({
              ...face,
              persistentId: face.persistentId ? rename.get(face.persistentId) ?? face.persistentId : undefined,
            })),
          },
    );
  }, [effectiveResult?.geometry]);

  // ── G3: RefRelink 배선 — 리빌드 상실(reference.lost) 수집 → 패널 → 적용 ──
  // 적용은 updateNode(featureId, { edgeSelections }) 한 줄: nodeMap → features
  // 메모가 바뀌므로 위의 파이프라인 effect([features] dep)가 재빌드를 트리거한다.
  const refRelink = useRefRelinkWiring({
    geometry: effectiveResult?.geometry ?? null,
    features,
    onApplyFeatureSelections: (featureId, edgeSelections) => {
      updateNode(featureId, { edgeSelections });
      addToast('success', lang === 'ko' ? '참조 재지정 적용 — 재빌드합니다' : 'Reference relinked — rebuilding');
    },
    onRefused: (reason) => addToast('error', reason),
  });

  // Shell-v2 bridge: feature stats. Declared here (after effectiveResult is in scope).
  useEffect(() => {
    const featureCount = features?.length ?? 0;
    const volume = effectiveResult?.volume_cm3 ?? null;
    const triangleCount = effectiveResult?.geometry?.index
      ? effectiveResult.geometry.index.count / 3
      : 0;
    bridgeStats({
      featureCount,
      mass: null,
      volume,
      triangleCount,
      selectedLabel: selectedId,
    });
    // Keep ref in sync for the early-declared tool listener.
    effectiveResultRef.current = effectiveResult;
    // Bridge geometry to Drawing / Render routes via sessionStorage.
    // Key is the cloud project id when available, otherwise 'local'.
    if (effectiveResult?.geometry) {
      void import('./_shell/geometryBridge').then(({ writeGeometry }) => {
        // Always mirror to 'local' — the Render/Drawing tabs navigate WITHOUT a
        // projectId, so those routes read readGeometry('local'). Writing only to
        // the cloud-project key left them reading an empty 'local' slot, so the
        // model (e.g. a fresh import) vanished into the sphere/primitive fallback.
        const key = cloudProjectId ?? 'local';
        writeGeometry(key, effectiveResult.geometry, selectedId ?? null);
        if (key !== 'local') writeGeometry('local', effectiveResult.geometry, selectedId ?? null);
      });
    }
    // Publish the feature tree snapshot for the shell-v2 sidebar.
    bridgeFeatureItems(
      (features ?? []).map(f => ({
        id: f.id,
        label: f.type,
        type: f.type,
        muted: f.enabled === false,
        meta: undefined,
        params: { ...f.params },
        // Real click-time edge selections (fillet/chamfer/shell) so the
        // Inspector EDGES section lists actual edges, not placeholders.
        edges: (f.edgeSelections ?? []).map((sel, i) => ({
          id: sel.persistentId ?? `edge-${i + 1}`,
          meta: Number.isFinite(sel.length) ? `L ${sel.length.toFixed(1)} mm` : undefined,
        })),
      })),
      selectedId ?? null,
    );
    // Publish assembly parts snapshot — drives the v3 AssemblyLeftPane tree
    // and AssemblyRightPane BOM table. Density ~2.7 g/cm³ proxy for mass
    // when actual material is unavailable, refined downstream as needed.
    bridgeAssemblyItems(
      (bomParts ?? []).map((p, i) => ({
        id: p.name || `part-${i}`,
        label: p.name || `Part ${i + 1}`,
        count: 1,
        massG: typeof p.result?.volume_cm3 === 'number'
          ? p.result.volume_cm3 * 2.7
          : undefined,
        kind: 'part' as const,
      })),
      selectedId ?? null,
    );
    // Publish REAL mates so the assembly sidebars list actual constraints
    // instead of a placeholder. Resolve partA/partB ids → display labels via
    // placedParts (id→name). (2026-06-09 follow-up #4)
    const partLabel = new Map(placedParts.map(p => [p.id, p.name]));
    bridgeAssemblyMates(
      assemblyMates.map(m => ({
        id: m.id,
        type: m.type,
        partA: partLabel.get(m.partA) ?? m.partA,
        partB: partLabel.get(m.partB) ?? m.partB,
        value: m.value,
        locked: m.locked,
      })),
    );
  }, [features, effectiveResult, selectedId, bridgeStats, bridgeFeatureItems, bridgeAssemblyItems, bridgeAssemblyMates, bomParts, placedParts, assemblyMates, cloudProjectId]);

  // Shell-v2 Inspector → Inner bridge for parameter edits. Listener decoupled
  // from the visual chrome so the new sidebar can edit live params without
  // a hard import of Inner state.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const ce = e as CustomEvent<{ id: string; key: string; value: number }>;
      const { id, key, value } = ce.detail ?? {};
      if (id && typeof key === 'string' && Number.isFinite(value)) {
        updateFeatureParamCmd(id, key, value);
      }
    };
    window.addEventListener('nexyfab:update-feature-param', onUpdate);
    return () => window.removeEventListener('nexyfab:update-feature-param', onUpdate);
  }, [updateFeatureParamCmd]);

  // Shell-v2 Inspector EDGES section → remove one edge selection from a
  // fillet/chamfer/shell feature. Undoable via commandHistory. Refuses to
  // remove the LAST edge — an empty edgeSelections silently flips the
  // feature back to legacy all-edges behaviour, which would be surprising.
  useEffect(() => {
    const onRemoveEdge = (e: Event) => {
      const ce = e as CustomEvent<{ featureId: string; edgeIndex: number }>;
      const { featureId, edgeIndex } = ce.detail ?? {};
      if (!featureId || !Number.isInteger(edgeIndex)) return;
      const node = getOrderedNodesRef.current().find(n => n.id === featureId);
      const before = node?.edgeSelections;
      if (!node || !before || before.length <= 1) return;
      if (edgeIndex < 0 || edgeIndex >= before.length) return;
      const after = before.filter((_, i) => i !== edgeIndex);
      commandHistory.execute({
        id: `remove-feature-edge-${featureId}-${Date.now()}`,
        label: 'Remove edge from feature',
        labelKo: '피처 엣지 제거',
        execute: () => updateNode(featureId, { edgeSelections: after, error: undefined }),
        undo: () => updateNode(featureId, { edgeSelections: before, error: undefined }),
      });
    };
    window.addEventListener('nexyfab:remove-feature-edge', onRemoveEdge);
    return () => window.removeEventListener('nexyfab:remove-feature-edge', onRemoveEdge);
  }, [updateNode]);

  // Shell-v2 Sketch dimension inline edit → patch sketchDimensions by id.
  // SketchLeftPane's DimensionEditableRow dispatches this event on commit.
  // `expression: null` clears any prior formula and pins value back to a
  // bare number; `expression: string` sets/replaces the formula (value
  // becomes a fallback used when the expression fails to resolve).
  useEffect(() => {
    const onDim = (e: Event) => {
      const ce = e as CustomEvent<{ id: string; name: string; value: number; expression?: string | null }>;
      if (!ce.detail) return;
      const { id, value, expression } = ce.detail;
      setSketchDimensions((sketchDimensions ?? []).map(d => {
        const dim = d as { id?: string; value?: number; expression?: string };
        if (dim.id !== id) return d;
        const next = { ...d, value } as typeof d & { expression?: string };
        if (expression === null) delete next.expression;
        else if (typeof expression === 'string') next.expression = expression;
        return next;
      }));
    };
    window.addEventListener('nexyfab:update-sketch-dimension', onDim);
    return () => window.removeEventListener('nexyfab:update-sketch-dimension', onDim);
  }, [sketchDimensions, setSketchDimensions]);

  // Sketch entity / dimension delete handlers — driven by the X button
  // in SketchLeftPane rows. Entity ids match sketchProfile.segments[].id
  // (or the synthetic `seg${i}` fallback used in the bridge writer).
  useEffect(() => {
    const onDeleteEntity = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      const id = ce.detail?.id;
      if (!id) return;
      const profile = useSceneStore.getState().sketchProfile;
      const filtered = profile.segments.filter((s, i) => (s.id ?? `seg${i}`) !== id);
      if (filtered.length === profile.segments.length) return;
      setSketchProfile({ ...profile, segments: filtered });
    };
    const onDeleteDim = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      const id = ce.detail?.id;
      if (!id) return;
      setSketchDimensions((sketchDimensions ?? []).filter((d, i) => {
        const dim = d as { id?: string };
        return (dim.id ?? `d${i + 1}`) !== id;
      }));
    };
    window.addEventListener('nexyfab:delete-sketch-entity', onDeleteEntity);
    window.addEventListener('nexyfab:delete-sketch-dimension', onDeleteDim);
    return () => {
      window.removeEventListener('nexyfab:delete-sketch-entity', onDeleteEntity);
      window.removeEventListener('nexyfab:delete-sketch-dimension', onDeleteDim);
    };
  }, [sketchDimensions, setSketchDimensions, setSketchProfile]);

  // Shell-v2 Feature tree row click → set selected feature so PropertyManager
  // updates and the highlight matches the tree state.
  useEffect(() => {
    const onSelect = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      if (ce.detail?.id) setSelectedId(ce.detail.id);
    };
    window.addEventListener('nexyfab:select-feature', onSelect);
    return () => window.removeEventListener('nexyfab:select-feature', onSelect);
  }, [setSelectedId]);

  // SCAD apply-to-tree → push a feature with caller-supplied params. Lets
  // ScadCodePanel translate `translate([x,y,z]) cube(...)` into a base
  // shape + moveCopy feature node without holding a useFeatureStack ref.
  useEffect(() => {
    const onAdd = (e: Event) => {
      const ce = e as CustomEvent<{ type: string; overrides?: Record<string, number> }>;
      const type = ce.detail?.type;
      if (!type) return;
      addFeatureWithParams(type as Parameters<typeof addFeatureWithParams>[0], ce.detail?.overrides ?? {});
    };
    window.addEventListener('nexyfab:add-feature', onAdd);
    return () => window.removeEventListener('nexyfab:add-feature', onAdd);
  }, [addFeatureWithParams]);

  // Shell-v2 Assembly tree row click — reuses the same selectedId so the
  // assembly browser / PropertyManager light up. Future work: a separate
  // assembly-selection store if more granular state is needed.
  useEffect(() => {
    const onAsm = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      if (ce.detail?.id) setSelectedId(ce.detail.id);
    };
    window.addEventListener('nexyfab:select-assembly', onAsm);
    return () => window.removeEventListener('nexyfab:select-assembly', onAsm);
  }, [setSelectedId]);

  // Push/Pull arrow on a sketchExtrude face → feature param drag. The
  // arrow lives in the Canvas tree and can't call updateFeatureParam
  // directly (it's a hook return, scoped to this component), so it fires
  // a window event we listen for here.
  useEffect(() => {
    const onUpdate = (e: Event) => {
      const ce = e as CustomEvent<{ featureId?: string; key?: string; value?: number }>;
      const { featureId, key, value } = ce.detail ?? {};
      if (!featureId || !key || typeof value !== 'number') return;
      // Tracked + coalesced: a push/pull drag emits many events for the same
      // (featureId, key) → ONE undo step on settle.
      updateFeatureParamCmd(featureId, key, value);
    };
    window.addEventListener('nexyfab:update-feature-param', onUpdate);
    return () => window.removeEventListener('nexyfab:update-feature-param', onUpdate);
  }, [updateFeatureParamCmd]);

  // Shell-v2 Components → Standard parts materialization. The grid emits a
  // resolved SCAD source; we POST it to /api/nexyfab/openscad-render to get
  // back an STL byte stream, parse with STLLoader, and push the resulting
  // mesh into placedParts so it shows up in the assembly viewport.
  useEffect(() => {
    const onInsert = async (e: Event) => {
      const ce = e as CustomEvent<{ id: string; title: string; standard: string; scad: string; params?: Record<string, unknown> }>;
      if (!ce.detail) return;
      addToast('info', `${ce.detail.title} 변환 중…`);
      try {
        const res = await fetch('/api/nexyfab/openscad-render', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'model/stl, application/octet-stream' },
          body: JSON.stringify({ scad: ce.detail.scad, format: 'stl' }),
        });
        if (!res.ok) {
          addToast('warning', `OpenSCAD 변환 실패 (${res.status})`);
          return;
        }
        const buf = await res.arrayBuffer();
        const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
        const geometry = new STLLoader().parse(buf);
        geometry.computeBoundingBox();
        geometry.computeVertexNormals();
        // Spread placement so multiple inserts don't overlap.
        const off = placedParts.length * 30;
        const newPart: PlacedPart = {
          id: `std-${ce.detail.id}-${Date.now().toString(36)}`,
          name: ce.detail.title,
          shapeId: `standard:${ce.detail.id}`,
          params: Object.fromEntries(
            Object.entries(ce.detail.params ?? {}).map(([k, v]) => [k, typeof v === 'number' ? v : 0]),
          ),
          qty: 1,
          position: [off, 0, 0],
          rotation: [0, 0, 0],
          color: '#8aa2c2',
        };
        // Build minimal ShapeResult — edgeGeometry stays as an empty
        // BufferGeometry; downstream rendering uses real edges via
        // computeVertexNormals on the parsed STL.
        const bb = geometry.boundingBox;
        const size = bb
          ? { w: bb.max.x - bb.min.x, h: bb.max.y - bb.min.y, d: bb.max.z - bb.min.z }
          : { w: 0, h: 0, d: 0 };
        const { EdgesGeometry, BufferGeometry } = await import('three');
        const result: ShapeResult = {
          geometry,
          edgeGeometry: new EdgesGeometry(geometry, 15) as BufferGeometry,
          bbox: size,
          volume_cm3: 0,
          surface_area_cm2: 0,
        };
        // Attach geometry via the BomPart sync (placedPart → bomPart mapper).
        // Cleanest path is to extend placedPartsToBomResults; for v1 we push
        // an inline bomPart entry with the parsed geometry.
        const bomEntry = { name: newPart.name, result, position: newPart.position, rotation: newPart.rotation, color: newPart.color };
        // Phase A undo unification: COTS insert (placedPart + bom entry) is
        // ONE tracked undo step. bomParts is a plain useState array whose
        // entries lack ids, so the command matches the entry by reference.
        commandHistory.execute(makeInsertStandardPartCommand({
          commandId: `insert-standard-part-${newPart.id}`,
          label: `Insert ${ce.detail.title}`,
          labelKo: `${ce.detail.title} 삽입`,
          part: newPart,
          setParts: setPlacedParts,
          bomEntry,
          setBom: setBomParts,
        }));
        addToast('success', `${ce.detail.title} 어셈블리에 추가됨`);
      } catch (err) {
        console.error('Standard part materialize failed', err);
        addToast('warning', `${ce.detail.title} 변환 오류`);
      }
    };
    window.addEventListener('nexyfab:insert-standard-part', onInsert as EventListener);
    return () => window.removeEventListener('nexyfab:insert-standard-part', onInsert as EventListener);
  }, [addToast, placedParts, setPlacedParts, setBomParts]);

  // Shell-v2 Sheet Metal ribbon tools → feature stack. Each tool dispatches
  // an event we map onto the corresponding sheetMetal feature addition.
  useEffect(() => {
    const onSheetMetalTool = (e: Event) => {
      const ce = e as CustomEvent<{ tool: string }>;
      const tool = ce.detail?.tool;
      if (!tool) return;
      const baseParams = { thickness: 1.5, material: 0 };
      switch (tool) {
        case 'sm.edge-flange':
        case 'sm.miter-flange':
          addFeatureWithParams('flange', { ...baseParams, height: 10, angle: 90, radius: 1.5, edgeIndex: 0 });
          addToast('info', 'Edge flange 추가됨');
          break;
        case 'sm.bend':
          addFeatureWithParams('bend', { ...baseParams, angle: 90, radius: 1.5, position: 0.5, direction: 0 });
          addToast('info', 'Bend 추가됨');
          break;
        // Tab — flat rectangular protrusion grown from a sheet edge
        // (undoable through the command-history wrapper, then tunable in
        // FeatureParams like every other feature).
        case 'sm.tab':
          addFeatureWithParamsAndContext('tab', { width: 20, length: 10, position: 50, edgeIndex: 0 });
          addToast('info', 'Tab 추가됨 — 피처 파라미터에서 폭/길이/위치 조정');
          break;
        // Hem — the hem feature has existed in the registry; this finally
        // routes the ribbon button to it (closed hem on the +Z edge by
        // default; type/length/edge editable in FeatureParams).
        case 'sm.hem':
          addFeatureWithParamsAndContext('hem', { hemType: 0, length: 6, edgeIndex: 0 });
          addToast('info', 'Hem 추가됨 — 피처 파라미터에서 종류/길이 조정');
          break;
        // Bend relief — notch pair at both ends of the bend line. Add it
        // BEFORE the bend at the same position % so the notches line up.
        case 'sm.bend-relief':
          addFeatureWithParamsAndContext('bendRelief', { width: 3, depth: 5, position: 50, shape: 0 });
          addToast('info', 'Bend relief 추가됨 — 굽힘과 같은 위치%로 정렬하세요');
          break;
        // Corner relief — circular cut centered on a sheet corner where
        // two flange bend lines meet.
        case 'sm.corner-relief':
          addFeatureWithParamsAndContext('cornerRelief', { corner: 0, shape: 0, size: 4, inset: 0 });
          addToast('info', 'Corner relief 추가됨 — 코너/크기 조정 가능');
          break;
        // Cut — rectangular through-slot punched out of the sheet (a real CSG
        // feature now; size/position tunable in FeatureParams like any other).
        case 'sm.cut':
          addFeatureWithParamsAndContext('cut', { width: 20, length: 10, posX: 0, posZ: 0 });
          addToast('info', 'Cut 추가됨 — 피처 파라미터에서 크기/위치 조정');
          break;
        // Unbend — unfold the bent sheet to its flat developed state as a
        // feature in the stack (vs sm.flatten which opens the flat-pattern
        // panel for DXF export). Routes to the existing flatPattern builder.
        case 'sm.unbend':
          addFeatureWithParamsAndContext('flatPattern', { thickness: 1.5, material: 0 });
          addToast('info', 'Unbend(펼침) 추가됨 — 굽힘이 펴진 전개 상태');
          break;
        case 'sm.flatten':
          // Route through the nexyfab:tool 'flat-pattern' case, which opens
          // SheetMetalPanel (its Unfold tab hosts FlatPatternPanel).
          window.dispatchEvent(new CustomEvent('nexyfab:tool', { detail: { id: 'flat-pattern' } }));
          addToast('info', 'Flat pattern 열기');
          break;
        case 'sm.export-dxf':
          addToast('info', 'Flat pattern DXF — Flatten 후 다운로드 가능');
          break;
        default:
          addToast('info', `${tool} — 추후 구현`);
      }
    };
    window.addEventListener('nexyfab:sheet-metal-tool', onSheetMetalTool);
    return () => window.removeEventListener('nexyfab:sheet-metal-tool', onSheetMetalTool);
  }, [addFeatureWithParams, addFeatureWithParamsAndContext, addToast]);

  // Re-solve mates when a part's SHAPE or PARAMS change (resize / material /
  // shape swap) so the mates HOLD after an edit instead of going stale. We key
  // ONLY on shapeId + params — NOT position/rotation, since those are exactly
  // what the solver writes back, so keying on them would feed back into an
  // infinite solve loop.
  const placedPartParamSig = useMemo(
    () => placedParts.map(p => `${p.id}:${p.shapeId}:${JSON.stringify(p.params)}`).join('|'),
    [placedParts],
  );

  // Shell-v2 Assembly mate hookup → run v3 solver on every mate change.
  // Builds a v3 Mate spec from each AssemblyMate, seeds the current placed
  // parts as frames, runs solveMates, and writes the converged frames back.
  // First placed part is treated as fixed so the assembly has an anchor.
  useEffect(() => {
    if (assemblyMates.length === 0 || placedParts.length === 0) return;
    const partIds = placedParts.map(p => p.id);
    // Build a seed frame from current placedParts. Skip three.js for the
    // euler→quaternion conversion so we avoid pulling the full lib into
    // this code path. XYZ-extrinsic order matches THREE.Euler default.
    const eulerToQuat = (xDeg: number, yDeg: number, zDeg: number): [number, number, number, number] => {
      const x = (xDeg * Math.PI) / 360, y = (yDeg * Math.PI) / 360, z = (zDeg * Math.PI) / 360;
      const cx = Math.cos(x), sx = Math.sin(x);
      const cy = Math.cos(y), sy = Math.sin(y);
      const cz = Math.cos(z), sz = Math.sin(z);
      return [
        cx * cy * cz + sx * sy * sz, // w
        sx * cy * cz - cx * sy * sz, // x
        cx * sy * cz + sx * cy * sz, // y
        cx * cy * sz - sx * sy * cz, // z
      ];
    };
    const quatToEuler = (q: [number, number, number, number]): [number, number, number] => {
      const [w, x, y, z] = q;
      const sinrCosp = 2 * (w * x + y * z);
      const cosrCosp = 1 - 2 * (x * x + y * y);
      const xx = Math.atan2(sinrCosp, cosrCosp);
      const sinp = 2 * (w * y - z * x);
      const yy = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
      const sinyCosp = 2 * (w * z + x * y);
      const cosyCosp = 1 - 2 * (y * y + z * z);
      const zz = Math.atan2(sinyCosp, cosyCosp);
      return [(xx * 180) / Math.PI, (yy * 180) / Math.PI, (zz * 180) / Math.PI];
    };
    const seed: Record<string, { position: [number, number, number]; rotation: [number, number, number, number] }> = {};
    for (const p of placedParts) {
      seed[p.id] = {
        position: [...p.position] as [number, number, number],
        rotation: eulerToQuat(p.rotation[0], p.rotation[1], p.rotation[2]),
      };
    }
    // Translate mates → src/lib/assembly/api.ts's named-ref Mate spec, using
    // the built-in `origin`/`z_axis` refs every part gets for free — this is
    // the same "synthesise a canonical axis (Z) at the part origin" fallback
    // as before (accurate for symmetric parts, approximate otherwise), just
    // expressed as ref names instead of raw local positions.
    //
    // Migrated OFF `@/lib/nexyfab/assemblyMateSolver` (260723 dogfooding):
    // that module's position-correction step had an inverted sign
    // (`vsub(f.position, correction.dPos)` where the correction should be
    // ADDED, not subtracted) — every mate kind carrying a position term
    // (coincident/distance/concentric/limitDistance) DIVERGED instead of
    // converging (measured: B at x=40 exploded to x=303.75 after 5 iterations
    // toward a fixed A). Confirmed via a fresh cross-solver alignment test
    // (src/test/m3/mateSolversAlignment.test.ts) with zero prior test
    // coverage on that module. `src/lib/assembly/api.ts`'s `solveMates` is
    // the most heavily tested engine in the codebase (~7,400 test lines) and
    // was already the recommended consolidation target.
    const specMates: Array<{ id: string; kind: 'coincident' | 'concentric' | 'distance' | 'parallel' | 'angle'; a: { partId: string; refId: string }; b: { partId: string; refId: string }; value?: number }> = [];
    for (const m of assemblyMates) {
      if (!partIds.includes(m.partA) || !partIds.includes(m.partB)) continue;
      switch (m.type) {
        case 'coincident':
          specMates.push({ id: m.id, kind: 'coincident', a: { partId: m.partA, refId: 'origin' }, b: { partId: m.partB, refId: 'origin' } });
          break;
        case 'concentric':
          specMates.push({ id: m.id, kind: 'concentric', a: { partId: m.partA, refId: 'z_axis' }, b: { partId: m.partB, refId: 'z_axis' } });
          break;
        case 'distance':
          specMates.push({ id: m.id, kind: 'distance', a: { partId: m.partA, refId: 'origin' }, b: { partId: m.partB, refId: 'origin' }, value: m.value ?? 0 });
          break;
        case 'parallel':
          specMates.push({ id: m.id, kind: 'parallel', a: { partId: m.partA, refId: 'z_axis' }, b: { partId: m.partB, refId: 'z_axis' } });
          break;
        case 'angle':
          specMates.push({ id: m.id, kind: 'angle', a: { partId: m.partA, refId: 'z_axis' }, b: { partId: m.partB, refId: 'z_axis' }, value: m.value ?? 0 });
          break;
        // `gear` is a motion coupling (ratio between two revolute axes) —
        // it has no static-placement meaning, so the reactive re-solve skips
        // it; the kinematic drag loop (`kinematicDragSolve`) honors it.
        // `width` needs the two reference-face planes which this synthetic
        // origin-axis path doesn't carry; it solves through the geometry
        // path (`applyGeometryMatesToPlaced` / Solver tab) instead.
        // `limitDistance`/`limitAngle` (inequality mates) aren't in #1's
        // MateKind union yet — same honest skip as gear/width above, not a
        // regression (the retired module's limitDistance path had the same
        // divergence bug as coincident/distance, so this reactive re-solve
        // was never reliably honoring it either).
        default:
          break;
      }
    }
    if (specMates.length === 0) return;
    let cancelled = false;
    void import('@/lib/assembly/api').then(({ solveMates }) => {
      if (cancelled) return;
      const parts = placedParts.map((p, i) => ({
        partId: p.id,
        position: { x: seed[p.id]!.position[0], y: seed[p.id]!.position[1], z: seed[p.id]!.position[2] },
        orientation: { x: seed[p.id]!.rotation[1], y: seed[p.id]!.rotation[2], z: seed[p.id]!.rotation[3], w: seed[p.id]!.rotation[0] },
        fixed: i === 0,
      }));
      let result: ReturnType<typeof solveMates>;
      try {
        result = solveMates(parts, specMates);
      } catch {
        // A mate ref failed to resolve, or the assembly was otherwise
        // invalid (e.g. a duplicate id) — the same honest-refuse contract
        // as the retired module's non-convergence path, just surfaced as a
        // thrown error instead of a residual number.
        addToast('warning', 'Mate solver could not resolve this assembly.');
        return;
      }
      // Write converged frames back to placedParts as euler degrees.
      const updated = placedParts.map(p => {
        const f = result.partById.get(p.id);
        if (!f) return p;
        const q: [number, number, number, number] = [f.orientation.w, f.orientation.x, f.orientation.y, f.orientation.z];
        return {
          ...p,
          position: [f.position.x, f.position.y, f.position.z] as [number, number, number],
          rotation: quatToEuler(q),
        };
      });
      // Only commit if anything actually changed to avoid feedback loops.
      const changed = updated.some((p, i) => {
        const o = placedParts[i];
        return Math.abs(p.position[0] - o.position[0]) > 1e-3
          || Math.abs(p.position[1] - o.position[1]) > 1e-3
          || Math.abs(p.position[2] - o.position[2]) > 1e-3;
      });
      if (changed) setPlacedParts(updated);
      if (!result.converged && result.finalMaxResidual > 0.1) {
        addToast('warning', `Mate solver did not converge (residual ${result.finalMaxResidual.toFixed(2)} mm)`);
      }
    });
    return () => { cancelled = true; };
    // placedPartParamSig re-fires the solve when a part is resized/swapped so
    // mates hold; placedParts itself is intentionally NOT a dep (the solver
    // writes its position/rotation — depending on it would loop).

  }, [assemblyMates, placedPartParamSig]);

  // Shell-v2 BottomDrawer "Run →" buttons → existing uiStore-driven panels.
  // Inner's modal mounts (DFMPanel, FEAPanel, CostCopilotPanel, etc.) listen
  // to the same uiStore flags, so flipping them here opens the real panels.
  useEffect(() => {
    const onDfm = () => setShowDFM(true);
    const onFea = () => setShowFEA(true);
    const onCost = () => setShowCostPanel(true);
    const onVariants = () => setShowVariantsPanel(true);
    const onRfq = () => setShowRfqPanel(true);
    window.addEventListener('nexyfab:open-dfm', onDfm);
    window.addEventListener('nexyfab:open-fea', onFea);
    window.addEventListener('nexyfab:open-cost', onCost);
    window.addEventListener('nexyfab:open-variants', onVariants);
    window.addEventListener('nexyfab:open-rfq', onRfq);
    return () => {
      window.removeEventListener('nexyfab:open-dfm', onDfm);
      window.removeEventListener('nexyfab:open-fea', onFea);
      window.removeEventListener('nexyfab:open-cost', onCost);
      window.removeEventListener('nexyfab:open-variants', onVariants);
      window.removeEventListener('nexyfab:open-rfq', onRfq);
    };
  }, [setShowDFM, setShowFEA, setShowCostPanel, setShowVariantsPanel, setShowRfqPanel]);

  /** Sketch palette “slice guide” ↔ 3D section plane (X) when solid geometry exists. */
  useEffect(() => {
    if (!sketchPalSlice) return;
    const geo = effectiveResult?.geometry ?? result?.geometry;
    if (!geo) return;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;
    const sizeX = bb.max.x - bb.min.x;
    if (sizeX < 1e-9) return;
    const t = (sketchSlicePlaneMm - bb.min.x) / sizeX;
    setSectionOffset(Math.max(0, Math.min(1, t)));
    setSectionAxis('x');
    setSectionActive(true);
  }, [sketchPalSlice, sketchSlicePlaneMm, effectiveResult?.geometry, result?.geometry, setSectionOffset, setSectionAxis, setSectionActive]);

  // ── Live sketch geometry (Feature 5) ──
  const liveSketchGeo = useMemo(() => {
    if (!isSketchMode) return null;
    const outer = sketchProfiles[0] ?? sketchProfile;
    if (!outer.closed || outer.segments.length === 0) return null;
    try {
      if (sketchProfiles.length > 1) {
        const g = profileToGeometryMulti(sketchProfiles, sketchConfig);
        if (g && g.attributes.position && g.attributes.position.count > 0) return g;
      }
      const activeProfile = sketchProfiles[activeProfileIdx] ?? sketchProfile;
      if (!activeProfile.closed || activeProfile.segments.length === 0) return null;
      return profileToGeometry(activeProfile, sketchConfig);
    } catch {
      return null;
    }
  }, [isSketchMode, sketchProfiles, activeProfileIdx, sketchProfile, sketchConfig]);

  const liveSketchResult = useMemo(() => {
    if (!liveSketchGeo) return null;
    liveSketchGeo.computeBoundingBox();
    const bb = liveSketchGeo.boundingBox;
    if (!bb) return null;
    const size = bb.getSize(new Vector3());
    return {
      geometry: liveSketchGeo,
      edgeGeometry: makeEdges(liveSketchGeo),
      volume_cm3: meshVolume(liveSketchGeo) / 1000,
      surface_area_cm2: meshSurfaceArea(liveSketchGeo) / 100,
      bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) } } as import('./shapes').ShapeResult;
  }, [liveSketchGeo]);

  /** Same mesh as the right-hand ShapePreview (thermal/gen overlays, live sketch LOD). */
  const viewportShapeResult = useMemo(() => {
    const baseSrc = liveSketchResult ?? effectiveResult;
    if (!baseSrc) return null;
    const base =
      showThermalOverlay && thermalOverlayGeo && effectiveResult
        ? { ...effectiveResult, geometry: thermalOverlayGeo }
        : showGenOverlay && genDesignResult && effectiveResult
          ? { ...effectiveResult, geometry: genDesignResult }
          : baseSrc;
    if (paramDragging) return { ...base, edgeGeometry: undefined } as unknown as ShapeResult;
    return base;
  }, [
    liveSketchResult,
    effectiveResult,
    showThermalOverlay,
    thermalOverlayGeo,
    showGenOverlay,
    genDesignResult,
    paramDragging,
  ]);

  /** Single-viewport 3D in the main design column (avoids “only the side panel is 3D” after extrude). */
  const showMainWorkspacePreview =
    activeTab === 'design' &&
    !isSketchMode &&
    sketchViewMode !== 'drawing' &&
    viewportShapeResult !== null &&
    !multiView &&
    webglSupported;

  // ── D2: preserve face/edge selection across undo/redo when topology
  // matches. If the new geometry has a different triangle count than the
  // previous render the selection was made on, indices are stale and we
  // clear silently. Same triangle count → keep selection (it likely still
  // points at the same logical face since most parametric edits preserve
  // topology). Avoids the "wrong face highlighted after undo" bug that comes
  // from face indices referencing a disposed geometry.
  const lastTriCountRef = useRef<number>(-1);
  useEffect(() => {
    const pos = effectiveResult?.geometry?.attributes?.position;
    const triCount = pos ? pos.count / 3 : 0;
    const prevCount = lastTriCountRef.current;
    lastTriCountRef.current = triCount;
    if (prevCount < 0) return;            // first render — nothing to validate
    if (prevCount === triCount) return;   // topology unchanged
    if (!selectedElement) return;         // nothing to clear
    const indices = selectedElement.type === 'face'
      ? (selectedElement as FaceSelectionInfo).triangleIndices ?? []
      : selectedElement.type === 'multi'
      ? (selectedElement as import('./editing/selectionInfo').MultiSelectionInfo).allTriangleIndices ?? []
      : [];
    const allInBounds = indices.length > 0 && indices.every(i => i >= 0 && i < triCount);
    if (!allInBounds) {
      setSelectedElement(null);
    }
  }, [effectiveResult?.geometry, selectedElement]);

  // ── Geometry metrics for cost estimation ──
  const geometryMetrics = useMemo((): GeometryMetrics | null => {
    if (!effectiveResult) return null;
    const geo = effectiveResult.geometry;
    const pos = geo.attributes.position;
    const triCount = geo.index ? geo.index.count / 3 : (pos ? pos.count / 3 : 0);
    const bboxVol = effectiveResult.bbox.w * effectiveResult.bbox.h * effectiveResult.bbox.d;
    const complexity = bboxVol > 0 ? Math.min(triCount / (bboxVol * 0.01), 1) : 0.5;
    return {
      volume_cm3: effectiveResult.volume_cm3,
      surfaceArea_cm2: effectiveResult.surface_area_cm2,
      boundingBox: effectiveResult.bbox,
      complexity };
  }, [effectiveResult]);

  // ── Plugin system integration ──
  const { toolbarButtons: pluginToolbarButtons, customShapes: _pluginCustomShapes } = usePlugins({
    getSelectedShape: () => selectedId,
    getParams: () => params,
    getGeometry: () => effectiveResult?.geometry ?? null,
    setParam: (key, value) => setParam(key, value),
    // Plugin-driven feature additions go through the tracked variant so users
    // can Ctrl+Z them just like manually-added features (Round 26 Phase 2).
    addFeature: (type) => handleAddFeatureCmd(type as FeatureType),
    showToast: addToast });

  // ── Async boolean via Web Worker (for standalone boolean operations) ──
  const _handleBooleanAsync = useCallback(
    (geometry: BufferGeometry, boolParams: Record<string, number>) =>
      applyBooleanAsync(geometry, boolParams, performCSG),
    [performCSG],
  );

  // Build design context for AI chat (includes DFM/FEA/mass/cost for AI-aware advice)
  const designContext = useMemo(() => {
    // Mass: volume × material density (g/cm³)
    const mat = MATERIAL_PRESETS.find(m => m.id === materialId);
    const density = mat?.density ?? 2.7;
    const massG = effectiveResult ? effectiveResult.volume_cm3 * density : null;

    // Cost: cheapest process unit cost estimate (pure, fast)
    let estimatedUnitCostUSD: number | null = null;
    if (geometryMetrics) {
      try {
        const estimates = estimateCosts(geometryMetrics, materialId, [1]);
        if (estimates.length > 0) {
          const best = estimates.reduce((a, b) => a.unitCost < b.unitCost ? a : b);
          // Convert KRW → USD if needed (rough rate)
          estimatedUnitCostUSD = best.currency === 'KRW' ? best.unitCost / 1300 : best.unitCost;
        }
      } catch {
        // estimateCosts failure is non-fatal
      }
    }

    return {
      shapeId: isSketchMode ? null : selectedId,
      params: isSketchMode ? {} : { ...params },
      features: enabledFeaturesForContext,
      isSketchMode,
      hasSketchResult: !!sketchResult,
      bbox: effectiveResult ? effectiveResult.bbox : null,
      volume_cm3: effectiveResult ? effectiveResult.volume_cm3 : null,
      dfmScore: getBestDFMScore(dfmResults),
      dfmIssues: getTopDFMIssues(dfmResults, 5),
      feaMaxStressMPa: feaResult?.maxStress ?? null,
      feaSafetyFactor: feaResult?.safetyFactor ?? null,
      massG,
      estimatedUnitCostUSD: estimatedUnitCostUSD !== null ? Math.round(estimatedUnitCostUSD * 100) / 100 : null,
      selectedElement,
      selectionContext: selectionContextFromElement(selectedElement, {
        projectRevision: aiModelRevision,
        assemblyPath: highlightedPartId ? ['main', highlightedPartId] : ['main'],
        partInstanceId: highlightedPartId ?? undefined,
        bodyId: selectedId ?? undefined,
        featureId: selectedFeatureId ?? undefined,
      }),
    };
  }, [selectedId, params, enabledFeaturesForContext, isSketchMode, sketchResult, effectiveResult, dfmResults, feaResult, materialId, geometryMetrics, selectedElement, aiModelRevision, highlightedPartId, selectedFeatureId]);

  // Param-level DFM warnings: used by LeftPanel to show inline badges on sliders
  const dfmParamWarnings = useMemo(
    () => mapDFMToParams(dfmResults, params),
    [dfmResults, params],
  );

  // ── Proactive Advisor — auto-alerts on DFM/FEA degradation after idle ──
  useProactiveAdvisor({
    params,
    dfmResults,
    feaSafetyFactor: feaResult?.safetyFactor ?? null,
    dfmScore: getBestDFMScore(dfmResults),
    shapeId: selectedId,
    lang,
    addToast,
    onOpenAdvisor: () => openAIAssistant('chat') });

  // ── Auto-DFM: debounced background analysis whenever geometry changes ────────
  // Runs with default cnc_milling + injection_molding, updates dfmResults silently.
  // Badge on the DFM toolbar button reflects error/warning count from this run.
  useEffect(() => {
    if (!effectiveResult?.geometry) return;
    if (!dfmAnalysisAllowed(useAuthStore.getState().user?.plan)) return;
    // Crash safety: skip the AUTOMATIC background DFM on heavy meshes (large
    // imported STEP/STL). Running the full multi-process analysis on tens of
    // thousands of triangles right after import competes with the import's own
    // BVH/CSG work and can push the tab to a WebGL-context-loss / OOM
    // "unexpected exit". The manual DFM button still runs the full analysis.
    const _geo = effectiveResult.geometry;
    const _tris = _geo.index ? _geo.index.count / 3 : (_geo.attributes.position?.count ?? 0) / 3;
    if (_tris > 50000) {
      // Too heavy for the automatic background pass — nudge the user to run DFM
      // manually (once per model), since the silent skip otherwise looks like
      // "DFM doesn't work on my import".
      if (heavyDfmHintRef.current !== _geo.uuid) {
        heavyDfmHintRef.current = _geo.uuid;
        const k = Math.round(_tris / 1000);
        addToast('info', lang === 'ko'
          ? `무거운 모델(약 ${k}k 삼각형) — 자동 DFM은 건너뜁니다. 도구 모음의 DFM 버튼으로 직접 실행하세요.`
          : `Heavy model (~${k}k triangles) — auto DFM is skipped. Run it manually from the DFM toolbar button.`);
      }
      return;
    }
    const timer = setTimeout(async () => {
      if (!dfmAnalysisAllowed(useAuthStore.getState().user?.plan)) return;
      try {
        // Process-aware DFM (§13 #1): imported meshes (STL/STEP of unknown
        // process — often welded/fabricated assemblies) must not be judged by
        // injection-molding rules, or they get false undercut/draft-angle
        // badges. Molding checks stay on for parametric NexyFab shapes only.
        const isImportedMesh = effectiveResult.geometry!.userData?.nfImported === true;
        const results = await analyzeDFMWorker(
          effectiveResult.geometry!,
          isImportedMesh ? ['cnc_milling'] : ['cnc_milling', 'injection_molding'],
          { minWallThickness: 1.0, minDraftAngle: 1.0, maxAspectRatio: 4.0 },
        );
        setDfmResults(results);
        consumeFreeDfmCreditIfUnpaid(useAuthStore.getState().user?.plan);
      } catch {
        // silent — user can manually trigger full analysis
      }
    }, 1800);
    return () => clearTimeout(timer);
  }, [effectiveResult, analyzeDFMWorker, authUser?.plan, setDfmResults, addToast, lang]);

  // Count of DFM error/warning issues from last analysis (drives toolbar badge)
  const dfmIssueCount = useMemo(
    () => dfmResults ? dfmResults.reduce((n, r) => n + r.issues.filter(i => i.severity !== 'info').length, 0) : 0,
    [dfmResults],
  );

  // Shell-v2 bridge: publish the REAL DFM warning count so the Inspector
  // ANALYZE row shows actual numbers (null until the first analysis lands).
  const bridgeDfmWarningCount = useShellBridge(s => s.setDfmWarningCount);
  useEffect(() => {
    bridgeDfmWarningCount(dfmResults !== null ? dfmIssueCount : null);
  }, [dfmResults, dfmIssueCount, bridgeDfmWarningCount]);

  // ── REST-based DFM warnings (debounced 800ms, supplements worker-based analysis) ──
  // Used on free plan (worker DFM disabled) or before worker completes its first run.
  const dfmWarnings = useDfmWarnings(
    // Only pass params when there is geometry; skip when no shape is loaded
    effectiveResult?.geometry ? params : null,
  );
  // Combine: prefer worker result count when available, fall back to REST-based
  const dfmBadgeCount = dfmResults !== null ? dfmIssueCount : dfmWarnings.issues + dfmWarnings.warnings;
  const dfmBadgeRunning = dfmWorkerLoading || dfmWarnings.loading;

  // Process recommendation based on used feature types + geometry
  const processRecommendations = useProcessRecommendation(
    features,
    effectiveResult?.geometry ?? null,
  );

  // ── Manufacturing flow (extracted hook) ──
  const {
    showManufacturingCard, setShowManufacturingCard,
    showManufacturerMatch, setShowManufacturerMatch,
    rfqPending,
    handleGetQuote } = useManufacturingFlow({
    effectiveResult,
    selectedId,
    sketchResult,
    materialId,
    dfmResults,
    planLimits,
    lang,
    langSeg,
    addToast,
    router,
    setShowUpgradePrompt,
    setUpgradeFeature });

  // ── IP Share flow (extracted hook) ──
  const {
    isCreatingShare,
    shareUrl,
    showShareConfirm, setShowShareConfirm,
    handleIPShare,
    copyShareUrl,
    resetShare } = useIPShareFlow(effectiveResult, authUser, lang, addToast);

  const handleAddToCart = useCallback(() => {
    if (!effectiveResult) return;
    if (!checkCartLimit(cartItems.length)) return;
    const thumbnail = captureRef.current ? captureRef.current() : null;
    const shapeName = sketchResult ? 'Custom Sketch' : (shapeLabels[`shapeName_${selectedId}`] || selectedId);
    addCartItem({
      shapeId: sketchResult ? 'sketch' : selectedId, shapeName, params: sketchResult ? {} : { ...params },
      featureCount: features.filter(f => f.enabled).length, thumbnail,
      volume_cm3: effectiveResult.volume_cm3, surface_area_cm2: effectiveResult.surface_area_cm2, bbox: effectiveResult.bbox });
    setCartAdded(true);
    setTimeout(() => setCartAdded(false), 1500);
  }, [effectiveResult, sketchResult, selectedId, params, features, t, addCartItem, cartItems.length, checkCartLimit]);

  const handleChatApplySingle = useCallback((r: SingleResult) => {
    if (!r.shapeId) return;
    const shapeDef = SHAPE_MAP[r.shapeId];
    if (!shapeDef) {
      addToast('warning', lt.shapeNotFound(r.shapeId));
      return;
    }
    // Exit sketch mode and show the parametric shape
    setIsSketchMode(false);
    setShowAIAssistant(false);
    sidebarLayout.setRightCollapsed(true); // Automatically close the right sidebar for immediate 3D focus
    setSketchResult(null);
    setBomParts([]); setBomLabel('');
    const mergeFrom =
      shapeDef.formulaFields?.length && r.shapeId === selectedId
        ? useSceneStore.getState().paramExpressions
        : undefined;
    setSelectedId(r.shapeId);
    const { unknownKeys } = applySceneParamsToSetters(
      shapeDef,
      r.params,
      { setParams, setParamExpressions },
      mergeFrom ? { mergeExpressionsFrom: mergeFrom } : undefined,
    );
    if (unknownKeys.length > 0) {
      const detail = unknownKeys.slice(0, 12).join(', ') + (unknownKeys.length > 12 ? '…' : '');
      addToast('warning', lt.ignoredUnknownParams(detail));
    }
    clearAll(); setSelectedFeatureId(null);
    if (r.features?.length > 0) setTimeout(() => { r.features.forEach(f => addFeature(f.type)); }, 50);
  }, [clearAll, addFeature, addToast, lang, sidebarLayout, lt, setParams, setParamExpressions, selectedId]);

  const generatePartResult = useCallback((shapeId: string, partParams: Record<string, number>, partFeatures?: Array<{ type: FeatureType; params: Record<string, number> }>): ShapeResult | null => {
    const shapeDef = SHAPE_MAP[shapeId];
    if (!shapeDef) return null;
    const { params: p } = normalizeShapeParams(shapeDef, partParams);
    try {
      const baseResult = shapeDef.generate(p);
      // Apply features if provided
      if (partFeatures && partFeatures.length > 0) {
        try {
          const featureStack = partFeatures.map((f, i) => ({
            id: `bom-feat-${i}`, type: f.type, params: f.params, enabled: true }));
          const finalGeo = applyFeaturePipeline(baseResult.geometry, featureStack);
          const edgeGeometry = makeEdges(finalGeo);
          const volume_cm3 = meshVolume(finalGeo) / 1000;
          const surface_area_cm2 = meshSurfaceArea(finalGeo) / 100;
          finalGeo.computeBoundingBox();
          const bb = finalGeo.boundingBox;
          if (!bb) return baseResult;
          const size = bb.getSize(new Vector3());
          const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
          return { geometry: finalGeo, edgeGeometry, volume_cm3, surface_area_cm2, bbox };
        } catch (err) {
          console.error('[FeaturePipeline] apply failed:', err);
          const msg = err instanceof Error ? err.message : String(err);
          addToast('warning', lt.pipelineFailed(msg));
          return baseResult;
        }
      }
      return baseResult;
    } catch { return null; }
  }, [lt, addToast]);

  const handleChatApplyBom = useCallback((parts: Array<{ name: string; shapeId: string; params: Record<string, number>; features: Array<{ type: FeatureType; params: Record<string, number> }>; quantity: number; position?: [number, number, number]; rotation?: [number, number, number] }>, productName?: string) => {
    // Exit sketch mode and show the assembly
    setIsSketchMode(false);
    setShowAIAssistant(false);
    setSketchResult(null);
    const bomResults: BomPartResult[] = [];
    const unknownAgg: string[] = [];
    for (const part of parts) {
      const shapeDef = SHAPE_MAP[part.shapeId];
      if (shapeDef) {
        const { unknownKeys } = normalizeShapeParams(shapeDef, part.params);
        for (const k of unknownKeys) unknownAgg.push(`${part.name}: ${k}`);
      }
      const sr = generatePartResult(part.shapeId, part.params, part.features);
      if (!sr) continue;
      bomResults.push({ name: part.name, result: sr, position: part.position, rotation: part.rotation });
      const qty = part.quantity || 1;
      for (let q = 0; q < qty; q++) {
        addCartItem({ shapeId: part.shapeId, shapeName: qty > 1 ? `${part.name} #${q + 1}` : part.name, params: part.params, featureCount: part.features?.length || 0, thumbnail: null, volume_cm3: sr.volume_cm3, surface_area_cm2: sr.surface_area_cm2, bbox: sr.bbox });
      }
    }
    setBomParts(bomResults);
    setBomLabel(productName || 'Assembly');
    if (unknownAgg.length > 0) {
      const msg = unknownAgg.slice(0, 10).join('; ') + (unknownAgg.length > 10 ? '…' : '');
      addToast('warning', lt.ignoredUnknownParams(msg));
    }
    if (parts.length > 0) {
      const first = parts[0];
      const firstSd = SHAPE_MAP[first.shapeId];
      const mergeFrom =
        firstSd?.formulaFields?.length && first.shapeId === selectedId
          ? useSceneStore.getState().paramExpressions
          : undefined;
      setSelectedId(first.shapeId);
      applySceneParamsToSetters(
        firstSd,
        first.params,
        { setParams, setParamExpressions },
        mergeFrom ? { mergeExpressionsFrom: mergeFrom } : undefined,
      );
      clearAll(); setSelectedFeatureId(null);
    }
  }, [generatePartResult, addCartItem, clearAll, addToast, lt, setParams, setParamExpressions, selectedId]);

  const handleBomPreview = useCallback((parts: Array<{ name: string; shapeId: string; params: Record<string, number>; features?: Array<{ type: FeatureType; params: Record<string, number> }>; position?: [number, number, number]; rotation?: [number, number, number] }>, productName: string) => {
    // Exit sketch mode to show 3D assembly
    setIsSketchMode(false);
    setShowAIAssistant(false);
    setSketchResult(null);
    const bomResults: BomPartResult[] = [];
    const unknownAgg: string[] = [];
    for (const part of parts) {
      const shapeDef = SHAPE_MAP[part.shapeId];
      if (shapeDef) {
        const { unknownKeys } = normalizeShapeParams(shapeDef, part.params);
        for (const k of unknownKeys) unknownAgg.push(`${part.name}: ${k}`);
      }
      const sr = generatePartResult(part.shapeId, part.params, part.features);
      if (sr) bomResults.push({ name: part.name, result: sr, position: part.position, rotation: part.rotation });
    }
    setBomParts(bomResults);
    setBomLabel(productName || 'Assembly');
    if (unknownAgg.length > 0) {
      const msg = unknownAgg.slice(0, 10).join('; ') + (unknownAgg.length > 10 ? '…' : '');
      addToast('warning', lt.ignoredUnknownParams(msg));
    }
  }, [generatePartResult, addToast, lt]);

  const handleBatchQuote = useCallback(() => {
    if (cartItems.length === 0) return;
    router.push(`/${langSeg}/quick-quote/?from=shape-cart&count=${cartItems.length}`);
  }, [cartItems, langSeg, router]);

  // ── Export loading state ──
  const [exportingFormat, setExportingFormat] = React.useState<string | null>(null);

  // ── BOM Export ──
  // (showBomExportMenu moved to useShapeGeneratorUI)
  const buildBomRows = useCallback((): BomRow[] => {
    const rows: BomRow[] = [];
    if (bomParts.length > 0) {
      bomParts.forEach((part) => {
        const r = part.result;
        const mat = materialId;
        rows.push({ no: rows.length + 1, name: part.name, shape: part.name, material: mat, dimensions: `${r.bbox.w.toFixed(1)}\u00d7${r.bbox.h.toFixed(1)}\u00d7${r.bbox.d.toFixed(1)} mm`, volume_cm3: r.volume_cm3, surface_area_cm2: r.surface_area_cm2, weight_g: estimateWeight(r.volume_cm3, mat), quantity: 1 });
      });
    }
    if (cartItems.length > 0) {
      cartItems.forEach((item) => {
        const mat = materialId;
        rows.push({ no: rows.length + 1, name: item.shapeName, shape: item.shapeId, material: mat, dimensions: `${item.bbox.w.toFixed(1)}\u00d7${item.bbox.h.toFixed(1)}\u00d7${item.bbox.d.toFixed(1)} mm`, volume_cm3: item.volume_cm3, surface_area_cm2: item.surface_area_cm2, weight_g: estimateWeight(item.volume_cm3, mat), quantity: 1 });
      });
    }
    if (rows.length === 0 && effectiveResult) {
      const sn = sketchResult ? 'Custom Sketch' : (shapeLabels[`shapeName_${selectedId}`] || selectedId);
      const mat = materialId;
      rows.push({ no: 1, name: sn, shape: sketchResult ? 'sketch' : selectedId, material: mat, dimensions: `${effectiveResult.bbox.w.toFixed(1)}\u00d7${effectiveResult.bbox.h.toFixed(1)}\u00d7${effectiveResult.bbox.d.toFixed(1)} mm`, volume_cm3: effectiveResult.volume_cm3, surface_area_cm2: effectiveResult.surface_area_cm2, weight_g: estimateWeight(effectiveResult.volume_cm3, mat), quantity: 1 });
    }
    return rows;
  }, [bomParts, cartItems, effectiveResult, sketchResult, selectedId, t, materialId]);
  const handleExportBomCSV = useCallback(async () => {
    const rows = buildBomRows();
    if (rows.length === 0) return;
    await exportBomCSV(rows, `BOM_${bomLabel || 'export'}.csv`);
    setShowBomExportMenu(false);
  }, [buildBomRows, bomLabel]);
  const handleExportBomExcel = useCallback(async () => {
    const rows = buildBomRows();
    if (rows.length === 0) return;
    await exportBomExcel(rows, `BOM_${bomLabel || 'export'}.xls`);
    setShowBomExportMenu(false);
  }, [buildBomRows, bomLabel]);

  // ══════════════════════════════════════════════════════════════════════════
  // SKETCH HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleSketchGenerate = useCallback(() => {
    // ── Pre-validate sketch profile(s) before extrusion ──
    const validateProfile = (p: { segments: SketchSegment[]; closed: boolean }) => {
      if (p.segments.length === 0) return { ok: false, reason: 'empty' as const };
      if (p.segments.length < 3 && !p.closed) return { ok: false, reason: 'too_few' as const };
      if (!p.closed) return { ok: false, reason: 'open' as const };
      // Endpoint coincidence check (in case `closed` flag is stale)
      const firstSeg = p.segments[0];
      const lastSeg = p.segments[p.segments.length - 1];
      const firstPt = firstSeg.points?.[0];
      const lastPt = lastSeg.points?.[lastSeg.points.length - 1];
      if (firstPt && lastPt) {
        const dx = firstPt.x - lastPt.x;
        const dy = firstPt.y - lastPt.y;
        if (Math.hypot(dx, dy) > 0.01) return { ok: false, reason: 'gap' as const };
      }
      return { ok: true as const };
    };
    const profilesToCheck = sketchProfiles.length > 1 ? sketchProfiles : [sketchProfile];
    for (let i = 0; i < profilesToCheck.length; i++) {
      const v = validateProfile(profilesToCheck[i]);
      if (!v.ok) {
        const where = profilesToCheck.length > 1 ? ` (Profile ${i + 1})` : '';
        const msg = v.reason === 'empty' ? lt.sketchEmpty(where)
          : v.reason === 'too_few' ? lt.sketchTooFew(where)
          : v.reason === 'gap' ? lt.sketchGap(where)
          : lt.sketchNotClosed(where);
        addToast('warning', msg);
        return;
      }
    }
    // Use multi-profile geometry when more than one profile exists, else fall back
    const geo = sketchProfiles.length > 1
      ? profileToGeometryMulti(sketchProfiles, sketchConfig)
      : profileToGeometry(sketchProfile, sketchConfig);
    if (!geo) {
      addToast('warning', lt.sketchGeometryFailed);
      return;
    }

    // B-rep chain for a multi-contour sketch (outer + holes drawn in one sketch):
    // build a real replicad solid (extrude outer, cut each hole) and attach its
    // handle so downstream OCCT fillet/chamfer/hole operate on the true solid
    // instead of its bounding box. Mesh display above is untouched; handle-only
    // attach, gated + try/catch with a no-handle fallback (zero regression).
    if (
      sketchProfiles.length > 1
      && sketchPlane === 'xy'
      && sketchConfig.mode === 'extrude'
      && isOcctReadySync()
      && isOcctGlobalModeSync()
    ) {
      try {
        // Convert each contour to polygon points (circle holes sampled to 48-gon).
        const toPts = (p: typeof sketchProfile): { x: number; y: number }[] | null => {
          const pts = brepContourPoints(p);
          if (pts) return pts;
          const s = p.segments;
          if (s.length === 1 && s[0].type === 'circle') {
            const c = s[0].points[0], rim = s[0].points[1];
            const r = Math.hypot(rim.x - c.x, rim.y - c.y);
            if (r > 0) {
              const out: { x: number; y: number }[] = [];
              for (let i = 0; i < 48; i++) { const t = (i / 48) * Math.PI * 2; out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }); }
              return out;
            }
          }
          return null;
        };
        const outerPts = toPts(sketchProfiles[0]);
        const holePts = sketchProfiles.slice(1).map(toPts).filter((p): p is { x: number; y: number }[] => p !== null);
        if (outerPts && holePts.length > 0) {
          const brep = occtExtrudeWithHoles(outerPts, holePts, sketchConfig.depth ?? 0, {}, 0);
          if (brep.handle) geo.userData = { ...geo.userData, occtHandle: brep.handle };
        }
      } catch { /* keep mesh result without a handle */ }
    }
    const edgeGeometry = makeEdges(geo);
    const volume_cm3 = meshVolume(geo) / 1000;
    const surface_area_cm2 = meshSurfaceArea(geo) / 100;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;
    const size = bb.getSize(new Vector3());
    const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
    setBomParts([]); setBomLabel('');
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3, surface_area_cm2, bbox });

    // Save to sketch history when there is meaningful content
    if (sketchProfile.segments.length > 0) {
      const histEntry: SketchHistoryEntry = {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : `sh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        profile: sketchProfile,
        config: sketchConfig,
        plane: sketchPlane,
        timestamp: Date.now(),
        thumbnail: generateSketchThumbnail(sketchProfile),
        label: `Sketch ${sketchHistory.length + 1}` };
      setSketchHistory(prev => {
        const updated = [...prev, histEntry].slice(-20);
        saveSketchHistory(updated);
        return updated;
      });
    }

    setEditingSketchFeatureId(null);
    setSketchStep('draw'); // 3D 생성 완료 후 다음 진입을 위해 리셋
    sketchGeneratedRef.current = true;
    setIsSketchMode(false);
    setShowManufacturingCard(true);

    // #wf1: Guide user to next step after sketch generation
    addToast('success', lt.shapeGeneratedGuide, 5000);

    // Auto-save to cloud (fire-and-forget, only when logged in)
    if (useAuthStore.getState().user) {
      void useProjectsStore.getState().saveProject({
        name: `Sketch ${new Date().toLocaleDateString('ko-KR')}`,
        shapeId: 'sketch',
        tags: ['sketch'] });
    }
  }, [sketchProfile, sketchProfiles, sketchConfig, sketchPlane, sketchHistory]);

  // #wf10: context-restore toast when exiting sketch mode without generating
  const prevIsSketchModeRef = useRef(false);
  const sketchGeneratedRef = useRef(false);
  const sketchProfileRef = useRef(sketchProfile);
  sketchProfileRef.current = sketchProfile;
  const addToastRef = useRef(addToast);
  addToastRef.current = addToast;
  useEffect(() => {
    if (prevIsSketchModeRef.current && !isSketchMode) {
      if (!sketchGeneratedRef.current) {
        const hasSegments = sketchProfileRef.current.segments.length > 0;
        if (hasSegments) {
          addToastRef.current('info', (LOCAL_LABELS[langRef.current] ?? LOCAL_LABELS.en).sketchModeExitPreserved, 4000);
        }
      }
      sketchGeneratedRef.current = false;
    }
    prevIsSketchModeRef.current = isSketchMode;
  }, [isSketchMode]);

  // ── Sketch undo/redo stack (session-scoped; covers profiles + constraints + dimensions) ──
  //
  // Undo Phase B note: this stack is deliberately KEPT separate from
  // commandHistory. Sketch mode is a modal editing session — Ctrl+Z inside it
  // is routed to handleSketchUndo by the sketch editor / useKeyboardShortcuts
  // (never to the global commandHistory drain). Unifying onto commandHistory
  // would break two invariants:
  //   1. Scope: once the in-session entries were exhausted, a unified Ctrl+Z
  //      would walk past the sketch-entry boundary and undo pre-sketch
  //      modeling commands while the sketch UI is still open (mode/state
  //      corruption — e.g. undoing a shape switch under an open sketch).
  //   2. Granularity: in-sketch micro-edits (per-segment draws, drag-solve
  //      gestures via onPointDragStart — one snapshot per gesture) would
  //      flood the document history shown in HistoryPanel.
  // This stack dies with the session and never duplicated the legacy
  // useHistory stack, so retiring that stack does not affect it. (The
  // session's exit paths — setSketchResult / addSketchFeature — are
  // document-level mutations that remain untracked today; making "finish
  // sketch" a single commandHistory step is a separate follow-up.)
  type SketchSnapshot = {
    profiles: SketchProfile[];
    constraints: SketchConstraint[];
    dimensions: SketchDimension[];
    activeIdx: number;
  };
  const sketchUndoRef = useRef<SketchSnapshot[]>([]);
  const sketchRedoRef = useRef<SketchSnapshot[]>([]);

  const captureSketchSnapshot = useCallback(() => {
    sketchUndoRef.current = [
      ...sketchUndoRef.current.slice(-49),
      {
        profiles: sketchProfiles,
        constraints: sketchConstraints,
        dimensions: sketchDimensions,
        activeIdx: activeProfileIdx }
    ];
    sketchRedoRef.current = []; // clear redo branch on new action
   
  }, [sketchProfiles, sketchConstraints, sketchDimensions, activeProfileIdx]);

  const handleSketchUndo = useCallback(() => {
    const snap = sketchUndoRef.current.pop();
    if (!snap) return;
    sketchRedoRef.current.push({
      profiles: sketchProfiles,
      constraints: sketchConstraints,
      dimensions: sketchDimensions,
      activeIdx: activeProfileIdx });
    setSketchProfiles(snap.profiles);
    setSketchProfile(snap.profiles[snap.activeIdx] ?? { segments: [], closed: false });
    setSketchConstraints(snap.constraints);
    setSketchDimensions(snap.dimensions);
    setActiveProfileIdx(snap.activeIdx);
  }, [sketchProfiles, sketchConstraints, sketchDimensions, activeProfileIdx, setSketchProfile, setSketchProfiles, setSketchConstraints, setSketchDimensions, setActiveProfileIdx]);

  const handleSketchRedo = useCallback(() => {
    const snap = sketchRedoRef.current.pop();
    if (!snap) return;
    sketchUndoRef.current.push({
      profiles: sketchProfiles,
      constraints: sketchConstraints,
      dimensions: sketchDimensions,
      activeIdx: activeProfileIdx });
    setSketchProfiles(snap.profiles);
    setSketchProfile(snap.profiles[snap.activeIdx] ?? { segments: [], closed: false });
    setSketchConstraints(snap.constraints);
    setSketchDimensions(snap.dimensions);
    setActiveProfileIdx(snap.activeIdx);
  }, [sketchProfiles, sketchConstraints, sketchDimensions, activeProfileIdx, setSketchProfile, setSketchProfiles, setSketchConstraints, setSketchDimensions, setActiveProfileIdx]);

  const handleSketchClear = useCallback(() => {
    setSketchProfile({ segments: [], closed: false });
    // Also clear all profiles in the multi-profile state and reset to a single empty profile
    setSketchProfiles([{ segments: [], closed: false }]);
    setActiveProfileIdx(0);
  }, []);

  // ── Multi-profile handlers ──
  const handleAddHoleProfile = useCallback(() => {
    setSketchProfiles(prev => {
      const next = [...prev, { segments: [], closed: false }];
      setActiveProfileIdx(next.length - 1);
      return next;
    });
  }, []);

  /** Append a finished closed loop as a new hole profile (avoids bridging two loops in one segment list). */
  const handleAddClosedLoopAsNewProfile = useCallback((holeProfile: SketchProfile) => {
    captureSketchSnapshot();
    setSketchProfiles(prev => {
      const next = [...prev, holeProfile];
      setActiveProfileIdx(next.length - 1);
      setSketchProfile(holeProfile);
      return next;
    });
  }, [captureSketchSnapshot, setSketchProfile]);

  const handleDeleteProfile = useCallback((idx: number) => {
    if (idx === 0) return; // Cannot delete the outer profile
    setSketchProfiles(prev => {
      const next = prev.filter((_, i) => i !== idx);
      return next;
    });
    setActiveProfileIdx(prev => (prev >= idx ? Math.max(0, prev - 1) : prev));
  }, []);

  const handleSetActiveProfile = useCallback((idx: number) => {
    setActiveProfileIdx(idx);
    // Sync the sketchProfile store with the newly active profile
    setSketchProfiles(prev => {
      setSketchProfile(prev[idx] ?? { segments: [], closed: false });
      return prev;
    });
  }, [setSketchProfile]);

  // ── Constraint handlers ──
  const handleAddConstraint = useCallback((c: SketchConstraint) => {
    captureSketchSnapshot();
    setSketchConstraints(prev => [...prev, c]);
  }, [captureSketchSnapshot, setSketchConstraints]);

  const handleRemoveConstraint = useCallback((id: string) => {
    captureSketchSnapshot();
    setSketchConstraints(prev => prev.filter(c => c.id !== id));
  }, [captureSketchSnapshot, setSketchConstraints]);

  const handleAddDimension = useCallback((d: SketchDimension) => {
    captureSketchSnapshot();
    setSketchDimensions(prev => [...prev, d]);
  }, [captureSketchSnapshot, setSketchDimensions]);

  const handleRemoveDimension = useCallback((id: string) => {
    setSketchDimensions(prev => prev.filter(d => d.id !== id));
  }, []);

  const handleDimensionChange = useCallback((id: string, value: number) => {
    setSketchDimensions(prev => prev.map(d => d.id === id ? { ...d, value } : d));
  }, []);

  const handleSolveConstraints = useCallback(() => {
    const activeProfile = sketchProfiles[activeProfileIdx] ?? sketchProfile;
    if (activeProfile.segments.length === 0) return;
    const pts = activeProfile.segments.flatMap(s => s.points);
    const pf = preflightSketchConstraints(pts, sketchConstraints);
    if (autoSolve && pf.warningCodes.includes('large_constraint_set') && !sketchLargeConstraintAutoSolveNotifiedRef.current) {
      sketchLargeConstraintAutoSolveNotifiedRef.current = true;
      reportWarning('constraint_solver', new Error('sketch_large_constraint_set'), {
        constraintCount: pf.constraintCount,
        pointCount: pf.pointCount,
      });
      if (!getSuppressCadPerfToasts()) {
        addToast('info', lt.sketchLargeConstraintInfo);
      }
    }
    if (!autoSolve) {
      const suppressPerf = getSuppressCadPerfToasts();
      for (const code of pf.warningCodes) {
        if (code === 'points_no_constraints') addToast('warning', lt.sketchPreflightPointsNoConstraints);
        else if (code === 'constraints_no_points') addToast('warning', lt.sketchPreflightConstraintsNoPoints);
        else if (code === 'large_constraint_set' && !suppressPerf) addToast('warning', lt.sketchPreflightLargeConstraintSet);
      }
    }
    const solveT0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const result = solveConstraints(activeProfile.segments, sketchConstraints, sketchDimensions);
    const solveMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - solveT0;
    // Apply solved point positions back into segments
    const solvedSegments = activeProfile.segments.map(seg => ({
      ...seg,
      points: seg.points.map(p => {
        if (p.id && result.points.has(p.id)) {
          return { ...result.points.get(p.id)!, id: p.id };
        }
        return p;
      }) }));
    const solvedProfile = { ...activeProfile, segments: solvedSegments };
    setSketchProfiles(prev => prev.map((x, i) => i === activeProfileIdx ? solvedProfile : x));
    setSketchProfile(solvedProfile);
    // Mark constraints as satisfied/unsatisfied
    setSketchConstraints(prev => prev.map(c => ({
      ...c,
      satisfied: !result.unsatisfiedConstraints.includes(c.id) })));
    // Update constraint status for UI banner
    setConstraintStatus(result.solveResult?.status ?? (result.satisfied ? 'ok' : 'over-defined'));
    setConstraintDiagnostic({
      dof: result.solveResult?.dof,
      residual: result.solveResult?.residual,
      message: result.solveResult?.message,
      unsatisfiedCount: result.unsatisfiedConstraints.length,
      unsatisfiedIds: result.unsatisfiedConstraints,
      redundant: result.solveResult?.redundant,
      solveMs,
      onRemoveRedundant: (id: string) => {
        setSketchConstraints(prev => prev.filter(c => c.id !== id));
      } });
  }, [sketchProfiles, activeProfileIdx, sketchProfile, sketchConstraints, sketchDimensions, setSketchProfile, autoSolve, addToast, lt, reportWarning]);

  // Hashes for auto-solve trigger (dimension values + profile point positions)
  const sketchDimHash = useMemo(
    () => sketchDimensions.map(d => `${d.id}:${d.value}`).join(','),
    [sketchDimensions],
  );
  const sketchProfileHash = useMemo(
    () => (sketchProfiles[activeProfileIdx]?.segments ?? [])
      .flatMap(s => s.points)
      .map(p => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`)
      .join('|'),
    [sketchProfiles, activeProfileIdx],
  );

  const isSolvingRef = useRef(false);
  /** One telemetry ping per mount when auto-solve hits a very large constraint set (avoid spam). */
  /** Auto-solve: one telemetry warning + one info toast when constraint count is very large. */
  const sketchLargeConstraintAutoSolveNotifiedRef = useRef(false);

  // Auto-solve when constraint list or dimension values change
  React.useEffect(() => {
    if (!autoSolve || sketchConstraints.length === 0 || isSolvingRef.current) return;
    isSolvingRef.current = true;
    handleSolveConstraints();
    isSolvingRef.current = false;
  }, [autoSolve, sketchConstraints.length, sketchDimHash]);

  // Auto-solve after profile changes (point drag etc.) — debounced 150 ms
  React.useEffect(() => {
    if (!autoSolve || sketchConstraints.length === 0) return;
    const timer = setTimeout(() => {
      if (isSolvingRef.current) return;
      isSolvingRef.current = true;
      handleSolveConstraints();
      isSolvingRef.current = false;
    }, 150);
    return () => clearTimeout(timer);
  }, [autoSolve, sketchConstraints.length, sketchProfileHash]);

  // Live constraint diagnostics (SolidWorks-style) — when auto-solve is OFF
  // the solver previously never ran, so the DOF pill / status chip showed a
  // stale default-green state. Run a READ-ONLY diagnostic solve (geometry is
  // never moved) debounced 250 ms so the chrome always reflects reality.
  // Also covers auto-solve ON with zero constraints (auto-solve effects bail
  // there, which would leave the status stale).
  React.useEffect(() => {
    if (!isSketchMode || (autoSolve && sketchConstraints.length > 0)) return;
    const segments = (sketchProfiles[activeProfileIdx] ?? sketchProfile).segments;
    if (segments.length === 0) {
      // Empty sketch → clear diagnostics so the chrome shows no status.
      setConstraintStatus('ok');
      setConstraintDiagnostic({});
      return;
    }
    const timer = setTimeout(() => {
      const live = computeSketchLiveStatus(segments, sketchConstraints, sketchDimensions);
      if (live.status === null) return;
      setConstraintStatus(live.status);
      setConstraintDiagnostic({
        dof: live.dof ?? undefined,
        message: live.message,
        unsatisfiedCount: live.unsatisfiedIds.length,
        unsatisfiedIds: live.unsatisfiedIds,
        redundant: live.redundantIds.length > 0 ? live.redundantIds : undefined,
        solveMs: live.solveMs ?? undefined,
        onRemoveRedundant: (id: string) => {
          setSketchConstraints(prev => prev.filter(c => c.id !== id));
        },
      });
    }, 250);
    return () => clearTimeout(timer);
  }, [isSketchMode, autoSolve, sketchProfiles, activeProfileIdx, sketchProfile, sketchProfileHash, sketchConstraints, sketchDimHash, sketchDimensions]);

  // Shell-v2 SketchRightPane actions — delete a constraint from the
  // "Constraints on Selection" rows, toggle construction geometry from the
  // "Active Selection" checkbox. Ids match the bridge snapshot writer
  // (segment.id ?? `seg${i}`, constraint.id ?? `c${i}`).
  useEffect(() => {
    const onDeleteConstraint = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      if (ce.detail?.id) handleRemoveConstraint(ce.detail.id);
    };
    const onToggleConstruction = (e: Event) => {
      const ce = e as CustomEvent<{ id: string }>;
      const id = ce.detail?.id;
      if (!id) return;
      const profile = useSceneStore.getState().sketchProfile;
      const segments = profile.segments.map((s, i) =>
        (s.id ?? `seg${i}`) === id ? { ...s, construction: !s.construction } : s);
      const next = { ...profile, segments };
      setSketchProfile(next);
      setSketchProfiles(prev => prev.map((x, i) => i === activeProfileIdx ? next : x));
    };
    window.addEventListener('nexyfab:delete-sketch-constraint', onDeleteConstraint);
    window.addEventListener('nexyfab:toggle-sketch-construction', onToggleConstruction);
    return () => {
      window.removeEventListener('nexyfab:delete-sketch-constraint', onDeleteConstraint);
      window.removeEventListener('nexyfab:toggle-sketch-construction', onToggleConstruction);
    };
  }, [handleRemoveConstraint, setSketchProfile, setSketchProfiles, activeProfileIdx]);

  // ── Add sketch as feature-tree item ──
  const handleAddSketchToFeatureTree = useCallback(() => {
    if (!sketchProfile.closed) {
      addToast('error', lt.closeProfileFirst);
      return;
    }
    addSketchFeature(sketchProfile, sketchConfig, sketchPlane as 'xy' | 'xz' | 'yz', sketchOperation, sketchPlaneOffset, sketchConstraints, sketchDimensions, sketchFaceFrame ?? undefined);
    setSketchProfile({ segments: [], closed: false });
    setSketchProfiles([{ segments: [], closed: false }]);
    setActiveProfileIdx(0);
    setIsSketchMode(false);
    addToast('success', lt.addedToFeatureTree);
  }, [sketchProfile, sketchConfig, sketchPlane, sketchOperation, sketchPlaneOffset, sketchConstraints, sketchDimensions, sketchFaceFrame, addSketchFeature, setSketchProfile, setIsSketchMode, addToast, lang]);

  // ── Multi-body workflow: extrude ACTIVE profile only, stay in sketch ──
  // User flow: draw multiple profiles → click "Generate body & continue" →
  // active profile becomes a separate body in the feature tree → sketch
  // stays open so the user can pick the next profile and extrude that
  // separately. Mirrors Fusion 360 / Onshape "contour selection".
  const handleGenerateActiveProfile = useCallback(() => {
    const active = sketchProfiles[activeProfileIdx] ?? sketchProfile;
    if (!active || !active.closed || active.segments.length === 0) {
      addToast('error', lt.closeProfileFirst);
      return;
    }
    addSketchFeature(
      active,
      sketchConfig,
      sketchPlane as 'xy' | 'xz' | 'yz',
      sketchOperation,
      sketchPlaneOffset,
      sketchConstraints,
      sketchDimensions,
      sketchFaceFrame ?? undefined,
    );
    // Remove the just-extruded profile from the working set so the user
    // sees their remaining profiles clearly. If it was the only one,
    // reseed with an empty slot. Then advance activeProfileIdx so the
    // next profile becomes active.
    const remaining = sketchProfiles.filter((_, idx) => idx !== activeProfileIdx);
    if (remaining.length === 0) {
      setSketchProfile({ segments: [], closed: false });
      setSketchProfiles([{ segments: [], closed: false }]);
      setActiveProfileIdx(0);
    } else {
      setSketchProfiles(remaining);
      setSketchProfile(remaining[0]);
      setActiveProfileIdx(0);
    }
    // Stay in sketch mode — DO NOT call setIsSketchMode(false).
    addToast('success', lt.addedToFeatureTree);
  }, [
    sketchProfiles,
    activeProfileIdx,
    sketchProfile,
    sketchConfig,
    sketchPlane,
    sketchOperation,
    sketchPlaneOffset,
    sketchConstraints,
    sketchDimensions,
    addSketchFeature,
    setSketchProfile,
    setSketchProfiles,
    setActiveProfileIdx,
    addToast,
    lt,
  ]);
  // Keep the forward ref pointing at the latest version so the tool
  // listener (declared earlier) always calls the current handler.
  useEffect(() => {
    handleGenerateActiveProfileRef.current = handleGenerateActiveProfile;
  }, [handleGenerateActiveProfile]);

  // ══════════════════════════════════════════════════════════════════════════
  // SKETCH HISTORY HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const _handleSaveToSketchHistory = useCallback((
    profile: SketchProfile,
    config: SketchConfig,
    plane: 'xy' | 'xz' | 'yz',
  ) => {
    const entry: SketchHistoryEntry = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `sh-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      profile,
      config,
      plane,
      timestamp: Date.now(),
      thumbnail: generateSketchThumbnail(profile),
      label: `Sketch ${sketchHistory.length + 1}` };
    const updated = [...sketchHistory, entry].slice(-20); // keep last 20
    setSketchHistory(updated);
    saveSketchHistory(updated);
  }, [sketchHistory]);

  const handleEditSketchFeature = useCallback((featureId: string) => {
    const node = featureHistory?.nodes.find(n => n.id === featureId);
    if (!node) return;

    const nodeAny = node as unknown as Record<string, unknown>;
    const storedProfile = nodeAny.sketchProfile as SketchProfile | undefined;
    const storedConfig = nodeAny.sketchConfig as SketchConfig | undefined;

    if (storedProfile) {
      setSketchProfile(storedProfile);
    } else {
      setSketchProfile({ segments: [], closed: false });
    }

    if (storedConfig) {
      setSketchConfig(storedConfig);
    }
    
    const sketchDataSlice = nodeAny.sketchData as { constraints?: SketchConstraint[]; dimensions?: SketchDimension[] } | undefined;
    const storedConstraints = sketchDataSlice?.constraints;
    const storedDimensions = sketchDataSlice?.dimensions;
    
    setSketchConstraints(storedConstraints || []);
    setSketchDimensions(storedDimensions || []);

    setEditingSketchFeatureId(featureId);
    setIsSketchMode(true);
    addToast('info', shapeLabels.editingSketch || 'Editing sketch — finish to update');
  }, [featureHistory, setSketchProfile, setSketchConfig, setIsSketchMode, addToast, shapeLabels.editingSketch]);

  const handleLoadSketchFromHistory = useCallback((entry: SketchHistoryEntry) => {
    setSketchProfile(entry.profile);
    setSketchConfig(entry.config);
    setSketchPlane(entry.plane);
    setIsSketchMode(true);
    setShowSketchHistory(false);
    addToast('success', shapeLabels.loadSketch || 'Sketch loaded');
  }, [setSketchProfile, setSketchConfig, setSketchPlane, setIsSketchMode, addToast, shapeLabels.loadSketch]);

  const handleDeleteSketchHistoryEntry = useCallback((id: string) => {
    const updated = sketchHistory.filter(e => e.id !== id);
    setSketchHistory(updated);
    saveSketchHistory(updated);
  }, [sketchHistory]);

  // ══════════════════════════════════════════════════════════════════════════
  // CHAT → SKETCH / OPTIMIZE / MODIFY HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleChatApplySketch = useCallback((profile: SketchProfile, config: Partial<SketchConfig>) => {
    const mergedConfig: SketchConfig = {
      mode: config.mode || 'extrude',
      depth: config.depth ?? 50,
      revolveAngle: config.revolveAngle ?? 360,
      revolveAxis: config.revolveAxis || 'y',
      segments: config.segments ?? 32 };
    setSketchProfile(profile);
    setSketchConfig(mergedConfig);
    if (profile.closed && profile.segments.length >= 3) {
      const geo = profileToGeometry(profile, mergedConfig);
      if (geo) {
        const edgeGeometry = makeEdges(geo);
        const volume_cm3 = meshVolume(geo) / 1000;
        const surface_area_cm2 = meshSurfaceArea(geo) / 100;
        geo.computeBoundingBox();
        const bb = geo.boundingBox;
        if (!bb) return;
        const size = bb.getSize(new Vector3());
        const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
        setBomParts([]); setBomLabel('');
        setSketchResult({ geometry: geo, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
        setIsSketchMode(false);
        setShowAIAssistant(false);
        return;
      }
    }
    setIsSketchMode(true);
    setShowAIAssistant(false);
    setSketchResult(null);
  }, []);

  const handleChatApplyOptimize = useCallback((opt: OptimizeResult) => {
    setIsSketchMode(false);
    setShowAIAssistant(false);
    // Phase 7: track AI-driven optimize parameter overrides as a single
    // command. Captures the before-state of each touched setter so undo
    // restores everything in one Ctrl+Z.
    const prevTab = activeTab;
    const prev = {
      dimX, dimY, dimZ, materialKey, fixedFaces, loads, volfrac, resolution,
    };
    commandHistory.execute({
      id: `chat-optimize-${Date.now()}`,
      label: 'AI optimize',
      labelKo: 'AI 최적화',
      execute: () => {
        setActiveTab('optimize');
        if (opt.dimX) setDimX(opt.dimX);
        if (opt.dimY) setDimY(opt.dimY);
        if (opt.dimZ) setDimZ(opt.dimZ);
        if (opt.materialKey) setMaterialKey(opt.materialKey);
        if (opt.fixedFaces) setFixedFaces(opt.fixedFaces);
        if (opt.loads) setLoads(opt.loads);
        if (opt.volfrac) setVolfrac(opt.volfrac);
        if (opt.resolution) setResolution(opt.resolution);
      },
      undo: () => {
        setActiveTab(prevTab);
        setDimX(prev.dimX);
        setDimY(prev.dimY);
        setDimZ(prev.dimZ);
        setMaterialKey(prev.materialKey);
        setFixedFaces(prev.fixedFaces);
        setLoads(prev.loads);
        setVolfrac(prev.volfrac);
        setResolution(prev.resolution);
      },
    });
  }, [activeTab, dimX, dimY, dimZ, materialKey, fixedFaces, loads, volfrac, resolution,
      setActiveTab, setDimX, setDimY, setDimZ, setMaterialKey, setFixedFaces, setLoads, setVolfrac, setResolution]);

  const handleChatApplyModify = useCallback((mod: ModifyResult) => {
    setShowAIAssistant(false);
    // Phase 6: wrap the entire AI-driven modify batch as a single command so
    // the user can Ctrl+Z the whole change in one step. Without this each
    // setParam/addFeature would land on the legacy stack independently and
    // the undo toast would only reverse the last action.
    const prevParams = { ...params };
    const featuresAddedRef: number = mod.actions.filter(a => a.type === 'feature' && a.featureType).length;
    commandHistory.execute({
      id: `chat-modify-${Date.now()}`,
      label: `AI modify (${mod.actions.length})`,
      labelKo: `AI 수정 (${mod.actions.length}개)`,
      execute: () => {
        for (const action of mod.actions) {
          if (action.type === 'param' && action.key && action.value !== undefined) {
            setParam(action.key, action.value);
          } else if (action.type === 'feature' && action.featureType) {
            addFeature(action.featureType);
          }
        }
      },
      undo: () => {
        // Reverse param changes by restoring the snapshot. Feature adds are
        // popped via undoLast() the same number of times we appended.
        setParams(prevParams);
        const e: Record<string, string> = {};
        Object.entries(prevParams).forEach(([k, v]) => { e[k] = String(v); });
        setParamExpressions(e);
        for (let i = 0; i < featuresAddedRef; i++) undoLast();
      },
    });
  }, [addFeature, params, setParam, setParams, setParamExpressions, undoLast]);

  /** Called after modify is auto-applied — show undo toast */
  const handleModifyAutoApplied = useCallback((actionCount: number) => {
    addToast(
      'success',
      lt.aiAppliedChanges(actionCount),
      6000,
      { label: lt.undoLabel, onClick: handleHistoryUndo },
    );
  }, [addToast, lang, handleHistoryUndo]);

  // Direct mesh edits (face offset/shell/push-pull, edge fillet/chamfer, CSG) on
  // an IMPORTED part must persist onto importedGeometry — otherwise a tab/mode
  // switch clears the transient sketchResult and the part reverts to the original
  // import. These refs let handleGeometryApply reach setImportedGeometry even
  // though it's declared further down (assigned after the useImportExport call).
  const importedGeometryLiveRef = useRef<BufferGeometry | null>(null);
  const setImportedGeometryRef = useRef<((g: BufferGeometry) => void) | null>(null);

  // Apply a geometry directly (from face editing, fillet/chamfer on edge, or CSG)
  const handleGeometryApply = useCallback((geo: BufferGeometry) => {
    const vol = meshVolume(geo);
    const sa = meshSurfaceArea(geo);
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) return;
    const newResult: ShapeResult = {
      geometry: geo,
      edgeGeometry: makeEdges(geo),
      volume_cm3: vol,
      surface_area_cm2: sa,
      bbox: {
        w: box.max.x - box.min.x,
        h: box.max.y - box.min.y,
        d: box.max.z - box.min.z } };
    setSketchResult(newResult);
    // Persist onto the imported part so the edit survives tab/mode transitions.
    if (importedGeometryLiveRef.current && setImportedGeometryRef.current) {
      setImportedGeometryRef.current(geo);
    }
    setEditMode('none');
  }, [setSketchResult, setEditMode]);

  // CSG Boolean operation
  const handleCSGApply = useCallback((op: CSGOperation, toolParams: CSGToolParams) => {
    const base = effectiveResult;
    if (!base) return;
    let toolGeo: BufferGeometry | null = null;
    try {
      toolGeo = makeToolGeometry(toolParams);
      const resultGeo = applyCSG(base.geometry, toolGeo, op);
      handleGeometryApply(resultGeo);
      setShowCSGPanel(false);
      addToast('success', lt.booleanApplied);
    } catch (err) {
      reportError('csg', err, { op, toolShape: toolParams.shape });
      const detail = err instanceof Error ? err.message : String(err);
      addToast('error', `${lt.booleanFailed}: ${detail}`);
    } finally {
      toolGeo?.dispose();
    }
  }, [effectiveResult, handleGeometryApply, addToast, lt, setShowCSGPanel]);

  // ══════════════════════════════════════════════════════════════════════════
  // MULTI-BODY OPERATIONS
  // ══════════════════════════════════════════════════════════════════════════

  /** Activate body panel — initialises from current geometry if bodies is empty */
  const handleOpenBodyPanel = useCallback(() => {
    if (bodies.length === 0) {
      const geo = effectiveResult;
      if (!geo) { setShowBodyPanel(true); return; }
      const id = crypto.randomUUID();
      setBodies([{
        id,
        name: lt.body1,
        color: BODY_COLORS[0],
        visible: true,
        locked: false }]);
      setActiveBodyId(id);
      // Store geometry for this body (we extend BodyEntry with geometry refs separately)
      bodyGeosRef.current.set(id, { geometry: geo.geometry, edgeGeometry: geo.edgeGeometry });
    }
    setShowBodyPanel(true);
  }, [bodies.length, effectiveResult, lang]);

  /** Geometry lookup map — avoids storing THREE objects in React state */
  const bodyGeosRef = React.useRef<Map<string, { geometry: BufferGeometry; edgeGeometry: BufferGeometry }>>(new Map());

  /** Split the given body into two halves */
  const handleSplitBody = useCallback((bodyId: string, plane: number, offset: number) => {
    const geos = bodyGeosRef.current.get(bodyId);
    if (!geos) { addToast('error', lt.bodyGeometryMissing); return; }
    try {
      const [posGeo, negGeo] = splitBodyBoth(geos.geometry, plane, offset);
      const idA = crypto.randomUUID();
      const idB = crypto.randomUUID();
      const sourceBody = bodies.find(b => b.id === bodyId);
      const colorA = sourceBody?.color ?? BODY_COLORS[0];
      const colorB = BODY_COLORS[bodies.length % BODY_COLORS.length];
      bodyGeosRef.current.set(idA, { geometry: posGeo, edgeGeometry: makeEdges(posGeo) });
      bodyGeosRef.current.set(idB, { geometry: negGeo, edgeGeometry: makeEdges(negGeo) });
      bodyGeosRef.current.delete(bodyId);
      setBodies(prev => [
        ...prev.filter(b => b.id !== bodyId),
        { id: idA, name: (sourceBody?.name ?? 'Body') + '-A', color: colorA, visible: true, locked: false, splitFrom: { bodyId, plane, offset } },
        { id: idB, name: (sourceBody?.name ?? 'Body') + '-B', color: colorB, visible: true, locked: false, splitFrom: { bodyId, plane, offset } },
      ]);
      setActiveBodyId(idA);
      addToast('success', lt.bodySplitComplete);
    } catch {
      addToast('error', lt.splitFailed);
    }
  }, [bodies, lang, addToast]);

  /** Merge selected bodies into one */
  const handleMergeBodies = useCallback((bodyIds: string[]) => {
    const geoList = bodyIds.map(id => bodyGeosRef.current.get(id)?.geometry).filter(Boolean) as BufferGeometry[];
    if (geoList.length < 2) return;
    try {
      const merged = mergeBodyGeometries(geoList);
      const newId = crypto.randomUUID();
      const colorIdx = bodies.findIndex(b => b.id === bodyIds[0]);
      bodyGeosRef.current.set(newId, { geometry: merged, edgeGeometry: makeEdges(merged) });
      bodyIds.forEach(id => bodyGeosRef.current.delete(id));
      setBodies(prev => [
        ...prev.filter(b => !bodyIds.includes(b.id)),
        { id: newId, name: lt.mergedBody, color: BODY_COLORS[Math.max(0, colorIdx) % BODY_COLORS.length], visible: true, locked: false, mergedFrom: bodyIds },
      ]);
      setActiveBodyId(newId);
      setSelectedBodyIds([]);
      addToast('success', lt.bodiesMerged);
    } catch {
      addToast('error', lt.mergeFailed);
    }
  }, [bodies, lang, addToast]);

  // ── Derived: bomParts for multi-body rendering ──────────────────────────
  const bodyBomParts: BomPartResult[] | undefined = React.useMemo(() => {
    if (bodies.length <= 1) return undefined;
    return bodies
      .filter(b => b.visible)
      .map(b => {
        const geos = bodyGeosRef.current.get(b.id);
        if (!geos) return null;
        return {
          name: b.name,
          color: b.color,
          result: {
            geometry: geos.geometry,
            edgeGeometry: geos.edgeGeometry,
            volume_cm3: 0,
            surface_area_cm2: 0,
            bbox: { w: 0, h: 0, d: 0 } } };
      })
      .filter(Boolean) as BomPartResult[];
  }, [bodies]);

  // ══════════════════════════════════════════════════════════════════════════
  // SEND SHAPE TO OPTIMIZER
  // ══════════════════════════════════════════════════════════════════════════

  const handleSendToOptimizer = useCallback(() => {
    const r = sketchResult || result;
    if (!r) return;
    setDimX(Math.max(50, r.bbox.w));
    setDimY(Math.max(50, r.bbox.h));
    setDimZ(Math.max(50, r.bbox.d));
    setCustomDomainGeometry(r.geometry);
    handleSetActiveTab('optimize');
  }, [result, sketchResult, handleSetActiveTab]);

  // ══════════════════════════════════════════════════════════════════════════
  // TOPOLOGY OPTIMIZATION HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleDimChange = useCallback((key: 'dimX' | 'dimY' | 'dimZ', value: number) => {
    if (key === 'dimX') setDimX(value); else if (key === 'dimY') setDimY(value); else setDimZ(value);
  }, []);

  const handleFaceClick = useCallback((face: Face) => {
    if (selectionMode === 'fixed') {
      setFixedFaces(prev => prev.includes(face) ? prev.filter(f => f !== face) : [...prev, face]);
    } else if (selectionMode === 'load') {
      setLoads(prev => prev.find(l => l.face === face) ? prev.filter(l => l.face !== face) : [...prev, { face, force: [...activeLoadForce] as [number, number, number] }]);
    }
  }, [selectionMode, activeLoadForce]);

  const handleRemoveFixed = useCallback((face: Face) => { setFixedFaces(prev => prev.filter(f => f !== face)); }, []);
  const handleRemoveLoad = useCallback((face: Face) => { setLoads(prev => prev.filter(l => l.face !== face)); }, []);

  // handleGenerate is provided by useOptimizationState hook

  const handleExportSTL = useCallback(async () => {
    if (!resultMesh) return;
    setExportingFormat('STL');
    try {
      const { exportSTL } = await import('./topology/optimizer/stlExporter');
      await exportSTL(resultMesh, 'generative-design');
      analytics.shapeDownload('STL');
      addToast('success', lt.stlSaved);
    } catch (err) {
      console.error('[Export STL]', err);
      addToast('error', lt.stlExportFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [resultMesh, addToast, lang]);

  const handleSendOptToQuote = useCallback(() => {
    if (!optResult) return;
    const volumeCm3 = (dimX * dimY * dimZ * optResult.finalVolumeFraction) / 1000;
    router.push(`/${langSeg}/quick-quote/?from=generative-design&volume_cm3=${volumeCm3.toFixed(4)}&material=${materialKey}`);
  }, [optResult, materialKey, dimX, dimY, dimZ, langSeg, router]);

  const handleOptReset = useCallback(() => {
    setDimX(200); setDimY(100); setDimZ(200); setMaterialKey('aluminum');
    setFixedFaces([]); setLoads([]); setVolfrac(0.4); setResolution('low');
    setPenal(3); setRmin(1.5); setMaxIter(50); setSelectionMode('none');
    setProgress(null); setOptResult(null); setResultMesh(null);
    setActiveLoadForce([0, -1000, 0]);
  }, []);

  const weightInfo = useMemo(() => {
    if (!optResult) return null;
    const material = MATERIALS[materialKey];
    const volumeM3 = (dimX / 1000) * (dimY / 1000) * (dimZ / 1000);
    const originalWeight = volumeM3 * material.density;
    const optimizedWeight = originalWeight * optResult.finalVolumeFraction;
    return { originalWeight, optimizedWeight, reduction: (1 - optResult.finalVolumeFraction) * 100 };
  }, [optResult, materialKey, dimX, dimY, dimZ]);

  const convergenceChart = useMemo(() => {
    if (!optResult || optResult.convergenceHistory.length < 2) return null;
    const hist = optResult.convergenceHistory;
    const w = 240, h = 100, padX = 30, padY = 10;
    const chartW = w - padX * 2, chartH = h - padY * 2;
    const minVal = Math.log10(Math.max(1e-10, Math.min(...hist)));
    const maxVal = Math.log10(Math.max(1e-10, Math.max(...hist)));
    const range = maxVal - minVal || 1;
    const points = hist.map((val, i) => {
      const x = padX + (i / (hist.length - 1)) * chartW;
      const y = padY + chartH - ((Math.log10(Math.max(1e-10, val)) - minVal) / range) * chartH;
      return `${x},${y}`;
    }).join(' ');
    return (
      <svg width={w} height={h} style={{ width: '100%', height: 'auto' }}>
        <line x1={padX} y1={padY} x2={padX} y2={h - padY} stroke="var(--nx-border)" strokeWidth={1} />
        <line x1={padX} y1={h - padY} x2={w - padX} y2={h - padY} stroke="var(--nx-border)" strokeWidth={1} />
        <text x={w / 2} y={h - 1} textAnchor="middle" fill="var(--nx-border-strong)" fontSize={8}>Iteration</text>
        <polyline points={points} fill="none" stroke="var(--nx-accent-2)" strokeWidth={1.5} />
      </svg>
    );
  }, [optResult]);

  // ══════════════════════════════════════════════════════════════════════════
  // AI PREVIEW HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleAiPreview = useCallback((data: ChatResult) => {
    if (data.mode === 'single' && data.shapeId) {
      const prevSd = SHAPE_MAP[data.shapeId];
      if (prevSd) {
        const { unknownKeys } = normalizeShapeParams(prevSd, data.params);
        if (unknownKeys.length > 0) {
          const detail = unknownKeys.slice(0, 10).join(', ') + (unknownKeys.length > 10 ? '…' : '');
          addToast('warning', lt.ignoredUnknownParams(detail));
        }
      }
      const preview = generatePartResult(data.shapeId, data.params, data.features);
      if (preview) { setPreviewResult(preview); setIsPreviewMode(true); }
    } else if (data.mode === 'modify') {
      setIsPreviewMode(true);
    }
  }, [generatePartResult, addToast, lt]);

  const handleCancelPreview = useCallback(() => {
    setPreviewResult(null);
    setIsPreviewMode(false);
  }, []);

  const handleTextToCAD = useCallback((shapeId: string, nlParams: Record<string, number>) => {
    const sc = SHAPES.find(s => s.id === shapeId);
    if (!sc) return;
    const validKeys = new Set(sc.params.map((sp) => sp.key));
    const unknownKeys = Object.keys(nlParams).filter((k) => !validKeys.has(k));
    if (unknownKeys.length > 0) {
      const detail = unknownKeys.slice(0, 12).join(', ') + (unknownKeys.length > 12 ? '…' : '');
      addToast('warning', lt.ignoredUnknownParams(detail));
    }
    // Phase 6: wrap shape-change + param-set in a single command so the
    // user can undo the entire NL→CAD step.
    const prevSelectedId = selectedId;
    const prevParams = { ...params };
    const newP: Record<string, number> = {};
    const newE: Record<string, string> = {};
    sc.params.forEach(sp => {
      const val = nlParams[sp.key] ?? sp.default;
      newP[sp.key] = val;
      newE[sp.key] = String(val);
    });
    commandHistory.execute({
      id: `text-to-cad-${sc.id}-${Date.now()}`,
      label: `NL → ${sc.id}`,
      labelKo: `자연어 → ${sc.id}`,
      execute: () => {
        setSelectedId(sc.id);
        setParams(newP);
        setParamExpressions(newE);
      },
      undo: () => {
        setSelectedId(prevSelectedId);
        setParams(prevParams);
        const e: Record<string, string> = {};
        Object.entries(prevParams).forEach(([k, v]) => { e[k] = String(v); });
        setParamExpressions(e);
      },
    });
    clearAll();
    setSelectedFeatureId(null);
    setSketchResult(null);
    setEditMode('none');
    addToast('success', lt.shapeFromText(sc.id));
  }, [selectedId, params, setSelectedId, setParams, setParamExpressions, clearAll, setSelectedFeatureId, setSketchResult, setEditMode, addToast, lt]);

  // ══════════════════════════════════════════════════════════════════════════
  // CONTEXT MENU HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // 오른쪽 버튼을 누른 채 드래그(5px 이상 이동)했으면 컨텍스트 메뉴 억제
    if (rightMouseDownPos.current) {
      const dx = e.clientX - rightMouseDownPos.current.x;
      const dy = e.clientY - rightMouseDownPos.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) return;
    }
    if (isSketchMode && sketchViewMode === '2d') {
      openSketchRadial(e.clientX, e.clientY);
      closeContextMenu();
      return;
    }
    // selectedType threads the cursor-time selection into geometry items so
    // face/edge/vertex right-clicks surface element-specific ops (offset,
    // fillet, chamfer, mate…) at the top of the menu. Without this the
    // selection-aware branch in getContextItemsGeometry was dead code.
    // `selectedElement.type` is currently 'face' | 'edge' | 'multi' in the
    // union, but the canvas (VertexHandles / smartSnap) already produces
    // vertex selections that future widening will surface here. Read via
    // a string to stay forward-compatible without breaking strict typing.
    const selType = selectedElement?.type as string | undefined;
    const selKind: 'face' | 'edge' | 'vertex' | 'body' | null =
      selType === 'face' ? 'face'
      : selType === 'edge' ? 'edge'
      : selType === 'vertex' ? 'vertex'
      : highlightedPartId ? 'body'
      : null;
    const geomOpts = {
      hasAssembly: bomParts.length >= 2,
      hasHighlightedPart: !!highlightedPartId,
      selectedType: selKind,
    };
    const items = isSketchMode ? getContextItemsSketch(lang) : effectiveResult ? getContextItemsGeometry(lang, geomOpts) : getContextItemsEmpty(lang);
    openContextMenu(e.clientX, e.clientY, items);
  }, [isSketchMode, sketchViewMode, effectiveResult, lang, bomParts.length, highlightedPartId, selectedElement, openContextMenu, closeContextMenu, openSketchRadial]);

  const handleContextSelect = useCallback((id: string) => {
    closeContextMenu();
    closeSketchRadial();
    switch (id) {
      case 'action-extrude': {
        setPendingChatMsg(`Extrude the selected face by 10mm`);
        openAIAssistant('chat');
        break;
      }
      case 'action-fillet': {
        setPendingChatMsg(`Add a 5mm fillet to the selected edge`);
        openAIAssistant('chat');
        break;
      }
      case 'action-ask-ai': {
        setPendingChatMsg(`Modify the selected ${selectedElement?.type || 'element'}`);
        openAIAssistant('chat');
        break;
      }
      case 'action-isolate': {
        const _elPartName = selectedElement && 'partName' in selectedElement ? selectedElement.partName : undefined;
        if (_elPartName) {
          setPendingChatMsg(`Isolate part: ${_elPartName}`);
          openAIAssistant('chat');
        }
        break;
      }
      case 'part-hide': {
        if (highlightedPartId) {
          setAssemblyHiddenParts(prev => { const n = new Set(prev); n.add(highlightedPartId); return n; });
        }
        break;
      }
      case 'part-transparent': {
        if (highlightedPartId) {
          setAssemblyTransparentParts(prev => { const n = new Set(prev); n.add(highlightedPartId); return n; });
        }
        break;
      }
      case 'part-color-yellow':
      case 'part-color-orange':
      case 'part-color-purple':
      case 'part-color-white': {
        if (highlightedPartId) {
          const colorMap: Record<string, string> = {
            'part-color-yellow': '#e3b341',
            'part-color-orange': '#d97706',
            'part-color-purple': 'var(--nx-accent)',
            'part-color-white': 'var(--nx-text)'
          };
          const color = colorMap[id];
          setAssemblyPartColors(prev => ({ ...prev, [highlightedPartId]: color }));
        }
        break;
      }
      case 'assembly-show-all': {
        setAssemblyHiddenParts(new Set());
        setAssemblyTransparentParts(new Set());
        break;
      }
      case 'assembly-reset-colors': {
        setAssemblyPartColors({});
        break;
      }
      case 'zoom-fit': break; // handled by viewer
      case 'sketch-here': {
        setIsSketchMode(true);
        setSketchResult(null);
        setEditMode('none');
        setMeasureActive(false);
        setSelectionActive(false);
        setSelectedElement(null);
        break;
      }
      case 'finish-sketch': handleSketchGenerate(); break;
      case 'cancel-sketch': setIsSketchMode(false); break;
      case 'sketch-tool-line': setSketchTool('line'); break;
      case 'sketch-tool-circle': setSketchTool('circle'); break;
      case 'sketch-tool-rect': setSketchTool('rect'); break;
      case 'sketch-tool-trim': setSketchTool('trim'); break;
      case 'sketch-tool-offset': setSketchTool('offset'); break;
      case 'sketch-tool-polygon': setSketchTool('polygon'); break;
      case 'sketch-radial-dimension': setSketchPalDims(true); setSketchTool('dimension'); break;
      case 'sketch-insert-canvas': sketchRefInputRef.current?.click(); break;
      case 'sketch-toggle-slice': setSketchPalSlice(v => !v); break;
      case 'measure': toggleMeasureMode(); break;
      case 'delete': if (selectedFeatureId) handleRemoveFeatureCmd(selectedFeatureId); break;
      case 'suppress': if (selectedFeatureId) toggleFeatureCmd(selectedFeatureId); break;
      case 'add-dimension': setShowDimensions(true); setSketchPalDims(true); break;
      case 'properties': if (selectedFeatureId) setShowPropertyManager(true); break;
      case 'add-to-cart': handleAddToCart(); break;
      case 'sketch-undo': handleSketchUndo(); break;
      case 'sketch-clear': handleSketchClear(); break;
      case 'edit-feature': if (selectedFeatureId) startEditing(selectedFeatureId); break;
      // ── selection-aware right-click items (face/edge/vertex) ─────────
      // The deterministic numeric panels (FaceContextPanel / EdgeContextPanel)
      // auto-mount in face/edge edit mode whenever a selection exists, so the
      // user can drive precise values there. These menu entries are the
      // discoverable AI-hint shortcut alongside that panel — clicking them
      // primes the AI chat with the same intent.
      case 'face-offset': {
        // Direct edit (Phase 1): with a face selected, add the REAL offsetFace
        // feature (undoable, tunable in FeatureParams). The AI-hint fallback
        // only remains for the no-selection edge case.
        if (selectedElement && selectedElement.type === 'face') {
          const frozen = [selectedElement as FaceSelectionInfo];
          commandHistory.execute({
            id: `add-feature-offsetFace-${Date.now()}`,
            label: 'Add feature: offsetFace',
            labelKo: '피처 추가: offsetFace',
            execute: () => { addFeatureWithEdges('offsetFace', undefined, frozen); },
            undo: () => { undoLast(); },
          });
          const dd = t as unknown as Record<string, string>;
          addToast('info', dd.directOffsetFaceAdded ?? 'Offset Face added — adjust the distance (±) in feature parameters');
        } else {
          setPendingChatMsg(`Offset the selected face by 2mm`);
          openAIAssistant('chat');
        }
        break;
      }
      case 'face-shell': {
        setPendingChatMsg(`Shell this body with 2mm wall thickness, opening on the selected face`);
        openAIAssistant('chat');
        break;
      }
      case 'face-pushpull': {
        setPendingChatMsg(`Push/pull the selected face by 10mm along its normal`);
        openAIAssistant('chat');
        break;
      }
      case 'face-sketch-from': {
        setPendingChatMsg(`Start a sketch on the selected face`);
        openAIAssistant('chat');
        break;
      }
      case 'face-create-mate': {
        // Same flow SelectionInfoBadge uses for "Create Mate": arm the first
        // face, then the next face-pick on a different part triggers the
        // MatePickerOverlay (`pendingMate` in selection store).
        if (selectedElement && selectedElement.type === 'face') {
          setMateFaceA(selectedElement as FaceSelectionInfo);
          addToast(
            'info',
            (lt as { mateSelectSecondFace?: string }).mateSelectSecondFace
              ?? 'Pick a second face on a different part to mate to. (Esc cancels)',
          );
        }
        break;
      }
      case 'edge-chamfer': {
        setPendingChatMsg(`Add a 2mm chamfer to the selected edge`);
        openAIAssistant('chat');
        break;
      }
      case 'vertex-move': {
        setPendingChatMsg(`Move the selected vertex (specify direction and distance)`);
        openAIAssistant('chat');
        break;
      }
      case 'vertex-snap-grid': {
        // No deterministic vertex-snap API yet — route via AI hint so the
        // intent surfaces in chat and the user gets a parametric proposal.
        setPendingChatMsg(`Snap the selected vertex to the nearest grid point (1mm grid)`);
        openAIAssistant('chat');
        break;
      }
      case 'mate-coincident':
      case 'mate-coaxial':
      case 'mate-distance': {
        if (bomParts.length < 2) break;
        const typeMap: Record<string, MateType> = {
          'mate-coincident': 'coincident',
          'mate-coaxial': 'concentric',
          'mate-distance': 'distance' };
        const mateType = typeMap[id];
        const partA = bomParts[0].name || 'part_0';
        const partB = bomParts[1].name || 'part_1';
        const newMate: AssemblyMate = {
          id: generateMateId(),
          type: mateType,
          partA,
          partB,
          ...(mateType === 'distance' ? { value: 0 } : {}),
          locked: false };
        // Phase A undo unification: tracked mate add (Ctrl+Z removes it).
        commandHistory.execute(makeArrayAddCommand({
          commandId: `mate-add-${newMate.id}`,
          label: 'Add mate',
          labelKo: '메이트 추가',
          items: [newMate],
          set: setAssemblyMates,
        }));
        setShowAssemblyPanel(true);
        const mateLabel = mateType === 'coincident' ? lt.mateCoincident : mateType === 'concentric' ? lt.mateConcentric : lt.mateDistance;
        addToast('success', lt.mateAdded(mateLabel, partA, partB));
        break;
      }
    }
  }, [selectedFeatureId, removeFeature, toggleFeatureCmd, handleSketchGenerate, handleAddToCart, handleSketchUndo, handleSketchClear, startEditing, bomParts, assemblyMates, setAssemblyMates, setShowAssemblyPanel, addToast, lang, setSketchTool, setIsSketchMode, setShowDimensions, setSketchPalDims, setSketchPalSlice, toggleMeasureMode, closeContextMenu, closeSketchRadial, selectedElement, setMateFaceA, setPendingChatMsg, openAIAssistant, lt, addFeatureWithEdges, undoLast, t]);

  const handleExportDrawingPDF = useCallback(async () => {
    if (!effectiveResult) return;
    setExportingFormat('PDF');
    try {
      const { exportDrawingPDF } = await import('./io/pdfExport');
      const svgEl = document.querySelector<SVGSVGElement>('.drawing-view-svg');
      if (!svgEl) {
        setSketchViewMode('drawing');
        addToast('info', shapeLabels.exportDrawing || 'PDF Drawing — switch to Drawing view first');
        setExportingFormat(null);
        return;
      }
      const partName = isSketchMode ? 'sketch' : selectedId;
      await exportDrawingPDF(svgEl, `${partName || 'drawing'}.pdf`, 'A3', 'landscape');
    } catch (err) {
      console.error('[Export DrawingPDF]', err);
      addToast('error', lt.pdfExportFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, isSketchMode, selectedId, t, addToast, lang]);

  const handleContextClose = useCallback(() => {
    closeContextMenu();
    closeSketchRadial();
  }, [closeContextMenu, closeSketchRadial]);

  // Long-press context menu for mobile touch
  const handleLongPress = useCallback((x: number, y: number) => {
    if (isSketchMode && sketchViewMode === '2d') {
      openSketchRadial(x, y);
      closeContextMenu();
      return;
    }
    // `selectedElement.type` is currently 'face' | 'edge' | 'multi' in the
    // union, but the canvas (VertexHandles / smartSnap) already produces
    // vertex selections that future widening will surface here. Read via
    // a string to stay forward-compatible without breaking strict typing.
    const selType = selectedElement?.type as string | undefined;
    const selKind: 'face' | 'edge' | 'vertex' | 'body' | null =
      selType === 'face' ? 'face'
      : selType === 'edge' ? 'edge'
      : selType === 'vertex' ? 'vertex'
      : highlightedPartId ? 'body'
      : null;
    const geomOpts = {
      hasAssembly: bomParts.length >= 2,
      hasHighlightedPart: !!highlightedPartId,
      selectedType: selKind,
    };
    const items = isSketchMode ? getContextItemsSketch(lang) : effectiveResult ? getContextItemsGeometry(lang, geomOpts) : getContextItemsEmpty(lang);
    openContextMenu(x, y, items);
  }, [isSketchMode, sketchViewMode, effectiveResult, lang, bomParts.length, highlightedPartId, selectedElement, openContextMenu, closeContextMenu, openSketchRadial]);
  const touchGestureHandlers = useTouchGestures({ onLongPress: isMobile ? handleLongPress : undefined });

  // ══════════════════════════════════════════════════════════════════════════
  // KEYBOARD SHORTCUTS
  // ══════════════════════════════════════════════════════════════════════════

  useKeyboardShortcuts({
    isPreviewMode, handleCancelPreview,
    isSketchMode, setIsSketchMode,
    showAIAssistant, setShowAIAssistant,
    editMode, setEditMode,
    transformMode, setTransformMode,
    measureActive,
    setMeasureActive,
    toggleMeasure: toggleMeasureMode,
    setShowDimensions,
    handleHistoryUndo, handleHistoryRedo,
    sketchTool, setSketchTool,
    handleSaveNfab, handleSaveNfabCloud, handleLoadNfab,
    handleSketchRedo,
    handleShowContextHelp: contextHelp.show,
    meshSelectionActive: !!selectedElement,
    onEscapeClearMeshSelection: clearMeshSelection,
    isReadOnly,
  });

  // Auto-run DFM analysis and show manufacturing card whenever the result updates
  useEffect(() => {
    if (!effectiveResult) {
      setShowManufacturingCard(false);
      return;
    }
    setShowManufacturingCard(true);
    // Fire-and-forget DFM for the card summary. Do not open the Pro upgrade modal here:
    // `effectiveResult` can update more than once (pipeline → sketch mesh), and the free
    // DFM credit is single-use — a second auto-call would wrongly show Pro immediately.
    handleDFMAnalyze(
      ['cnc_milling', 'injection_molding'],
      { minWallThickness: 1.0, minDraftAngle: 1.0, maxAspectRatio: 4.0 },
      { suppressUpgradePrompt: true, suppressSuccessToast: true },
    );
  }, [effectiveResult]);

  // While 2D-sketching a fresh part the right-hand 3D preview is just an empty
  // placeholder that squeezes the canvas — collapse it on ENTER and restore it on
  // EXIT. Transition-based (a ref tracks the prior state) so a manual 3D▶ toggle
  // mid-sketch is preserved; we only act when crossing into/out of that state.
  const sketch2dCollapsedPreviewRef = useRef(false);
  useEffect(() => {
    const fresh2dSketch = isSketchMode && sketchViewMode === '2d' && !effectiveResult?.geometry;
    if (fresh2dSketch && !sketch2dCollapsedPreviewRef.current) {
      setShow3DPreview(false);
    } else if (!fresh2dSketch && sketch2dCollapsedPreviewRef.current) {
      setShow3DPreview(true);
    }
    sketch2dCollapsedPreviewRef.current = fresh2dSketch;
  }, [isSketchMode, sketchViewMode, effectiveResult?.geometry, setShow3DPreview]);

  // ══════════════════════════════════════════════════════════════════════════
  // FILE IMPORT / EXPORT HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const getEffectiveGeometry = useCallback(() => effectiveResult?.geometry ?? null, [effectiveResult]);

  // Round-trip back to Studio (AI design). If the part came from Studio with its
  // SCAD source, resume it parametrically there; otherwise send the current mesh
  // so the user can keep refining it with AI ("import("model.stl")" base).
  const returnToStudio = useCallback(() => {
    try {
      if (studioScadRef.current) {
        sessionStorage.setItem('nexyfab:expert-to-studio-scad', studioScadRef.current);
      } else {
        const geo = getEffectiveGeometry();
        const b64 = geo ? geometryToStlBase64(geo) : null;
        if (!b64) { addToast('warning', '보낼 형상이 없어요 / Nothing to send'); return; }
        sessionStorage.setItem('nexyfab:expert-to-studio-stl', b64);
      }
      router.push(`/${lang}/studio?from=expert`);
    } catch {
      addToast('error', 'Studio로 보내지 못했어요 (형상이 너무 큼) / Could not send to Studio (too large)');
    }
  }, [getEffectiveGeometry, router, lang, addToast]);

  const {
    importedGeometry, setImportedGeometry,
    importedFilename, setImportedFilename,
    handleImportFile,
    handleExportCurrentSTL,
    handleExportOBJ,
    handleExportPLY,
    handleExport3MF,
    handleExportPresentationHtml } = useImportExport(addToast, getEffectiveGeometry, setSketchResult as React.Dispatch<React.SetStateAction<ShapeResult | null>>, setBomParts, setBomLabel, setIsSketchMode as React.Dispatch<React.SetStateAction<boolean>>, activeTab, resultMesh);

  // Wire the refs used by handleGeometryApply (declared above) so direct mesh
  // edits on an imported part persist onto importedGeometry.
  setImportedGeometryRef.current = setImportedGeometry;
  importedGeometryLiveRef.current = importedGeometry;

  // Image → model: vision SCAD-gen, then render → import as an editable mesh in
  // the modeler. Lets the expert modeler accept a photo like Studio does.
  const generateFromImage = useCallback(async (prompt: string, imageDataUrl: string): Promise<string | null> => {
    try {
      addToast('info', '사진 분석 중… / Reading the photo…');
      const res = await fetch('/api/nexyfab/scad-intent-from-nl', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ prompt: prompt || 'Model this object as a clean parametric part', image: imageDataUrl, freeform: true }),
      });
      const data = await res.json().catch(() => ({})) as { scad?: string; code?: string; error?: string };
      if (data.code === 'VISION_BUSY') return '이미지 분석이 혼잡해요 — 잠시 후 다시 / Image analysis busy — try again';
      if (data.code === 'VISION_FAILED') return '이미지를 이해하지 못했어요 / Could not read the image';
      if (!res.ok || !data.scad) return `이미지로 만들지 못했어요 / Could not build from image${data.error ? `: ${data.error}` : ''}`;
      const scad = data.scad;
      const rr = await fetch('/api/nexyfab/openscad-render', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ scad, format: 'stl' }),
      });
      const rd = await rr.json().catch(() => ({} as { dataBase64?: string; error?: string }));
      if (!rr.ok || !rd.dataBase64) return rr.status === 401 ? '3D 미리보기는 무료 로그인이 필요합니다 / Free login needed' : '렌더링하지 못했어요 / Render failed';
      const bin = atob(rd.dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const { parseSTL } = await import('./io/importers');
      const geo = parseSTL(bytes.buffer);
      geo.computeBoundingBox();
      studioScadRef.current = scad; // enables the Studio round-trip on this part
      setImportedGeometry(geo);
      setImportedFilename('ai-from-image');
      return '✓ 사진에서 모델을 만들었어요 / Built a model from your photo';
    } catch (e) {
      return `AI error: ${(e as Error)?.message ?? e}`;
    }
  }, [addToast, setImportedGeometry, setImportedFilename]);

  // ─── K-series Thicken (kernel-ceiling op) ────────────────────────────────
  // Thicken the active closed line-loop sketch (or a 10×10 demo when none)
  // into a solid via the real opencascade.js worker, and show it through the
  // import-display seam (setImportedGeometry) — deliberately NOT a parametric
  // feature, so it can't desync the feature tree. The kernel facade is
  // lazy-imported so it never weighs down the main modeler bundle.
  useEffect(() => {
    const onThicken = async (e: Event) => {
      const ce = e as CustomEvent<{ thickness?: number }>;
      const thickness = ce.detail?.thickness ?? 2;
      // Extract a planar loop from the active sketch's line segments; fall back
      // to a 10×10 demo square when there is no usable closed line loop.
      let loop: Array<{ x: number; y: number }> | null = null;
      const prof = activeProfile;
      if (prof?.closed) {
        const lines = prof.segments.filter((s) => s.type === 'line' && s.points.length >= 2);
        if (lines.length >= 3) loop = lines.map((s) => ({ x: s.points[0].x, y: s.points[0].y }));
      }
      if (!loop) loop = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
      addToast('info', 'Thickening surface via OCCT worker…');
      try {
        const { thickenSurfaceKSeries } = await import('./features/thickenKSeries');
        const out = await thickenSurfaceKSeries({ loop, thickness });
        if (out.ok) {
          setImportedGeometry(out.result.geometry);
          setImportedFilename(`thicken-${thickness}mm`);
          addToast('success', `Solid generated — ${out.result.volume_cm3.toFixed(3)} cm³`);
        } else {
          addToast('error', `Thicken failed: ${out.error}`);
        }
      } catch (err) {
        addToast('error', `Thicken failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    window.addEventListener('nexyfab:kseries-thicken', onThicken);
    return () => window.removeEventListener('nexyfab:kseries-thicken', onThicken);
  }, [activeProfile, setImportedGeometry, setImportedFilename, addToast]);

  // P-2(260808b) — 역루프: 현재 모델(저장 직렬화)을 FeatureProgram 역변환해
  // 챗 컨텍스트로 넘긴다("이 모델 기준으로 다시 설계"). 변환 불가·미매핑은
  // programFromNfab 이 정직 처리(챗이 미반영 피처를 그대로 표기).
  useEffect(() => {
    const onSendToChat = async () => {
      try {
        const { programFromNfab } = await import('./ai/programFromNfab');
        const result = programFromNfab(getCloudSceneObject());
        if (!result) {
          addToast('error', '현재 모델은 챗 컨텍스트로 변환할 수 없습니다 (베이스가 역변환 어휘 밖)');
          return;
        }
        sessionStorage.setItem('nexyfab:chat-context-program', JSON.stringify(result));
        window.location.href = `/${lang}#nf-chat`;
      } catch (err) {
        addToast('error', `Send to chat failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    window.addEventListener('nexyfab:send-to-chat', onSendToChat);
    return () => window.removeEventListener('nexyfab:send-to-chat', onSendToChat);
  }, [getCloudSceneObject, addToast, lang]);

  // B-6(260808e) — 좌표 실측 프로브(읽기 전용): E2E가 시드된 피처의 **월드
  // 기하**를 조회해 스케치평면↔월드 사상을 실측한다(P-1c 보스 배선의 선행
  // 조건 — 추측 배선 금지 원칙). 상태 변이 없음·직렬화 가능한 값만 반환.
  useEffect(() => {
    (window as unknown as { __nfabProbe?: () => unknown }).__nfabProbe = () => {
      const geo = effectiveResult?.geometry;
      if (!geo) return { ok: false, reason: 'no_geometry' };
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const project = getCloudSceneObject();
      return {
        // F-0 진단 확장(260808f): 표시 계층이 lastGood 폴백으로 옛 형상을 들고
        // 있는지(=result null), 파이프라인 오류가 있는지 실측 노출.
        resultNull: !result,
        baseNull: !baseShapeResult,
        baseGenError: baseGenErrorRef.current,
        // F-4 후속 — B-rep 핸들 페리 실측(워커 소속 플래그 포함).
        resultOcctHandle: (result?.geometry?.userData as { occtHandle?: string } | undefined)?.occtHandle ?? null,
        resultHandleInWorker: !!(result?.geometry?.userData as { occtHandleInWorker?: boolean } | undefined)?.occtHandleInWorker,
        pipelineErrors,
        // F-6(260808g) — 어셈블리 시드 실증용: 배치 파트의 사상 결과 실측.
        placedParts: placedParts.map(p => ({
          name: p.name, shapeId: p.shapeId, params: p.params, position: p.position, rotation: p.rotation,
        })),
        ok: true,
        bbox: bb ? { min: [bb.min.x, bb.min.y, bb.min.z], max: [bb.max.x, bb.max.y, bb.max.z] } : null,
        scene: project?.scene ? { selectedId: project.scene.selectedId, params: project.scene.params } : null,
        nodes: (project?.tree?.nodes ?? []).map(node => ({
          featureType: node.featureType ?? null, params: node.params, enabled: node.enabled,
        })),
      };
    };
    return () => { delete (window as unknown as { __nfabProbe?: unknown }).__nfabProbe; };
  }, [effectiveResult, getCloudSceneObject, result, baseShapeResult, pipelineErrors, placedParts]);

  // ─── Multi-body import → assembly parts ──────────────────────────────────
  // When an imported mesh (STL/STEP) is actually several disconnected shells,
  // split it into independent PlacedParts so each can be moved, mated,
  // balanced, and simulated — instead of one frozen blob. Single-body imports
  // are left untouched. Guarded by a ref so it runs once per imported mesh.
  const lastMultiBodySplitRef = useRef<BufferGeometry | null>(null);
  useEffect(() => {
    if (!importedGeometry || importedGeometry === lastMultiBodySplitRef.current) return;
    lastMultiBodySplitRef.current = importedGeometry;
    let count = 0;
    try { count = connectedComponentCount(importedGeometry); } catch { return; }
    if (count < 2) return;
    try {
      const shells = splitGeometryByConnectedComponent(importedGeometry, 4);
      if (shells.length < 2) return;
      const base = (importedFilename || 'part').replace(/\.[^.]+$/, '');
      // Try fitting each shell to a catalog primitive (box/cylinder/sphere).
      // If the parts are primitive-like (low average fit error), use the FITTED
      // parts — they have real params, so sliders/balance/sim all work on them
      // ("STL → parametric"). Organic shells fall back to the raw mesh.
      const fits = shells.map(fitPrimitive);
      const avgErr = fits.reduce((s, f) => s + f.fitError, 0) / fits.length;
      let placed;
      if (avgErr < 0.28) {
        placed = fittedPartsFromGeometries(shells, base);
        setPlacedParts(placed);
        setShowAssemblyPanel(true);
        addToast('success', `${placed.length}개 부품을 기본도형으로 근사 — 슬라이더로 치수 편집·균형·시뮬 가능`);
      } else {
        placed = importedGeometriesToPlaced(shells, base);
        setPlacedParts(placed);
        setShowAssemblyPanel(true);
        addToast('success', `${placed.length}개 부품으로 분리됨 — 조립 패널에서 개별 편집·메이트·균형`);
      }
    } catch (e) {
      console.warn('[multi-body import] split failed:', e);
    }
  }, [importedGeometry, importedFilename, setPlacedParts, setShowAssemblyPanel, addToast]);

  // Keep the persistent importedResult in sync with importedGeometry so the
  // imported model survives view/tab/mode switches (sketchResult, where the
  // import first lands, gets cleared by many of those transitions).
  useEffect(() => {
    if (!importedGeometry) { setImportedResult(null); importStlRef.current = null; return; }
    // Serialize the import for AI editing (wrap as import("model.stl")).
    try {
      importStlRef.current = geometryToStlBase64(importedGeometry);
      importScadRef.current = 'import("model.stl");';
    } catch { importStlRef.current = null; }
    try {
      importedGeometry.computeBoundingBox();
      const bb = importedGeometry.boundingBox;
      const size = new Vector3();
      bb?.getSize(size);
      let edgeGeometry: BufferGeometry;
      try { edgeGeometry = makeEdges(importedGeometry); } catch { edgeGeometry = new BufferGeometry(); }
      setImportedResult({
        geometry: importedGeometry,
        edgeGeometry,
        volume_cm3: meshVolume(importedGeometry) / 1000,
        surface_area_cm2: meshSurfaceArea(importedGeometry) / 100,
        bbox: { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) },
      });
    } catch {
      setImportedResult({ geometry: importedGeometry, edgeGeometry: new BufferGeometry(), volume_cm3: 0, surface_area_cm2: 0, bbox: { w: 0, h: 0, d: 0 } });
    }
  }, [importedGeometry]);

  // ── Studio → Expert handoff ──────────────────────────────────────────────
  // The free-form Studio stashes its OpenSCAD in sessionStorage. Render it to a
  // mesh and feed it into the import pipeline — which splits multi-body output
  // into shells and primitive-fits them into editable parts. Honest boundary:
  // geometry (and fitted primitives) carry over, not editable feature history.
  useEffect(() => {
    let cancelled = false;
    let scad: string | null = null;
    let programRaw: string | null = null;
    let stlB64: string | null = null;
    let sheetStep: string | null = null;
    let sheetSpec: string | null = null;
    try {
      scad = sessionStorage.getItem('nexyfab:studio-handoff-scad');
      programRaw = sessionStorage.getItem('nexyfab:studio-handoff-program');
      stlB64 = sessionStorage.getItem('nexyfab:studio-handoff-stl');
      sheetStep = sessionStorage.getItem('nexyfab:sheetmetal-handoff-step');
      sheetSpec = sessionStorage.getItem('nexyfab:sheetmetal-handoff-spec');
    } catch { return; }
    if (!scad && !programRaw && !stlB64 && !sheetStep && !sheetSpec) return;
    if (scad) studioScadRef.current = scad; // remember for the round-trip back to Studio
    try {
      sessionStorage.removeItem('nexyfab:studio-handoff-scad');
      sessionStorage.removeItem('nexyfab:studio-handoff-program');
      sessionStorage.removeItem('nexyfab:studio-handoff-stl');
      sessionStorage.removeItem('nexyfab:sheetmetal-handoff-step');
      sessionStorage.removeItem('nexyfab:sheetmetal-handoff-spec');
    } catch { /* ignore */ }
    void (async () => {
      // Sheet-metal MVP → modeler as NATIVE editable features: a thin base sheet +
      // one `flange` feature per edge. Now works because addNode reads the active
      // node from a ref (the base sheet + flanges parent correctly even batched in
      // this one handoff tick). Edge map back/front/right/left → edgeIndex 0/1/2/3
      // (modeler uses Y as thickness, so MVP length L → Z).
      if (sheetSpec) {
        try {
          const spec = JSON.parse(sheetSpec) as { W: number; L: number; T: number; bendRadius?: number; flanges?: { edge: string; height: number; angle?: number }[] };
          clearAll();
          setSelectedId('box');
          setParams({ width: spec.W, height: spec.T, depth: spec.L });
          const edgeMap: Record<string, number> = { back: 0, front: 1, right: 2, left: 3 };
          const r = Math.max(0.5, spec.bendRadius ?? spec.T);
          let n = 0;
          for (const f of (spec.flanges ?? [])) {
            addFeatureWithParams('flange', { thickness: spec.T, material: 0, height: Math.max(1, f.height), angle: f.angle ?? 90, radius: r, edgeIndex: edgeMap[f.edge] ?? 0 });
            n++;
          }
          if (n > 0) addToast('success', '판금 부품을 편집 가능한 플랜지 피처로 가져왔어요 — 높이·각도 수정 가능');
          return;
        } catch (e) { console.warn('[sheetmetal spec handoff] failed:', e); }
      }
      // Sheet-metal MVP → modeler: the folded part as a B-rep STEP. Import via
      // the proven replicad mesh pipeline (same as the toolbar STEP import) so it
      // becomes an editable/analysable part — feeds FEA · DFM · quoting.
      if (sheetStep) {
        try {
          const { prepareImportedShapeFromBuffer } = await import('./io/importMeshPipeline');
          const buf = new TextEncoder().encode(sheetStep).buffer;
          const prepared = await prepareImportedShapeFromBuffer('nexyfab-sheetmetal.step', buf);
          if (cancelled) return;
          setImportedGeometry(prepared.geometry);
          setImportedFilename(prepared.filename);
          setSketchResult({
            geometry: prepared.geometry, edgeGeometry: prepared.edgeGeometry,
            volume_cm3: prepared.volume_cm3, surface_area_cm2: prepared.surface_area_cm2, bbox: prepared.bbox,
          });
          addToast('success', '판금 부품을 모델러로 가져왔어요 — FEA·DFM·견적 가능');
        } catch (e) {
          console.warn('[sheetmetal handoff] STEP import failed:', e);
          if (!cancelled) addToast('error', '판금 부품 가져오기 실패');
        }
        return;
      }
      // Precise designs carry a feature program → rebuild an EDITABLE feature
      // tree (the modeler then builds it via OCCT → analytic B-rep + STEP).
      if (programRaw) {
        try {
          const program = JSON.parse(programRaw);
          const { reconstructFeatureTree } = await import('./ai/programToFeatures');
          if (cancelled) return;
          const out = reconstructFeatureTree(program, {
            addSketchFeature, addFeatureWithParams,
            // Replace the default base primitive (avoids unioning onto the
            // modeler's default 50×30×20 box) and clear any prior features.
            setBaseShape: (id, p) => { setSelectedId(id); setParams(p); },
            clearFeatures: clearAll,
            // F-6(260808g) — 멀티바디 프로그램: 배치 파트로 어셈블리 시드
            // (AI 코파일럿 store.setAssemblyParts 와 동일 배선).
            setAssemblyParts: (parts) => {
              const stamp = Date.now();
              setPlacedParts(parts.map((p, i) => ({
                id: `hp_${stamp}_${i}`,
                name: p.name || `${p.shapeId} ${i + 1}`,
                shapeId: p.shapeId,
                params: p.params,
                qty: 1,
                position: p.position ?? [0, 0, 0],
                rotation: p.rotation ?? [0, 0, 0],
              })));
              setShowAssemblyPanel(true);
            },
          });
          if (out.ok) {
            addToast('success', out.skipped.length
              ? `정밀 부품을 편집 가능한 피처트리로 가져왔어요 (${out.skipped.join(', ')}는 미반영)`
              : '정밀 부품을 편집 가능한 피처트리로 가져왔어요');
            return;
          }
        } catch (e) {
          console.warn('[precise handoff] feature rebuild failed, falling back to mesh import:', e);
        }
      }
      // Fast path: the Studio already rendered the mesh (client-side WASM) and
      // handed over the STL — import it directly, no server render (works for
      // guests, who can't call the render API).
      if (stlB64) {
        try {
          const bin = atob(stlB64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const { parseSTL } = await import('./io/importers');
          const geo = parseSTL(bytes.buffer);
          geo.computeBoundingBox();
          if (cancelled) return;
          setImportedGeometry(geo);
          setImportedFilename('studio-model');
          addToast('success', 'Studio 모델 가져옴 — 다부품이면 자동 분리·근사');
          return;
        } catch (e) {
          console.warn('[studio handoff] STL import failed, falling back to render:', e);
        }
      }
      // Free-form (or precise fallback): render the OpenSCAD → imported mesh.
      if (!scad) return;
      try {
        addToast('info', 'Studio 모델 가져오는 중…');
        const res = await fetch('/api/nexyfab/openscad-render', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ scad, format: 'stl' }),
        });
        const data = await res.json().catch(() => ({} as { dataBase64?: string; error?: string }));
        if (!res.ok || !data.dataBase64) throw new Error(data.error || 'render failed');
        const bin = atob(data.dataBase64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const { parseSTL } = await import('./io/importers');
        const geo = parseSTL(bytes.buffer);
        geo.computeBoundingBox();
        if (cancelled) return;
        setImportedGeometry(geo);
        setImportedFilename('studio-model');
        addToast('success', 'Studio 모델 가져옴 — 다부품이면 자동 분리·근사');
      } catch (e) {
        console.warn('[studio handoff] failed:', e);
        if (!cancelled) addToast('error', 'Studio 모델 가져오기 실패');
      }
    })();
    return () => { cancelled = true; };
  }, [setImportedGeometry, setImportedFilename, addToast, addSketchFeature, addFeatureWithParams, setSelectedId, setParams, clearAll, setSketchResult]);

  // ─── K-series STEP import (B-rep, gap #3) ────────────────────────────────
  // Read a STEP file as a true OCCT B-rep solid (STEPControl_Reader via the
  // worker) and show it through the import-display seam — accurate volume/bbox,
  // re-exportable, vs the default occt-import-js → tessellated-mesh path. Accepts
  // inline `stepText` (tests) or opens a file picker. Lazy-imported.
  useEffect(() => {
    const runImport = async (stepText: string) => {
      addToast('info', 'Importing STEP as B-rep via OCCT worker…');
      try {
        const { importStepKSeries } = await import('./features/stepImportKSeries');
        const out = await importStepKSeries(stepText);
        if (out.ok) {
          setImportedGeometry(out.result.geometry);
          setImportedFilename('imported.step (B-rep)');
          addToast('success', `STEP imported as B-rep — ${out.result.volume_cm3.toFixed(3)} cm³`);
        } else {
          addToast('error', `STEP B-rep import failed: ${out.error}`);
        }
      } catch (err) {
        addToast('error', `STEP B-rep import failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    const onImport = (e: Event) => {
      const ce = e as CustomEvent<{ stepText?: string }>;
      if (ce.detail?.stepText) { void runImport(ce.detail.stepText); return; }
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.step,.stp,.STEP,.STP';
      input.onchange = () => {
        const f = input.files?.[0];
        if (f) void f.text().then(runImport);
      };
      input.click();
    };
    window.addEventListener('nexyfab:kseries-import-step', onImport);
    return () => window.removeEventListener('nexyfab:kseries-import-step', onImport);
  }, [setImportedGeometry, setImportedFilename, addToast]);

  const handleExportSTEP = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    if (!planLimits.exportFormats.includes('step')) {
      promptUpgrade(lt.stepExportFeature); return;
    }
    // Soft upsell: free users see a one-time prompt describing Pro-only
    // pre-export optimization. The export still proceeds after the modal closes.
    if (!isProPlan && !exportOptimizeUpsellShownRef.current) {
      exportOptimizeUpsellShownRef.current = true;
      setShowExportOptimizeUpgrade(true);
    }
    setExportingFormat('STEP');
    try {
      const { exportManufacturingZipBundle } = await import('./io/manufacturingPackage');
      const slug = (selectedId ?? 'part').replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 48) || 'part';
      const day = new Date().toISOString().slice(0, 10);
      const base = `nexyfab-${slug}-${day}`;
      const er = effectiveResult;
      const generatedAt = new Date().toISOString();
      await exportManufacturingZipBundle(geo, base, {
        partLabel: selectedId ?? 'part',
        shapeTemplateId: selectedId ?? undefined,
        bbox: er.bbox,
        volume_cm3: er.volume_cm3,
        surface_area_cm2: er.surface_area_cm2,
        unitSystem,
        materialKey: materialId,
        generatedAt,
      }, placedParts.length > 0 ? buildBomRows() : undefined);
      analytics.shapeDownload('STEP');
      addToast('success', lt.stepExportBundleSuccess);
    } catch (err) {
      console.error('[Export STEP]', err);
      addToast('error', lt.stepExportFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, addToast, lang, planLimits.exportFormats, promptUpgrade, isProPlan, setShowExportOptimizeUpgrade, selectedId, unitSystem, materialId, buildBomRows, placedParts.length]);

  const handleExportGLTF = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    if (!planLimits.exportFormats.includes('gltf')) {
      promptUpgrade(lt.gltfExportFeature); return;
    }
    setExportingFormat('GLTF');
    try {
      const { exportGLTF } = await import('./io/exporters');
      await exportGLTF(geo, 'shape-design');
      analytics.shapeDownload('GLTF');
      addToast('success', 'GLTF (GLB) exported successfully');
    } catch (err) {
      console.error('GLTF export failed:', err);
      addToast('error', 'GLTF export failed');
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, addToast]);

  // ── W5-H: SAT / IGES / IFC — brep-bridge 라이터 경유(io/brepExportActions).
  // 라이터는 자체 검증 실패 시 사유째 throw(생성≠검증) → 사유 원문을 토스트.
  const handleBrepFormatExport = useCallback((format: BrepExportFormat) => {
    void runBrepExport(format, effectiveResult?.geometry, planLimits.exportFormats, {
      onGated: () => promptUpgrade(
        format === 'sat' ? lt.satExportFeature : format === 'iges' ? lt.igesExportFeature : lt.ifcExportFeature,
      ),
      onStart: () => setExportingFormat(format.toUpperCase()),
      onSuccess: () => {
        analytics.shapeDownload(format.toUpperCase());
        addToast('success', `${format.toUpperCase()} exported`);
      },
      onRefused: (reason) => addToast('error', reason),
      onFinally: () => setExportingFormat(null),
    });
  }, [effectiveResult, planLimits.exportFormats, promptUpgrade, addToast, lt]);
  const handleExportSAT = useCallback(() => handleBrepFormatExport('sat'), [handleBrepFormatExport]);
  const handleExportIGES = useCallback(() => handleBrepFormatExport('iges'), [handleBrepFormatExport]);
  const handleExportIFC = useCallback(() => handleBrepFormatExport('ifc'), [handleBrepFormatExport]);

  const [dxfProjection, setDxfProjection] = useState<'xy' | 'xz' | 'yz'>('xy');

  const handleExportDXF = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    if (!planLimits.exportFormats.includes('dxf')) {
      promptUpgrade(lt.dxfExportFeature); return;
    }
    setExportingFormat('DXF');
    try {
      const { exportDXF, geometryToDXFEntities } = await import('./io/dxfExporter');
      const entities = geometryToDXFEntities(geo, dxfProjection);
      if (entities.length === 0) {
        addToast('warning', 'No edges found for DXF export');
        setExportingFormat(null);
        return;
      }
      await exportDXF(entities, 'shape-design');
      addToast('success', lt.dxfExported);
    } catch (err) {
      console.error('DXF export failed:', err);
      addToast('error', lt.dxfExportFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [effectiveResult, dxfProjection, addToast, lang]);

  // Sheet-metal flat pattern DXF — outline (CUT) + bend lines (BEND_UP/DOWN)
  // + bend table. Reads the FlatPatternResult either from the active geometry
  // if it was produced by the flatPattern feature, or regenerates one on the
  // fly from the current effective geometry.
  const handleExportFlatPatternDXF = useCallback(async () => {
    const geo = effectiveResult?.geometry;
    if (!geo) {
      addToast('error', lt.createShapeFirst);
      return;
    }
    try {
      const { generateFlatPattern, getFlatPatternMetadata } = await import('./features/sheetMetal');
      const { exportSheetMetalDXF } = await import('./io/dxfExporter');
      let pattern = getFlatPatternMetadata(geo);
      if (!pattern) {
        // Fall back to regenerating with defaults so the user still gets a
        // usable DXF even if they didn't run the flatPattern feature first.
        const result = generateFlatPattern(geo, [], 2, 'mildSteel');
        pattern = {
          width: result.width,
          length: result.length,
          thickness: result.thickness,
          material: result.material,
          bendTable: result.bendTable,
          warnings: result.warnings };
      }
      await exportSheetMetalDXF({ geometry: geo, ...pattern }, 'flat-pattern');
      if (pattern.warnings.length > 0) {
        for (const w of pattern.warnings) {
          addToast(w.severity, lang === 'ko' ? w.messageKo : w.messageEn); // messages come from analysis modules
        }
      }
      addToast('success', lt.flatDxfExported);
    } catch (err) {
      addToast('error', lt.flatDxfFailed(err instanceof Error ? err.message : String(err)));
    }
  }, [effectiveResult, addToast, lang]);

  const handleExportRhino = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    if (!planLimits.exportFormats.includes('rhino')) {
      promptUpgrade(lt.rhinoExportFeature); return;
    }
    setExportingFormat('Rhino');
    try {
      const { exportRhinoJSON } = await import('./io/rhinoExport');
      await exportRhinoJSON(geo, 'shape-design', 'Shape');
      addToast('success', lt.rhinoExported);
    } catch (err) {
      console.error('[Export Rhino]', err);
      addToast('error', lt.rhinoFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [getEffectiveGeometry, addToast, lang]);

  const handleExportGrasshopper = useCallback(async () => {
    const geo = getEffectiveGeometry();
    if (!geo) return;
    if (!planLimits.exportFormats.includes('grasshopper')) {
      promptUpgrade(lt.grasshopperExportFeature); return;
    }
    setExportingFormat('Grasshopper');
    try {
      const { exportGrasshopperPoints } = await import('./io/rhinoExport');
      await exportGrasshopperPoints(geo, 'shape-design-points');
      addToast('success', lt.grasshopperExported);
    } catch (err) {
      console.error('[Export Grasshopper]', err);
      addToast('error', lt.grasshopperFailed);
    } finally {
      setExportingFormat(null);
    }
  }, [getEffectiveGeometry, addToast, lang]);

    // ══════════════════════════════════════════════════════════════════════════
  // SCENE SAVE / LOAD / GLB EXPORT
  // ══════════════════════════════════════════════════════════════════════════

  const sceneRef = useRef<Scene | null>(null);
  const sceneFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSaveScene = useCallback(async () => {
    try {
      const { serializeScene, exportSceneAsJSON } = await import('./io/sceneSerializer');
      const serializableShapes: Array<{ id: string; shapeType: string; params: Record<string, number>; position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number]; materialPreset: string; color: string }> = features.map(f => ({
        id: f.id,
        shapeType: f.type as string,
        params: { ...f.params },
        position: [0, 0, 0] as [number, number, number],
        rotation: [0, 0, 0] as [number, number, number],
        scale: [1, 1, 1] as [number, number, number],
        materialPreset: materialId,
        color: 'var(--nx-accent-2)' }));
      // Include the base shape as the first entry
      serializableShapes.unshift({
        id: `base_${selectedId}`,
        shapeType: selectedId,
        params: { ...params },
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        materialPreset: materialId,
        color: 'var(--nx-accent-2)' });
      const state = serializeScene(serializableShapes, undefined);
      await exportSceneAsJSON(state, 'nexyfab-scene');
      addToast('success', t.sceneSaved ?? 'Scene saved');
    } catch (err) {
      console.error('Scene save failed:', err);
      addToast('error', lt.sceneSaveFailed);
    }
  }, [features, selectedId, params, materialId, addToast, t, lang]);

  const handleLoadScene = useCallback(() => {
    sceneFileInputRef.current?.click();
  }, []);

  const handleSceneFileSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { importSceneFromJSON, deserializeScene } = await import('./io/sceneSerializer');
      const state = await importSceneFromJSON(file);
      const { shapes } = deserializeScene(state);
      // Apply the base shape (first entry with prefix base_)
      const baseEntry = shapes.find(s => s.id.startsWith('base_'));
      if (baseEntry && SHAPE_MAP[baseEntry.shapeType]) {
        const sceneSd = SHAPE_MAP[baseEntry.shapeType];
        setSelectedId(baseEntry.shapeType);
        applySceneParamsToSetters(sceneSd, baseEntry.params, {
          setParams,
          setParamExpressions,
        });
      }
      // Restore material
      if (baseEntry?.materialPreset) {
        setMaterialId(baseEntry.materialPreset);
      }
      clearAll();
      addToast('success', t.sceneImported ?? 'Scene imported');
    } catch (err) {
      console.error('Scene import failed:', err);
      addToast('error', lt.sceneLoadFailed);
    }
    e.target.value = '';
  }, [clearAll, addToast, t, lang, setParamExpressions, setParams, setSelectedId]);

  const handleExportGLB = useCallback(async () => {
    if (!sceneRef.current) {
      addToast('warning', lt.loadSceneFirst);
      return;
    }
    try {
      const { exportSceneGLB } = await import('./io/gltfExportUtils');
      await exportSceneGLB(sceneRef.current, 'nexyfab-scene');
      analytics.shapeDownload('GLB');
      addToast('success', t.exportGLB ? `${t.exportGLB} OK` : 'GLB exported');
    } catch (err) {
      console.error('GLB export failed:', err);
      addToast('error', lt.glbExportFailed);
    }
  }, [addToast, t, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // MESH PROCESSING HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleMeshProcess = useCallback(async (op: string) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const mesh = await import('./mesh/meshProcessing');
    let processed: BufferGeometry;
    switch (op) {
      case 'repair': processed = mesh.repairMesh(geo); break;
      case 'reduceNoise': processed = mesh.reduceNoise(geo); break;
      case 'fillHoles': processed = mesh.fillHoles(geo); break;
      case 'simplify': processed = mesh.simplifyMesh(geo, 0.5); break;
      case 'remesh': processed = mesh.remesh(geo, 5); break;
      case 'smooth': processed = mesh.smoothMesh(geo); break;
      case 'flipNormals': processed = mesh.flipNormals(geo); break;
      case 'removeSpikes': processed = mesh.removeSpikes(geo); break;
      case 'detached': processed = mesh.detachedTriangles(geo); break;
      default: return;
    }
    const edgeGeometry = makeEdges(processed);
    const volume_cm3 = meshVolume(processed) / 1000;
    const surface_area_cm2 = meshSurfaceArea(processed) / 100;
    processed.computeBoundingBox();
    const bb = processed.boundingBox;
    if (!bb) return;
    const size = bb.getSize(new Vector3());
    const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
    setSketchResult({ geometry: processed, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
    addToast('success', `Mesh "${op}" completed`);
  }, [effectiveResult, addToast]);

  // ══════════════════════════════════════════════════════════════════════════
  // ANALYSIS HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  // Simple panel-opener dispatch. Entries that don't need geometry or side data
  // just flip a local flag; complex cases fall through to the switch below.
  const panelOpeners = useMemo<Record<string, () => void>>(() => ({
    history:          () => useUIStore.getState().togglePanel('showHistoryPanel'),
    array:            () => useUIStore.getState().togglePanel('showArrayPanel'),
    dimensionAdvisor: () => useUIStore.getState().openAIAssistant('advisor'),
    fea:              () => { setShowFEA(true); setFeaResult(null); },
    massProperties:   () => { setShowMassProps(true); setShowCenterOfMass(null); },
    gdt:              () => setShowAnnotationPanel(true),
    dfm:              () => { setShowDFM(true); setDfmResults(null); setDfmHighlightedIssue(null); },
    draftAnalysis:    () => { setShowDraftAnalysis(true); setDraftResult(null); },
    holeWizard:       () => { setShowHoleWizard(true); },
    thermal:          () => setShowThermalPanel(true),
    generativeDesign: () => setShowGenDesign(true),
    ecad:             () => setShowECADPanel(true),
    motionStudy:      () => setShowMotionStudy(true),
    modalAnalysis:    () => setShowModalAnalysis(true),
    bucklingAnalysis: () => setShowBucklingAnalysis(true),
    parametricSweep:  () => setShowParametricSweep(true),
    toleranceStackup: () => setShowToleranceStackup(true),
    surfaceQuality:   () => setShowSurfaceQuality(true),
    // Phase-6 cutover: autoDrawing now navigates to the dedicated
    // Drawing route instead of opening a modal. The legacy modal state
    // (setShowAutoDrawing) is preserved for regression-rollback only
    // and is no longer reachable from the toolbar.
    autoDrawing:      () => router.push(`/${langRef.current}/shape-generator/drawing`),
    mfgPipeline:      () => setShowMfgPipeline(true) }), [router]);

  // Entries that need geometry to be meaningful — handleAnalysis will bail before
  // opening the panel if `effectiveResult.geometry` is missing.
  const PANELS_REQUIRING_GEO = new Set([
    'fea', 'massProperties', 'gdt', 'dfm', 'thermal',
    'generativeDesign', 'ecad', 'motionStudy', 'modalAnalysis', 'bucklingAnalysis',
    'parametricSweep', 'toleranceStackup', 'surfaceQuality',
    'autoDrawing', 'mfgPipeline',
  ]);

  const handleAnalysis = useCallback(async (type: string) => {
    // History / array / dimensionAdvisor toggles don't require geometry
    if (type === 'history' || type === 'array' || type === 'dimensionAdvisor') {
      panelOpeners[type]();
      return;
    }
    const geo = effectiveResult?.geometry;
    if (!geo) return;

    // Simple panel opens go through the dispatch table
    if (PANELS_REQUIRING_GEO.has(type)) {
      panelOpeners[type]?.();
      return;
    }

    // Complex cases: async imports, freemium gates, or extra inputs
    switch (type) {
      case 'validation': {
        const { validateGeometry } = await import('./analysis/geometryValidation');
        setValidationResult(validateGeometry(geo));
        setShowValidation(true);
        addToast('info', 'Validation complete');
        return;
      }
      case 'deviation': {
        if (!importedGeometry || !sketchResult) {
          addToast('warning', 'Deviation analysis requires both a reference and test mesh');
        }
        return;
      }
      case 'printability': {
        setShowPrintAnalysis(true);
        const { analyzePrintability } = await import('./analysis/printAnalysis');
        setPrintAnalysis(analyzePrintability(geo, {
          buildDirection: printBuildDir,
          overhangAngle: printOverhangAngle }));
        addToast('info', lt.printAnalysisComplete);
        return;
      }
      case 'cam': {
        if (!checkFreemium('cam_export').allowed) { setShowCamUpgrade(true); return; }
        const CAM_HEAVY_VERTEX_THRESHOLD = 80_000;
        const vtx = geo.attributes.position?.count ?? 0;
        if (vtx >= CAM_HEAVY_VERTEX_THRESHOLD && !getSuppressCadPerfToasts()) {
          addToast('info', lt.camHeavyMeshHint);
        }
        const { generateCAMToolpaths } = await import('./analysis/camLite');
        const operation = {
          type: 'face_mill' as const,
          toolDiameter: 10, stepover: 50, stepdown: 2,
          feedRate: 500, spindleSpeed: 3000 };
        const result = generateCAMToolpaths(geo, operation);
        reportInfo('cam_toolpath', 'toolpaths_generated', {
          operationType: operation.type,
          toolDiameter: operation.toolDiameter,
          passes: result.toolpaths.length,
          estimatedMinutes: Number(result.estimatedTime.toFixed(2)),
        });
        setCamSimResult({ result, operation });
        setShowCAMSimPanel(true);
        addToast('success', lt.gcodeGenerated ? lt.gcodeGenerated('simulation', result.toolpaths.length, 0, Number(result.estimatedTime.toFixed(1)), '') : 'CAM Paths generated');
        return;
      }
    }
  }, [effectiveResult, importedGeometry, sketchResult, addToast, printBuildDir, printOverhangAngle, lang, panelOpeners, mfgCamPost, selectedId, checkFreemium, lt]);

  // ── Shell-v2 File menu / CAM section bridge (orphan CustomEvents fixed) ──
  // ModelerShell's File menu dispatches 'nexyfab:file-import' / 'nexyfab:file-
  // export' and ModelerRightPane's CAM section dispatches 'nexyfab:cam-export',
  // none of which had a listener (dead buttons). Wire them onto the existing
  // flows — same pattern as the other nexyfab:* listener effects. This effect
  // lives below the handlers it calls (handleImportFile / handleExportSTEP /
  // handleAnalysis) to avoid a TDZ on the dep array during render.
  useEffect(() => {
    // File → Import STEP/IGES… : reuse the existing picker-based import flow.
    const onFileImport = () => { handleImportFile(); };
    // File → Export STL / STEP : call the existing export handlers.
    const onFileExport = (e: Event) => {
      const format = (e as CustomEvent<{ format?: string } | undefined>).detail?.format;
      if (!effectiveResult?.geometry) {
        addToast('warning', lang === 'ko' ? '내보낼 형상이 없습니다 — 먼저 형상을 생성하세요.' : 'Nothing to export — generate a shape first.');
        return;
      }
      if (format === 'stl') { void handleExportCurrentSTL(); return; }
      if (format === 'step') { void handleExportSTEP(); return; }
      if (format === 'papercraft') {
        // Unfold the current model into a laser-ready papercraft net (DXF).
        void (async () => {
          const geo = effectiveResult.geometry;
          const posAttr = geo.attributes.position;
          if (!posAttr) { addToast('error', lang === 'ko' ? '형상에 정점이 없습니다.' : 'No vertices.'); return; }
          const positions = Array.from(posAttr.array as ArrayLike<number>);
          const indices = geo.index ? Array.from(geo.index.array as ArrayLike<number>) : null;
          addToast('info', lang === 'ko' ? '종이 전개도를 만드는 중…' : 'Unfolding to papercraft…');
          try {
            const res = await fetch('/api/nexyfab/papercraft-unfold', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ positions, indices }),
            });
            const j = await res.json() as { ok?: boolean; dxf?: string; pieces?: number; faceCount?: number; overlaps?: number; error?: string; code?: string };
            if (!res.ok || !j.ok || !j.dxf) {
              // Too-dense (curved/high-poly) meshes can't fold into flat paper —
              // guide the user to a low-poly model or the layered-diorama path.
              const dense = j.code === 'UNFOLD_REJECT' || /dense/i.test(j.error ?? '');
              addToast('error', dense
                ? (lang === 'ko'
                  ? `모델이 너무 정밀해 종이접기 전개가 어렵습니다 (${j.faceCount ?? '?'}면). 곡면/고폴리 제품은 적층(레이어) 디오라마가 적합해요 — /papercraft 페이지를 이용하세요.`
                  : `Model too detailed to fold into paper (${j.faceCount ?? '?'} faces). Curved/high-poly parts suit a layered diorama — use the /papercraft page.`)
                : (j.error || (lang === 'ko' ? '펼치기에 실패했어요.' : 'Unfold failed.')));
              return;
            }
            const blob = new Blob([j.dxf], { type: 'application/dxf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'papercraft-net.dxf'; a.click();
            URL.revokeObjectURL(url);
            addToast('success', lang === 'ko'
              ? `종이 전개도 생성 — ${j.pieces}조각 · 면 ${j.faceCount}개${j.overlaps ? ` (겹침 ${j.overlaps})` : ''}`
              : `Papercraft net — ${j.pieces} pieces · ${j.faceCount} faces`);
          } catch (err) { addToast('error', String((err as Error).message)); }
        })();
        return;
      }
      if (format === 'papercraft-slice') {
        // Cross-section the model into foam-board (우드락) slabs — works for
        // curved / high-poly imports that can't fold. Default 5mm slabs.
        void (async () => {
          const geo = effectiveResult.geometry;
          const posAttr = geo.attributes.position;
          if (!posAttr) { addToast('error', lang === 'ko' ? '형상에 정점이 없습니다.' : 'No vertices.'); return; }
          const positions = Array.from(posAttr.array as ArrayLike<number>);
          const indices = geo.index ? Array.from(geo.index.array as ArrayLike<number>) : null;
          addToast('info', lang === 'ko' ? '적층 슬라이스를 만드는 중…' : 'Slicing into stacked layers…');
          try {
            const res = await fetch('/api/nexyfab/papercraft-slice', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ positions, indices, thickness: 5 }),
            });
            const j = await res.json() as { ok?: boolean; dxf?: string; layerCount?: number; error?: string };
            if (!res.ok || !j.ok || !j.dxf) { addToast('error', j.error || (lang === 'ko' ? '슬라이스에 실패했어요.' : 'Slice failed.')); return; }
            const blob = new Blob([j.dxf], { type: 'application/dxf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'papercraft-layers.dxf'; a.click();
            URL.revokeObjectURL(url);
            addToast('success', lang === 'ko'
              ? `적층 슬라이스 생성 — ${j.layerCount}장 (5mm 보드 기준). 잘라서 쌓으세요.`
              : `Sliced into ${j.layerCount} layers (5mm board). Cut & stack.`);
          } catch (err) { addToast('error', String((err as Error).message)); }
        })();
        return;
      }
      addToast('warning', `Unknown export format: ${format ?? '(none)'}`);
    };
    // Properties → CAM → export : persist the chosen post-processor dialect,
    // then run the existing CAM flow (freemium gate → toolpath generation →
    // CAMSimPanel, where the actual G-code download button lives).
    const onCamExport = (e: Event) => {
      const detail = (e as CustomEvent<{ dialect?: string; machine?: string } | undefined>).detail;
      if (!effectiveResult?.geometry) {
        addToast('warning', lang === 'ko' ? 'CAM 내보내기는 형상이 필요합니다 — 먼저 형상을 생성하세요.' : 'CAM export needs geometry — generate a shape first.');
        return;
      }
      if (detail?.dialect) setMfgCamPost(detail.dialect);
      void handleAnalysis('cam');
    };
    window.addEventListener('nexyfab:file-import', onFileImport);
    window.addEventListener('nexyfab:file-export', onFileExport);
    window.addEventListener('nexyfab:cam-export', onCamExport);
    return () => {
      window.removeEventListener('nexyfab:file-import', onFileImport);
      window.removeEventListener('nexyfab:file-export', onFileExport);
      window.removeEventListener('nexyfab:cam-export', onCamExport);
    };
  }, [handleImportFile, handleExportCurrentSTL, handleExportSTEP, handleAnalysis, setMfgCamPost, effectiveResult, addToast, lang]);

  // ── GD&T Annotation handlers ──
  const handleAddGDT = useCallback((a: GDTAnnotation) => addGDTAnnotation(a), [addGDTAnnotation]);
  const handleUpdateGDT = useCallback((id: string, u: Partial<GDTAnnotation>) => updateGDTAnnotation(id, u), [updateGDTAnnotation]);
  const handleRemoveGDT = useCallback((id: string) => removeGDTAnnotation(id), [removeGDTAnnotation]);
  const handleAddDimAnnotation = useCallback((a: DimensionAnnotation) => addDimensionAnnotation(a), [addDimensionAnnotation]);
  const handleUpdateDimAnnotation = useCallback((id: string, u: Partial<DimensionAnnotation>) => updateDimensionAnnotation(dimensionAnnotations.map(a => a.id === id ? { ...a, ...u } : a)), [updateDimensionAnnotation, dimensionAnnotations]);
  const handleRemoveDimAnnotation = useCallback((id: string) => removeDimensionAnnotation(id), [removeDimensionAnnotation]);

  const handlePrintAnalyze = useCallback(async (options: PrintAnalysisOptions) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const { analyzePrintability } = await import('./analysis/printAnalysis');
    const result = analyzePrintability(geo, options);
    setPrintAnalysis(result);
    if (options.buildDirection) setPrintBuildDir(options.buildDirection);
    if (options.overhangAngle != null) setPrintOverhangAngle(options.overhangAngle);
    addToast('info', lt.printAnalysisComplete);
  }, [effectiveResult, addToast, lang]);

  const [printOptimization, setPrintOptimization] = useState<OrientationOptimizationResult | null>(null);

  const handleOptimizeOrientation = useCallback(async (
    overhangAngle: number,
    currentDirection: [number, number, number],
  ) => {
    const geo = effectiveResult?.geometry;
    if (!geo) {
      addToast('warning', lt.generateShapeFirst);
      return;
    }
    const { findOptimalOrientation } = await import('./analysis/printAnalysis');
    const result = findOptimalOrientation(geo, { overhangAngle, currentDirection });
    setPrintOptimization(result);
    const best = result.candidates[result.bestIndex];
    const cur  = result.candidates[result.currentIndex];
    if (result.bestIndex === result.currentIndex) {
      addToast('success', lt.alreadyOptimalOrientation);
    } else {
      const pct = cur.supportArea > 0
        ? Math.round(((cur.supportArea - best.supportArea) / cur.supportArea) * 100)
        : 0;
      addToast('info', lt.orientationSaves(best.label, pct));
    }
  }, [effectiveResult, addToast, lang]);

  const handleExportPrintReady = useCallback(async (settings: {
    process: 'fdm' | 'sla' | 'sls';
    layerHeight: number;
    infillPercent: number;
    printSpeed: number;
    buildDirection: [number, number, number];
  }) => {
    const geo = effectiveResult?.geometry;
    if (!geo) {
      addToast('warning', lt.generateShapeFirst);
      return;
    }
    try {
      const { exportPrintReady } = await import('./io/exporters');
      const baseName = `nexyfab-${settings.process}-${Date.now()}`;
      await exportPrintReady(geo, baseName, {
        process: settings.process,
        layerHeight: settings.layerHeight,
        infillPercent: settings.infillPercent,
        printSpeed: settings.printSpeed,
        buildDirection: settings.buildDirection,
        materialId,
        estimatedTimeMin: printAnalysis?.printTime,
        estimatedCostUsd: printAnalysis?.costBreakdown?.totalCost });
      addToast('success', lt.printReadyDownloaded);
    } catch (err) {
      console.error('[exportPrintReady]', err);
      addToast('error', lt.exportFailed);
    }
  }, [effectiveResult, materialId, printAnalysis, addToast, lang]);

  const handleApplyOptimalOrientation = useCallback(async (direction: [number, number, number]) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const { analyzePrintability } = await import('./analysis/printAnalysis');
    const result = analyzePrintability(geo, {
      buildDirection: direction,
      overhangAngle: printOverhangAngle });
    setPrintAnalysis(result);
    setPrintBuildDir(direction);
    // Re-run the optimizer with the new current direction so the ranking updates
    const { findOptimalOrientation } = await import('./analysis/printAnalysis');
    setPrintOptimization(findOptimalOrientation(geo, {
      overhangAngle: printOverhangAngle,
      currentDirection: direction }));
    addToast('success', lt.optimalOrientationApplied);
  }, [effectiveResult, printOverhangAngle, addToast, lang]);

  const handleDFMAnalyze = useCallback(async (
    processes: ManufacturingProcess[],
    options: { minWallThickness: number; minDraftAngle: number; maxAspectRatio: number },
    opts?: { suppressUpgradePrompt?: boolean; suppressSuccessToast?: boolean },
  ) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const plan = useAuthStore.getState().user?.plan;
    if (!dfmAnalysisAllowed(plan)) {
      if (!opts?.suppressUpgradePrompt) {
        promptUpgrade(lt.dfmAnalysisFeature);
      }
      return;
    }
    try {
      const results = await analyzeDFMWorker(geo, processes, options);
      setDfmResults(results);
      setDfmHighlightedIssue(null);
      consumeFreeDfmCreditIfUnpaid(plan);
      if (!opts?.suppressSuccessToast) {
        addToast('info', lt.dfmAnalysisComplete);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', lt.dfmFailed(msg));
    }
  }, [effectiveResult, analyzeDFMWorker, addToast, lang, promptUpgrade, setDfmHighlightedIssue, lt]);

  const handleApplyDFMFix = useCallback((
    _issueType: string,
    suggestion: { paramKey: string; value: number; label: { ko: string; en: string } },
  ) => {
    const gate = checkFreemium('dfm_autofix');
    if (!gate.allowed) {
      setShowDFMFixUpgrade(true);
      return;
    }
    setParam(suggestion.paramKey, suggestion.value);
    addToast('success', lt.autoFixApplied(lang === 'ko' ? suggestion.label.ko : suggestion.label.en));
  }, [setParam, addToast, lang, checkFreemium, setShowDFMFixUpgrade]);

  /**
   * K1 — Auto-Draft Fix.
   * Bulk-resolves every draft_angle DFM issue at once by appending a `draft`
   * feature with the recommended 1.5° angle. The existing per-issue Apply
   * Fix path only edits a single param; this is the "fix all at once" flow
   * that closes the DFM-detect → CAD-apply loop.
   */
  const handleAutoDraftFix = useCallback(() => {
    const gate = checkFreemium('dfm_autofix');
    if (!gate.allowed) {
      setShowDFMFixUpgrade(true);
      return;
    }
    const draftIssues = (dfmResults ?? [])
      .flatMap(r => r.issues)
      .filter(i => i.type === 'draft_angle');
    if (draftIssues.length === 0) {
      addToast('info', lang === 'ko' ? '구배 부족 영역이 없습니다.' : 'No draft-angle issues to fix.');
      return;
    }
    addFeatureWithParams('draft', { angle: 1.5, direction: 0 });
    addToast(
      'success',
      lang === 'ko'
        ? `구배 1.5° 자동 적용 (영향: ${draftIssues.length}개 면)`
        : `Applied 1.5° draft to ${draftIssues.length} face(s)`,
    );
  }, [dfmResults, addFeatureWithParams, addToast, lang, checkFreemium, setShowDFMFixUpgrade]);

  // ── AI DFM Explainer (Phase 1) ─────────────────────────────────────────
  const handleExplainDFMIssue = useCallback(async (issue: DFMIssue): Promise<DFMExplanation | null> => {
    const gate = checkFreemium('dfm_insights');
    if (!gate.allowed) {
      setShowDFMInsightsUpgrade(true);
      return null;
    }
    try {
      const exp = await explainDFMIssue(issue, {
        process: issue.process,
        material: materialId,
        params,
        lang,
        projectId: currentProjectId ?? undefined });
      return exp;
    } catch (err) {
      const e = err as Error & { requiresPro?: boolean };
      if (e.requiresPro) {
        setShowDFMInsightsUpgrade(true);
        return null;
      }
      addToast('error', lt.aiAnalysisFailed(e.message));
      return null;
    }
  }, [checkFreemium, setShowDFMInsightsUpgrade, materialId, params, lang, addToast]);

  const handlePreviewDFMCostDelta = useCallback((hint: { key: string; delta: number }): CostDelta | null => {
    if (!geometryMetrics || !materialId) return null;
    const nextMetrics = approximateMetricsAfterHint(geometryMetrics, params, hint);
    return calculateCostDelta(geometryMetrics, nextMetrics, materialId, 1, {});
  }, [geometryMetrics, materialId, params]);

  const handleDraftAnalyze = useCallback((
    pullDirection: [number, number, number],
    minDraftDeg: number,
  ) => {
    const geo = effectiveResult?.geometry;
    if (!geo) {
      addToast('warning', lt.noGeometryToAnalyze);
      return;
    }
    try {
      const result = analyzeDraft(geo, { pullDirection, minDraftDeg });
      setDraftResult(result);
      setDraftMinDeg(minDraftDeg);
      if (result.counts.undercut > 0) {
        addToast('warning', lt.undercutsDetected(result.counts.undercut.toLocaleString()));
      } else if (result.counts.vertical > 0) {
        addToast('info', lt.facesNeedDraft(result.counts.vertical.toLocaleString()));
      } else {
        addToast('success', lt.allFacesModable);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', lt.draftFailed(msg));
    }
  }, [effectiveResult, setDraftResult, setDraftMinDeg, addToast, lang]);

  /**
   * Map a DFM issue type to a likely feature in the current feature stack and
   * select it so the FeatureTree + TimelineBar highlight it. Walks the most
   * recent features first so the user lands on the most relevant one.
   */
  const handleJumpToDFMFeature = useCallback((issueType: string) => {
    const ISSUE_TO_FEATURE_TYPES: Record<string, string[]> = {
      thin_wall:    ['shell'],
      uniform_wall: ['shell'],
      draft_angle:  ['draft'],
      sharp_corner: ['fillet', 'chamfer'],
      deep_pocket:  ['extrude', 'cut', 'pocket'],
      aspect_ratio: ['extrude', 'revolve'],
      undercut:     ['extrude', 'cut', 'sweep'],
      tool_access:  ['fillet', 'chamfer', 'extrude'] };
    const candidates = ISSUE_TO_FEATURE_TYPES[issueType] ?? [];
    if (candidates.length === 0 || features.length === 0) {
      addToast('info', lt.noRelatedFeature);
      return;
    }
    // Most recent feature first
    const found = [...features].reverse().find(f => candidates.includes(f.type as string));
    if (found) {
      setSelectedFeatureId(found.id);
      startEditing(found.id);
      addToast('info', lt.jumpToFeature(found.type));
    } else {
      addToast('info', lt.noFeatureInTree(candidates.join(', ')));
    }
  }, [features, setSelectedFeatureId, startEditing, addToast, lang]);

  const handleFEARunAnalysis = useCallback(async (material: FEAMaterial) => {
    if (!getPlanLimits(useAuthStore.getState().user?.plan).feaAnalysis) {
      promptUpgrade(lt.feaUpgradeFeature); return;
    }
    const geo = effectiveResult?.geometry;
    if (!geo || feaConditions.length === 0) return;
    try {
      const result = await runFEAWorker(geo, material, feaConditions);
      setFeaResult(result);
      addToast('info', lt.feaAnalysisComplete);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast('error', lt.feaFailed(msg));
    }
  }, [effectiveResult, feaConditions, runFEAWorker, addToast, lang, promptUpgrade]);

  const feaTotalFaces = useMemo(() => {
    const geo = effectiveResult?.geometry;
    if (!geo) return 0;
    const nonIndexed = geo.index ? geo.toNonIndexed() : geo;
    return Math.floor((nonIndexed.attributes.position?.count ?? 0) / 3);
  }, [effectiveResult]);

  // ── Mass Properties computation ──
  const massProperties = useMemo(() => {
    if (!showMassProps || !effectiveResult) return null;
    const mat = MATERIAL_PRESETS.find(m => m.id === materialId);
    const density = mat?.density ?? 2.7;
    return computeMassProperties(effectiveResult.geometry, density);
  }, [showMassProps, effectiveResult, materialId]);

  // Lightweight always-on status-bar readout (bbox size + volume + mass) —
  // cheap enough to show without opening the Mass Properties panel.
  const statusBarStats = useMemo(() => {
    const g = effectiveResult?.geometry;
    if (!g) return null;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) return null;
    const mat = MATERIAL_PRESETS.find(m => m.id === materialId);
    const density = mat?.density ?? 2.7;
    const vol = typeof effectiveResult?.volume_cm3 === 'number' ? effectiveResult.volume_cm3 : null;
    return {
      sx: bb.max.x - bb.min.x,
      sy: bb.max.y - bb.min.y,
      sz: bb.max.z - bb.min.z,
      volumeCm3: vol,
      massG: vol != null ? vol * density : null,
    };
  }, [effectiveResult, materialId]);

  // F2 — assembly-level CG. When the user has 2+ placed parts and the Mass
  // Properties panel is open, fold each part's mass into a combined assembly
  // CG (parallel-axis weighted). This is the marker the user actually wants
  // for balance checks on robots/drones; the single-body CG above is for
  // detail work on one part.
  const assemblyCenterOfMass = useMemo<[number, number, number] | null>(() => {
    if (!showMassProps || bomParts.length < 2) return null;
    const inputs = bomParts.map(bp => {
      const mat = MATERIAL_PRESETS.find(m => m.id === materialId);
      const density = mat?.density ?? 2.7;
      return {
        name: bp.name,
        geometry: bp.result.geometry,
        density_g_cm3: density,
        position: bp.position ?? ([0, 0, 0] as [number, number, number]),
      };
    });
    try {
      const combined = combineAssemblyMassProperties(inputs);
      if (combined.mass_g <= 0) return null;
      return combined.centerOfMass;
    } catch {
      return null;
    }
  }, [showMassProps, bomParts, materialId]);

  // ══════════════════════════════════════════════════════════════════════════
  // ASSEMBLY HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  // Phase A undo unification: mate add/remove/update flow through
  // commandHistory (mirrors the mate→placement command below). assemblyMates
  // is a Yjs id-keyed map sorted by id on read, so undo only needs to
  // re-add/remove the affected ITEM — no order restoration required.
  const handleAddMate = useCallback((mate: AssemblyMate) => {
    commandHistory.execute(makeArrayAddCommand({
      commandId: `mate-add-${mate.id}`,
      label: 'Add mate',
      labelKo: '메이트 추가',
      items: [mate],
      set: setAssemblyMates,
    }));
  }, [setAssemblyMates]);

  const handleRemoveMate = useCallback((id: string) => {
    const removed = assemblyMates.find(m => m.id === id);
    if (!removed) return;
    commandHistory.execute(makeArrayRemoveCommand({
      commandId: `mate-remove-${id}-${Date.now()}`,
      label: 'Remove mate',
      labelKo: '메이트 제거',
      item: removed,
      set: setAssemblyMates,
    }));
  }, [assemblyMates, setAssemblyMates]);

  const handleUpdateMate = useCallback((id: string, updates: Partial<AssemblyMate>) => {
    const before = assemblyMates.find(m => m.id === id);
    if (!before) return;
    commandHistory.execute(makeArrayUpdateCommand({
      commandId: `mate-update-${id}-${Date.now()}`,
      label: 'Edit mate',
      labelKo: '메이트 수정',
      before,
      updates,
      set: setAssemblyMates,
    }));
  }, [assemblyMates, setAssemblyMates]);

  // Phase A undo unification: PartPlacementPanel (add/duplicate/remove/move
  // placed parts) mutates through this tracked setter. Whole-array before/
  // after snapshots are used deliberately — the panel hands us a full new
  // array and placedParts stays small, so item-level diffing isn't worth the
  // complexity here.
  const setPlacedPartsTracked = useCallback((action: PlacedPart[] | ((prev: PlacedPart[]) => PlacedPart[])) => {
    const before = placedParts;
    const after = typeof action === 'function' ? action(before) : action;
    commandHistory.execute({
      id: `placed-parts-edit-${Date.now()}`,
      label: 'Edit placed parts',
      labelKo: '배치 파트 편집',
      execute: () => { setPlacedParts(after); },
      undo: () => { setPlacedParts(before); },
    });
  }, [placedParts, setPlacedParts]);

  // Shell-v2 assembly sidebar → mate edit bridge. The AssemblyLeftPane/
  // AssemblyRightPane mate rows dispatch these so the user can delete / lock a
  // mate inline (the full editor stays available via the ribbon mate tools).
  // (2026-06-09 P1)
  useEffect(() => {
    const onRemove = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) handleRemoveMate(id);
    };
    const onToggle = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      // Self-inverse lock flip — tracked so Ctrl+Z reverses the toggle.
      commandHistory.execute(makeToggleCommand({
        commandId: `mate-lock-${id}-${Date.now()}`,
        label: 'Toggle mate lock',
        labelKo: '메이트 잠금 전환',
        toggle: () => setAssemblyMates(prev => prev.map(m => m.id === id ? { ...m, locked: !m.locked } : m)),
      }));
    };
    window.addEventListener('nexyfab:assembly-mate-remove', onRemove);
    window.addEventListener('nexyfab:assembly-mate-toggle', onToggle);
    return () => {
      window.removeEventListener('nexyfab:assembly-mate-remove', onRemove);
      window.removeEventListener('nexyfab:assembly-mate-toggle', onToggle);
    };
  }, [handleRemoveMate, setAssemblyMates]);

  // Shell title-bar "exit assembly mode" chip → close the assembly panel. The
  // chip dispatches this (mirroring sketch.finish → setIsSketchMode(false));
  // without this listener the button was a silent no-op (editMode='assembly'
  // ⟺ showAssemblyPanel, so closing the panel pops the mode back to modeling).
  useEffect(() => {
    const onAssemblyClose = () => setShowAssemblyPanel(false);
    window.addEventListener('nexyfab:assembly-close', onAssemblyClose);
    return () => window.removeEventListener('nexyfab:assembly-close', onAssemblyClose);
  }, [setShowAssemblyPanel]);

  const handleApplyMatesToPlacement = useCallback(() => {
    if (placedParts.length < 2 || assemblyMates.length === 0) return;
    const mateRows = assemblyMates.map(m => ({ id: m.id, partA: m.partA, partB: m.partB, type: m.type }));
    const pf = preflightAssemblyMates(mateRows);
    if (!pf.ok) {
      addToast('error', pf.issues.join(' · '));
      return;
    }
    const graph = mateGraphSummary(mateRows);
    for (const w of graph.warnings) addToast('warning', w);

    const confirmMsg =
      lang === 'ko'
        ? '메이트 제약을 파트 배치(위치·회전)에 적용합니다. 계속할까요?'
        : 'Apply mate constraints to part placement (position & rotation). Continue?';
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return;
    try {
      const before = JSON.parse(JSON.stringify(placedParts)) as PlacedPart[];
      const after = applyGeometryMatesToPlaced(placedParts, assemblyMates);
      // Phase B1: nonce inside execute/undo/redo so Solver tab (`solveAssembly` BOM sync) matches
      // `solveMates` placement after undo — not only after the initial apply.
      commandHistory.execute({
        id: `mates-to-placement-${Date.now()}`,
        label: 'Apply mates to placement',
        labelKo: '메이트 → 배치 적용',
        execute: () => {
          setPlacedParts(after);
          setAssemblySolverResyncNonce(n => n + 1);
        },
        undo: () => {
          setPlacedParts(before);
          setAssemblySolverResyncNonce(n => n + 1);
        },
      });
      addToast(
        'success',
        lang === 'ko'
          ? '메이트가 파트 배치에 적용되었습니다. (명령 히스토리에서 실행 취소 가능)'
          : 'Mates applied to placement. (Undo via command history / toolbar)',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addToast('error', lang === 'ko' ? `적용 실패: ${msg}` : `Apply failed: ${msg}`);
    }
  }, [placedParts, assemblyMates, setPlacedParts, setAssemblySolverResyncNonce, addToast, lang]);

  const handleDetectInterference = useCallback(async () => {
    // M3-P2 / 품질: Prefer `placedParts`→`placedPartsToBomResults` (snapshot parity). Else
    // multi-body `bodyBomParts` (world origin per mesh). Else cart/chat `bomParts`.
    const bomForCheck =
      placedParts.length >= 2
        ? placedPartsToBomResults(placedParts)
        : bodyBomParts && bodyBomParts.length >= 2
          ? bodyBomParts
          : bomParts;
    if (!bomForCheck || bomForCheck.length < 2) return;
    const loadGuide = getAssemblyLoadGuidance(bomForCheck.length);
    if (loadGuide.suggestInterferencePreambleToast && !getSuppressCadPerfToasts()) {
      try {
        const k = 'nf_interference_heavy_run_hint_v1';
        if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(k)) {
          sessionStorage.setItem(k, '1');
          addToast('info', lt.interferenceRunHeavyHint);
        }
      } catch { /* private mode */ }
    }
    const { assemblyPairwiseComparisonCount: pairwiseN, INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT } = await import('@/lib/assemblyLoadPolicy');
    const pairWorst = pairwiseN(bomForCheck.length);
    if (pairWorst > 50) {
      const { cadPerfLog } = await import('@/lib/cadPerfLog');
      cadPerfLog('interference.large', 0, {
        parts: bomForCheck.length,
        pairWorst,
        broadPhaseMinN: INTERFERENCE_SPATIAL_GRID_MIN_PART_COUNT,
      });
    }
    const partsInput = bomForCheck.map((p, i) => ({
      id: p.name || `part_${i}`,
      geometry: p.result.geometry,
      transform: bomPartWorldMatrixFromBom(p),
    }));
    setInterferenceLoading(true);
    const perfStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      const results = await detectInterferenceWorker(partsInput);
      const { cadPerfLog } = await import('@/lib/cadPerfLog');
      const elapsed =
        typeof performance !== 'undefined' ? performance.now() - perfStart : Date.now() - perfStart;
      cadPerfLog('interference', elapsed, { parts: partsInput.length, hits: results.length });
      setInterferenceResults(results);
      if (results.length === 0) {
        addToast('success', lt.noInterference);
      } else {
        addToast('error', lt.interferenceFound(results.length));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        addToast('info', lt.interferenceCancelled);
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'Interference check cancelled') {
        addToast('info', lt.interferenceCancelled);
        return;
      }
      addToast('error', lt.interferenceFailed(msg));
    } finally {
      setInterferenceLoading(false);
    }
  }, [
    bomParts,
    bodyBomParts,
    placedParts,
    detectInterferenceWorker,
    cancelInterferenceWorker,
    setInterferenceLoading,
    setInterferenceResults,
    addToast,
    lang,
    lt,
  ]);

  const assemblyPartNames = useMemo(() => {
    if (placedParts.length >= 2) return placedParts.map((p, i) => p.name || `part_${i}`);
    if (bodyBomParts && bodyBomParts.length >= 2) return bodyBomParts.map((p, i) => p.name || `part_${i}`);
    return bomParts.map((p, i) => p.name || `part_${i}`);
  }, [placedParts, bodyBomParts, bomParts]);

  /** 간섭 파이프와 동일한 소스 우선순위로 파트 수를 맞춤(뷰포트 BOM과 다를 수 있음). */
  const interferenceCheckPartCount = useMemo(() => {
    if (placedParts.length >= 2) return placedParts.length;
    if (bodyBomParts && bodyBomParts.length >= 2) return bodyBomParts.length;
    if (bomParts.length >= 2) return bomParts.length;
    return 0;
  }, [placedParts.length, bodyBomParts?.length, bomParts.length]);

  // ══════════════════════════════════════════════════════════════════════════
  // STANDARD PARTS HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleStandardParts = useCallback(() => {
    useUIStore.getState().togglePanel('showLibrary');
  }, []);

  const handleSelectStandardPart = useCallback(async (partId: string) => {
    const { STANDARD_PARTS_MAP } = await import('./library/standardParts');
    const part = STANDARD_PARTS_MAP[partId];
    if (!part) return;
    setSelectedStandardPart(partId);
    const p: Record<string, number> = {};
    part.params.forEach(sp => { p[sp.key] = sp.default; });
    setStandardPartParams(p);
    // Generate and show
    const result = part.generate(p);
    setSketchResult(result);
    setBomParts([]); setBomLabel('');
    setIsSketchMode(false);
    addToast('info', `Loaded standard part: ${partId}`);
  }, [addToast]);

  const _handleStandardPartParamChange = useCallback(async (key: string, value: number) => {
    const newParams = { ...standardPartParams, [key]: value };
    setStandardPartParams(newParams);
    if (!selectedStandardPart) return;
    const { STANDARD_PARTS_MAP } = await import('./library/standardParts');
    const part = STANDARD_PARTS_MAP[selectedStandardPart];
    if (!part) return;
    const result = part.generate(newParams);
    setSketchResult(result);
  }, [standardPartParams, selectedStandardPart]);

  // ══════════════════════════════════════════════════════════════════════════
  // SHEET METAL HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleSheetMetal = useCallback(async (op: string) => {
    const sm = await import('./sheetmetal/sheetMetal');
    if (op === 'box') {
      const result = sm.createSheetMetalBox(100, 50, 80, { thickness: 2, bendRadius: 3, kFactor: 0.44 });
      setSketchResult(result);
      setBomParts([]); setBomLabel('');
      setIsSketchMode(false);
      addToast('success', 'Sheet metal box created');
    } else if (op === 'unfold' && effectiveResult) {
      const flat = sm.unfold(effectiveResult.geometry, { thickness: 2, bendRadius: 3, kFactor: 0.44 });
      const edgeGeometry = makeEdges(flat.geometry);
      const volume_cm3 = meshVolume(flat.geometry) / 1000;
      const surface_area_cm2 = meshSurfaceArea(flat.geometry) / 100;
      flat.geometry.computeBoundingBox();
      const bb = flat.geometry.boundingBox;
      if (!bb) return;
      const size = bb.getSize(new Vector3());
      const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
      setSketchResult({ geometry: flat.geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
      addToast('success', 'Sheet metal unfolded');
    } else if (op === 'bend' || op === 'flange' || op === 'hem') {
      setShowSheetMetalPanel(true);
    }
  }, [effectiveResult, addToast]);

  const handleSmBend = useCallback(async (angle: number, radius: number, position: number, direction: 'up' | 'down') => {
    if (!effectiveResult) { addToast('error', lt.createShapeFirst); return; }
    const { applyBend } = await import('./features/sheetMetal');
    const geo = applyBend(effectiveResult.geometry, { angle, radius, position, direction });
    const edgeGeometry = makeEdges(geo);
    geo.computeBoundingBox();
    const smBendBb = geo.boundingBox;
    if (!smBendBb) return;
    const s = smBendBb.getSize(new Vector3());
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3: meshVolume(geo) / 1000, surface_area_cm2: meshSurfaceArea(geo) / 100, bbox: { w: Math.round(s.x), h: Math.round(s.y), d: Math.round(s.z) } });
    addToast('success', lt.bendApplied);
  }, [effectiveResult, addToast, lang]);

  const handleSmFlange = useCallback(async (height: number, angle: number, radius: number, edgeIndex: number) => {
    if (!effectiveResult) { addToast('error', lt.createShapeFirst); return; }
    const { applyFlange } = await import('./features/sheetMetal');
    const geo = applyFlange(effectiveResult.geometry, { height, angle, radius, edgeIndex });
    const edgeGeometry = makeEdges(geo);
    geo.computeBoundingBox();
    const smFlangeBb = geo.boundingBox;
    if (!smFlangeBb) return;
    const s = smFlangeBb.getSize(new Vector3());
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3: meshVolume(geo) / 1000, surface_area_cm2: meshSurfaceArea(geo) / 100, bbox: { w: Math.round(s.x), h: Math.round(s.y), d: Math.round(s.z) } });
    addToast('success', lt.flangeApplied);
  }, [effectiveResult, addToast, lang]);

  const handleSmFlatPattern = useCallback(async (thickness: number, kFactor: number) => {
    if (!effectiveResult) { addToast('error', lt.createShapeFirst); return; }
    const { generateFlatPattern } = await import('./features/sheetMetal');
    // Legacy callers pass a raw K-factor; the new API accepts either a material
    // id or a K-factor number. Forward the K-factor unchanged.
    const pattern = generateFlatPattern(effectiveResult.geometry, [], thickness, kFactor);
    const geo = pattern.geometry;
    const edgeGeometry = makeEdges(geo);
    geo.computeBoundingBox();
    const smFlatBb = geo.boundingBox;
    if (!smFlatBb) return;
    const s = smFlatBb.getSize(new Vector3());
    setSketchResult({ geometry: geo, edgeGeometry, volume_cm3: meshVolume(geo) / 1000, surface_area_cm2: meshSurfaceArea(geo) / 100, bbox: { w: Math.round(s.x), h: Math.round(s.y), d: Math.round(s.z) } });
    if (pattern.warnings.length > 0) {
      for (const w of pattern.warnings) {
        addToast(w.severity, lang === 'ko' ? w.messageKo : w.messageEn);
      }
    }
    addToast('success', lt.flatPatternGenerated);
  }, [effectiveResult, addToast, lang]);

  // ══════════════════════════════════════════════════════════════════════════
  // FEATURE EXTRACTION HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const handleExtraction = useCallback(async (type: string) => {
    const geo = effectiveResult?.geometry;
    if (!geo) return;
    const ext = await import('./extraction/featureExtraction');
    if (type === 'primitives') {
      const primitives = ext.detectPrimitives(geo);
      // Show first detected primitive
      if (primitives.length > 0) {
        const first = primitives[0];
        first.geometry.computeBoundingBox();
        const bb = first.geometry.boundingBox;
        if (!bb) return;
        const size = bb.getSize(new Vector3());
        const bbox = { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) };
        // Show as BOM parts
        const bomResults = primitives.map((p) => ({
          name: `${p.type} (${(p.confidence * 100).toFixed(0)}%)`,
          result: { geometry: p.geometry, edgeGeometry: makeEdges(p.geometry), volume_cm3: meshVolume(p.geometry) / 1000, surface_area_cm2: meshSurfaceArea(p.geometry) / 100, bbox } }));
        setBomParts(bomResults);
        setBomLabel('Detected Primitives');
      }
    } else if (type === 'extrusions') {
      ext.detectExtrusions(geo);
    } else if (type === 'autoSurface') {
      ext.autoSurface(geo);
    } else if (type === 'crossSection') {
      const plane = new Plane(new Vector3(0, 1, 0), 0);
      ext.computeCrossSection(geo, plane);
    }
  }, [effectiveResult]);

  // handleExportCurrentSTL is provided by useImportExport hook

  // ══════════════════════════════════════════════════════════════════════════
  // COMPUTED VALUES (must be before any early return to keep hooks stable)
  // ══════════════════════════════════════════════════════════════════════════

  const tier1 = useMemo(() => SHAPES.filter(s => s.tier === 1), []);
  const tier2 = useMemo(() => SHAPES.filter(s => s.tier === 2), []);

  const statusGuide = useMemo(() => {
    if (activeTab === 'optimize') {
      if (isOptimizing) return { icon: '⏳', text: `Iteration ${progress?.iteration ?? 0}/${progress?.maxIteration ?? '—'}...`, color: 'var(--nx-accent-2)' };
      if (optResult) return { icon: '✅', text: 'Optimization complete. Export STL or send to quote.', color: '#16a34a' };
      if (!effectiveResult) return { icon: '🧊', text: lt.goDesignTabFirst, color: 'var(--nx-warn)' };
      if (fixedFaces.length === 0) return { icon: '📌', text: 'Click a face in the viewer to set fixed boundary.', color: 'var(--nx-warn)' };
      if (loads.length === 0) return { icon: '⬇', text: 'Now add a load: select Load mode and click a face.', color: 'var(--nx-warn)' };
      return { icon: '▶', text: 'Ready. Click Generate in toolbar to start optimization.', color: 'var(--nx-accent)' };
    }
    if (activeTab === 'design' && measureActive) return { icon: '📏', text: lt.measureToolActive, color: '#f97316' };
    if (isSketchMode && !sketchResult) return { icon: '✏️', text: 'Draw a closed profile. Click first point to close.', color: 'var(--nx-accent)' };
    if (editMode === 'vertex') return { icon: '⬡', text: lt.vertexEditPointerHint, color: 'var(--nx-ok)' };
    if (editMode === 'edge') return { icon: '╱', text: `${lt.edgeEditHint} — ${lt.edgeEditPointerHint}`, color: 'var(--nx-ok)' };
    if (editMode === 'face') return { icon: '▣', text: lt.faceEditHint, color: 'var(--nx-ok)' };
    if (activeTab === 'design' && selectedFeatureId) {
      const feat = features.find(f => f.id === selectedFeatureId);
      if (feat) return { icon: '🎯', text: `${lt.featureSelectedPrefix} ${feat.type}`, color: 'var(--nx-accent-2)' };
    }
    if (!effectiveResult) return { icon: '🧊', text: 'Select a shape or use AI Chat to begin.', color: 'var(--nx-text-3)' };
    if (
      activeTab === 'design'
      && effectiveResult
      && !isSketchMode
      && editMode === 'none'
      && !measureActive
      && transformMode === 'off'
    ) {
      return { icon: '💡', text: lt.designEditQuickGuide, color: 'var(--nx-accent-2)' };
    }
    return { icon: '📐', text: `${shapeLabels[`shapeName_${selectedId}`] || selectedId} — ${effectiveResult.bbox.w.toFixed(0)}×${effectiveResult.bbox.h.toFixed(0)}×${effectiveResult.bbox.d.toFixed(0)} mm`, color: 'var(--nx-accent-2)' };
  }, [activeTab, isOptimizing, optResult, fixedFaces, loads, progress, isSketchMode, sketchResult, editMode, effectiveResult, selectedId, t, lang, measureActive, selectedFeatureId, features, lt, transformMode]);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — GALLERY VIEW (early return AFTER all hooks)
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // DRAG & DROP FILE IMPORT
  // ══════════════════════════════════════════════════════════════════════════
  const SUPPORTED_EXTS = ['step', 'stp', 'iges', 'igs', 'brep', 'stl', 'obj', 'ply', 'dxf'];
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true);
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragOver(false);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);
  // ── Drag and Drop Standard Parts ──
  const handleStandardPartDrop = useCallback((evt: {
    partId: string;
    position: Vector3;
    normal: Vector3;
    intersectedPartName?: string;
    placement?: { transform: Matrix4 };
  }) => {
    
    // We need to fetch the STANDARD_PARTS_MAP here dynamically or pass it.
    import('./library/standardParts').then(({ STANDARD_PARTS_MAP }) => {
      const part = STANDARD_PARTS_MAP[evt.partId];
      if (!part) return;

      const params: Record<string, number> = {};
      part.params.forEach(sp => { params[sp.key] = sp.default; });

      let pos = [evt.position.x, evt.position.y, evt.position.z] as [number, number, number];
      let rot = [0, 0, 0] as [number, number, number];

      if (evt.placement && evt.placement.transform) {
        const position = new Vector3();
        const quaternion = new Quaternion();
        const scale = new Vector3();
        evt.placement.transform.decompose(position, quaternion, scale);
        const euler = new Euler().setFromQuaternion(quaternion, 'XYZ');
        pos = [position.x, position.y, position.z];
        rot = [MathUtils.radToDeg(euler.x), MathUtils.radToDeg(euler.y), MathUtils.radToDeg(euler.z)];
      }

      const newPlacedPartId = `placed_${Date.now()}`;
      const newPlacedPart = {
        id: newPlacedPartId,
        name: part.id,
        shapeId: `std:${part.id}`,
        params,
        qty: 1,
        position: pos,
        rotation: rot,
      };

      // Smart mates (Coincident + Concentric) when dropped onto another part.
      const newMates = evt.intersectedPartName
        ? [
            {
              id: `mate_coincident_${Date.now()}`,
              type: 'coincident' as const,
              partA: evt.intersectedPartName,
              partB: newPlacedPartId, // partB is the standard part
              locked: false,
            },
            {
              id: `mate_concentric_${Date.now() + 1}`,
              type: 'concentric' as const,
              partA: evt.intersectedPartName,
              partB: newPlacedPartId,
              locked: false,
            },
          ]
        : [];

      // Phase A undo unification: part placement + auto-mates is ONE undo step.
      commandHistory.execute(makePlacePartWithMatesCommand({
        commandId: `place-standard-part-${newPlacedPartId}`,
        label: 'Place standard part',
        labelKo: '규격 부품 배치',
        part: newPlacedPart,
        setParts: setPlacedParts,
        mates: newMates,
        setMates: setAssemblyMates,
      }));

      if (newMates.length > 0) {
        addToast('success', lang === 'ko' ? `규격 부품 배치 및 자동 메이트 체결 완료` : `Standard part placed with smart mates`);
      } else {
        addToast('success', lang === 'ko' ? `규격 부품 배치 완료` : `Standard part placed`);
      }
    });
  }, [setPlacedParts, setAssemblyMates, addToast, lang]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!SUPPORTED_EXTS.includes(ext)) {
      addToast('error', `Unsupported format: .${ext}`);
      return;
    }
    setIsImporting(true);
    try {
      const { importFile } = await import('./io/importers');
      const { geometry, filename } = await importFile(file);
      const edgeGeo = makeEdges(geometry);
      const vol = meshVolume(geometry) / 1000;
      const sa = meshSurfaceArea(geometry) / 100;
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox!;
      const sz = bb.getSize(new Vector3());
      setImportedGeometry(geometry);
      setImportedFilename(filename);
      setSketchResult({ geometry, edgeGeometry: edgeGeo, volume_cm3: vol, surface_area_cm2: sa, bbox: { w: Math.round(sz.x), h: Math.round(sz.y), d: Math.round(sz.z) } });
      setIsSketchMode(false);
      setViewMode('workspace');
      // Save to recent files
      upsertRecentImportFile({ name: filename, ext, size: file.size, date: Date.now() });
      addToast('success', `"${filename}" loaded`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      // #9: provide retry action — re-trigger the browser file picker
      addToast(
        'error',
        lt.importFailed(errMsg),
        8000,
        {
          label: lt.retryLabel,
          onClick: () => handleImportFile() },
      );
    } finally {
      setIsImporting(false);
    }
  }, [addToast, setImportedGeometry, setImportedFilename, setSketchResult, setIsSketchMode, setViewMode, lang, handleImportFile]);

  // MERGE BOM PARTS for Preview (must run before any early return — hooks order)
  const effectiveBomParts = useMemo(() => {
    let combined: typeof bomParts = [];
    if (bodyBomParts && bodyBomParts.length > 0) combined = [...bodyBomParts];
    else if (bomParts && bomParts.length > 0) combined = [...bomParts];

    // `bomParts` is already `placedPartsToBomResults(placedParts)` when assembly-only — do not append again.
    if (placedParts && placedParts.length > 0 && bodyBomParts && bodyBomParts.length > 0) {
      combined = [...combined, ...placedPartsToBomResults(placedParts)];
    }
    return combined.length > 0 ? combined : undefined;
  }, [bodyBomParts, bomParts, placedParts]);

  // MW step 5.1-5.4 — callback clusters extracted to hooks/ so the future
  // MainWorkspace component reads them directly without prop-drilling.
  // All hook calls MUST live above the mobile-gate early return so React
  // hook order stays stable across remounts.
  const {
    onElementSelect: canvasOnElementSelect,
    highlightTriangles: canvasHighlightTriangles,
    commitPendingMate: canvasCommitPendingMate,
    cancelPendingMate: canvasCancelPendingMate,
  } = useCanvasSelectionHandlers({
      generateMateId,
      setSelectionActive,
      labels: {
        mateCoincident: lt.mateCoincident,
        mateConcentric: lt.mateConcentric,
        mateDistance: lt.mateDistance,
        // mateParallel is a Phase F addition — fallback string preserves
        // the build if a lang dict is mid-migration.
        mateParallel: (lt as { mateParallel?: string }).mateParallel ?? 'Parallel',
      },
      onMateCreated: (mate, partA, partB, mateLabel) => {
        // Phase A undo unification: face-pick mate creation is tracked.
        commandHistory.execute(makeArrayAddCommand({
          commandId: `mate-add-${mate.id}`,
          label: 'Add mate',
          labelKo: '메이트 추가',
          items: [mate],
          set: setAssemblyMates,
        }));
        setShowAssemblyPanel(true);
        addToast('success', lt.mateAdded?.(mateLabel, partA, partB) ?? `Added Mate between ${partA} and ${partB}`);
      },
      onUnpairedFace: () => addToast('error', 'Select faces on different parts to create a mate.'),
      onParallelHint: () => addToast('info', lt.mateParallelHint ?? 'Faces are parallel (same direction) — you may need to flip one part.'),
    });

  const { onFileImport: canvasOnFileImport } = useCanvasFileImport({
    setImportedGeometry,
    setSketchResult,
    setBomParts,
    setBomLabel,
    setIsSketchMode,
    addToast,
    labels: { importedFile: lt.importedFile, importFailedFile: lt.importFailedFile },
  });

  const { onRadialCommand: canvasOnRadialCommand } = useRadialCommand({
    isSketchMode,
    setIsSketchMode,
    setSketchResult,
    setEditMode,
    setSketchTool,
    handleSketchGenerate,
  });

  const { nurbsCPEdit: canvasNurbsCPEdit, nurbsCPParams: canvasNurbsCPParams, onNurbsCPParamChange: canvasOnNurbsCPParamChange } =
    useNurbsCpEdit({ selectedFeatureId, features, updateFeatureParam: updateFeatureParamCmd });

  const canvasPinComments = useCanvasPinCommentHandlers({
    authUserName: authUser?.name,
    collabUserColorRef,
    collabUserIdRef,
    addComment,
    resolveComment,
    deleteComment,
    reactToComment,
    addReply,
    addActivity,
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — MOBILE GATE (phone users → dedicated landing)
  // ══════════════════════════════════════════════════════════════════════════

  if (isMobile) {
    // Read-only mobile 3D viewer: editing is desktop-only, but a phone user who
    // opened a (shared) design can still rotate/zoom it with touch instead of
    // hitting a pure "use a desktop" wall. Falls back to the wall when there's
    // no model to show.
    const mobileGeo = effectiveResult?.geometry;
    const hasViewableModel = hasViewableGeometry(mobileGeo);
    const vl = mobileViewerLabels(lang);

    if (hasViewableModel && mobileGeo) {
      return (
        <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#0d1117', color: 'var(--nx-text)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--nx-panel)', borderBottom: '1px solid var(--nx-border)', flexShrink: 0 }}>
            <span style={{ fontSize: 17, fontWeight: 800 }}><span style={{ color: 'var(--nx-accent-2)' }}>Nexy</span>Fab</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 8, background: 'rgba(59,130,246,0.18)', color: 'var(--nx-accent-2)' }}>{vl.badge}</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <MobileModelViewer geometry={mobileGeo} />
            <div style={{ position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.55)', pointerEvents: 'none' }}>
              {vl.gesture}
            </div>
          </div>
          <div style={{ padding: '12px 16px calc(16px + env(safe-area-inset-bottom))', background: 'var(--nx-panel)', borderTop: '1px solid var(--nx-border)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--nx-text-2)', textAlign: 'center', fontWeight: 600 }}>✏️ {vl.edit}</div>
            <MobileSendToDesktop
              labels={{
                title: lt.mobileSendToDesktopTitle,
                body: lt.mobileSendToDesktopBody,
                qrAlt: lt.mobileQrAlt,
                copyUrl: lt.mobileCopyUrl,
                copyUrlDone: lt.mobileCopyUrlDone,
                emailSelf: lt.mobileEmailSelf,
                emailSubject: lt.mobileEmailSubject,
                emailBody: lt.mobileEmailBody,
              }}
            />
          </div>
        </div>
      );
    }
    return (
      <div style={{
        minHeight: '100dvh', background: 'var(--nx-bg)', color: 'var(--nx-text)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '32px 20px 40px' }}>
        {/* Logo */}
        <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 32, alignSelf: 'flex-start' }}>
          <span style={{ color: 'var(--nx-accent-2)' }}>Nexy</span>Fab
        </div>

        {/* Hero icon */}
        <div style={{ fontSize: 64, marginBottom: 20 }}>🖥️</div>

        {/* Title */}
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 12px', textAlign: 'center', lineHeight: 1.3 }}>
          {lt.designOn3dPc}
        </h1>
        <p style={{ fontSize: 14, color: 'var(--nx-text-2)', textAlign: 'center', lineHeight: 1.7, margin: '0 0 32px', maxWidth: 280 }}>
          {lt.mobileHint}
        </p>

        {/* Item 1 of usability action plan — give mobile users a path to
            get the in-flight page URL onto a desktop (QR / copy / email). */}
        <MobileSendToDesktop
          labels={{
            title: lt.mobileSendToDesktopTitle,
            body: lt.mobileSendToDesktopBody,
            qrAlt: lt.mobileQrAlt,
            copyUrl: lt.mobileCopyUrl,
            copyUrlDone: lt.mobileCopyUrlDone,
            emailSelf: lt.mobileEmailSelf,
            emailSubject: lt.mobileEmailSubject,
            emailBody: lt.mobileEmailBody,
          }}
        />

        <div
          role="region"
          aria-label={lt.mobileShareViewTitle}
          style={{
            width: '100%', maxWidth: 320, marginBottom: 24, padding: '14px 16px',
            background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nx-accent-2)', marginBottom: 8 }}>
            {lt.mobileShareViewTitle}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--nx-text-2)', lineHeight: 1.65 }}>
            {lt.mobileShareViewBody}
          </p>
        </div>

        {/* Mobile-friendly actions */}
        <div style={{ width: '100%', maxWidth: 320, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <a href={`/${lang}/nexyfab`} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 12,
            padding: '16px 18px', textDecoration: 'none', color: 'var(--nx-text)' }}>
            <span style={{ fontSize: 24 }}>📊</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{lt.dashboard}</div>
              <div style={{ fontSize: 12, color: 'var(--nx-text-2)', marginTop: 2 }}>{lt.checkProjects}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: 'var(--nx-border-strong)' }}>›</span>
          </a>

          <a href={`/${lang}/nexyfab/marketplace`} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 12,
            padding: '16px 18px', textDecoration: 'none', color: 'var(--nx-text)' }}>
            <span style={{ fontSize: 24 }}>🏭</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{lt.marketplace}</div>
              <div style={{ fontSize: 12, color: 'var(--nx-text-2)', marginTop: 2 }}>{lt.browseMfrs}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: 'var(--nx-border-strong)' }}>›</span>
          </a>

          <a href={`/${lang}/nexyfab/orders`} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 12,
            padding: '16px 18px', textDecoration: 'none', color: 'var(--nx-text)' }}>
            <span style={{ fontSize: 24 }}>📦</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{lt.orderTracking}</div>
              <div style={{ fontSize: 12, color: 'var(--nx-text-2)', marginTop: 2 }}>{lt.trackMfgProgress}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: 'var(--nx-border-strong)' }}>›</span>
          </a>

          <a href={`/${lang}/nexyfab/rfq`} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 12,
            padding: '16px 18px', textDecoration: 'none', color: 'var(--nx-text)' }}>
            <span style={{ fontSize: 24 }}>📋</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{lt.rfqQuotes}</div>
              <div style={{ fontSize: 12, color: 'var(--nx-text-2)', marginTop: 2 }}>{lt.manageQuotes}</div>
            </div>
            <span style={{ marginLeft: 'auto', color: 'var(--nx-border-strong)' }}>›</span>
          </a>
        </div>

        {/* Desktop hint */}
        <p style={{ fontSize: 12, color: 'var(--nx-border-strong)', textAlign: 'center', marginTop: 32, lineHeight: 1.6 }}>
          {lt.desktopHint}
        </p>
      </div>
    );
  }

  const renderWorkspaceShapePreview = (previewKey: string) => (
    <ShapePreview
                    key={previewKey}
                    isSketchMode={isSketchMode}
                    result={viewportShapeResult}
                    bomParts={effectiveBomParts}
                    highlightedPartId={highlightedPartId}
                    assemblyLabel={bomLabel || undefined}
                    assemblyMates={assemblyMates}
                    assemblyHiddenParts={assemblyHiddenParts}
                    assemblyTransparentParts={assemblyTransparentParts}
                    assemblyPartColors={assemblyPartColors}
                    isKinematicsMode={assemblyMates.length > 0 || (placedParts?.length ?? 0) > 0}
                    onCapture={(cb) => {
                      captureRef.current = cb;
                      const canvasEl = document.querySelector(
                        `canvas[data-engine="${NF_R3F_VIEWPORT_DATA_ENGINE}"]`,
                      ) as HTMLCanvasElement | null;
                      if (canvasEl) {
                        renderCanvasRef.current = canvasEl;
                        canvasRef.current = canvasEl;
                      }
                    }}
                    editMode={editMode}
                    onDragStateChange={setIsDragging}
                    showDimensions={showDimensions}
                    measureActive={measureActive}
                    onStandardPartDrop={handleStandardPartDrop}
                    measureMode={measureMode}
                    sectionActive={sectionActive}
                    sectionAxis={sectionAxis}
                    sectionOffset={sectionOffset}
                    showPlanes={showPlanes}
                    constructPlanes={showPlanes ? defaultPlanes : undefined}
                    unitSystem={unitSystem}
                    transformMode={transformMode}
                    onTransformChange={setTransformMatrix}
                    snapGrid={snapEnabled ? snapSize : undefined}
                    showPerf={showPerf}
                    viewportBenchmarkTier={viewportBenchmarkTier}
                    materialId={materialId}
                    onMaterialDrop={setMaterialId}
                    onRadialCommand={canvasOnRadialCommand}
                    collabUsers={collabUsers}
                    awarenessPresences={awarenessPresences}
                    awarenessLocalClientId={crdtBridge.doc.doc.clientID}
                    showPrintAnalysis={showPrintAnalysis && !simpleMode}
                    printAnalysis={printAnalysis}
                    printBuildDirection={printBuildDir}
                    printOverhangAngle={printOverhangAngle}
                    renderMode={renderMode}
                    renderSettings={renderMode === 'photorealistic' ? renderSettings : undefined}
                    onCaptureScreenshot={renderMode === 'photorealistic' ? () => {
                      if (renderCanvasRef.current) {
                        setScreenshotModal({ canvas: renderCanvasRef.current });
                      }
                    } : undefined}
                    explodeFactor={explodeFactor}
                    interferenceHighlights={interferenceResults.length > 0 ? interferenceResults : undefined}
                    showFEA={showFEA && !simpleMode}
                    feaResult={feaResult}
                    feaDisplayMode={feaDisplayMode}
                    feaDeformationScale={feaDeformationScale}
                    feaConditions={showFEA && !feaResult ? feaConditions : undefined}
                    feaHighlightedConditionIdx={feaHighlightedConditionIdx}
                    onFEAConditionClick={setFeaHighlightedConditionIdx}
                    showDFM={showDFM && !simpleMode}
                    dfmResults={dfmResults}
                    dfmHighlightedIssue={dfmHighlightedIssue}
                    showDraftAnalysis={showDraftAnalysis && !simpleMode}
                    draftResult={draftResult}
                    draftMinDeg={draftMinDeg}
                    showCenterOfMass={showCenterOfMass ?? assemblyCenterOfMass}
                    gdtAnnotations={gdtAnnotations.length > 0 ? gdtAnnotations : undefined}
                    dimensionAnnotations={dimensionAnnotations.length > 0 ? dimensionAnnotations : undefined}
                    onSceneReady={(scene) => { sceneRef.current = scene; }}
                    onCameraPlaneChange={isSketchMode ? setSketchPlaneRaw : undefined}
                    sketchPlane={isSketchMode ? (sketchPlane as 'xy' | 'xz' | 'yz') : undefined}
                    onSketchPlaneChange={isSketchMode ? setSketchPlane : undefined}
                    onGeometryApply={handleGeometryApply}
                    onEdgeOperationStatus={(status, op, detail) => {
                      // Surface viewport edge fillet/chamfer outcomes as toasts so
                      // failures stop being silent. The detail payload is one of:
                      //   success → "r=3mm × 2" / "d=2mm × 1"
                      //   error   → "NO_GEOMETRY" | "RADIUS_INVALID" | "OCCT_FAILED"
                      //             | "IMPORT_FAILED: …" | raw error text
                      const opLabel = op === 'fillet'
                        ? (lang === 'ko' ? '필렛' : 'Fillet')
                        : (lang === 'ko' ? '챔퍼' : 'Chamfer');
                      if (status === 'success') {
                        addToast('success', lang === 'ko'
                          ? `${opLabel} 적용 (${detail})`
                          : `${opLabel} applied (${detail})`);
                      } else {
                        addToast('error', lang === 'ko'
                          ? `${opLabel} 실패: ${detail}`
                          : `${opLabel} failed: ${detail}`);
                      }
                    }}
                    onFaceOperationStatus={(status, op, detail) => {
                      // Mirror of onEdgeOperationStatus for the FaceContextPanel.
                      // success → "d=2.0mm" / "t=2.0mm × top"
                      // error   → "NO_GEOMETRY" | "OFFSET_INVALID" | "THICKNESS_INVALID"
                      //           | "OCCT_FAILED" | raw error text
                      const opLabel = op === 'offset'
                        ? (lang === 'ko' ? '면 오프셋' : 'Face Offset')
                        : (lang === 'ko' ? '쉘' : 'Shell');
                      if (status === 'success') {
                        addToast('success', lang === 'ko'
                          ? `${opLabel} 적용 (${detail})`
                          : `${opLabel} applied (${detail})`);
                      } else {
                        addToast('error', lang === 'ko'
                          ? `${opLabel} 실패: ${detail}`
                          : `${opLabel} failed: ${detail}`);
                      }
                    }}
                    faceEditViewportCallout={lt.faceEditViewportCallout}
                    faceEditViewportCalloutTitle={lt.faceEditViewportCalloutTitle}
                    faceEditViewportCalloutTip={lt.faceEditViewportCalloutTip}
                    faceEditCalloutDismiss={lt.faceEditCalloutDismiss}
                    lang={lang}
                    arrayPattern={arrayPattern}
                    showArray={showArrayPanel && !!arrayPattern && !simpleMode}
                    onOpenLibrary={() => setShowLibrary(true)}
                    onStartSketch={() => setIsSketchMode(true)}
                    onOpenChat={() => openAIAssistant('chat')}
                    pinComments={comments}
                    isPlacingComment={isPlacingComment}
                    focusedPinCommentId={focusedCommentId}
                    onAddPinComment={canvasPinComments.onAddPinComment}
                    onResolvePinComment={canvasPinComments.onResolvePinComment}
                    onDeletePinComment={canvasPinComments.onDeletePinComment}
                    onReactPinComment={canvasPinComments.onReactPinComment}
                    onReplyPinComment={canvasPinComments.onReplyPinComment}
                    pinCommentRoomUsers={collabUsers.map(u => ({ id: u.id, name: u.name, color: u.color }))}
                    pinCommentCurrentUserId={collabUserIdRef.current}
                    onFaceSketch={(_faceId) => {
                      setEditMode('none');
                      setIsSketchMode(true);
                      setSketchProfile({ segments: [], closed: false });
                    }}
                    onDimClick={(dim, value) => {
                      const paramMap: Record<string, string> = { w: 'width', h: 'height', d: 'depth' };
                      const paramKey = paramMap[dim];
                      if (paramKey && paramKey in params) {
                        setParams({ ...params, [paramKey]: value });
                      }
                    }}
                    snapEnabled={snapEnabled}
                    smartSnapEnabled={smartSnapEnabled}
                    ghostResult={isPreviewMode ? previewResult : null}
                    motionPartTransforms={motionPartTransforms}
                    nurbsCPEdit={canvasNurbsCPEdit}
                    nurbsCPParams={canvasNurbsCPParams}
                    onNurbsCPParamChange={canvasOnNurbsCPParamChange}
                    selectionActive={selectionActive}
                    onToggleSelection={toggleFaceSelectionMode}
                    onElementSelect={canvasOnElementSelect}
                    highlightTriangles={canvasHighlightTriangles}
                    onFileImport={canvasOnFileImport}
                    blockAutomaticGeometryFit={viewportGeometryFitSuppressed}
                    projectCameraToApply={projectCameraToApply}
                    onProjectCameraApplied={handleProjectCameraApplied}
                    onViewportCameraCommit={handleViewportCameraCommit}
                    onGeometryFitRequest={handleGeometryFitRequest}
                  />
  );

  // RENDER — WORKSPACE VIEW
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div
      data-testid="shape-generator-workspace"
      style={{ height: '100dvh', background: theme.bg, display: 'flex', flexDirection: 'column', userSelect: 'none', WebkitUserSelect: 'none', overflow: 'hidden' }}
      onDragStart={e => e.preventDefault()}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}>

      <FullscreenAutoHide active={isFullscreen} />

      {/* ════ Desktop Title Bar (Tauri only) ════ */}
      <DesktopTitleBar
        projectName={useSceneStore.getState().selectedId || 'nexyfab-project'}
        isDirty={desktopDirty}
        currentPath={desktopFilePath}
        plan={(useAuthStore.getState().user?.plan as 'free' | 'pro' | 'team' | 'enterprise' | undefined) ?? 'free'}
        lang={lang}
        onNewFile={resetNfabFile}
        onOpenFile={() => void handleLoadNfab()}
        onOpenRecent={handleOpenRecentFile}
        onSave={() => void handleSaveNfab(false)}
        onSaveAs={() => void handleSaveNfab(true)}
        onReplayWelcome={handleReplayDesktopWelcome}
      />

      {viewMode === 'workspace' && (
        <PdmMetaWorkspaceStrip isKo={lang === 'ko'} onFieldsEdited={markNfabDirty} />
      )}

      {showDesktopFirstRun ? (
        <DesktopFirstRunWizard lang={lang} onClose={() => setShowDesktopFirstRun(false)} />
      ) : null}

      {/* ════ Header Overlays (drag-drop / import loading / fullscreen prompt) ════ */}
      <HeaderOverlays
        isDragOver={isDragOver}
        isImporting={isImporting}
        showFullscreenPrompt={showFullscreenPrompt}
        dismissFullscreenPrompt={dismissFullscreenPrompt}
        lt={lt}
      />

      {/* ════════ TOP TOOLBAR ════════ */}
      <ShapeGeneratorToolbar
        theme={theme}
        mode={mode}
        toggleTheme={toggleTheme}
        isMobile={isMobile}
        isTablet={isTablet}
        tabletLeftOpen={tabletLeftOpen}
        setTabletLeftOpen={setTabletLeftOpen}
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        tabLabels={tabLabels}
        lang={lang}
        langSeg={langSeg}
        isSketchMode={isSketchMode}
        canUndo={cmdHistory.canUndo}
        canRedo={cmdHistory.canRedo}
        onHistoryUndo={handleHistoryUndo}
        onHistoryRedo={handleHistoryRedo}
        showVersionPanel={showVersionPanel}
        setShowVersionPanel={setShowVersionPanel}
        renderMode={renderMode}
        setRenderMode={(mode) => {
          if (mode === 'photorealistic' && renderMode !== 'photorealistic') {
            requirePhotoReal(() => setRenderMode('photorealistic'));
          } else {
            setRenderMode(mode);
          }
        }}
        showCOTSPanel={showCOTSPanel}
        setShowCOTSPanel={setShowCOTSPanel}
        effectiveResult={!!effectiveResult}
        showAIAdvisor={showAIAssistant && useUIStore.getState().aiAssistantTab === 'suggestions'}
        setShowAIAdvisor={() => openAIAssistant('suggestions')}
        isPlacingComment={isPlacingComment}
        setIsPlacingComment={setIsPlacingComment}
        showCommentsPanel={showCommentsPanel}
        setShowCommentsPanel={setShowCommentsPanel}
        commentCount={comments.length}
        showDimensions={showDimensions}
        setShowDimensions={setShowDimensions}
        planLimits={planLimits}
        pollingSessions={pollingSessions}
        mySessionId={mySessionId}
        designCollabDemo={collabDemo}
        onToggleDesignCollabDemo={() => setCollabDemo(!collabDemo)}
        onOpenAuth={(m) => { setAuthModalMode(m ?? 'login'); setShowAuthModal(true); }}
        authModalMode={authModalMode}
        cartAdded={cartAdded}
        cartItemsLength={cartItems.length}
        onAddToCart={handleAddToCart}
        disableCart={!effectiveResult || activeTab !== 'design'}
        showCostPanel={showCostPanel}
        setShowCostPanel={setShowCostPanel}
        onGetQuote={handleGetQuote}
        rfqPending={rfqPending}
        simpleMode={simpleMode}
        onEnableSimpleMode={enableSimpleMode}
        onDisableSimpleMode={disableSimpleMode}
        onOpenWizard={() => setShowQuoteWizard(true)}
        tGetQuote={shapeLabels.getQuote ?? 'Get Quote'}
        selectedId={selectedId}
        params={params}
        materialId={materialId}
        shareOpenKey={shareOpenKey}
        isCreatingShare={isCreatingShare}
        shareUrl={shareUrl}
        onIPShare={() => void handleIPShare(
          planLimits,
          materialId,
          selectedId,
          setShowUpgradePrompt,
          setUpgradeFeature,
        )}
        addToast={addToast}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        dfmIssueCount={dfmBadgeCount}
        dfmRunning={dfmBadgeRunning}
        showDFM={showDFM}
        onToggleDFM={() => setShowDFM(!showDFM)}
        onStepGeometryDirect={(stats) => {
          if (!stats.geometry) return;
          import('./shapes').then(({ makeEdges, meshVolume, meshSurfaceArea }) => {
            const geometry = stats.geometry!;
            const edgeGeometry = makeEdges(geometry);
            const volume_cm3 = meshVolume(geometry) / 1000;
            const surface_area_cm2 = meshSurfaceArea(geometry) / 100;
            geometry.computeBoundingBox();
            const bb = geometry.boundingBox;
            const size = bb ? new Vector3() : null;
            if (bb && size) bb.getSize(size);
            const bbox = size ? { w: Math.round(size.x), h: Math.round(size.y), d: Math.round(size.z) } : { w: 0, h: 0, d: 0 };
            setSketchResult({ geometry, edgeGeometry, volume_cm3, surface_area_cm2, bbox });
            
            if (stats.partsGeo && stats.partsGeo.length > 1) {
              const bomResults = stats.partsGeo.map(p => {
                const pGeo = p.geometry;
                const pEdge = makeEdges(pGeo);
                pGeo.computeBoundingBox();
                const pBb = pGeo.boundingBox;
                const pSize = pBb ? new Vector3() : null;
                if (pBb && pSize) pBb.getSize(pSize);
                const pBbox = pSize ? { w: Math.round(pSize.x), h: Math.round(pSize.y), d: Math.round(pSize.z) } : { w: 0, h: 0, d: 0 };
                return {
                  name: p.name,
                  result: { geometry: pGeo, edgeGeometry: pEdge, volume_cm3: meshVolume(pGeo) / 1000, surface_area_cm2: meshSurfaceArea(pGeo) / 100, bbox: pBbox }
                };
              });
              setBomParts(bomResults);
              setBomLabel('Assembly');
            } else {
              setBomParts([]); setBomLabel('');
            }
            
            setIsSketchMode(false);
            addToast('success', lt.stepLoadedIntoViewport);
          });
        }}
        layoutControls={{
          leftCollapsed: sidebarLayout.leftCollapsed,
          rightCollapsed: sidebarLayout.rightCollapsed,
          swapSides: sidebarLayout.swapSides,
          overlayPref: sidebarLayout.overlayPref,
          onToggleLeft: sidebarLayout.toggleLeftCollapsed,
          onToggleRight: sidebarLayout.toggleRightCollapsed,
          onToggleSwap: sidebarLayout.toggleSwapSides,
          onCycleOverlay: sidebarLayout.cycleOverlayPref }}
      />

      {/* ════════ FUNNEL STEP BAR ════════ */}
      {viewMode === 'workspace' && !isMobile && (
        <DesignFunnelBar
          lang={lang}
          sketchMode={isSketchMode && activeTab === 'design'}
          statusGuide={statusGuide}
          hasGeometry={!!effectiveResult}
          dfmChecked={dfmResults !== null || dfmWarnings.status !== 'ok'}
          dfmClean={dfmBadgeCount === 0}
          dfmIssueCount={dfmBadgeCount}
          rfqDone={rfqDone}
          onGoToDFM={() => setShowDFM(true)}
          onGoToQuote={() => setShowQuoteWizard(true)}
          onProcessRouter={() => {
            const gate = checkFreemium('process_router');
            if (!gate.allowed) { setShowProcessRouterUpgrade(true); return; }
            setShowProcessRouter(true);
          }}
          onAISupplierMatch={() => {
            const gate = checkFreemium('ai_supplier_match');
            if (!gate.allowed) { setShowAISupplierMatchUpgrade(true); return; }
            setShowAISupplierMatch(true);
          }}
          onCostCopilot={() => {
            const gate = checkFreemium('cost_copilot');
            if (!gate.allowed) { setShowCostCopilotUpgrade(true); return; }
            setShowCostCopilot(true);
          }}
          onAIHistory={() => setShowAIHistory(true)}
          onOpenScad={() => setShowOpenScad(true)}
          onIdeaDesign={() => setShowIntakeWizard(true)}
          selectionActive={selectionActive}
          onToggleSelection={toggleFaceSelectionMode}
          theme={theme}
        />
      )}

      {/* ════════ IDEA → DESIGN WIZARD (L1 Intake) ════════ */}
      {showIntakeWizard && (
        <IntakeWizard
          onCancel={() => setShowIntakeWizard(false)}
          onComplete={async (spec: IntakeSpec) => {
            setShowIntakeWizard(false);
            setComposeResult(null);
            setComposeSpec(spec);
            const data = await runCompose(spec);
            if (data) setComposeResult(data);
            else setComposeSpec(null);
          }}
        />
      )}

      {/* compose 결과 리뷰 패널 */}
      {composeResult && composeSpec && !composing && (
        <ComposeResultPanel
          spec={composeSpec}
          result={composeResult}
          onClose={() => {
            setComposeResult(null);
            setComposeSpec(null);
          }}
          onRetry={() => {
            setComposeResult(null);
            setShowIntakeWizard(true);
          }}
          onApply={(code, label) => {
            try {
              sessionStorage.setItem('nexyfab:pendingJscadCode', code);
              sessionStorage.setItem('nexyfab:pendingJscadSource', lt.ideaDesignSource(label));
            } catch (err) { console.error('[ShapeGeneratorInner] caught', err); }

            // funnel 합류: 추천 재료 → 시각화/FEA preset 으로 주입
            const presetId = composeResult ? mapToPresetId(composeResult.materialId) : undefined;
            if (presetId) {
              setMaterialId(presetId);
            }

            // 비용 안내 + 다음 단계(견적) 유도 토스트
            const cost = composeResult?.estimate?.unitCostUsd;
            const lead = composeResult?.estimate?.leadTimeDays;
            const summaryParts: string[] = [];
            if (cost != null) summaryParts.push(lt.unitCostHint(cost));
            if (lead) summaryParts.push(lt.leadTimeHint(lead[0], lead[1]));
            const summary = summaryParts.join(' · ');

            addToast(
              'success',
              lt.designApplied(summary),
              10000,
              {
                label: lt.getQuoteArrow,
                onClick: () => setShowQuoteWizard(true) }
            );

            setComposeResult(null);
            setComposeSpec(null);
            setShowOpenScad(true);
          }}
          onSwap={async (force) => {
            if (!composeSpec) return;
            const data = await runCompose(composeSpec, force);
            if (data) setComposeResult(data);
          }}
        />
      )}

      {/* compose 진행 인디케이터 */}
      <ComposeIndicator
        visible={composing}
        refining={!!composeResult}
        labels={{
          composeSearching: lt.composeSearching,
          composeRefining: lt.composeRefining,
          composeSubtitle: lt.composeSubtitle,
        }}
      />

      {/* ════════ QUOTE WIZARD ════════ */}
      {showQuoteWizard && (
        <QuoteWizard
          lang={lang}
          onClose={() => setShowQuoteWizard(false)}
          initialMaterialId={materialId}
          onMatchManufacturer={() => {
            setShowManufacturerMatch(true);
          }}
          onGetQuote={() => {
            void handleGetQuote();
            setShowQuoteWizard(false);
            setRfqDone(true);
          }}
        />
      )}

      {/* ════════ CSG + Body Manager dock ════════ */}
      {/* The CSGPanel mounts via BodyCsgDock when showCSGPanel === true. A sibling
       *  zero-size marker carries data-testid="csg-panel-overlay" so regression
       *  tests can assert overlay visibility without depending on the dynamically
       *  imported panel's internal markup. The marker is only rendered when the
       *  panel is open, matching the panel's mount lifecycle. */}
      {showCSGPanel && (
        <span data-testid="csg-panel-overlay" style={{ display: 'none' }} aria-hidden="true" />
      )}
      <BodyCsgDock
        lang={lang}
        showCSGPanel={showCSGPanel}
        setShowCSGPanel={setShowCSGPanel}
        onCSGApply={handleCSGApply}
        showBodyPanel={showBodyPanel}
        setShowBodyPanel={setShowBodyPanel}
        bodies={bodies}
        setBodies={setBodies}
        activeBodyId={activeBodyId}
        setActiveBodyId={setActiveBodyId}
        selectedBodyIds={selectedBodyIds}
        setSelectedBodyIds={setSelectedBodyIds}
        setHighlightedPartId={setHighlightedPartId}
        bodyGeosRef={bodyGeosRef}
        onSplit={handleSplitBody}
        onMerge={handleMergeBodies}
      />

      {/* ════════ Top Banners (preview / verify / recovery / read-only / simple-mode offer) ════════ */}
      <TopBanners
        lang={lang}
        isPreviewMode={isPreviewMode}
        isReadOnly={isReadOnly}
        onCancelPreview={handleCancelPreview}
        showRecovery={showRecovery}
        recoveryData={recoveryData}
        recoveredFromCrash={recoveredFromCrash}
        onRestoreRecovery={handleRestoreRecovery}
        onDismissRecovery={handleDismissRecovery}
        showRecoveryCompare={showRecoveryCompare}
        setShowRecoveryCompare={setShowRecoveryCompare}
        currentSelectedId={selectedId}
        currentParams={params}
        currentFeatures={features}
        simpleMode={simpleMode}
        onEnableSimpleMode={enableSimpleMode}
        onApplyPreset={applyUserPreset}
        lt={lt}
      />



      {/* ════════ MAIN AREA ════════ */}
      <div style={{
        flex: 1, display: 'flex',
        flexDirection: sidebarLayout.swapSides ? 'row-reverse' : 'row',
        overflow: 'hidden', minHeight: 0, position: 'relative' }}>

        {/* ══════ LEFT PANEL — hidden on mobile, collapsible on tablet ══════ */}
        {!isReadOnly && <ErrorBoundary><LeftPanel
          lang={lang}
          t={shapeLabels}
          gt={gt}
          isMobile={isMobile}
          isTablet={isTablet}
          tier1={tier1}
          tier2={tier2}
          effectiveResult={effectiveResult}
          featureHistory={featureHistoryWithErrors ?? null}
          features={features}
          rollbackTo={rollbackTo}
          startEditing={startEditing}
          finishEditing={finishEditing}
          toggleExpanded={toggleExpanded}
          ensureExpanded={ensureExpanded}
          toggleFeature={toggleFeatureCmd}
          removeNode={removeNode}
          updateFeatureParam={updateFeatureParamCmd}
          addFeature={addFeatureWithContext}
          moveFeatureByIds={handleMoveFeatureByIds}
          sketchProfiles={sketchProfiles}
          activeProfileIdx={activeProfileIdx}
          sketchOperation={sketchOperation}
          sketchPlaneOffset={sketchPlaneOffset}
          showSketchHistory={showSketchHistory}
          editingSketchFeatureId={editingSketchFeatureId}
          sketchHistory={sketchHistory}
          onSketchModeStart={() => setIsSketchMode(true)}
          onSketchViewModeChange={setSketchViewMode}
          onSketchPlaneChange={setSketchPlane}
          onSketchOperationChange={setSketchOperation}
          onSketchPlaneOffsetChange={setSketchPlaneOffset}
          onToggleSketchHistory={() => setShowSketchHistory(v => !v)}
          onLoadSketchFromHistory={handleLoadSketchFromHistory}
          onDeleteSketchHistoryEntry={handleDeleteSketchHistoryEntry}
          onSketchClear={handleSketchClear}
          onSketchUndo={handleSketchUndo}
          onSketchGenerate={handleSketchGenerate}
          sketchStep={sketchStep}
          onSketchStepChange={setSketchStep}
          onOpenTextPanel={() => setShowSketchText(true)}
          onSetActiveProfile={handleSetActiveProfile}
          onAddHoleProfile={handleAddHoleProfile}
          onDeleteProfile={handleDeleteProfile}
          onAddSketchFeature={handleAddSketchToFeatureTree}
          onEditSketchFeature={handleEditSketchFeature}
          constraints={sketchConstraints}
          dimensions={sketchDimensions}
          onAddConstraint={handleAddConstraint}
          onRemoveConstraint={handleRemoveConstraint}
          onDimensionChange={handleDimensionChange}
          onRemoveDimension={handleRemoveDimension}
          selectedConstraintType={selectedConstraintType}
          onConstraintTypeChange={setSelectedConstraintType}
          autoSolve={autoSolve}
          onAutoSolveChange={setAutoSolve}
          onSolveConstraints={handleSolveConstraints}
          constraintStatus={constraintStatus}
          constraintDiagnostic={constraintDiagnostic}
          onSelectShape={handleSelectShape}
          onParamChange={handleParamChange}
          onExpressionChange={handleExpressionChange}
          onParamCommit={handleParamCommit}
          onShapeReset={handleShapeReset}
          formulaValues={formulaValues}
          onFormulaChange={handleFormulaChange}
          modelVars={modelVars.map(v => ({ name: v.name, value: v.value }))}
          unitSystem={unitSystem}
          onSelectFeatureFromTree={setSelectedFeatureId}
          bomParts={bomParts}
          bomLabel={bomLabel}
          showBomExportMenu={showBomExportMenu}
          onToggleBomExportMenu={() => setShowBomExportMenu(v => !v)}
          onExportBomCSV={handleExportBomCSV}
          onExportBomExcel={handleExportBomExcel}
          cartItemsCount={cartItems.length}
          importedFilename={importedFilename}
          renderSettings={renderSettings}
          onRenderSettingsChange={setRenderSettings}
          onRenderCapture={() => {
            if (renderCanvasRef.current) {
              setScreenshotModal({ canvas: renderCanvasRef.current });
            }
          }}
          onHighResCapture={() => {
            const canvas = renderCanvasRef.current;
            if (!canvas) return;
            const scale = Math.min(4, Math.floor(4096 / Math.max(canvas.width, canvas.height)));
            const w = canvas.width * scale;
            const h = canvas.height * scale;
            const off = document.createElement('canvas');
            off.width = w; off.height = h;
            const ctx = off.getContext('2d');
            if (!ctx) return;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(canvas, 0, 0, w, h);
            const a = document.createElement('a');
            a.href = off.toDataURL('image/png');
            a.download = `nexyfab-4k-${Date.now()}.png`;
            a.click();
          }}
          customDomainGeometry={customDomainGeometry}
          dfmParamWarnings={dfmParamWarnings}
          useCustomDomain={useCustomDomain}
          onUseCustomDomainChange={setUseCustomDomain}
          dimX={dimX}
          dimY={dimY}
          dimZ={dimZ}
          onDimChange={handleDimChange}
          materialKey={materialKey}
          onMaterialKeyChange={setMaterialKey}
          fixedFaces={fixedFaces}
          loads={loads}
          selectionMode={selectionMode}
          onSelectionModeChange={(m) => setSelectionMode(m)}
          onRemoveFixed={handleRemoveFixed}
          onRemoveLoad={handleRemoveLoad}
          activeLoadForce={activeLoadForce}
          onActiveLoadForceChange={(f) => setActiveLoadForce(f)}
          volfrac={volfrac}
          onVolfracChange={setVolfrac}
          resolution={resolution}
          onResolutionChange={(r) => setResolution(r)}
          penal={penal}
          onPenalChange={setPenal}
          rmin={rmin}
          onRminChange={setRmin}
          maxIter={maxIter}
          onMaxIterChange={setMaxIter}
          isOptimizing={isOptimizing}
          onGenerate={handleGenerate}
          onOptReset={handleOptReset}
          optResult={optResult}
          resultMesh={!!resultMesh}
          weightInfo={weightInfo}
          convergenceChart={convergenceChart}
          onExportOptSTL={handleExportSTL}
          onSendOptToQuote={handleSendOptToQuote}
          layoutWidth={sidebarLayout.leftWidth}
          collapsed={sidebarLayout.leftCollapsed}
          overlay={sidebarLayout.overlay}
          side={sidebarLayout.swapSides ? 'right' : 'left'}
          onToggleCollapse={sidebarLayout.toggleLeftCollapsed}
          onResize={sidebarLayout.setLeftWidth}
          sketchSliceLinked={sketchPalSlice && sectionActive}
          configurationsList={configurations.map(c => ({ id: c.id, name: c.name }))}
          activeConfigurationId={activeConfigurationId}
          onConfigurationSelect={handleConfigurationSelect}
          onConfigurationAdd={handleConfigurationAdd}
          onConfigurationRename={handleConfigurationRename}
          onConfigurationDelete={handleConfigurationDelete}
        /></ErrorBoundary>}

        {/* ══════ CENTER — CommandManager + Viewport + StatusBar ══════ */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

          {/* CommandManager toolbar — hidden in readonly mode */}
          {!isReadOnly && <div data-tour="command-toolbar">
          <CommandToolbar
            activeTab={activeTab} isSketchMode={isSketchMode} editMode={editMode}
            hasResult={!!effectiveResult}
            onSketchMode={(on) => {
              setIsSketchMode(on);
              if (on && !isSketchMode) {
                setSketchResult(null);
                setEditMode('none');
                setMeasureActive(false);
                setSelectionActive(false);
                setSelectedElement(null);
              } else if (!on) {
                setEditMode('none');
              }
            }}
            onFinishSketch={handleSketchGenerate}
            onCancelSketch={() => setIsSketchMode(false)}
            onSketchTool={(tool) => setSketchTool((tool === 'rectangle' ? 'rect' : tool) as import('./sketch/types').SketchTool)}
            onEditMode={setEditMode} onAddFeature={addFeatureWithContext}
            onSendToOptimizer={handleSendToOptimizer} onExportSTL={() => setStlExportDialogOpen(true)}
            onToggleChat={() => { if (showAIAssistant) setShowAIAssistant(false); else openAIAssistant('chat'); }} showChat={showAIAssistant}
            isOptimizing={isOptimizing} onGenerate={handleGenerate}
            canGenerate={!!effectiveResult && fixedFaces.length > 0 && loads.length > 0} resultMesh={!!resultMesh}
            measureActive={measureActive} onToggleMeasure={toggleMeasureMode}
            measureMode={measureMode} onSetMeasureMode={setMeasureMode}
            sectionActive={sectionActive} onToggleSection={() => setSectionActive(v => !v)}
            onTogglePlanes={() => setShowPlanes(!showPlanes)} showPlanes={showPlanes}
            onImportFile={handleImportFile}
            onSketchInsertReference={() => sketchRefInputRef.current?.click()}
            onAddFeatureWithParams={addFeatureWithParamsAndContext}
            fileImportMenuHint={lt.importFileMenuHint}
            onExportOBJ={handleExportOBJ}
            onExportPLY={handleExportPLY}
            onExport3MF={handleExport3MF}
            onExportHTML={() => {
              void handleExportPresentationHtml(bomParts.length > 0
                ? bomParts.map(p => ({ name: p.name, geometry: p.result.geometry, color: assemblyPartColors[p.name] ?? p.color }))
                : undefined);
            }}
            onExportSTEP={handleExportSTEP}
            stepExportSupported={!!effectiveResult?.geometry && canExportStepViaBridge(effectiveResult.geometry)}
            onExportGLTF={handleExportGLTF}
            onExportSAT={handleExportSAT}
            onExportIGES={handleExportIGES}
            onExportIFC={handleExportIFC}
            onExportDXF={handleExportDXF}
            onExportFlatPatternDXF={handleExportFlatPatternDXF}
            onSaveScene={handleSaveScene}
            onLoadScene={handleLoadScene}
            onExportGLB={handleExportGLB}
            onExportRhino={handleExportRhino}
            onExportGrasshopper={handleExportGrasshopper}
            lockedFormats={(['step','gltf','obj','dxf','ply','sat','iges','ifc','rhino','grasshopper'] as const).filter(f => !planLimits.exportFormats.includes(f))}
            dxfProjection={dxfProjection}
            onDxfProjectionChange={setDxfProjection}
            onMeshProcess={handleMeshProcess}
            onAnalysis={handleAnalysis}
            onStandardParts={handleStandardParts}
            onSheetMetal={handleSheetMetal}
            onExtraction={handleExtraction}
            showLibrary={showLibrary}
            showValidation={showValidation}
            onTogglePlugins={() => setShowPluginManager(!showPluginManager)}
            onToggleScript={() => setShowScriptPanel(!showScriptPanel)}
            onExportDrawingPDF={handleExportDrawingPDF}
            onShare={() => setShareOpenKey(shareOpenKey + 1)}
            onSendToStudio={returnToStudio}
            onManufacturerMatch={() => setShowManufacturerMatch(true)}
            onBodyManager={handleOpenBodyPanel}
            exportingFormat={exportingFormat}
            onSetCamPost={setMfgCamPost}
            activeCamPost={mfgCamPost}
            onUndo={() => { featureParamCoalescer.flush(); cmdHistory.undo(); }}
            onRedo={() => { featureParamCoalescer.flush(); cmdHistory.redo(); }}
            canUndo={cmdHistory.canUndo}
            canRedo={cmdHistory.canRedo}
            showHistoryPanel={showHistoryPanel}
            onToggleHistory={() => setShowHistoryPanel(!showHistoryPanel)}
            showModelParams={showModelParams}
            onToggleModelParams={() => setShowModelParams(v => !v)}
            dfmIssueCount={dfmBadgeCount}
            onViewAR={() => setShowARViewer(true)}
            onViewFeatureGraph={() => setShowFeatureGraph(true)}
            onViewNesting={() => setShowNestingTool(true)}
            onViewVariants={() => setShowVariantsPanel(true)}
            onViewUserParts={() => setShowUserPartsPanel(true)}
            onViewTimelapse={() => setShowSessionTimelapse(true)}
            onViewStockOptimizer={() => setShowStockOptimizer(true)}
            onViewThreadHole={() => setShowThreadHolePanel(true)}
            onHoleWizard={() => setShowHoleWizard(true)}
            t={shapeLabels}
            lang={lang}
            onCycleSketchPickFilter={isSketchMode ? cycleSketchPickFilter : undefined}
            sketchPickFilterHint={isSketchMode ? sketchPickFilterHint : undefined}
          />
          </div>}

          {/* ── Workspace switcher + Breadcrumb ── */}
          <div style={{ display: 'flex', alignItems: 'stretch', width: '100%', minWidth: 0 }}>
            <CadWorkspaceSwitcher
              lang={lang}
              isSketchMode={isSketchMode}
              readOnly={isReadOnly}
              selectAriaLabel={lt.cadWorkspaceSelectAria}
              onOptimizeBlockedBySketch={() => addToast('warning', lt.exitSketchBeforeOptimize)}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <BreadcrumbNav items={(() => {
                const _bc: Record<string, Record<string, string>> = {
                  ko: { design: '설계', optimize: '최적화', sketch: '스케치', profile: '프로파일', edit: '편집' },
                  en: { design: 'Design', optimize: 'Optimize', sketch: 'Sketch', profile: 'Profile', edit: 'Edit' },
                  ja: { design: '設計', optimize: '最適化', sketch: 'スケッチ', profile: 'プロファイル', edit: '編集' },
                  cn: { design: '设计', optimize: '优化', sketch: '草图', profile: '轮廓', edit: '编辑' },
                  es: { design: 'Diseño', optimize: 'Optimización', sketch: 'Boceto', profile: 'Perfil', edit: 'Editar' },
                  ar: { design: 'تصميم', optimize: 'تحسين', sketch: 'رسم', profile: 'ملف تعريف', edit: 'تحرير' } };
                const bc = (k: string) => (_bc[lang] ?? _bc.en)[k] ?? (_bc.en[k] ?? k);
                const crumbs: BreadcrumbItem[] = [
                  { label: activeTab === 'design' ? bc('design') : bc('optimize'), icon: activeTab === 'design' ? '🧊' : '🔬', onClick: () => handleSetActiveTab(activeTab) },
                ];
                if (isSketchMode) {
                  crumbs.push({ label: bc('sketch'), icon: '✏️', onClick: () => {} });
                  crumbs.push({ label: `${bc('profile')} ${activeProfileIdx + 1}`, active: true });
                } else if (editMode !== 'none') {
                  crumbs.push({ label: bc('edit'), icon: '✎' });
                  crumbs.push({ label: editMode, active: true });
                } else if (effectiveResult) {
                  const shapeName = shapeLabels[`shapeName_${selectedId}`] || selectedId;
                  crumbs.push({ label: shapeName, icon: SHAPE_ICONS[selectedId] || '⬡', active: !selectedFeatureId });
                  if (selectedFeatureId) {
                    const feat = features.find(f => f.id === selectedFeatureId);
                    if (feat) crumbs.push({ label: feat.type, active: true, onClick: () => setShowPropertyManager(true) });
                  }
                }
                return crumbs;
              })()} />
            </div>
          </div>

          {/* ── Selection Filter Bar ── */}
          {!isSketchMode && (
            <SelectionFilterBar activeFilters={selectionFilters} onToggle={toggleSelectionFilter} lang={lang} />
          )}

          {/* Plugin toolbar buttons */}
          {pluginToolbarButtons.length > 0 && activeTab === 'design' && (
            <div className="sg-autohide" style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '1px 8px', background: 'var(--nx-panel)', borderBottom: '1px solid var(--nx-border)', height: 22 }}>
              <span style={{ color: 'var(--nx-text-2)', fontSize: 9, fontWeight: 700, marginRight: 3 }}>🧩</span>
              {pluginToolbarButtons.map(btn => (
                <button
                  key={btn.id}
                  onClick={btn.onClick}
                  title={btn.tooltip || btn.label}
                  style={{
                    padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                    background: 'var(--nx-panel-2)', color: 'var(--nx-text)',
                    display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-border)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--nx-panel-2)'; }}
                >
                  <span style={{ fontSize: 11 }}>{btn.icon}</span>
                  {btn.label}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setShowPluginManager(true)}
                style={{
                  padding: '1px 6px', borderRadius: 3, fontSize: 9, fontWeight: 700,
                  border: '1px solid var(--nx-border)', cursor: 'pointer',
                  background: 'transparent', color: 'var(--nx-text-2)',
                  transition: 'all 0.12s', height: 18 }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--nx-accent-2)'; e.currentTarget.style.color = 'var(--nx-text)'; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--nx-border)'; e.currentTarget.style.color = 'var(--nx-text-2)'; }}
              >
                {lt.manageLabel}
              </button>
            </div>
          )}

          {/* ── Merged Context Bar (Split / DirectEdit / Transform / Collab) ── */}
          {activeTab === 'design' && !isSketchMode && (
            <div data-tour="transform-tools" className="sg-topbar sg-autohide" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 8px', background: 'var(--nx-bg)', borderBottom: '1px solid var(--nx-border)', height: 24 }}>
              {/* Collab Indicator */}
              <div
                title={`${onlineCount} online`}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: 'var(--nx-panel-2)', color: 'var(--nx-text)', height: 18, border: onlineCount > 1 ? '1px solid rgba(63, 185, 80, 0.4)' : '1px solid transparent' }}
              >
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: onlineCount > 1 ? 'var(--nx-ok)' : 'var(--nx-text-2)', boxShadow: onlineCount > 1 ? '0 0 4px var(--nx-ok)' : 'none' }} />
                {onlineCount} {onlineCount === 1 ? 'user' : 'users'}
              </div>
              <div style={{ width: 1, height: 14, background: 'var(--nx-border)', margin: '0 2px' }} />

              {/* Split View */}
              <button
                onClick={() => setMultiView(!multiView)}
                title={multiView ? 'Single View' : 'Split View'}
                style={{
                  padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                  border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                  background: multiView ? 'var(--nx-accent)' : 'var(--nx-panel-2)',
                  color: multiView ? 'var(--nx-text)' : 'var(--nx-text)',
                  display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
              >
                <span style={{ fontSize: 10, fontFamily: 'monospace' }}>&#x229e;</span>
                {multiView ? 'Single' : 'Split'}
              </button>

              {/* Direct Edit */}
              {effectiveResult && !simpleMode && (
                <>
                  <div style={{ width: 1, height: 14, background: 'var(--nx-border)', margin: '0 2px' }} />
                  <span style={{ color: 'var(--nx-text-2)', fontSize: 9, fontWeight: 700 }}>{lt.directEdit}</span>
                  {([
                    ['face', '▣', lt.faceEditMode, 'var(--nx-accent)'],
                    ['vertex', '⬡', lt.vertexEditMode, 'var(--nx-ok)'],
                    ['edge', '╱', lt.edgeEditMode, 'var(--nx-warn)'],
                  ] as const).map(([mode, icon, label, activeColor]) => (
                    <button
                      key={mode}
                      onClick={() => setEditMode(editMode === mode ? 'none' : mode)}
                      title={mode === 'face' ? `${label} — ${lt.doubleClickSketchFace}` : label}
                      style={{
                        padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                        background: editMode === mode ? activeColor : 'var(--nx-panel-2)',
                        color: editMode === mode ? 'var(--nx-text)' : 'var(--nx-text)',
                        display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
                    >
                      <span>{icon}</span>{label}
                    </button>
                  ))}
                  <button
                    data-testid="toolbar-boolean-button"
                    onClick={() => {
                      // Toggle: re-clicking the button when the panel is open should close it.
                      if (showCSGPanel) {
                        setShowCSGPanel(false);
                        return;
                      }
                      if (!effectiveResult) {
                        // Discoverability: surface the gating reason instead of silently opening
                        // an apply-disabled panel. handleCSGApply early-returns on no geometry.
                        addToast('info', lt.booleanNoGeometry);
                        return;
                      }
                      setShowCSGPanel(true);
                      addToast('info', lt.booleanPanelOpened);
                    }}
                    title={`${lt.booleanOps} — ${lt.booleanPanelOpened}`}
                    style={{
                      padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                      border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                      background: showCSGPanel ? 'var(--nx-accent-2)' : 'var(--nx-panel-2)',
                      color: showCSGPanel ? 'var(--nx-text)' : 'var(--nx-text)',
                      display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
                  >
                    ⊕ {lt.booleanShort}
                  </button>
                  {editMode !== 'none' && (
                    <button
                      onClick={() => setEditMode('none')}
                      title={lt.exitEdit}
                      style={{ padding: '1px 6px', borderRadius: 3, fontSize: 10, border: 'none', cursor: 'pointer', background: 'var(--nx-panel-2)', color: 'var(--nx-error)', height: 18 }}
                    >
                      ✕
                    </button>
                  )}
                </>
              )}

              {/* Transform (only when not in edit mode) */}
              {editMode === 'none' && effectiveResult && (
                <>
                  <div style={{ width: 1, height: 14, background: 'var(--nx-border)', margin: '0 2px' }} />
                  <span style={{ color: theme.textMuted, fontSize: 9, fontWeight: 700 }}>Transform:</span>
                  {([['translate', 'T', 'Translate (T)'], ['rotate', 'R', 'Rotate (R)'], ['scale', 'G', 'Scale (G)']] as const).map(([mode, key, title]) => (
                    <button
                      key={mode}
                      onClick={() => setTransformMode(transformMode === mode ? 'off' : mode)}
                      title={title}
                      style={{
                        padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                        background: transformMode === mode ? 'var(--nx-accent)' : 'var(--nx-panel-2)',
                        color: transformMode === mode ? 'var(--nx-text)' : 'var(--nx-text)',
                        display: 'flex', alignItems: 'center', gap: 3, height: 18 }}
                    >
                      <span style={{ fontSize: 9, fontFamily: 'monospace' }}>{key}</span>{mode.charAt(0).toUpperCase() + mode.slice(1)}
                    </button>
                  ))}
                  {transformMode !== 'off' && (
                    <button
                      onClick={() => setTransformMode('off')}
                      title="Disable transform (Esc)"
                      style={{
                        padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                        border: 'none', cursor: 'pointer', background: 'var(--nx-panel-2)', color: 'var(--nx-error)', height: 18 }}
                    >
                      ✕ Off
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {activeTab === 'design' && !isSketchMode && transformMode !== 'off' && (
            <div style={{ padding: '4px 10px', background: 'var(--nx-bg)', borderBottom: '1px solid var(--nx-border)' }}>
              <TransformInputPanel
                transformMatrix={transformMatrix}
                onMatrixChange={setTransformMatrix}
                lang={lang}
              />
            </div>
          )}

          {/* ── Workflow Stepper (sketch mode) ── */}
          {isSketchMode && activeTab === 'design' && (
            <WorkflowStepper
              isSketchMode={isSketchMode}
              sketchClosed={(sketchProfiles[activeProfileIdx] ?? sketchProfile).closed}
              hasResult={!!effectiveResult}
              featuresCount={features.length}
              lang={lang}
            />
          )}

          {/* ══ SPLIT LAYOUT: Sketch (left) + 3D Preview (right) ══ */}
          <ErrorBoundary><div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>

            {/* ── Sketch Canvas side (main workspace) ── */}
            {activeTab === 'design' && (
              <div
                ref={sketchContainerRef}
                data-tour="viewport"
                style={{
                  flex: 1,
                  position: 'relative',
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  borderRight: isMobile ? 'none' : '1px solid var(--nx-border)',
                  touchAction: 'none',
                  cursor: getToolCursor(isSketchMode, sketchTool, editMode, isDragging, measureActive) }}
                onMouseDown={(e) => { if (e.button === 2) rightMouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
                onContextMenu={handleContextMenu}
                {...touchGestureHandlers}
              >
                {/* CSG loading overlay */}
                {csgLoading && (
                  <div style={{
                    position: 'absolute', inset: 0, zIndex: 20,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }}>
                    <div style={{
                      width: 32, height: 32, border: '3px solid rgba(255,255,255,0.2)',
                      borderTopColor: 'var(--nx-accent-2)', borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite' }} />
                  </div>
                )}

                {/* Empty canvas guide (shown when no result and not in sketch mode) */}
                {!effectiveResult && !isSketchMode && activeTab === 'design' && (
                  <EmptyCanvasGuide
                    lang={lang}
                    onStartSketch={() => { setIsSketchMode(true); setSketchResult(null); setEditMode('none'); }}
                    onImportFile={handleImportFile}
                    onSelectShape={(id: string) => { const sc = SHAPES.find(s => s.id === id); if (sc) handleSelectShape(sc); }}
                    onStartTutorial={tutorial.startTutorial}
                    isImporting={isImporting}
                  />
                )}

                {!isReadOnly &&
                  !effectiveResult &&
                  !isSketchMode &&
                  activeTab === 'design' &&
                  cadWorkspace !== 'design' &&
                  cadWorkspace !== 'optimize' && (
                    <WorkspaceEmptyHint
                      lang={lang}
                      workspace={cadWorkspace}
                      workspaceEmptyNeedShape={lt.workspaceEmptyNeedShape}
                      workspaceEmptyGoDesign={lt.workspaceEmptyGoDesign}
                      isSketchMode={isSketchMode}
                    />
                  )}

                {/* PropertyManager (shown when feature selected) */}
                <PropertyManager
                  visible={showPropertyManager}
                  lang={lang}
                  selectedFeatureId={selectedFeatureId}
                  featureName={selectedFeatureId ? (features.find(f => f.id === selectedFeatureId)?.type || '') : ''}
                  featureType={selectedFeatureId ? (features.find(f => f.id === selectedFeatureId)?.type || '') : ''}
                  featureParams={selectedFeatureId ? (features.find(f => f.id === selectedFeatureId)?.params || {}) : {}}
                  paramDefs={selectedFeatureId ? Object.entries(features.find(f => f.id === selectedFeatureId)?.params || {}).map(([name, val]) => ({
                    name,
                    label: shapeLabels[`param_${name}`] || name,
                    min: 0,
                    max: typeof val === 'number' ? Math.max(val * 3, 100) : 100,
                    step: 1 })) : []}
                  onParamChange={(param, value) => {
                    if (!selectedFeatureId) return;
                    const draft = pmExprDraftRef.current[param];
                    delete pmExprDraftRef.current[param];
                    const node = features.find(f => f.id === selectedFeatureId);
                    const wasDriven = !!node?.paramExpressions?.[param];
                    if (draft !== undefined && parseParamInput(draft).kind === 'expression') {
                      // Typed a formula → assign/update the expression (one undo step).
                      setFeatureParamExpressionCmd(selectedFeatureId, param, draft);
                      return;
                    }
                    if (wasDriven) {
                      // Plain number over a driven param → freeze to literal
                      // (clears the expression + writes the value together).
                      setFeatureParamExpressionCmd(selectedFeatureId, param, String(value));
                      return;
                    }
                    updateFeatureParamCmd(selectedFeatureId, param, value);
                  }}
                  expressions={selectedFeatureId ? features.find(f => f.id === selectedFeatureId)?.paramExpressions : undefined}
                  onExpressionChange={(param, expression) => { pmExprDraftRef.current[param] = expression; }}
                  extraVariables={featureExprScope}
                  onClose={() => setShowPropertyManager(false)}
                  onApply={() => setShowPropertyManager(false)}
                />

                {/* Sketch canvas area (flex: 1, fills remaining space) */}
                <div data-tour="sketch-canvas" style={{ flex: 1, position: 'relative', minHeight: 0 }}>
                  {sketchRefImporting && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 40,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(15,23,42,0.48)',
                        pointerEvents: 'auto',
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--nx-text)',
                        fontFamily: 'system-ui, sans-serif',
                      }}
                    >
                      {lt.sketchRefLoading}
                    </div>
                  )}
                  {/* F-4 후속(260808g) — 도면 뷰 정식 진입점(쉘 공통): 실측상
                      기존 진입은 스케치 모드 한정 토글(레거시 LeftPanel — 쉘 v2
                      에선 0폭)과 PDF 내보내기 우회뿐이었다. 중앙 뷰포트에
                      플로팅 토글을 상시 제공(비스케치·형상 있음일 때). */}
                  {!isSketchMode && effectiveResult && (
                    <button
                      data-testid="drawing-view-toggle"
                      onClick={() => setSketchViewMode(sketchViewMode === 'drawing' ? '3d' : 'drawing')}
                      title={sketchViewMode === 'drawing' ? '3D' : '2D Drawing'}
                      style={{
                        position: 'absolute', top: 10, right: 12, zIndex: 30,
                        padding: '5px 12px', borderRadius: 6,
                        border: `1px solid ${sketchViewMode === 'drawing' ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
                        background: sketchViewMode === 'drawing' ? 'var(--nx-bg)' : 'var(--nx-panel-2)',
                        color: sketchViewMode === 'drawing' ? 'var(--nx-accent-2)' : 'var(--nx-text)',
                        fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      }}
                    >
                      {sketchViewMode === 'drawing' ? '⬒ 3D' : '📐 2D'}
                    </button>
                  )}
                  <div key={sketchViewMode === 'drawing' ? 'draw' : isSketchMode ? 'sketch2d' : '3d'} style={{ animation: 'fade-in-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards', width: '100%', height: '100%' }}>
                    {sketchViewMode === 'drawing' ? (
                    <DrawingView result={sketchResult || effectiveResult} unitSystem={unitSystem} partName={drawingTitlePartName || selectedId} material={materialKey} projectViews={projectViewsWorker} />
                  ) : isSketchMode ? (
                    sketchViewMode === '3d' ? (
                    <Sketch3DCanvas
                      profile={sketchProfile}
                      onProfileChange={setSketchProfile}
                      activeTool={sketchTool}
                      sketchPlane={sketchPlane}
                      onUndo={handleSketchUndo}
                      onPlaneChange={setSketchPlane}
                      extrudeDepth={sketchConfig.depth ?? 50}
                      onExtrudeDepthChange={(d) => setSketchConfig({ ...sketchConfig, depth: d })}
                    />
                  ) : (
                    <SketchCanvas
                      profile={sketchProfiles[activeProfileIdx] ?? sketchProfile}
                      onProfileChange={(p) => {
                        captureSketchSnapshot();
                        setSketchProfiles(prev => prev.map((x, i) => i === activeProfileIdx ? p : x));
                        setSketchProfile(p);
                      }}
                      // Drag-solve gesture: ONE undo snapshot at drag start,
                      // then per-frame live updates that bypass the snapshot
                      // (otherwise every mousemove would spam the undo stack).
                      onPointDragStart={captureSketchSnapshot}
                      onProfileChangeLive={(p) => {
                        setSketchProfiles(prev => prev.map((x, i) => i === activeProfileIdx ? p : x));
                        setSketchProfile(p);
                      }}
                      activeTool={sketchTool}
                      width={sketchSize.width}
                      height={sketchSize.height}
                      onUndo={handleSketchUndo}
                      constraints={sketchConstraints}
                      dimensions={sketchDimensions}
                      onAddConstraint={handleAddConstraint}
                      onRemoveConstraint={handleRemoveConstraint}
                      onAddDimension={handleAddDimension}
                      selectedConstraintType={selectedConstraintType}
                      otherProfiles={sketchProfiles.filter((_, i) => i !== activeProfileIdx)}
                      otherProfileSketchIndices={sketchProfiles.map((_, i) => i).filter(i => i !== activeProfileIdx)}
                      onSelectSketchProfileIndex={handleSetActiveProfile}
                      onAddClosedLoopAsNewProfile={handleAddClosedLoopAsNewProfile}
                      onToolChange={setSketchTool}
                      lang={lang}
                      ellipseRx={sketchConfig.ellipseRx ?? 25}
                      ellipseRy={sketchConfig.ellipseRy ?? 15}
                      slotRadius={sketchConfig.slotRadius ?? 10}
                      filletRadius={sketchConfig.filletRadius ?? 5}
                      paletteGridVisible={sketchPalGrid}
                      onPaletteGridChange={setSketchPalGrid}
                      paletteSnapEnabled={sketchPalSnap}
                      onPaletteSnapChange={setSketchPalSnap}
                      hideFloatingControlBar
                      showConstraintOverlay={sketchPalConst}
                      showDimensionOverlay={sketchPalDims}
                      referenceImage={sketchRefImage}
                      sliceGuideActive={sketchPalSlice}
                      sliceGuidePlaneMm={sketchSlicePlaneMm}
                      sketchLineStyle={sketchLineStyle}
                      lookAtNonce={sketchLookAtNonce}
                      pickFilter={sketchPickFilter}
                      sweepPathPoints={sketchConfig.sweepPath?.points ?? []}
                      onSweepPathChange={(pts) => setSketchConfig({
                        ...sketchConfig,
                        sweepPath: pts.length > 0 ? { points: pts, steps: sketchConfig.sweepPath?.steps ?? 32 } : undefined,
                      })}
                      onSelectedEntityChange={bridgeSketchSelectedEntity}
                    />
                  )) : null}
                  </div>

                  {isSketchMode && sketchViewMode === '2d' && (
                    <SketchPalette
                      lang={lang}
                      gridVisible={sketchPalGrid}
                      snapEnabled={sketchPalSnap}
                      showDimensions={sketchPalDims}
                      showConstraints={sketchPalConst}
                      sliceEnabled={sketchPalSlice}
                      profileHighlight={sketchPalProfile}
                      hasReferenceImage={!!sketchRefImage}
                      referenceOpacity={sketchRefImage?.opacity ?? 0.35}
                      referenceScale={sketchRefImage?.scale ?? 1}
                      referenceOffsetX={sketchRefImage?.offsetX ?? 0}
                      referenceOffsetY={sketchRefImage?.offsetY ?? 0}
                      referenceLocked={sketchRefImage?.locked ?? false}
                      slicePlaneMm={sketchSlicePlaneMm}
                      onGridChange={setSketchPalGrid}
                      onSnapChange={setSketchPalSnap}
                      onDimensionsChange={setSketchPalDims}
                      onConstraintsChange={setSketchPalConst}
                      onSliceChange={setSketchPalSlice}
                      onSlicePlaneMmChange={setSketchSlicePlaneMm}
                      onProfileHighlightChange={setSketchPalProfile}
                      onInsertReference={() => sketchRefInputRef.current?.click()}
                      onClearReference={clearSketchRef}
                      onReferenceOpacityChange={(op) => {
                        setSketchRefImage(prev => (prev ? { ...prev, opacity: op } : null));
                      }}
                      onReferenceScaleChange={(sc) => {
                        setSketchRefImage(prev => (prev ? { ...prev, scale: sc } : null));
                      }}
                      onReferenceOffsetChange={(ox, oy) => {
                        setSketchRefImage(prev => (prev ? { ...prev, offsetX: ox, offsetY: oy } : null));
                      }}
                      onReferenceLockedChange={(lk) => {
                        setSketchRefImage(prev => (prev ? { ...prev, locked: lk } : null));
                      }}
                      onFinishSketch={handleSketchGenerate}
                      onExitSketch={() => setIsSketchMode(false)}
                      onOpen3dSketch={() => setSketchViewMode('3d')}
                      lightRibbonChrome={ribbonTheme === 'lightRibbon'}
                      onLightRibbonChromeChange={(v) => setRibbonTheme(v ? 'lightRibbon' : 'dark')}
                      sketchLineStyle={sketchLineStyle}
                      onSketchLineStyleChange={setSketchLineStyle}
                      onLookAtSketch={() => setSketchLookAtNonce(n => n + 1)}
                    />
                  )}

                  {/* First-use sketch hint — auto-modal retired (2026-06-09):
                      it popped over the canvas on entry, adding to the on-entry
                      overlay pile. visible={false} so it never auto-shows; the
                      Draw ribbon + tool tooltips guide instead. */}
                  {isSketchMode && sketchViewMode === '2d' && (
                    <SketchContextTip visible={false} lang={lang} recoveryVisible={showRecovery && !!recoveryData} />
                  )}

                  {showMainWorkspacePreview && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      zIndex: 5,
                      minHeight: 0,
                      display: 'flex',
                      flexDirection: 'column',
                    }}>
                      {renderWorkspaceShapePreview('main')}
                      {/* Gizmo / dimension lines / DFM badges over the MAIN-slot
                          model. Without this they rendered only over the (empty)
                          right column placeholder and visually leaked into the
                          gap between the viewport and the inspector. (2026-06-09) */}
                      <CanvasGizmoOverlays
                        visible={!!effectiveResult && !isSketchMode}
                        lang={lang}
                        shapeId={selectedId}
                        params={params}
                        paramDefs={selectedId ? (SHAPE_MAP[selectedId]?.params ?? []) : []}
                        labelDict={t as unknown as Record<string, string>}
                        onParamChange={_handleParamChangeCmd}
                        bbox={effectiveResult?.bbox ?? null}
                        dfmResults={dfmResults}
                        downgradeNotices={
                          effectiveResult?.geometry ? collectDowngrades(effectiveResult.geometry) : []
                        }
                      />
                      {/* Presence sidebar — hidden when alone in the room. */}
                      <AwarenessPresencePanel
                        presences={awarenessPresences}
                        localClientId={crdtBridge.doc.doc.clientID}
                        localName={authUserRef.current?.name}
                      />
                    </div>
                  )}
                </div>

                {/* ── Enhanced Extrude Action Menu (shown when sketch profile is closed) ── */}
                {isSketchMode && (sketchProfiles[activeProfileIdx] ?? sketchProfile).segments.length > 0 && (sketchProfiles[activeProfileIdx] ?? sketchProfile).closed && showSketchActionMenu && (
                  <>
                    <div style={{
                      position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
                      zIndex: 40,
                      background: 'rgba(22,27,34,0.97)',
                      backdropFilter: 'blur(12px)',
                      border: '1px solid var(--nx-border)',
                      borderRadius: 14,
                      padding: '16px 20px',
                      display: 'flex', flexDirection: 'column', gap: 12,
                      minWidth: 280,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                      transition: 'opacity 0.2s, transform 0.2s' }}>
                      {/* Depth slider */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ color: 'var(--nx-text-2)', fontSize: 11, whiteSpace: 'nowrap' }}>
                          {lt.depthMm}
                        </span>
                        <input
                          type="range"
                          min={10} max={200} step={1}
                          value={sketchConfig.depth ?? 50}
                          onChange={e => setSketchConfig({ ...sketchConfig, depth: Number(e.target.value) })}
                          style={{ flex: 1, accentColor: 'var(--nx-accent)' }}
                        />
                        <span style={{ color: 'var(--nx-text)', fontSize: 12, fontWeight: 700, minWidth: 32, textAlign: 'right', fontFamily: 'monospace' }}>
                          {sketchConfig.depth ?? 50}
                        </span>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          data-tour="extrude-cta"
                          onClick={handleSketchGenerate}
                          style={{
                            flex: 2,
                            padding: '10px 16px', borderRadius: 8,
                            background: 'linear-gradient(135deg, var(--nx-accent), #8b5cf6)',
                            border: 'none', color: 'var(--nx-text)', fontSize: 13, fontWeight: 700,
                            cursor: 'pointer',
                            animation: 'nf-extrude-pulse 2s ease-in-out infinite',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="3" y1="17" x2="15" y2="17"/>
                          </svg>
                          {lt.extrude}
                        </button>
                        <button
                          onClick={() => {
                            setSketchConfig({ ...sketchConfig, mode: 'revolve' });
                            setTimeout(() => handleSketchGenerate(), 0);
                          }}
                          style={{
                            flex: 1,
                            padding: '10px 10px', borderRadius: 8,
                            background: 'var(--nx-panel-2)',
                            border: '1px solid var(--nx-border)', color: 'var(--nx-text)', fontSize: 12, fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a10 10 0 1 0 10 10"/><polyline points="22 2 22 12 12 12"/>
                          </svg>
                          {lt.revolve}
                        </button>
                        <button
                          onClick={() => setShowSketchActionMenu(false)}
                          style={{
                            flex: 1,
                            padding: '10px 10px', borderRadius: 8,
                            background: 'var(--nx-panel-2)',
                            border: '1px solid var(--nx-border)', color: 'var(--nx-text-2)', fontSize: 12, fontWeight: 600,
                            cursor: 'pointer' }}
                        >
                          {lt.continueEditing}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Extrude hint when sketch has open (non-closed) segments */}
                {isSketchMode && (sketchProfiles[activeProfileIdx] ?? sketchProfile).segments.length > 0 && !(sketchProfiles[activeProfileIdx] ?? sketchProfile).closed && (
                  <div style={{
                    position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
                    zIndex: 40 }}>
                    <span style={{
                      background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
                      borderRadius: 6, padding: '5px 14px', color: 'var(--nx-text-2)', fontSize: 11,
                      fontFamily: 'system-ui, sans-serif' }}>
                      {lt.sketchClickHint}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* ── 3D Preview toggle button (shown when hidden) ── */}
            {activeTab === 'design' && !isMobile && !show3DPreview && !showMainWorkspacePreview && (
              <button
                onClick={() => setShow3DPreview(true)}
                title={lt.show3dPreview}
                style={{
                  position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                  zIndex: 30, padding: '10px 7px', borderRadius: 8,
                  background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
                  color: 'var(--nx-text-2)', fontSize: 11, cursor: 'pointer',
                  writingMode: 'vertical-rl', fontWeight: 700, letterSpacing: '0.02em',
                  transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-border)'; e.currentTarget.style.color = 'var(--nx-text)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--nx-panel-2)'; e.currentTarget.style.color = 'var(--nx-text-2)'; }}
              >
                ◀ {lang === 'ko' ? '3D 미리보기' : '3D preview'}
              </button>
            )}

            {/* ── 3D Preview side (right panel) ──
                 Hidden when the model already fills the MAIN column
                 (showMainWorkspacePreview) — otherwise this fixed-width panel
                 showed only a "3D is in the main area" placeholder + leaked
                 gizmo overlays, wasting ~half the viewport. (2026-06-09) */}
            {activeTab === 'design' && show3DPreview && !showMainWorkspacePreview && (
              <div style={{
                width: isMobile ? '100%' : designPreviewWidth,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                background: 'var(--nx-bg)',
                position: 'relative' }}>
              {!isMobile && (
                <SidebarResizer
                  edge="left"
                  width={designPreviewWidth}
                  onResize={handleDesignPreviewResize}
                />
              )}
              {/* Reserve space so floating buttons do not cover ShapePreview’s own title bar */}
              <div style={{ height: 40, flexShrink: 0 }} aria-hidden />
              {/* Top chrome: hide + assembly + part placement (single row, no overlap with ShapePreview title) */}
              <div style={{
                position: 'absolute',
                top: 8,
                left: 8,
                right: isSketchMode && liveSketchResult ? 56 : 8,
                zIndex: 30,
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 8,
                pointerEvents: 'none',
              }}>
                <button
                  type="button"
                  onClick={() => setShow3DPreview(false)}
                  title={lt.hide3dPreview}
                  style={{
                    pointerEvents: 'auto',
                    padding: '3px 8px', borderRadius: 5,
                    background: 'rgba(33,38,45,0.85)', border: '1px solid var(--nx-border)',
                    color: 'var(--nx-text-3)', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--nx-text)'; }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'var(--nx-text-3)'; }}
                >
                  ◀ {lt.hideLabel}
                </button>
                {bomParts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setShowAssemblyPanel(!showAssemblyPanel)}
                    title={lt.assemblyTools}
                    style={{
                      pointerEvents: 'auto',
                      padding: '4px 10px', borderRadius: 6,
                      border: '1px solid var(--nx-border)',
                      background: showAssemblyPanel ? 'var(--nx-accent)' : 'var(--nx-panel-2)',
                      color: showAssemblyPanel ? 'var(--nx-text)' : 'var(--nx-text-2)',
                      fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      fontFamily: 'system-ui, sans-serif',
                      transition: 'all 0.15s',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {lt.assemblyShort}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowPartPlacement(s => !s)}
                  title={lt.partPlacement}
                  style={{
                    pointerEvents: 'auto',
                    padding: '4px 10px', borderRadius: 6,
                    border: '1px solid var(--nx-border)',
                    background: showPartPlacement ? 'var(--nx-accent)' : 'var(--nx-panel-2)',
                    color: showPartPlacement ? 'var(--nx-text)' : 'var(--nx-text-2)',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'system-ui, sans-serif',
                    transition: 'all 0.15s',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {`⊞ ${lt.partsLabel}${placedParts.length > 0 ? ` (${placedParts.length})` : ''}`}
                </button>
              </div>
              {/* Live preview badge (Feature 5) */}
              {isSketchMode && liveSketchResult && (
                <div style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 30,
                  padding: '2px 8px', borderRadius: 4,
                  background: 'rgba(94, 234, 212, 0.15)', border: '1px solid rgba(94, 234, 212, 0.45)',
                  color: 'var(--nx-ok)', fontSize: 10, fontWeight: 700,
                  fontFamily: 'monospace', letterSpacing: '0.08em',
                  pointerEvents: 'none' }}>
                  LIVE
                </div>
              )}
                {/* Bounding box center coordinate display */}
              {(liveSketchResult ?? effectiveResult) && (() => {
                const res = liveSketchResult ?? effectiveResult!;
                return (
                  <div style={{
                    position: 'absolute', bottom: 8, left: 0, right: 0, zIndex: 20,
                    display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{
                      background: 'var(--nx-glass-strong)', border: '1px solid var(--nx-panel-2)',
                      padding: '3px 12px', borderRadius: 6,
                      fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
                      display: 'flex', gap: 8, alignItems: 'center', color: 'var(--nx-border-strong)' }}>
                      <span style={{ color: 'var(--nx-text-3)' }}>Center:</span>
                      <span style={{ color: 'var(--nx-error)' }}>X</span><span style={{ color: 'var(--nx-text)' }}>{(res.bbox.w / 2).toFixed(1)}</span>
                      <span style={{ color: 'var(--nx-ok)' }}>Y</span><span style={{ color: 'var(--nx-text)' }}>{(res.bbox.h / 2).toFixed(1)}</span>
                      <span style={{ color: 'var(--nx-accent)' }}>Z</span><span style={{ color: 'var(--nx-text)' }}>{(res.bbox.d / 2).toFixed(1)}</span>
                      <span>mm</span>
                    </div>
                  </div>
                );
              })()}
              {collabUsers.length > 0 && (
                  <CollabPresence users={collabUsers} />
                )}
                <div style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                {/* ═══ AI Assistant — replaces 3D viewport when active ═══ */}
                {showAIAssistant && !isMobile ? (
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'rgba(13, 17, 23, 0.95)',
                    backdropFilter: 'blur(16px)',
                    animation: 'aiViewportFadeIn 0.25s ease-out',
                    overflow: 'hidden',
                  }}>
                    <AIAssistantSidebar
                      lang={lang}
                      t={shapeLabels}
                      theme={{ border: theme.border, panelBg: theme.panelBg, text: theme.text }}
                      isTablet={isTablet}
                      designContext={designContext}
                      activeTab={activeTab}
                      pendingChatMsg={pendingChatMsg}
                      isPreviewMode={isPreviewMode}
                      isSketchMode={isSketchMode}
                      effectiveResult={effectiveResult}
                      selectedId={selectedId}
                      onChatApplySingle={handleChatApplySingle}
                      onChatApplyBom={handleChatApplyBom}
                      onBomPreview={handleBomPreview}
                      onChatApplySketch={handleChatApplySketch}
                      onChatApplyOptimize={handleChatApplyOptimize}
                      onChatApplyModify={handleChatApplyModify}
                      onModifyAutoApplied={handleModifyAutoApplied}
                      chatHistory={chatHistory}
                      onChatHistoryChange={setChatHistory}
                      onAiPreview={handleAiPreview}
                      onCancelPreview={handleCancelPreview}
                      advisorShape={selectedId ?? ''}
                      advisorParams={params}
                      advisorMaterial={materialId}
                      onApplyDimension={(param, value) => setParam(param, value)}
                      dfmResults={dfmResults}
                      materialId={materialId}
                      onTextToCAD={handleTextToCAD}
                      layoutWidth={undefined}
                      overlay={false}
                      side={'right'}
                    />
                    <style>{`
                      @keyframes aiViewportFadeIn {
                        from { opacity: 0; transform: scale(0.98); }
                        to { opacity: 1; transform: scale(1); }
                      }
                    `}</style>
                  </div>
                ) : !webglSupported ? (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flex: 1, minHeight: 0, background: 'var(--nx-bg)', color: 'var(--nx-text)',
                    flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center' }}>
                    <div style={{ fontSize: 48 }}>⚠️</div>
                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>WebGL Not Supported</h3>
                    <p style={{ margin: 0, fontSize: 14, color: 'var(--nx-text-2)', maxWidth: 400 }}>
                      Your browser does not support WebGL, which is required for the 3D modeler.
                      Please try Chrome, Firefox, or Edge with hardware acceleration enabled.
                    </p>
                  </div>
                ) : multiView ? (
                  <div style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
                    <MultiViewport
                      result={effectiveResult}
                      bomParts={bomParts.length > 0 ? bomParts : undefined}
                      sectionActive={sectionActive}
                      sectionAxis={sectionAxis}
                      sectionOffset={sectionOffset}
                      snapGrid={snapEnabled ? snapSize : undefined}
                      explodeFactor={explodeFactor}
                    />
                  </div>
                ) : showMainWorkspacePreview ? (
                  <div style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 10,
                    padding: 24,
                    color: 'var(--nx-text-2)',
                    fontSize: 13,
                    textAlign: 'center',
                    lineHeight: 1.5,
                  }}>
                    {lt.viewportPreviewInMain}
                  </div>
                ) : renderWorkspaceShapePreview('right')}
                </div>
                {/* Face/Edge Selection Info Badge */}
                <SelectionInfoBadge
                  info={selectedElement}
                  onClose={() => { setSelectedElement(null); setSelectionActive(false); }}
                  onSendToChat={(info, actionHint) => {
                    if (actionHint === 'mate_start' && info.type === 'face') {
                      setMateFaceA(info as import('./editing/selectionInfo').FaceSelectionInfo);
                      addToast(
                        'info',
                        (lt as { mateSelectSecondFace?: string }).mateSelectSecondFace
                          ?? 'Pick a second face on a different part to mate to. (Esc cancels)',
                      );
                      setSelectedElement(null);
                      return;
                    }
                    const baseMsg =
                      info.type === 'face'
                        ? lt.selectedFaceMsg(
                            info.normalLabel,
                            info.area.toFixed(1),
                            info.normal.map((n: number) => n.toFixed(2)).join(', '),
                          )
                        : info.type === 'edge'
                        ? lt.selectedEdgeMsg(
                            info.length?.toFixed(1) ?? '?',
                            info.position.map(p => p.toFixed(1)).join(', '),
                          )
                        : `Multi-face selection (${info.faces.length} faces, ${info.totalArea.toFixed(1)} mm²)`;
                    const msg = actionHint ? `${baseMsg} ${actionHint}` : `${baseMsg} ${lt.useThisFaceAsBase}`;
                    setPendingChatMsg(msg);
                    openAIAssistant('chat');
                    setSelectedElement(null);
                    setSelectionActive(false);
                  }}
                />
                {/* Mate Picker Overlay — Phase F click-to-mate.
                    Auto-mounts when `pendingMate` is set (after the user picks
                    the second face on a different part). Apply commits via
                    the same onMateCreated callback the auto-flow used. */}
                <MatePickerOverlay
                  pending={pendingMate}
                  labels={{
                    title: (lt as { matePickerTitle?: string }).matePickerTitle ?? 'Choose Mate Type',
                    apply: (lt as { matePickerApply?: string }).matePickerApply ?? 'Apply',
                    cancel: (lt as { matePickerCancel?: string }).matePickerCancel ?? 'Cancel',
                    suggested: (lt as { matePickerSuggested?: string }).matePickerSuggested ?? 'Suggested',
                    flipHint: (lt as { matePickerFlipHint?: string }).matePickerFlipHint
                      ?? 'Both faces point the same way — Coincident may flip one part.',
                    type: {
                      coincident: lt.mateCoincident ?? 'Coincident',
                      concentric: lt.mateConcentric ?? 'Concentric',
                      distance:   lt.mateDistance   ?? 'Distance',
                      parallel:   (lt as { mateParallel?: string }).mateParallel ?? 'Parallel',
                    },
                  }}
                  onApply={canvasCommitPendingMate}
                  onCancel={canvasCancelPendingMate}
                />
                {/* Canvas gizmo overlays (gizmo + dimension lines + DFM badges).
                    Suppressed in main-slot mode — there a duplicate set renders
                    over the actual model (see showMainWorkspacePreview block);
                    keeping this one on would leak the overlays into the empty
                    right-column placeholder. (2026-06-09) */}
                <CanvasGizmoOverlays
                  visible={!!effectiveResult && !isSketchMode && !showMainWorkspacePreview}
                  lang={lang}
                  shapeId={selectedId}
                  params={params}
                  paramDefs={selectedId ? (SHAPE_MAP[selectedId]?.params ?? []) : []}
                  labelDict={t as unknown as Record<string, string>}
                  onParamChange={_handleParamChangeCmd}
                  bbox={effectiveResult?.bbox ?? null}
                  dfmResults={dfmResults}
                  downgradeNotices={
                    effectiveResult?.geometry ? collectDowngrades(effectiveResult.geometry) : []
                  }
                />
                {/* Manufacturing Ready Card */}
                {showManufacturingCard && effectiveResult && (
                  <ManufacturingReadyCard
                    result={effectiveResult}
                    materialId={materialId}
                    quantity={1}
                    lang={lang}
                    dfmResults={dfmResults}
                    onClose={() => setShowManufacturingCard(false)}
                    onDetailAnalysis={() => {
                      setShowDFM(true);
                      setShowMassProps(true);
                      openAIAssistant('suggestions');
                    }}
                    onRequestQuote={() => void handleGetQuote()}
                    onOptimize={() => handleSetActiveTab('optimize')}
                  />
                )}
              </div>
            )}

            {/* ── Optimize tab: full-width GenDesignViewer ── */}
            {activeTab === 'optimize' && (
              <div
                ref={sketchContainerRef}
                style={{ flex: 1, position: 'relative', touchAction: 'none' }}
                onMouseDown={(e) => { if (e.button === 2) rightMouseDownPos.current = { x: e.clientX, y: e.clientY }; }}
                onContextMenu={handleContextMenu}
                {...touchGestureHandlers}
                onMouseMove={collabConnected ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                  const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
                  collabSendCursor({ x: nx * 30, y: ny * 20, z: 0 });
                } : undefined}
              >
                {!isReadOnly && !resultMesh && (
                  <div
                    role="status"
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      right: 8,
                      zIndex: 30,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'rgba(22,27,34,0.94)',
                      border: '1px solid var(--nx-border)',
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--nx-text)',
                      lineHeight: 1.45,
                      pointerEvents: 'none',
                    }}
                  >
                    💡 {lt.optimizeEmptyNeedMesh}
                  </div>
                )}
                <GenDesignViewer
                  dimX={dimX} dimY={dimY} dimZ={dimZ}
                  nx={RESOLUTION_MAP[resolution].nx}
                  ny={RESOLUTION_MAP[resolution].ny}
                  nz={RESOLUTION_MAP[resolution].nz}
                  fixedFaces={fixedFaces} loads={loads}
                  selectionMode={selectionMode} onFaceClick={handleFaceClick}
                  resultMesh={resultMesh} isOptimizing={isOptimizing} progress={progress}
                  lang={lang}
                />
              </div>
            )}
          </div></ErrorBoundary>

          {/* Floating Property Dialog for Parameters */}
          {(() => {
            if (!featureHistory.editingNodeId) return null;
            const editingNode = featureHistory.nodes.find(n => n.id === featureHistory.editingNodeId);
            if (!editingNode || !editingNode.featureType) return null;
            const editingDef = getFeatureDefinition(editingNode.featureType);
            const isSketchExtrudeNode = editingNode.featureType === 'sketchExtrude';
            // sketchExtrude has no FEATURE_MAP definition — render a dedicated
            // depth editor (below) instead of bailing with a blank panel.
            if (!editingDef && !isSketchExtrudeNode) return null;
            return (
              <div style={{
                position: 'absolute', top: 120, right: 24, width: 320, zIndex: 100,
                background: 'rgba(255,255,255,0.95)', border: '1px solid #d0d7de',
                borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden', backdropFilter: 'blur(10px)',
              }}>
                <div style={{ padding: '8px 12px', background: 'var(--nx-panel-2)', borderBottom: '1px solid #d0d7de', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--nx-text)' }}>Edit {editingNode.label || editingDef?.type || 'Sketch extrude'}</span>
                  <button onClick={() => finishEditing?.()} style={{ background: 'transparent', border: 'none', color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                </div>
                <div style={{ padding: '12px', maxHeight: '60vh', overflowY: 'auto' }} className="nf-scroll">
                  {isSketchExtrudeNode ? (() => {
                    // Depth editor for AI/manual sketch-extrude features (no FEATURE_MAP
                    // def). Writing sketchData.config.depth via updateNode triggers the
                    // same recompute path as normal param edits → the solid re-extrudes.
                    const sd = editingNode.sketchData;
                    const depth = sd?.config?.depth ?? 50;
                    const ko = lang === 'ko';
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                          {ko ? '돌출 깊이 (mm)' : 'Extrude depth (mm)'}
                          <input
                            type="number" min={0.1} step={1} value={depth}
                            onChange={(e) => {
                              const v = Math.max(0.1, Number(e.target.value) || depth);
                              if (sd) updateNode(editingNode.id, { sketchData: { ...sd, config: { ...sd.config, depth: v } }, error: undefined });
                            }}
                            style={{ padding: 6, fontSize: 13, border: '1px solid var(--nx-border)', borderRadius: 4 }}
                          />
                        </label>
                        <div style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
                          {ko ? '평면' : 'Plane'}: {sd?.plane ?? 'xy'} · {ko ? '작업' : 'Op'}: {sd?.operation ?? 'add'}
                        </div>
                      </div>
                    );
                  })() : editingDef ? (
                    <FeatureParams
                      instance={{ id: editingNode.id, type: editingNode.featureType, params: editingNode.params, paramExpressions: editingNode.paramExpressions, enabled: editingNode.enabled, error: editingNode.error }}
                      definition={editingDef}
                      t={shapeLabels}
                      onParamChange={(id, key, value) => updateFeatureParamCmd(id, key, value)}
                      expressions={editingNode.paramExpressions}
                      variables={featureExprScope}
                      onExpressionCommit={setFeatureParamExpressionCmd}
                      lang={lang}
                    />
                  ) : null}
                </div>
                <div style={{ padding: '8px 12px', background: 'var(--nx-panel-2)', borderTop: '1px solid #d0d7de', display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={() => finishEditing?.()} style={{ padding: '6px 16px', borderRadius: 6, border: '1px solid var(--nx-border)', background: 'var(--nx-accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>OK</button>
                </div>
              </div>
            );
          })()}

          {/* Timeline bar */}
          {activeTab === 'design' && features.length > 0 && (
            <TimelineBar
              features={features}
              selectedId={selectedFeatureId}
              onSelect={setSelectedFeatureId}
              onToggle={toggleFeatureCmd}
              onMoveFeature={handleMoveFeatureByIds}
              onEditFeature={(id) => {
                const f = features.find(x => x.id === id);
                if (f?.type === 'sketch') {
                  handleEditSketchFeature(id);
                } else {
                  // Double-click on a non-sketch feature in the timeline:
                  // (1) select it so PropertyManager binds to the right feature,
                  // (2) mark editing in feature-stack state (drives row highlight),
                  // (3) pop the PropertyManager. Previously only step 2 happened —
                  // the user had to click the parameter pencil icon separately,
                  // which broke Fusion-style double-click-to-edit muscle memory.
                  setSelectedFeatureId(id);
                  startEditing(id);
                  setShowPropertyManager(true);
                }
              }}
              onDeleteFeature={removeNode}
              onSuppressFeature={toggleFeatureCmd}
              baseShapeName={shapeLabels[`shapeName_${selectedId}`] || selectedId}
              baseShapeIcon={SHAPE_ICONS[selectedId] || '🧊'}
              analysisProgress={
                feaWorkerLoading ? { type: 'fea', label: 'FEA', pct: 50, running: true, onCancel: cancelFea }
                : dfmWorkerLoading ? { type: 'dfm', label: 'DFM', pct: 70, running: true, onCancel: cancelDfm }
                : csgLoading ? { type: 'cam', label: 'CSG', pct: 60, running: true, onCancel: cancelCsg }
                : pipelineWorkerLoading ? { type: 'topology', label: 'Pipeline', pct: 40, running: true, onCancel: cancelPipeline }
                : interferenceLoading || interferenceWorkerHookLoading
                  ? {
                      type: 'interference',
                      label: lt.interferenceTimelineLabel,
                      pct: 55,
                      running: true,
                      onCancel: cancelInterferenceWorker,
                    }
                  : null
              }
            />
          )}

          {/* ── Status Bar (VS Code-style bottom bar) ── */}
          <StatusBar
            lang={lang}
            cursor3D={cursor3DPos}
            unitSystem={unitSystem}
            onToggleUnit={() => setUnitSystem(u => u === 'mm' ? 'inch' : 'mm')}
            selectionCount={0}
            activeTool={isSketchMode ? sketchTool : null}
            isSketchMode={isSketchMode}
            editMode={editMode}
            featureCount={features.length}
            triangleCount={effectiveResult?.geometry?.index ? effectiveResult.geometry.index.count / 3 : 0}
            snapEnabled={snapEnabled}
            onToggleSnap={() => setSnapEnabled(v => !v)}
            snapSize={snapSize}
            onSnapSizeChange={setSnapSize}
            smartSnapEnabled={smartSnapEnabled}
            onToggleSmartSnap={() => setSmartSnapEnabled(v => !v)}
            sectionActive={sectionActive}
            sectionAxis={sectionAxis}
            sectionOffset={sectionOffset}
            onSectionAxisChange={setSectionAxis}
            onSectionOffsetChange={setSectionOffset}
            isOptimizing={isOptimizing}
            progress={progress}
            onShowShortcuts={() => setShowShortcuts(true)}
            modelStats={statusBarStats}
          />
        </div>

        {/* ══════ RIGHT PANEL (extracted) ══════ */}
        <ErrorBoundary><RightPanel
          lang={lang}
          t={shapeLabels}
          effectiveResult={effectiveResult}
          geometryMetrics={geometryMetrics}
          massProperties={massProperties}
          feaTotalFaces={feaTotalFaces}
          unitSystem={unitSystem}
          assemblyMates={assemblyMates}
          interferenceResults={interferenceResults}
          interferenceLoading={interferenceLoading}
          assemblyPartNames={assemblyPartNames}
          bomPartsLength={bomParts.length}
          interferenceCheckPartCount={interferenceCheckPartCount}
          assemblyPlacedParts={placedParts}
          assemblySolverBomParts={placedParts.length >= 2 ? undefined : bodyBomParts}
          designContext={designContext}
          pendingChatMsg={pendingChatMsg}
          isPreviewMode={isPreviewMode}
          isSketchMode={isSketchMode}
          onPrintAnalyze={handlePrintAnalyze}
          printOptimization={printOptimization}
          onOptimizeOrientation={handleOptimizeOrientation}
          onApplyOptimalOrientation={handleApplyOptimalOrientation}
          onExportPrintReady={handleExportPrintReady}
          onDFMAnalyze={handleDFMAnalyze}
          onApplyDFMFix={handleApplyDFMFix}
          onAutoDraftFix={handleAutoDraftFix}
          onJumpToDFMFeature={handleJumpToDFMFeature}
          onExplainDFMIssue={handleExplainDFMIssue}
          onPreviewDFMCostDelta={handlePreviewDFMCostDelta}
          processRecommendations={processRecommendations}
          onDraftAnalyze={handleDraftAnalyze}
          onFEARunAnalysis={handleFEARunAnalysis}
          onAddGDT={handleAddGDT}
          onUpdateGDT={handleUpdateGDT}
          onRemoveGDT={handleRemoveGDT}
          onAddDimension={handleAddDimAnnotation}
          onUpdateDimension={handleUpdateDimAnnotation}
          onRemoveDimension={handleRemoveDimAnnotation}
          onApplyDimension={(param, value) => setParam(param, value)}
          onAddMate={handleAddMate}
          onRemoveMate={handleRemoveMate}
          onUpdateMate={handleUpdateMate}
          onDetectInterference={handleDetectInterference}
          onCancelInterference={cancelInterferenceWorker}
          onApplyMatesToPlacement={handleApplyMatesToPlacement}
          assemblySolverResyncNonce={assemblySolverResyncNonce}
          onGetQuote={handleGetQuote}
          onApplyArray={(pattern) => { setArrayPattern(pattern); }}
          onChatApplySingle={handleChatApplySingle}
          onChatApplyBom={handleChatApplyBom}
          onBomPreview={handleBomPreview}
          onChatApplySketch={handleChatApplySketch}
          onChatApplyOptimize={handleChatApplyOptimize}
          onChatApplyModify={handleChatApplyModify}
          onModifyAutoApplied={handleModifyAutoApplied}
          onAiPreview={handleAiPreview}
          onCancelPreview={handleCancelPreview}
          onTextToCAD={handleTextToCAD}
          chatHistory={chatHistory}
          onChatHistoryChange={setChatHistory}
          layoutWidth={sidebarLayout.rightWidth}
          collapsed={sidebarLayout.rightCollapsed}
          overlay={sidebarLayout.overlay}
          side={sidebarLayout.swapSides ? 'left' : 'right'}
          onToggleCollapse={sidebarLayout.toggleRightCollapsed}
          onResize={sidebarLayout.setRightWidth}
        /></ErrorBoundary>

      </div>

      {/* Hidden file input for scene load */}
      <input ref={sceneFileInputRef} type="file" accept=".nexyfab,.json" style={{ display: 'none' }}
        onChange={handleSceneFileSelected} />

      {/* CAM Simulation Viewer */}
      {camSimResult && (
        <CAMSimPanel
          result={camSimResult.result}
          operation={camSimResult.operation}
          lang={lang}
          onClose={() => setCamSimResult(null)}
        />
      )}

      {/* COTS Panel */}
      <COTSPanel
        open={showCOTSPanel}
        onClose={() => setShowCOTSPanel(false)}
        lang={lang}
        onInsert={(part: COTSPart) => {
          addToast('success', lt.cotsAddedToBom(lang === 'ko' ? part.nameKo : part.name));
          // Insert real (simplified) geometry into the assembly via the same
          // pipeline as the ISO standard-parts grid — was BOM-toast only.
          // (2026-06-09 P3)
          window.dispatchEvent(new CustomEvent('nexyfab:insert-standard-part', {
            detail: {
              id: part.id,
              title: lang === 'ko' ? part.nameKo : part.name,
              standard: part.standard,
              params: part.params,
              scad: cotsToScad(part),
            },
          }));
        }}
      />

      {/* Cart panel (shared) */}
      <ShapeCart items={cartItems} onRemove={removeCartItem} onClear={clearCart} onBatchQuote={handleBatchQuote} t={shapeLabels} />
      {cartItems.length > 0 && <div style={{ height: 180 }} />}

      {/* ═══ Validation Results Modal — J5: result auto-resolves from store ═══ */}
      <ValidationResultsModal
        open={!simpleMode && showValidation}
        onClose={() => setShowValidation(false)}
        labels={{
          geometryValidation: lt.geometryValidation,
          manifold: lt.manifold,
          closedMesh: lt.closedMesh,
          consistentNormals: lt.consistentNormals,
          openEdges: lt.openEdges,
          nonManifoldEdges: lt.nonManifoldEdges,
          degenerateTri: lt.degenerateTri,
          duplicateVertices: lt.duplicateVertices,
          totalTriangles: lt.totalTriangles,
          totalVertices: lt.totalVertices,
          volumeLabel: lt.volumeLabel,
          surfaceAreaLabel: lt.surfaceAreaLabel,
          issuesLabel: lt.issuesLabel,
        }}
      />

      {/* ═══ Hole Wizard Modal ═══ */}
      <HoleWizardModal
        open={showHoleWizard}
        lang={lang as 'ko' | 'en'}
        onClose={() => setShowHoleWizard(false)}
        onApply={(p) => {
          addFeatureWithParams('hole', p);
          addToast('success', lt.standardHoleAdded(p.diameter.toFixed(2)));
        }}
      />

      {/* ═══ Standard Parts Library ═══ */}
      <StandardPartsLibrary
        open={showLibrary}
        selectedStandardPart={selectedStandardPart}
        onSelect={handleSelectStandardPart}
        onClose={() => setShowLibrary(false)}
        labels={{
          standardPartsLibrary: lt.standardPartsLibrary,
          fastenersLabel: lt.fastenersLabel,
          structuralLabel: lt.structuralLabel,
          bearingsLabel: lt.bearingsLabel,
          hexBolt: lt.hexBolt,
          hexNut: lt.hexNut,
          socketHeadCapScrew: lt.socketHeadCapScrew,
          flatWasher: lt.flatWasher,
          springWasher: lt.springWasher,
          iBeam: lt.iBeam,
          angleBracket: lt.angleBracket,
          channelBeam: lt.channelBeam,
          ballBearing: lt.ballBearing,
          bushing: lt.bushing,
        }}
      />

      {/* ═══ Sketch input cluster (radial menu + context menu + file input) ═══ */}
      <SketchInputCluster
        lang={lang}
        sketchRefInputRef={sketchRefInputRef}
        onSketchRefFileChange={handleSketchRefFileChange}
        sketchRadial={sketchRadial}
        ctxMenu={ctxMenu}
        onContextSelect={handleContextSelect}
        onContextClose={handleContextClose}
      />



      {/* ═══ Modal4Dock — AR / Screenshot / FeatureGraph / Nesting ═══ */}
      <Modal4Dock
        lang={lang}
        showARViewer={showARViewer}
        setShowARViewer={setShowARViewer}
        arGeometry={effectiveResult?.geometry ?? null}
        screenshot={screenshotModal}
        setScreenshot={setScreenshotModal}
        shapeName={String(useSceneStore.getState().params.name ?? '')}
        onScreenshotDownload={(canvas) => {
          downloadScreenshot(canvas, `nexyfab-render-${Date.now()}.png`, 2);
          addToast('success', lt.screenshotSaved);
        }}
        showFeatureGraph={showFeatureGraph}
        setShowFeatureGraph={setShowFeatureGraph}
        nodes={getOrderedNodes()}
        activeNodeId={featureHistory.activeNodeId}
        onSelectNode={(id) => rollbackTo(id)}
        showNestingTool={showNestingTool}
        setShowNestingTool={setShowNestingTool}
      />

      {/* ═══ Design Variants Panel ═══ */}
      {showVariantsPanel && (
        <DesignVariantsPanel
          lang={lang as 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar'}
          variants={designVariants}
          currentShapeId={selectedId}
          currentParams={params}
          activeVariantId={activeVariantId}
          onClose={() => setShowVariantsPanel(false)}
          captureThumbnail={() => captureRef.current?.() ?? null}
          onSaveVariant={(v) => {
            setDesignVariants(prev => [...prev, v]);
            setActiveVariantId(v.id);
            addToast('success', lt.versionSaved(v.name));
          }}
          onDeleteVariant={(id) => {
            setDesignVariants(prev => prev.filter(v => v.id !== id));
            if (activeVariantId === id) setActiveVariantId(null);
          }}
          onApplyVariant={(v) => {
            if (v.shapeId !== selectedId) setSelectedId(v.shapeId);
            applySceneParamsToSetters(SHAPE_MAP[v.shapeId], v.params, {
              setParams,
              setParamExpressions,
            });
            setActiveVariantId(v.id);
            addToast('info', lt.versionApplied(v.name));
          }}
          onRenameVariant={(id, name) => {
            setDesignVariants(prev => prev.map(v => v.id === id ? { ...v, name } : v));
          }}
          onGenerateSweep={(paramKey, min, max, count) => {
            return generateLinearSweep(selectedId, params, paramKey, min, max, count);
          }}
        />
      )}

      {/* ═══ Thread/Hole Callout Panel ═══ */}
      <ThreadHoleCalloutDock
        open={showThreadHolePanel}
        lang={lang}
        threadCallouts={threadCallouts}
        holeCallouts={holeCallouts}
        setThreadCallouts={setThreadCallouts}
        setHoleCallouts={setHoleCallouts}
        onClose={() => setShowThreadHolePanel(false)}
      />

      {/* ═══ F5 — Configuration Table (Excel-style multi-config) ═══
       *  A4 (W4) — when `?configs=v2` flag is on, mount the new
       *  ConfigurationTableV2 backed by the A2/A3 runtime. The legacy
       *  panel below is the default + safety net per the master
       *  tracker (delete in W6).
       */}
      {showConfigurationTable && useConfigurationTableRuntime && configurationTableRef.current && (
        <ConfigurationTableV2
          table={configurationTableRef.current}
          features={features}
          lang={(['ko','en','ja','zh','es','ar'].includes(lang) ? lang : 'en') as 'ko'|'en'|'ja'|'zh'|'es'|'ar'}
          onMutate={() => {
            // Bump configurations state for the legacy panel + .nfab
            // serialisation path. V2 owns the runtime; the legacy list
            // gets refreshed on every mutation via toJSON().
            const snap = configurationTableRef.current?.toJSON();
            if (!snap) return;
            setConfigurations(
              snap.configs.map(c => ({
                id: c.id,
                name: c.name,
                params: Object.fromEntries(
                  Object.entries(c.expressionVars).filter(([, v]) => typeof v === 'number'),
                ) as Record<string, number>,
                featureEnabled: Object.fromEntries(
                  Object.entries(c.overrides).map(([fid, ov]) => [fid, !(ov?.suppressed === true)]),
                ),
              })),
            );
            setActiveConfigurationId(snap.activeConfigId);
          }}
          onClose={() => setShowConfigurationTable(false)}
        />
      )}
      {showConfigurationTable && !useConfigurationTableRuntime && (
        <ConfigurationTable
          configurations={configurations}
          features={features}
          activeConfigurationId={activeConfigurationId}
          onSelect={handleConfigurationSelect}
          onUpdate={(cfg) => setConfigurations(prev => prev.map(c => c.id === cfg.id ? cfg : c))}
          onAdd={() => handleConfigurationAdd(`Config ${configurations.length + 1}`)}
          onDelete={handleConfigurationDelete}
          onRename={handleConfigurationRename}
          lang={(['ko','en','ja','zh','es','ar'].includes(lang) ? lang : 'en') as 'ko'|'en'|'ja'|'zh'|'es'|'ar'}
          onClose={() => setShowConfigurationTable(false)}
        />
      )}

      {/* ═══ F7 — DRC custom rule panel ═══ */}
      <DrcPanel
        open={showDrcPanel}
        geometry={effectiveResult?.geometry ?? null}
        ruleSet={drcRuleSet}
        onRuleSetChange={setDrcRuleSet}
        lang={(['ko','en','ja','zh','es','ar'].includes(lang) ? lang : 'en') as 'ko'|'en'|'ja'|'zh'|'es'|'ar'}
        onClose={() => setShowDrcPanel(false)}
      />

      {/* ═══ F9 — PLM/ERP connector config ═══ */}
      <PlmConfigPanel
        open={showPlmConfig}
        projectName={selectedId || 'nexyfab-project'}
        bomLines={bomParts.map(bp => ({
          partNumber: bp.name,
          description: bp.name,
          quantity: 1,
          mass_g: bp.result.volume_cm3 ? bp.result.volume_cm3 * 2.7 : undefined,
          unit: 'EA',
        }))}
        lang={(['ko','en','ja','zh','es','ar'].includes(lang) ? lang : 'en') as 'ko'|'en'|'ja'|'zh'|'es'|'ar'}
        onClose={() => setShowPlmConfig(false)}
      />

      {/* ═══ K6 — Smart Fastener panel ═══ */}
      <SmartFastenerPanel
        open={showSmartFastener}
        rootPartName={selectedId || 'main'}
        features={features}
        lang={(['ko','en','ja','zh','es','ar'].includes(lang) ? lang : 'en') as 'ko'|'en'|'ja'|'zh'|'es'|'ar'}
        onClose={() => setShowSmartFastener(false)}
        onApply={(s, rows) => {
          addToast(
            'success',
            lang === 'ko'
              ? `${s.spec.name} 체결구 ${rows.length}개 BOM 추가됨`
              : `Added ${rows.length} ${s.spec.name} fastener row(s) to BOM`,
          );
          // Real BOM integration is host-side — this surfaces the rows so a
          // future PR can pipe them into bomParts or PLM (F9) directly.
        }}
      />

      {/* ═══ F1 — Sketch text → engrave panel ═══ */}
      <SketchTextPanel
        open={showSketchText}
        lang={(['ko','en','ja','zh','es','ar'].includes(lang) ? lang : 'en') as 'ko'|'en'|'ja'|'zh'|'es'|'ar'}
        onApply={(profile) => {
          // Replace the active sketch profile with the text outlines so the
          // existing extrude pipeline can engrave / emboss the result.
          setSketchProfile(profile);
        }}
        onClose={() => setShowSketchText(false)}
      />

      {/* ═══ Phase 4 panel cluster (UserParts / Timelapse / StockOptimizer) ═══ */}
      <Phase4PanelDock
        lang={lang}
        showUserPartsPanel={showUserPartsPanel}
        setShowUserPartsPanel={setShowUserPartsPanel}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
        params={params}
        setParams={setParams}
        setParamExpressions={setParamExpressions}
        showSessionTimelapse={showSessionTimelapse}
        setShowSessionTimelapse={setShowSessionTimelapse}
        showStockOptimizer={showStockOptimizer}
        setShowStockOptimizer={setShowStockOptimizer}
        captureFrame={() => captureRef.current?.() ?? null}
        onUserPartLoaded={(name) => addToast('success', lt.partLoaded(name))}
      />

      {/* ═══ Phase 5 bridges (flag-gated, minimal-invasive host wire) ═══
         All three bridges are render-trees rendered next to Phase4PanelDock
         and gated by URL search params so they're invisible unless explicitly
         opted in. Adapters use the single-body shape-generator scene model
         (one primary body, geometry = effectiveResult.geometry). */}
      {(() => {
        // Direct-edit (push/pull, dynamic fillet/chamfer, subtract, move/rotate)
        // is on by default — it's the only way to edit IMPORTED meshes (a STEP
        // import has no parametric feature tree). Disable with ?direct-edit=off.
        const directEditOn = searchParams?.get('direct-edit') !== 'off';
        const assemblyExportOn = searchParams?.get('assembly-export') === 'v1';
        const configExportOn = searchParams?.get('config-export') === 'v1';
        if (!directEditOn && !assemblyExportOn && !configExportOn) return null;

        // Phase 5l — multi-body scene resolver. The host's `bodies`
        // state (BodyEntry[]) + `bodyGeosRef` (Map<id, {geometry,
        // edgeGeometry}>) is the multi-body registry; when bodies is
        // empty the scene is single-body and we fall back to the
        // parametric `result` slot. This lets direct-edit ops (E1-E4)
        // target a specific body in a split scene + lets subtract
        // actually remove the tool body from the registry.
        const isMultiBody = bodies.length > 0;
        const sceneAdapter: DirectEditSceneAdapter = {
          getActiveBodyId: () => {
            if (isMultiBody && activeBodyId) return activeBodyId;
            return '__primary';
          },
          getTargetGeometry: (bodyId) => {
            if (bodyId === '__primary' || !isMultiBody) {
              return effectiveResultRef.current?.geometry ?? null;
            }
            return bodyGeosRef.current.get(bodyId)?.geometry ?? null;
          },
          replaceBodyGeometry: (bodyId, nextGeo) => {
            // Phase 5h + 5l — real viewport swap.
            // Multi-body branch: update bodyGeosRef + force a setBodies
            // re-render so bodyBomParts useMemo picks up the change.
            // Single-body branch (legacy): setResult swap as before.
            try {
              const newEdges = makeEdges(nextGeo, 20);
              if (isMultiBody && bodyId !== '__primary' && bodyGeosRef.current.has(bodyId)) {
                bodyGeosRef.current.set(bodyId, { geometry: nextGeo, edgeGeometry: newEdges });
                setBodies((prev) => [...prev]); // shallow-clone to trigger re-render
                addToast('info', `직접편집 → '${bodyId}' (commit-to-history로 영구화)`);
                return;
              }
              const prev = effectiveResultRef.current;
              if (!prev) return;
              setResult({ ...prev, geometry: nextGeo, edgeGeometry: newEdges });
              addToast('info', '직접편집 적용 (commit-to-history로 영구화)');
            } catch (err) {
              addToast('error', `viewport swap failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          },
          removeBodyFromScene: (bodyId) => {
            // Phase 5l — real removal. Only applies in the multi-body
            // branch (single-body has no "tool body" to remove).
            if (!isMultiBody || bodyId === '__primary') return;
            if (!bodyGeosRef.current.has(bodyId)) return;
            bodyGeosRef.current.delete(bodyId);
            setBodies((prev) => prev.filter((b) => b.id !== bodyId));
            // If the removed body was active, fall back to the first
            // remaining body (or null).
            if (activeBodyId === bodyId) {
              setActiveBodyId(bodies.find((b) => b.id !== bodyId)?.id ?? null);
            }
          },
          notify: (level, msg) => addToast(level === 'warn' ? 'warning' : level, msg),
        };

        return (
          <>
            {directEditOn && (
              <div style={{ position: 'absolute', top: 64, left: 16, zIndex: 30 }}>
                <DirectEditHostBridge lang={lang} sceneAdapter={sceneAdapter} />
              </div>
            )}
            {assemblyExportOn && (() => {
              // Real adapter: availableParts ← placedParts. Empty assembly
              // falls back to the single-body __primary placeholder so the
              // bridge still has something to walk.
              //
              // Phase 5c per-part replay: each PlacedPart has shapeId +
              // params, so we run `buildShapeResult(shapeId, params)` per
              // part to get the part-specific geometry.
              //
              // Phase 5e per-part transforms: PlacedPart.position (mm) +
              // PlacedPart.rotation (deg, XYZ Euler) → Matrix4 per part.
              // Bridge applies these to leaf nodes via partTransforms prop
              // so the exported NAUO STEP has each part placed at its
              // assembly position (not all stacked at origin).
              const realParts = placedParts.length > 0
                ? placedParts.map((p) => ({ id: p.id, label: p.name }))
                : [{ id: '__primary', label: 'Primary' }];
              const partTransforms: Record<string, Matrix4> = {};
              for (const p of placedParts) {
                const m = new Matrix4();
                const q = new Quaternion().setFromEuler(
                  new Euler(
                    (p.rotation[0] * Math.PI) / 180,
                    (p.rotation[1] * Math.PI) / 180,
                    (p.rotation[2] * Math.PI) / 180,
                    'XYZ',
                  ),
                );
                m.compose(
                  new Vector3(p.position[0], p.position[1], p.position[2]),
                  q,
                  new Vector3(1, 1, 1),
                );
                partTransforms[p.id] = m;
              }
              return (
                <div style={{ position: 'absolute', top: 64, right: 16, zIndex: 30, maxWidth: 420 }}>
                  <AssemblyExportBridge
                    lang={lang}
                    availableParts={realParts}
                    partTransforms={partTransforms}
                    resolveAssemblyMatesJson={() => {
                      // Phase 6a — bundle the live assemblyMates as a
                      // JSON manifest alongside the STEP + drawing.
                      // Empty mates list → null (no extra file). Format
                      // is the AssemblyMate[] shape verbatim — vendor
                      // CAMs can re-create the constraints by id +
                      // (partA, partB, type, faceA, faceB, value).
                      if (assemblyMates.length === 0) return null;
                      return JSON.stringify({
                        schema: 'nexyfab.assemblyMates.v1',
                        partName: selectedId || 'assembly',
                        generatedAt: new Date().toISOString(),
                        mates: assemblyMates,
                      }, null, 2);
                    }}
                    resolveAssemblyDrawing={() => {
                      // Phase 5j — generate a multi-view assembly drawing
                      // (per-part iso views + BOM) from the live placedParts.
                      // Empty assembly → null (bridge downloads bare .step).
                      if (placedParts.length === 0) return null;
                      const drawingParts: AssemblyDrawingPart[] = [];
                      for (const p of placedParts) {
                        const built = buildShapeResult(p.shapeId, p.params);
                        if (!built?.geometry) continue;
                        drawingParts.push({
                          id: p.id,
                          label: p.name || p.id,
                          qty: p.qty,
                          geometry: built.geometry,
                          transform: partTransforms[p.id],
                        });
                      }
                      if (drawingParts.length === 0) return null;
                      try {
                        // Phase 6c — derive the assembly drawing config
                        // from the user prefs (shared with the configs
                        // export branch). Assembly-specific overrides:
                        // paperSize bumped to A3 (more parts → more
                        // views), partName labelled "Assembly",
                        // perPartView 'iso' for the per-leaf miniatures.
                        const result = generateAssemblyDrawing(drawingParts, {
                          ...drawingTemplatePrefs,
                          paperSize: 'A3',
                          titleBlock: {
                            ...drawingTemplatePrefs.titleBlock,
                            partName: 'Assembly',
                            material: 'Mixed',
                          },
                          perPartView: 'iso',
                        });
                        return buildDrawingSvgString(result);
                      } catch {
                        return null;
                      }
                    }}
                    resolvePartStepText={async (partId) => {
                      const { exportToStepAsync } = await import('./io/stepExporter');
                      if (partId === '__primary') {
                        const geo = effectiveResultRef.current?.geometry;
                        return geo ? await exportToStepAsync(geo, 'Primary') : null;
                      }
                      const part = placedParts.find((p) => p.id === partId);
                      if (!part) return null;
                      const built = buildShapeResult(part.shapeId, part.params);
                      if (!built?.geometry) return null;
                      return await exportToStepAsync(built.geometry, part.name || partId);
                    }}
                    onDiagnostics={(d) => {
                      if (d.length > 0) addToast('warning', `Assembly export: ${d.length} part(s) skipped`);
                    }}
                  />
                </div>
              );
            })()}
            {configExportOn && (() => {
              // Real adapter: configs ← configurations state.
              //
              // Phase 5c per-config base shape replay:
              //   buildShapeResult(selectedId, cfg.params, cfg.paramExpressions)
              //
              // Phase 5f per-config feature suppression replay:
              //   applyFeatureEnabledMap(features, cfg.featureEnabled) →
              //   runPipeline(base.geometry, suppressed, FEATURE_MAP)
              //   → exportToStepAsync(pipelineResult.geometry, ...)
              //
              // Each config's STEP now reflects BOTH its params AND its
              // featureEnabled state. The pipeline rerun is sync (uses
              // runPipeline not runPipelineAsync) so we don't carry the
              // OCCT WASM init cost per config — features that need OCCT
              // fall back to their mesh paths via isOcctReady() checks
              // (same fallback the live viewport uses on first paint).
              const realConfigs = configurations.length > 0
                ? configurations.map((c) => ({ id: c.id, name: c.name }))
                : [{ id: 'default', name: 'default' }];
              // Phase 5i — per-config drawing SVGs alongside STEP in the
              // bundle. Default DrawingConfig template (3-view + dims +
              // centerlines) is plenty for vendor handoff; the user can
              // still open AutoDrawingPanel for finer control before the
              // next export. Geometry resolver mirrors exportConfigStep's
              // base-shape path (per-config params, no feature replay —
              // drawings are projection-based; feature suppression is
              // baked into the STEP separately and would over-clutter the
              // 2D view here).
              // Phase 6c — use user prefs (localStorage-backed) as the
              // template base; only the partName is overridden to match
              // the current selectedId so it shows in the titleBlock.
              const drawingTemplate: DrawingConfig = {
                ...drawingTemplatePrefs,
                titleBlock: {
                  ...drawingTemplatePrefs.titleBlock,
                  partName: selectedId || drawingTemplatePrefs.titleBlock.partName,
                },
              };
              const drawingsByConfigId = selectedId && configurations.length > 0
                ? generateDrawingsForConfigs({
                    configs: realConfigs,
                    resolveGeometry: (configId) => {
                      const cfg = configurations.find((c) => c.id === configId);
                      if (!cfg) return null;
                      return buildShapeResult(selectedId, cfg.params, cfg.paramExpressions)?.geometry ?? null;
                    },
                    drawingConfigTemplate: drawingTemplate,
                  }).drawingsByConfigId
                : {};
              return (
                <div style={{ position: 'absolute', bottom: 96, right: 16, zIndex: 30, maxWidth: 420 }}>
                  <ConfigurationsExportBridge
                    lang={lang}
                    partName={selectedId || 'part'}
                    configs={realConfigs}
                    resolveConfigDrawing={(id) => drawingsByConfigId[id] ?? null}
                    exportConfigStep={async (configId) => {
                      const { exportToStepAsync } = await import('./io/stepExporter');
                      // Default placeholder → current viewport geometry.
                      if (configId === 'default' && configurations.length === 0) {
                        const geo = effectiveResultRef.current?.geometry;
                        return geo ? await exportToStepAsync(geo, selectedId || 'part') : null;
                      }
                      const cfg = configurations.find((c) => c.id === configId);
                      if (!cfg || !selectedId) return null;
                      const built = buildShapeResult(selectedId, cfg.params, cfg.paramExpressions);
                      if (!built?.geometry) return null;
                      // Apply this config's feature suppression to the live
                      // featureStack, then re-run the pipeline. Falls back
                      // to base-only when features is empty.
                      let outGeo = built.geometry;
                      if (features.length > 0) {
                        const suppressed = applyFeatureEnabledMap(features, cfg.featureEnabled);
                        try {
                          const piped = runPipeline(built.geometry, suppressed, FEATURE_MAP);
                          if (piped.geometry) outGeo = piped.geometry;
                        } catch {
                          // Pipeline failure → ship base shape; the diagnostic
                          // surfaces via the existing pipeline-error toast on
                          // the live viewport.
                        }
                      }
                      return await exportToStepAsync(outGeo, `${selectedId}_${cfg.name}`);
                    }}
                    onBundleReady={(r) => {
                      const m = r.manifest as { configCount: number };
                      addToast('success', `Bundle: ${m.configCount} config(s)`);
                    }}
                  />
                </div>
              );
            })()}
          </>
        );
      })()}

      {/* ═══ Collab Reconnect Banner (Phase 3 — offline/reconnect UX) ═══ */}
      <CollabReconnectBanner
        state={collabReconnectState}
        countdown={collabReconnectCountdown}
        onRetry={() => collabManualReconnect(collabRoomId)}
        lang={lang}
      />

      {/* ═══ Toast Notifications ═══ */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />

      {/* ═══ Global async work indicator (worker spinner + cancel) ═══ */}
      <AsyncWorkIndicator
        pipelineLoading={pipelineWorkerLoading}
        dfmLoading={dfmWorkerLoading}
        feaLoading={feaWorkerLoading}
        csgLoading={csgLoading}
        cancelPipeline={cancelPipeline}
        cancelDfm={cancelDfm}
        cancelFea={cancelFea}
        cancelCsg={cancelCsg}
        labels={{
          feaRunning: lt.feaRunning,
          dfmRunning: lt.dfmRunning,
          csgRunning: lt.csgRunning,
          rebuildingGeometry: lt.rebuildingGeometry,
          cancelLabel: lt.cancelLabel,
        }}
      />

      {/* ═══ Help cluster (shortcuts help / hint overlay / context help) ═══ */}
      <HelpCluster
        lang={lang}
        showShortcuts={showShortcuts}
        setShowShortcuts={setShowShortcuts}
        contextHelp={contextHelp}
        onOpenShortcuts={() => useUIStore.getState().togglePanel('showShortcuts')}
      />

      {/* ═══ Command Palette (Ctrl+K) ═══ */}
      <CommandPalette
        visible={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        commands={paletteCommands}
        lang={lang}
        onAskAI={(prompt) => {
          setPendingChatMsg(prompt);
          openAIAssistant('chat');
        }}
      />

      {/* ═══ Status footer (auto-save indicator + OCCT toggle) ═══ */}
      <StatusFooter
        visible={viewMode === 'workspace'}
        lang={lang}
        isSaving={isSaving}
        lastSavedAt={lastSavedAt}
        saveError={saveError}
        cloudStatus={cloudStatus}
        cloudSavedAt={cloudSavedAt}
        versionConflictNeedsReload={versionConflictNeedsReload}
        onReloadForCloudConflict={reloadToFetchServerProject}
        occtMode={occtMode}
        occtInitPending={occtInitPending}
        occtInitError={occtInitError}
        setOcctMode={(v) => { void setOcctMode(v); }}
        occtToggleTitle={lt.occtEngine}
      />

      {/* ═══ Tutorial Overlay ═══ */}

      {/* ═══ SCAD agent floating panel + mode toggle ═══ */}
      {/* P3 — hide on mobile (panel is 420px wide) and in simpleMode (beginners */}
      {/* shouldn't be exposed to a Pro coding agent before they grasp the basics). */}
      {!isMobile && !simpleMode && scadAuthoringMode === 'agent' && (
        <ScadAgentPanel
          lang={lang}
          variant="floating"
          onApplyScad={handleApplyAgentScad}
          onShowBrepHandle={handleShowBrepHandle}
        />
      )}
      {/* X3 — Mobile users get a one-time banner instead, since the agent
           panel + toggle are both desktop-only. */}
      {isMobile && !simpleMode && (
        <MobileAgentNotice lang={lang} />
      )}
      {!isMobile && !simpleMode && (
        <div style={{ position: 'fixed', top: 56, right: 16, zIndex: 700 }}>
          <ScadModeToggle
            lang={lang}
            agentUnlocked={isProPlan}
            onLockedAgentClick={() => {
              promptUpgrade('AI Agent (OpenSCAD)');
            }}
          />
        </div>
      )}

      {/* ═══ Version + history + diff dock ═══ */}
      <VersionDiffDock
        lang={lang}
        theme={theme}
        simpleMode={simpleMode}
        showVersionPanel={showVersionPanel}
        setShowVersionPanel={setShowVersionPanel}
        versions={versions}
        onSaveSnapshot={handleSaveVersionSnapshot}
        onRestore={handleRestoreVersion}
        onDeleteVersion={deleteVersion}
        onRenameVersion={renameVersion}
        branches={branches}
        activeBranch={activeBranch}
        onCreateBranch={handleCreateBranch}
        onSwitchBranch={handleSwitchBranch}
        onDeleteBranch={handleDeleteBranch}
        setShowBranchCompare={setShowBranchCompare}
        setVersionDiffPair={setVersionDiffPair}
        showBranchCompare={showBranchCompare}
        onCompareBranches={compareBranches}
        onMergeBranch={handleMergeBranch}
        showHistoryPanel={showHistoryPanel}
        setShowHistoryPanel={setShowHistoryPanel}
        versionDiffPair={versionDiffPair}
        showVersionDiff={showVersionDiff}
        setShowVersionDiff={setShowVersionDiff}
        diffGeometries={diffGeometries}
      />

      {/* ═══ Auth + Model + Part Placement + Plugin/Script dock ═══ */}
      <AuthModelPlacementDock
        lang={lang}
        isKo={lang === 'ko'}
        simpleMode={simpleMode}
        showPluginManager={showPluginManager}
        setShowPluginManager={setShowPluginManager}
        showScriptPanel={showScriptPanel}
        setShowScriptPanel={setShowScriptPanel}
        showAuthModal={showAuthModal}
        setShowAuthModal={setShowAuthModal}
        authModalMode={authModalMode}
        showModelParams={showModelParams}
        modelVars={modelVars}
        setModelVars={setModelVars}
        showPartPlacement={showPartPlacement}
        placedParts={placedParts}
        setPlacedParts={setPlacedPartsTracked}
        selectedId={selectedId}
        params={params}
        setHighlightedPartId={setHighlightedPartId}
      />

      {/* ═══ Upgrade Prompt ═══ */}
      <UpgradePrompt
        open={showUpgradePrompt}
        feature={upgradeFeature}
        lang={lang}
        onClose={() => setShowUpgradePrompt(false)}
        onLogin={() => { setShowUpgradePrompt(false); setAuthModalMode('signup'); setShowAuthModal(true); }}
        // Funnel context: tag the upgrade-click as coming from the project-limit
        // paywall when this prompt was opened by triggerProjectLimitPrompt.
        // Detection key: feature label includes "프로젝트 추가" — the only place
        // that string is set is the project-limit gate.
        funnelContext={upgradeFeature.includes('프로젝트') ? 'project_limit' : undefined}
      />


      {/* ═══ F6 — Change impact confirm before destructive feature removal ═══ */}
      <ConfirmModal
        open={removeConfirm !== null}
        title={lang === 'ko' ? '피처 삭제 영향 확인' : 'Confirm feature deletion'}
        message={
          removeConfirm
            ? (lang === 'ko'
                ? `이 피처를 삭제하면 다음에 영향을 줍니다: ${removeConfirm.summary}. 진행하시겠습니까?`
                : `Deleting this feature will affect: ${removeConfirm.summary}. Continue?`)
            : ''
        }
        confirmLabel={lang === 'ko' ? '삭제' : 'Delete'}
        cancelLabel={lang === 'ko' ? '취소' : 'Cancel'}
        destructive
        onConfirm={() => {
          if (removeConfirm) performRemoveFeature(removeConfirm.featureId);
          setRemoveConfirm(null);
        }}
        onCancel={() => setRemoveConfirm(null)}
      />

      {/* ═══ Onboarding dock (tutorial / welcome / first-time tour) ═══ */}
      <OnboardingDock
        lang={lang}
        tutorial={tutorial}
        userId={authUser?.id ?? null}
        onOpenChat={() => openAIAssistant('chat')}
        // Auto-tour retired: it suppressed on a blank workspace but popped a
        // full-screen "build your first shape" modal over an ALREADY-LOADED
        // project (features.length>0). Blank entry is guided by the empty-canvas
        // cards + 5-min checklist; the tour stays available for manual replay.
        // (2026-06-09 C2)
        suppressAutoTour
      />

      {/* ═══ Split-screen + STL Export dock ═══ */}
      <SplitExportDock
        lang={lang}
        splitMode={splitMode}
        setSplitMode={setSplitMode}
        userId={authUser?.id ?? null}
        stlExportDialogOpen={stlExportDialogOpen}
        setStlExportDialogOpen={setStlExportDialogOpen}
        onExportSTL={(choice) => { void handleExportCurrentSTL(choice); }}
      />

      {/* ═══ G3: 참조 상실 재지정 패널 — 리빌드 margin-gate 거부를 액션화.
          items 가 비면 훅이 [] 를 주고 패널은 스스로 null 렌더(이중 안전). ═══ */}
      {refRelink.items.length > 0 && (
        <RefRelinkPanel
          lang={lang}
          items={refRelink.items}
          onApply={refRelink.apply}
          onClose={refRelink.dismiss}
          history={refRelink.history}
        />
      )}

      {/* ═══ Upgrade Modals (all 8 paywall dialogs) — see panels/UpgradeModalsDock.tsx ═══ */}
      <UpgradeModalsDock lang={lang} />

      {/* Phase-2 first-time UX: sample template picker, 3-step tutorial,
          floating quick-export, modeler checklist. Single orchestrator
          keeps the wiring footprint tiny. */}
      <FirstTimeOnboardingShell
        lang={lang}
        featureCount={features.length}
        hasGeometry={!!effectiveResult?.geometry}
        onAiPrompt={(prompt: string) => { void handleFreeAiPrompt(prompt); }}
        onLoadTemplate={(template: SampleTemplate) => {
          // Clear current pipeline, then enqueue each template feature
          // through the public addFeature APIs. SetTimeout 0 lets the
          // clearAll commit before features land (same pattern as
          // handleRestoreVersion).
          // Suppress transient per-feature error toasts while the bulk add races
          // ahead of the async base-geometry eval; clear the flag once the
          // pipeline has settled on the complete tree.
          templateLoadingRef.current = true;
          window.setTimeout(() => { templateLoadingRef.current = false; }, 1200);
          clearAll();
          window.setTimeout(() => {
            for (const feat of template.build()) {
              if (feat.type === 'sketchExtrude' && feat.sketchData) {
                addSketchFeature(
                  feat.sketchData.profile,
                  feat.sketchData.config,
                  feat.sketchData.plane,
                  feat.sketchData.operation,
                  feat.sketchData.planeOffset ?? 0,
                  feat.sketchData.constraints,
                  feat.sketchData.dimensions,
                );
              } else if (feat.type === 'sketch') {
                addFeature('sketch');
              } else {
                addFeatureWithParams(feat.type as FeatureType, feat.params);
              }
            }
          }, 30);
        }}
        onExportStl={() => { setStlExportDialogOpen(true); }}
      />

      {/* Manufacturing/quote CTA removed (2026-06-12): the floating
          "make it real → quote" button duplicated the quote entry already in
          DesignFunnelBar + ManufacturingPipelinePanel and crowded the
          bottom-right with the STL/AI buttons. The funnel bar (design → DFM →
          quote) is the single conversion path now. */}

      {/* Phase-2/3 floating AI shell — viewport-overlay prompt + intent
          dispatcher. promptToIntents resolves a prompt parser-first
          (nlFeatureEditParser: "add a 5mm fillet", "make it 8mm", "clear all" —
          EN + KR, instant/offline) then escalates the long tail to the
          regex→LLM /api/featureTree-intent endpoint, mapping its PlanIntent to
          feature edits (patterns, fuzzier phrasings). */}
      <AiAssistantShell
        lang={lang}
        // When a mesh has been imported there is no parametric feature tree to
        // edit, so route AI prompts through the SCAD path (handleFreeAiPrompt),
        // which wraps the import and edits it via OpenSCAD.
        scadEditActive={!!importedResult}
        onScadEdit={handleFreeAiPrompt}
        onImageGenerate={generateFromImage}
        store={{
          features,
          addFeatureWithParams: (type, params) => addFeatureWithParams(type as FeatureType, params),
          // Selection-based AI edits (offset/delete/draft a picked face,
          // fillet/chamfer a picked edge). The selection is embedded in the
          // intent by the parser; here we just forward it to the store.
          addFeatureWithParamsAndSelection: (type, params, edgeSelections, faceSelections) =>
            addFeatureWithParamsAndEdges(type as FeatureType, params, edgeSelections, faceSelections),
          // Base-shape creation from the prompt ("make a 50x50x30 box") — drives
          // the scene-store shape picker, filling registry defaults then the
          // AI-supplied params. Follow-on add_feature intents stack on top.
          setBaseShape: (shapeId, params) => {
            const sd = SHAPE_MAP[shapeId];
            if (!sd) return;
            const p: Record<string, number> = {};
            sd.params.forEach(sp => { p[sp.key] = sp.default; });
            Object.assign(p, params);
            setSelectedId(shapeId);
            setParams(p);
          },
          // Heterogeneous assembly: the AI synthesised several different parts
          // (each shapeId + params) and positioned them. Build real PlacedParts
          // (distinct per-part geometry via buildShapeResult) and show the
          // assembly panel so the composed result is visible.
          setAssemblyParts: (parts) => {
            const stamp = Date.now();
            const placed: PlacedPart[] = parts.map((p, i) => ({
              id: `aip_${stamp}_${i}`,
              name: p.name || `${p.shapeId} ${i + 1}`,
              shapeId: p.shapeId,
              params: p.params,
              qty: 1,
              position: p.position ?? [0, 0, 0],
              rotation: p.rotation ?? [0, 0, 0],
            }));
            setPlacedParts(placed);
            setShowAssemblyPanel(true);
            // Mate inference (increment 1 of auto-constraint): detect the
            // obvious relationships (fastener-through-part concentric, axial
            // gaps) and surface them. We do NOT auto-solve/reposition yet — the
            // off-axis solve needs face-topology + browser verification — but
            // the detected mates are the foundation for parametric constraint.
            try {
              const inferred = inferAssemblyMates(
                placed.map(p => ({ id: p.id, name: p.name, shapeId: p.shapeId, params: p.params, position: p.position })),
              );
              if (inferred.length > 0) {
                addToast('info', `${placed.length} parts · ${inferred.length} mate relationship(s) detected`);
              }
            } catch { /* inference is advisory — never block the assembly */ }
          },
          // Free-form sketch: the AI emits a custom 2D outline → extruded solid
          // for shapes the catalog can't express (L-brackets, stars, custom
          // profiles). Wired to the real sketch-feature path.
          addSketchFeature: (profile, config, plane, operation, planeOffset, constraints, dimensions) =>
            addSketchFeature(profile, config, plane, operation, planeOffset ?? 0, constraints, dimensions),
          // Tracked wrappers: AI-driven edits land in commandHistory too, so
          // a bad AI patch is one Ctrl+Z away from reverting.
          updateFeatureParam: updateFeatureParamCmd,
          removeFeature,
          moveFeature,
          toggleFeature: toggleFeatureCmd,
          clearAll,
        }}
        promptToIntents={async (prompt) =>
          resolveFeatureEditPrompt(prompt, features, undefined, {
            selection: useSelectionStore.getState().selectedElement,
            baseShape: selectedId,
            projectRevision: aiModelRevision,
            assemblyPath: highlightedPartId ? ['main', highlightedPartId] : ['main'],
            partInstanceId: highlightedPartId ?? undefined,
            bodyId: selectedId ?? undefined,
            featureId: selectedFeatureId ?? undefined,
          })
        }
        getCurrentRevision={() => modelContentRevision({
          shapeId: selectedId,
          params,
          features: features.map(f => ({ id: f.id, type: f.type, params: f.params, enabled: f.enabled })),
          sketch: { segments: sketchProfile.segments, closed: sketchProfile.closed },
        })}
        captureEditSnapshot={() => ({
          selectedId,
          params: { ...params },
          history: {
            nodes: featureHistory.nodes.map(node => structuredClone(node)),
            rootId: featureHistory.rootId,
            activeNodeId: featureHistory.activeNodeId,
          },
          placedParts: structuredClone(placedParts),
        })}
        restoreEditSnapshot={(rawSnapshot) => {
          const snapshot = rawSnapshot as {
            selectedId: string | null;
            params: Record<string, number>;
            history: { nodes: typeof featureHistory.nodes; rootId: string; activeNodeId: string };
            placedParts: typeof placedParts;
          };
          if (snapshot.selectedId) setSelectedId(snapshot.selectedId);
          setParams(snapshot.params);
          replaceHistory(snapshot.history.nodes, snapshot.history.rootId, snapshot.history.activeNodeId);
          setPlacedParts(snapshot.placedParts);
        }}
      />

      {/* ═══ AI Process Router Panel ═══ */}
      {showProcessRouter && (
        <ProcessRouterPanel
          metrics={geometryMetrics}
          materialId={materialId}
          lang={lang}
          projectId={currentProjectId ?? undefined}
          onClose={() => setShowProcessRouter(false)}
          onSelectProcess={(p) => {
            // Map cost-estimator ProcessType → supplier-matcher process id
            const supplierProc =
              p === 'cnc' ? 'cnc_milling' :
              p === 'fdm' || p === 'sla' || p === 'sls' ? '3d_printing' :
              p === 'injection' ? 'injection_molding' :
              p === 'sheetmetal_laser' ? 'sheet_metal' :
              'cnc_milling';
            addToast('success', lt.processMatchingSuppliers(p));
            setShowProcessRouter(false);
            setChainedSupplierProcess(supplierProc);
            // Freemium gate before opening supplier matcher
            const gate = checkFreemium('ai_supplier_match');
            if (!gate.allowed) { setShowAISupplierMatchUpgrade(true); return; }
            setShowAISupplierMatch(true);
          }}
          onRequirePro={() => setShowProcessRouterUpgrade(true)}
        />
      )}

      {/* ═══ AI Supplier Match Panel ═══ */}
      {showAISupplierMatch && (
        <AISupplierPanel
          material={materialId}
          process={chainedSupplierProcess}
          lang={lang}
          volume_cm3={geometryMetrics?.volume_cm3}
          bbox={geometryMetrics?.boundingBox}
          partName={selectedId}
          projectId={currentProjectId ?? undefined}
          onClose={() => { setShowAISupplierMatch(false); setChainedSupplierProcess(undefined); }}
          onRequirePro={() => setShowAISupplierMatchUpgrade(true)}
          onRfqSubmitted={(mfrName, qty) => {
            addToast('success', lt.rfqSent(mfrName, qty));
            setRfqDone(true);
          }}
        />
      )}

      {/* ═══ Design-for-Cost Copilot Panel ═══ */}
      {showCostCopilot && (
        <CostCopilotPanel
          params={params}
          materialId={materialId}
          process="cnc_milling"
          quantity={100}
          metrics={geometryMetrics}
          lang={lang}
          projectId={currentProjectId ?? undefined}
          onClose={() => setShowCostCopilot(false)}
          setParam={(k, v) => {
            setParam(k, v);
            setParamExpression(k, String(v));
          }}
          setMaterialId={(id) => {
            setMaterialId(id);
            addToast('success', lt.materialSwitched(id));
          }}
          onRequirePro={() => setShowCostCopilotUpgrade(true)}
          onContinueToProcessRouter={() => {
            setShowCostCopilot(false);
            const gate = checkFreemium('process_router');
            if (!gate.allowed) { setShowProcessRouterUpgrade(true); return; }
            setShowProcessRouter(true);
          }}
        />
      )}

      {/* ═══ AI History Panel ═══ */}
      {showAIHistory && (
        <AIHistoryPanel
          lang={lang}
          projectId={currentProjectId ?? undefined}
          onClose={() => setShowAIHistory(false)}
          onApplySuggestion={({ paramDeltas, materialSwap }) => {
            let appliedCount = 0;
            if (paramDeltas) {
              for (const [k, delta] of Object.entries(paramDeltas)) {
                const cur = params[k];
                if (typeof cur !== 'number' || typeof delta !== 'number') continue;
                const next = cur + delta;
                setParam(k, next);
                setParamExpression(k, String(next));
                appliedCount += 1;
              }
            }
            if (materialSwap) {
              setMaterialId(materialSwap);
              appliedCount += 1;
            }
            if (appliedCount > 0) {
              addToast('success', lt.suggestionReapplied);
            } else {
              addToast('info', lt.noApplicableChanges);
            }
          }}
        />
      )}

      {/* ═══ AI 형상 생성 (JSCAD) Panel ═══ */}
      {showOpenScad && (
        <div style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, zIndex: 120,
          background: 'var(--nx-panel)', borderLeft: '1px solid var(--nx-border)',
          display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--nx-border)', flexShrink: 0 }}>
            <span style={{ color: 'var(--nx-text)', fontWeight: 700, fontSize: 13 }}>{lt.aiShapeGenPanel}</span>
            <button
              onClick={() => setShowOpenScad(false)}
              style={{ background: 'none', border: 'none', color: 'var(--nx-text-2)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}
            >×</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <OpenScadPanel
              onGeometryReady={(geo, description) => {
                handleGeometryApply(geo);
                addToast('success', lt.aiShapeGenerated(description.slice(0, 40)));
              }}
              selectedElement={selectedElement}
              currentShape={effectiveResult ? {
                shapeId: isSketchMode ? null : selectedId,
                params: isSketchMode ? {} : { ...params },
                features: enabledFeaturesForContext,
                bbox: effectiveResult.bbox } : null}
            />
          </div>
        </div>
      )}

      {/* ═══ Manufacturer Match Modal ═══ */}
      {showManufacturerMatch && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 8000,
          background: 'var(--nx-glass-input)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          backdropFilter: 'blur(4px)' }} onClick={() => setShowManufacturerMatch(false)}>
          <div style={{ width: 560, maxHeight: '85vh', overflow: 'auto', borderRadius: 14 }}
            onClick={e => e.stopPropagation()}>
            <div style={{ background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--nx-border)' }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--nx-text)' }}>
                  🏭 {lt.selectManufacturer}
                </span>
                <button onClick={() => setShowManufacturerMatch(false)} style={{ background: 'none', border: 'none', color: 'var(--nx-text-3)', fontSize: 16, cursor: 'pointer' }}>✕</button>
              </div>
              <ManufacturerMatch
                lang={lang}
                volume_cm3={effectiveResult?.volume_cm3}
                materialId={materialId}
                bbox={effectiveResult?.bbox}
                triangleCount={effectiveResult?.geometry?.attributes.position
                  ? Math.floor(effectiveResult.geometry.attributes.position.count / 3)
                  : undefined}
                hasUndercuts={(printAnalysis?.overhangFaces.length ?? 0) > 50}
                dfmErrorCount={dfmResults
                  ? dfmResults.reduce((n, r) => n + r.issues.filter(i => i.severity === 'error').length, 0)
                  : 0}
                aiAuthored={chatHistory.length > 0}
                onSelectManufacturer={(m: Manufacturer) => {
                  setShowManufacturerMatch(false);
                  // Fire-and-forget: notify manufacturer via email
                  fetch(`/api/nexyfab/manufacturers/${m.id}/contact`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: lt.quoteRequestMessage }) })
                    .then((res) => {
                      if (!res.ok) {
                        console.warn('[Manufacturer contact] request failed:', res.status);
                        addToast('error', lt.networkError(`HTTP ${res.status}`));
                        return;
                      }
                      addToast('success', lt.quoteRequestSent(lang === 'ko' ? m.nameKo : m.name));
                      const _shapeName = sketchResult ? 'Custom Sketch' : (selectedId ?? '');
                      const _qs = new URLSearchParams({
                        open: '1',
                        ...((_shapeName) && { shapeName: _shapeName }),
                        ...(materialId && { material: materialId }),
                        ...(m.id && { factoryId: m.id }) });
                      router.push(`/${langSeg}/nexyfab/rfq?${_qs.toString()}`);
                    })
                    .catch((err: unknown) => {
                      console.error('[Manufacturer contact] network error:', err);
                      const msg = err instanceof Error ? err.message : String(err);
                      addToast('error', lt.networkError(msg));
                    });
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ═══ Comments Panel (slide-in from right) ═══ */}
      {showCommentsPanel && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 7500,
          display: 'flex', justifyContent: 'flex-end' }} onClick={() => setShowCommentsPanel(false)}>
          <div
            style={{
              width: 320, height: '100%', background: 'var(--nx-bg)',
              border: '1px solid var(--nx-panel-2)', borderRight: 'none',
              boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Panel header */}
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid var(--nx-panel-2)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--nx-text)' }}>
                {lt.collabPanel}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  onClick={() => { setShowChatPanel(false); }}
                  title={lt.pinComments}
                  style={{ background: !showChatPanel ? 'var(--nx-accent)22' : 'none', border: !showChatPanel ? '1px solid var(--nx-accent)44' : '1px solid transparent', borderRadius: 5, color: !showChatPanel ? 'var(--nx-accent)' : 'var(--nx-text-3)', fontSize: 13, cursor: 'pointer', padding: '3px 8px' }}
                >
                  📌
                </button>
                <button
                  onClick={() => { setShowChatPanel(true); }}
                  title={lt.chatLabel}
                  style={{ background: showChatPanel ? 'var(--nx-accent)22' : 'none', border: showChatPanel ? '1px solid var(--nx-accent)44' : '1px solid transparent', borderRadius: 5, color: showChatPanel ? 'var(--nx-accent)' : 'var(--nx-text-3)', fontSize: 13, cursor: 'pointer', padding: '3px 8px' }}
                >
                  💬
                </button>
                <button
                  onClick={() => setShowCommentsPanel(false)}
                  style={{ background: 'none', border: 'none', color: 'var(--nx-text-3)', fontSize: 16, cursor: 'pointer' }}
                >✕</button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {showChatPanel ? (
                <CollabChat
                  messages={chatMessages}
                  currentUserId={collabUserIdRef.current}
                  users={collabUsers}
                  typingUsers={collabTypingUsers}
                  onSend={(text) => collabSendChatMessage(text, authUser?.name ?? `User-${collabUserIdRef.current.slice(-4)}`)}
                  onTyping={() => collabSendTyping(authUser?.name ?? `User-${collabUserIdRef.current.slice(-4)}`)}
                  lang={lang}
                />
              ) : (
                <CommentsPanel
                  comments={comments}
                  isPlacingComment={isPlacingComment}
                  setIsPlacingComment={setIsPlacingComment}
                  onResolve={(id) => { resolveComment(id); addActivity({ type: 'comment_resolve', actor: authUser?.name ?? 'You' }); }}
                  onDelete={(id) => { deleteComment(id); addActivity({ type: 'comment_delete', actor: authUser?.name ?? 'You' }); }}
                  onReact={(id, emoji) => reactToComment(id, emoji, collabUserIdRef.current)}
                  onReply={(id, text) => addReply(id, text, authUser?.name ?? `User-${collabUserIdRef.current.slice(-4)}`, collabUserColorRef.current)}
                  focusedCommentId={focusedCommentId}
                  setFocusedCommentId={setFocusedCommentId}
                  activityFeed={activityFeed}
                  lang={lang}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ IP Share Confirm ═══ */}
      {showShareConfirm && shareUrl && (
        <IPShareConfirmModal
          shareUrl={shareUrl}
          onCopy={copyShareUrl}
          onClose={() => setShowShareConfirm(false)}
          onReset={resetShare}
          onCopied={() => addToast('success', lt.linkCopied)}
          labels={{
            ipProtectedShare: lt.ipProtectedShare,
            ipShareInfo: lt.ipShareInfo,
            copyLabel: lt.copyLabel,
            closeLabel: lt.closeLabel,
          }}
        />
      )}

      {/* ═══ Advanced analysis dock (Gen Design / Thermal FEA / ECAD PCB) ═══ */}
      <AdvancedAnalysisDock
        lang={lang}
        dockInsetBase={baseScadDockInsetPx}
        dockInsetGen={col1RightInset('gen')}
        effectiveResultGeometry={effectiveResult?.geometry ?? null}
        showGenDesign={showGenDesign}
        setShowGenDesign={setShowGenDesign}
        setGenDesignResult={setGenDesignResult}
        setShowGenOverlay={setShowGenOverlay}
        genDesignResult={genDesignResult}
        showGenOverlay={showGenOverlay}
        toastOptimalStructureDone={lt.optimalStructureDone}
        showThermalPanel={showThermalPanel}
        setShowThermalPanel={setShowThermalPanel}
        setThermalOverlayGeo={setThermalOverlayGeo}
        setShowThermalOverlay={setShowThermalOverlay}
        thermalOverlayGeo={thermalOverlayGeo}
        showThermalOverlay={showThermalOverlay}
        toastThermalFeaDone={lt.thermalFeaDone}
        toastPcbHeatMappingDone={lt.pcbHeatMappingDone}
        showECADPanel={showECADPanel}
        setShowECADPanel={setShowECADPanel}
        addToast={addToast}
        showOriginalLabel={lt.showOriginal}
        showPcbHeatMapLabel={lt.showPcbHeatMap}
        showOptimizedLabel={lt.showOptimized}
      />

      {/* ═══ Floating analysis dock (Topological / Motion / Modal / Tolerance / Surface / MfgPipeline) ═══ */}
      <FloatingAnalysisDock
        lang={lang}
        dockInsetForPanel={(id) => col1RightInset(id)}
        effectiveResultGeometry={effectiveResult?.geometry ?? null}
        partIds={features.map(f => f.id)}
        paramsForModal={{ x: params.width ?? 100, y: params.height ?? 100, z: params.depth ?? 100 }}
        topoMap={topoMap}
        toastModalDone={lt.modalAnalysisDone}
        toastSurfaceDone={lt.surfaceAnalysisDone}
        toastQuoteRequested={lt.quoteRequested}
        addToast={addToast}
        showMfgPipeline={showMfgPipeline}
        mfgVolumeCm3={effectiveResult ? meshVolume(effectiveResult.geometry) * 1e-3 : 0}
        mfgSurfaceAreaCm2={effectiveResult ? meshSurfaceArea(effectiveResult.geometry) * 1e-2 : 0}
        mfgMaterial={materialId}
        mfgComplexity={features.length > 5 ? 0.8 : features.length > 2 ? 0.5 : 0.3}
        showMotionStudy={showMotionStudy}
        setShowMotionStudy={setShowMotionStudy}
        setMotionPartTransforms={setMotionPartTransforms}
        showModalAnalysis={showModalAnalysis}
        setShowModalAnalysis={setShowModalAnalysis}
        showBucklingAnalysis={showBucklingAnalysis}
        setShowBucklingAnalysis={setShowBucklingAnalysis}
        showToleranceStackup={showToleranceStackup}
        setShowToleranceStackup={setShowToleranceStackup}
        showSurfaceQuality={showSurfaceQuality}
        setShowSurfaceQuality={setShowSurfaceQuality}
        setShowMfgPipeline={setShowMfgPipeline}
      />

      {/* ═══ Parametric Sweep Panel ═══ */}
      {showParametricSweep && (
        <div style={{ position: 'fixed', top: 60, right: 336 + col1RightInset('sweep'), zIndex: 500 }}>
          <ParametricSweepPanel
            lang={lang}
            currentParams={params}
            paramDefs={Object.keys(params).map(k => ({
              name: k,
              label: k,
              min: Math.max(0, (params[k] as number) * 0.5),
              max: (params[k] as number) * 1.5 }))}
            onApplyBest={(best) => {
              Object.entries(best).forEach(([k, v]) => setParam(k, v));
              addToast('success', lt.bestParamsApplied);
            }}
            onEvaluate={(overrideParams, objective) => {
              // Merge current params with override params for this evaluation
              const evalParams = { ...params, ...overrideParams };
              // Rebuild the shape geometry with these params
              const r = buildShapeResult(selectedId, evalParams);
              if (!r) return 0;
              switch (objective) {
                case 'volume':      return meshVolume(r.geometry) / 1000; // cm³
                case 'surfaceArea': return meshSurfaceArea(r.geometry) / 100; // cm²
                case 'mass': {
                  const vol = meshVolume(r.geometry) / 1000;
                  const density = 2.7; // g/cm³ default aluminum
                  return vol * density;
                }
                case 'maxStress':   return meshVolume(r.geometry) / 1000; // approximate: use volume as proxy for stress
                default:            return meshVolume(r.geometry) / 1000;
              }
            }}
            onClose={() => setShowParametricSweep(false)}
          />
        </div>
      )}


      {/* ═══ GD&T picker modal ═══ */}
      <GdtPicker open={showGdtPicker} isKo={isKorean(lang)} onClose={() => setShowGdtPicker(false)} />

      {/* ═══ Push/Pull mode banner ═══
          Phase-2A — visual mode indicator + currently-selected face label.
          The 3-D normal arrow gizmo + drag-to-param wiring is phase-2B. */}
      <PushPullBanner />

      {/* ═══ OpenSCAD code projection panel ═══ */}
      {showScadPanel && (
        <div
          style={{
            position: 'fixed',
            bottom: 12, right: 12,
            width: 460, height: 'min(540px, 70vh)',
            zIndex: 500,
            background: 'var(--nx-panel)',
            border: '1px solid var(--nx-border)',
            borderRadius: 8,
            boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
            padding: 10,
            display: 'flex', flexDirection: 'column', gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: 'var(--nx-text)' }}>
            <span style={{ flex: 1 }}>{isKorean(lang) ? 'OpenSCAD 코드' : 'OpenSCAD code'}</span>
            <button
              type="button"
              onClick={() => setShowScadPanel(false)}
              style={{ width: 22, height: 22, border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--nx-text-3)', fontSize: 16 }}
            >
              ×
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ScadCodePanel
              features={features}
              baseShapeId={selectedId}
              baseParams={params}
              header={selectedId || 'part'}
              isKo={isKorean(lang)}
            />
          </div>
        </div>
      )}

      {/* ═══ Auto Drawing Panel ═══ */}
      {showAutoDrawing && (
        <div style={{ position: 'fixed', top: 60, right: 336 + col1RightInset('draw'), zIndex: 500 }}>
          <AutoDrawingPanel
            lang={lang}
            geometry={effectiveResult?.geometry ?? null}
            partName={selectedId || 'Part'}
            material={materialId}
            onClose={() => setShowAutoDrawing(false)}
            // G8 — feed BOM parts so the panel can render an exploded view
            // with auto-numbered balloons. We compute each part's centre
            // from its bbox + position offset.
            explodedParts={bomParts.length >= 2 ? bomParts.map(bp => {
              bp.result.geometry.computeBoundingBox();
              const bb = bp.result.geometry.boundingBox;
              const localCx = bb ? (bb.min.x + bb.max.x) / 2 : 0;
              const localCy = bb ? (bb.min.y + bb.max.y) / 2 : 0;
              const localCz = bb ? (bb.min.z + bb.max.z) / 2 : 0;
              const offset = bp.position ?? [0, 0, 0];
              return {
                id: bp.name,
                name: bp.name,
                worldCenter: [
                  localCx + offset[0],
                  localCy + offset[1],
                  localCz + offset[2],
                ] as [number, number, number],
              };
            }) : undefined}
          />
        </div>
      )}


      {/* ═══ Copilot Panel ═══ */}
      {showCopilot && (
        <div style={{ position: 'fixed', top: 60, right: 336 + col1RightInset('copilot'), zIndex: 600 }}>
          <CopilotPanel
            lang={lang}
            dispatcher={{
              addFeature: (type, params) => {
                const num: Record<string, number> = {};
                if (params) {
                  for (const [k, v] of Object.entries(params)) {
                    if (typeof v === 'number' && Number.isFinite(v)) num[k] = v;
                  }
                }
                addFeatureWithParamsAndContext(type as FeatureType, num);
              },
              addSketchFeature,
              setParam,
            }}
            onClose={() => setShowCopilot(false)}
          />
        </div>
      )}

      {/* ═══ AI Design-Brief panel (Wave A · WA-D3) + autonomy dashboard (WA-E/GA3) ═══ */}
      {showDesignBrief && (
        <div style={{ position: 'fixed', top: 60, right: 360, zIndex: 600, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <DesignBriefPanel onClose={() => setShowDesignBrief(false)} />
          {/* Bound to autonomySessionStore. Renders "측정 없음(n=0)" until real
              partner-session actions accrue — measurement prep, not a claim. */}
          <div style={{ width: 360, maxHeight: '38vh', overflow: 'auto', padding: 10, background: 'var(--nx-panel, #161b22)', border: '1px solid var(--nx-border, #30363d)', borderRadius: 8 }}>
            <AutonomyDashboardConnected />
          </div>
        </div>
      )}

      {/* ═══ Manufacturing panel dock (CAM / Mold / RFQ / Sheet Metal) ═══ */}
      <ManufacturingPanelDock
        lang={lang}
        dockInsetForPanel={(id) => col1RightInset(id)}
        simpleMode={simpleMode}
        theme={theme}
        effectiveResultGeometry={effectiveResult?.geometry ?? null}
        effectiveResultBoundingBox={effectiveResult?.geometry.boundingBox ?? null}
        showCAMSimPanel={showCAMSimPanel}
        setShowCAMSimPanel={setShowCAMSimPanel}
        camSimResult={camSimResult}
        showMoldDesignPanel={showMoldDesignPanel}
        setShowMoldDesignPanel={setShowMoldDesignPanel}
        onGenerateCavity={(margin) => {
          if (!effectiveResult?.geometry.boundingBox) return;
          const bb = effectiveResult.geometry.boundingBox;
          const w = bb.max.x - bb.min.x + margin * 2;
          const h = bb.max.y - bb.min.y + margin * 2;
          const d = bb.max.z - bb.min.z + margin * 2;
          addFeatureWithParamsAndContext('sketchExtrude', { width: w, height: h, depth: d });
        }}
        onShowDraftAnalysis={(minAngle) => {
          handleDraftAnalyze([0, 0, 1], minAngle);
          setShowDraftAnalysis(true);
        }}
        onMoldSplitBody={() => {
          addFeatureWithParamsAndContext('splitBody', { plane: 0, keepSide: 0, offset: 0 });
        }}
        onOpenStandardParts={() => useUIStore.getState().togglePanel('showLibrary')}
        onExportSTEP={handleExportSTEP}
        showRfqPanel={showRfqPanel}
        setShowRfqPanel={setShowRfqPanel}
        selectedId={selectedId}
        materialId={materialId}
        rfqVolumeCm3={effectiveResult ? meshVolume(effectiveResult.geometry) / 1000 : 0}
        showSheetMetalPanel={showSheetMetalPanel}
        setShowSheetMetalPanel={setShowSheetMetalPanel}
        onSmBend={handleSmBend}
        onSmFlange={handleSmFlange}
        onSmFlatPattern={handleSmFlatPattern}
      />
      {/* WebWorker Progress Bar Overlay */}
      <PipelineProgressOverlay
        loading={pipelineWorkerLoading}
        progress={pipelineProgress}
        label={pipelineProgressLabel}
      />

      <style precedence="default" href="sg-page-1">{`
        @keyframes genSpin { to { transform: rotate(360deg); } }
        @keyframes nf-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
        /* Custom scrollbar for dark panels */
        .nf-scroll::-webkit-scrollbar { width: 6px; }
        .nf-scroll::-webkit-scrollbar-track { background: transparent; }
        .nf-scroll::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
        .nf-scroll::-webkit-scrollbar-thumb:hover { background: #484f58; }
        /* Allow text selection in input fields only */
        input, textarea, select { user-select: text !important; -webkit-user-select: text !important; }
        /* Prevent drag ghost on all elements */
        img, a, button, div { -webkit-user-drag: none; }
        /* 3D viewport should block all browser drag/select */
        canvas { touch-action: none; user-select: none; -webkit-user-select: none; outline: none; }
      `}</style>
    </div>
  );
}
