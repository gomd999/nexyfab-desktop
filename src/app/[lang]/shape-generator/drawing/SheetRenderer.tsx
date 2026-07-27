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
 *   - The title block is a fixed "TITLE BLOCK" placeholder with no
 *     metadata bind.
 *
 * W4-A: Dimension IRs are measured for real when the caller supplies the
 * source model's named topology (`topologies` prop) — the label shows the
 * measureDimension() value; explicit measurement failures keep the
 * placeholder and carry the failure reason as a data attribute (값 날조
 * 금지 — a number is only printed when it was actually measured).
 *
 * Pure consumer: this file does not mutate the Sheet IR.
 */

import * as React from 'react';
import type { HoleMark, Sheet, Viewport } from '@/lib/drawing/sheet';
import { paperDimensions, effectiveSectionType } from '@/lib/drawing/sheet';
import { viewportSheetBox } from '@/lib/drawing/dxfExport';
import type { Dimension, GdtCallout } from '@/lib/drawing/dimension';
import { formatGdt, formatTolerance } from '@/lib/drawing/dimension';
import type { OrdinateDimensionChain } from '@/lib/drawing/ordinateDimension';
import { buildOrdinateRenderHints } from '@/lib/drawing/ordinateDimension';
import type { Polyhedron } from '@/lib/cad/featureMesh';
import {
  projectPolyhedron,
  clipSegmentsToCircle,
  applyViewBreak,
} from '@/lib/drawing/projectView';
import { generateSection, planeBasis, project2D, type CuttingPlane, type SectionKind } from './sectionView';
import { formatSurfaceFinish } from '@/lib/drawing/surfaceFinishSymbol';
import { formatWeldSymbol } from '@/lib/drawing/weldSymbol';
import { buildLinearDimension, type Pt } from '@/lib/drawing/dimensionAnchor';
import { buildHoleTable, holeTagsById } from '@/lib/drawing/holeTable';
import type { BomItemRow, BomBalloon } from '@/lib/drawing/bomBalloon';
import type { MeasureResult } from '@/lib/drawing/measure';
import { measureSheetDimension, formatMeasuredValue } from '@/lib/drawing/associativeUpdate';
import type { NamedTopology } from '@/lib/cad/topoNaming';

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
const DIM_STROKE = '#0f172a';
const DIM_TEXT_COLOR = '#0f172a';
const GDT_STROKE = '#1e3a8a';
const GDT_BG = '#eff6ff';
const ORDINATE_STROKE = '#0e7490';
const ORDINATE_TEXT_COLOR = '#0e7490';
const SURFACE_FINISH_COLOR = '#0f766e';
const WELD_COLOR = '#7c2d12';

// ─── props ───────────────────────────────────────────────────────────────

export interface SheetRendererProps {
  sheet: Sheet;
  /** Pixels per millimetre. Higher = larger on-screen sheet. */
  scale?: number;
  className?: string;
  /**
   * Per-sourceId polyhedra (from lib/cad/featureMesh). When a standard-view
   * viewport's sourceId is present, its real projected edges (HLR: solid +
   * dashed) are drawn fitted into the viewport box instead of the placeholder.
   * Omitted → every viewport falls back to the placeholder box (back-compat).
   */
  geometry?: ReadonlyMap<string, Polyhedron>;
  /**
   * Resolves a section viewport's `projection.cuttingPlaneId` to its actual
   * cutting plane (origin + normal in model space). When present alongside the
   * viewport's source geometry, the real cross-section (outline + hatch) is
   * drawn fitted into the section viewport box. Omitted → section viewports
   * show only the cutting-plane arrows (back-compat).
   */
  cuttingPlanes?: ReadonlyMap<string, CuttingPlane>;
  /**
   * When true, standard-view viewports that have geometry also get auto
   * overall width + height dimensions (built via dimensionAnchor on the
   * projected bbox; values are true mm). Default off.
   */
  autoDimension?: boolean;
  /**
   * Show hidden (dashed) edges on projected standard views. ISO/ASME drawings
   * often suppress hidden lines for clarity, so this is a user-facing style
   * toggle. Default on (back-compat — hidden lines were always drawn before).
   */
  showHiddenLines?: boolean;
  /**
   * Show smooth/tangent edges (e.g. where a fillet blends into a wall) as thin
   * phantom lines on projected standard views. Off by default — tangent edges
   * are normally suppressed for a clean drawing.
   */
  showTangentEdges?: boolean;
  /**
   * W4-A — per-sourceId named topology (same keying as `geometry`, built via
   * `buildExtrudeTopo`). When a dimension's target viewport is a standard view
   * and its sourceId has a topology here, the dimension label shows the REAL
   * `measureDimension()` value; an explicit measurement failure keeps the
   * `<kind>` placeholder and exposes the reason via `data-dim-measured`.
   * Omitted → all dimensions keep the placeholder (back-compat).
   */
  topologies?: ReadonlyMap<string, NamedTopology>;
}

// ─── helpers ─────────────────────────────────────────────────────────────

interface ResolvedBox { x: number; y: number; w: number; h: number }

type ProjView = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'iso';

