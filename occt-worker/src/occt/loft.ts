/**
 * Server-side loft op — Wave 1 W15 (ADR-007).
 *
 * Lofts a solid between ≥ 2 profile cross-sections at different
 * plane offsets along an axis. Each profile uses the same vocabulary
 * as extrude (rectangle / circle / polygon).
 *
 * The profile list is interpreted as a sequence of cross-sections at
 * monotonically increasing `offset` values; the loft surface blends
 * between them. Common use: tapered ducts, hull shapes, transitions
 * between different bolt-hole patterns.
 *
 * replicad API surface for loft varies between versions:
 *   - `sketch.loftWith([sketch2, sketch3])`
 *   - free function `loft([s1, s2, ...])`
 * We probe sketch method first, fall back to free function.
 */

import { ensureOcctReady, getReplicad } from './lifecycle.js';
import { serializeShape } from './_serialize.js';
import { buildPolygonDrawing } from './_polygon.js';
import type {
  ReplicadLike, OcctShape, DrawingLike, SketchLike, SerializedResult,
} from './_types.js';
import type { ExtrudeProfile } from './extrude.js';

export interface LoftSection {
  profile: ExtrudeProfile;
  /** Distance along the loft axis (mm). Sections must be monotonic
   *  increasing — enforced at validation. */
  offset: number;
}

export interface LoftParams {
  /** ≥ 2 cross-sections sorted by offset. */
  sections: LoftSection[];
  /** Plane the sections sit on (parallel copies at each offset). */
  plane?: 'XY' | 'XZ' | 'YZ';
}

interface ReplicadWithLoft extends ReplicadLike {
  loft?: (sketches: SketchLike[]) => OcctShape;
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

export async function runLoft(params: LoftParams): Promise<SerializedResult> {
  await ensureOcctReady();
  const replicad = getReplicad() as ReplicadWithLoft;
  const plane = params.plane ?? 'XY';

  const sketches: SketchLike[] = params.sections.map(section => {
    const drawing = buildProfile(replicad, section.profile);
    if (!drawing.sketchOnPlane) {
      throw new Error('replicad drawing has no sketchOnPlane()');
    }
    // Place each profile on a parallel plane at its offset.
    return drawing.sketchOnPlane(plane, section.offset);
  });

  const [first, ...rest] = sketches;
  if (!first) {
    throw new Error('loft requires ≥ 2 sections (validator should have caught this)');
  }

  let result: OcctShape | undefined;
  try {
    if (first.loftWith) {
      result = first.loftWith(rest);
    } else if (replicad.loft) {
      result = replicad.loft(sketches);
    } else {
      throw new Error(
        'replicad kernel exposes no loft API (tried sketch.loftWith + free loft)',
      );
    }
  } catch (err) {
    throw new Error(`OCCT loft failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!result) {
    throw new Error('OCCT loft returned no shape');
  }
  return serializeShape(replicad, result);
}
