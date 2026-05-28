'use client';

/**
 * BodyTransformOverlay.tsx — Wave 2 Phase 3 Track E3.
 *
 * R3F overlay component for body-level move + rotate direct edits.
 * Mounts inside the <Canvas> alongside `DirectEditOverlay`. Self-no-
 * ops when:
 *   - The controller is disabled (flag OFF).
 *   - `mode` is anything other than `'move-body'` or `'rotate-body'`.
 *   - `geometry` is null.
 *
 * Body-pick semantics (spec ambiguity resolved):
 *   The current shape-generator displays a SINGLE body per viewport.
 *   Picking any face / triangle = picking THAT body. We resolve the
 *   `bodyId` from `geometry.userData.lastFeatureId` (the coarse
 *   provenance that every feature output carries). If that's missing
 *   we synthesise an id from the geometry's UUID — the op's
 *   `bodyId` is opaque to applyMoveBody / applyRotateBody when there
 *   isn't a lastFeatureId mismatch to warn about.
 *
 *   Multi-body picking (separate bodies in one scene, click selects
 *   one of N) is Phase 4 territory — out of scope for E3.
 *
 * Gizmo choice (decision log):
 *   We reuse drei's `<TransformControls>` (already a dependency, used
 *   in `ShapePreview.TransformScene`). Hand-rolling a 3-axis arrow
 *   gizmo would be 200+ LoC and duplicate work the user has already
 *   absorbed visually. Trade-off: TransformControls reads object's
 *   matrix on drag-end → we mirror the mesh into a proxy, drag the
 *   proxy, then translate the proxy's pose into our `moveBody` /
 *   `rotateBody` op. Same idiom as TransformScene.
 *
 *   For unit-test purposes the overlay falls back to a non-rendering
 *   placeholder when the host doesn't supply a `Canvas`-aware drei —
 *   tests check the React element shape, not the live gizmo.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { TransformControls } from '@react-three/drei';
import type { TransformControls as TransformControlsThree } from 'three/examples/jsm/controls/TransformControls.js';
import { useDirectEditController } from './DirectEditController';
import { applyMoveBody } from './applyMoveBody';
import { applyRotateBody } from './applyRotateBody';
import {
  BODY_TRANSLATION_SNAP_MM,
  BODY_ROTATION_SNAP_RAD,
  snapTranslationToGrid,
  snapAngleToStep,
} from './bodyTransformMath';
import type { DirectEditBodyPick } from './directEditTypes';

/** Direct-edit overlay mode. Composed by the toolbar in E3 (Phase 3
 *  W5); pushPull mode lives in the existing `DirectEditOverlay`.
 *  When E2 lands it adds `'dynamic-fillet'` / `'dynamic-chamfer'`. */
export type BodyTransformMode = 'move-body' | 'rotate-body' | 'off';

export interface BodyTransformOverlayProps {
  /** Current displayed geometry. The overlay reads positions from
   *  this attribute set; on commit it forwards the result via
   *  `onGeometryChange`. */
  geometry: THREE.BufferGeometry | null;
  /** Active body-transform mode. The overlay renders nothing when
   *  `mode === 'off'` OR the controller is disabled. */
  mode: BodyTransformMode;
  /** Called when the user finishes a drag — host swaps the displayed
   *  geometry to the result. */
  onGeometryChange?: (next: THREE.BufferGeometry) => void;
  /** Optional override for the translation snap step (mm). Defaults
   *  to {@link BODY_TRANSLATION_SNAP_MM}. */
  translationSnapMm?: number;
  /** Optional override for the rotation snap step (rad). Defaults to
   *  {@link BODY_ROTATION_SNAP_RAD} (15°). */
  rotationSnapRad?: number;
}

/** Resolve a stable bodyId for the displayed geometry. */
function resolveBodyId(geometry: THREE.BufferGeometry): string {
  const last = geometry.userData?.lastFeatureId;
  if (typeof last === 'string' && last.length > 0) return last;
  // Fallback to the geometry's UUID. Stable per geometry instance —
  // good enough for the session-only stack.
  return `body-${geometry.uuid}`;
}

/** Compute the body's bounding-box center for use as the rotation
 *  pivot. Falls back to origin for an empty geometry. */
function bodyBboxCenter(geometry: THREE.BufferGeometry): [number, number, number] {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return [0, 0, 0];
  return [
    (bb.min.x + bb.max.x) / 2,
    (bb.min.y + bb.max.y) / 2,
    (bb.min.z + bb.max.z) / 2,
  ];
}