/** A detail circle drawn ON a source viewport (view-plane mm + letter). */
interface DetailMarker {
  center: { x: number; y: number };
  radius: number;
  letter: string;
}

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
  geometry,
  cuttingPlanes,
  autoDimension = false,
  showHiddenLines = true,
  showTangentEdges = false,
  topologies,
}: SheetRendererProps): React.ReactElement {
  const dim = paperDimensions(sheet.paperSize, sheet.customPaper);
  // 260728 — 구멍 id → 표 태그. **표를 만드는 것과 같은 호출**(같은 옵션)에서 뽑으므로
  // 뷰 안의 원과 코너의 표가 반드시 같은 태그를 쓴다(태그 규칙 중복 구현 없음).
  const holeTags = (() => {
    const hs = sheet.holes;
    if (!hs || hs.length === 0) return null;
    try { return holeTagsById(hs, { groupIdentical: true }); } catch { return null; }
  })();
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

      {/* Viewports. W4-C: each detail viewport's circle is also drawn ON its
          source viewport (drafting convention), and the detail viewport itself
          shows the real magnified line work when geometry is available. */}
      {sheet.viewports.map((vp, idx) => {
        // Detail circles targeting THIS viewport (letters match the detail
        // viewport's own marker letter — same index-based cycle).
        const markers: DetailMarker[] = [];
        sheet.viewports.forEach((other, otherIdx) => {
          if (other.projection.kind === 'detail' && other.projection.sourceViewportId === vp.id) {
            markers.push({
              center: other.projection.center,
              radius: other.projection.radius,
              letter: letterForIndex(otherIdx),
            });
          }
        });
        // A detail viewport magnifies its source viewport's STANDARD view.
        let detailSourceView: ProjView | null = null;
        if (vp.projection.kind === 'detail') {
          const srcId = vp.projection.sourceViewportId;
          const src = sheet.viewports.find((v) => v.id === srcId);
          if (src && src.projection.kind === 'standard') detailSourceView = src.projection.view;
        }
        return (
          <ViewportLayer
            key={vp.id}
            viewport={vp}
            paperHeightMm={dim.height}
            // Detail-view marker letters cycle A, B, C, ... per detail viewport.
            detailLetter={letterForIndex(idx)}
            geometry={geometry?.get(vp.sourceId) ?? null}
            cuttingPlane={vp.projection.kind === 'section' ? (cuttingPlanes?.get(vp.projection.cuttingPlaneId) ?? null) : null}
            autoDimension={autoDimension}
            showHiddenLines={showHiddenLines}
            showTangentEdges={showTangentEdges}
            detailMarkers={markers.length > 0 ? markers : null}
            detailSourceView={detailSourceView}
            holeMarks={(sheet.holeMarks ?? []).filter((h) => h.viewportId === vp.id)}
            holeTags={holeTags}
          />
        );
      })}

      {/* Dimensions (Phase 4.2 layout + W4-A real values). When the target
          viewport is a standard view with a supplied topology, the label is
          the measureDimension() value; otherwise the placeholder stays. */}
      {(sheet.dimensions ?? []).map((d, idx) => {
        const targetVp = sheet.viewports.find((vp) => vp.id === d.viewportId);
        if (!targetVp) return null;
        // Single resolution rule shared with the drawing page's annotation
        // list (associativeUpdate) — canvas and list can never disagree.
        const measured = measureSheetDimension(d, sheet.viewports, topologies);
        return (
          <DimensionLayer
            key={d.id}
            dimension={d}
            box={resolveViewportBox(targetVp, dim.height)}
            index={idx}
            measured={measured}
          />
        );
      })}

      {/* GD&T callouts (Phase 4.2). Rendered as a textual feature-control
          frame box anchored just outside the target viewport. */}
      {(sheet.gdtCallouts ?? []).map((g, idx) => {
        const targetVp = sheet.viewports.find((vp) => vp.id === g.viewportId);
        if (!targetVp) return null;
        return (
          <GdtLayer
            key={g.id}
            gdt={g}
            box={resolveViewportBox(targetVp, dim.height)}
            index={idx}
          />
        );
      })}

      {/* Surface-finish callouts (Phase 4.2, ISO 1302) — text anchored at the
          target viewport's lower-left, stacked downward. */}
      {(sheet.surfaceFinishSymbols ?? []).map((s, idx) => {
        const targetVp = sheet.viewports.find((v) => v.id === s.viewportId);
        if (!targetVp) return null;
        return (
          <SymbolCallout
            key={s.id}
            testid={`sheet-renderer-surface-finish-${s.id}`}
            dataKind="surface-finish"
            targetId={s.viewportId}
            box={resolveViewportBox(targetVp, dim.height)}
            index={idx}
            text={`⌵ ${formatSurfaceFinish(s)}`}
            color={SURFACE_FINISH_COLOR}
          />
        );
      })}

      {/* Weld callouts (Phase 4.2, AWS/ISO). */}
      {(sheet.weldSymbols ?? []).map((w, idx) => {
        const targetVp = sheet.viewports.find((v) => v.id === w.viewportId);
        if (!targetVp) return null;
        return (
          <SymbolCallout
            key={w.id}
            testid={`sheet-renderer-weld-${w.id}`}
            dataKind="weld"
            targetId={w.viewportId}
            box={resolveViewportBox(targetVp, dim.height)}
            index={idx}
            text={`⊳ ${formatWeldSymbol(w)}`}
            color={WELD_COLOR}
          />
        );
      })}

      {/* Ordinate (baseline / CMM-style) dimension chains (Phase 4.2). Each
          chain carries its own datum + points in sheet mm-space; we render
          the leader lines + value labels from buildOrdinateRenderHints.
          Additive — sheets with no chains render identically. */}
      {(sheet.ordinateChains ?? []).map((chain) => (
        <OrdinateChainLayer key={chain.id} chain={chain} paperHeightMm={dim.height} />
      ))}

      {/* Hole table (Phase 4.3) — top-right corner, grouped identical holes. */}
      {sheet.holes && sheet.holes.length > 0 ? (
        <HoleTableLayer holes={sheet.holes} paperWidthMm={dim.width} />
      ) : null}

      {/* BOM table (SolidWorks-parity Phase 3) — top-left corner grid. */}
      {sheet.bom && sheet.bom.length > 0 ? (
        <BomTableLayer rows={sheet.bom} />
      ) : null}

      {/* BOM balloons — circled item numbers with leader lines. Balloon
          coords are sheet mm with a bottom-left origin (Sheet IR
          convention), flipped to SVG's top-left frame here. */}
      {sheet.balloons && sheet.balloons.length > 0 ? (
        <BalloonLayer balloons={sheet.balloons} paperHeightMm={dim.height} />
      ) : null}

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
  geometry?: Polyhedron | null;
  cuttingPlane?: CuttingPlane | null;
  autoDimension?: boolean;
  showHiddenLines?: boolean;
  showTangentEdges?: boolean;
  /** W4-C — detail circles referencing THIS viewport as their source. */
  detailMarkers?: ReadonlyArray<DetailMarker> | null;
  /** W4-C — for a detail viewport: its source viewport's standard view. */
  detailSourceView?: ProjView | null;
  /** 260728 — 이 뷰포트에 그릴 구멍 원. */
  holeMarks?: ReadonlyArray<HoleMark> | null;
  /** 구멍 id → 표 태그. 표를 만드는 `buildHoleTable` 이 매긴 값 그대로다. */
  holeTags?: ReadonlyMap<string, string> | null;
}

function ViewportLayer({
  viewport,
  paperHeightMm,
  detailLetter,
  geometry,
  cuttingPlane,
  autoDimension,
  showHiddenLines = true,
  showTangentEdges = false,
  detailMarkers,
  detailSourceView,
  holeMarks,
  holeTags,
}: ViewportLayerProps): React.ReactElement {
  const box = resolveViewportBox(viewport, paperHeightMm);
  // Real projected geometry for standard views when a polyhedron is supplied.
  const projected =
    geometry && viewport.projection.kind === 'standard'
      ? <ProjectedGeometry
          viewportId={viewport.id}
          poly={geometry}
          view={viewport.projection.view}
          box={box}
          autoDimension={autoDimension}
          showHiddenLines={showHiddenLines}
          showTangentEdges={showTangentEdges}
          detailMarkers={detailMarkers}
          holeMarks={holeMarks}
          holeTags={holeTags}
        />
      : null;
  // W4-C — real broken-view line work (standard projection + band collapse).
  const broken =
    geometry && viewport.projection.kind === 'broken'
      ? <BrokenGeometry
          viewportId={viewport.id}
          poly={geometry}
          projection={viewport.projection}
          box={box}
          showHiddenLines={showHiddenLines}
        />
      : null;
  // W4-C — real magnified detail content (clip source view to the circle).
  const detail =
    geometry && viewport.projection.kind === 'detail' && detailSourceView
      ? <DetailGeometry
          viewportId={viewport.id}
          poly={geometry}
          sourceView={detailSourceView}
          center={viewport.projection.center}
          radius={viewport.projection.radius}
          box={box}
          showHiddenLines={showHiddenLines}
        />
      : null;
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
        Viewport bounding box. When a polyhedron is supplied for a standard
        view, real projected HLR edges are drawn inside it (see
        ProjectedGeometry below); otherwise the box is the placeholder.
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

      {projected}
      {broken}
      {detail}

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
        <>
          {geometry && cuttingPlane ? (
            <SectionGeometry
              viewportId={viewport.id}
              poly={geometry}
              plane={cuttingPlane}
              kind="full"
              box={box}
            />
          ) : null}
          <SectionArrows viewport={viewport} box={box} />
        </>
      ) : null}

      {viewport.projection.kind === 'detail' ? (
        <DetailCircle viewport={viewport} box={box} letter={detailLetter} />
      ) : null}
    </g>
  );
}

// ─── projected geometry (real HLR edges fitted into a viewport) ──────────────

interface ProjectedGeometryProps {
  viewportId: string;
  poly: Polyhedron;
  view: ProjView;
  box: ResolvedBox;
  autoDimension?: boolean;
  showHiddenLines?: boolean;
  showTangentEdges?: boolean;
  /** W4-C — detail circles to draw over this view (view-plane mm). */
  detailMarkers?: ReadonlyArray<DetailMarker> | null;
  /** 260728 — 이 뷰에 그릴 구멍 원(모델 mm). 변환은 아래 tx/ty 를 그대로 쓴다. */
  holeMarks?: ReadonlyArray<HoleMark> | null;
  holeTags?: ReadonlyMap<string, string> | null;
}

