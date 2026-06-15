/**
 * sheetSnap — cursor snap target detection for the drawing sheet editor.
 *
 * Phase 4.7 of NexyFab Pro own-CAD (ADR-013).
 *
 * Pure-math helper that, given a cursor position in sheet space (mm from
 * sheet origin) and a Sheet IR, returns the best snap target for placing
 * dimensions / annotations. Snap candidates are drawn from:
 *
 *   - Grid points (regular lattice of `gridSpacing` mm, anchored at the
 *     sheet origin).
 *   - Viewport corners (the 4 axis-aligned corners of each viewport's
 *     bounding box on the sheet).
 *   - Viewport edge midpoints (the 4 midpoints of each viewport box's
 *     edges).
 *   - Viewport centers (the position stored in `Viewport.centerOnSheet`).
 *
 * Viewport box derivation: a viewport's `widthOnSheet` is authoritative;
 * its height is derived as `widthOnSheet * 0.75` (a 4:3 aspect), matching
 * the placeholder bbox the DXF emitter uses (`viewportSheetBox` in
 * `dxfExport.ts`). When Phase 4.x replaces the placeholder bbox with the
 * projected geometry's true extents, this module's `viewportBoxCorners`
 * helper is the single point of update.
 *
 * Design intent:
 *   - DOM-free, side-effect-free, trivially testable.
 *   - Hosts (SheetRenderer + dimension placement tool) decide when to
 *     call this and what threshold to pass; this module just ranks
 *     candidates and returns the winner.
 *   - Distance threshold (`pointRadius`) is interpreted in sheet mm.
 *     The caller is responsible for converting from pixel-radius to mm
 *     if the sheet view is zoomed.
 *
 * Algorithm:
 *   1. Build the candidate set from each enabled source:
 *        - viewport_corner    → 4 per viewport
 *        - viewport_midpoint  → 4 per viewport (edge midpoints)
 *        - viewport_center    → 1 per viewport
 *        - grid               → cursor rounded to nearest lattice node
 *   2. Filter viewport candidates outside `pointRadius`. Grid is
 *      unbounded fallback (but still subject to its own
 *      `pointRadius` check vs the rounded node — usually 0 distance).
 *   3. Sort by (distance asc, priority asc) and return the head.
 *
 * Priority (lower wins ties — same convention as `sketchSnap`):
 *      viewport_corner (0) < viewport_midpoint (1)
 *          < viewport_center (2) < grid (3)
 *
 * This matches the spec ordering: when the cursor sits equidistant to
 * a corner snap and a midpoint snap (rare but possible at small
 * viewports), the corner wins because it's the more semantically
 * specific anchor for a dimension witness line.
 *
 * Cost: O(V) per call (V = number of viewports). Grid is O(1). For
 * typical drawing sheets (< 20 viewports) this is well under a μs.
 */

import type { Sheet, Viewport } from './sheet';

// ─── public types ─────────────────────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

export type SheetSnapKind =
  | 'grid'
  | 'viewport_corner'
  | 'viewport_midpoint'
  | 'viewport_center';

export interface SheetSnapTarget {
  /** Snap position in sheet space (mm from sheet origin = bottom-left). */
  pos: Vec2;
  kind: SheetSnapKind;
  /**
   * Optional reference to the viewport that produced the candidate.
   *   - viewport_corner    → viewport id
   *   - viewport_midpoint  → viewport id
   *   - viewport_center    → viewport id
   *   - grid               → undefined
   */
  refId?: string;
  /** Euclidean distance from the cursor (mm). */
  distance: number;
}

export interface SheetSnapOptions {
  /** Spacing between grid nodes in mm. Default 5. */
  gridSpacing?: number;
  /** Distance threshold for viewport candidates in mm. Default 5. */
  pointRadius?: number;
  /** When true, the cursor rounded to the nearest grid node is a candidate. Default true. */
  enableGrid?: boolean;
  /** When true, viewport corners / midpoints / centers are candidates. Default true. */
  enableViewport?: boolean;
}

// ─── priority ordering (lower wins ties) ──────────────────────────────────

const PRIORITY: Record<SheetSnapKind, number> = {
  viewport_corner: 0,
  viewport_midpoint: 1,
  viewport_center: 2,
  grid: 3,
};

// ─── helpers ──────────────────────────────────────────────────────────────

