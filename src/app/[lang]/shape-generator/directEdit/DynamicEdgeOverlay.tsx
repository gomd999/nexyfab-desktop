'use client';

/**
 * DynamicEdgeOverlay.tsx — Wave 2 Phase 3 Track E2.
 *
 * R3F overlay companion to E1's `DirectEditOverlay`. Parallel scope:
 * E1 handles face-pick + push-pull, E2 handles edge-pick + dynamic
 * fillet/chamfer. The two overlays are mutually exclusive at any
 * given moment (the toolbar's sub-mode selector arbitrates), so the
 * host mounts both and toggles `modeActive` based on the sub-mode.
 *
 * Responsibilities:
 *   - On pointer-down: raycast → find the hit triangle → pick the
 *     triangle edge nearest to the click point → encode the canonical
 *     `edgeId` via `dynamicEdgeMath.encodeEdgeId`.
 *   - Live preview: render a translucent line along the picked edge
 *     during drag (visual handle).
 *   - On pointer-up: compute the radius/distance via
 *     `computeFilletRadiusFromDrag` / `computeChamferDistanceFromDrag`,
 *     validate via the validators, call `applyDynamicFillet` /
 *     `applyDynamicChamfer`, and commit the op via the controller's
 *     `pushOp`.
 *
 * Same flag-gating + no-op semantics as the E1 overlay: `null` when
 * `geometry` is missing, `modeActive` is false, or the controller is
 * disabled.
 */

import React, { useCallback, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import { useDirectEditController } from './DirectEditController';
import {
  computeFilletRadiusFromDrag,
  computeChamferDistanceFromDrag,
  dragSnapToGrid,
  encodeEdgeId,
  findNearestTriangleEdge,
  type Vec3,
} from './dynamicEdgeMath';
import { applyDynamicFillet } from './applyDynamicFillet';
import { applyDynamicChamfer } from './applyDynamicChamfer';
import type { DirectEditEdgePick } from './directEditTypes';

export type DynamicEdgeMode = 'dynamic-fillet' | 'dynamic-chamfer';

export interface DynamicEdgeOverlayProps {
  /** Current displayed geometry. */
  geometry: THREE.BufferGeometry | null;
  /** Active when the toolbar sub-mode matches AND the controller is
   *  enabled. The host wires this up. */
  modeActive: boolean;
  /** Which dynamic-edge mode is active. */
  mode: DynamicEdgeMode;
  /** Called when the user finishes a drag — host swaps the displayed
   *  geometry to the result. */
  onGeometryChange?: (next: THREE.BufferGeometry) => void;
  /** Grid snap size in mm when shift is held during drag.
   *  Defaults to 0.1mm. Set to 0 to disable. */
  gridSnapMm?: number;
}

/** Preview-only translucent indicator along the picked edge. We use
 *  a thin oriented box (mesh) rather than `<line>` because R3F's
 *  intrinsic `<line>` collides with the DOM `SVGLineElement` in
 *  TypeScript's JSX type lookup; a mesh sidesteps the collision and
 *  also renders with consistent thickness across GPU drivers (lines
 *  are 1px on most WebGL2 implementations). */
function EdgePreviewHighlight({
  start,
  end,
}: {
  start: Vec3;
  end: Vec3;
}): React.ReactElement | null {
  const { position, quaternion, length } = useMemo(() => {
    const sx = start[0], sy = start[1], sz = start[2];
    const ex = end[0], ey = end[1], ez = end[2];
    const dx = ex - sx, dy = ey - sy, dz = ez - sz;
    const len = Math.hypot(dx, dy, dz);
    const mid = new THREE.Vector3((sx + ex) / 2, (sy + ey) / 2, (sz + ez) / 2);
    if (len < 1e-9) {
      return { position: mid, quaternion: new THREE.Quaternion(), length: 0 };
    }
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    // Default <boxGeometry> long axis is +Y (we set args=[w,len,d]).
    // Rotate from +Y to the edge direction.
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), dir,
    );
    return { position: mid, quaternion: q, length: len };
  }, [start, end]);
  if (length === 0) return null;
  // Box thickness: scale-aware ratio of edge length, clamped to a
  // pixel-visible minimum. 1% of edge length is roughly 1 line width
  // at typical viewing distance.
  const thickness = Math.max(length * 0.015, 0.2);
  return (
    <mesh
      position={position}
      quaternion={quaternion}
      userData={{ directEditEdgePreview: true }}
    >
      <boxGeometry args={[thickness, length, thickness]} />
      <meshBasicMaterial
        color="#fbbf24"
        transparent
        opacity={0.85}
        depthTest={false}
      />
    </mesh>
  );
}

