/**
 * assemblyBomSheet — Phase 3 of the SolidWorks-parity roadmap
 * (docs/process/solidworks-parity-roadmap.md).
 *
 * Builds an assembly OVERVIEW drawing sheet: a single front-view viewport
 * of the whole assembly plus a BOM table block and auto-placed balloons
 * (one per part instance), all attached to the same Sheet IR — so the
 * PNG / PDF / print export paths inherit them for free.
 *
 * Balloon anchors: each part's projected 2D centroid in the front view
 * (u = world X, v = world Z — matching projectView's 'front' basis),
 * mapped through the SAME fit transform SheetRenderer applies to real
 * projected geometry (uniform scale, centered, GEOM_MARGIN_FRAC = 0.08
 * margin). When the caller also supplies the merged assembly polyhedron
 * to the renderer, balloons therefore align with the drawn edges.
 *
 * Pure logic only — React-free. Geometry-merge helpers for the renderer
 * live here too because they're sheet-building concerns, not UI.
 */

import {
  paperDimensions,
  validateSheet,
  type PaperSize,
  type Sheet,
  type Viewport,
} from './sheet';
import { viewportSheetBox } from './dxfExport';
import {
  buildBomRows,
  placeBalloons,
  bomGroupKey,
  bomItemNoIndex,
  BomBalloonError,
  type BalloonAnchor,
} from './bomBalloon';
import type { Polyhedron } from '@/lib/cad/featureMesh';

// ─── types ───────────────────────────────────────────────────────────────

export interface BomPartInput {
  /** Unique part-instance id (becomes the balloon id suffix). */
  id: string;
  /** Display name — the BOM dedup key together with `material`. */
  name: string;
  /** Optional material label; blank BOM column when missing. */
  material?: string;
  /** World-space axis-aligned bounding box of the instance (mm). */
  bbox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

export interface BuildAssemblyBomSheetOptions {
  id: string;
  name: string;
  /** Source model id the viewport carries (assembly id). */
  sourceId: string;
  /** Paper for the overview sheet. Default 'A3'. */
  paperSize?: PaperSize;
  parts: ReadonlyArray<BomPartInput>;
}

/** Mirrors SheetRenderer's GEOM_MARGIN_FRAC so anchors align with edges. */
const FIT_MARGIN_FRAC = 0.08;

// ─── builder ─────────────────────────────────────────────────────────────

/**
 * Build the assembly overview Sheet: one centred front viewport + BOM rows
 * + auto-placed balloons. Throws {@link BomBalloonError} on an empty part
 * list. The result passes {@link validateSheet}.
 */
export function buildAssemblyBomSheet(opts: BuildAssemblyBomSheetOptions): Sheet {
  if (opts.parts.length === 0) {
    throw new BomBalloonError('buildAssemblyBomSheet: parts must not be empty');
  }
  const paperSize = opts.paperSize ?? 'A3';
  const dim = paperDimensions(paperSize);

  const viewport: Viewport = {
    id: 'asm-front',
    sourceId: opts.sourceId,
    projection: { kind: 'standard', view: 'front' },
    centerOnSheet: { x: dim.width / 2, y: dim.height / 2 },
    widthOnSheet: dim.width * 0.5,
    scale: 1,
    label: 'ASSEMBLY — FRONT',
  };
  const box = viewportSheetBox(viewport);

  // Front view (projectView basis): u = world X, v = world Z.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of opts.parts) {
    minU = Math.min(minU, p.bbox.min.x);
    maxU = Math.max(maxU, p.bbox.max.x);
    minV = Math.min(minV, p.bbox.min.z);
    maxV = Math.max(maxV, p.bbox.max.z);
  }
  const geomW = maxU - minU;
  const geomH = maxV - minV;

  // Same fit transform as SheetRenderer's ProjectedGeometry: uniform scale,
  // centered, margin = min(box.w, box.h) * FIT_MARGIN_FRAC. Sheet IR is
  // bottom-left Y-up like the view plane, so no flip is needed here.
  const margin = Math.min(box.w, box.h) * FIT_MARGIN_FRAC;
  const availW = Math.max(1e-6, box.w - 2 * margin);
  const availH = Math.max(1e-6, box.h - 2 * margin);
  const s = Math.min(
    geomW > 0 ? availW / geomW : Infinity,
    geomH > 0 ? availH / geomH : Infinity,
  );
  const sFinite = Number.isFinite(s) ? s : 1; // degenerate: all parts coplanar points
  const offX = box.x + (box.w - geomW * sFinite) / 2;
  const offY = box.y + (box.h - geomH * sFinite) / 2;
  const toSheet = (u: number, v: number): { x: number; y: number } => ({
    x: offX + (u - minU) * sFinite,
    y: offY + (v - minV) * sFinite,
  });

  const rows = buildBomRows(opts.parts);
  const itemNoByKey = bomItemNoIndex(rows);

  const anchors: BalloonAnchor[] = opts.parts.map((p) => {
    const cu = (p.bbox.min.x + p.bbox.max.x) / 2;
    const cv = (p.bbox.min.z + p.bbox.max.z) / 2;
    return {
      id: p.id,
      itemNo: itemNoByKey.get(bomGroupKey(p))!,
      anchor: toSheet(cu, cv),
    };
  });
  const balloons = placeBalloons({ anchors, box });

  const sheet: Sheet = {
    id: opts.id,
    name: opts.name,
    paperSize,
    viewports: [viewport],
    bom: rows,
    balloons,
  };
  validateSheet(sheet);
  return sheet;
}

// ─── geometry merge (renderer feed) ──────────────────────────────────────

/**
 * Merge per-part polyhedra (each with a world-space offset) into a single
 * polyhedron the SheetRenderer can project for the assembly viewport.
 * Returns null when the list is empty.
 */
export function mergePolyhedra(
  items: ReadonlyArray<{ poly: Polyhedron; offset: { x: number; y: number; z: number } }>,
): Polyhedron | null {
  if (items.length === 0) return null;
  const vertices: Polyhedron['vertices'] = [];
  const faces: Polyhedron['faces'] = [];
  for (const { poly, offset } of items) {
    const base = vertices.length;
    for (const v of poly.vertices) {
      vertices.push({ x: v.x + offset.x, y: v.y + offset.y, z: v.z + offset.z });
    }
    for (const f of poly.faces) {
      faces.push({
        vertices: f.vertices.map((i) => i + base),
        normal: { ...f.normal },
      });
    }
  }
  return { vertices, faces };
}
