/**
 * Server-side extrude op — Wave 1 W11 follow-up (ADR-007).
 *
 * Takes a 2D profile, sketches it on a plane, extrudes by `height`
 * along that plane's normal. First-pass profiles are primitive (no
 * sketch import yet — that's W12 when the worker accepts STEP/DXF
 * sketches via R2):
 *
 *   profile.kind = 'rectangle' → drawRectangle(width, height2D)
 *   profile.kind = 'circle'    → drawCircle(radius)
 *
 * Sketch plane defaults to 'XY' (extrudes in +Z). The profile is
 * centred on origin; for offset placement the caller adds a follow-up
 * boolean fuse instead of extending this API surface here.
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import { buildPolygonDrawing, type PolygonProfile } from './_polygon.js';
import type { ReplicadLike, OcctShape, DrawingLike, SerializedResult } from './_types.js';

export type ExtrudePlane = 'XY' | 'XZ' | 'YZ';

export interface ExtrudeRectangleProfile {
  kind: 'rectangle';
  width: number;
  height2D: number;
}

export interface ExtrudeCircleProfile {
  kind: 'circle';
  radius: number;
}

/** Custom polygon profile — W13 D1-2. Vertex list builds via
 *  draw().moveTo().lineTo()*.close(). Enables L/T/U brackets and
 *  plate-with-cutout shapes that rectangle/circle can't express. */
export type ExtrudePolygonProfile = PolygonProfile;

export type ExtrudeProfile = ExtrudeRectangleProfile | ExtrudeCircleProfile | ExtrudePolygonProfile;

export interface ExtrudeParams {
  profile: ExtrudeProfile;
  /** Extrusion distance along the sketch plane's normal (mm). */
  height: number;
  /** Sketch plane (default 'XY' → +Z extrusion). */
  plane?: ExtrudePlane;
}

function buildProfile(replicad: ReplicadLike, profile: ExtrudeProfile): DrawingLike {
  switch (profile.kind) {
    case 'rectangle': {
      if (!replicad.drawRectangle) {
        throw new Error('replicad.drawRectangle unavailable — kernel build mismatch');
      }
      return replicad.drawRectangle(profile.width, profile.height2D);
    }
    case 'circle': {
      if (!replicad.drawCircle) {
        throw new Error('replicad.drawCircle unavailable — kernel build mismatch');
      }
      return replicad.drawCircle(profile.radius);
    }
    case 'polygon': {
      return buildPolygonDrawing(replicad, profile);
    }
  }
}

export async function runExtrude(params: ExtrudeParams): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  const drawing = buildProfile(replicad, params.profile);
  if (!drawing.sketchOnPlane) {
    throw new Error('replicad drawing has no sketchOnPlane() — kernel build mismatch');
  }
  const plane = params.plane ?? 'XY';
  const sketch = drawing.sketchOnPlane(plane);
  if (!sketch.extrude) {
    throw new Error('replicad sketch has no extrude() — kernel build mismatch');
  }

  let extruded: OcctShape;
  try {
    extruded = sketch.extrude(params.height);
  } catch (err) {
    throw new Error(`OCCT extrude failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return serializeShape(replicad, extruded);
}
