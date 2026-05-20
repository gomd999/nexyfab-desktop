'use client';

// PushPullArrow — 3-D arrow mounted inside the viewport <Canvas> at the
// currently-selected face. Only rendered while `pushPullMode` is on, the
// selection is a face, and there's some face normal to point along.
//
// Phase-2C: pointer-down on the head/stem starts a drag. Drag distance
// is the world-space displacement along the face normal (computed by
// projecting the cursor ray onto the line through the face origin in the
// normal direction). On axis-aligned faces of the `box` base shape we
// map that distance to width/height/depth; other base shapes show a
// toast saying drag is not yet supported for them so the user knows
// the visual arrow is still useful as a marker.

import { useMemo, useRef, useCallback, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useUIStore } from '../store/uiStore';
import { useSelectionStore } from '../store/selectionStore';
import { useSceneStore } from '../store/sceneStore';

const ARROW_COLOR = '#22d3ee';
const ARROW_COLOR_HOT = '#fbbf24';

/** Parameter on the line P(t) = origin + t * dir closest to the given ray.
 *  Returns the scalar t (world units when `dir` is unit length).
 *  Standard skew-line closest-point formula. */
function paramOnLineClosestToRay(
  lineOrigin: THREE.Vector3,
  lineDir: THREE.Vector3,
  rayOrigin: THREE.Vector3,
  rayDir: THREE.Vector3,
): number {
  const w0 = new THREE.Vector3().subVectors(lineOrigin, rayOrigin);
  const a = lineDir.dot(lineDir);
  const b = lineDir.dot(rayDir);
  const c = rayDir.dot(rayDir);
  const d = lineDir.dot(w0);
  const e = rayDir.dot(w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-10) return 0;
  return (b * e - c * d) / denom;
}

interface DragState {
  startParam: number;
  paramKey: 'width' | 'height' | 'depth' | 'diameter' | 'radius';
  sign: 1 | -1;
  axis: 0 | 1 | 2;
  /** Pointer ray "t along arrow line" at drag start — diffs to compute delta. */
  startT: number;
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  /** When set the drag mutates this sketchExtrude feature's param rather
   *  than the base shape param. The arrow still drives the same delta
   *  math; only the commit channel differs (event vs. sceneStore). */
  featureId?: string;
}

