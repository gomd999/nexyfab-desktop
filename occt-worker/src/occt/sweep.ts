/**
 * Server-side sweep op — Wave 1 W15 (ADR-007).
 *
 * Sweeps a 2D profile (rectangle / circle / polygon / svgPath) along
 * a polyline path. The path is a list of 3D points the sweep visits in
 * order. A straight path with 2 collinear points degenerates to a plain
 * extrude — and we delegate to the extrude op in that case so the
 * caller doesn't need to know the difference.
 *
 * replicad's sweep API surface is version-dependent:
 *   - Some builds expose `sketch.sweepAlong(path)`.
 *   - Others use `sweep(sketch, path, options)` as a free function.
 *   - Older builds have no sweep at all.
 * The handler probes the sketch's method first, then falls back to a
 * free-function lookup. If neither exists, surfaces a clear error.
 *
 * Profile re-uses the polygon + SVG-path machinery established in
 * W13-14 so any shape that extrudes can also sweep.
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import { buildPolygonDrawing } from './_polygon.js';
import type {
  ReplicadLike, OcctShape, DrawingLike, SerializedResult,
} from './_types.js';
import type { ExtrudeProfile } from './extrude.js';

export interface SweepParams {
  /** Same profile vocabulary as extrude — rectangle / circle /
   *  polygon. svgPath is pre-compiled to polygon at the route layer. */
  profile: ExtrudeProfile;
  /** Polyline path the profile sweeps along. ≥ 2 points; the first is
   *  the sketch origin, subsequent ones drag the swept solid through. */
  path: [number, number, number][];
  /** Plane the profile sits on. Default 'XY'. */
  plane?: 'XY' | 'XZ' | 'YZ';
}

interface ReplicadWithSweep extends ReplicadLike {
  /** Free-function sweep — some replicad versions expose this. */
  sweep?: (sketch: unknown, path: unknown, opts?: unknown) => OcctShape;
}

function buildProfile(replicad: ReplicadLike, profile: ExtrudeProfile): DrawingLike {
  switch (profile.kind) {
    case 'rectangle': {
      if (!replicad.drawRectangle) throw new Error('replicad.drawRectangle unavailable');
      return replicad.drawRectangle(profile.width, profile.height2D);
    }
    case 'circle': {
      if (!replicad.drawCircle) throw new Error('replicad.drawCircle unavailable');
      return replicad.drawCircle(profile.radius);
    }
    case 'polygon': {
      return buildPolygonDrawing(replicad, profile);
    }
  }
}

export async function runSweep(params: SweepParams): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadWithSweep;

  const drawing = buildProfile(replicad, params.profile);
  if (!drawing.sketchOnPlane) {
    throw new Error('replicad drawing has no sketchOnPlane() — kernel build mismatch');
  }
  const sketch = drawing.sketchOnPlane(params.plane ?? 'XY');

  let result: OcctShape | undefined;
  try {
    if (sketch.sweepAlong) {
      result = sketch.sweepAlong(params.path);
    } else if (replicad.sweep) {
      // Free-function form: sweep(sketch, path)
      result = replicad.sweep(sketch, params.path);
    } else {
      throw new Error(
        'replicad kernel exposes no sweep API (tried sketch.sweepAlong + free sweep)',
      );
    }
  } catch (err) {
    throw new Error(`OCCT sweep failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!result) {
    throw new Error('OCCT sweep returned no shape');
  }
  return serializeShape(replicad, result);
}
