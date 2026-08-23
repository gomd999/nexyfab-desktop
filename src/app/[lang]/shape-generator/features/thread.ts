/**
 * thread.ts — generic modeler thread feature (parametric pitch/depth/angle).
 *
 * W5-B fix: the previous "real" (cosmetic=0) path built a helical
 * `TubeGeometry` at `radius − depth/2` and `mergeGeometries`-ed it into the
 * host. `mergeGeometries` is a buffer concatenation, NOT a boolean — nothing
 * was ever removed (measured: host volume unchanged). The real path now
 * sweeps a V-groove cutter (via `threads/applyThreadGeometric`'s exported
 * builder) and CSG-SUBTRACTs it, so the thread actually cuts.
 *
 * Honest approximations of this generic feature (see inline comments):
 * - Host radius comes from the bounding box — correct for bodies that are
 *   roughly cylindrical about +Y; for non-cylindrical bodies the groove is
 *   cut at the bbox radius (may only nick corners).
 * - Sharp V-groove (tiny root flat for CSG robustness), no crest/root
 *   rounding, no lead-in/run-out.
 * - Groove axial width is clamped to 90% of the effective pitch so adjacent
 *   turns never merge — for large depth/angle vs pitch the flank angle is
 *   then steeper than requested.
 * - Cosmetic mode is unchanged: a merged indicator tube (visual only,
 *   intentionally additive, not a cut).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FeatureDefinition } from './types';
import { buildThreadCutterGeometry } from './threads/applyThreadGeometric';
import { applyThreadOcctRegistered } from './threads/applyThreadOcct';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback } from './downgradeNotice';

export const threadFeature: FeatureDefinition = {
  type: 'thread',
  icon: '🔩',
  params: [
    { key: 'pitch', labelKey: 'paramThreadPitch', default: 2, min: 0.5, max: 10, step: 0.5, unit: 'mm' },
    { key: 'depth', labelKey: 'paramThreadDepth', default: 1, min: 0.3, max: 5, step: 0.1, unit: 'mm' },
    { key: 'angle', labelKey: 'paramThreadAngle', default: 60, min: 30, max: 90, step: 5, unit: '°' },
    {
      key: 'cosmetic', labelKey: 'paramThreadCosmetic', default: 1, min: 0, max: 1, step: 1, unit: '',
      options: [{ value: 0, labelKey: 'threadReal' }, { value: 1, labelKey: 'threadCosmetic' }],
    },
  ],
  apply(geometry, params) {
    const pitch = params.pitch;
    const depth = params.depth;
    const cosmetic = Math.round(params.cosmetic) === 1;
    const flankAngle = (params.angle / 2 / 180) * Math.PI;

    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    if (!bb) return geometry;

    const height = bb.max.y - bb.min.y;
    const radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
    const turns = Math.floor(height / pitch);
    if (turns < 1) return geometry;

    if (cosmetic) {
      // Cosmetic thread: add a helix tube geometry as visual indicator
      const stepsPerTurn = 32;
      const totalSteps = turns * stepsPerTurn;
      const helixPoints: THREE.Vector3[] = [];
      for (let i = 0; i <= totalSteps; i++) {
        const t = i / totalSteps;
        const a = t * turns * Math.PI * 2;
        const y = bb.min.y + pitch * 0.5 + t * (height - pitch);
        helixPoints.push(new THREE.Vector3(
          (radius + depth * 0.5) * Math.cos(a),
          y,
          (radius + depth * 0.5) * Math.sin(a),
        ));
      }

      const curve = new THREE.CatmullRomCurve3(helixPoints);
      const threadGeo = new THREE.TubeGeometry(curve, totalSteps, depth * 0.3, 4, false);
      threadGeo.computeVertexNormals();

      const merged = mergeGeometries([geometry, threadGeo]);
      return merged ?? geometry;
    }

    // ── Real thread (W5-B): cut a helical V-groove with a CSG subtraction ──
    // Effective pitch matches the old visual mapping: the helix spans
    // y ∈ [min + P/2, min + P/2 + (height − P)] over `turns` turns.
    const axialSpan = height - pitch;
    if (axialSpan <= 0) return geometry; // body too short for a full groove
    const pitchEff = axialSpan / turns;

    // Cutter cross-section (radial, axial), all mm:
    // - root at radius − depth (sharp-ish V; tiny root flat for CSG robustness)
    // - opening extended past the host surface by `margin` so the boolean
    //   cuts cleanly through the polygonal host wall
    // - opening half-width from the requested flank angle, CLAMPED to
    //   0.45·pitchEff so adjacent turns never merge (approximation: the
    //   effective flank angle is steeper than requested when clamped).
    const margin = Math.max(0.1 * depth, 0.02 * radius);
    const rootHalf = 0.02 * pitchEff;
    const halfOuter = Math.min(
      rootHalf + (depth + margin) * Math.tan(flankAngle),
      0.45 * pitchEff,
    );
    const section = {
      rInner: Math.max(1e-3, radius - depth),
      rOuter: radius + margin,
      halfInner: rootHalf,
      halfOuter,
    };

    // Build the cutter around +Z (the verified-winding builder), then rotate
    // Z→Y to match this feature's +Y axis convention. Ring cap 2048 bounds
    // CSG cost for tall/fine threads (chordal approximation coarsens there).
    const samplesPerTurn = 24;
    const cutter = buildThreadCutterGeometry(
      section,
      pitchEff,
      turns,
      bb.min.y + pitch * 0.5, // start offset along the axis
      // 'left_hand' around +Z becomes (cos a, y, sin a) after the Z→Y
      // rotation below — the same winding as the cosmetic indicator tube.
      'left_hand',
      samplesPerTurn,
      Math.min(turns * samplesPerTurn + 1, 2048),
    ).geometry;
    // rotateX(−π/2): (x, y, z) → (x, z, −y) — helix z-axis becomes +Y and the
    // axial range is preserved; rotation preserves chirality so the outward
    // winding verified in the threads suite still holds.
    cutter.rotateX(-Math.PI / 2);

    try {
      // Same require-based import rationale as threads/applyThreadGeometric.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const csg = require('three-bvh-csg') as {
        Evaluator: new () => { evaluate: (a: unknown, b: unknown, op: unknown) => { geometry: THREE.BufferGeometry } | null };
        Brush: new (geo: THREE.BufferGeometry, mat: THREE.Material) => unknown;
        SUBTRACTION: unknown;
      };
      const ev = new csg.Evaluator();
      const result = ev.evaluate(
        new csg.Brush(geometry, new THREE.MeshStandardMaterial()),
        new csg.Brush(cutter, new THREE.MeshStandardMaterial()),
        csg.SUBTRACTION,
      );
      if (result?.geometry) {
        result.geometry.computeVertexNormals();
        return result.geometry;
      }
    } catch (err) {
      // HONEST degradation: if the boolean fails we return the host
      // UNCHANGED (no fake merged tube pretending to be a thread).
      console.warn('[threadFeature] real-thread CSG failed — returning host unchanged', err);
    }
    return geometry;
  },
  async applyAsync(geometry, params) {
    const cosmetic = Math.round(params.cosmetic) === 1;
    if (!cosmetic && shouldUseOcctEngine()) {
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox;
      const parentHandle = geometry.userData?.occtHandle as string | undefined;
      if (bb && parentHandle) {
        const height = bb.max.y - bb.min.y;
        const radius = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
        const exact = applyThreadOcctRegistered(parentHandle, {
          radius,
          height,
          pitch: params.pitch,
          depth: params.depth,
          includedAngleDeg: params.angle,
          direction: 'right_hand',
        });
        if (exact.handle) {
          exact.geometry.userData.occtHandle = exact.handle;
          return exact.geometry;
        }
      }
    }
    return noteMeshFallback(threadFeature.apply(geometry, params), {
      op: cosmetic ? 'Thread (cosmetic)' : 'Thread',
    });
  },
};
