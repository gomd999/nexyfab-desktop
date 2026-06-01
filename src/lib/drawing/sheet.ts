/**
 * sheet — Phase 4.1 of NexyFab Pro own-CAD (ADR-013).
 *
 * Drawing sheet IR: paper format + viewports holding projected views of
 * the source 3D model. A sheet hosts one or more viewports; each viewport
 * resolves a part / assembly + a projection setting (front/top/right/iso/
 * auxiliary/section/detail) into a 2D drawing region the renderer fills
 * with edges and (Phase 4.2) dimensions.
 *
 * IR-first design: same pattern as Phase 2 feature IRs. The serializer to
 * SVG / DXF / DWG / PDF lives downstream (Phase 4.4) and consumes this IR.
 *
 * Scope (Phase 4.1 minimal):
 *   - 5 standard paper sizes (A0..A4) + custom.
 *   - 4 standard orientations + 3 custom-axis projection types.
 *   - Auxiliary projection from a named face/datum plane.
 *   - Section projection through a named cutting plane.
 *   - Detail projection (zoomed inset of another view).
 *   - Viewport scale + position on sheet.
 *
 * Out of scope (Phase 4.x+):
 *   - The actual 3D-to-2D edge projection (Phase 4.1.2 — needs OCCT
 *     `BRepLib::BuildCurves3d` + edge-classification for hidden lines).
 *   - Title block + sheet borders (Phase 4.1.3 — template-driven).
 *   - Multiple sheets per drawing document.
 *   - Sheet templates / company branding (Phase 4.3.2).
 */

// ─── paper formats ────────────────────────────────────────────────────────

export type PaperSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'custom';

export interface CustomPaper {
  width: number;
  height: number;
}

/** Paper dimensions in mm (landscape orientation). */
const PAPER_DIMENSIONS: Record<Exclude<PaperSize, 'custom'>, { width: number; height: number }> = {
  A0: { width: 1189, height: 841 },
  A1: { width: 841, height: 594 },
  A2: { width: 594, height: 420 },
  A3: { width: 420, height: 297 },
  A4: { width: 297, height: 210 },
};

export function paperDimensions(size: PaperSize, custom?: CustomPaper): { width: number; height: number } {
  if (size === 'custom') {
    if (!custom) throw new Error('paperDimensions: custom paper size requires custom dimensions');
    if (custom.width <= 0 || custom.height <= 0) {
      throw new Error('paperDimensions: custom dimensions must be positive');
    }
    return custom;
  }
  return PAPER_DIMENSIONS[size];
}

// ─── projection kinds ────────────────────────────────────────────────────

export type StandardProjectionView = 'front' | 'top' | 'right' | 'left' | 'bottom' | 'back' | 'iso';

export interface StandardProjection {
  kind: 'standard';
  view: StandardProjectionView;
}

export interface AuxiliaryProjection {
  kind: 'auxiliary';
  /** Reference plane id in the source model (face id or datum plane id).
   *  The projection direction is the plane's normal. */
  referencePlaneId: string;
}

export interface SectionProjection {
  kind: 'section';
  /** Reference cutting plane id in the source model. */
  cuttingPlaneId: string;
  /** Optional offset of the section plane along its normal (mm). */
  offset?: number;
  /** When true, only show what's behind the cutting plane (one-side cut). */
  oneSided?: boolean;
}

export interface DetailProjection {
  kind: 'detail';
  /** Source viewport id (this view is a magnified inset of that one). */
  sourceViewportId: string;
  /** Center (x, y) in source viewport's drawing coords. */
  center: { x: number; y: number };
  /** Detail circle radius in source drawing units. */
  radius: number;
  /** Magnification factor (e.g., 2 = 2× zoom). */
  scaleFactor: number;
}

export type ProjectionKind =
  | StandardProjection
  | AuxiliaryProjection
  | SectionProjection
  | DetailProjection;

// ─── viewport ────────────────────────────────────────────────────────────

export interface Viewport {
  id: string;
  /** Source model id — either a part-template id or an assembly id. */
  sourceId: string;
  projection: ProjectionKind;
  /** Position of viewport center on the sheet (mm from sheet origin
   *  = bottom-left). */
  centerOnSheet: { x: number; y: number };
  /** Width of viewport on sheet (mm). Height auto-computes from aspect. */
  widthOnSheet: number;
  /** Drawing scale (drawing-mm / model-mm). 1.0 = full size. */
  scale: number;
  /** Optional label rendered below the viewport ("FRONT VIEW", etc.). */
  label?: string;
}

// ─── sheet ────────────────────────────────────────────────────────────────

