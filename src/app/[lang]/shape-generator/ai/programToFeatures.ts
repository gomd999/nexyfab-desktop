/**
 * programToFeatures — replays a precise feature PROGRAM (from the Studio's
 * cad-feature-program path) into the modeler's editable feature tree, so a
 * chat-built precise part arrives as real sketch/hole/pattern/fillet features
 * (not an imported mesh). The modeler then builds it through its own pipeline
 * (OCCT when enabled → analytic B-rep + lossless STEP).
 *
 * Coordinate note: the Studio program is Z-up with hole positions (posX,posY)
 * on the top face; the modeler's hole feature uses (posX,posZ). We map
 * posY → posZ. Ribs and shells are deferred (need their own sketch/profile);
 * they are returned in `skipped` so the caller can fall back for those.
 */
import { generateRectSegments, generateCircleSegments } from '../sketch/sketchGeometryOps';
import type { SketchProfile, SketchConfig, SketchPoint } from '../sketch/types';
import type { FeatureType } from '../features/types';
import type { FeatureProgram, ProgramFeature } from '../../studio/emitScadFromProgram';

const num = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d);
const pt = (x: number, y: number): SketchPoint => ({ x, y } as SketchPoint);

export interface ModelerFeatureApi {
  addSketchFeature: (
    profile: SketchProfile,
    config: SketchConfig,
    plane: 'xy' | 'xz' | 'yz',
    operation: 'add' | 'subtract',
    planeOffset?: number,
  ) => void;
  addFeatureWithParams: (type: FeatureType, overrides: Record<string, number>) => void;
}

/** Replay a feature program into the modeler. Returns whether the base was built
 *  and which feature types were skipped (deferred). */
export function reconstructFeatureTree(program: FeatureProgram, api: ModelerFeatureApi): { ok: boolean; skipped: string[] } {
  const feats: ProgramFeature[] = program?.features ?? [];
  const base = feats.find(f => f.type === 'sketchExtrude');
  if (!base) return { ok: false, skipped: [] };

  // 1. base solid (rectangular plate or disc) via a sketch + extrude
  const h = num(base.height, 8);
  let profile: SketchProfile;
  if (base.shape === 'circle') {
    profile = { segments: generateCircleSegments(pt(0, 0), num(base.width, 50) / 2, 64), closed: true };
  } else {
    const w = num(base.width, 100), d = num(base.depth, 80);
    profile = { segments: generateRectSegments(pt(-w / 2, -d / 2), pt(w / 2, d / 2)), closed: true };
  }
  const config = { mode: 'extrude', depth: h, revolveAngle: 360, revolveAxis: 'y', segments: 32 } as unknown as SketchConfig;
  api.addSketchFeature(profile, config, 'xy', 'add', 0);

  // 2. downstream features, in program order (a pattern follows its source hole)
  const skipped: string[] = [];
  for (const f of feats) {
    switch (f.type) {
      case 'sketchExtrude':
        break;
      case 'hole':
        api.addFeatureWithParams('hole', {
          holeType: num(f.holeType, 0),
          diameter: num(f.diameter, 6),
          posX: num(f.posX, 0),
          posZ: num(f.posY, 0),
          depth: 999, // through
        });
        break;
      case 'circularPattern':
        api.addFeatureWithParams('circularPattern', { axis: 1, count: Math.max(2, Math.round(num(f.count, 4))) });
        break;
      case 'linearPattern':
        api.addFeatureWithParams('linearPattern', { axis: f.axis === 'y' ? 1 : 0, count: Math.max(2, Math.round(num(f.count, 3))), spacing: num(f.spacing, 20) });
        break;
      case 'fillet':
        api.addFeatureWithParams('fillet', { radius: num(f.radius, 3) });
        break;
      case 'chamfer':
        api.addFeatureWithParams('chamfer', { distance: num(f.distance, 1) });
        break;
      default:
        skipped.push(f.type); // rib / shell / etc. — handled by the imported-geometry fallback
    }
  }
  return { ok: true, skipped };
}