const GEOM_VISIBLE_STROKE = '#0f172a';
const GEOM_HIDDEN_STROKE = '#94a3b8';
const GEOM_TANGENT_STROKE = '#c7cdd6';
const GEOM_MARGIN_FRAC = 0.08;
const GEOM_DIM_MARGIN_FRAC = 0.18;
const GEOM_DIM_COLOR = '#1d4ed8';

/**
 * Project `poly` to the viewport's view, fit the result into the box (uniform
 * scale, centered, with a margin), and draw visible (solid) + hidden (dashed)
 * edges. View-plane Y is up; the SVG box is Y-down, so v is flipped.
 */
function ProjectedGeometry({
  viewportId,
  poly,
  view,
  box,
  autoDimension,
  showHiddenLines = true,
  showTangentEdges = false,
  detailMarkers,
  holeMarks,
  holeTags,
}: ProjectedGeometryProps): React.ReactElement | null {
  const { visible, hidden, tangent, bbox } = projectPolyhedron(poly, view);
  const geomW = bbox.maxX - bbox.minX;
  const geomH = bbox.maxY - bbox.minY;
  if (!(geomW > 0) && !(geomH > 0)) return null;

  // Reserve extra margin for the dimension lines when auto-dimensioning.
  const marginFrac = autoDimension ? GEOM_DIM_MARGIN_FRAC : GEOM_MARGIN_FRAC;
  const margin = Math.min(box.w, box.h) * marginFrac;
  const availW = Math.max(1e-6, box.w - 2 * margin);
  const availH = Math.max(1e-6, box.h - 2 * margin);
  const s = Math.min(geomW > 0 ? availW / geomW : Infinity, geomH > 0 ? availH / geomH : Infinity);
  // Center the scaled geometry inside the box.
  const offX = box.x + (box.w - geomW * s) / 2;
  const offY = box.y + (box.h - geomH * s) / 2;
  const tx = (u: number): number => offX + (u - bbox.minX) * s;
  // Flip Y: larger v (up) → smaller SVG-y.
  const ty = (v: number): number => offY + (bbox.maxY - v) * s;

  const strokeW = Math.max(0.15, Math.min(box.w, box.h) * 0.006);

  // Auto overall dimensions (width below, height to the left) from the
  // projected bbox, built via dimensionAnchor (values are true mm).
  const dims =
    autoDimension && geomW > 0 && geomH > 0
      ? renderAutoDimensions({ viewportId, bbox, geomW, geomH, s, tx, ty, strokeW })
      : null;

  // 260728 — 뷰 안의 구멍 원. **이 함수가 이미 계산한 tx/ty/s 를 그대로 쓴다** —
  // 뷰포트 맞춤 변환을 두 번 구현하면 그게 드리프트 원흉이다(도면 계층의 반복된 교훈).
  // 좌표는 프로파일 평면(모델 mm)이고, 프로파일 평면을 보여주는 뷰에서만 의미가 있다 —
  // 어느 뷰에 붙일지는 호출자(drawingGate)가 정하고 여기서는 받은 대로 그린다.
  const holeCircles = (holeMarks ?? []).length > 0
    ? (holeMarks ?? []).map((h, i) => {
        const cx = tx(h.xMm), cy = ty(h.yMm), r = (h.diameterMm / 2) * s;
        if (!(r > 0)) return null;
        const cross = r * 1.35; // 중심선(센터마크) 길이
        // 코너의 구멍표와 **같은 태그**(buildHoleTable 이 매긴 값). 못 찾으면 라벨 없이 원만
        // 그린다 — 없는 태그를 지어내지 않는다.
        const label = h.tag ? (holeTags?.get(h.tag) ?? null) : null;
        return (
          <g key={`hm${i}`} data-testid={`sheet-renderer-hole-${viewportId}-${h.tag ?? i}`} data-hole-d={h.diameterMm} data-hole-tag={label ?? ''}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={GEOM_VISIBLE_STROKE} strokeWidth={strokeW} />
            <line x1={cx - cross} y1={cy} x2={cx + cross} y2={cy} stroke={GEOM_VISIBLE_STROKE} strokeWidth={strokeW * 0.5} strokeDasharray={`${r * 0.6} ${r * 0.25} ${r * 0.15} ${r * 0.25}`} />
            <line x1={cx} y1={cy - cross} x2={cx} y2={cy + cross} stroke={GEOM_VISIBLE_STROKE} strokeWidth={strokeW * 0.5} strokeDasharray={`${r * 0.6} ${r * 0.25} ${r * 0.15} ${r * 0.25}`} />
            {label ? (
              <text x={cx + cross + strokeW} y={cy - cross} fontSize={Math.max(2, r * 0.9)} fill={GEOM_VISIBLE_STROKE}>{label}</text>
            ) : null}
          </g>
        );
      })
    : null;

  return (
    <g
      data-testid={`sheet-renderer-vp-geometry-${viewportId}`}
      data-visible={visible.length}
      data-hidden={showHiddenLines ? hidden.length : 0}
      data-tangent={showTangentEdges ? tangent.length : 0}
      data-holes={(holeMarks ?? []).length}
    >
      {holeCircles}
      {showTangentEdges
        ? tangent.map((e, i) => (
            <line
              key={`t${i}`}
              x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
              stroke={GEOM_TANGENT_STROKE}
              strokeWidth={strokeW * 0.7}
            />
          ))
        : null}
      {showHiddenLines
        ? hidden.map((e, i) => (
            <line
              key={`h${i}`}
              x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
              stroke={GEOM_HIDDEN_STROKE}
              strokeWidth={strokeW}
              strokeDasharray={`${strokeW * 4} ${strokeW * 3}`}
            />
          ))
        : null}
      {visible.map((e, i) => (
        <line
          key={`v${i}`}
          x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
          stroke={GEOM_VISIBLE_STROKE}
          strokeWidth={strokeW}
        />
      ))}
      {/* W4-C — detail circles on the source view, mapped through the same
          fit transform as the line work so they ring the actual geometry. */}
      {detailMarkers?.map((m, i) => (
        <g
          key={`dm${i}`}
          data-testid={`sheet-renderer-detail-marker-${viewportId}-${m.letter}`}
        >
          <circle
            cx={tx(m.center.x)}
            cy={ty(m.center.y)}
            r={m.radius * s}
            fill="none"
            stroke={DETAIL_CIRCLE_COLOR}
            strokeWidth={strokeW * 0.8}
            strokeDasharray={`${strokeW * 4} ${strokeW * 2.5}`}
          />
          <text
            x={tx(m.center.x) + m.radius * s + 1}
            y={ty(m.center.y) - m.radius * s - 1}
            fontSize={Math.max(2.5, box.h * 0.045)}
            fontFamily="system-ui, sans-serif"
            fontWeight={600}
            fill={DETAIL_CIRCLE_COLOR}
          >
            {m.letter}
          </text>
        </g>
      ))}
      {dims}
    </g>
  );
}

// ─── broken view (W4-C): band collapse of a standard projection ──────────

const BREAK_LINE_COLOR = '#b45309';
/** Renderer default for the visual gap when the IR leaves it unset (mm in
 *  view-plane units, clamped below the band so the collapse stays valid). */
function defaultBreakGap(bandWidth: number): number {
  return Math.min(4, bandWidth / 2);
}

interface BrokenGeometryProps {
  viewportId: string;
  poly: Polyhedron;
  projection: {
    view: ProjView;
    axis: 'x' | 'y';
    breakStart: number;
    breakEnd: number;
    gap?: number;
  };
  box: ResolvedBox;
  showHiddenLines?: boolean;
}

