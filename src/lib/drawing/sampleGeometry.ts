/**
 * sampleGeometry — map drawing-page sample part sourceIds to a
 * `StepGeometryInput` payload suitable for `writeStepWithPmi`.
 *
 * Phase 4.4.x: the drawing page ships a hardcoded sample-part catalogue
 * (sample-cube / sample-cylinder / sample-pentagon / sample-step-001).
 * Until Phase 5 wires the real OCCT part store, the STEP+PMI export
 * button needs canonical geometry for each id so the user can download
 * a complete file even before the kernel is online.
 *
 * Conventions:
 *   - all dimensions in millimetres (matches `paperDimensions`)
 *   - loops are emitted CCW so the polygon writer accepts them directly
 *   - cube / step-001 use `kind:'extrude'` (bbox writer — sufficient for
 *     a 4-vertex square loop)
 *   - cylinder / pentagon use `kind:'polygon'` so the polygon writer
 *     emits a real N-vertex prism rather than the bounding box
 *
 * Unknown sourceIds resolve to the same 50×50×50 box as 'sample-cube';
 * the drawing page guarantees the user has selected one of the four
 * known parts, but a defensive default keeps the export path total.
 */

import type { ExtrudeFeature } from '@/lib/cad/extrudeProfile';
import type { StepGeometryInput } from '@/lib/brep-bridge/stepWriteWithPmi';

// ─── primitives ──────────────────────────────────────────────────────────

/** 50 mm cube — origin-anchored square loop, depth 50 in +Z. */
function cubeFeature(): ExtrudeFeature {
  const s = 50;
  return {
    kind: 'extrude',
    loop: [
      { x: 0, y: 0 },
      { x: s, y: 0 },
      { x: s, y: s },
      { x: 0, y: s },
    ],
    depth: s,
    direction: 'one_sided',
    mode: 'add',
  };
}

/** Regular N-gon loop centred at origin, vertex 0 at angle 0. */
function regularPolygonLoop(
  vertexCount: number,
  radius: number,
): ReadonlyArray<{ x: number; y: number }> {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < vertexCount; i += 1) {
    const theta = (2 * Math.PI * i) / vertexCount;
    pts.push({
      x: radius * Math.cos(theta),
      y: radius * Math.sin(theta),
    });
  }
  return pts;
}

/** 16-vertex prism approximating a cylinder of radius 25 mm × depth 60 mm. */
function cylinderFeature(): ExtrudeFeature {
  return {
    kind: 'extrude',
    loop: regularPolygonLoop(16, 25),
    depth: 60,
    direction: 'one_sided',
    mode: 'add',
  };
}

/**
 * Regular pentagon with 30 mm side length × depth 40 mm.
 *
 * Side length s relates to the circumradius R by:
 *   s = 2 R sin(π/n)
 * so R = s / (2 sin(π/5)) ≈ s · 0.85065 for n=5.
 */
function pentagonFeature(): ExtrudeFeature {
  const side = 30;
  const radius = side / (2 * Math.sin(Math.PI / 5));
  return {
    kind: 'extrude',
    loop: regularPolygonLoop(5, radius),
    depth: 40,
    direction: 'one_sided',
    mode: 'add',
  };
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Resolve a drawing-page sample-part `sourceId` into a STEP geometry
 * input. Unknown ids fall back to the 50 mm cube so the export path is
 * always defined.
 *
 * Geometry kind selection rationale:
 *   - extrude (bbox writer): used when the loop IS a rectangle anyway,
 *     so the bbox writer produces the same geometry as the polygon
 *     writer would. Avoids the polygon classifier's overhead.
 *   - polygon: used for true N-gons (cylinder approximation, pentagon)
 *     so the writer emits the real profile.
 */
export function sampleGeometryForSourceId(sourceId: string): StepGeometryInput {
  switch (sourceId) {
    case 'sample-cube':
      return { kind: 'extrude', feature: cubeFeature() };
    case 'sample-cylinder':
      return { kind: 'polygon', feature: cylinderFeature() };
    case 'sample-pentagon':
      return { kind: 'polygon', feature: pentagonFeature() };
    case 'sample-step-001':
      // No real STEP-resolved geometry yet — fallback to the cube body.
      return { kind: 'extrude', feature: cubeFeature() };
    default:
      return { kind: 'extrude', feature: cubeFeature() };
  }
}

/** Internal helpers exported for unit tests. Not stable API. */
export const __internal = {
  cubeFeature,
  cylinderFeature,
  pentagonFeature,
  regularPolygonLoop,
};