/** Read the three world-space vertices of a hit triangle. */
function readTriangleVertices(
  geometry: THREE.BufferGeometry,
  triIdx: number,
): { v0: Vec3; v1: Vec3; v2: Vec3 } | null {
  const posAttr = geometry.getAttribute('position') as
    | THREE.BufferAttribute
    | undefined;
  if (!posAttr) return null;
  const indexAttr = geometry.index;
  const i0 = indexAttr ? indexAttr.getX(triIdx * 3) : triIdx * 3;
  const i1 = indexAttr ? indexAttr.getX(triIdx * 3 + 1) : triIdx * 3 + 1;
  const i2 = indexAttr ? indexAttr.getX(triIdx * 3 + 2) : triIdx * 3 + 2;
  return {
    v0: [posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0)],
    v1: [posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1)],
    v2: [posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2)],
  };
}

export function DynamicEdgeOverlay({
  geometry,
  modeActive,
  mode,
  onGeometryChange,
  gridSnapMm = 0.1,
}: DynamicEdgeOverlayProps): React.ReactElement | null {
  const { pushOp, enabled } = useDirectEditController();

  const [pick, setPick] = useState<DirectEditEdgePick | null>(null);
  const [dragOrigin, setDragOrigin] = useState<THREE.Vector3 | null>(null);

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!geometry || !enabled || !modeActive) return;
    const triIdx = e.faceIndex ?? e.face?.a;
    if (triIdx === undefined || triIdx === null) return;
    const tri = readTriangleVertices(geometry, triIdx);
    if (!tri) return;
    const click: Vec3 = [e.point.x, e.point.y, e.point.z];
    const nearest = findNearestTriangleEdge(tri.v0, tri.v1, tri.v2, click);
    if (!nearest) return;
    setPick({
      edgeId: encodeEdgeId(nearest.start, nearest.end),
      edgeStart: [nearest.start[0], nearest.start[1], nearest.start[2]],
      edgeEnd: [nearest.end[0], nearest.end[1], nearest.end[2]],
      edgePoint: [click[0], click[1], click[2]],
    });
    setDragOrigin(e.point.clone());
    e.stopPropagation();
  }, [geometry, enabled, modeActive]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!geometry || !pick || !dragOrigin) {
      setPick(null);
      setDragOrigin(null);
      return;
    }
    const dragDelta: Vec3 = [
      e.point.x - dragOrigin.x,
      e.point.y - dragOrigin.y,
      e.point.z - dragOrigin.z,
    ];
    const shiftHeld =
      ('shiftKey' in e && (e as unknown as { shiftKey?: boolean }).shiftKey)
      || (e.nativeEvent && (e.nativeEvent as PointerEvent).shiftKey);

    if (mode === 'dynamic-fillet') {
      let radius = computeFilletRadiusFromDrag(
        pick.edgeStart, pick.edgeEnd, dragDelta,
      );
      if (shiftHeld && gridSnapMm > 0) {
        radius = dragSnapToGrid(radius, gridSnapMm);
      }
      if (radius > 0 && Number.isFinite(radius)) {
        const op = {
          kind: 'dynamicFillet' as const,
          edgeId: pick.edgeId,
          radiusMm: radius,
          createdAt: Date.now(),
        };
        const result = applyDynamicFillet(geometry, op);
        if (result.applied) {
          pushOp(op);
          if (onGeometryChange) onGeometryChange(result.geometry);
        }
      }
    } else {
      let distance = computeChamferDistanceFromDrag(
        pick.edgeStart, pick.edgeEnd, dragDelta,
      );
      if (shiftHeld && gridSnapMm > 0) {
        distance = dragSnapToGrid(distance, gridSnapMm);
      }
      if (distance > 0 && Number.isFinite(distance)) {
        const op = {
          kind: 'dynamicChamfer' as const,
          edgeId: pick.edgeId,
          distanceMm: distance,
          createdAt: Date.now(),
        };
        const result = applyDynamicChamfer(geometry, op);
        if (result.applied) {
          pushOp(op);
          if (onGeometryChange) onGeometryChange(result.geometry);
        }
      }
    }

    setPick(null);
    setDragOrigin(null);
  }, [geometry, pick, dragOrigin, mode, gridSnapMm, pushOp, onGeometryChange]);

  if (!geometry || !enabled || !modeActive) return null;

  return (
    <group
      data-testid="dynamic-edge-overlay"
      data-mode={mode}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <mesh geometry={geometry} visible={false} userData={{ directEditEdgePicker: true }}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {pick && (
        <EdgePreviewHighlight start={pick.edgeStart} end={pick.edgeEnd} />
      )}
    </group>
  );
}