/**
 * Project the standard view, collapse the break band (applyViewBreak — exact
 * segment clipping, no resampling), fit the RESULT into the viewport box and
 * draw it with zigzag break lines at the two cut edges. An invalid band
 * (applyViewBreak throws) renders nothing rather than an un-broken view that
 * would silently misrepresent the IR.
 */
function BrokenGeometry({
  viewportId,
  poly,
  projection,
  box,
  showHiddenLines = true,
}: BrokenGeometryProps): React.ReactElement | null {
  const { view, axis, breakStart, breakEnd } = projection;
  const gap = projection.gap ?? defaultBreakGap(breakEnd - breakStart);
  const projected = projectPolyhedron(poly, view);
  let visible: ReturnType<typeof applyViewBreak>;
  let hidden: ReturnType<typeof applyViewBreak>;
  try {
    visible = applyViewBreak(projected.visible, { axis, breakStart, breakEnd, gap });
    hidden = applyViewBreak(projected.hidden, { axis, breakStart, breakEnd, gap });
  } catch {
    return null;
  }
  const all = [...visible.segments, ...hidden.segments];
  if (all.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of all) {
    minX = Math.min(minX, e.x1, e.x2); maxX = Math.max(maxX, e.x1, e.x2);
    minY = Math.min(minY, e.y1, e.y2); maxY = Math.max(maxY, e.y1, e.y2);
  }
  const geomW = maxX - minX;
  const geomH = maxY - minY;
  if (!(geomW > 0) && !(geomH > 0)) return null;
  const margin = Math.min(box.w, box.h) * GEOM_MARGIN_FRAC;
  const availW = Math.max(1e-6, box.w - 2 * margin);
  const availH = Math.max(1e-6, box.h - 2 * margin);
  const s = Math.min(geomW > 0 ? availW / geomW : Infinity, geomH > 0 ? availH / geomH : Infinity);
  const offX = box.x + (box.w - geomW * s) / 2;
  const offY = box.y + (box.h - geomH * s) / 2;
  const tx = (u: number): number => offX + (u - minX) * s;
  const ty = (v: number): number => offY + (maxY - v) * s;
  const strokeW = Math.max(0.15, Math.min(box.w, box.h) * 0.006);

  /** Zigzag break line at view-plane axis position `at`, spanning the
   *  perpendicular extent of the drawn geometry. */
  const zigzag = (at: number, key: string): React.ReactElement => {
    const periods = 6;
    const amp = Math.min(box.w, box.h) * 0.02;
    const pts: string[] = [];
    for (let i = 0; i <= periods * 2; i += 1) {
      const f = i / (periods * 2);
      const wave = (i % 2 === 0 ? 0 : i % 4 === 1 ? amp : -amp);
      if (axis === 'x') {
        const y = minY + f * geomH;
        pts.push(`${tx(at) + wave},${ty(y)}`);
      } else {
        const x = minX + f * geomW;
        pts.push(`${tx(x)},${ty(at) + wave}`);
      }
    }
    return (
      <polyline
        key={key}
        data-testid={`sheet-renderer-break-line-${viewportId}-${key}`}
        points={pts.join(' ')}
        fill="none"
        stroke={BREAK_LINE_COLOR}
        strokeWidth={strokeW * 0.8}
      />
    );
  };

  return (
    <g
      data-testid={`sheet-renderer-broken-geometry-${viewportId}`}
      data-visible={visible.segments.length}
      data-hidden={showHiddenLines ? hidden.segments.length : 0}
      data-break-shift={visible.shift}
    >
      {showHiddenLines
        ? hidden.segments.map((e, i) => (
            <line
              key={`h${i}`}
              x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
              stroke={GEOM_HIDDEN_STROKE}
              strokeWidth={strokeW}
              strokeDasharray={`${strokeW * 4} ${strokeW * 3}`}
            />
          ))
        : null}
      {visible.segments.map((e, i) => (
        <line
          key={`v${i}`}
          x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
          stroke={GEOM_VISIBLE_STROKE}
          strokeWidth={strokeW}
        />
      ))}
      {zigzag(visible.nearBreakAt, 'near')}
      {zigzag(visible.farBreakAt, 'far')}
    </g>
  );
}

// ─── detail view (W4-C): real magnified content ──────────────────────────

interface DetailGeometryProps {
  viewportId: string;
  poly: Polyhedron;
  sourceView: ProjView;
  /** Detail circle center + radius in the SOURCE view's view-plane mm. */
  center: { x: number; y: number };
  radius: number;
  box: ResolvedBox;
  showHiddenLines?: boolean;
}

/**
 * Real detail-view content: project the source view, clip its line work to
 * the detail circle (exact line–circle intersections), and map the circle
 * region onto the DetailCircle ring the viewport already draws (radius
 * 0.4·min(w,h), centered) — so the ring doubles as the clip boundary and the
 * magnification factor is implicit in the fit. Nothing outside the circle is
 * drawn (a detail view showing out-of-region geometry would be fabrication).
 */
function DetailGeometry({
  viewportId,
  poly,
  sourceView,
  center,
  radius,
  box,
  showHiddenLines = true,
}: DetailGeometryProps): React.ReactElement | null {
  if (!(radius > 0)) return null;
  const projected = projectPolyhedron(poly, sourceView);
  const visible = clipSegmentsToCircle(projected.visible, center, radius);
  const hidden = clipSegmentsToCircle(projected.hidden, center, radius);
  if (visible.length === 0 && hidden.length === 0) return null;
  // Map the circle (center, radius) onto the DetailCircle ring.
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const ringR = Math.min(box.w, box.h) * 0.4;
  const s = ringR / radius;
  const tx = (u: number): number => cx + (u - center.x) * s;
  const ty = (v: number): number => cy - (v - center.y) * s;
  const strokeW = Math.max(0.15, Math.min(box.w, box.h) * 0.006);

  return (
    <g
      data-testid={`sheet-renderer-detail-geometry-${viewportId}`}
      data-visible={visible.length}
      data-hidden={showHiddenLines ? hidden.length : 0}
    >
      {showHiddenLines
        ? hidden.map((e, i) => (
            <line
              key={`h${i}`}
              x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
              stroke={GEOM_HIDDEN_STROKE}
              strokeWidth={strokeW}
              strokeDasharray={`${strokeW * 4} ${strokeW * 3}`}
            />
          ))
        : null}
      {visible.map((e, i) => (
        <line
          key={`v${i}`}
          x1={tx(e.x1)} y1={ty(e.y1)} x2={tx(e.x2)} y2={ty(e.y2)}
          stroke={GEOM_VISIBLE_STROKE}
          strokeWidth={strokeW}
        />
      ))}
    </g>
  );
}

interface AutoDimArgs {
  viewportId: string;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  geomW: number;
  geomH: number;
  s: number;
  tx: (u: number) => number;
  ty: (v: number) => number;
  strokeW: number;
}

/**
 * Overall width (along the bottom) + height (along the left) dimensions built
 * from the projected bbox. dimensionAnchor computes the geometry in view-plane
 * mm; we map each point through the same fit transform and label with the
 * true-mm formatted value.
 */
