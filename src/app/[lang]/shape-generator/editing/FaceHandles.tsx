'use client';

import { useRef, useMemo, useCallback, useState, useEffect } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { GL_COLOR } from '../lib/glColors';
import type { UniqueFace } from './useFaceEditing';
import { useLang } from '../hooks/useLang';
import { loc } from '@/lib/i18n/loc';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const Y_AXIS = new THREE.Vector3(0, 1, 0);

const COLOR_HOVERED = '#fbbf24';
const COLOR_SELECTED = GL_COLOR.accent;
const COLOR_ARROW = GL_COLOR.ok;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FaceHandlesProps {
  geometry: THREE.BufferGeometry;
  faces: UniqueFace[];
  selectedFaceId: number | null;
  /** Multi-selection set — faces to render as selected in addition to the primary one. */
  selectedFaceIds?: ReadonlySet<number>;
  hoveredFaceId: number | null;
  onFaceHover: (id: number | null) => void;
  /** Called on click. `additive` is true when shift/ctrl is held. */
  onFaceSelect: (id: number | null, additive?: boolean) => void;
  onPushPull: (faceId: number, delta: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onFaceSketch?: (faceId: number) => void;
}

// ---------------------------------------------------------------------------
// Helper: build a BufferGeometry for a single face
// ---------------------------------------------------------------------------

function buildFaceGeometry(
  source: THREE.BufferGeometry,
  face: UniqueFace,
): THREE.BufferGeometry {
  const sourcePosAttr = source.attributes.position;
  const vertexCount = face.triangleIndices.length * 3; // 3 verts per triangle
  const positions = new Float32Array(vertexCount * 3);

  let write = 0;
  for (const ti of face.triangleIndices) {
    for (let k = 0; k < 3; k++) {
      const srcIdx = ti * 3 + k;
      positions[write++] = sourcePosAttr.getX(srcIdx);
      positions[write++] = sourcePosAttr.getY(srcIdx);
      positions[write++] = sourcePosAttr.getZ(srcIdx);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// FaceMesh — renders one invisible click-target + optional highlight overlay
// ---------------------------------------------------------------------------

interface FaceMeshProps {
  faceGeo: THREE.BufferGeometry;
  faceId: number;
  isHovered: boolean;
  isSelected: boolean;
  onFaceHover: (id: number | null) => void;
  onFaceSelect: (id: number | null, additive?: boolean) => void;
  onFaceSketch?: (faceId: number) => void;
}

function FaceMesh({
  faceGeo,
  faceId,
  isHovered,
  isSelected,
  onFaceHover,
  onFaceSelect,
  onFaceSketch,
}: FaceMeshProps) {
  const lang = useLang();
  const handlePointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onFaceHover(faceId);
    },
    [faceId, onFaceHover],
  );

  const handlePointerOut = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      onFaceHover(null);
    },
    [onFaceHover],
  );

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      const additive = e.nativeEvent.shiftKey || e.nativeEvent.ctrlKey || e.nativeEvent.metaKey;
      onFaceSelect(faceId, additive);
    },
    [faceId, onFaceSelect],
  );

  const handleDoubleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation();
      onFaceSketch?.(faceId);
    },
    [faceId, onFaceSketch],
  );

  return (
    <group>
      {/* Invisible click / hover target */}
      <mesh
        geometry={faceGeo}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        renderOrder={1}
      >
        <meshBasicMaterial
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Hovered highlight */}
      {isHovered && !isSelected && (
        <mesh geometry={faceGeo} renderOrder={2}>
          <meshBasicMaterial
            color={COLOR_HOVERED}
            transparent
            opacity={0.3}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Sketch tooltip on hover */}
      {isHovered && onFaceSketch && (
        <Html center style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div style={{ background: 'rgba(56,139,253,0.85)', color: 'var(--nx-text)', fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap' }}>
            {loc(lang, { ko: '더블클릭: 이 면에 스케치', en: 'Double-click: sketch on this face', ja: 'ダブルクリック：この面にスケッチ', zh: '双击：在此面上绘制草图', es: 'Doble clic: boceto en esta cara', ar: 'نقر مزدوج: ارسم على هذا السطح' })}
          </div>
        </Html>
      )}

      {/* Selected highlight */}
      {isSelected && (
        <mesh geometry={faceGeo} renderOrder={2}>
          <meshBasicMaterial
            color={COLOR_SELECTED}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// PushPullArrow — drag handle for the selected face
// ---------------------------------------------------------------------------

interface PushPullArrowProps {
  face: UniqueFace;
  faceId: number;
  onPushPull: (faceId: number, delta: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

function PushPullArrow({
  face,
  faceId,
  onPushPull,
  onDragStart,
  onDragEnd,
}: PushPullArrowProps) {
  const { camera, gl } = useThree();

  const isDragging = useRef(false);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const [dragDist, setDragDist] = useState(0);
  const dragPlane = useRef(new THREE.Plane());
  const lastDist = useRef(0);
  const _raycaster = useRef(new THREE.Raycaster());
  const _hit = useRef(new THREE.Vector3());

  // Quaternion to orient the arrow along the face normal
  const quaternion = useMemo(() => {
    const n = new THREE.Vector3(...face.normal).normalize();
    const q = new THREE.Quaternion();
    if (Math.abs(n.dot(Y_AXIS)) > 0.9999) {
      // Parallel or anti-parallel to Y — use identity or 180° rotation
      if (n.y < 0) {
        q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
      }
    } else {
      q.setFromUnitVectors(Y_AXIS, n);
    }
    return q;
  }, [face.normal]);

  // Latest face in a ref so the window-level drag handlers (registered once at
  // pointer-down) always read the current normal/center.
  const faceRef = useRef(face);
  faceRef.current = face;

  // Drag tracking lives on WINDOW listeners, not the mesh's onPointerMove. R3F
  // only fires a mesh's onPointerMove while the ray actually hits that mesh, so
  // dragging off the small cone tip used to stop the drag dead (the "gizmo
  // doesn't move" bug). Native window pointer events track the drag everywhere.
  const onMove = useCallback(
    (ev: PointerEvent) => {
      if (!isDragging.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      const ndcX = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
      const hit = _raycaster.current.ray.intersectPlane(dragPlane.current, _hit.current);
      if (!hit) return;
      const n = new THREE.Vector3(...faceRef.current.normal).normalize();
      const currentDist = n.dot(_hit.current);
      const delta = currentDist - lastDist.current;
      lastDist.current = currentDist;
      setDragDist((prev) => prev + delta);
      onPushPull(faceId, delta);
    },
    [camera, gl, faceId, onPushPull],
  );

  const endDrag = useCallback(() => {
    if (!isDragging.current) return;
    isDragging.current = false;
    setIsDraggingState(false);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', endDrag);
    onDragEnd();
  }, [onMove, onDragEnd]);

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      isDragging.current = true;

      const n = new THREE.Vector3(...face.normal).normalize();
      const center = new THREE.Vector3(...face.center);
      dragPlane.current.setFromNormalAndCoplanarPoint(n, center);
      lastDist.current = n.dot(center);

      setIsDraggingState(true);
      setDragDist(0);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', endDrag);
      onDragStart();
    },
    [face.normal, face.center, onMove, endDrag, onDragStart],
  );

  // Safety: drop listeners if the arrow unmounts mid-drag.
  useEffect(() => () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onMove, endDrag]);

  const [cx, cy, cz] = face.center;

  // Shaft geometry: cylinder, radius 1.5, height 20
  const shaftGeo = useMemo(
    () => new THREE.CylinderGeometry(1.5, 1.5, 20, 12),
    [],
  );

  // Cone tip geometry: radius 3.5, height 7, placed at top of shaft (y offset = 10 + 3.5)
  const coneGeo = useMemo(
    () => new THREE.ConeGeometry(3.5, 7, 12),
    [],
  );

  return (
    <group
      position={[cx, cy, cz]}
      quaternion={quaternion}
      renderOrder={10}
    >
      {/* Shaft */}
      <mesh geometry={shaftGeo}>
        <meshStandardMaterial color={COLOR_ARROW} roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Cone tip — drag handle */}
      <mesh
        geometry={coneGeo}
        position={[0, 13.5, 0]}
        onPointerDown={handlePointerDown}
      >
        <meshStandardMaterial color={COLOR_ARROW} roughness={0.3} metalness={0.2} />
      </mesh>

      {/* Dynamic Dimension HUD */}
      {isDraggingState && (
        <Html position={[0, 20, 0]} center>
          <div style={{
            background: 'rgba(36,41,47,0.9)',
            border: '1px solid rgba(255,255,255,0.2)',
            color: 'var(--nx-text)',
            padding: '6px 12px',
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            backdropFilter: 'blur(4px)',
          }}>
            Δ {dragDist > 0 ? '+' : ''}{dragDist.toFixed(2)} mm
          </div>
        </Html>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// FaceHandles — main export
// ---------------------------------------------------------------------------

export default function FaceHandles({
  geometry,
  faces,
  selectedFaceId,
  selectedFaceIds,
  hoveredFaceId,
  onFaceHover,
  onFaceSelect,
  onPushPull,
  onDragStart,
  onDragEnd,
  onFaceSketch,
}: FaceHandlesProps) {
  // Build per-face geometries (recomputed only when geometry or face list changes)
  const faceGeometries = useMemo(() => {
    return faces.map((face) => buildFaceGeometry(geometry, face));
     
  }, [geometry, faces]);

  const selectedFace = useMemo(
    () => (selectedFaceId !== null ? faces.find((f) => f.id === selectedFaceId) ?? null : null),
    [faces, selectedFaceId],
  );

  if (faces.length === 0) return null;

  return (
    <group>
      {faces.map((face, i) => (
        <FaceMesh
          key={face.id}
          faceGeo={faceGeometries[i]}
          faceId={face.id}
          isHovered={hoveredFaceId === face.id}
          isSelected={selectedFaceId === face.id || (selectedFaceIds?.has(face.id) ?? false)}
          onFaceHover={onFaceHover}
          onFaceSelect={onFaceSelect}
          onFaceSketch={onFaceSketch}
        />
      ))}

      {selectedFace !== null && (
        <PushPullArrow
          face={selectedFace}
          faceId={selectedFace.id}
          onPushPull={onPushPull}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      )}
    </group>
  );
}
