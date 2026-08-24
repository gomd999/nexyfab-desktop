'use client';

import dynamic from 'next/dynamic';

export const LegacyHoleWizardModal = dynamic(() => import('../features/HoleWizardModal'), { ssr: false });
export const HoleWizardModalV2 = dynamic(() => import('../features/HoleWizardModalV2'), { ssr: false });
export const FeatureParams = dynamic(() => import('../FeatureParams'), { ssr: false });
export const CommandToolbar = dynamic(() => import('../CommandToolbar'), { ssr: false });
export const ShapeCart = dynamic(() => import('../ShapeCart'), { ssr: false });
export const DesignFunnelBar = dynamic(() => import('../DesignFunnelBar'), { ssr: false });
export const TimelineBar = dynamic(() => import('../TimelineBar'), { ssr: false });
export const ShapeGeneratorToolbar = dynamic(() => import('../ShapeGeneratorToolbar'), { ssr: false });
export const Sketch3DCanvas = dynamic(() => import('../sketch/Sketch3DCanvas'), { ssr: false });
export const DrawingView = dynamic(() => import('../sketch/DrawingView'), { ssr: false });
export const MobileModelViewer = dynamic(() => import('../responsive/MobileModelViewer'), { ssr: false });
export const QuoteWizard = dynamic(() => import('../onboarding/QuoteWizard'), { ssr: false });
export const DesktopFirstRunWizard = dynamic(() => import('../onboarding/DesktopFirstRunWizard'), { ssr: false });
export const CommandPalette = dynamic(() => import('../CommandPalette'), { ssr: false });
export const CollabChat = dynamic(() => import('../collab/CollabChat'), { ssr: false });
export const DesignVariantsPanel = dynamic(() => import('../panels/DesignVariantsPanel'), { ssr: false });
export const CopilotPanel = dynamic(() => import('../copilot/CopilotPanel'), { ssr: false });
export const DesignBriefPanel = dynamic(() => import('../design-brief/DesignBriefPanel'), { ssr: false });
export const AutonomyDashboardConnected = dynamic(() => import('./AutonomyDashboardConnected'), { ssr: false });
export const ConfigurationTable = dynamic(() => import('../panels/ConfigurationTable'), { ssr: false });
export const ConfigurationTableV2 = dynamic(() => import('../configurations/ui/ConfigurationTableV2'), { ssr: false });
export const DrcPanel = dynamic(() => import('../analysis/DrcPanel'), { ssr: false });
export const PlmConfigPanel = dynamic(() => import('../integrations/PlmConfigPanel'), { ssr: false });
export const SketchTextPanel = dynamic(() => import('../sketch/SketchTextPanel'), { ssr: false });
export const SmartFastenerPanel = dynamic(() => import('../assembly/SmartFastenerPanel'), { ssr: false });
export const SketchContextTip = dynamic(() => import('../onboarding/SketchContextTip'), {
  ssr: false,
  loading: () => null,
});
export const ProcessRouterPanel = dynamic(() => import('../estimation/ProcessRouterPanel'), { ssr: false });
export const AISupplierPanel = dynamic(() => import('../analysis/AISupplierPanel'), { ssr: false });
export const CostCopilotPanel = dynamic(() => import('../analysis/CostCopilotPanel'), { ssr: false });
export const AIHistoryPanel = dynamic(() => import('../analysis/AIHistoryPanel'), { ssr: false });
export const OpenScadPanel = dynamic(() => import('../openscad/OpenScadPanel'), { ssr: false });
export const ShapePreview = dynamic(() => import('../ShapePreview'), { ssr: false });
export const MultiViewport = dynamic(() => import('../MultiViewport'), { ssr: false });
export const GenDesignViewer = dynamic(() => import('../topology/GenDesignViewer'), { ssr: false });
export const UpgradePrompt = dynamic(() => import('../freemium/UpgradePrompt'), { ssr: false });
export const COTSPanel = dynamic(() => import('../cots/COTSPanel'), { ssr: false });
export const CAMSimPanel = dynamic(() => import('../analysis/CAMSimPanel'), { ssr: false });
export const CommentsPanel = dynamic(() => import('../comments/CommentsPanel'), { ssr: false });
export const ManufacturerMatch = dynamic(() => import('../analysis/ManufacturerMatch'), {
  ssr: false,
  loading: () => (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--nx-bg)', color: 'var(--nx-text-3)', fontSize: 13 }}
    >
      Loading Manufacturer Match...
    </div>
  ),
});
export const StatusBar = dynamic(() => import('../StatusBar'), { ssr: false });
export const BreadcrumbNav = dynamic(() => import('../BreadcrumbNav'), { ssr: false });
export const IntakeWizard = dynamic(() => import('../intake/IntakeWizard'), { ssr: false });
export const ComposeResultPanel = dynamic(() => import('../intake/ComposeResultPanel'), { ssr: false });
export const PropertyManager = dynamic(() => import('../PropertyManager'), { ssr: false });
export const EmptyCanvasGuide = dynamic(() => import('../EmptyCanvasGuide'), { ssr: false });
export const ParametricSweepPanel = dynamic(() => import('../analysis/ParametricSweepPanel'), { ssr: false });
export const AutoDrawingPanel = dynamic(() => import('../analysis/AutoDrawingPanel'), { ssr: false });
export const DrivingDimensionField = dynamic(() => import('../drawing/DrivingDimensionField'), { ssr: false });
export const ScadCodePanel = dynamic(() => import('../openscad/ScadCodePanel'), { ssr: false });
export const PushPullBanner = dynamic(() => import('../pushpull/PushPullBanner'), { ssr: false });
export const GdtPicker = dynamic(() => import('../drawing/GdtPicker'), { ssr: false });
