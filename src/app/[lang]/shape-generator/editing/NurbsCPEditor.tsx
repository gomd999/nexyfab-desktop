'use client';

import { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import { useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { cpKey, buildCpGrid } from '../features/nurbsSurface';

const COLOR_DEFAULT = new THREE.Color('#f472b6');
const COLOR_HOVERED = new THREE.Color('#fbbf24');
const COLOR_DRAGGING = new THREE.Color('#22c55e');

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();
const _plane = new THREE.Plane();
const _raycaster = new THREE.Raycaster();
const _intersection = new THREE.Vector3();
const _normal = new THREE.Vector3();

interface NurbsCPEditorProps {
  params: Record<string, number>;
  onParamChange: (key: string, value: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

export default function NurbsCPEditor({
  params,
  onParamChange,
  onDragStart,
  onDragEnd,
}: NurbsCPEditorProps) {
  const { camera, gl } = useThree();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  const isDragging = useRef(false);

  const uCount = Math.max(2, Math.round(params.uCount ?? 5));
  const vCount = Math.max(2, Math.round(params.vCount ?? 5));

  // Flat list of [i, j, position] from the CP grid
  const cpFlat = useMemo<Array<{ i: number; j: number; pos: [number, number, number] }>>(() => {
    const grid = buildCpGrid(params, uCount, vCount);
    const out: Array<{ i: number; j: number; pos: [number, number, number] }> = [];
    for (let i = 0; i < uCount; i++)
      for (let j = 0; j < vCount; j++)
        out.push({ i, j, pos: grid[i][j] });
    return out;
   
  }, [params, uCount, vCount]);

  // Cage line geometry (u-lines + v-lines)
  const cageGeo = useMemo(() => {
    const positions: number[] = [];
    const grid = buildCpGrid(params, uCount, vCount);
    for (let i = 0; i < uCount; i++)
      for (let j = 0; j < vCount - 1; j++) {
        const a = grid[i][j], b = grid[i][j + 1];
        positions.push(...a, ...b);
      }
    for (let j = 0; j < vCount; j++)
      for (let i = 0; i < uCount - 1; i++) {
        const a = grid[i][j], b = grid[i + 1][j];
        positions.push(...a, ...b);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return g;
   
  }, [params, uCount, vCount]);

  const sphereGeo = useMemo(() => new THREE.SphereGeometry(2.5, 8, 6), []);
  const material = useMemo(
    () => new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.85, roughness: 0.3, metalness: 0.1, depthTest: true }),
    [],
  );

  // Update instance matrices + colors
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let idx = 0; idx < cpFlat.length; idx++) {
      const { pos } = cpFlat[idx];
      _dummy.position.set(pos[0], pos[1], pos[2]);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(idx, _dummy.matrix);
      if (idx === draggingIdx) mesh.setColorAt(idx, _color.copy(COLOR_DRAGGING));
      else if (idx === hoveredIdx) mesh.setColorAt(idx, _color.copy(COLOR_HOVERED));
      else mesh.setColorAt(idx, _color.copy(COLOR_DEFAULT));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = cpFlat.length;
  }, [cpFlat, hoveredIdx, draggingIdx]);

  useFrame(() => {
    if (draggingIdx === null) return;
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let idx = 0; idx < cpFlat.length; idx++) {
      const { pos } = cpFlat[idx];
      _dummy.position.set(pos[0], pos[1], pos[2]);
      _dummy.updateMatrix();
      mesh.setMatrixAt(idx, _dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (e.instanceId === undefined || e.instanceId >= cpFlat.length) return;
      e.stopPropagation();
      const { pos } = cpFlat[e.instanceId];
      camera.getWorldDirection(_normal);
      _plane.setFromNormalAndCoplanarPoint(_normal, new THREE.Vector3(...pos));
      setDraggingIdx(e.instanceId);
      isDragging.current = true;
      (e.nativeEvent.target as HTMLElement)?.setPointerCapture?.(e.nativeEvent.pointerId);
      onDragStart();
    },
    [cpFlat, camera, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging.current || draggingIdx === null) {
        if (e.instanceId !== undefined && e.instanceId < cpFlat.length) setHoveredIdx(e.instanceId);
        return;
      }
      e.stopPropagation();
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      if (_raycaster.ray.intersectPlane(_plane, _intersection)) {
        const { i, j } = cpFlat[draggingIdx];
        onParamChange(cpKey(i, j, 0), _intersection.x);
        onParamChange(cpKey(i, j, 1), _intersection.y);
        onParamChange(cpKey(i, j, 2), _intersection.z);
      }
    },
    [draggingIdx, cpFlat, camera, gl, onParamChange],
  );

  const handlePointerUp = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!isDragging.current) return;
      e.stopPropagation();
      isDragging.current = false;
      setDraggingIdx(null);
      (e.nativeEvent.target as HTMLElement)?.releasePointerCapture?.(e.nativeEvent.pointerId);
      onDragEnd();
    },
    [onDragEnd],
  );

  if (cpFlat.length === 0) return null;

  return (
    <group>
      {/* Cage wireframe */}
      <lineSegments ref={linesRef} geometry={cageGeo} frustumCulled={false}>
        <lineBasicMaterial color="#f472b6" opacity={0.4} transparent />
      </lineSegments>

      {/* Draggable CP spheres */}
      <instancedMesh
        ref={meshRef}
        args={[sphereGeo, material, cpFlat.length]}
        frustumCulled={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOut={() => { if (!isDragging.current) setHoveredIdx(null); }}
      />
    </group>
  );
}
