/**
 * Server-side revolve op — Wave 1 W11 follow-up (ADR-007).
 *
 * Revolves a 2D profile around an axis by `angle` degrees. Same
 * primitive profile vocabulary as extrude (rectangle / circle); when
 * the worker gains sketch-import (W12), this surface stays unchanged
 * — only the profile builder grows.
 *
 * Default plane is 'XZ' with axis 'Y' so a profile drawn at +X
 * revolves into a torus-like solid around the world Y axis. That's
 * the SOLIDWORKS / Onshape default expectation; callers can override
 * with `plane` + `axis` when they need something else.
 *
 * Profile placement caveat: replicad's draw* helpers centre on origin.
 * To produce a torus you'd draw the profile and then `translate` it
 * away from the axis before sketching — that translation isn't in
 * this op's param surface (would balloon scope). For W11 we accept
 * "revolves around the profile's own centre", which gives a solid of
 * revolution that's degenerate for centred profiles (circle around
 * its own diameter is a sphere; rectangle is a disc). Real placement
 * lands when sketch-import does.
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import { buildPolygonDrawing, type PolygonProfile } from './_polygon.js';
import type { ReplicadLike, OcctShape, DrawingLike, SerializedResult } from './_types.js';

export type RevolvePlane = 'XY' | 'XZ' | 'YZ';
export type RevolveAxis = 'X' | 'Y' | 'Z';

export interface RevolveRectangleProfile {
  kind: 'rectangle';
  width: number;
  height2D: number;
}

export interface RevolveCircleProfile {
  kind: 'circle';
  radius: number;
}

export type RevolvePolygonProfile = PolygonProfile;

export type RevolveProfile = RevolveRectangleProfile | RevolveCircleProfile | RevolvePolygonProfile;

export interface RevolveParams {
  profile: RevolveProfile;
  /** Sketch plane (default 'XZ'). */
  plane?: RevolvePlane;
  /** Revolution axis (default 'Y'). */
  axis?: RevolveAxis;
  /** Sweep angle in degrees (default 360 = full revolution). */
  angle?: number;
}

function buildProfile(replicad: ReplicadLike, profile: RevolveProfile): DrawingLike {
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

function axisVector(a: RevolveAxis): [number, number, number] {
  switch (a) {
    case 'X': return [1, 0, 0];
    case 'Y': return [0, 1, 0];
    case 'Z': return [0, 0, 1];
  }
}

export async function runRevolve(params: RevolveParams): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadLike;

  const drawing = buildProfile(replicad, params.profile);
  if (!drawing.sketchOnPlane) {
    throw new Error('replicad drawing has no sketchOnPlane() — kernel build mismatch');
  }
  const plane = params.plane ?? 'XZ';
  const sketch = drawing.sketchOnPlane(plane);
  if (!sketch.revolve) {
    throw new Error('replicad sketch has no revolve() — kernel build mismatch');
  }

  const axis = axisVector(params.axis ?? 'Y');
  const angle = params.angle ?? 360;

  let revolved: OcctShape;
  try {
    revolved = sketch.revolve(axis, angle);
  } catch (err) {
    throw new Error(`OCCT revolve failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return serializeShape(replicad, revolved);
}