function renderAutoDimensions(a: AutoDimArgs): React.ReactElement {
  const { viewportId, bbox, geomW, geomH, s, tx, ty, strokeW } = a;
  const span = Math.max(geomW, geomH);
  const off = span * 0.12; // perpendicular offset in view-plane mm
  const gap = span * 0.02;
  const widthDim = buildLinearDimension(
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.maxX, y: bbox.minY },
    { axis: 'x', offset: -off, extensionGap: gap, extensionOverrun: gap },
  );
  const heightDim = buildLinearDimension(
    { x: bbox.minX, y: bbox.minY },
    { x: bbox.minX, y: bbox.maxY },
    { axis: 'y', offset: -off, extensionGap: gap, extensionOverrun: gap },
  );
  const map = (p: Pt): Pt => ({ x: tx(p.x), y: ty(p.y) });
  const seg = (key: string, p: Pt, q: Pt): React.ReactElement => {
    const a2 = map(p);
    const b2 = map(q);
    return <line key={key} x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke={GEOM_DIM_COLOR} strokeWidth={strokeW * 0.7} />;
  };
  const fontSize = Math.max(2, s * span * 0.05);
  const renderOne = (id: string, g: ReturnType<typeof buildLinearDimension>): React.ReactElement => {
    const anchor = map(g.textAnchor);
    return (
      <g key={id} data-testid={`sheet-renderer-vp-dim-${viewportId}-${id}`} data-dim-value={g.formatted}>
        {seg(`${id}-e1`, g.extension1[0], g.extension1[1])}
        {seg(`${id}-e2`, g.extension2[0], g.extension2[1])}
        {seg(`${id}-d`, g.dimensionLine[0], g.dimensionLine[1])}
        <text
          x={anchor.x}
          y={anchor.y}
          fontSize={fontSize}
          fontFamily="ui-sans-serif, system-ui, sans-serif"
          fill={GEOM_DIM_COLOR}
          textAnchor="middle"
          transform={id === 'h' ? `rotate(-90 ${anchor.x} ${anchor.y})` : undefined}
        >
          {g.formatted}
        </text>
      </g>
    );
  };
  return (
    <g data-testid={`sheet-renderer-vp-dim-${viewportId}`}>
      {renderOne('w', widthDim)}
      {renderOne('h', heightDim)}
    </g>
  );
}

// ─── section view: real cross-section (outline + hatch) ──────────────────
// Wires the standalone generateSection() into the renderer: cut the source
// solid with the viewport's plane, project the cross-section to the plane's
// 2-D frame, fit it into the viewport box (uniform scale, centered — same as
// ProjectedGeometry), and draw the closed outline + cross-hatch. (2026-06-13)

interface SectionGeometryProps {
  viewportId: string;
  poly: Polyhedron;
  plane: CuttingPlane;
  kind: SectionKind;
  box: { x: number; y: number; w: number; h: number };
}

function SectionGeometry({ viewportId, poly, plane, kind, box }: SectionGeometryProps): React.ReactElement | null {
  // Polyhedron ({x,y,z} verts + per-face vertex-index loops) → flat triangle
  // array (fan-triangulated) for generateSection.
  const triangles: Array<[[number, number, number], [number, number, number], [number, number, number]]> = [];
  for (const f of poly.faces) {
    const vs = f.vertices;
    for (let k = 1; k + 1 < vs.length; k++) {
      const a = poly.vertices[vs[0]!];
      const b = poly.vertices[vs[k]!];
      const c = poly.vertices[vs[k + 1]!];
      if (!a || !b || !c) continue;
      triangles.push([[a.x, a.y, a.z], [b.x, b.y, b.z], [c.x, c.y, c.z]]);
    }
  }
  const section = generateSection({ triangles, kind, plane });

  // Outline polygons are 3-D points on the plane → project to the plane's 2-D
  // (u,v) frame. Hatch lines are already in that 2-D frame.
  const { u, v } = planeBasis(plane.normal);
  const polys2d = section.polygons.map(pg => pg.points.map(p => project2D(p, plane.origin, u, v)));
  const hatch2d = section.hatchLines.map(h => [h.start, h.end] as const);

  const allPts: Array<[number, number]> = [...polys2d.flat(), ...hatch2d.flatMap(([s, e]) => [s, e])];
  if (allPts.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of allPts) {
    if (x < minX) minX = x; if (y < minY) minY = y;
    if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  const geomW = maxX - minX, geomH = maxY - minY;
  const margin = Math.min(box.w, box.h) * 0.1;
  const availW = Math.max(1e-6, box.w - 2 * margin);
  const availH = Math.max(1e-6, box.h - 2 * margin);
  const sRaw = Math.min(geomW > 0 ? availW / geomW : Infinity, geomH > 0 ? availH / geomH : Infinity);
  const s = Number.isFinite(sRaw) ? sRaw : 1;
  const offX = box.x + (box.w - geomW * s) / 2;
  const offY = box.y + (box.h - geomH * s) / 2;
  const tx = (x: number): number => offX + (x - minX) * s;
  const ty = (y: number): number => offY + (maxY - y) * s; // flip Y for SVG
  const strokeW = Math.max(0.15, Math.min(box.w, box.h) * 0.006);

  return (
    <g data-testid={`sheet-renderer-section-geometry-${viewportId}`}>
      {polys2d.map((pg, i) => (
        <path
          key={`o${i}`}
          data-testid={`section-outline-${viewportId}-${i}`}
          d={pg.map((pt, j) => `${j === 0 ? 'M' : 'L'} ${tx(pt[0]).toFixed(3)} ${ty(pt[1]).toFixed(3)}`).join(' ') + ' Z'}
          fill="none"
          stroke={VP_BORDER_STROKE}
          strokeWidth={strokeW}
        />
      ))}
      {hatch2d.map(([a, b], i) => (
        <line
          key={`h${i}`}
          data-testid={`section-hatch-${viewportId}-${i}`}
          x1={tx(a[0])}
          y1={ty(a[1])}
          x2={tx(b[0])}
          y2={ty(b[1])}
          stroke={VP_BORDER_STROKE}
          strokeWidth={strokeW * 0.5}
          opacity={0.6}
        />
      ))}
    </g>
  );
}

// ─── section view: cutting-plane indicator arrows ────────────────────────

interface SectionArrowsProps {
  viewport: Viewport;
  box: ResolvedBox;
}

/**
 * Cutting-plane indicator. Renders one of four variants (spec FULL §8.2):
 *
 *   - 'full'    — horizontal dashed line spanning the viewport, arrows at
 *                 both ends pointing inward (current behavior).
 *   - 'half'    — horizontal dashed line + ONE arrow on the side that
 *                 carries the cut (selected by `side`; default 'near' →
 *                 left arrow only).
 *   - 'offset'  — polyline of the IR's `cuttingPath` (mapped from the
 *                 source viewport's drawing coords into this viewport's
 *                 box) with an arrowhead at each endpoint.
 *   - 'aligned' — same visual as 'offset' for Phase 4.1.2; the actual
 *                 unfold of segments to a flat plane lands in Phase 4.2
 *                 when the OCCT HLR pipeline is wired.
 *
 * Phase 2 will rotate / position lines according to the actual projected
 * cutting plane on the source viewport; this Phase 1 pass conveys "this
 * is a section view" without faking geometry.
 */
function SectionArrows({ viewport, box }: SectionArrowsProps): React.ReactElement {
  if (viewport.projection.kind !== 'section') {
    throw new Error('SectionArrows: viewport is not a section projection');
  }
  const proj = viewport.projection;
  const variant = effectiveSectionType(proj);
  const armLen = Math.min(box.w * 0.15, 8);
  const arrowSize = Math.max(1.5, box.h * 0.02);
  const labelFontSize = Math.max(2.5, box.h * 0.04);

  const commonProps = {
    'data-testid': `sheet-renderer-section-arrows-${viewport.id}`,
    'data-section-type': variant,
    stroke: SECTION_ARROW_COLOR,
    strokeWidth: 0.5,
    fill: SECTION_ARROW_COLOR,
  } as const;

  if (variant === 'offset' || variant === 'aligned') {
    return (
      <SectionPolyline
        viewport={viewport}
        box={box}
        path={proj.cuttingPath ?? []}
        arrowSize={arrowSize}
        labelFontSize={labelFontSize}
        commonProps={commonProps}
      />
    );
  }

  // 'full' and 'half' share the straight-line layout; 'half' just drops one arrow.
  const midY = box.y + box.h / 2;
  const xLeft = box.x - armLen;
  const xRight = box.x + box.w + armLen;
  const showLeft = variant === 'half' ? (proj.side ?? 'near') === 'near' : true;
  const showRight = variant === 'half' ? (proj.side ?? 'near') === 'far' : true;

  return (
    <g {...commonProps}>
      {/* dashed cutting line crossing the viewport */}
      <line
        x1={xLeft}
        y1={midY}
        x2={xRight}
        y2={midY}
        strokeDasharray="3 1.5"
      />
      {showLeft ? (
        // left arrow head (pointing right, into the viewport)
        <polygon
          points={`${box.x},${midY} ${box.x - arrowSize},${midY - arrowSize} ${box.x - arrowSize},${midY + arrowSize}`}
        />
      ) : null}
      {showRight ? (
        // right arrow head (pointing left, into the viewport)
        <polygon
          points={`${box.x + box.w},${midY} ${box.x + box.w + arrowSize},${midY - arrowSize} ${box.x + box.w + arrowSize},${midY + arrowSize}`}
        />
      ) : null}
      {/* end-labels — the IR carries the cutting plane id, surface as a hint */}
      {showLeft ? (
        <text
          x={xLeft - 1}
          y={midY - arrowSize - 1}
          fontSize={labelFontSize}
          fontFamily="system-ui, sans-serif"
          textAnchor="end"
          stroke="none"
        >
          {proj.cuttingPlaneId}
        </text>
      ) : null}
      {showRight ? (
        <text
          x={xRight + 1}
          y={midY - arrowSize - 1}
          fontSize={labelFontSize}
          fontFamily="system-ui, sans-serif"
          textAnchor="start"
          stroke="none"
        >
          {proj.cuttingPlaneId}
        </text>
      ) : null}
    </g>
  );
}

// ─── section view: offset / aligned polyline ─────────────────────────────

interface SectionPolylineProps {
  viewport: Viewport;
  box: ResolvedBox;
  path: ReadonlyArray<{ x: number; y: number }>;
  arrowSize: number;
  labelFontSize: number;
  commonProps: {
    'data-testid': string;
    'data-section-type': string;
    stroke: string;
    strokeWidth: number;
    fill: string;
  };
}

/**
 * Render an offset/aligned cutting polyline inside the viewport box.
 *
 * The IR's `cuttingPath` lives in SOURCE viewport drawing coords (mm).
 * Without the source viewport's resolved geometry available at this
 * Phase 1 stub (Phase 2 wires the source-coord projection), we normalize
 * the path's own bounding box and map it to fit inside this viewport's
 * box with a small inset — that preserves the polyline's SHAPE so users
 * can see the cut pattern, while leaving exact placement for Phase 2.
 */
function SectionPolyline({
  viewport,
  box,
  path,
  arrowSize,
  labelFontSize,
  commonProps,
}: SectionPolylineProps): React.ReactElement {
  if (viewport.projection.kind !== 'section') {
    throw new Error('SectionPolyline: viewport is not a section projection');
  }
  const proj = viewport.projection;

  // Map source-viewport coords → this viewport's box. Phase 2 will instead
  // project the path through the same camera that draws the geometry.
  const mapped = mapPathToBox(path, box);
  const first = mapped[0];
  const last = mapped[mapped.length - 1];
  const pointsAttr = mapped.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <g {...commonProps}>
      <polyline
        data-testid={`sheet-renderer-section-polyline-${viewport.id}`}
        points={pointsAttr}
        fill="none"
        strokeDasharray="3 1.5"
      />
      {/* Endpoint arrowheads — small triangles centered on the endpoints. */}
      <polygon
        data-testid={`sheet-renderer-section-arrow-start-${viewport.id}`}
        points={`${first.x},${first.y} ${first.x - arrowSize},${first.y - arrowSize} ${first.x - arrowSize},${first.y + arrowSize}`}
      />
      <polygon
        data-testid={`sheet-renderer-section-arrow-end-${viewport.id}`}
        points={`${last.x},${last.y} ${last.x + arrowSize},${last.y - arrowSize} ${last.x + arrowSize},${last.y + arrowSize}`}
      />
      {/* End-labels — same convention as the straight variants. */}
      <text
        x={first.x - arrowSize - 1}
        y={first.y - arrowSize - 1}
        fontSize={labelFontSize}
        fontFamily="system-ui, sans-serif"
        textAnchor="end"
        stroke="none"
      >
        {proj.cuttingPlaneId}
      </text>
      <text
        x={last.x + arrowSize + 1}
        y={last.y - arrowSize - 1}
        fontSize={labelFontSize}
        fontFamily="system-ui, sans-serif"
        textAnchor="start"
        stroke="none"
      >
        {proj.cuttingPlaneId}
      </text>
    </g>
  );
}

