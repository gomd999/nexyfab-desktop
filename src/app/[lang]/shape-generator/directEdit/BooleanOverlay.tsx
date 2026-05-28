'use client';

/**
 * BooleanOverlay.tsx — Wave 2 Phase 3 Track E4 (W6).
 *
 * R3F overlay for the body-subtract direct edit. Implements the
 * 2-stage Pick → Pick → Confirm UX:
 *
 *   Stage 1 — Pick tool body
 *     User clicks any body in the viewport. We tag it as the TOOL
 *     (red wireframe overlay). Advances to Stage 2.
 *
 *   Stage 2 — Pick target body
 *     User clicks another body. We tag it as the TARGET (blue
 *     wireframe overlay). Both highlights stay visible. Advances to
 *     Stage 3.
 *
 *   Stage 3 — Confirm
 *     User clicks the Confirm button (rendered as an in-scene HUD
 *     overlay) OR the toolbar Confirm button. We run applySubtractBody
 *     and forward the result.
 *
 * Cancel is supported at every stage via:
 *   - The escape key (window keydown).
 *   - The toolbar Cancel button (host wires it through `onCancel`).
 *
 * Spec ambiguity resolved (per E4 brief):
 *   - 2-stage pick UX: clickable cycle Tool → Target → Confirm. NOT a
 *     modal — modals interrupt the viewport flow which is the whole
 *     point of direct edit. The status bar (in DirectEditToolbar)
 *     keeps the user oriented.
 *   - Visual preview: SOLID green silhouette of the predicted result
 *     would require pre-running the (expensive) CSG just for preview;
 *     instead we render a simple translucent green BOOLEAN-INDICATOR
 *     marker that pulses at the centroid between the two picked
 *     bodies. The full result silhouette becomes visible the moment
 *     the user confirms — same flow Fusion uses.
 *   - Picking is delegated to the host's pointer events; the overlay
 *     consumes a `bodyPicker` callback the host provides. In the
 *     single-body shape-generator scene the host wires this to a
 *     fixed bodyId (the current displayed geometry's lastFeatureId).
 *     Multi-body picking is W7/Phase 4.
 *
 * Mount inside <Canvas> alongside BodyTransformOverlay. Self-no-ops
 * when:
 *   - The controller is disabled (flag OFF).
 *   - `mode !== 'subtract-body'`.
 *   - `geometry` is null.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useDirectEditController } from './DirectEditController';
import { applySubtractBody } from './applySubtractBody';
import {
  checkSubtractBodyCaps,
  type BooleanCapWarning,
} from './booleanCapWarnings';
import type { DirectEditBodyPick } from './directEditTypes';

/** The three stages of the subtract UX. */
export type BooleanOverlayStage =
  | 'pick-tool'
  | 'pick-target'
  | 'confirm';

/** Overlay mode (parity with `BodyTransformMode`). Only one mode here
 *  — but the union shape keeps the toolbar's switch exhaustive. */
export type BooleanOverlayMode = 'subtract-body' | 'off';

export interface BooleanOverlayProps {
  /** Current displayed (target candidate) geometry. */
  geometry: THREE.BufferGeometry | null;
  /** The active overlay mode. */
  mode: BooleanOverlayMode;
  /** Called when the user finishes a confirm — host swaps the
   *  displayed geometry to the result. */
  onGeometryChange?: (next: THREE.BufferGeometry) => void;
  /** Called when keepTool is true AND the op committed: host receives
   *  the additional tool-clone geometry. The default behaviour (no
   *  callback) silently drops it; multi-body scenes (Phase 4) wire
   *  this up to spawn the kept tool as a sibling. */
  onKeepToolGeometry?: (toolClone: THREE.BufferGeometry) => void;
  /** Cap-warning sink — the toolbar's warning strip subscribes to
   *  this to render the localized message. */
  onWarning?: (warnings: BooleanCapWarning[]) => void;
  /** Default value for `keepTool`. The host can mirror this in the
   *  toolbar as a checkbox. */
  keepTool?: boolean;
  /** Optional resolver — given a click target, returns the bodyId +
   *  geometry. In the single-body scene this is `() => { id:
   *  geometry.userData.lastFeatureId, geo: geometry }`. Multi-body
   *  scenes wire this to a raycast lookup. */
  resolveBody?: (
    pick: DirectEditBodyPick,
  ) => { id: string; geo: THREE.BufferGeometry } | null;
}