function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/**
 * Axis-aligned bounding box of a viewport on the sheet.
 *
 * The viewport's `centerOnSheet` is the box center; the box width is
 * `widthOnSheet` and the height is derived as `widthOnSheet * 0.75`
 * (4:3 placeholder aspect — matches `dxfExport.viewportSheetBox`).
 *
 * Returned object holds the 4 corners and 4 edge midpoints, ready for
 * snap-candidate enumeration. Coordinates are in sheet mm.
 */
export interface ViewportBoxSnapPoints {
  corners: ReadonlyArray<Vec2>;
  midpoints: ReadonlyArray<Vec2>;
  center: Vec2;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function viewportBoxCorners(vp: Viewport): ViewportBoxSnapPoints {
  const halfW = vp.widthOnSheet / 2;
  const halfH = halfW * 0.75;
  const cx = vp.centerOnSheet.x;
  const cy = vp.centerOnSheet.y;
  const minX = cx - halfW;
  const maxX = cx + halfW;
  const minY = cy - halfH;
  const maxY = cy + halfH;
  // Corner order: BL, BR, TR, TL (CCW from bottom-left).
  const corners: Vec2[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
  // Midpoints, one per edge in the same CCW walk:
  //   bottom, right, top, left.
  const midpoints: Vec2[] = [
    { x: cx,   y: minY },
    { x: maxX, y: cy   },
    { x: cx,   y: maxY },
    { x: minX, y: cy   },
  ];
  return {
    corners,
    midpoints,
    center: { x: cx, y: cy },
    minX, minY, maxX, maxY,
  };
}

// ─── main API ─────────────────────────────────────────────────────────────

/**
 * Find the best snap target for the given cursor position on a drawing
 * sheet. Returns null when nothing qualifies under the supplied options.
 *
 * Cost notes:
 *   - viewport scan: O(V) where V is the viewport count.
 *   - grid candidate: O(1).
 *   - candidate sort: O(K log K) where K ≤ 9·V + 1.
 *
 * For a typical drawing sheet (V < 20) this is well under a microsecond.
 */
export function findSheetSnapTarget(
  cursorPos: Vec2,
  sheet: Sheet,
  opts: SheetSnapOptions = {},
): SheetSnapTarget | null {
  const gridSpacing = opts.gridSpacing ?? 5;
  const threshold = opts.pointRadius ?? 5;
  const enableGrid = opts.enableGrid ?? true;
  const enableViewport = opts.enableViewport ?? true;

  const candidates: SheetSnapTarget[] = [];

  // ----- viewport snap (corners + midpoints + center) -----
  if (enableViewport) {
    for (const vp of sheet.viewports) {
      const box = viewportBoxCorners(vp);

      // corners
      for (const c of box.corners) {
        const d = dist(cursorPos, c);
        if (d <= threshold) {
          candidates.push({
            pos: { x: c.x, y: c.y },
            kind: 'viewport_corner',
            refId: vp.id,
            distance: d,
          });
        }
      }

      // edge midpoints
      for (const m of box.midpoints) {
        const d = dist(cursorPos, m);
        if (d <= threshold) {
          candidates.push({
            pos: { x: m.x, y: m.y },
            kind: 'viewport_midpoint',
            refId: vp.id,
            distance: d,
          });
        }
      }

      // center
      const dC = dist(cursorPos, box.center);
      if (dC <= threshold) {
        candidates.push({
          pos: { x: box.center.x, y: box.center.y },
          kind: 'viewport_center',
          refId: vp.id,
          distance: dC,
        });
      }
    }
  }

  // ----- grid snap (always within threshold of itself unless spacing is huge) -----
  if (enableGrid && gridSpacing > 0) {
    const gx = roundTo(cursorPos.x, gridSpacing);
    const gy = roundTo(cursorPos.y, gridSpacing);
    const g: Vec2 = { x: gx, y: gy };
    const d = dist(cursorPos, g);
    if (d <= threshold) {
      candidates.push({
        pos: g,
        kind: 'grid',
        distance: d,
      });
    }
  }

  if (candidates.length === 0) return null;

  // Sort by distance asc, then by priority asc (lower priority value wins).
  candidates.sort((a, b) => {
    const dd = a.distance - b.distance;
    if (Math.abs(dd) > 1e-9) return dd;
    return PRIORITY[a.kind] - PRIORITY[b.kind];
  });

  return candidates[0] ?? null;
}
