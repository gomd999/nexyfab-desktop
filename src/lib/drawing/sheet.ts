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

/**
 * Section view variants (spec FULL §8.2).
 *
 * - 'full' — single straight cutting plane spans the whole part (current
 *   behavior). `cuttingPath` may be omitted; the cut is implied by
 *   `cuttingPlaneId`'s plane definition in the 3D source.
 * - 'half' — like full but ONLY one side of the cutting plane is shown.
 *   `side` selects which half is preserved ('near' = side facing the
 *   viewer, 'far' = side behind the plane).
 * - 'offset' — the cutting plane is a polyline of 2+ segments ("zigzag").
 *   `cuttingPath` carries the polyline in the SOURCE viewport's drawing
 *   coords (mm).
 * - 'aligned' — like 'offset', but each segment is unfolded back to flat
 *   when projected (Phase 4.2 will implement the actual unfold; in this
 *   phase aligned renders identically to offset and is tagged for the
 *   geometry layer to pick up later).
 */
export type SectionType = 'full' | 'half' | 'offset' | 'aligned';

export interface SectionProjection {
  kind: 'section';
  /** Reference cutting plane id in the source model. */
  cuttingPlaneId: string;
  /**
   * Variant selector — see {@link SectionType}. Absent ⇒ treated as
   * 'full' (backward-compat for Sheet IR objects authored before
   * Phase 4.1.2).
   */
  sectionType?: SectionType;
  /** Optional offset of the section plane along its normal (mm). */
  offset?: number;
  /**
   * Legacy: when true, only show what's behind the cutting plane
   * (one-side cut). Retained for backward-compat with Phase 4.1.1
   * fixtures. New code should use `sectionType: 'half'` + `side`.
   */
  oneSided?: boolean;
  /**
   * For sectionType:'half' — which half to keep. 'near' (default) keeps
   * the side facing the viewer; 'far' keeps the side behind the plane.
   */
  side?: 'near' | 'far';
  /**
   * For sectionType:'offset' and 'aligned' — polyline cutting path in
   * the SOURCE viewport's drawing coords (mm). MUST have ≥ 2 points
   * (i.e. ≥ 1 segment); 'offset' typically has ≥ 3 (i.e. ≥ 2 segments
   * with at least one jog).
   */
  cuttingPath?: ReadonlyArray<{ x: number; y: number }>;
}

/** Resolve a section projection's effective variant, defaulting to 'full'. */
export function effectiveSectionType(p: SectionProjection): SectionType {
  return p.sectionType ?? 'full';
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

import type { Dimension, GdtCallout } from './dimension';
import { validateDimension, validateGdt } from './dimension';
import type { OrdinateDimensionChain } from './ordinateDimension';
import type { SurfaceFinishSymbol } from './surfaceFinishSymbol';
import type { WeldSymbol } from './weldSymbol';
import type { HoleSpec } from './holeTable';

export interface Sheet {
  id: string;
  name: string;
  paperSize: PaperSize;
  customPaper?: CustomPaper;
  viewports: ReadonlyArray<Viewport>;
  /**
   * Phase 4.2 annotations. Dimensions reference a viewport by id via
   * `Dimension.viewportId`; the renderer projects each into that viewport.
   * Backward-compat: missing field is treated as an empty array.
   */
  dimensions?: ReadonlyArray<Dimension>;
  /** Phase 4.2 GD&T callouts; same viewportId resolution as dimensions. */
  gdtCallouts?: ReadonlyArray<GdtCallout>;
  /**
   * Phase 4.2 ordinate (baseline / CMM-style) dimension chains. Each chain
   * carries its own datum origin + points in sheet mm-space and is rendered
   * by SheetRenderer's OrdinateChainLayer. Backward-compat: missing field is
   * treated as an empty array.
   */
  ordinateChains?: ReadonlyArray<OrdinateDimensionChain>;
  /** Phase 4.2 ISO 1302 surface-finish callouts (anchored by viewportId). */
  surfaceFinishSymbols?: ReadonlyArray<SurfaceFinishSymbol>;
  /** Phase 4.2 AWS/ISO weld callouts (anchored by viewportId). */
  weldSymbols?: ReadonlyArray<WeldSymbol>;
  /** Phase 4.3 hole schedule — rendered as a hole table in a sheet corner. */
  holes?: ReadonlyArray<HoleSpec>;
}

// ─── validation ──────────────────────────────────────────────────────────

export class SheetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheetValidationError';
  }
}