export interface Sheet {
  id: string;
  name: string;
  paperSize: PaperSize;
  customPaper?: CustomPaper;
  viewports: ReadonlyArray<Viewport>;
}

// ─── validation ──────────────────────────────────────────────────────────

export class SheetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetValidationError';
  }
}

export function validateSheet(sheet: Sheet): void {
  if (!sheet.id) throw new SheetValidationError('sheet id is empty');
  const dim = paperDimensions(sheet.paperSize, sheet.customPaper);
  const ids = new Set<string>();
  for (const vp of sheet.viewports) {
    if (!vp.id) throw new SheetValidationError(`sheet ${sheet.id}: viewport has empty id`);
    if (ids.has(vp.id)) throw new SheetValidationError(`sheet ${sheet.id}: duplicate viewport id ${vp.id}`);
    ids.add(vp.id);
    if (vp.widthOnSheet <= 0) {
      throw new SheetValidationError(`viewport ${vp.id}: widthOnSheet must be positive`);
    }
    if (vp.scale <= 0) {
      throw new SheetValidationError(`viewport ${vp.id}: scale must be positive`);
    }
    if (vp.centerOnSheet.x < 0 || vp.centerOnSheet.x > dim.width) {
      throw new SheetValidationError(
        `viewport ${vp.id}: centerOnSheet.x ${vp.centerOnSheet.x} outside sheet width ${dim.width}`,
      );
    }
    if (vp.centerOnSheet.y < 0 || vp.centerOnSheet.y > dim.height) {
      throw new SheetValidationError(
        `viewport ${vp.id}: centerOnSheet.y ${vp.centerOnSheet.y} outside sheet height ${dim.height}`,
      );
    }
    if (vp.projection.kind === 'detail') {
      // Detail must reference an existing viewport id on the SAME sheet.
      if (!ids.has(vp.projection.sourceViewportId) && vp.projection.sourceViewportId !== vp.id) {
        // The source must appear earlier in the list (allows forward
        // reference workflows to fail predictably).
        throw new SheetValidationError(
          `viewport ${vp.id} (detail): sourceViewportId ${vp.projection.sourceViewportId} not found earlier on sheet`,
        );
      }
      if (vp.projection.scaleFactor <= 0) {
        throw new SheetValidationError(`viewport ${vp.id} (detail): scaleFactor must be positive`);
      }
      if (vp.projection.radius <= 0) {
        throw new SheetValidationError(`viewport ${vp.id} (detail): radius must be positive`);
      }
    }
  }
}

// ─── standard sheet builders ──────────────────────────────────────────────

/**
 * Convenience: build a standard 3-view sheet (front / top / right) plus an
 * iso view, sized for the given paper. Returns a Sheet ready to render.
 */
export function standardThreeViewSheet(opts: {
  id: string;
  name: string;
  sourceId: string;
  paperSize: PaperSize;
  scale: number;
}): Sheet {
  const dim = paperDimensions(opts.paperSize);
  const margin = 20;
  const usableWidth = dim.width - margin * 2;
  const usableHeight = dim.height - margin * 2;
  const colW = usableWidth / 2;
  const rowH = usableHeight / 2;
  const viewports: Viewport[] = [
    {
      id: 'front',
      sourceId: opts.sourceId,
      projection: { kind: 'standard', view: 'front' },
      centerOnSheet: { x: margin + colW / 2, y: margin + rowH * 1.5 },
      widthOnSheet: colW * 0.85,
      scale: opts.scale,
      label: 'FRONT',
    },
    {
      id: 'top',
      sourceId: opts.sourceId,
      projection: { kind: 'standard', view: 'top' },
      centerOnSheet: { x: margin + colW / 2, y: margin + rowH * 0.5 },
      widthOnSheet: colW * 0.85,
      scale: opts.scale,
      label: 'TOP',
    },
    {
      id: 'right',
      sourceId: opts.sourceId,
      projection: { kind: 'standard', view: 'right' },
      centerOnSheet: { x: margin + colW * 1.5, y: margin + rowH * 1.5 },
      widthOnSheet: colW * 0.85,
      scale: opts.scale,
      label: 'RIGHT',
    },
    {
      id: 'iso',
      sourceId: opts.sourceId,
      projection: { kind: 'standard', view: 'iso' },
      centerOnSheet: { x: margin + colW * 1.5, y: margin + rowH * 0.5 },
      widthOnSheet: colW * 0.85,
      scale: opts.scale,
      label: 'ISO',
    },
  ];
  const sheet: Sheet = {
    id: opts.id,
    name: opts.name,
    paperSize: opts.paperSize,
    viewports,
  };
  validateSheet(sheet);
  return sheet;
}
