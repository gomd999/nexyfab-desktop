'use client';

/**
 * DirectEditHostBridge.tsx — Wave 2 Phase 3 Track E host-side integration.
 *
 * One-component host wiring that ties together:
 *   - DirectEditToolbar (mode toggles + undo/clear/commit)
 *   - SubtractBodyOverlay (E4 2-body picker)
 *   - applySubtractBody (E4 op applier)
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
 *             getTargetGeometry: (bodyId) => threeMeshGeo,
 *             resolveBodyLabel: (bodyId) => '브라켓',
 *             removeBodyFromScene: (bodyId) => sceneRef.remove(...),
 *             replaceBodyGeometry: (bodyId, newGeo) => sceneRef.set(...),
 *           }}
 *           viewportRaycastRef={raycastHandleRef}
 *         />
 *
 *   - The viewport raycaster forwards body picks via the imperative
 *     handle `viewportRaycastRef.current.pickBody(bodyId)`.
 *   - Subsequent E5 promote-to-history wiring lands on the SAME bridge
 *     without touching the host again.
 *
 * E1-E3 (push-pull / fillet / move / rotate) overlays are scoped here
 * too as the toolbar lights up the corresponding mode; for now this
 * commit covers E4 end-to-end (toolbar button → overlay → applier →
 * scene update) since E4's applier was the last to land. E1-E3 wire
 * the same shape: extend `handleApplyByMode` switch.
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
import { useDirectEditController, useDirectEditEnabled } from './DirectEditController';

/** Imperative handle exposed for the viewport raycaster. The host
 *  wires `onBodyClick(bodyId)` to forward to this. */
export interface DirectEditViewportHandle {
  /** Forward a viewport body pick to the active mode's overlay. */
  pickBody: (bodyId: string) => void;
  /** Mode-toggle handle so keyboard shortcuts can drive the toolbar. */
  setMode: (mode: DirectEditMode) => void;
}

/** Scene-side callbacks. The host owns the THREE scene graph; the
 *  bridge only orchestrates direct-edit ops + invokes these. */
export interface DirectEditSceneAdapter {
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
}

export function DirectEditHostBridge(
  props: DirectEditHostBridgeProps,
): React.ReactElement | null {
  const {
    lang = 'en',
    sceneAdapter,
    viewportRaycastRef,
    initialMode = 'off',
  } = props;

  const enabled = useDirectEditEnabled();
  const { pushOp } = useDirectEditController();
  const [mode, setMode] = useState<DirectEditMode>(initialMode);
  const subtractOverlayRef = useRef<SubtractBodyOverlayHandle | null>(null);

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

  // Mode toggle from the toolbar — resets per-mode overlay state.
  const handleModeSelect = useCallback((next: DirectEditMode) => {
    setMode(next);
    if (next !== 'subtract-body') {
      subtractOverlayRef.current?.reset();
    }
  }, []);

  // Expose viewport handle (raycaster → mode-specific overlay).
  useImperativeHandle(
    viewportRaycastRef,
    () => ({
      pickBody: (bodyId: string) => {
        if (mode === 'subtract-body') {
          subtractOverlayRef.current?.pickBody(bodyId);
        }
        // E1 push-pull / E3 move/rotate hook same shape — see header.
      },
      setMode: handleModeSelect,
    }),
    [mode, handleModeSelect],
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
