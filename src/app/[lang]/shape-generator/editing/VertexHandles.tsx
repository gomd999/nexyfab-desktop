'use client';

import { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import { useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { UniqueVertex } from './types';
import { snapVector3 } from './snap';
import { findBestEdgeSnap, type SnapCandidate } from './smartSnap';
import { GL_COLOR } from '../lib/glColors';

const MAX_HANDLES = 1000;

// Hex (not CSS vars): THREE.Color can't parse var(--…) → white → invisible
// vertex handles on the light viewport. (2026-06-12)
const COLOR_DEFAULT = new THREE.Color(GL_COLOR.neutral);
const COLOR_HOVERED = new THREE.Color('#fbbf24');
const COLOR_DRAGGING = new THREE.Color(GL_COLOR.ok);

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();
const _normal = new THREE.Vector3();

interface VertexHandlesProps {
  vertices: UniqueVertex[];
  onVertexMove: (vertexId: number, newPos: [number, number, number]) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  color?: string;
  size?: number;
  snapGrid?: number;
  /**
   * When true, while dragging a vertex we scan `smartSnapGeometry` for nearby
   * edges and snap the dragged vertex onto the closest edge within
   * `smartSnapDistMm` (default 2 mm). The grid snap is applied AFTER smart
   * snap — so if smart-snap fires it wins, otherwise grid takes over.
   */
  smartSnapEnabled?: boolean;
  smartSnapGeometry?: THREE.BufferGeometry | null;
  smartSnapDistMm?: number;
  /**
   * Fires every drag frame with the active snap target (or null when no
   * smart snap is engaged). The host can render a marker at this point.
   */
  onSmartSnapChange?: (snap: SnapCandidate | null) => void;
}

export default function VertexHandles({
  vertices,
  onVertexMove,
  onDragStart,
  onDragEnd,
  color = 'var(--nx-text)',
  size = 1.5,
  snapGrid,
  smartSnapEnabled = false,
  smartSnapGeometry = null,
  smartSnapDistMm = 2,
  onSmartSnapChange,
}: VertexHandlesProps) {
  const { camera, gl } = useThree();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const dragStartPosRef = useRef<THREE.Vector3>(new THREE.Vector3());
  const isDragging = useRef(false);

  const displayVertices = useMemo(
    () => vertices.slice(0, MAX_HANDLES),
    [vertices],
  );

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(size, 8, 6), [size]);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.7,
        roughness: 0.4,
        metalness: 0.1,
        depthTest: true,
      }),
    [color],
  );

  // Update instance matrices and colors
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    for (let i = 0; i < displayVertices.length; i++) {
      const v = displayVertices[i];
      _dummy.position.set(v.position[0], v.position[1], v.position[2]);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      if (i === draggingIdx) {
        mesh.setColorAt(i, _color.copy(COLOR_DRAGGING));
      } else if (i === hoveredIdx) {
        mesh.setColorAt(i, _color.copy(COLOR_HOVERED));
      } else {
        mesh.setColorAt(i, _color.copy(COLOR_DEFAULT));
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = displayVertices.length;
  }, [displayVertices, hoveredIdx, draggingIdx]);

  // During drag, only refresh the dragged instance (full loop was O(n) every frame → lag).
  useFrame(() => {
    if (draggingIdx === null) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    const i = draggingIdx;
    const v = displayVertices[i];
    if (!v) return;
    _dummy.position.set(v.position[0], v.position[1], v.position[2]);
    _dummy.scale.set(1, 1, 1);
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  });

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.instanceId === undefined || e.instanceId >= displayVertices.length) return;
      e.stopPropagation();

      const idx = e.instanceId;
      const vertex = displayVertices[idx];

      // Set up the drag plane perpendicular to camera direction
      camera.getWorldDirection(_normal);
      const vertexPos = new THREE.Vector3(...vertex.position);
      _plane.setFromNormalAndCoplanarPoint(_normal, vertexPos);
      dragStartPosRef.current.copy(vertexPos);

      setDraggingIdx(idx);
      isDragging.current = true;

      // Capture pointer
      (e.nativeEvent.target as HTMLElement)?.setPointerCapture?.(e.nativeEvent.pointerId);

      onDragStart();
    },
    [displayVertices, camera, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging.current || draggingIdx === null) {
        // Handle hover detection
        if (e.instanceId !== undefined && e.instanceId < displayVertices.length) {
          setHoveredIdx(e.instanceId);
        }
        return;
      }

      e.stopPropagation();

      const vertex = displayVertices[draggingIdx];
      if (!vertex) return;

      // Get normalized device coordinates from the event
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;

      _raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = _raycaster.ray.intersectPlane(_plane, _intersection);

      if (hit) {
        let posX = _intersection.x;
        let posY = _intersection.y;
        let posZ = _intersection.z;

        // Smart snap (edge-to-edge) runs BEFORE grid snap so a near edge
        // wins over the grid lattice. If no edge is within tolerance, we
        // fall through to grid snap or raw intersection.
        let smartHit: SnapCandidate | null = null;
        if (smartSnapEnabled && smartSnapGeometry) {
          smartHit = findBestEdgeSnap(
            [posX, posY, posZ],
            smartSnapGeometry,
            { maxDistMm: smartSnapDistMm },
          );
          if (smartHit) {
            posX = smartHit.point[0];
            posY = smartHit.point[1];
            posZ = smartHit.point[2];
          }
        }

        if (!smartHit && snapGrid) {
          const g = snapVector3(
            _intersection.set(posX, posY, posZ),
            snapGrid,
          );
          posX = g.x;
          posY = g.y;
          posZ = g.z;
        }

        onVertexMove(vertex.id, [posX, posY, posZ]);
        onSmartSnapChange?.(smartHit);

        if (snapGrid || smartHit) {
          window.dispatchEvent(new CustomEvent('nexyfab:snap-pos', {
            detail: { x: posX, y: posY, z: posZ, active: true },
          }));
        }
      }
    },
    [
      draggingIdx, displayVertices, camera, gl, onVertexMove, snapGrid,
      smartSnapEnabled, smartSnapGeometry, smartSnapDistMm, onSmartSnapChange,
    ],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging.current) return;
      e.stopPropagation();

      isDragging.current = false;
      setDraggingIdx(null);
      window.dispatchEvent(new CustomEvent('nexyfab:snap-pos', { detail: { active: false } }));
      onSmartSnapChange?.(null);

      (e.nativeEvent.target as HTMLElement)?.releasePointerCapture?.(e.nativeEvent.pointerId);

      onDragEnd();
    },
    [onDragEnd, onSmartSnapChange],
  );

  const handlePointerOut = useCallback(() => {
    if (!isDragging.current) {
      setHoveredIdx(null);
    }
  }, []);

  if (displayVertices.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[sphereGeo, material, MAX_HANDLES]}
      frustumCulled={false}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerOut={handlePointerOut}
    />
  );
}