/** Resolve a stable bodyId for a geometry — mirrors
 *  BodyTransformOverlay.resolveBodyId. */
function resolveBodyIdFromGeometry(geometry: THREE.BufferGeometry): string {
  const last = geometry.userData?.lastFeatureId;
  if (typeof last === 'string' && last.length > 0) return last;
  return `body-${geometry.uuid}`;
}

/** Bounding-box centroid for a geometry — used to position the
 *  preview indicator. */
function bboxCenter(geometry: THREE.BufferGeometry): [number, number, number] {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  if (!bb) return [0, 0, 0];
  return [
    (bb.min.x + bb.max.x) / 2,
    (bb.min.y + bb.max.y) / 2,
    (bb.min.z + bb.max.z) / 2,
  ];
}

/** Internal state shape for the picking flow. */
interface PickState {
  toolId: string | null;
  toolGeo: THREE.BufferGeometry | null;
  targetId: string | null;
  targetGeo: THREE.BufferGeometry | null;
}

const EMPTY_PICKS: PickState = {
  toolId: null,
  toolGeo: null,
  targetId: null,
  targetGeo: null,
};

/** Imperative API surfaced via ref or imported by tests that want to
 *  drive the overlay without touching the DOM. Each function is the
 *  same one wired up to the actual UI affordances. */
export interface BooleanOverlayHandle {
  /** Programmatic pick — used by the toolbar's Confirm flow. */
  pickAsTool: (pick: DirectEditBodyPick) => void;
  pickAsTarget: (pick: DirectEditBodyPick) => void;
  confirm: () => void;
  cancel: () => void;
  currentStage: () => BooleanOverlayStage;
}

