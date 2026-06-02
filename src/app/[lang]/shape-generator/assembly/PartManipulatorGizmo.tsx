'use client';

/**
 * PartManipulatorGizmo — Phase 3.A.gizmo, NexyFab Pro own-CAD (ADR-013).
 *
 * 3-axis translate / rotate gizmo for editing a single {@link PartInstance}
 * pose (position + orientation) on top of Assembly3DViewer. Shipped
 * standalone — integration into Assembly3DViewer / AssemblyBrowserModal
 * happens in the next batch so the read-only viewer can stay unchanged.
 *
 * Design (matches BodyTransformOverlay / TransformScene playbook):
 *   1. Render an invisible "proxy" THREE.Object3D into the supplied
 *      scene at `selectedPart.position` / `.orientation`.
 *   2. Attach a stock three/examples TransformControls to the proxy,
 *      bound to the provided camera + dom element.
 *   3. On `dragging-changed → false` (mouse-up), read the proxy's pose
 *      and emit `onTransform(partId, position, orientation)`.
 *   4. ESC → controls.reset() + abort the in-flight drag.
 *   5. Snap-to-grid: translationSnap = 5 mm by default (CAD-friendly,
 *      Shift-modifier reproduces the BodyTransformOverlay UX).
 *
 * Why a Three-level component, not React JSX in the scene?
 *   Assembly3DViewer is plain Three.js — there is no R3F Canvas. We
 *   imperatively `scene.add(proxy)` and `scene.add(controls.getHelper())`
 *   so the gizmo lives in the same scene graph as the parts.
 *
 * Test contract:
 *   - jsdom has no WebGL. We mock `three` + the TransformControls module;
 *     the gizmo falls back to a graceful "no helper, no listener" path.
 *   - The visible DOM root `data-testid="part-manipulator-gizmo"` carries
 *     `data-mode` / `data-selected-part-id` for assertions.
 *
 * Out of scope (next batch):
 *   - Locking the gizmo behind a feature flag.
 *   - Multi-part selection (gizmo only handles a single PartInstance).
 *   - Snap-to-mate-frame (Phase 3.A.snap).
 */

import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import type { PartInstance, Quat } from '@/lib/assembly/assemblyState';

// ─── public types ────────────────────────────────────────────────────────

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PartManipulatorMode = 'translate' | 'rotate';

export interface PartManipulatorGizmoProps {
  /** The part to be transformed. `null` → gizmo is hidden / detached. */
  selectedPart: PartInstance | null;
  /** The scene shared with Assembly3DViewer. We `scene.add()` the proxy
   *  + the controls helper. */
  scene: THREE.Scene | null;
  /** Called once per drag-end (mouseUp) with the proxy's final pose.
   *  Snap is already applied when it fires. */
  onTransform: (partId: string, position: Vec3, orientation: Quat) => void;
  /** `'translate'` (default) → X/Y/Z arrows. `'rotate'` → X/Y/Z circles. */
  mode?: PartManipulatorMode;
  /** Required for a real gizmo. Optional so tests / SSR can mount without
   *  a live camera. When missing the gizmo skips TransformControls setup
   *  and stays at the DOM-only level. */
  camera?: THREE.Camera | null;
  /** Same story as `camera` — required for real interaction, optional
   *  for tests. */
  domElement?: HTMLElement | null;
  /** Translation grid step in mm. Default 5 mm (sub-feature grain). */
  translationSnapMm?: number;
  /** Rotation snap in radians. Default 15° = π/12. */
  rotationSnapRad?: number;
}

/** Default translation snap — 5 mm grid, intentionally CAD-friendly. */
export const DEFAULT_TRANSLATION_SNAP_MM = 5;
/** Default rotation snap — 15° (π/12 rad). */
export const DEFAULT_ROTATION_SNAP_RAD = Math.PI / 12;

// ─── pure helpers (exported for unit tests) ──────────────────────────────

