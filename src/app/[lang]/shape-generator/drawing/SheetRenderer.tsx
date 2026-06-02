'use client';

/**
 * SheetRenderer — Phase 4.4.1 Drawing UI track (first step).
 *
 * Pure read-only SVG renderer for a Phase 4 Sheet IR
 * (`src/lib/drawing/sheet.ts`). Renders:
 *   - Outer SVG sized to paper dimensions (mm → px via the `scale` prop;
 *     default 2 px/mm reads clearly on a typical monitor).
 *   - Sheet border rectangle.
 *   - Per-viewport border + label, using the same math as
 *     `viewportSheetBox()` in `dxfExport.ts` so the SVG matches DXF.
 *   - Section-view cutting-plane indicator arrows.
 *   - Detail-view detail-circle marker with letter label.
 *   - A static title-block placeholder in the bottom-right corner.
 *
 * Coordinate frame:
 *   Sheet IR uses bottom-left origin (mm). SVG uses top-left origin (px).
 *   We translate by `dim.height - y` for every vertical coordinate.
 *
 * Phase 1 stubs (intentional — Phase 2 will wire OCCT HLR):
 *   - Viewport contents are EMPTY rectangles. No 3D-projected geometry is
 *     drawn inside; only the bounding rect + the label.
 *   - Dimension + GD&T IRs (`src/lib/drawing/dimension.ts`) are NOT
 *     consumed yet.
 *   - The title block is a fixed "TITLE BLOCK" placeholder with no
 *     metadata bind.
 *
 * Pure consumer: this file does not mutate the Sheet IR.
 */

import * as React from 'react';
import type { Sheet, Viewport } from '@/lib/drawing/sheet';
import { paperDimensions } from '@/lib/drawing/sheet';
import { viewportSheetBox } from '@/lib/drawing/dxfExport';

// ─── constants ───────────────────────────────────────────────────────────

const DEFAULT_PX_PER_MM = 2;
const SHEET_BORDER_STROKE = '#444';
const SHEET_BORDER_WIDTH = 0.6;
const VP_BORDER_STROKE = '#1f2937';
const VP_BORDER_WIDTH = 0.4;
const VP_LABEL_COLOR = '#111827';
const SECTION_ARROW_COLOR = '#b91c1c';
const DETAIL_CIRCLE_COLOR = '#1d4ed8';
const TITLE_BLOCK_STROKE = '#222';
const TITLE_BLOCK_WIDTH_MM = 60;
const TITLE_BLOCK_HEIGHT_MM = 40;

// ─── props ───────────────────────────────────────────────────────────────

