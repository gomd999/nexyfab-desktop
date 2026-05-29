'use client';

/**
 * DirectEditHostBridge.tsx — Wave 2 Phase 3 Track E host-side integration.
 *
 * One-component host wiring that ties together every direct-edit op:
 *   - DirectEditToolbar (mode toggles + undo/clear/commit)
 *   - SubtractBodyOverlay (E4 2-body picker)
 *   - applyPushPull (E1) / applyDynamicFillet + applyDynamicChamfer (E2) /
 *     applyMoveBody + applyRotateBody (E3) / applySubtractBody (E4)
 *   - DirectEditController stack mutations
 *
 * Why a bridge instead of touching ShapeGeneratorInner.tsx directly:
 *   - ShapeGeneratorInner is 10K+ LoC. Wiring 5 direct-edit subsystems
 *     in place would touch ~500 LoC across multiple render branches.
 *   - The bridge collapses the integration to a single mount point:
 *
 *         <DirectEditHostBridge
 *           lang={lang}
 *           sceneAdapter={{
 *             getActiveBodyId: () => activeBodyIdRef.current,
 *             getTargetGeometry: (bodyId) => threeMeshGeo,
 *             resolveBodyLabel: (bodyId) => '브라켓',
 *             removeBodyFromScene: (bodyId) => sceneRef.remove(...),
 *             replaceBodyGeometry: (bodyId, newGeo) => sceneRef.set(...),
 *             notify: (level, msg) => toastFromHost(level, msg),
 *           }}
 *           viewportRaycastRef={raycastHandleRef}
 *         />
 *
 *   - The viewport raycaster forwards picks via the imperative handle:
 *       - `ref.current.pickBody(bodyId)`  — subtract-body (E4)
 *       - `ref.current.pickFace(faceId)`  — push-pull (E1)
 *       - `ref.current.pickEdge(edgeId)`  — fillet/chamfer (E2)
 *       - `ref.current.applyTransform('move' | 'rotate', payload)` — gizmo (E3)
 *   - Subsequent E5 promote-to-history wiring lands on the SAME bridge
 *     without touching the host again.
 *
 * Dispatch table (mode → op):
 *   - 'push-pull'      → pickFace        → applyPushPull
 *   - 'fillet-edge'    → pickEdge        → applyDynamicFillet
 *   - 'chamfer-edge'   → pickEdge        → applyDynamicChamfer
 *   - 'move-body'      → applyTransform  → applyMoveBody
 *   - 'rotate-body'    → applyTransform  → applyRotateBody
 *   - 'subtract-body'  → pickBody (×2)   → applySubtractBody
 *
 * All non-subtract ops use the scene's active body id (via
 * `getActiveBodyId`) since picking happens on the active body's mesh.
 * Single-body scenes (shape-generator today) return a synthetic id;
 * multi-body scenes (Phase 4) return the picked body's id.
 */