export function BooleanOverlay({
  geometry,
  mode,
  onGeometryChange,
  onKeepToolGeometry,
  onWarning,
  keepTool = false,
  resolveBody,
}: BooleanOverlayProps): React.ReactElement | null {
  const { pushOp, enabled } = useDirectEditController();
  const [picks, setPicks] = useState<PickState>(EMPTY_PICKS);

  // Reset picks whenever mode flips off / geometry is swapped. The
  // session-stack still keeps prior ops; resetting only the pick
  // state means re-entering the mode restarts at Stage 1.
  useEffect(() => {
    setPicks(EMPTY_PICKS);
  }, [mode, geometry]);

  // Default resolver: every click maps to the current displayed
  // geometry's body. In the single-body scene the same body is
  // returned for both clicks — which the validator catches as
  // SAME_BODY. The host wires a real picker for multi-body scenes.
  const defaultResolveBody = useCallback(
    (
      pick: DirectEditBodyPick,
    ): { id: string; geo: THREE.BufferGeometry } | null => {
      if (!geometry) return null;
      return { id: pick.bodyId, geo: geometry };
    },
    [geometry],
  );
  const doResolve = resolveBody ?? defaultResolveBody;

  // Current stage — derived from the pick state.
  const stage: BooleanOverlayStage = useMemo(() => {
    if (picks.toolId === null) return 'pick-tool';
    if (picks.targetId === null) return 'pick-target';
    return 'confirm';
  }, [picks]);

  const pickAsTool = useCallback(
    (pick: DirectEditBodyPick) => {
      const r = doResolve(pick);
      if (!r) return;
      setPicks((prev) => ({
        ...prev,
        toolId: r.id,
        toolGeo: r.geo,
      }));
    },
    [doResolve],
  );

  const pickAsTarget = useCallback(
    (pick: DirectEditBodyPick) => {
      const r = doResolve(pick);
      if (!r) return;
      setPicks((prev) => ({
        ...prev,
        targetId: r.id,
        targetGeo: r.geo,
      }));
    },
    [doResolve],
  );

  const cancel = useCallback(() => {
    setPicks(EMPTY_PICKS);
  }, []);

  const confirm = useCallback(() => {
    if (
      !picks.toolId ||
      !picks.targetId ||
      !picks.toolGeo ||
      !picks.targetGeo
    ) {
      return;
    }
    const op = {
      kind: 'subtractBody' as const,
      targetBodyId: picks.targetId,
      toolBodyId: picks.toolId,
      keepTool,
      createdAt: Date.now(),
    };
    // Pre-warn pass for the host's warning strip. The applier
    // re-runs the same check but raising the warning early is
    // cheaper than waiting for the applier to surface it.
    const preWarnings = checkSubtractBodyCaps(op, {
      target: picks.targetGeo,
      tool: picks.toolGeo,
    });
    if (onWarning && preWarnings.length > 0) onWarning(preWarnings);

    const result = applySubtractBody(picks.targetGeo, picks.toolGeo, op);
    if (result.applied) {
      pushOp(op);
      if (onGeometryChange) onGeometryChange(result.geometry);
      if (op.keepTool && result.keptToolGeometry && onKeepToolGeometry) {
        onKeepToolGeometry(result.keptToolGeometry);
      }
    }
    // Always surface the warning bus on confirm — null-result /
    // disjoint / csg-error all land here.
    if (onWarning && result.warnings.length > 0) onWarning(result.warnings);
    // Reset back to Stage 1 either way — the user can pick again.
    setPicks(EMPTY_PICKS);
  }, [
    picks,
    keepTool,
    onGeometryChange,
    onKeepToolGeometry,
    onWarning,
    pushOp,
  ]);

  // Escape key cancels the in-flight pick. Bind once per active
  // mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (mode === 'off') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, cancel]);

  // No-op when disabled / off / missing geometry.
  if (!geometry || !enabled || mode === 'off') return null;

  // ─── Render: pick highlights + indicator ──────────────────────────────────
  // We render a translucent overlay group with two wireframe meshes
  // (when picked) + a centroid indicator that pulses while the
  // overlay is mounted. The actual click-handling lives on the host
  // (it raycasts and calls pickAsTool / pickAsTarget via the
  // controller's exposed mode).

  const toolCenter = picks.toolGeo
    ? bboxCenter(picks.toolGeo)
    : ([0, 0, 0] as [number, number, number]);
  const targetCenter = picks.targetGeo
    ? bboxCenter(picks.targetGeo)
    : ([0, 0, 0] as [number, number, number]);
  const indicatorCenter: [number, number, number] = [
    (toolCenter[0] + targetCenter[0]) / 2,
    (toolCenter[1] + targetCenter[1]) / 2,
    (toolCenter[2] + targetCenter[2]) / 2,
  ];

  return (
    <group
      data-testid="boolean-overlay"
      data-mode={mode}
      data-stage={stage}
      data-tool-id={picks.toolId ?? ''}
      data-target-id={picks.targetId ?? ''}
    >
      {/* Tool highlight (red wireframe). */}
      {picks.toolGeo && (
        <mesh
          data-testid="boolean-overlay-tool-highlight"
          geometry={picks.toolGeo}
        >
          <meshBasicMaterial
            color={0xff5555}
            wireframe
            transparent
            opacity={0.4}
            depthTest={false}
          />
        </mesh>
      )}
      {/* Target highlight (blue wireframe). */}
      {picks.targetGeo && (
        <mesh
          data-testid="boolean-overlay-target-highlight"
          geometry={picks.targetGeo}
        >
          <meshBasicMaterial
            color={0x55a8ff}
            wireframe
            transparent
            opacity={0.4}
            depthTest={false}
          />
        </mesh>
      )}
      {/* Confirm-stage centroid indicator (translucent green). */}
      {stage === 'confirm' && (
        <mesh
          data-testid="boolean-overlay-indicator"
          position={indicatorCenter}
        >
          <sphereGeometry args={[3, 16, 12]} />
          <meshBasicMaterial
            color={0x55ff77}
            transparent
            opacity={0.55}
            depthTest={false}
          />
        </mesh>
      )}
      {/* Hidden bridge nodes — tests + the toolbar can reach in to
       *  drive the picks programmatically without raycasting. */}
      <PickBridge
        pickAsTool={pickAsTool}
        pickAsTarget={pickAsTarget}
        confirm={confirm}
        cancel={cancel}
        stage={stage}
      />
    </group>
  );
}

