/**
 * assemblyDrawing.ts — Phase C1 (조립 도면 v1).
 *
 * Composes per-part drawings + a BOM into a single sheet. Built on top of
 * `autoDrawing.generateDrawing` for the per-part projection so the per-
 * part logic stays single-sourced.
 *
 * v1 scope (per CAD_COMMERCIAL_COMPLETION_ROADMAP.md §Phase C1):
 *   - Take {geometry, transform, label, qty} per part
 *   - Produce one DrawingResult that embeds each part's primary view +
 *     a BOM (parts list) row block in the title-block area
 *   - Composite fingerprint covers ALL parts + transforms (stale banner
 *     for assembly works the same way as per-part)
 *
 * What this v1 does NOT do (Phase C/D follow-ups):
 *   - Section views, detail views, exploded views (Phase C2+)
 *   - GD&T datum frame transfer between parts (Phase C2)
 *   - Multi-sheet output (Phase D)
 *   - Auto-balloon placement (Phase D)
 */

import * as THREE from 'three';
import {
  computeDrawingGeometryFingerprint,
  generateDrawing,
  type DrawingConfig,
  type DrawingResult,
  type ProjectionView,
} from './autoDrawing';
import { layoutBalloons, type ViewBounds } from '../drawing/balloonCalloutLayout';

export interface AssemblyDrawingPart {
  /** Stable id used in BOM rows + fingerprint. */
  readonly id: string;
  /** User-visible label. Falls back to id. */
  readonly label?: string;
  /** Quantity in the assembly (default 1). */
  readonly qty?: number;
  /** Material (rendered in BOM). Defaults to titleBlock.material. */
  readonly material?: string;
  /** Mesh geometry. */
  readonly geometry: THREE.BufferGeometry;
  /** Optional 4x4 world transform for fingerprint purposes. */
  readonly transform?: THREE.Matrix4;
}

export interface AssemblyDrawingConfig extends DrawingConfig {
  /** Override the per-part projection view (defaults to ['iso']). */
  readonly perPartView?: ProjectionView;
}

export interface BomRow {
  readonly index: number;
  readonly id: string;
  readonly label: string;
  readonly qty: number;
  readonly material: string;
  readonly partFingerprint: string;
}

/** Canonical sheet-space callout consumed by all three drawing exporters. */
export interface AssemblyBalloon {
  readonly id: string;
  readonly itemNumber: number;
  /** Point on the corresponding part view (paper space, top-left origin). */
  readonly anchor: { readonly x: number; readonly y: number };
  /** Centre of the numbered balloon (paper space, top-left origin). */
  readonly balloonCentre: { readonly x: number; readonly y: number };
  readonly leader: readonly [{ readonly x: number; readonly y: number }, { readonly x: number; readonly y: number }];
  /** Alias retained for consumers that use the exploded-view vocabulary. */
  readonly position: { readonly x: number; readonly y: number };
}

export interface AssemblyDrawingResult extends DrawingResult {
  /** BOM rows ordered by stable part index. */
  readonly bom: readonly BomRow[];
  /** Per-part DrawingResults (same length / order as `bom`). */
  readonly perPart: readonly DrawingResult[];
  /** Composite fingerprint covering geometry + transforms + qty + label.
   *  Stable: identical assemblies produce identical strings. */
  readonly fingerprint: string;
  /** Numbered, anchored callouts rendered by PDF/DXF/SVG exporters. */
  readonly balloons: readonly AssemblyBalloon[];
}

/**
 * Single concise fingerprint covering each part's geometry, transform,
 * and BOM-affecting fields. Designed so the stale-banner check used by
 * `AutoDrawingPanel` for single parts works identically for assemblies.
 */
export function computeAssemblyFingerprint(parts: readonly AssemblyDrawingPart[]): string {
  const segments: string[] = [];
  for (const p of parts) {
    const geomFp = computeDrawingGeometryFingerprint(p.geometry);
    const transformFp = p.transform
      ? p.transform.elements.map((n) => n.toFixed(4)).join(',')
      : 'I';
    const qty = p.qty ?? 1;
    const mat = p.material ?? '';
    const label = p.label ?? p.id;
    segments.push(`${p.id}|${label}|${qty}|${mat}|${geomFp}|${transformFp}`);
  }
  return segments.join(';');
}

/**
 * Generate an assembly drawing. v1 lays out per-part views + appends a
 * BOM. Title block reused from the per-part config; BOM is supplemental
 * data on the result object (renderers add the rows below the title
 * block area).
 *
 * Empty parts list → throws (an empty assembly has no drawing).
 */