export default function PushPullArrow() {
  const pushPullMode = useUIStore(s => s.pushPullMode);
  const sel = useSelectionStore(s => s.selectedElement);
  const selectedId = useSceneStore(s => s.selectedId);
  const { camera, gl, raycaster } = useThree();
  const dragRef = useRef<DragState | null>(null);
  const hotRef = useRef<boolean>(false);
  const headRef = useRef<THREE.Mesh | null>(null);
  const stemRef = useRef<THREE.Mesh | null>(null);

  const transform = useMemo(() => {
    if (!sel || sel.type !== 'face') return null;
    const n = new THREE.Vector3(...sel.normal);
    if (n.lengthSq() < 1e-10) return null;
    n.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const euler = new THREE.Euler().setFromQuaternion(q);
    return {
      position: sel.position,
      rotation: [euler.x, euler.y, euler.z] as [number, number, number],
      normal: n,
    };
  }, [sel]);

  const screenRay = useCallback((clientX: number, clientY: number): { origin: THREE.Vector3; dir: THREE.Vector3 } => {
    const rect = gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return { origin: raycaster.ray.origin.clone(), dir: raycaster.ray.direction.clone().normalize() };
  }, [camera, gl, raycaster]);

  const onPointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!transform || !sel || sel.type !== 'face') return;
    e.stopPropagation();

    const [nx, ny, nz] = sel.normal;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const max = Math.max(ax, ay, az);

    // Resolve (paramKey, sign) for the selected base shape + face normal.
    // Returning null leaves the arrow as a passive visual marker.
    let resolved: { paramKey: 'width' | 'height' | 'depth' | 'diameter' | 'radius'; sign: 1 | -1 } | null = null;
    if (selectedId === 'box') {
      // Axis-aligned only.
      if (max >= 0.95) {
        const axis: 0 | 1 | 2 = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
        const sign: 1 | -1 = (axis === 0 ? nx : axis === 1 ? ny : nz) >= 0 ? 1 : -1;
        const paramKey = (axis === 0 ? 'width' : axis === 1 ? 'height' : 'depth') as 'width' | 'height' | 'depth';
        resolved = { paramKey, sign };
      }
    } else if (selectedId === 'cylinder') {
      // Cap (normal aligned with +Y/-Y) → height. Side wall (radial in XZ) → diameter.
      // Diameter responds to outward-radial drag with sign +1 (drag away from axis
      // grows diameter); height drag follows normal sign.
      if (ay >= 0.95) {
        resolved = { paramKey: 'height', sign: ny >= 0 ? 1 : -1 };
      } else if (Math.hypot(nx, nz) >= 0.95) {
        // Radial drag — multiplier ×2 because diameter is 2 × delta on the surface.
        resolved = { paramKey: 'diameter', sign: 1 };
      }
    } else if (selectedId === 'sphere') {
      // Any outward-radial face drag → diameter. Sphere also uses the
      // 'diameter' param like cylinder, so the ×2 multiplier in onPointerMove
      // applies and the drag feels physical (radius = surface displacement).
      resolved = { paramKey: 'diameter', sign: 1 };
    }
    // Sketch-extrude face fallback — when the selected face's persistentId
    // matches a sketchExtrude stamp (e.g. `feat_abc_cap_top`), route the
    // drag to that feature's `depth` parameter so push/pull works on
    // user-extruded bodies, not just base shapes.
    let featureId: string | undefined;
    if (!resolved && sel.persistentId) {
      const m = /^([^_]+(?:-[^_]+)*)_(cap|sweep)/.exec(sel.persistentId);
      if (m) {
        featureId = m[1];
        // Sign — cap_top normal is +Z (default extrude axis); cap_bottom
        // is −Z. Either way drag along face normal == grow depth.
        resolved = { paramKey: 'depth', sign: 1 };
      }
    }
    if (!resolved) return;

    // For sketchExtrude features we don't have a base-shape param to read
    // off the scene store; fall back to 10 mm (matches the typical
    // sketchConfig.depth default) so the first drag tick produces a
    // sane delta even before the feature reports its current value.
    const startParam = featureId ? 10 : (useSceneStore.getState().params[resolved.paramKey] ?? 50);
    const paramKey = resolved.paramKey;
    const sign = resolved.sign;
    const axis = 0 as 0 | 1 | 2; // legacy field, no longer used downstream

    const origin = new THREE.Vector3(...sel.position);
    const normal = transform.normal.clone();
    const ne = e.nativeEvent;
    const ray = screenRay(ne.clientX, ne.clientY);
    const startT = paramOnLineClosestToRay(origin, normal, ray.origin, ray.dir);

    dragRef.current = { startParam, paramKey, sign, axis, startT, origin, normal, featureId };
    try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* not all targets support capture */ }
    hotRef.current = true;
  }, [transform, sel, selectedId, screenRay]);

  const [dragLabel, setDragLabel] = useState<string | null>(null);

  const onPointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    const d = dragRef.current;
    if (!d) return;
    e.stopPropagation();
    const ne = e.nativeEvent;
    const ray = screenRay(ne.clientX, ne.clientY);
    const t = paramOnLineClosestToRay(d.origin, d.normal, ray.origin, ray.dir);
    // Delta is world distance along face normal. Apply sign so dragging
    // outward (away from the solid centre) grows the dimension. For
    // `diameter` the surface drag distance is one radius worth, so the
    // parameter delta is 2× the world delta (drag the right side outward
    // by 5mm → diameter grows by 10mm).
    let delta = (t - d.startT) * d.sign;
    if (d.paramKey === 'diameter') delta *= 2;
    const next = Math.max(0.1, d.startParam + delta);
    if (d.featureId) {
      // sketchExtrude feature — Inner listens for this event and routes
      // to useFeatureStack.updateFeatureParam so the pipeline re-runs.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('nexyfab:update-feature-param', {
          detail: { featureId: d.featureId, key: d.paramKey, value: next },
        }));
      }
    } else {
      useSceneStore.getState().setParam(d.paramKey, next);
    }
    const change = next - d.startParam;
    const sign = change >= 0 ? '+' : '';
    setDragLabel(`${d.paramKey}: ${next.toFixed(2)}  (${sign}${change.toFixed(2)})`);
  }, [screenRay]);

  const onPointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    try { (e.target as Element).releasePointerCapture?.(e.pointerId); } catch { /* idem */ }
    dragRef.current = null;
    hotRef.current = false;
    setDragLabel(null);
  }, []);

  // Camera-distance-aware scale so the arrow keeps a near-constant pixel
  // size whether the model is 10 mm or 1000 mm wide. Updated every frame
  // via useFrame; React only re-renders the group when the rounded value
  // changes (cheap enough — arrow is one cylinder + one cone).
  const [scale, setScale] = useState(1);
  useFrame(() => {
    if (!pushPullMode || !transform) return;
    const p = new THREE.Vector3(...transform.position);
    const d = camera.position.distanceTo(p);
    // Empirically chosen — at default orbit distance (~150 mm) gives
    // arrow ≈12 mm stem; scales linearly with camera distance from there.
    const next = Math.max(0.25, Math.min(8, d / 150));
    setScale(prev => Math.abs(prev - next) > 0.02 ? next : prev);
  });

  if (!pushPullMode || !transform) return null;

  const STEM_LENGTH = 12 * scale;
  const STEM_RADIUS = 0.6 * scale;
  const HEAD_LENGTH = 4 * scale;
  const HEAD_RADIUS = 1.8 * scale;
  const color = hotRef.current ? ARROW_COLOR_HOT : ARROW_COLOR;

  return (
    <group
      position={transform.position}
      rotation={transform.rotation}
      renderOrder={2}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <mesh ref={stemRef} position={[0, STEM_LENGTH / 2 + 1, 0]}>
        <cylinderGeometry args={[STEM_RADIUS, STEM_RADIUS, STEM_LENGTH, 12]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      <mesh ref={headRef} position={[0, STEM_LENGTH + 1 + HEAD_LENGTH / 2, 0]}>
        <coneGeometry args={[HEAD_RADIUS, HEAD_LENGTH, 18]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      {dragLabel && (
        <Html
          position={[0, STEM_LENGTH + HEAD_LENGTH + 3, 0]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div style={{
            background: 'rgba(0,0,0,0.85)',
            color: ARROW_COLOR_HOT,
            border: `1px solid ${ARROW_COLOR_HOT}55`,
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 11,
            fontWeight: 700,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}>
            {dragLabel}
          </div>
        </Html>
      )}
    </group>
  );
}