export interface SheetRendererProps {
  sheet: Sheet;
  /** Pixels per millimetre. Higher = larger on-screen sheet. */
  scale?: number;
  className?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────

interface ResolvedBox { x: number; y: number; w: number; h: number }

function resolveViewportBox(vp: Viewport, paperHeightMm: number): ResolvedBox {
  // viewportSheetBox returns mm in Sheet-IR space (bottom-left origin).
  // Convert top-left for SVG: SVG-y = paperHeight - (y + h).
  const box = viewportSheetBox(vp);
  return {
    x: box.x,
    y: paperHeightMm - (box.y + box.h),
    w: box.w,
    h: box.h,
  };
}

// ─── component ───────────────────────────────────────────────────────────

export function SheetRenderer({
  sheet,
  scale = DEFAULT_PX_PER_MM,
  className,
}: SheetRendererProps): React.ReactElement {
  const dim = paperDimensions(sheet.paperSize, sheet.customPaper);
  const widthPx = dim.width * scale;
  const heightPx = dim.height * scale;
  // viewBox uses mm-space so children can write coordinates in mm directly.
  const viewBox = `0 0 ${dim.width} ${dim.height}`;

  return (
    <svg
      data-testid="sheet-renderer-root"
      data-sheet-id={sheet.id}
      xmlns="http://www.w3.org/2000/svg"
      width={widthPx}
      height={heightPx}
      viewBox={viewBox}
      className={className}
      role="img"
      aria-label={`Sheet ${sheet.name}`}
    >
      {/* Background — solid white "paper" so dark UI shells don't bleed through. */}
      <rect
        data-testid="sheet-renderer-paper"
        x={0}
        y={0}
        width={dim.width}
        height={dim.height}
        fill="#ffffff"
      />

      {/* Sheet border. */}
      <rect
        data-testid="sheet-renderer-sheet-border"
        x={SHEET_BORDER_WIDTH / 2}
        y={SHEET_BORDER_WIDTH / 2}
        width={dim.width - SHEET_BORDER_WIDTH}
        height={dim.height - SHEET_BORDER_WIDTH}
        fill="none"
        stroke={SHEET_BORDER_STROKE}
        strokeWidth={SHEET_BORDER_WIDTH}
      />

      {/* Viewports. */}
      {sheet.viewports.map((vp, idx) => (
        <ViewportLayer
          key={vp.id}
          viewport={vp}
          paperHeightMm={dim.height}
          // Detail-view marker letters cycle A, B, C, ... per detail viewport.
          detailLetter={letterForIndex(idx)}
        />
      ))}

      {/* Title block placeholder (bottom-right). */}
      <TitleBlock paperWidthMm={dim.width} paperHeightMm={dim.height} />
    </svg>
  );
}

// ─── viewport layer (per-vp border + label + projection adornments) ──────

interface ViewportLayerProps {
  viewport: Viewport;
  paperHeightMm: number;
  detailLetter: string;
}

function ViewportLayer({ viewport, paperHeightMm, detailLetter }: ViewportLayerProps): React.ReactElement {
  const box = resolveViewportBox(viewport, paperHeightMm);
  const labelHeight = Math.max(3, box.h * 0.05);
  // Label sits BELOW the viewport rect in display (Sheet IR origin was
  // bottom-left, so "below in IR" is "above in SVG"). dxfExport.ts places
  // it below in IR space; in SVG that is `box.y + box.h + labelHeight + 2`.
  const labelY = box.y + box.h + labelHeight + 2;

  return (
    <g
      data-testid={`sheet-renderer-viewport-${viewport.id}`}
      data-vp-id={viewport.id}
      data-vp-kind={viewport.projection.kind}
    >
      {/*
        Phase 1 stub: the rectangle below is the viewport's bounding box.
        The actual projected 3D edges are NOT rendered here — that wires
        in at Phase 2 (OCCT HLR / HLRBRep_Algo edge stream).
      */}
      <rect
        data-testid={`sheet-renderer-viewport-border-${viewport.id}`}
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        fill="none"
        stroke={VP_BORDER_STROKE}
        strokeWidth={VP_BORDER_WIDTH}
      />

      {viewport.label ? (
        <text
          data-testid={`sheet-renderer-viewport-label-${viewport.id}`}
          x={box.x + box.w / 2}
          y={labelY}
          fontSize={labelHeight}
          fontFamily="system-ui, sans-serif"
          fill={VP_LABEL_COLOR}
          textAnchor="middle"
        >
          {viewport.label}
        </text>
      ) : null}

      {viewport.projection.kind === 'section' ? (
        <SectionArrows viewport={viewport} box={box} />
      ) : null}

      {viewport.projection.kind === 'detail' ? (
        <DetailCircle viewport={viewport} box={box} letter={detailLetter} />
      ) : null}
    </g>
  );
}

// ─── section view: cutting-plane indicator arrows ────────────────────────

interface SectionArrowsProps {
  viewport: Viewport;
  box: ResolvedBox;
}

/**
 * Cutting-plane indicator: a horizontal dashed line that crosses the
 * viewport at mid-height, capped at both ends with a small arrowhead
 * pointing inward (toward the cut). Phase 2 will rotate the line to
 * match the source cutting-plane's projection; for now a horizontal
 * stub conveys "this is a section view" without faking geometry.
 */
function SectionArrows({ viewport, box }: SectionArrowsProps): React.ReactElement {
  if (viewport.projection.kind !== 'section') {
    throw new Error('SectionArrows: viewport is not a section projection');
  }
  const midY = box.y + box.h / 2;
  const armLen = Math.min(box.w * 0.15, 8);
  const arrowSize = Math.max(1.5, box.h * 0.02);
  const xLeft = box.x - armLen;
  const xRight = box.x + box.w + armLen;
  return (
    <g
      data-testid={`sheet-renderer-section-arrows-${viewport.id}`}
      stroke={SECTION_ARROW_COLOR}
      strokeWidth={0.5}
      fill={SECTION_ARROW_COLOR}
    >
      {/* dashed cutting line crossing the viewport */}
      <line
        x1={xLeft}
        y1={midY}
        x2={xRight}
        y2={midY}
        strokeDasharray="3 1.5"
      />
      {/* left arrow head (pointing right, into the viewport) */}
      <polygon
        points={`${box.x},${midY} ${box.x - arrowSize},${midY - arrowSize} ${box.x - arrowSize},${midY + arrowSize}`}
      />
      {/* right arrow head (pointing left, into the viewport) */}
      <polygon
        points={`${box.x + box.w},${midY} ${box.x + box.w + arrowSize},${midY - arrowSize} ${box.x + box.w + arrowSize},${midY + arrowSize}`}
      />
      {/* end-labels — the IR carries the cutting plane id, surface as a hint */}
      <text
        x={xLeft - 1}
        y={midY - arrowSize - 1}
        fontSize={Math.max(2.5, box.h * 0.04)}
        fontFamily="system-ui, sans-serif"
        textAnchor="end"
        stroke="none"
      >
        {viewport.projection.cuttingPlaneId}
      </text>
      <text
        x={xRight + 1}
        y={midY - arrowSize - 1}
        fontSize={Math.max(2.5, box.h * 0.04)}
        fontFamily="system-ui, sans-serif"
        textAnchor="start"
        stroke="none"
      >
        {viewport.projection.cuttingPlaneId}
      </text>
    </g>
  );
}

// ─── detail view: detail-circle marker ───────────────────────────────────

interface DetailCircleProps {
  viewport: Viewport;
  box: ResolvedBox;
  letter: string;
}

/**
 * Detail-view bubble: the IR's projection.center + projection.radius refer
 * to the SOURCE viewport's drawing coords. Without rendering the source
 * geometry inside the source viewport yet, we instead draw a marker INSIDE
 * the detail viewport itself with the detail letter — same convention as
 * SolidWorks "Detail A" labels. Phase 2 will additionally draw the circle
 * on the source viewport once edge projection is wired.
 */
function DetailCircle({ viewport, box, letter }: DetailCircleProps): React.ReactElement {
  if (viewport.projection.kind !== 'detail') {
    throw new Error('DetailCircle: viewport is not a detail projection');
  }
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = Math.min(box.w, box.h) * 0.4;
  const labelSize = Math.max(3, r * 0.4);
  return (
    <g data-testid={`sheet-renderer-detail-circle-${viewport.id}`}>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={DETAIL_CIRCLE_COLOR}
        strokeWidth={0.4}
        strokeDasharray="2 1.5"
      />
      <text
        x={cx + r + 1}
        y={cy - r - 1}
        fontSize={labelSize}
        fontFamily="system-ui, sans-serif"
        fontWeight={600}
        fill={DETAIL_CIRCLE_COLOR}
        textAnchor="start"
      >
        {letter}
      </text>
    </g>
  );
}

// ─── title block ─────────────────────────────────────────────────────────

interface TitleBlockProps {
  paperWidthMm: number;
  paperHeightMm: number;
}

function TitleBlock({ paperWidthMm, paperHeightMm }: TitleBlockProps): React.ReactElement {
  // Place inside the sheet border with a 5mm inset.
  const inset = 5;
  const w = TITLE_BLOCK_WIDTH_MM;
  const h = TITLE_BLOCK_HEIGHT_MM;
  const x = paperWidthMm - w - inset;
  const y = paperHeightMm - h - inset;
  return (
    <g data-testid="sheet-renderer-title-block">
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke={TITLE_BLOCK_STROKE}
        strokeWidth={0.4}
      />
      <text
        x={x + w / 2}
        y={y + h / 2}
        fontSize={4}
        fontFamily="system-ui, sans-serif"
        fontWeight={600}
        fill={TITLE_BLOCK_STROKE}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        TITLE BLOCK
      </text>
    </g>
  );
}

// ─── private utilities ───────────────────────────────────────────────────

function letterForIndex(i: number): string {
  // 0 → 'A', 1 → 'B', ..., 25 → 'Z', 26 → 'AA' (rare for one sheet but safe)
  if (i < 26) return String.fromCharCode(65 + i);
  const first = Math.floor(i / 26) - 1;
  const second = i % 26;
  return `${String.fromCharCode(65 + first)}${String.fromCharCode(65 + second)}`;
}