export function generateAssemblyDrawing(
  parts: readonly AssemblyDrawingPart[],
  config: AssemblyDrawingConfig,
): AssemblyDrawingResult {
  if (parts.length === 0) {
    throw new Error('generateAssemblyDrawing: parts list is empty');
  }

  const perPartView: ProjectionView = config.perPartView ?? 'iso';

  // Per-part drawings — single view each (the assembly sheet trades
  // multi-view richness for "you see every part on one page"). For
  // detailed per-part drawings the user opens the part separately.
  const perPart: DrawingResult[] = parts.map((p) => {
    const partConfig: DrawingConfig = {
      ...config,
      views: [perPartView],
      titleBlock: {
        ...config.titleBlock,
        partName: p.label ?? p.id,
        material: p.material ?? config.titleBlock.material,
      },
    };
    return generateDrawing(p.geometry, partConfig);
  });

  // BOM rows — one per part, indexed from 1 (per drafting convention).
  const bom: BomRow[] = parts.map((p, i) => ({
    index: i + 1,
    id: p.id,
    label: p.label ?? p.id,
    qty: p.qty ?? 1,
    material: p.material ?? config.titleBlock.material,
    partFingerprint: computeDrawingGeometryFingerprint(p.geometry),
  }));

  // Combined sheet — primary view from the FIRST part populates the
  // top-level DrawingResult so downstream PDF/DXF exporters can render
  // the "assembly overview" view; per-part details are in `perPart`.
  const paperWidth = perPart[0]!.paperWidth;
  const paperHeight = perPart[0]!.paperHeight;
  const tableHeight = 8 + bom.length * 6;
  const margin = 10;
  const titleReserve = 30;
  const viewBottom = Math.max(margin + 30, paperHeight - titleReserve - tableHeight - 5);
  const cols = parts.length <= 1 ? 1 : parts.length <= 4 ? 2 : 3;
  const rows = Math.ceil(parts.length / cols);
  const cellW = (paperWidth - margin * 2) / cols;
  const cellH = (viewBottom - margin) / rows;

  // Compose one deterministic sheet view per part. The previous path only
  // returned the first part's view, leaving every other BOM item unbound.
  const composedViews = perPart.map((partDrawing, i) => {
    const source = partDrawing.views[0]!;
    const fit = Math.min(1, (cellW - 20) / Math.max(source.width, 1), (cellH - 20) / Math.max(source.height, 1));
    const width = source.width * fit;
    const height = source.height * fit;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const position = { x: margin + col * cellW + (cellW - width) / 2, y: margin + row * cellH + (cellH - height) / 2 };
    return {
      projection: source.projection,
      lines: source.lines.map((line) => ({ ...line, x1: line.x1 * fit, y1: line.y1 * fit, x2: line.x2 * fit, y2: line.y2 * fit })),
      texts: (source.texts ?? []).map((tx) => ({ ...tx, x: tx.x * fit, y: tx.y * fit, fontSize: tx.fontSize * fit })),
      position, width, height,
    };
  });
  const viewBounds: ViewBounds = {
    minX: Math.min(...composedViews.map((v) => v.position.x)), minY: Math.min(...composedViews.map((v) => v.position.y)),
    maxX: Math.max(...composedViews.map((v) => v.position.x + v.width)), maxY: Math.max(...composedViews.map((v) => v.position.y + v.height)),
  };
  const anchors = composedViews.map((view, i) => {
    const lines = view.lines;
    const local = lines.length > 0 ? lines.reduce((acc, line) => ({ x: acc.x + (line.x1 + line.x2) / 2, y: acc.y + (line.y1 + line.y2) / 2 }), { x: 0, y: 0 }) : { x: view.width / 2, y: view.height / 2 };
    const count = Math.max(lines.length, 1);
    return { id: parts[i]!.id, itemNumber: i + 1, point: { x: view.position.x + local.x / count, y: view.position.y + view.height - local.y / count } };
  });
  const placed = layoutBalloons(anchors, viewBounds, { marginMm: 8, balloonRadiusMm: 4, minSeparationMm: 3 }).placed;
  const balloons: AssemblyBalloon[] = placed.map((p) => {
    const balloonCentre = { x: Math.max(5, Math.min(p.balloonCentre.x, paperWidth - 5)), y: Math.max(5, Math.min(p.balloonCentre.y, viewBottom - 5)) };
    return { id: p.id, itemNumber: p.itemNumber, anchor: p.anchor, balloonCentre, position: balloonCentre, leader: [balloonCentre, p.anchor] };
  });

  // Flatten the composed cells into one sheet view. This preserves the
  // historical `views.length === 1` contract while ensuring every anchor is
  // actually attached to geometry present in the exported view.
  const sheetView = {
    projection: composedViews[0]!.projection,
    lines: composedViews.flatMap((view) => view.lines.map((line) => ({
      ...line,
      x1: view.position.x + line.x1,
      x2: view.position.x + line.x2,
      y1: viewBottom - view.position.y - view.height + line.y1,
      y2: viewBottom - view.position.y - view.height + line.y2,
    }))),
    texts: composedViews.flatMap((view) => (view.texts ?? []).map((tx) => ({
      ...tx,
      x: view.position.x + tx.x,
      y: viewBottom - view.position.y - view.height + tx.y,
    }))),
    position: { x: 0, y: 0 },
    width: paperWidth,
    height: viewBottom,
  };

  return {
    views: [sheetView],
    titleBlock: config.titleBlock,
    tolerance: config.tolerance,
    paperWidth,
    paperHeight,
    bom,
    perPart,
    fingerprint: computeAssemblyFingerprint(parts),
    balloons,
  };
}
