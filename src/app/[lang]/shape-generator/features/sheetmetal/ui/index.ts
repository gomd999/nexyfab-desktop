/**
 * features/sheetmetal/ui — re-exports for Wave 2 Phase 2 Track B5 components.
 */

export { SheetMetalRightPane, K_FACTOR_RT_COLUMNS, closestRtColumn } from './SheetMetalRightPane';
export type { SheetMetalRightPaneProps, SheetMetalPaneState } from './SheetMetalRightPane';

export { BendTableDock } from './BendTableDock';
export type { BendTableDockProps } from './BendTableDock';

export { AutoDrawingDialog, generateStubPdf } from './AutoDrawingDialog';
export type {
  AutoDrawingDialogProps,
  AutoDrawingPdfInput,
  AutoDrawingPdfResult,
  AutoDrawingUnits,
} from './AutoDrawingDialog';
