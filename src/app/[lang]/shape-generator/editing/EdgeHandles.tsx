'use client';

import { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import { useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { UniqueVertex, UniqueEdge } from './types';
import { snapToGrid } from './snap';

const MAX_EDGES = 500;
const HANDLE_SIZE = 2;

const COLOR_DEFAULT_EDGE    = new THREE.Color('#9ca3af');
const COLOR_HOVERED_EDGE    = new THREE.Color('#22d3ee');
const COLOR_SELECTED_EDGE   = new THREE.Color('#f59e0b');
const COLOR_DEFAULT_HANDLE  = new THREE.Color('#9ca3af');
const COLOR_HOVERED_HANDLE  = new THREE.Color('#22d3ee');
const COLOR_DRAGGING_HANDLE = new THREE.Color('#22c55e');
const COLOR_SELECTED_HANDLE = new THREE.Color('#f59e0b');

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _prevIntersection = new THREE.Vector3();

interface EdgeHandlesProps {
  edges: UniqueEdge[];
  vertices: UniqueVertex[];
  onEdgeMove: (edgeId: number, delta: [number, number, number]) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  snapGrid?: number;
  /** IDs of currently selected edges (for highlight) */
  selectedEdgeIds?: Set<number>;
  /** Called when user clicks (not drags) an edge handle */
  onEdgeSelect?: (edge: UniqueEdge, additive: boolean) => void;
}

/** Renders edge lines with draggable midpoint box handles and click-to-select. */
export default function EdgeHandles({
  edges,
  vertices,
  onEdgeMove,
  onDragStart,
  onDragEnd,
  snapGrid,
  selectedEdgeIds,
  onEdgeSelect,
}: EdgeHandlesProps) {
  const { camera, gl } = useThree();
  const handleMeshRef = useRef<THREE.InstancedMesh>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const isDragging = useRef(false);
  const lastIntersectionRef = useRef(new THREE.Vector3());
  // Track pointer-down screen position to distinguish click from drag
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const pointerDownIdx = useRef<number | null>(null);

  const displayEdges = useMemo(() => edges.slice(0, MAX_EDGES), [edges]);

  // Build a vertex lookup map
  const vertexMap = useMemo(() => {
    const m = new Map<number, UniqueVertex>();
    for (const v of vertices) m.set(v.id, v);
    return m;
  }, [vertices]);

  // -- Edge lines geometry (rebuilt each render) --
  const lineGeometry = useMemo(() => {
    const positions: number[] = [];
    const colors: number[] = [];

    for (let i = 0; i < displayEdges.length; i++) {
      const edge = displayEdges[i];
      const vA = vertexMap.get(edge.vertexA);
      const vB = vertexMap.get(edge.vertexB);
      if (!vA || !vB) continue;

      const isSelected = selectedEdgeIds?.has(edge.id);
      const isHovered  = i === hoveredIdx || i === draggingIdx;
      const c = isSelected ? COLOR_SELECTED_EDGE : isHovered ? COLOR_HOVERED_EDGE : COLOR_DEFAULT_EDGE;

      positions.push(vA.position[0], vA.position[1], vA.position[2]);
      positions.push(vB.position[0], vB.position[1], vB.position[2]);
      colors.push(c.r, c.g, c.b);
      colors.push(c.r, c.g, c.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    return geo;
  }, [displayEdges, vertexMap, hoveredIdx, draggingIdx, selectedEdgeIds]);

  // -- Midpoint handle box geometry --
  const boxGeo = useMemo(() => new THREE.BoxGeometry(HANDLE_SIZE, HANDLE_SIZE, HANDLE_SIZE), []);
  const handleMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9ca3af',
        transparent: true,
        opacity: 0.8,
        roughness: 0.4,
        metalness: 0.1,
      }),
    [],
  );

  // Update instance matrices + colors for midpoint handles
  useEffect(() => {
    const mesh = handleMeshRef.current;
    if (!mesh) return;

    for (let i = 0; i < displayEdges.length; i++) {
      const edge = displayEdges[i];
      const vA = vertexMap.get(edge.vertexA);
      const vB = vertexMap.get(edge.vertexB);
      if (!vA || !vB) continue;

      const mx = (vA.position[0] + vB.position[0]) / 2;
      const my = (vA.position[1] + vB.position[1]) / 2;
      const mz = (vA.position[2] + vB.position[2]) / 2;

      _dummy.position.set(mx, my, mz);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);

      const isSelected = selectedEdgeIds?.has(edge.id);
      if (i === draggingIdx) {
        mesh.setColorAt(i, _color.copy(COLOR_DRAGGING_HANDLE));
      } else if (isSelected) {
        mesh.setColorAt(i, _color.copy(COLOR_SELECTED_HANDLE));
      } else if (i === hoveredIdx) {
        mesh.setColorAt(i, _color.copy(COLOR_HOVERED_HANDLE));
      } else {
        mesh.setColorAt(i, _color.copy(COLOR_DEFAULT_HANDLE));
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = displayEdges.length;
  }, [displayEdges, vertexMap, hoveredIdx, draggingIdx, selectedEdgeIds]);

  // Live update during drag
  useFrame(() => {
    if (draggingIdx === null) return;
    const mesh = handleMeshRef.current;
    if (!mesh) return;

    for (let i = 0; i < displayEdges.length; i++) {
      const edge = displayEdges[i];
      const vA = vertexMap.get(edge.vertexA);
      const vB = vertexMap.get(edge.vertexB);
      if (!vA || !vB) continue;

      _dummy.position.set(
        (vA.position[0] + vB.position[0]) / 2,
        (vA.position[1] + vB.position[1]) / 2,
        (vA.position[2] + vB.position[2]) / 2,
      );
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.instanceId === undefined || e.instanceId >= displayEdges.length) return;
      e.stopPropagation();

      const idx = e.instanceId;
      const edge = displayEdges[idx];
      const vA = vertexMap.get(edge.vertexA);
      const vB = vertexMap.get(edge.vertexB);
      if (!vA || !vB) return;

      // Record down position for click detection
      pointerDownPos.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
      pointerDownIdx.current = idx;

      const midpoint = new THREE.Vector3(
        (vA.position[0] + vB.position[0]) / 2,
        (vA.position[1] + vB.position[1]) / 2,
        (vA.position[2] + vB.position[2]) / 2,
      );

      camera.getWorldDirection(_normal);
      _plane.setFromNormalAndCoplanarPoint(_normal, midpoint);

      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = _raycaster.ray.intersectPlane(_plane, _prevIntersection);
      if (hit) {
        lastIntersectionRef.current.copy(_prevIntersection);
      }

      setDraggingIdx(idx);
      isDragging.current = true;

      (e.nativeEvent.target as HTMLElement)?.setPointerCapture?.(e.nativeEvent.pointerId);
      onDragStart();
    },
    [displayEdges, vertexMap, camera, gl, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging.current || draggingIdx === null) {
        if (e.instanceId !== undefined && e.instanceId < displayEdges.length) {
          setHoveredIdx(e.instanceId);
        }
        return;
      }

      e.stopPropagation();

      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;

      _raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = _raycaster.ray.intersectPlane(_plane, _intersection);

      if (hit) {
        const delta: [number, number, number] = [
          _intersection.x - lastIntersectionRef.current.x,
          _intersection.y - lastIntersectionRef.current.y,
          _intersection.z - lastIntersectionRef.current.z,
        ];

        if (snapGrid) {
          delta[0] = snapToGrid(delta[0], snapGrid);
          delta[1] = snapToGrid(delta[1], snapGrid);
          delta[2] = snapToGrid(delta[2], snapGrid);
        }

        lastIntersectionRef.current.copy(_intersection);

        const edge = displayEdges[draggingIdx];
        if (edge) {
          onEdgeMove(edge.id, delta);
        }
      }
    },
    [draggingIdx, displayEdges, camera, gl, onEdgeMove, snapGrid],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging.current) return;
      e.stopPropagation();

      // Detect click: total pointer travel < 5px
      const down = pointerDownPos.current;
      const isClick = down !== null
        && Math.abs(e.nativeEvent.clientX - down.x) < 5
        && Math.abs(e.nativeEvent.clientY - down.y) < 5;

      if (isClick && pointerDownIdx.current !== null && onEdgeSelect) {
        const edge = displayEdges[pointerDownIdx.current];
        if (edge) {
          const additive = e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
          onEdgeSelect(edge, additive);
        }
      }

      isDragging.current = false;
      pointerDownPos.current = null;
      pointerDownIdx.current = null;
      setDraggingIdx(null);

      (e.nativeEvent.target as HTMLElement)?.releasePointerCapture?.(e.nativeEvent.pointerId);
      onDragEnd();
    },
    [onDragEnd, displayEdges, onEdgeSelect],
  );

  const handlePointerOut = useCallback(() => {
    if (!isDragging.current) {
      setHoveredIdx(null);
    }
  }, []);

  if (displayEdges.length === 0) return null;

  return (
    <group>
      {/* Edge lines */}
      <lineSegments geometry={lineGeometry}>
        <lineBasicMaterial vertexColors toneMapped={false} />
      </lineSegments>

      {/* Midpoint drag handles */}
      <instancedMesh
        ref={handleMeshRef}
        args={[boxGeo, handleMat, MAX_EDGES]}
        frustumCulled={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOut={handlePointerOut}
      />
    </group>
  );
}
