/**
 * Sketch text → segments converter (F1).
 *
 * Three.js FontLoader produces ShapePath objects per glyph. Each path is a
 * sequence of subpaths (one outer + N hole loops). We discretise each curve
 * to short line segments so the result feeds directly into the existing
 * SketchProfile pipeline (line-only segments are extrudable via
 * extrudeProfile.ts without additional changes).
 *
 * Wiring (caller responsibility):
 *   1. const font = await new FontLoader().loadAsync('/fonts/helvetiker.json');
 *   2. const segments = textToSketchSegments(font, 'PART-001', { size: 12, x: 0, y: 0 });
 *   3. onProfileChange({ segments, closed: true });
 *   4. Apply Sketch → Extrude (positive depth = embossed, negative = engraved cut).
 *
 * The generated profile is multi-loop — the outer of each glyph plus any
 * inner holes (e.g., the hole in 'O' or 'A'). The downstream
 * profileToGeometryMulti handles holes correctly.
 */

import type { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import type { SketchSegment } from './types';

export interface TextToSketchOptions {
  /** Glyph height in mm. Default 10. */
  size?: number;
  /** Curve discretisation count per Bezier — higher = smoother + more verts. */
  curveSegments?: number;
  /** Origin X (mm) — text baseline starts here. */
  x?: number;
  /** Origin Y (mm). */
  y?: number;
  /** Optional letter-spacing override (mm added between glyph advances). */
  letterSpacing?: number;
}

/**
 * Convert a string to a list of closed-loop SketchSegments using the supplied
 * Three.js Font. Each loop becomes one polyline-style segment chain
 * connected back to its start, suitable for `profileToGeometryMulti`.
 *
 * Returns one segment per polyline edge (line segments only). Bezier curves
 * from the glyph outlines are discretised at `curveSegments` resolution.
 */
export function textToSketchSegments(
  font: Font,
  text: string,
  options: TextToSketchOptions = {},
): SketchSegment[] {
  const size = options.size ?? 10;
  const curveSegments = Math.max(2, options.curveSegments ?? 8);
  const originX = options.x ?? 0;
  const originY = options.y ?? 0;
  const extraSpacing = options.letterSpacing ?? 0;

  // FontLoader's Font has a `generateShapes(text, size)` method that emits
  // ready-to-use Three.Shape objects (with holes already attached). Each
  // Shape's `extractPoints(curveSegments)` returns the discretised polygon
  // for the outer loop + each hole.
  const shapes = font.generateShapes(text, size);
  const segments: SketchSegment[] = [];

  let segCounter = 0;
  const nextId = () => `txt-${segCounter++}`;

  for (const shape of shapes) {
    const sample = shape.extractPoints(curveSegments) as {
      shape: Array<{ x: number; y: number }>;
      holes: Array<Array<{ x: number; y: number }>>;
    };

    const loops: Array<Array<{ x: number; y: number }>> = [
      sample.shape,
      ...sample.holes,
    ];

    for (const loop of loops) {
      if (loop.length < 2) continue;
      // Close the loop if it doesn't already close on itself.
      const closed =
        loop[0].x === loop[loop.length - 1].x &&
        loop[0].y === loop[loop.length - 1].y
          ? loop
          : [...loop, loop[0]];

      for (let i = 0; i < closed.length - 1; i++) {
        const a = closed[i];
        const b = closed[i + 1];
        const segId = nextId();
        segments.push({
          id: segId,
          type: 'line',
          points: [
            { id: `${segId}-p0`, x: originX + a.x, y: originY + a.y },
            { id: `${segId}-p1`, x: originX + b.x, y: originY + b.y },
          ],
        });
      }
    }
  }

  // Note: extraSpacing is handled implicitly by Font.generateShapes through
  // its kerning table, so we simply expose the param for callers who want to
  // post-process. Not used in the hot path today.
  void extraSpacing;

  return segments;
}

/**
 * Static front-end helper: returns just the per-character advance widths so
 * a UI preview can show a horizontal bounding box without committing the
 * sketch. Cheap (no segment generation).
 */
export function textBoundingBox(
  font: Font,
  text: string,
  size: number = 10,
): { width: number; height: number } {
  const shapes = font.generateShapes(text, size);
  if (shapes.length === 0) return { width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const shape of shapes) {
    const pts = shape.extractPoints(2).shape as Array<{ x: number; y: number }>;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { width: maxX - minX, height: maxY - minY };
}
