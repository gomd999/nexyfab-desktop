'use client';

/**
 * DirectEditOverlay.tsx — Wave 2 Phase 3 Track E1.
 *
 * R3F overlay component mounted inside the <Canvas> in ShapePreview.
 * Self-no-ops when the direct-edit controller is disabled OR
 * `modeActive` is false — single touchpoint in viewport, matches the
 * Z3 "minimal host churn" idiom.
 *
 * Responsibilities:
 *   - Listen for pointer-down on the underlying mesh; raycast to find
 *     the picked face.
 *   - On pointer-up: read the cumulative drag delta, project onto the
 *     face normal via `computePushPullOffset`, validate via
 *     `validatePushPullOffset`, then call `applyPushPull` and forward
 *     the resulting geometry + the op via `onGeometryChange` + the
 *     controller's `pushOp`.
 *   - Visualise the preview (translucent triangle highlight) while
 *     dragging.
 *
 * E1 ships the foundation; the visual drag handle (arrow) is reused
 * from the existing `PushPullArrow` slot in W4 polish.
 */

import React, { useCallback, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import {
  useDirectEditController,
} from './DirectEditController';
import {
  computePushPullOffset,
  validatePushPullOffset,
  computeFaceBboxExtent,
  dragSnapToGrid,
} from './pushPullMath';
import { applyPushPull } from './applyPushPull';
import { getFaceFeatureId } from '../features/faceProvenance';
import type { DirectEditFacePick } from './directEditTypes';

export interface DirectEditOverlayProps {
  /** Current displayed geometry. The overlay reads positions + face
   *  provenance from this attribute set. */
  geometry: THREE.BufferGeometry | null;
  /** Active when the toolbar mode button is ON AND the controller is
   *  enabled (flag-gated). When false, the overlay renders nothing. */
  modeActive: boolean;
  /** Called when the user finishes a drag — host swaps the displayed
   *  geometry to the result. The host is responsible for replacing
   *  the input geometry on its own state. */
  onGeometryChange?: (next: THREE.BufferGeometry) => void;
  /** Grid snap size in mm when shift is held during drag.
   *  Defaults to 0.1mm. Set to 0 to disable snap. */
  gridSnapMm?: number;
}

/** Preview-only highlight for the picked face. Mirrors
 *  FaceHighlightMesh but stays inside the directEdit/ namespace so we
 *  don't couple to that component's API. */
function FacePreviewHighlight({
  geometry,
  triangleIndices,
}: {
  geometry: THREE.BufferGeometry;
  triangleIndices: number[];
}): React.ReactElement | null {
  const previewGeo = useMemo(() => {
    if (triangleIndices.length === 0) return null;
    const srcPos = geometry.attributes.position;
    const positions = new Float32Array(triangleIndices.length * 9);
    const indexAttr = geometry.index;
    let out = 0;
    for (const ti of triangleIndices) {
      for (let v = 0; v < 3; v++) {
        const srcIdx = indexAttr ? indexAttr.getX(ti * 3 + v) : (ti * 3 + v);
        positions[out++] = srcPos.getX(srcIdx);
        positions[out++] = srcPos.getY(srcIdx);
        positions[out++] = srcPos.getZ(srcIdx);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    return geo;
  }, [geometry, triangleIndices]);

  if (!previewGeo) return null;
  return (
    <mesh geometry={previewGeo} userData={{ directEditPreview: true }}>
      <meshBasicMaterial
        color="#fbbf24"
        transparent
        opacity={0.45}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function DirectEditOverlay({
  geometry,
  modeActive,
  onGeometryChange,
  gridSnapMm = 0.1,
}: DirectEditOverlayProps): React.ReactElement | null {
  const { pushOp, enabled } = useDirectEditController();

  const [pick, setPick] = useState<DirectEditFacePick | null>(null);
  const [previewTriangles, setPreviewTriangles] = useState<number[]>([]);
  const [dragOrigin, setDragOrigin] = useState<THREE.Vector3 | null>(null);

  const collectFaceTriangles = useCallback(
    (geom: THREE.BufferGeometry, faceId: string): number[] => {
      const triCount = geom.index
        ? geom.index.count / 3
        : (geom.attributes.position?.count ?? 0) / 3;
      const out: number[] = [];
      for (let t = 0; t < triCount; t++) {
        if (getFaceFeatureId(geom, t) === faceId) out.push(t);
      }
      return out;
    },
    [],
  );

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!geometry || !enabled || !modeActive) return;
    // The triangle index of the hit; r3f stores it on event.faceIndex
    // when the raycaster hit a face. Fall back to event.face for
    // older drei versions.
    const triIdx = e.faceIndex ?? e.face?.a;
    if (triIdx === undefined || triIdx === null) return;
    const faceId = getFaceFeatureId(geometry, triIdx);
    if (!faceId) return;
    const normal = e.face?.normal;
    if (!normal) return;
    setPick({
      faceId,
      faceNormal: [normal.x, normal.y, normal.z],
      facePoint: [e.point.x, e.point.y, e.point.z],
    });
    setPreviewTriangles(collectFaceTriangles(geometry, faceId));
    setDragOrigin(e.point.clone());
    e.stopPropagation();
  }, [geometry, enabled, modeActive, collectFaceTriangles]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!geometry || !pick || !dragOrigin) {
      setPick(null);
      setPreviewTriangles([]);
      setDragOrigin(null);
      return;
    }
    const dx = e.point.x - dragOrigin.x;
    const dy = e.point.y - dragOrigin.y;
    const dz = e.point.z - dragOrigin.z;
    let offset = computePushPullOffset(pick.faceNormal, [dx, dy, dz]);
    // Shift snaps to grid. PointerEvent has shiftKey on the native
    // event; r3f forwards it on `.shiftKey` of the ThreeEvent.
    const shiftHeld =
      ('shiftKey' in e && (e as unknown as { shiftKey?: boolean }).shiftKey)
      || (e.nativeEvent && (e.nativeEvent as PointerEvent).shiftKey);
    if (shiftHeld && gridSnapMm > 0) {
      offset = dragSnapToGrid(offset, gridSnapMm);
    }

    if (offset !== 0 && Number.isFinite(offset)) {
      // Validate offset bounds before mutating the mesh.
      const bbox = new THREE.Box3().setFromBufferAttribute(
        geometry.attributes.position as THREE.BufferAttribute,
      );
      const bboxExtent: [number, number, number] = [
        bbox.max.x - bbox.min.x,
        bbox.max.y - bbox.min.y,
        bbox.max.z - bbox.min.z,
      ];
      const faceVerts: number[] = [];
      const seen = new Set<number>();
      const idxAttr = geometry.index;
      for (const t of previewTriangles) {
        for (let v = 0; v < 3; v++) {
          const srcIdx = idxAttr ? idxAttr.getX(t * 3 + v) : (t * 3 + v);
          if (!seen.has(srcIdx)) {
            seen.add(srcIdx);
            faceVerts.push(srcIdx);
          }
        }
      }
      const faceBboxExtent = computeFaceBboxExtent(
        geometry.attributes.position.array as Float32Array,
        faceVerts,
        pick.faceNormal,
      );
      const validation = validatePushPullOffset(offset, {
        geometryBboxExtent: bboxExtent,
        faceBboxExtent,
      });
      if (validation.ok) {
        const op = {
          kind: 'pushPull' as const,
          faceId: pick.faceId,
          offsetMm: offset,
          createdAt: Date.now(),
        };
        const result = applyPushPull(geometry, op);
        if (result.applied) {
          pushOp(op);
          if (onGeometryChange) onGeometryChange(result.geometry);
        }
      } else {
        console.warn(
          `[directEdit] push-pull refused: ${validation.reason} (offset=${offset.toFixed(3)}mm)`,
        );
      }
    }

    setPick(null);
    setPreviewTriangles([]);
    setDragOrigin(null);
  }, [geometry, pick, dragOrigin, previewTriangles, gridSnapMm, pushOp, onGeometryChange]);

  // No-op when disabled — zero-cost for users not on the flag.
  if (!geometry || !enabled || !modeActive) return null;

  return (
    <group
      data-testid="direct-edit-overlay"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {/* Invisible pick mesh that mirrors the displayed geometry so
       *  the raycaster has something to hit at the face triangles.
       *  We render this *before* the highlight so the highlight
       *  occludes correctly. */}
      <mesh geometry={geometry} visible={false} userData={{ directEditPicker: true }}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {previewTriangles.length > 0 && (
        <FacePreviewHighlight
          geometry={geometry}
          triangleIndices={previewTriangles}
        />
      )}
    </group>
  );
}