/**
 * Fit a path into the viewport box (with a small inset) by translating /
 * uniformly scaling its bounding box. Degenerate inputs (single point /
 * zero-extent box) collapse to the viewport centre.
 */
function mapPathToBox(
  path: ReadonlyArray<{ x: number; y: number }>,
  box: ResolvedBox,
): Array<{ x: number; y: number }> {
  if (path.length === 0) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return [{ x: cx, y: cy }];
  }
  const inset = Math.min(box.w, box.h) * 0.1;
  const targetW = Math.max(0, box.w - inset * 2);
  const targetH = Math.max(0, box.h - inset * 2);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of path) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const srcW = maxX - minX;
  const srcH = maxY - minY;
  if (srcW === 0 && srcH === 0) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    return path.map(() => ({ x: cx, y: cy }));
  }
  const sx = srcW > 0 ? targetW / srcW : 1;
  const sy = srcH > 0 ? targetH / srcH : 1;
  const s = Math.min(sx, sy);
  // Center the scaled path inside the box.
  const offsetX = box.x + (box.w - srcW * s) / 2;
  const offsetY = box.y + (box.h - srcH * s) / 2;
  return path.map((p) => ({
    x: offsetX + (p.x - minX) * s,
    // Source path is in drawing-mm with sheet-style (bottom-left) coords;
    // SVG y is top-down, so flip within the local bounding box.
    y: offsetY + (srcH - (p.y - minY)) * s,
  }));
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

// ─── dimensions (Phase 4.2 — placeholder placement) ─────────────────────

interface DimensionLayerProps {
  dimension: Dimension;
  box: ResolvedBox;
  index: number;
  /**
   * measureDimension() result for this dimension, or null when no topology
   * was supplied / the target viewport is not a standard view.
   */
  measured?: MeasureResult | null;
}

/**
 * Renders a dimension as a horizontal call stacked inside its target
 * viewport. The label value resolution order (W4-A):
 *   1. `valueOverride` — existing IR contract, always wins;
 *   2. a successful measureDimension() value (real, never fabricated);
 *   3. the `<kind>` placeholder (no topology, non-standard view, or an
 *      EXPLICIT measurement failure — reason on `data-dim-measured`).
 *
 * Visual layout:
 *   ├─── nominal · tolerance ───┤
 */