function validateSectionProjection(viewportId: string, p: SectionProjection): void {
  if (!p.cuttingPlaneId) {
    throw new SheetValidationError(
      `viewport ${viewportId} (section): cuttingPlaneId is empty`,
    );
  }
  const variant = effectiveSectionType(p);
  switch (variant) {
    case 'full':
      // Nothing further required.
      return;
    case 'half':
      if (p.side !== undefined && p.side !== 'near' && p.side !== 'far') {
        throw new SheetValidationError(
          `viewport ${viewportId} (section/half): invalid side ${String(p.side)}`,
        );
      }
      return;
    case 'offset':
    case 'aligned': {
      const path = p.cuttingPath;
      if (!path || path.length < 2) {
        throw new SheetValidationError(
          `viewport ${viewportId} (section/${variant}): cuttingPath must have ≥ 2 points`,
        );
      }
      // 'aligned' additionally requires every segment to be non-zero so the
      // Phase 4.2 unfold has a well-defined rotation axis per segment.
      if (variant === 'aligned') {
        for (let i = 1; i < path.length; i += 1) {
          const a = path[i - 1];
          const b = path[i];
          if (a.x === b.x && a.y === b.y) {
            throw new SheetValidationError(
              `viewport ${viewportId} (section/aligned): segment ${i - 1}→${i} has zero length`,
            );
          }
        }
      }
      return;
    }
    default: {
      // Exhaustiveness check — surfaces any new SectionType added later.
      const _exhaustive: never = variant;
      throw new SheetValidationError(
        `viewport ${viewportId} (section): unknown sectionType ${String(_exhaustive)}`,
      );
    }
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
    if (vp.projection.kind === 'section') {
      validateSectionProjection(vp.id, vp.projection);
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

  // ─── annotations (Phase 4.2): dimensions + GD&T ─────────────────────────
  const dimensions = sheet.dimensions ?? [];
  const dimIds = new Set<string>();
  for (const d of dimensions) {
    try {
      validateDimension(d);
    } catch (err) {
      throw new SheetValidationError(
        `sheet ${sheet.id}: dimension ${d.id} invalid — ${(err as Error).message}`,
      );
    }
    if (dimIds.has(d.id)) {
      throw new SheetValidationError(`sheet ${sheet.id}: duplicate dimension id ${d.id}`);
    }
    dimIds.add(d.id);
    if (!ids.has(d.viewportId)) {
      throw new SheetValidationError(
        `sheet ${sheet.id}: dimension ${d.id} references unknown viewport ${d.viewportId}`,
      );
    }
  }
  const gdtCallouts = sheet.gdtCallouts ?? [];
  const gdtIds = new Set<string>();
  for (const g of gdtCallouts) {
    try {
      validateGdt(g);
    } catch (err) {
      throw new SheetValidationError(
        `sheet ${sheet.id}: GD&T ${g.id} invalid — ${(err as Error).message}`,
      );
    }
    if (gdtIds.has(g.id)) {
      throw new SheetValidationError(`sheet ${sheet.id}: duplicate GD&T id ${g.id}`);
    }
    gdtIds.add(g.id);
    if (!ids.has(g.viewportId)) {
      throw new SheetValidationError(
        `sheet ${sheet.id}: GD&T ${g.id} references unknown viewport ${g.viewportId}`,
      );
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