/** Imperative hook into the overlay for the toolbar / tests. Rendered
 *  inside the overlay so it shares the controller context but exposes
 *  callbacks via a window-level event the host can dispatch. We
 *  deliberately keep this off the React-ref path because the overlay
 *  itself returns null when disabled — refs would be brittle. */
function PickBridge({
  pickAsTool,
  pickAsTarget,
  confirm,
  cancel,
  stage,
}: {
  pickAsTool: (pick: DirectEditBodyPick) => void;
  pickAsTarget: (pick: DirectEditBodyPick) => void;
  confirm: () => void;
  cancel: () => void;
  stage: BooleanOverlayStage;
}): React.ReactElement | null {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPick = (e: Event) => {
      const detail = (e as CustomEvent<DirectEditBodyPick>).detail;
      if (!detail) return;
      if (stage === 'pick-tool') pickAsTool(detail);
      else if (stage === 'pick-target') pickAsTarget(detail);
    };
    const onConfirm = () => confirm();
    const onCancel = () => cancel();
    window.addEventListener(BOOLEAN_OVERLAY_PICK_EVENT, onPick);
    window.addEventListener(BOOLEAN_OVERLAY_CONFIRM_EVENT, onConfirm);
    window.addEventListener(BOOLEAN_OVERLAY_CANCEL_EVENT, onCancel);
    return () => {
      window.removeEventListener(BOOLEAN_OVERLAY_PICK_EVENT, onPick);
      window.removeEventListener(BOOLEAN_OVERLAY_CONFIRM_EVENT, onConfirm);
      window.removeEventListener(BOOLEAN_OVERLAY_CANCEL_EVENT, onCancel);
    };
  }, [pickAsTool, pickAsTarget, confirm, cancel, stage]);
  return null;
}

/** CustomEvent name — the host viewport dispatches this on body-click
 *  with a `DirectEditBodyPick` payload. The overlay consumes it and
 *  advances the stage. Keeps the overlay decoupled from the host's
 *  raycaster implementation. */
export const BOOLEAN_OVERLAY_PICK_EVENT = 'nfab:boolean-overlay-pick';
/** Fired by the toolbar's Confirm button. */
export const BOOLEAN_OVERLAY_CONFIRM_EVENT = 'nfab:boolean-overlay-confirm';
/** Fired by the toolbar's Cancel button. */
export const BOOLEAN_OVERLAY_CANCEL_EVENT = 'nfab:boolean-overlay-cancel';

/** Helper for hosts: dispatch a body-pick event. The overlay treats
 *  it like a viewport click. */
export function dispatchBooleanOverlayPick(pick: DirectEditBodyPick): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<DirectEditBodyPick>(BOOLEAN_OVERLAY_PICK_EVENT, {
      detail: pick,
    }),
  );
}

/** Helper for hosts / toolbar: fire confirm. */
export function dispatchBooleanOverlayConfirm(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(BOOLEAN_OVERLAY_CONFIRM_EVENT));
}

/** Helper for hosts / toolbar: fire cancel. */
export function dispatchBooleanOverlayCancel(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(BOOLEAN_OVERLAY_CANCEL_EVENT));
}

/** Re-export so the resolveBody / default-body inference path in
 *  the overlay is reusable in the toolbar's status-bar copy. */
export { resolveBodyIdFromGeometry };