/**
 * Snap a single component to the nearest multiple of `step`. Returns the
 * original value when `step` is non-positive (snap disabled).
 */
export function snapToGrid(value: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Vec3 snap convenience — apply per-axis grid quantisation. */
export function snapVec3(v: Vec3, step: number): Vec3 {
  return { x: snapToGrid(v.x, step), y: snapToGrid(v.y, step), z: snapToGrid(v.z, step) };
}

/**
 * Read a Three Object3D's pose into the IR types used by AssemblyState.
 * Defensive against mocked objects that omit a `.toArray()`-able pose.
 */
export function readProxyPose(
  proxy: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number } },
): { position: Vec3; orientation: Quat } {
  const p = proxy.position ?? { x: 0, y: 0, z: 0 };
  const q = proxy.quaternion ?? { x: 0, y: 0, z: 0, w: 1 };
  return {
    position: { x: p.x, y: p.y, z: p.z },
    orientation: { x: q.x, y: q.y, z: q.z, w: q.w },
  };
}

// ─── component ───────────────────────────────────────────────────────────

/**
 * Per-mode controls metadata. Kept as a const map so tests can assert
 * the mapping without poking at the running TransformControls instance.
 */
export const MODE_LABELS: Record<PartManipulatorMode, string> = {
  translate: 'translate',
  rotate: 'rotate',
};

