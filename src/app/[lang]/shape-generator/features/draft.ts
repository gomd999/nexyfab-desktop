import * as THREE from 'three';
import type { FeatureDefinition, FeatureApplyContext } from './types';
import { occtDraft } from './occtEngine';
import { shouldUseOcctEngine } from './engineSelection';
import { noteMeshFallback, clearStaleBrepHandle } from './downgradeNotice';
import { captureKernelFailure } from './kernelCorpus';

/** Face-selection info subset the draft needs (from FaceSelectionInfo). */
interface DraftFaceSel {
  normal: [number, number, number];
  position: [number, number, number];
}

/** Clamp + sanitize the draft angle (see comment in applyDraftMesh). */
function safeAngleDeg(raw: number): number {
  const v = Number.isFinite(raw) ? raw : 0;
  return Math.max(-89, Math.min(89, v));
}

function applyDraftMesh(geometry: THREE.BufferGeometry, params: Record<string, number>): THREE.BufferGeometry {
  // Clamp away from ±90°: tan(90°) is Infinity and would write NaN coordinates
  // into every vertex (silent invalid solid). UI bounds are 1–30°, but an
  // AI/programmatic param could pass 90 — or NaN, which slips through Math.min/max
  // (Math.max(-89, Math.min(89, NaN)) === NaN), so coerce non-finite to 0 first.
  const angleDeg = safeAngleDeg(params.angle);
  const direction = Math.round(params.direction) === 0 ? 1 : -1;
  const tanAngle = Math.tan((angleDeg * Math.PI) / 180);

  const clone = geometry.clone();
  const posAttr = clone.getAttribute('position');
  const positions = posAttr.array as Float32Array;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    // Distance from neutral plane (Y = 0); taper X/Z proportionally.
    const offset = tanAngle * y * direction;
    positions[i] = x + offset;
    positions[i + 2] = z + offset;
  }

  posAttr.needsUpdate = true;
  clone.computeVertexNormals();
  // THREE's clone shares userData by reference — the sheared mesh must not
  // keep advertising the PRE-draft upstream B-rep solid (downstream OCCT
  // features / STEP export would silently operate on the undrafted solid).
  return clearStaleBrepHandle(clone);
}

/**
 * W5-C — face-selection draft (mesh path).
 *
 * Tilts ONLY the selected planar side face about the neutral plane (the body's
 * bottom, y = bbox.min.y): every vertex lying on the selected face's plane is
 * displaced along the horizontal component of the face normal by
 * `(y - yMin) · tan(angle)`. Vertices NOT on that plane are left bit-identical,
 * so non-selected faces keep their exact geometry; adjacent faces stay stitched
 * because their shared edge vertices lie ON the selected plane and move with it
 * (watertightness is preserved by construction — displacement is applied by
 * plane membership, not by triangle ownership).
 *
 * Exactness: for a prism side face (planar, straight-sided) this is the exact
 * drafted solid — the tilted face and its trapezoid neighbours remain planar
 * (displacement is linear in y). One approximation boundary is stated, not
 * hidden: plane membership is geometric, so a coincidentally coplanar face
 * elsewhere on the body would tilt too (acceptable for prismatic bodies, which
 * is the declared support scope of the mesh path).
 *
 * Explicit refusals (never a silent wrong result):
 *  - DRAFT_FACE_HORIZONTAL   — the picked face is parallel to the neutral
 *                              plane (top/bottom); it cannot be drafted
 *                              relative to the bottom.
 *  - DRAFT_SELF_INTERSECT    — an inward draft whose maximum displacement
 *                              (height · tan(angle)) reaches the body's extent
 *                              along the tilt direction would push the face
 *                              through the opposite side.
 */
