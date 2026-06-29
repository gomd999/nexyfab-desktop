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
  /** Replace the modeler's BASE primitive (box/cylinder). Preferred over a
   *  sketch base: the modeler always starts with a default base solid, so a
   *  sketch 'add' would UNION the part onto that default box (wrong dims). */
  setBaseShape?: (shapeId: string, params: Record<string, number>) => void;
  /** Clear the existing feature stack before replaying (idempotent handoff). */
  clearFeatures?: () => void;
}

/** Replay a feature program into the modeler. Returns whether the base was built
 *  and which feature types were skipped (deferred). */
export function reconstructFeatureTree(program: FeatureProgram, api: ModelerFeatureApi): { ok: boolean; skipped: string[] } {
  const feats: ProgramFeature[] = program?.features ?? [];
  const base = feats.find(f => f.type === 'sketchExtrude');
  if (!base) return { ok: false, skipped: [] };

  // 1. base solid. The modeler ALWAYS starts with a default base primitive
  // (a 50×30×20 box), so the old approach — a sketch 'add' — unioned the part
  // ONTO that box, corrupting the dimensions. Instead REPLACE the base
  // primitive directly when we can (box/cylinder, which is every Studio base).
  // The modeler is Y-up: box height is the vertical (Y) axis and the hole
  // feature drills along Y through it. So the plate's THICKNESS must map to the
  // box height (Studio height), not depth — otherwise the holes drill through
  // the wrong dimension and blow up the bbox. width→X, height→Y(thickness),
  // depth→Z.
  const h = num(base.height, 8);
  // NOTE: do NOT clearFeatures() here — the modeler mounts fresh on handoff, and
  // clearAll() resets activeNodeId asynchronously, so features added in the same
  // tick attach to a stale (removed) parent and vanish from the tree.
  if (api.setBaseShape) {
    if (base.shape === 'circle') {
      api.setBaseShape('cylinder', { diameter: num(base.width, 50), height: h });
    } else {
      api.setBaseShape('box', { width: num(base.width, 100), height: h, depth: num(base.depth, 80) });
    }
  } else {
    // Fallback (no base-shape setter): sketch extrude (will double the default box).
    let profile: SketchProfile;
    if (base.shape === 'circle') {
      profile = { segments: generateCircleSegments(pt(0, 0), num(base.width, 50) / 2, 64), closed: true };
    } else {
      const w = num(base.width, 100), d = num(base.depth, 80);
      profile = { segments: generateRectSegments(pt(-w / 2, -d / 2), pt(w / 2, d / 2)), closed: true };
    }
    const config = { mode: 'extrude', depth: h, revolveAngle: 360, revolveAxis: 'y', segments: 32 } as unknown as SketchConfig;
    api.addSketchFeature(profile, config, 'xy', 'add', 0);
  }

  // 2. downstream features, in program order (a pattern follows its source hole)
  const skipped: string[] = [];
  for (const f of feats) {
    try {
    switch (f.type) {
      case 'sketchExtrude':
        break;
      case 'hole': {
        // EXPAND patterns into explicit holes rather than using the modeler's
        // circularPattern feature — it places copies at the wrong radius (the
        // bbox blew up to 2×PCD in the Z axis). Same positions the OpenSCAD
        // preview and the analytic-STEP route use.
        const addHole = (x: number, y: number) => api.addFeatureWithParams('hole', {
          holeType: num(f.holeType, 0), diameter: num(f.diameter, 6), posX: x, posZ: y, depth: 999,
        });
        const pat = feats.find(p => (p.type === 'circularPattern' || p.type === 'linearPattern') && p.feature === f.id);
        if (pat?.type === 'circularPattern') {
          const cnt = Math.max(2, Math.round(num(pat.count, 4)));
          const r = num(pat.pcd, 60) / 2;
          for (let i = 0; i < cnt; i++) { const a = (i / cnt) * 2 * Math.PI; addHole(Math.cos(a) * r, Math.sin(a) * r); }
        } else if (pat?.type === 'linearPattern') {
          const cnt = Math.max(2, Math.round(num(pat.count, 3)));
          const sp = num(pat.spacing, 20);
          for (let i = 0; i < cnt; i++) {
            const off = (i - (cnt - 1) / 2) * sp;
            addHole(num(f.posX, 0) + (pat.axis === 'y' ? 0 : off), num(f.posY, 0) + (pat.axis === 'y' ? off : 0));
          }
        } else {
          addHole(num(f.posX, 0), num(f.posY, 0));
        }
        break;
      }
      case 'circularPattern':
      case 'linearPattern':
        break; // expanded together with their source hole above
      case 'fillet':
        api.addFeatureWithParams('fillet', { radius: num(f.radius, 3) });
        break;
      case 'chamfer':
        api.addFeatureWithParams('chamfer', { distance: num(f.distance, 1) });
        break;
      default:
        skipped.push(f.type); // rib / shell / etc. — handled by the imported-geometry fallback
    }
    } catch {
      // A single bad feature must not abort the whole tree reconstruction.
      skipped.push(`${f.type} (error)`);
    }
  }
  return { ok: true, skipped };
}
