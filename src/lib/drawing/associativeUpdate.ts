/**
 * associativeUpdate — W4-B associative drawing pipe.
 *
 * SolidWorks-class drawings are ASSOCIATIVE: when the model changes, the
 * drawing's views and dimensions follow — they are never silently deleted.
 * The roadmap's honest-audit called out that our drawing page did the
 * opposite (모델 변경 시 단면뷰를 갱신이 아니라 삭제). This module is the
 * pure-function layer that fixes that:
 *
 *   - `reanchorCuttingPlane` — carry a section-view cutting plane over to an
 *     edited/replaced model, preserving the plane's *drafting intent*: same
 *     normal, same RELATIVE station along that normal within the model's
 *     bounding box (centre cut stays a centre cut; a 20%-from-the-left cut
 *     stays 20% from the left). No old model / degenerate span → the new
 *     bbox centre (the only honest default).
 *
 *   - `measureSheetDimension` / `auditSheetDimensions` — the single
 *     resolution rule for "what value does this dimension show": find the
 *     target viewport, require a standard view + a supplied topology, then
 *     defer to `measureDimension` (W3-C). Everything else is `null`
 *     ("no measurement context"), NEVER a fabricated number. SheetRenderer
 *     and the drawing page's annotation list both consume this so the
 *     canvas label and the list can never disagree.
 *
 * Topo-name invariance (topoNaming.ts) is what makes re-measurement after a
 * model edit meaningful: `f.side.1` still names the same profile-edge face
 * after a depth/coordinate edit, so a dimension's refs survive and its value
 * simply re-measures. A ref that no longer resolves comes back as an
 * EXPLICIT `unresolved-ref` failure (명시 상실 — W1-C 'lost' 사상).
 */

import type { Polyhedron } from '@/lib/cad/featureMesh';
import type { NamedTopology } from '@/lib/cad/topoNaming';
import type { Sheet, Viewport } from './sheet';
import type { Dimension } from './dimension';
import { measureDimension, type MeasureOptions, type MeasureResult } from './measure';

// ─── plane re-anchoring ──────────────────────────────────────────────────

/**
 * Structural cutting-plane type (tuple form) — matches the shape-generator
 * sectionView `CuttingPlane` without importing app-layer code into lib/.
 */
export interface SectionPlane {
  origin: [number, number, number];
  normal: [number, number, number];
}

interface BBox {
  min: [number, number, number];
  max: [number, number, number];
}

