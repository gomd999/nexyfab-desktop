'use client';
import { useRef, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { FaceSelectionInfo, EdgeSelectionInfo, ElementSelectionInfo } from './selectionInfo';
import { normalToLabel } from './selectionInfo';

interface Props {
  geometry: THREE.BufferGeometry;
  onSelect: (info: ElementSelectionInfo) => void;
  onPointerDown?: (e: ThreeEvent<PointerEvent>, info: ElementSelectionInfo) => void;
  onPointerMove?: (e: ThreeEvent<PointerEvent>, info: ElementSelectionInfo) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>, info: ElementSelectionInfo) => void;
}

// Group coplanar triangles by face normal (dot > 0.98 threshold)
function groupCoplanarFaces(geo: THREE.BufferGeometry): Array<{
  normal: THREE.Vector3;
  triangleIndices: number[];
  area: number;
}> {
  const pos = geo.attributes.position;
  const groups: Array<{ normal: THREE.Vector3; triangleIndices: number[]; area: number }> = [];
  const triCount = Math.floor(pos.count / 3);

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const cross = new THREE.Vector3();
  const faceNorm = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const base = i * 3;
    vA.fromBufferAttribute(pos, base);
    vB.fromBufferAttribute(pos, base + 1);
    vC.fromBufferAttribute(pos, base + 2);

    edge1.subVectors(vB, vA);
    edge2.subVectors(vC, vA);
    cross.crossVectors(edge1, edge2);
    const area = cross.length() * 0.5;
    if (area < 1e-10) continue;

    faceNorm.copy(cross).normalize();

    // Find matching group
    let found = false;
    for (const g of groups) {
      if (g.normal.dot(faceNorm) > 0.98) {
        g.triangleIndices.push(i);
        g.area += area;
        found = true;
        break;
      }
    }
    if (!found) {
      groups.push({
        normal: faceNorm.clone(),
        triangleIndices: [i],
        area,
      });
    }
  }
  return groups;
}

export default function SelectionMesh({ geometry, onSelect, onPointerDown, onPointerMove, onPointerUp }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  // Cache coplanar groups — recompute only when geometry changes
  const groupsRef = useRef<ReturnType<typeof groupCoplanarFaces> | null>(null);
  const geoRef = useRef<THREE.BufferGeometry | null>(null);

  const getGroups = useCallback(() => {
    if (geoRef.current !== geometry) {
      geoRef.current = geometry;
      groupsRef.current = groupCoplanarFaces(geometry);
    }
    return groupsRef.current!;
  }, [geometry]);

  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (!e.face || !meshRef.current) return;

    // Convert face normal to world space
    const worldNormal = e.face.normal.clone()
      .transformDirection(meshRef.current.matrixWorld)
      .normalize();

    const n: [number, number, number] = [worldNormal.x, worldNormal.y, worldNormal.z];
    const pt: [number, number, number] = [e.point.x, e.point.y, e.point.z];

    // Find coplanar group
    const groups = getGroups();
    const clickedTriIdx = Math.floor(e.faceIndex! / 1);
    let matchedGroup = groups.find(g => g.normal.dot(worldNormal) > 0.98);
    if (!matchedGroup && groups.length > 0) {
      // Fallback: find closest normal
      let bestDot = -1;
      for (const g of groups) {
        const d = g.normal.dot(worldNormal);
        if (d > bestDot) { bestDot = d; matchedGroup = g; }
      }
    }

    const info: FaceSelectionInfo = {
      type: 'face',
      normal: n,
      position: pt,
      area: matchedGroup ? matchedGroup.area : 0,
      triangleCount: matchedGroup ? matchedGroup.triangleIndices.length : 1,
      normalLabel: normalToLabel(n, true),
      triangleIndices: matchedGroup ? matchedGroup.triangleIndices : [],
    };

    onSelect(info);
  }, [getGroups, onSelect]);

  const handlePointerEvent = useCallback((e: ThreeEvent<PointerEvent>, handler?: (e: ThreeEvent<PointerEvent>, info: FaceSelectionInfo) => void) => {
    if (!handler || !e.face || !meshRef.current) return;
    const worldNormal = e.face.normal.clone()
      .transformDirection(meshRef.current.matrixWorld)
      .normalize();
    const n: [number, number, number] = [worldNormal.x, worldNormal.y, worldNormal.z];
    const pt: [number, number, number] = [e.point.x, e.point.y, e.point.z];
    
    handler(e, {
      type: 'face',
      normal: n,
      position: pt,
      area: 0,
      triangleCount: 1,
      normalLabel: normalToLabel(n, true),
      triangleIndices: [],
    });
  }, []);

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      onClick={handleClick}
      onPointerDown={onPointerDown ? (e) => handlePointerEvent(e, onPointerDown) : undefined}
      onPointerMove={onPointerMove ? (e) => handlePointerEvent(e, onPointerMove) : undefined}
      onPointerUp={onPointerUp ? (e) => handlePointerEvent(e, onPointerUp) : undefined}
    >
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