function applyFaceDraftMesh(
  geometry: THREE.BufferGeometry,
  params: Record<string, number>,
  sel: DraftFaceSel,
): THREE.BufferGeometry {
  const angleDeg = safeAngleDeg(params.angle);
  // Same sign convention as the legacy global taper: direction 0 → outward
  // (+n_h, the face's top edge moves away from the body), 1 → inward.
  const dirSign = Math.round(params.direction) === 0 ? 1 : -1;
  const tanAngle = Math.tan((angleDeg * Math.PI) / 180);

  const n = new THREE.Vector3(sel.normal[0], sel.normal[1], sel.normal[2]);
  if (n.lengthSq() < 1e-12) throw new Error('DRAFT_BAD_SELECTION: selected face normal is zero');
  n.normalize();

  // Horizontal (neutral-plane-parallel) tilt direction.
  const nh = new THREE.Vector3(n.x, 0, n.z);
  if (nh.length() < 1e-6) {
    throw new Error(
      'DRAFT_FACE_HORIZONTAL: the selected face is parallel to the neutral plane ' +
      '(bottom) — a top/bottom face cannot be drafted about the bottom. Pick a side face.',
    );
  }
  nh.normalize();

  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const yMin = bb.min.y;
  const height = bb.max.y - yMin;
  const diag = bb.getSize(new THREE.Vector3()).length();
  // Plane-membership tolerance: relative to body size (float32 vertex storage
  // gives ~diag·2^-23 noise; 1e-4·diag is comfortably above it and far below
  // any real feature spacing).
  const eps = Math.max(1e-6, 1e-4 * diag);

  // Refuse a self-intersecting inward draft instead of emitting a folded solid:
  // max displacement (at the top) vs the body's bbox extent along the tilt line.
  const maxDisp = Math.abs(tanAngle) * height;
  if (dirSign < 0) {
    const extent =
      Math.abs(nh.x) * (bb.max.x - bb.min.x) + Math.abs(nh.z) * (bb.max.z - bb.min.z);
    if (maxDisp >= extent - eps) {
      throw new Error(
        `DRAFT_SELF_INTERSECT: inward draft of ${angleDeg}° over height ${height.toFixed(3)} ` +
        `displaces the face by ${maxDisp.toFixed(3)} mm, which reaches the body extent ` +
        `${extent.toFixed(3)} mm along the tilt direction — the face would cross the ` +
        'opposite side. Reduce the angle or the body height.',
      );
    }
  }

  const planeD = n.dot(new THREE.Vector3(sel.position[0], sel.position[1], sel.position[2]));

  const clone = geometry.clone();
  const posAttr = clone.getAttribute('position');
  const arr = posAttr.array as Float32Array | Float64Array;

  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i];
    const y = arr[i + 1];
    const z = arr[i + 2];
    // On the selected face's plane?
    if (Math.abs(n.x * x + n.y * y + n.z * z - planeD) > eps) continue;
    const disp = tanAngle * (y - yMin) * dirSign;
    arr[i] = x + nh.x * disp;
    arr[i + 2] = z + nh.z * disp;
  }

  posAttr.needsUpdate = true;
  clone.computeVertexNormals();
  return clearStaleBrepHandle(clone);
}

export const draftFeature: FeatureDefinition = {
  type: 'draft',
  icon: '📐',
  params: [
    { key: 'angle', labelKey: 'paramDraftAngle', default: 5, min: 1, max: 30, step: 0.5, unit: '°' },
    {
      key: 'direction',
      labelKey: 'paramDraftDirection',
      default: 0,
      min: 0,
      max: 1,
      step: 1,
      unit: '',
      options: [
        { value: 0, labelKey: 'featureOpt_upward' },
        { value: 1, labelKey: 'featureOpt_downward' },
      ],
    },
  ],
  apply(geometry, params, ctx?: FeatureApplyContext) {
    const sel = ctx?.faceSelections?.[0];
    if (sel) return applyFaceDraftMesh(geometry, params, sel);
    // No face picked → legacy whole-body taper about Y=0 (a global shear —
    // an APPROXIMATION of draft-all-walls, kept for selection-less callers).
    return applyDraftMesh(geometry, params);
  },
  async applyAsync(geometry, params, ctx?: FeatureApplyContext) {
    const sel = ctx?.faceSelections?.[0];
    if (shouldUseOcctEngine() && !sel) {
      // NB: occtDraft has no per-face argument — when the user picked a face we
      // must NOT hand the op to it (it would draft different faces than asked);
      // the face-selection path below is the correct implementation for that case.
      const handle = geometry.userData?.occtHandle as string | undefined;
      if (handle) {
        try {
          const safeAngle = Number.isFinite(params.angle) ? params.angle : 0;
          const r = occtDraft(handle, safeAngle, Math.round(params.direction));
          if (r.handle) {
            r.geometry.userData.occtHandle = r.handle;
            return r.geometry;
          }
        } catch (err) {
          console.warn('[draft] OCCT path failed, falling back to mesh:', err);
          captureKernelFailure({
            op: 'draft',
            params: { angle: params.angle, direction: Math.round(params.direction) },
            geometry,
            error: err,
            resolution: { strategy: 'mesh-fallback', requested: { angle: params.angle } },
          });
        }
      }
    }
    // Wanted B-rep but meshed (no handle / OCCT unavailable / threw) → soft notice.
    return noteMeshFallback(draftFeature.apply(geometry, params, ctx), { op: 'Draft' });
  },
};