export default function PartManipulatorGizmo({
  selectedPart,
  scene,
  onTransform,
  mode = 'translate',
  camera = null,
  domElement = null,
  translationSnapMm = DEFAULT_TRANSLATION_SNAP_MM,
  rotationSnapRad = DEFAULT_ROTATION_SNAP_RAD,
}: PartManipulatorGizmoProps): React.ReactElement | null {
  // Refs so re-renders don't tear down the proxy / controls.
  const proxyRef = useRef<THREE.Object3D | null>(null);
  const controlsRef = useRef<TransformControls | null>(null);
  const helperRef = useRef<THREE.Object3D | null>(null);
  // Always-current onTransform handle (avoids re-subscribing event listeners).
  const onTransformRef = useRef<typeof onTransform>(onTransform);
  useEffect(() => {
    onTransformRef.current = onTransform;
  }, [onTransform]);

  // ── mount: create proxy + (best-effort) TransformControls ──
  useEffect(() => {
    if (!selectedPart || !scene) {
      return;
    }
    let proxy: THREE.Object3D;
    try {
      proxy = new THREE.Object3D();
    } catch {
      // Three mocked without Object3D — bail out of imperative setup but
      // still render the DOM marker for tests.
      return;
    }
    try {
      proxy.position.set(selectedPart.position.x, selectedPart.position.y, selectedPart.position.z);
    } catch {
      /* mock */
    }
    try {
      proxy.quaternion.set(
        selectedPart.orientation.x,
        selectedPart.orientation.y,
        selectedPart.orientation.z,
        selectedPart.orientation.w,
      );
    } catch {
      /* mock */
    }
    try {
      scene.add?.(proxy);
    } catch {
      /* mock */
    }
    proxyRef.current = proxy;

    // TransformControls setup — guarded so a missing camera / dom or a
    // mocked TransformControls constructor doesn't crash the mount.
    let controls: TransformControls | null = null;
    if (camera && domElement) {
      try {
        controls = new TransformControls(camera, domElement);
        controls.setMode?.(mode);
        if (translationSnapMm > 0) controls.setTranslationSnap?.(translationSnapMm);
        if (rotationSnapRad > 0) controls.setRotationSnap?.(rotationSnapRad);
        controls.attach?.(proxy);
        // Add the helper into the scene graph so the gizmo renders.
        const helper =
          typeof (controls as TransformControls & { getHelper?: () => THREE.Object3D }).getHelper === 'function'
            ? (controls as TransformControls & { getHelper: () => THREE.Object3D }).getHelper()
            : (controls as unknown as THREE.Object3D);
        helperRef.current = helper;
        try {
          scene.add?.(helper);
        } catch {
          /* mock */
        }
      } catch {
        controls = null;
      }
    }
    controlsRef.current = controls;

    // Drag-end → commit. We only fire on the mouseUp transition so we
    // don't flood the parent with per-frame updates.
    const handleDraggingChanged = (e: { value?: unknown }): void => {
      const dragging = Boolean(e?.value);
      if (dragging) return;
      const p = proxyRef.current;
      if (!p) return;
      const { position, orientation } = readProxyPose(p);
      const snapped =
        mode === 'translate' && translationSnapMm > 0
          ? snapVec3(position, translationSnapMm)
          : position;
      onTransformRef.current(selectedPart.id, snapped, orientation);
    };

    // ESC → reset the in-flight drag (TransformControls.reset() restores
    // the proxy's pose-at-drag-start) and surface a no-commit cancel.
    const handleKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      const c = controlsRef.current;
      try {
        c?.reset?.();
      } catch {
        /* mock */
      }
      // No onTransform callback on cancel — caller's state is unchanged.
    };

    if (controls && typeof controls.addEventListener === 'function') {
      controls.addEventListener('dragging-changed', handleDraggingChanged as never);
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('keydown', handleKeyDown);
      }
      const c = controlsRef.current;
      if (c && typeof c.removeEventListener === 'function') {
        try {
          c.removeEventListener('dragging-changed', handleDraggingChanged as never);
        } catch {
          /* mock */
        }
      }
      try {
        c?.detach?.();
      } catch {
        /* mock */
      }
      try {
        c?.dispose?.();
      } catch {
        /* mock */
      }
      const h = helperRef.current;
      if (h && scene) {
        try {
          scene.remove?.(h);
        } catch {
          /* mock */
        }
      }
      helperRef.current = null;
      if (proxyRef.current && scene) {
        try {
          scene.remove?.(proxyRef.current);
        } catch {
          /* mock */
        }
      }
      proxyRef.current = null;
      controlsRef.current = null;
    };
    // Re-mount when selected part / scene / camera / dom changes — pose
    // seeding and listener wiring all depend on the live objects.
  }, [
    selectedPart,
    scene,
    camera,
    domElement,
    mode,
    translationSnapMm,
    rotationSnapRad,
  ]);

  // Mode flips while mounted: avoid full re-mount when we can patch in place.
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    try {
      c.setMode?.(mode);
    } catch {
      /* mock */
    }
  }, [mode]);

  // Reseed proxy pose if the part identity stayed the same but its
  // position / orientation moved (e.g. solver updated it).
  useEffect(() => {
    const p = proxyRef.current;
    if (!p || !selectedPart) return;
    try {
      p.position.set(selectedPart.position.x, selectedPart.position.y, selectedPart.position.z);
    } catch {
      /* mock */
    }
    try {
      p.quaternion.set(
        selectedPart.orientation.x,
        selectedPart.orientation.y,
        selectedPart.orientation.z,
        selectedPart.orientation.w,
      );
    } catch {
      /* mock */
    }
  }, [selectedPart]);

  // DOM marker — hidden when nothing's selected.
  const visible = useMemo(() => Boolean(selectedPart && scene), [selectedPart, scene]);
  if (!visible) return null;

  return (
    <div
      data-testid="part-manipulator-gizmo"
      data-mode={mode}
      data-selected-part-id={selectedPart!.id}
      data-translation-snap-mm={String(translationSnapMm)}
      data-rotation-snap-rad={String(rotationSnapRad)}
      style={{
        position: 'absolute',
        top: 4,
        right: 6,
        padding: '2px 6px',
        fontSize: 11,
        fontFamily: 'monospace',
        color: '#374151',
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid #d1d5db',
        borderRadius: 3,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {MODE_LABELS[mode]} · {selectedPart!.id}
    </div>
  );
}