function DimensionLayer({ dimension, box, index, measured }: DimensionLayerProps): React.ReactElement {
  const arrowSize = Math.max(1.5, box.h * 0.02);
  const fontSize = Math.max(2.5, box.h * 0.04);
  // Stack dimensions vertically inside the viewport box.
  const rowStride = fontSize * 2.4;
  const rowOffset = (index % 3) * rowStride;
  const midY = box.y + box.h / 2 + rowOffset - rowStride;
  // Horizontal extents of the dim line — a bit inset from the viewport edges.
  const inset = Math.min(box.w * 0.1, 4);
  const x1 = box.x + inset;
  const x2 = box.x + box.w - inset;
  const measuredOk = measured && measured.ok ? measured : null;
  const measuredFail = measured && !measured.ok ? measured : null;
  const nominal =
    dimension.valueOverride !== undefined
      ? dimension.valueOverride.toString()
      : measuredOk
        ? formatMeasuredValue(measuredOk.value)
        : `<${dimension.kind}>`;
  // Drafting-convention decorations, only around a REAL number and only when
  // the author didn't set their own prefix/suffix.
  const autoPrefix =
    measuredOk && dimension.valueOverride === undefined && dimension.prefix === undefined
      ? dimension.kind === 'diametric' ? '⌀' : dimension.kind === 'radial' ? 'R' : ''
      : '';
  const autoSuffix =
    measuredOk && dimension.valueOverride === undefined && dimension.suffix === undefined
      ? measuredOk.unit === 'deg' ? '°' : ''
      : '';
  const tolerance = dimension.tolerance ? formatTolerance(dimension.tolerance) : '';
  const label = `${dimension.prefix ?? autoPrefix}${nominal}${autoSuffix}${tolerance}${dimension.suffix ?? ''}`;

  return (
    <g
      data-testid={`sheet-renderer-dim-${index}`}
      data-dim-id={dimension.id}
      data-dim-kind={dimension.kind}
      data-dim-viewport={dimension.viewportId}
      data-dim-measured={measuredOk ? 'ok' : measuredFail ? measuredFail.reason : 'none'}
      data-dim-value={measuredOk ? String(measuredOk.value) : undefined}
      data-dim-foreshortened={measuredOk?.foreshortened ? 'true' : undefined}
      stroke={DIM_STROKE}
      strokeWidth={0.3}
      fill={DIM_STROKE}
    >
      {/* Explicit failure diagnosis as an SVG tooltip — visible on hover,
          never printed as a number (값 날조 금지). */}
      {measuredFail ? <title>{measuredFail.detail}</title> : null}
      {/* dim line */}
      <line x1={x1} y1={midY} x2={x2} y2={midY} />
      {/* left arrowhead (pointing right) */}
      <polygon
        points={`${x1},${midY} ${x1 + arrowSize},${midY - arrowSize / 2} ${x1 + arrowSize},${midY + arrowSize / 2}`}
      />
      {/* right arrowhead (pointing left) */}
      <polygon
        points={`${x2},${midY} ${x2 - arrowSize},${midY - arrowSize / 2} ${x2 - arrowSize},${midY + arrowSize / 2}`}
      />
      {/* extension witnesses */}
      <line x1={x1} y1={midY - arrowSize * 1.5} x2={x1} y2={midY + arrowSize * 1.5} />
      <line x1={x2} y1={midY - arrowSize * 1.5} x2={x2} y2={midY + arrowSize * 1.5} />
      {/* label above the dim line */}
      <text
        x={(x1 + x2) / 2}
        y={midY - arrowSize - 0.5}
        fontSize={fontSize}
        fontFamily="system-ui, sans-serif"
        fill={DIM_TEXT_COLOR}
        textAnchor="middle"
        stroke="none"
      >
        {label}
      </text>
    </g>
  );
}

// ─── GD&T callouts (Phase 4.2) ───────────────────────────────────────────

interface GdtLayerProps {
  gdt: GdtCallout;
  box: ResolvedBox;
  index: number;
}

/**
 * Renders a GD&T feature control frame as a bordered textbox above the
 * top-right corner of the target viewport. Each callout in a sheet is
 * offset vertically so multiple stack cleanly.
 */
function GdtLayer({ gdt, box, index }: GdtLayerProps): React.ReactElement {
  const fontSize = Math.max(2.5, box.h * 0.04);
  const padding = fontSize * 0.4;
  const text = formatGdt(gdt);
  // Approximate box width from text length (monospace-ish heuristic).
  const boxW = Math.max(20, text.length * fontSize * 0.55 + padding * 2);
  const boxH = fontSize + padding * 2;
  // Anchor: top-right of viewport, stacked downward by index.
  const x = box.x + box.w - boxW;
  const y = box.y - boxH - 1 + index * (boxH + 1);

  return (
    <g
      data-testid={`sheet-renderer-gdt-${index}`}
      data-gdt-id={gdt.id}
      data-gdt-kind={gdt.kind}
      data-gdt-viewport={gdt.viewportId}
    >
      <rect
        x={x}
        y={y}
        width={boxW}
        height={boxH}
        fill={GDT_BG}
        stroke={GDT_STROKE}
        strokeWidth={0.3}
      />
      <text
        x={x + padding}
        y={y + boxH / 2}
        fontSize={fontSize}
        fontFamily="ui-monospace, SFMono-Regular, monospace"
        fill={GDT_STROKE}
        dominantBaseline="middle"
      >
        {text}
      </text>
    </g>
  );
}

// ─── manufacturing-symbol callout (surface finish / weld) ───────────────────

interface SymbolCalloutProps {
  testid: string;
  dataKind: string;
  targetId: string;
  box: ResolvedBox;
  index: number;
  text: string;
  color: string;
}

/**
 * A single text callout (surface-finish or weld) anchored just below the
 * target viewport's lower-left corner, stacked downward by index so multiple
 * callouts on one viewport don't overlap. Phase 4.2 renders the formatted text
 * with a leading glyph; a graphical renderer can swap in true ISO/AWS symbols.
 */
function SymbolCallout({
  testid,
  dataKind,
  targetId,
  box,
  index,
  text,
  color,
}: SymbolCalloutProps): React.ReactElement {
  const fontSize = Math.max(2.5, box.h * 0.045);
  const x = box.x + 1;
  const y = box.y + box.h + fontSize * (1.4 + index * 1.4);
  return (
    <text
      data-testid={testid}
      data-symbol-kind={dataKind}
      data-symbol-target={targetId}
      x={x}
      y={y}
      fontSize={fontSize}
      fontFamily="ui-sans-serif, system-ui, sans-serif"
      fill={color}
    >
      {text}
    </text>
  );
}

// ─── ordinate dimension chain ──────────────────────────────────────────────

interface OrdinateChainLayerProps {
  chain: OrdinateDimensionChain;
  paperHeightMm: number;
}

/**
 * Render one ordinate chain: the datum origin marker, a leader line per
 * (point, axis), and the formatted value at each leader's text anchor. Chain
 * coords are sheet mm-space with a bottom-left (Y-up) origin, so every Y is
 * flipped to the SVG's top-left frame via `paperHeightMm - y` — the same
 * convention the rest of the renderer uses. A malformed chain (which the
 * engine would throw on) is skipped rather than crashing the whole sheet.
 */