export function BodyTransformOverlay({
  geometry,
  mode,
  onGeometryChange,
  translationSnapMm = BODY_TRANSLATION_SNAP_MM,
  rotationSnapRad = BODY_ROTATION_SNAP_RAD,
}: BodyTransformOverlayProps): React.ReactElement | null {
  const { pushOp, enabled } = useDirectEditController();
  const proxyRef = useRef<THREE.Object3D | null>(null);
  const controlsRef = useRef<TransformControlsThree | null>(null);
  const [pick, setPick] = useState<DirectEditBodyPick | null>(null);

  // Reset the proxy + pick when geometry or mode changes — the drei
  // TransformControls instance can outlive a swap, so we have to
  // re-seed its target.
  useEffect(() => {
    if (!geometry) {
      setPick(null);
      return;
    }
    setPick({
      bodyId: resolveBodyId(geometry),
      hitPoint: bodyBboxCenter(geometry),
    });
    // Reset proxy pose on every geometry swap so cumulative drags
    // never leak across applies.
    if (proxyRef.current) {
      proxyRef.current.position.set(0, 0, 0);
      proxyRef.current.quaternion.identity();
      proxyRef.current.updateMatrix();
    }
  }, [geometry, mode]);

  // Drag-end handler. The proxy's pose IS the cumulative drag — we
  // translate it into a single op and commit.
  const handleObjectChange = useCallback(() => {
    // Intentionally a no-op for the live-drag stream — we commit on
    // `mouseUp` (dragging-changed → false). The proxy keeps mutating
    // until release; if we recorded every frame we'd flood the
    // session stack.
  }, []);

  const handleDraggingChanged = useCallback((e: { value: unknown }) => {
    const dragging = Boolean(e.value);
    if (dragging) return; // ignore drag start; commit on drag end
    if (!geometry || !proxyRef.current || !pick) return;

    const proxy = proxyRef.current;
    const shiftHeld =
      typeof window !== 'undefined' &&
      // The drei wrapper doesn't forward modifier keys on
      // dragging-changed; we sniff the global event state via the
      // pointer event the user just released. Falls back to false in
      // SSR / test envs.
      (window as Window & { __nfabShiftHeld?: boolean }).__nfabShiftHeld === true;

    if (mode === 'move-body') {
      let translation: [number, number, number] = [
        proxy.position.x,
        proxy.position.y,
        proxy.position.z,
      ];
      if (shiftHeld && translationSnapMm > 0) {
        translation = [
          ...snapTranslationToGrid(translation, translationSnapMm),
        ] as [number, number, number];
      }
      const mag = Math.hypot(translation[0], translation[1], translation[2]);
      if (mag > 0) {
        const op = {
          kind: 'moveBody' as const,
          bodyId: pick.bodyId,
          translation,
          createdAt: Date.now(),
        };
        const result = applyMoveBody(geometry, op);
        if (result.applied) {
          pushOp(op);
          if (onGeometryChange) onGeometryChange(result.geometry);
        }
      }
    } else if (mode === 'rotate-body') {
      // Extract axis + angle from the proxy's quaternion.
      const q = proxy.quaternion;
      // axis-angle from a quaternion: angle = 2 · acos(w)
      const w = THREE.MathUtils.clamp(q.w, -1, 1);
      let angle = 2 * Math.acos(w);
      const s = Math.sqrt(Math.max(0, 1 - w * w));
      const axis: [number, number, number] = s < 1e-6
        ? [1, 0, 0]
        : [q.x / s, q.y / s, q.z / s];
      if (shiftHeld && rotationSnapRad > 0) {
        angle = snapAngleToStep(angle, rotationSnapRad);
      }
      // Normalise angle to (-π, π] for intuitive sign.
      while (angle > Math.PI) angle -= 2 * Math.PI;
      while (angle < -Math.PI) angle += 2 * Math.PI;
      if (Math.abs(angle) > 1e-9) {
        const pivot = bodyBboxCenter(geometry);
        const op = {
          kind: 'rotateBody' as const,
          bodyId: pick.bodyId,
          rotation: { axis, angleRad: angle, pivot },
          createdAt: Date.now(),
        };
        const result = applyRotateBody(geometry, op);
        if (result.applied) {
          pushOp(op);
          if (onGeometryChange) onGeometryChange(result.geometry);
        }
      }
    }

    // Reset the proxy so subsequent drags start from the new pose.
    proxy.position.set(0, 0, 0);
    proxy.quaternion.identity();
    proxy.updateMatrix();
  }, [
    geometry,
    pick,
    mode,
    onGeometryChange,
    pushOp,
    rotationSnapRad,
    translationSnapMm,
  ]);

  // Bind the controls event listeners.
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.addEventListener('objectChange', handleObjectChange);
    c.addEventListener('dragging-changed', handleDraggingChanged as never);
    return () => {
      c.removeEventListener('objectChange', handleObjectChange);
      c.removeEventListener('dragging-changed', handleDraggingChanged as never);
    };
  }, [handleObjectChange, handleDraggingChanged, mode]);

  // Track shift-held globally so the dragging-changed handler can
  // pick it up without binding to every pointer event.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      (window as Window & { __nfabShiftHeld?: boolean }).__nfabShiftHeld =
        e.shiftKey;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  // The transform-controls' `mode` prop. drei maps 'translate' /
  // 'rotate' / 'scale'. Scale is out of scope per spec.
  const tcMode = useMemo<'translate' | 'rotate'>(
    () => (mode === 'rotate-body' ? 'rotate' : 'translate'),
    [mode],
  );

  // No-op when disabled / off / missing geometry.
  if (!geometry || !enabled || mode === 'off') return null;

  return (
    <group data-testid="body-transform-overlay" data-mode={mode}>
      {/* Invisible proxy whose pose is read on drag-end. We render
       *  it at the body's bbox center so the gizmo spawns there. */}
      <object3D
        ref={proxyRef}
        position={pick ? pick.hitPoint : [0, 0, 0]}
      />
      {proxyRef.current && (
        <TransformControls
          // drei's TransformControls types narrow the ref to
          // `TransformControls<Camera>`; we cast through unknown since
          // we only call the base-class `addEventListener` / pose
          // readout that's shared by both forms.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ref={controlsRef as unknown as React.Ref<any>}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          object={proxyRef as unknown as any}
          mode={tcMode}
          size={0.7}
        />
      )}
    </group>
  );
}