function polyBBox(poly: Polyhedron | null | undefined): BBox | null {
  if (!poly || poly.vertices.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of poly.vertices) {
    if (v.x < minX) minX = v.x; if (v.y < minY) minY = v.y; if (v.z < minZ) minZ = v.z;
    if (v.x > maxX) maxX = v.x; if (v.y > maxY) maxY = v.y; if (v.z > maxZ) maxZ = v.z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function bboxCenter(b: BBox): [number, number, number] {
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

const DEGENERATE_SPAN = 1e-9;

/**
 * Re-anchor `plane` from `oldPoly` onto `newPoly`.
 *
 * Rule: keep the normal; keep the plane's relative station t ∈ [0,1] along
 * the (unit) normal within the OLD bbox's normal-axis span, and place the
 * new origin at the same t within the NEW bbox's span. The origin's
 * in-plane components sit at the new bbox centre (they don't affect the cut
 * — a plane is position-along-normal only — but keeping them inside the
 * body keeps downstream arrow/label math well-behaved).
 *
 * Honest defaults instead of guesses:
 *   - no old model (or empty)      → t = 0.5 (centre cut)
 *   - old span degenerate (flat)   → t = 0.5
 *   - t outside [0,1] (plane was outside the old body) → clamped, so the
 *     carried-over cut always intersects the new body.
 * Throws when `newPoly` has no vertices — there is nothing to cut, and
 * fabricating a plane for a nonexistent body would be a silent lie; the
 * caller decides what "no model" means for its UI.
 */
export function reanchorCuttingPlane(
  plane: SectionPlane,
  oldPoly: Polyhedron | null | undefined,
  newPoly: Polyhedron,
): SectionPlane {
  const newBox = polyBBox(newPoly);
  if (!newBox) {
    throw new Error('reanchorCuttingPlane: new model has no vertices — nothing to cut');
  }
  const nLen = Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]);
  if (!(nLen > DEGENERATE_SPAN)) {
    throw new Error('reanchorCuttingPlane: plane normal is degenerate');
  }
  const n: [number, number, number] = [
    plane.normal[0] / nLen,
    plane.normal[1] / nLen,
    plane.normal[2] / nLen,
  ];

  // Relative station along n within the old bbox (0.5 when unknowable).
  let t = 0.5;
  const oldBox = polyBBox(oldPoly);
  if (oldBox) {
    // Project bbox corners onto n to get the old span — exact for any normal.
    const proj = (p: [number, number, number]): number =>
      p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
    let lo = Infinity, hi = -Infinity;
    for (const x of [oldBox.min[0], oldBox.max[0]]) {
      for (const y of [oldBox.min[1], oldBox.max[1]]) {
        for (const z of [oldBox.min[2], oldBox.max[2]]) {
          const s = proj([x, y, z]);
          if (s < lo) lo = s;
          if (s > hi) hi = s;
        }
      }
    }
    const span = hi - lo;
    if (span > DEGENERATE_SPAN) {
      const s = proj(plane.origin);
      t = Math.min(1, Math.max(0, (s - lo) / span));
    }
  }

  // New span along n, same corner-projection method.
  const projN = (p: [number, number, number]): number =>
    p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
  let nLo = Infinity, nHi = -Infinity;
  for (const x of [newBox.min[0], newBox.max[0]]) {
    for (const y of [newBox.min[1], newBox.max[1]]) {
      for (const z of [newBox.min[2], newBox.max[2]]) {
        const s = projN([x, y, z]);
        if (s < nLo) nLo = s;
        if (s > nHi) nHi = s;
      }
    }
  }
  const center = bboxCenter(newBox);
  const centerS = projN(center);
  const targetS = nLo + t * (nHi - nLo);
  const shift = targetS - centerS;
  return {
    normal: plane.normal,
    origin: [
      center[0] + shift * n[0],
      center[1] + shift * n[1],
      center[2] + shift * n[2],
    ],
  };
}

// ─── dimension audit ─────────────────────────────────────────────────────

/**
 * The single resolution rule for a sheet dimension's displayed value:
 * standard-view target viewport + supplied topology → real measurement;
 * anything else → null ("no measurement context" — placeholder territory).
 */
export function measureSheetDimension(
  dimension: Dimension,
  viewports: ReadonlyArray<Viewport>,
  topologies: ReadonlyMap<string, NamedTopology> | undefined,
  /** Forwarded to `measureDimension` — e.g. `{ axis: 'x' }` to force a linear
   *  dimension onto one projection axis. Omitted ⇒ previous behaviour exactly. */
  opts?: MeasureOptions,
): MeasureResult | null {
  const vp = viewports.find((v) => v.id === dimension.viewportId);
  if (!vp || vp.projection.kind !== 'standard') return null;
  const topo = topologies?.get(vp.sourceId);
  if (!topo) return null;
  return measureDimension(dimension, { topo, view: vp.projection.view }, opts);
}

/**
 * Measure every dimension on a sheet. Keyed by dimension id; `null` entries
 * mean "no measurement context" (vs an explicit MeasureFail, which means the
 * measurement RAN and refused with a reason).
 */
export function auditSheetDimensions(
  sheet: Sheet,
  topologies: ReadonlyMap<string, NamedTopology> | undefined,
): Map<string, MeasureResult | null> {
  const out = new Map<string, MeasureResult | null>();
  for (const d of sheet.dimensions ?? []) {
    out.set(d.id, measureSheetDimension(d, sheet.viewports, topologies));
  }
  return out;
}

/**
 * Display rounding shared by the canvas label and the annotation list:
 * 0.01 mm/deg display precision with trailing zeros stripped (50 → "50",
 * π → "3.14"). Angular values get the degree sign.
 */
export function formatMeasuredValue(value: number, unit: 'mm' | 'deg' = 'mm'): string {
  const s = String(Number(value.toFixed(2)));
  return unit === 'deg' ? `${s}°` : s;
}