function OrdinateChainLayer({
  chain,
  paperHeightMm,
}: OrdinateChainLayerProps): React.ReactElement | null {
  let hints: ReturnType<typeof buildOrdinateRenderHints>;
  try {
    hints = buildOrdinateRenderHints(chain);
  } catch {
    return null;
  }
  const flipY = (y: number): number => paperHeightMm - y;
  const ox = chain.origin.x;
  const oy = flipY(chain.origin.y);

  return (
    <g data-testid={`sheet-renderer-ordinate-${chain.id}`} data-ordinate-id={chain.id}>
      {/* datum origin marker */}
      <circle cx={ox} cy={oy} r={0.8} fill={ORDINATE_STROKE} />
      {hints.map((hint, i) => {
        const sx = hint.leaderStart.x;
        const sy = flipY(hint.leaderStart.y);
        const ex = hint.leaderEnd.x;
        const ey = flipY(hint.leaderEnd.y);
        return (
          <g
            key={`${hint.pointId}-${hint.axis}-${i}`}
            data-ordinate-point={hint.pointId}
            data-ordinate-axis={hint.axis}
          >
            <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={ORDINATE_STROKE} strokeWidth={0.3} />
            <circle cx={sx} cy={sy} r={0.5} fill={ORDINATE_STROKE} />
            <text
              x={ex}
              y={ey}
              fontSize={2.6}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fill={ORDINATE_TEXT_COLOR}
              dominantBaseline="middle"
              // Y-axis labels read bottom→top per ISO; rotate about the anchor.
              transform={hint.axis === 'y' ? `rotate(-90 ${ex} ${ey})` : undefined}
            >
              {hint.formatted}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// ─── hole table ────────────────────────────────────────────────────────────

interface HoleTableLayerProps {
  holes: NonNullable<Sheet['holes']>;
  paperWidthMm: number;
}

const HOLE_TABLE_STROKE = '#334155';

/**
 * Render a hole schedule (Phase 4.3) as a small grid in the top-right corner.
 * Rows come from buildHoleTable (identical holes grouped + auto-tagged). A
 * malformed hole list throws inside buildHoleTable; we guard and skip.
 */
function HoleTableLayer({ holes, paperWidthMm }: HoleTableLayerProps): React.ReactElement | null {
  let rows: ReturnType<typeof buildHoleTable>;
  try {
    rows = buildHoleTable(holes, { groupIdentical: true });
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  const cols: Array<{ key: keyof (typeof rows)[number] | 'qty'; label: string; w: number }> = [
    { key: 'tag', label: 'TAG', w: 10 },
    { key: 'x', label: 'X', w: 14 },
    { key: 'y', label: 'Y', w: 14 },
    { key: 'diameter', label: '⌀', w: 12 },
    { key: 'depthLabel', label: 'DEPTH', w: 18 },
    { key: 'qty', label: 'QTY', w: 10 },
  ];
  const tableW = cols.reduce((a, c) => a + c.w, 0);
  const rowH = 5;
  const x0 = paperWidthMm - tableW - 6;
  const y0 = 8;
  const fontSize = 3;

  const cellText = (r: (typeof rows)[number], key: string): string => {
    switch (key) {
      case 'tag': return r.tag;
      case 'x': return r.x.toString();
      case 'y': return r.y.toString();
      case 'diameter': return `⌀${r.diameter}`;
      case 'depthLabel': return r.depthLabel;
      case 'qty': return String(r.count);
      default: return '';
    }
  };

  return (
    <g data-testid="sheet-renderer-hole-table" data-rows={rows.length}>
      {/* header + body rows */}
      {[{ header: true }, ...rows.map((r) => ({ header: false, r }))].map((entry, ri) => {
        const y = y0 + ri * rowH;
        let cx = x0;
        return (
          <g key={ri} data-hole-row={ri === 0 ? 'header' : (entry as { r: (typeof rows)[number] }).r.tag}>
            <rect
              x={x0} y={y} width={tableW} height={rowH}
              fill={ri === 0 ? '#e2e8f0' : '#ffffff'}
              stroke={HOLE_TABLE_STROKE} strokeWidth={0.2}
            />
            {cols.map((c) => {
              const tx = cx + 1;
              cx += c.w;
              const text = ri === 0 ? c.label : cellText((entry as { r: (typeof rows)[number] }).r, c.key as string);
              return (
                <text
                  key={c.key as string}
                  x={tx} y={y + rowH / 2}
                  fontSize={fontSize}
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                  fill={HOLE_TABLE_STROKE}
                  dominantBaseline="middle"
                >
                  {text}
                </text>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

// ─── BOM table (SolidWorks-parity Phase 3) ───────────────────────────────

interface BomTableLayerProps {
  rows: ReadonlyArray<BomItemRow>;
}

const BOM_TABLE_STROKE = '#334155';
const BALLOON_COLOR = '#0f172a';

/**
 * Render the assembly BOM block as a grid in the top-LEFT corner (the hole
 * table owns the top-right). Column labels are drafting-convention English
 * literals, same policy as HoleTableLayer.
 */
function BomTableLayer({ rows }: BomTableLayerProps): React.ReactElement {
  const cols: Array<{ key: 'itemNo' | 'name' | 'qty' | 'material'; label: string; w: number }> = [
    { key: 'itemNo', label: 'NO', w: 10 },
    { key: 'name', label: 'PART', w: 44 },
    { key: 'qty', label: 'QTY', w: 10 },
    { key: 'material', label: 'MATERIAL', w: 28 },
  ];
  const tableW = cols.reduce((a, c) => a + c.w, 0);
  const rowH = 6;
  const x0 = 6;
  const y0 = 8;
  const fontSize = 3;

  const cellText = (r: BomItemRow, key: (typeof cols)[number]['key']): string => {
    switch (key) {
      case 'itemNo': return String(r.itemNo);
      case 'name': return r.name;
      case 'qty': return String(r.qty);
      case 'material': return r.material;
      default: return '';
    }
  };

  return (
    <g data-testid="sheet-renderer-bom-table" data-rows={rows.length}>
      {[{ header: true as const }, ...rows.map((r) => ({ header: false as const, r }))].map(
        (entry, ri) => {
          const y = y0 + ri * rowH;
          let cx = x0;
          return (
            <g
              key={ri}
              data-bom-row={entry.header ? 'header' : String(entry.r.itemNo)}
            >
              <rect
                x={x0} y={y} width={tableW} height={rowH}
                fill={ri === 0 ? '#e2e8f0' : '#ffffff'}
                stroke={BOM_TABLE_STROKE} strokeWidth={0.2}
              />
              {cols.map((c) => {
                const tx = cx + 1;
                cx += c.w;
                const text = entry.header ? c.label : cellText(entry.r, c.key);
                return (
                  <text
                    key={c.key}
                    x={tx} y={y + rowH / 2}
                    fontSize={fontSize}
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                    fill={BOM_TABLE_STROKE}
                    dominantBaseline="middle"
                  >
                    {text}
                  </text>
                );
              })}
            </g>
          );
        },
      )}
    </g>
  );
}

// ─── BOM balloons ────────────────────────────────────────────────────────

interface BalloonLayerProps {
  balloons: ReadonlyArray<BomBalloon>;
  paperHeightMm: number;
}

/**
 * One balloon per part instance: a leader line from the circle rim to the
 * part anchor (small filled dot), plus a circled item number. Balloon IR
 * coords are bottom-left-origin sheet mm; SVG is top-left, so Y flips.
 */
function BalloonLayer({ balloons, paperHeightMm }: BalloonLayerProps): React.ReactElement {
  const flipY = (y: number): number => paperHeightMm - y;
  return (
    <g data-testid="sheet-renderer-balloons" data-count={balloons.length}>
      {balloons.map((b) => {
        const cx = b.center.x;
        const cy = flipY(b.center.y);
        const ax = b.anchor.x;
        const ay = flipY(b.anchor.y);
        // Leader starts on the circle rim, pointing at the anchor.
        const dx = ax - cx;
        const dy = ay - cy;
        const len = Math.hypot(dx, dy);
        const sx = len > b.radius ? cx + (dx / len) * b.radius : cx;
        const sy = len > b.radius ? cy + (dy / len) * b.radius : cy;
        return (
          <g
            key={b.id}
            data-testid={`sheet-renderer-balloon-${b.id}`}
            data-balloon-item={b.itemNo}
          >
            <line
              x1={sx} y1={sy} x2={ax} y2={ay}
              stroke={BALLOON_COLOR} strokeWidth={0.3}
            />
            <circle cx={ax} cy={ay} r={0.7} fill={BALLOON_COLOR} />
            <circle
              cx={cx} cy={cy} r={b.radius}
              fill="#ffffff" stroke={BALLOON_COLOR} strokeWidth={0.4}
            />
            <text
              x={cx} y={cy}
              fontSize={b.radius}
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontWeight={600}
              fill={BALLOON_COLOR}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {b.itemNo}
            </text>
          </g>
        );
      })}
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