import React, {
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type * as THREE from 'three';
import {
  DirectEditToolbar,
  type DirectEditMode,
} from './DirectEditToolbar';
import {
  SubtractBodyOverlay,
  type SubtractBodyOverlayHandle,
} from './SubtractBodyOverlay';
import { applySubtractBody } from './applySubtractBody';
import { applyPushPull } from './applyPushPull';
import { applyDynamicFillet } from './applyDynamicFillet';
import { applyDynamicChamfer } from './applyDynamicChamfer';
import { applyMoveBody } from './applyMoveBody';
import { applyRotateBody } from './applyRotateBody';
import { useDirectEditController, useDirectEditEnabled } from './DirectEditController';

/** Payload for the E3 transform dispatch. The viewport-side gizmo
 *  resolves a drag-end into one of these and forwards via the imperative
 *  handle's `applyTransform` callback. The bridge then routes to
 *  applyMoveBody / applyRotateBody using the active body id. */
export type DirectEditTransformPayload =
  | { kind: 'move'; translation: [number, number, number] }
  | {
      kind: 'rotate';
      rotation: {
        axis: [number, number, number];
        angleRad: number;
        pivot: [number, number, number];
      };
    };

/** Optional per-op override hook for the push-pull face-pick path.
 *  When the viewport overlay drives a live drag the host calls
 *  `pickFace(faceId, { offsetMm })` with the drag-end offset; when the
 *  caller omits the offset we fall back to the bridge's default. */
export interface DirectEditPickFaceOptions {
  /** Signed offset (mm) along the face normal. Defaults to
   *  `DirectEditHostBridgeProps.defaultPushPullOffsetMm` (5mm). */
  offsetMm?: number;
}

/** Optional per-op override hook for the E2 edge-pick path. */
export interface DirectEditPickEdgeOptions {
  /** Radius (fillet) or distance (chamfer) in mm. Defaults to
   *  `DirectEditHostBridgeProps.defaultEdgeOpSizeMm` (2mm). */
  sizeMm?: number;
}

/** Imperative handle exposed for the viewport raycaster + gizmo. The
 *  host wires its raycaster / gizmo drag-end callbacks to forward to
 *  these. */
export interface DirectEditViewportHandle {
  /** Forward a viewport body pick to the active mode's overlay.
   *  Used by `subtract-body` (E4). */
  pickBody: (bodyId: string) => void;
  /** Forward a face pick to the push-pull op (E1). The offset is
   *  optional — the bridge uses its configured default when omitted. */
  pickFace: (faceId: string, options?: DirectEditPickFaceOptions) => void;
  /** Forward an edge pick to the dynamic fillet / chamfer op (E2).
   *  The size (radius or distance) is optional — bridge default used
   *  when omitted. The mode (`fillet-edge` vs `chamfer-edge`) selects
   *  the applier. */
  pickEdge: (edgeId: string, options?: DirectEditPickEdgeOptions) => void;
  /** Forward a transform drag-end to the move / rotate op (E3). */
  applyTransform: (payload: DirectEditTransformPayload) => void;
  /** Mode-toggle handle so keyboard shortcuts can drive the toolbar. */
  setMode: (mode: DirectEditMode) => void;
}

/** Scene-side callbacks. The host owns the THREE scene graph; the
 *  bridge only orchestrates direct-edit ops + invokes these. */
export interface DirectEditSceneAdapter {
  /** Return the currently-active body id for non-subtract ops. The
   *  bridge needs this to know which body to dispatch push-pull /
   *  edge / transform ops against. Returns `null` when no body is
   *  active (the bridge then warns + skips the op).
   *
   *  In the single-body shape-generator scene this returns a stable
   *  synthetic id (e.g. `'__primary'`). Multi-body scenes (Phase 4)
   *  return the picked / selected body id. */
  getActiveBodyId?: () => string | null;
  /** Return the current BufferGeometry for a body id (or null when
   *  the body has been removed). */
  getTargetGeometry: (bodyId: string) => THREE.BufferGeometry | null;
  /** Optional human-friendly label for the body (defaults to id). */
  resolveBodyLabel?: (bodyId: string) => string;
  /** Remove the tool body from the scene after a successful subtract. */
  removeBodyFromScene: (bodyId: string) => void;
  /** Replace the target body's geometry in the scene after a successful
   *  op (subtract / push-pull / fillet / move / rotate all use this). */
  replaceBodyGeometry: (bodyId: string, nextGeo: THREE.BufferGeometry) => void;
  /** Optional toast / notification hook for failures + applies. */
  notify?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface DirectEditHostBridgeProps {
  readonly lang?: string;
  readonly sceneAdapter: DirectEditSceneAdapter;
  /** Imperative handle for the viewport raycaster to forward body
   *  picks. The host typically stores this in a ref and calls
   *  `ref.current?.pickBody(bodyId)` from its raycaster callback. */
  readonly viewportRaycastRef?: React.RefObject<DirectEditViewportHandle | null>;
  /** Override the initial mode for tests. */
  readonly initialMode?: DirectEditMode;
  /** Default offset for push-pull face picks when the caller omits an
   *  explicit `offsetMm`. Defaults to 5mm — a sensible CAD default that
   *  matches the SolidWorks "default extrude" depth. */
  readonly defaultPushPullOffsetMm?: number;
  /** Default size (mm) for E2 fillet radius / chamfer distance when the
   *  caller omits an explicit `sizeMm`. Defaults to 2mm. */
  readonly defaultEdgeOpSizeMm?: number;
}

export function DirectEditHostBridge(
  props: DirectEditHostBridgeProps,
): React.ReactElement | null {
  const {
    lang = 'en',
    sceneAdapter,
    viewportRaycastRef,
    initialMode = 'off',
    defaultPushPullOffsetMm = 5,
    defaultEdgeOpSizeMm = 2,
  } = props;

  const enabled = useDirectEditEnabled();
  const { pushOp } = useDirectEditController();
  const [mode, setMode] = useState<DirectEditMode>(initialMode);
  const subtractOverlayRef = useRef<SubtractBodyOverlayHandle | null>(null);

  // Resolve the active body id for non-subtract ops. Falls back to a
  // single-body synthetic id when the host hasn't wired the optional
  // `getActiveBodyId`. The fallback keeps the existing single-body
  // scene working without forcing the host to plumb an extra callback.
  const resolveActiveBodyId = useCallback((): string | null => {
    if (sceneAdapter.getActiveBodyId) return sceneAdapter.getActiveBodyId();
    return '__primary';
  }, [sceneAdapter]);

  // ── E4 subtract-body apply path ─────────────────────────────────────
  const handleSubtractApply = useCallback(
    ({ targetBodyId, toolBodyId }: { targetBodyId: string; toolBodyId: string }) => {
      const targetGeo = sceneAdapter.getTargetGeometry(targetBodyId);
      if (!targetGeo) {
        sceneAdapter.notify?.('error', `Target body '${targetBodyId}' not found`);
        return;
      }
      const result = applySubtractBody(
        targetGeo,
        { kind: 'subtractBody', targetBodyId, toolBodyId, createdAt: Date.now() },
        {
          lookupToolGeometry: sceneAdapter.getTargetGeometry,
          warn: (m) => sceneAdapter.notify?.('warn', m),
        },
      );
      if (!result.applied) {
        sceneAdapter.notify?.('warn', `Subtract failed: ${result.rejectionReason ?? 'unknown'}`);
        return;
      }
      sceneAdapter.replaceBodyGeometry(targetBodyId, result.geometry);
      sceneAdapter.removeBodyFromScene(result.consumedToolBodyId);
      pushOp({
        kind: 'subtractBody',
        targetBodyId,
        toolBodyId: result.consumedToolBodyId,
        createdAt: Date.now(),
      });
      sceneAdapter.notify?.('info', `Subtracted ${toolBodyId} from ${targetBodyId}`);
    },
    [sceneAdapter, pushOp],
  );

  // ── E1 push-pull apply path ─────────────────────────────────────────
  const handlePushPullPick = useCallback(
    (faceId: string, options?: DirectEditPickFaceOptions) => {
      const bodyId = resolveActiveBodyId();
      if (!bodyId) {
        sceneAdapter.notify?.('warn', 'Push-pull: no active body');
        return;
      }
      const targetGeo = sceneAdapter.getTargetGeometry(bodyId);
      if (!targetGeo) {
        sceneAdapter.notify?.('error', `Push-pull: body '${bodyId}' not found`);
        return;
      }
      const offsetMm = options?.offsetMm ?? defaultPushPullOffsetMm;
      const op = {
        kind: 'pushPull' as const,
        faceId,
        offsetMm,
        createdAt: Date.now(),
      };
      const result = applyPushPull(targetGeo, op, {
        warn: (m) => sceneAdapter.notify?.('warn', m),
      });
      if (!result.applied) {
        sceneAdapter.notify?.('warn', `Push-pull failed on face=${faceId}`);
        return;
      }
      sceneAdapter.replaceBodyGeometry(bodyId, result.geometry);
      pushOp(op);
      sceneAdapter.notify?.('info', `Push-pull face=${faceId} by ${offsetMm}mm`);
    },
    [sceneAdapter, pushOp, resolveActiveBodyId, defaultPushPullOffsetMm],
  );

  // ── E2 dynamic fillet / chamfer apply path ──────────────────────────
  const handleEdgePick = useCallback(
    (edgeId: string, options?: DirectEditPickEdgeOptions) => {
      // Mode at pick time decides fillet vs chamfer.
      const isFillet = mode === 'fillet-edge';
      const isChamfer = mode === 'chamfer-edge';
      if (!isFillet && !isChamfer) {
        // Edge pick fired while a non-edge mode is active — silently
        // ignore. The toolbar / overlay enforces the active mode UX,
        // and tests rely on this no-op behaviour.
        return;
      }
      const bodyId = resolveActiveBodyId();
      if (!bodyId) {
        sceneAdapter.notify?.('warn', `${isFillet ? 'Fillet' : 'Chamfer'}: no active body`);
        return;
      }
      const targetGeo = sceneAdapter.getTargetGeometry(bodyId);
      if (!targetGeo) {
        sceneAdapter.notify?.(
          'error',
          `${isFillet ? 'Fillet' : 'Chamfer'}: body '${bodyId}' not found`,
        );
        return;
      }
      const sizeMm = options?.sizeMm ?? defaultEdgeOpSizeMm;
      if (isFillet) {
        const op = {
          kind: 'dynamicFillet' as const,
          edgeId,
          radiusMm: sizeMm,
          createdAt: Date.now(),
        };
        const result = applyDynamicFillet(targetGeo, op, {
          warn: (m) => sceneAdapter.notify?.('warn', m),
        });
        if (!result.applied) {
          sceneAdapter.notify?.('warn', `Fillet failed on edge=${edgeId}`);
          return;
        }
        sceneAdapter.replaceBodyGeometry(bodyId, result.geometry);
        pushOp(op);
        sceneAdapter.notify?.('info', `Filleted edge=${edgeId} r=${sizeMm}mm`);
      } else {
        const op = {
          kind: 'dynamicChamfer' as const,
          edgeId,
          distanceMm: sizeMm,
          createdAt: Date.now(),
        };
        const result = applyDynamicChamfer(targetGeo, op, {
          warn: (m) => sceneAdapter.notify?.('warn', m),
        });
        if (!result.applied) {
          sceneAdapter.notify?.('warn', `Chamfer failed on edge=${edgeId}`);
          return;
        }
        sceneAdapter.replaceBodyGeometry(bodyId, result.geometry);
        pushOp(op);
        sceneAdapter.notify?.('info', `Chamfered edge=${edgeId} d=${sizeMm}mm`);
      }
    },
    [mode, sceneAdapter, pushOp, resolveActiveBodyId, defaultEdgeOpSizeMm],
  );

  // ── E3 move / rotate body apply path ────────────────────────────────
  const handleTransform = useCallback(
    (payload: DirectEditTransformPayload) => {
      const isMove = mode === 'move-body' && payload.kind === 'move';
      const isRotate = mode === 'rotate-body' && payload.kind === 'rotate';
      if (!isMove && !isRotate) {
        // Mode / payload mismatch — silently ignore. Mirrors the
        // edge-pick wrong-mode no-op.
        return;
      }
      const bodyId = resolveActiveBodyId();
      if (!bodyId) {
        sceneAdapter.notify?.('warn', `${isMove ? 'Move' : 'Rotate'}: no active body`);
        return;
      }
      const targetGeo = sceneAdapter.getTargetGeometry(bodyId);
      if (!targetGeo) {
        sceneAdapter.notify?.(
          'error',
          `${isMove ? 'Move' : 'Rotate'}: body '${bodyId}' not found`,
        );
        return;
      }
      if (isMove && payload.kind === 'move') {
        const op = {
          kind: 'moveBody' as const,
          bodyId,
          translation: payload.translation,
          createdAt: Date.now(),
        };
        const result = applyMoveBody(targetGeo, op, {
          warn: (m) => sceneAdapter.notify?.('warn', m),
        });
        if (!result.applied) {
          sceneAdapter.notify?.('warn', `Move failed on body=${bodyId}`);
          return;
        }
        sceneAdapter.replaceBodyGeometry(bodyId, result.geometry);
        pushOp(op);
        sceneAdapter.notify?.(
          'info',
          `Moved body=${bodyId} by [${payload.translation.join(', ')}]mm`,
        );
      } else if (isRotate && payload.kind === 'rotate') {
        const op = {
          kind: 'rotateBody' as const,
          bodyId,
          rotation: payload.rotation,
          createdAt: Date.now(),
        };
        const result = applyRotateBody(targetGeo, op, {
          warn: (m) => sceneAdapter.notify?.('warn', m),
        });
        if (!result.applied) {
          sceneAdapter.notify?.('warn', `Rotate failed on body=${bodyId}`);
          return;
        }
        sceneAdapter.replaceBodyGeometry(bodyId, result.geometry);
        pushOp(op);
        sceneAdapter.notify?.(
          'info',
          `Rotated body=${bodyId} by ${payload.rotation.angleRad.toFixed(3)}rad`,
        );
      }
    },
    [mode, sceneAdapter, pushOp, resolveActiveBodyId],
  );

  // Mode toggle from the toolbar — resets per-mode overlay state.
  const handleModeSelect = useCallback((next: DirectEditMode) => {
    setMode(next);
    if (next !== 'subtract-body') {
      subtractOverlayRef.current?.reset();
    }
  }, []);

  // Expose viewport handle (raycaster + gizmo → mode-specific applier).
  useImperativeHandle(
    viewportRaycastRef,
    () => ({
      pickBody: (bodyId: string) => {
        if (mode === 'subtract-body') {
          subtractOverlayRef.current?.pickBody(bodyId);
        }
        // Other modes ignore body picks — push-pull uses face picks,
        // E2 uses edge picks, E3 uses gizmo transforms.
      },
      pickFace: (faceId: string, options?: DirectEditPickFaceOptions) => {
        if (mode === 'push-pull') {
          handlePushPullPick(faceId, options);
        }
        // Wrong-mode face picks are silently ignored — the overlay
        // gates which mode emits picks in the first place.
      },
      pickEdge: (edgeId: string, options?: DirectEditPickEdgeOptions) => {
        if (mode === 'fillet-edge' || mode === 'chamfer-edge') {
          handleEdgePick(edgeId, options);
        }
      },
      applyTransform: (payload: DirectEditTransformPayload) => {
        if (mode === 'move-body' || mode === 'rotate-body') {
          handleTransform(payload);
        }
      },
      setMode: handleModeSelect,
    }),
    [mode, handleModeSelect, handlePushPullPick, handleEdgePick, handleTransform],
  );

  if (!enabled) return null;

  return (
    <>
      <DirectEditToolbar
        lang={lang}
        mode={mode}
        onModeSelect={handleModeSelect}
      />
      <SubtractBodyOverlay
        active={mode === 'subtract-body'}
        lang={lang}
        onApply={handleSubtractApply}
        resolveBodyLabel={sceneAdapter.resolveBodyLabel}
        testHandleRef={subtractOverlayRef}
      />
    </>
  );
}
