'use client';

import { usePathname } from 'next/navigation';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import ErrorBoundary from '@/components/nexyfab/ErrorBoundary';
import { OrbitControls, Grid, TransformControls, Environment, Html, GizmoHelper, GizmoViewport, Instances, Instance } from '@react-three/drei';
import { NF_R3F_VIEWPORT_DATA_ENGINE } from '@/lib/nexyfab/viewport';
import * as THREE from 'three';
import type { TransformControls as TransformControlsThree } from 'three/examples/jsm/controls/TransformControls.js';
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type ComponentRef } from 'react';
import { createPortal } from 'react-dom';
import type { ShapeResult } from './shapes';
import type { EditMode } from './editing/types';
import { useEditableGeometry } from './editing/useEditableGeometry';
import { useFaceEditing } from './editing/useFaceEditing';

import KinematicDragManager from './assembly/KinematicDragManager';
import { bomPartResultsAndAssemblyMatesToSolverState } from './assembly/mateSelectionMapping';
import type { AssemblyState } from './assembly/matesSolver';
import StandardPartDropHandler, { type StandardPartDropEvent } from './library/StandardPartDropHandler';
import FaceHandles from './editing/FaceHandles';
import EdgeContextPanel from './editing/EdgeContextPanel';
import { useLOD } from './lod/useLOD';
import VertexHandles from './editing/VertexHandles';
import EdgeHandles from './editing/EdgeHandles';
import DimensionOverlay from './DimensionOverlay';
import ViewCube, { ViewCubeOverlay } from './ViewCube';
import SnapAlignGuides from './SnapAlignGuides';
import MeasureTool from './MeasureTool';
import SectionPlane from './SectionPlane';
import MaterialPropertiesPanel, { type MaterialOverride, type EnvPreset } from './MaterialPropertiesPanel';
import ConstructPlane from './ConstructPlane';
import PerfMonitor from './PerfMonitor';
import PinComments from './comments/PinComments';
import type { UnitSystem } from './units';
import { getMaterialPreset, type MaterialPreset } from './materials';
import type { CollabUser } from './collab/CollabTypes';
import CollabCursors from './collab/CollabCursors';
import PrintAnalysisOverlay from './analysis/PrintAnalysisOverlay';
import FEAOverlay from './analysis/FEAOverlay';
import FEAConditionMarkers from './analysis/FEAConditionMarkers';
import type { FEAResult, FEABoundaryCondition } from './analysis/simpleFEA';
import type { FEADisplayMode } from './analysis/FEAOverlay';
import { computeExplodedPositions } from './assembly/ExplodedView';
import { computeAssemblyWorldBounds } from './assembly/assemblyWorldBounds';
import RenderMode from './rendering/RenderMode';
import type { RenderSettings } from './rendering/RenderPanel';
import PathTracer from './rendering/PathTracer';
import DFMOverlay from './analysis/DFMOverlay';
import DraftAnalysisOverlay from './analysis/DraftAnalysisOverlay';
import type { DFMResult, DFMIssue } from './analysis/dfmAnalysis';
import GDTOverlay from './annotations/GDTOverlay';
import type { GDTAnnotation, DimensionAnnotation } from './annotations/GDTTypes';
import InstanceArray from './InstanceArray';
import type { ArrayPattern } from './features/instanceArray';
import { buildInstanceMatrices } from './features/instanceArray';
import NurbsCPEditor from './editing/NurbsCPEditor';
import SelectionMeshR3F from './editing/SelectionMesh';
import FaceHighlightMesh from './editing/FaceHighlightMesh';
import { assemblyViewportLoadBand } from '@/lib/assemblyLoadPolicy';
import { assemblyViewportChrome } from '@/lib/assemblyViewportChrome';

type DisplayMode = 'solid' | 'edges' | 'wireframe';
export type TransformMode = 'translate' | 'rotate' | 'scale' | 'off';

// ─── Three.js memory-leak helpers ────────────────────────────────────────────
// WeakSets track what has already been disposed so that double-dispose calls
// (which happen in React Strict Mode because effects run twice) are silently
// ignored instead of throwing Three.js errors.

const _disposedGeometries = new WeakSet<THREE.BufferGeometry>();
const _disposedMaterials = new WeakSet<THREE.Material>();
const _disposedTextures = new WeakSet<THREE.Texture>();

function safeDisposeTexture(tex: THREE.Texture): void {
  if (_disposedTextures.has(tex)) return;
  _disposedTextures.add(tex);
  tex.dispose();
}

function safeDisposeMaterial(mat: THREE.Material): void {
  if (_disposedMaterials.has(mat)) return;
  _disposedMaterials.add(mat);
  // Dispose any texture slots on the material before disposing the material itself.
  const std = mat as THREE.MeshStandardMaterial;
  if (std.map) safeDisposeTexture(std.map);
  if (std.normalMap) safeDisposeTexture(std.normalMap);
  if (std.roughnessMap) safeDisposeTexture(std.roughnessMap);
  // Catch-all for any other texture-valued properties.
  for (const val of Object.values(mat)) {
    if (val instanceof THREE.Texture) safeDisposeTexture(val);
  }
  mat.dispose();
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        if (!_disposedGeometries.has(mesh.geometry)) {
          _disposedGeometries.add(mesh.geometry);
          mesh.geometry.dispose();
        }
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        if (mat) safeDisposeMaterial(mat);
      }
    }
  });
}

/** Mounted inside <Canvas> — disposes the entire scene on unmount and on
 *  the custom 'nexyfab:scene-cleanup' event dispatched by version rollback. */
function SceneCleanup() {
  const { scene, gl } = useThree();

  useEffect(() => {
    const handleCleanup = () => {
      scene.traverse((obj) => disposeObject(obj));
    };
    window.addEventListener('nexyfab:scene-cleanup', handleCleanup);
    return () => {
      window.removeEventListener('nexyfab:scene-cleanup', handleCleanup);
      scene.traverse((obj) => disposeObject(obj));
      scene.clear();
      gl.dispose();
    };
  }, [scene, gl]);

  return null;
}

// Colors for multi-part assembly
const PART_COLORS = ['#8b9cf4', '#f4a28b', '#8bf4b0', '#f4e08b', '#c48bf4', '#8bd8f4', '#f48bb0', '#b0f48b', '#f4c88b', '#8bf4e0'];

/** Stable empty list so CameraFitter deps do not change every render. */
const EMPTY_SHAPE_RESULTS: ShapeResult[] = [];

// Loads texture maps imperatively and applies them to a meshStandardMaterial ref
function TexturedMeshMaterial({
  color, roughness, metalness, opacity, transparent, envMapIntensity,
  normalScale = 1, displacementScale = 1,
  normalMapUrl, roughnessMapUrl, metalnessMapUrl, aoMapUrl, displacementMapUrl,
  polygonOffset, polygonOffsetFactor, polygonOffsetUnits,
}: {
  color: string; roughness: number; metalness: number; opacity: number; transparent: boolean;
  envMapIntensity: number; normalScale?: number; displacementScale?: number;
  normalMapUrl?: string; roughnessMapUrl?: string; metalnessMapUrl?: string;
  aoMapUrl?: string; displacementMapUrl?: string;
  polygonOffset?: boolean; polygonOffsetFactor?: number; polygonOffsetUnits?: number;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  useEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    const loader = new THREE.TextureLoader();
    const loaded: THREE.Texture[] = [];

    const applyTex = (url: string | undefined, setter: (t: THREE.Texture | null) => void) => {
      if (url) { const t = loader.load(url, () => { mat.needsUpdate = true; }); loaded.push(t); setter(t); }
      else setter(null);
    };

    applyTex(normalMapUrl,      t => { mat.normalMap = t; if (t) mat.normalScale.set(normalScale, normalScale); });
    applyTex(roughnessMapUrl,   t => { mat.roughnessMap = t; });
    applyTex(metalnessMapUrl,   t => { mat.metalnessMap = t; });
    applyTex(aoMapUrl,          t => { mat.aoMap = t; });
    applyTex(displacementMapUrl, t => { mat.displacementMap = t; if (t) mat.displacementScale = displacementScale; });
    mat.needsUpdate = true;

    return () => { loaded.forEach(t => t.dispose()); };
  }, [normalMapUrl, roughnessMapUrl, metalnessMapUrl, aoMapUrl, displacementMapUrl, normalScale, displacementScale]);

  return (
    <meshStandardMaterial
      ref={matRef}
      color={color}
      roughness={roughness}
      metalness={metalness}
      side={THREE.DoubleSide}
      transparent={transparent}
      opacity={opacity}
      envMapIntensity={envMapIntensity}
      polygonOffset={polygonOffset}
      polygonOffsetFactor={polygonOffsetFactor}
      polygonOffsetUnits={polygonOffsetUnits}
    />
  );
}

// Single shape mesh
function ShapeMesh({ result, displayMode, color, position, rotation, partIndex = 0, material, override }: {
  result: ShapeResult; displayMode: DisplayMode; color: string;
  position?: [number, number, number]; rotation?: [number, number, number];
  partIndex?: number; material?: MaterialPreset; override?: MaterialOverride;
}) {
  const geo = result.geometry;
  const edgeGeo = result.edgeGeometry;
  const rot = rotation ? rotation.map(d => d * Math.PI / 180) as [number, number, number] : undefined;

  const matColor = override?.color ?? material?.color ?? color;
  const matRoughness = override?.roughness ?? material?.roughness ?? 0.35;
  const matMetalness = override?.metalness ?? material?.metalness ?? 0.4;
  const matOpacity = material?.opacity ?? 1;
  const matTransparent = material?.transparent ?? false;
  const matEnvMapIntensity = override?.envMapIntensity ?? material?.envMapIntensity ?? 1;

  const hasTextures = !!(override?.normalMapUrl || override?.roughnessMapUrl || override?.metalnessMapUrl || override?.aoMapUrl || override?.displacementMapUrl);

  return (
    <group position={position} rotation={rot}>
      {displayMode !== 'wireframe' && (
        <mesh geometry={geo} castShadow receiveShadow>
          {hasTextures ? (
            <TexturedMeshMaterial
              color={matColor} roughness={matRoughness} metalness={matMetalness}
              opacity={matOpacity} transparent={matTransparent} envMapIntensity={matEnvMapIntensity}
              normalScale={override?.normalScale} displacementScale={override?.displacementScale}
              normalMapUrl={override?.normalMapUrl} roughnessMapUrl={override?.roughnessMapUrl}
              metalnessMapUrl={override?.metalnessMapUrl} aoMapUrl={override?.aoMapUrl}
              displacementMapUrl={override?.displacementMapUrl}
              polygonOffset polygonOffsetFactor={partIndex} polygonOffsetUnits={partIndex}
            />
          ) : (
            <meshStandardMaterial
              color={matColor}
              roughness={matRoughness}
              metalness={matMetalness}
              side={THREE.DoubleSide}
              polygonOffset
              polygonOffsetFactor={partIndex}
              polygonOffsetUnits={partIndex}
              transparent={matTransparent}
              opacity={matOpacity}
              envMapIntensity={matEnvMapIntensity}
            />
          )}
        </mesh>
      )}
      {displayMode === 'wireframe' && (
        <mesh geometry={geo}>
          <meshBasicMaterial color="#22d3ee" wireframe />
        </mesh>
      )}
      {(displayMode === 'edges' || displayMode === 'solid') && edgeGeo && (
        <lineSegments geometry={edgeGeo}>
          <lineBasicMaterial color={displayMode === 'solid' ? '#000000' : '#60a5fa'} transparent opacity={displayMode === 'solid' ? 0.3 : 1} depthTest={true} />
        </lineSegments>
      )}
    </group>
  );
}

// LOD-aware shape mesh: switches geometry detail based on orbit interaction state
function LODShapeMesh({
  result, displayMode, color, position, rotation, partIndex = 0, isOrbiting = false, preferLowDetail = false, material, override,
}: {
  result: ShapeResult; displayMode: DisplayMode; color: string;
  position?: [number, number, number]; rotation?: [number, number, number];
  partIndex?: number; isOrbiting?: boolean;
  /** 대형 어셈블리: 궤도 외에도 저해상 메시 우선 */
  preferLowDetail?: boolean;
  material?: MaterialPreset; override?: MaterialOverride;
}) {
  const { levels, skipped } = useLOD(result.geometry);

  const activeGeo = useMemo(() => {
    if (skipped || levels.length === 0) return result.geometry;
    const low = isOrbiting || preferLowDetail;
    // While orbiting (or large-assembly mode) use lowest available LOD; idle -> full resolution
    if (low && levels.length >= 3) return levels[2];
    if (low && levels.length >= 2) return levels[1];
    return levels[0];
  }, [isOrbiting, preferLowDetail, levels, skipped, result.geometry]);

  const lodResult: ShapeResult = useMemo(
    () => ({ ...result, geometry: activeGeo }),
    [result, activeGeo],
  );

  return <ShapeMesh result={lodResult} displayMode={displayMode} color={color} position={position} rotation={rotation} partIndex={partIndex} material={material} override={override} />;
}

// Editable shape mesh (used when editMode !== 'none')
function EditableShapeMesh({ geometry, displayMode, color }: { geometry: THREE.BufferGeometry; displayMode: DisplayMode; color: string }) {
  return (
    <group>
      {displayMode !== 'wireframe' && (
        <mesh geometry={geometry} castShadow receiveShadow>
          <meshStandardMaterial color={color} roughness={0.35} metalness={0.4} side={THREE.DoubleSide} transparent opacity={0.7} />
        </mesh>
      )}
      {displayMode === 'wireframe' && (
        <mesh geometry={geometry}>
          <meshBasicMaterial color="#22d3ee" wireframe />
        </mesh>
      )}
    </group>
  );
}

/* ── Turntable animation group ───────────────────────────────────────────── */
function TurntableGroup({
  active,
  speed = 0.4,
  children,
}: {
  active: boolean;
  speed?: number;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (active && groupRef.current) {
      groupRef.current.rotation.y += speed * delta;
    }
  });
  return <group ref={groupRef}>{children}</group>;
}

/* ── Motion-transform group (applies first part's Matrix4 from simulation) ── */
function MotionMeshWrapper({
  transforms,
  children,
}: {
  transforms: Record<string, THREE.Matrix4> | null;
  children: React.ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (!transforms) return;
    const g = groupRef.current;
    if (!g) return;
    const keys = Object.keys(transforms);
    if (keys.length === 0) return;
    const mat = transforms[keys[0]];
    g.matrix.copy(mat);
    g.matrixAutoUpdate = false;
    return () => {
      g.matrix.identity();
      g.matrixAutoUpdate = true;
    };
  }, [transforms]);

  if (!transforms) return <>{children}</>;
  return <group ref={groupRef}>{children}</group>;
}

// Detects dominant camera view direction and suggests a sketch plane
function CameraPlaneDetector({ onChange }: { onChange: (plane: 'xy' | 'xz' | 'yz') => void }) {
  const { camera } = useThree();
  const lastPlane = useRef<'xy' | 'xz' | 'yz'>('xy');

  useFrame(() => {
    // View direction = normalize(target - position), approximate with -position.normalize()
    const dir = camera.position.clone().negate().normalize();
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);
    let plane: 'xy' | 'xz' | 'yz';
    if (az >= ax && az >= ay) plane = 'xy';       // looking along Z → XY plane
    else if (ay >= ax && ay >= az) plane = 'xz';  // looking along Y → XZ plane
    else plane = 'yz';                             // looking along X → YZ plane
    if (plane !== lastPlane.current) {
      lastPlane.current = plane;
      onChange(plane);
    }
  });

  return null;
}

// Camera fitter component (runs inside Canvas)
// Only refit when `fitKey` changes — do not depend on `results` / `bomParts` array identity
// (parent often passes a new [] each render, which was resetting the camera every frame).
type PersistedVec3 = [number, number, number];

function ViewportCameraPersistence({
  enabled,
  onCommit,
}: {
  enabled: boolean;
  onCommit?: (position: PersistedVec3, target: PersistedVec3) => void;
}) {
  const { camera, controls } = useThree();
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  useEffect(() => {
    if (!enabled || !onCommitRef.current) return;
    const oc = controls as unknown as { addEventListener?: (ev: string, fn: () => void) => void; removeEventListener?: (ev: string, fn: () => void) => void } | null;
    if (!oc?.addEventListener) return;
    const handler = () => {
      const cb = onCommitRef.current;
      if (!cb) return;
      const t = (controls as unknown as { target?: THREE.Vector3 })?.target;
      if (!t) return;
      cb(
        [camera.position.x, camera.position.y, camera.position.z],
        [t.x, t.y, t.z],
      );
    };
    oc.addEventListener('end', handler);
    return () => oc.removeEventListener?.('end', handler);
  }, [enabled, camera, controls]);
  return null;
}

function ProjectCameraHydrate({
  position,
  target,
  onApplied,
}: {
  position: PersistedVec3;
  target: PersistedVec3;
  onApplied: () => void;
}) {
  const { camera, controls } = useThree();
  const token = `${position.join(',')}|${target.join(',')}`;
  const lastRef = useRef<string | null>(null);
  
  const anim = useRef({
    active: false,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    progress: 0
  });

  useLayoutEffect(() => {
    if (lastRef.current === token) return;
    const oc = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    if (!oc?.target?.set) return;

    if (lastRef.current === null) {
      // First load, no animation
      camera.position.set(position[0], position[1], position[2]);
      oc.target.set(target[0], target[1], target[2]);
      oc.update?.();
      onApplied();
    } else {
      // Animate!
      anim.current.active = true;
      anim.current.progress = 0;
      anim.current.startPos.copy(camera.position);
      anim.current.endPos.set(position[0], position[1], position[2]);
      anim.current.startTarget.copy(oc.target);
      anim.current.endTarget.set(target[0], target[1], target[2]);
    }
    
    lastRef.current = token;
  }, [camera, controls, position, target, token, onApplied]);

  useFrame((_, delta) => {
    if (!anim.current.active) return;
    anim.current.progress += delta * 2.0; // 0.5s duration
    const oc = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    
    if (anim.current.progress >= 1) {
      anim.current.active = false;
      camera.position.copy(anim.current.endPos);
      if (oc?.target) oc.target.copy(anim.current.endTarget);
      oc?.update?.();
      onApplied();
      return;
    }
    
    // cubic ease out
    const t = anim.current.progress;
    const ease = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(anim.current.startPos, anim.current.endPos, ease);
    if (oc?.target) {
      oc.target.lerpVectors(anim.current.startTarget, anim.current.endTarget, ease);
      oc.update?.();
    }
  });

  return null;
}

function CameraFitter({
  results,
  bomParts,
  fitKey,
  blockAuto,
}: {
  results: ShapeResult[];
  bomParts?: BomPartResult[];
  fitKey: number;
  blockAuto?: boolean;
}) {
  const { camera, controls } = useThree();
  const resultsRef = useRef(results);
  const bomPartsRef = useRef(bomParts);
  resultsRef.current = results;
  bomPartsRef.current = bomParts;

  const anim = useRef({
    active: false,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startTarget: new THREE.Vector3(),
    endTarget: new THREE.Vector3(),
    progress: 0
  });

  const lastFitKeyRef = useRef<number | null>(null);

  useEffect(() => {
    if (blockAuto) return;
    const rList = resultsRef.current;
    const bParts = bomPartsRef.current;
    if (rList.length === 0) return;
    const combined = new THREE.Box3();
    if (bParts && bParts.length > 0) {
      for (const part of bParts) {
        part.result.geometry.computeBoundingBox();
        if (part.result.geometry.boundingBox) {
          const box = part.result.geometry.boundingBox.clone();
          if (part.rotation) {
            const rot = part.rotation.map(d => d * Math.PI / 180) as [number, number, number];
            const mat = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
            box.applyMatrix4(mat);
          }
          if (part.position) box.translate(new THREE.Vector3(...part.position));
          combined.union(box);
        }
      }
    } else {
      for (const r of rList) {
        r.geometry.computeBoundingBox();
        if (r.geometry.boundingBox) combined.union(r.geometry.boundingBox);
      }
    }
    if (combined.isEmpty()) return;
    
    // Fit math
    const center = combined.getCenter(new THREE.Vector3());
    const size = combined.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
    const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
    const dist = (maxDim / (2 * Math.tan(fov / 2))) * 2.05;
    
    const targetPos = new THREE.Vector3(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.7);
    const targetCenter = center;

    const oc = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;

    if (lastFitKeyRef.current === null) {
      // Immediate snap on first load
      camera.position.copy(targetPos);
      camera.lookAt(targetCenter);
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      if (oc?.target) {
        oc.target.copy(targetCenter);
        oc.update?.();
      }
    } else if (lastFitKeyRef.current !== fitKey) {
      // Smooth fly-to animation for subsequent fits
      anim.current.active = true;
      anim.current.progress = 0;
      anim.current.startPos.copy(camera.position);
      anim.current.endPos.copy(targetPos);
      if (oc?.target) {
        anim.current.startTarget.copy(oc.target);
        anim.current.endTarget.copy(targetCenter);
      }
    }

    lastFitKeyRef.current = fitKey;
  }, [camera, controls, fitKey, blockAuto]);

  useFrame((_, delta) => {
    if (!anim.current.active) return;
    anim.current.progress += delta * 2.5; // 0.4s
    const oc = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    
    if (anim.current.progress >= 1) {
      anim.current.active = false;
      camera.position.copy(anim.current.endPos);
      camera.lookAt(anim.current.endTarget);
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      if (oc?.target) oc.target.copy(anim.current.endTarget);
      oc?.update?.();
      return;
    }
    
    const t = anim.current.progress;
    const ease = 1 - Math.pow(1 - t, 3); // cubic ease out
    camera.position.lerpVectors(anim.current.startPos, anim.current.endPos, ease);
    if (oc?.target) {
      oc.target.lerpVectors(anim.current.startTarget, anim.current.endTarget, ease);
      oc.update?.();
    }
    camera.lookAt(oc?.target || anim.current.endTarget);
  });

  return null;
}

// Edit scene: renders editable geometry + handles
function EditScene({
  sourceGeometry,
  editMode,
  displayMode,
  onDragStateChange,
  snapGrid,
  selectedEdgeIds,
  onEdgeSelect,
}: {
  sourceGeometry: THREE.BufferGeometry;
  editMode: EditMode;
  displayMode: DisplayMode;
  onDragStateChange?: (dragging: boolean) => void;
  snapGrid?: number;
  selectedEdgeIds?: Set<number>;
  onEdgeSelect?: (edge: import('./editing/types').UniqueEdge, additive: boolean) => void;
}) {
  const { editGeometry, vertices, edges, moveVertex, moveEdge } = useEditableGeometry(sourceGeometry);
  const [isDragging, setIsDragging] = useState(false);

  /** OrbitControls default LEFT=rotate steals clicks from vertex/edge handles; disable left binding. */
  const vertexEdgeOrbitMouse = useMemo(
    () => ({
      LEFT: -1 as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT: THREE.MOUSE.PAN,
    }),
    [],
  );

  const orbitMinDistance = useMemo(() => {
    if (!editGeometry) return 8;
    editGeometry.computeBoundingSphere();
    const r = editGeometry.boundingSphere?.radius ?? 20;
    return Math.max(4, Math.min(120, r * 0.12));
  }, [editGeometry]);

  const handleDragStart = useCallback(() => {
    setIsDragging(true);
    onDragStateChange?.(true);
  }, [onDragStateChange]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    onDragStateChange?.(false);
  }, [onDragStateChange]);

  if (!editGeometry) return null;

  return (
    <group>
      <EditableShapeMesh geometry={editGeometry} displayMode={displayMode} color="#8b9cf4" />

      {editMode === 'vertex' && (
        <VertexHandles
          vertices={vertices}
          onVertexMove={moveVertex}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          snapGrid={snapGrid}
          size={2.4}
        />
      )}

      {editMode === 'edge' && (
        <EdgeHandles
          edges={edges}
          vertices={vertices}
          onEdgeMove={moveEdge}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          snapGrid={snapGrid}
          selectedEdgeIds={selectedEdgeIds}
          onEdgeSelect={onEdgeSelect}
        />
      )}

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.07}
        minDistance={orbitMinDistance}
        maxDistance={5000}
        enabled={!isDragging}
        mouseButtons={vertexEdgeOrbitMouse}
        touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </group>
  );
}

// Face edit scene
function FaceScene({
  sourceGeometry,
  displayMode,
  onDragStateChange,
  onGeometryApply,
  onFaceSketch,
  emptySelectionCallout,
  emptySelectionCalloutTitle,
  emptySelectionCalloutTip,
  emptySelectionCalloutDismiss,
}: {
  sourceGeometry: THREE.BufferGeometry;
  displayMode: DisplayMode;
  onDragStateChange?: (d: boolean) => void;
  onGeometryApply?: (geo: THREE.BufferGeometry) => void;
  onFaceSketch?: (faceId: number) => void;
  /** Shown until a face is selected — keeps Push/Pull steps visible on the canvas. */
  emptySelectionCallout?: string;
  emptySelectionCalloutTitle?: string;
  emptySelectionCalloutTip?: string;
  emptySelectionCalloutDismiss?: string;
}) {
  const { editGeometry, faces, selectedFaceId, setSelectedFaceId, hoveredFaceId, setHoveredFaceId, pushPullFace, resetEdits: _resetEdits, hasEdits } = useFaceEditing(sourceGeometry);
  const [isDragging, setIsDragging] = useState(false);
  const [calloutDismissed, setCalloutDismissed] = useState(false);
  // Multi-selection (Shift/Ctrl + click adds to set)
  const [selectedFaceIds, setSelectedFaceIds] = useState<Set<number>>(new Set());

  const handleFaceSelect = useCallback((id: number | null, additive?: boolean) => {
    if (id === null) {
      setSelectedFaceId(null);
      if (!additive) setSelectedFaceIds(new Set());
      return;
    }
    setSelectedFaceId(id);
    setSelectedFaceIds(prev => {
      if (!additive) return new Set([id]);
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [setSelectedFaceId]);

  const clearSelection = useCallback(() => {
    setSelectedFaceId(null);
    setSelectedFaceIds(new Set());
  }, [setSelectedFaceId]);

  useEffect(() => {
    setCalloutDismissed(false);
  }, [sourceGeometry.uuid]);

  const faceOrbitMinDistance = useMemo(() => {
    if (!editGeometry) return 20;
    editGeometry.computeBoundingSphere();
    const r = editGeometry.boundingSphere?.radius ?? 20;
    return Math.max(4, Math.min(120, r * 0.12));
  }, [editGeometry]);

  if (!editGeometry) return null;

  const showFaceEditCallout = Boolean(
    emptySelectionCallout
    && selectedFaceId === null
    && selectedFaceIds.size === 0
    && !isDragging
    && !calloutDismissed,
  );
  const calloutTitle = emptySelectionCalloutTitle ?? 'Push/Pull';
  const calloutTip = emptySelectionCalloutTip ?? '';
  const dismissLabel = emptySelectionCalloutDismiss ?? 'OK';

  return (
    <group>
      <EditableShapeMesh geometry={editGeometry} displayMode={displayMode} color="#8b9cf4" />
      <FaceHandles
        geometry={editGeometry}
        faces={faces}
        selectedFaceId={selectedFaceId}
        selectedFaceIds={selectedFaceIds}
        hoveredFaceId={hoveredFaceId}
        onFaceHover={setHoveredFaceId}
        onFaceSelect={handleFaceSelect}
        onPushPull={pushPullFace}
        onFaceSketch={onFaceSketch}
        onDragStart={() => { setIsDragging(true); onDragStateChange?.(true); }}
        onDragEnd={() => {
          setIsDragging(false);
          onDragStateChange?.(false);
          if (hasEdits && editGeometry && onGeometryApply) onGeometryApply(editGeometry.clone());
        }}
      />
      {showFaceEditCallout && typeof document !== 'undefined' && createPortal(
        <div
          role="note"
          className="nf-face-edit-callout"
          style={{
            position: 'fixed',
            left: 10,
            bottom: 72,
            zIndex: 80,
            maxWidth: 300,
            padding: '8px 10px',
            borderRadius: 8,
            background: 'rgba(13,17,23,0.95)',
            border: '1px solid rgba(34,197,94,0.65)',
            color: '#e6edf3',
            fontSize: 11,
            lineHeight: 1.45,
            fontWeight: 500,
            textAlign: 'left',
            boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'auto',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 4,
          }}
          >
            <div style={{ fontWeight: 800, color: '#4ade80', fontSize: 11, lineHeight: 1.3 }}>
              ▣ {calloutTitle}
            </div>
            <button
              type="button"
              onClick={() => setCalloutDismissed(true)}
              style={{
                flexShrink: 0,
                padding: '2px 8px',
                borderRadius: 4,
                border: '1px solid #30363d',
                background: '#21262d',
                color: '#8b949e',
                fontSize: 10,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {dismissLabel}
            </button>
          </div>
          <div style={{ color: '#c9d1d9' }}>{emptySelectionCallout}</div>
          {calloutTip ? (
            <div style={{ marginTop: 6, fontSize: 10, color: '#8b949e', lineHeight: 1.35 }}>
              {calloutTip}
            </div>
          ) : null}
        </div>,
        document.body,
      )}
      {/* Multi-selection HUD overlay (only when >1 face is selected) */}
      {selectedFaceIds.size > 1 && (
        <Html position={[0, 0, 0]} center wrapperClass="nf-face-sel-hud" style={{ pointerEvents: 'auto' }}>
          <div style={{
            position: 'fixed', top: 84, right: 16, zIndex: 50,
            padding: '8px 12px', borderRadius: 8,
            background: 'rgba(13,17,23,0.92)', border: '1px solid #388bfd',
            color: '#c9d1d9', fontSize: 12, fontWeight: 600,
            fontFamily: 'system-ui, sans-serif',
            display: 'flex', alignItems: 'center', gap: 10,
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
          }}>
            <span style={{ color: '#58a6ff' }}>▣</span>
            <span>{selectedFaceIds.size} faces</span>
            <button
              onClick={clearSelection}
              style={{
                padding: '3px 8px', borderRadius: 4, border: '1px solid #30363d',
                background: 'transparent', color: '#8b949e', fontSize: 10, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Clear
            </button>
          </div>
        </Html>
      )}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.07}
        minDistance={faceOrbitMinDistance}
        maxDistance={5000}
        enabled={!isDragging}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
    </group>
  );
}

// Transform gizmo scene: renders mesh with TransformControls
function TransformScene({
  result,
  displayMode,
  transformMode,
  onTransformChange,
  snapGrid,
}: {
  result: ShapeResult;
  displayMode: DisplayMode;
  transformMode: 'translate' | 'rotate' | 'scale';
  onTransformChange?: (matrix: number[]) => void;
  snapGrid?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const transformRef = useRef<ComponentRef<typeof TransformControls>>(null!);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const controls = transformRef.current as unknown as TransformControlsThree | null;
    if (!controls) return;
    const cb = (e: { value: unknown }) => {
      setIsDragging(Boolean(e.value));
    };
    controls.addEventListener('dragging-changed', cb);
    return () => controls.removeEventListener('dragging-changed', cb);
  }, []);

  useEffect(() => {
    const controls = transformRef.current as unknown as TransformControlsThree | null;
    if (!controls) return;
    const cb = () => {
      if (!meshRef.current || !onTransformChange) return;
      const m = meshRef.current;
      const snapOn = !!(snapGrid && snapGrid > 0);
      if (snapOn && transformMode === 'translate') {
        const g = snapGrid!;
        m.position.x = Math.round(m.position.x / g) * g;
        m.position.y = Math.round(m.position.y / g) * g;
        m.position.z = Math.round(m.position.z / g) * g;
        m.updateMatrix();
      } else if (snapOn && transformMode === 'rotate') {
        const step = THREE.MathUtils.degToRad(15);
        const e = new THREE.Euler().setFromQuaternion(m.quaternion, 'XYZ');
        e.x = Math.round(e.x / step) * step;
        e.y = Math.round(e.y / step) * step;
        e.z = Math.round(e.z / step) * step;
        m.quaternion.setFromEuler(e);
        m.updateMatrix();
      } else if (snapOn && transformMode === 'scale') {
        const step = 0.05;
        const snap = (v: number) => Math.max(1e-6, Math.round(v / step) * step);
        m.scale.x = snap(m.scale.x);
        m.scale.y = snap(m.scale.y);
        m.scale.z = snap(m.scale.z);
        m.updateMatrix();
      }
      m.updateWorldMatrix(true, false);
      onTransformChange(m.matrixWorld.toArray());
    };
    controls.addEventListener('objectChange', cb);
    return () => controls.removeEventListener('objectChange', cb);
  }, [onTransformChange, transformMode, snapGrid]);

  return (
    <group>
      <ShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" />
      <mesh ref={meshRef} geometry={result.geometry} visible={false} />
      <TransformControls
        ref={transformRef}
        object={meshRef}
        mode={transformMode}
        size={0.7}
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={1} maxDistance={5000} enabled={!isDragging} />
    </group>
  );
}

export interface BomPartResult {
  name: string;
  result: ShapeResult;
  /** Scene position in mm (library placement / chat BOM). */
  position?: [number, number, number];
  /** Euler in degrees (XYZ); `ShapeMesh` and `bomPartWorldMatrixFromBom` convert to radians. */
  rotation?: [number, number, number];
  color?: string;
}

/** One row of instance data for grouped assembly rendering */
interface AssemblyInstancePart {
  part: BomPartResult;
  index: number;
  key: string;
  isHighlighted: boolean;
  isFaded: boolean;
  pos: [number, number, number] | undefined;
  rot: [number, number, number] | undefined;
}

/**
 * Instanced BOM geometry with the same LOD policy as {@link LODShapeMesh}:
 * large assemblies (`preferLowDetail`) or orbit drag uses simplified meshes when available.
 * Selection raycasts keep the original geometry for accuracy.
 */
function AssemblyInstancedGroup({
  geometry,
  parts,
  displayMode,
  isOrbiting,
  preferLowDetail,
  selectionActive,
  isKinematicsMode,
  onStandardPartDrop,
  onElementSelect,
}: {
  geometry: THREE.BufferGeometry;
  parts: AssemblyInstancePart[];
  displayMode: DisplayMode;
  isOrbiting: boolean;
  preferLowDetail: boolean;
  selectionActive: boolean;
  isKinematicsMode: boolean;
  onStandardPartDrop?: (evt: StandardPartDropEvent) => void;
  onElementSelect?: (info: import('./editing/selectionInfo').ElementSelectionInfo) => void;
}) {
  const { levels, skipped } = useLOD(geometry);

  const activeGeo = useMemo(() => {
    if (skipped || levels.length === 0) return geometry;
    const low = isOrbiting || preferLowDetail;
    if (low && levels.length >= 3) return levels[2];
    if (low && levels.length >= 2) return levels[1];
    return levels[0];
  }, [isOrbiting, preferLowDetail, levels, skipped, geometry]);

  return (
    <group>
      {displayMode === 'wireframe' ? (
        <Instances geometry={activeGeo}>
          <meshBasicMaterial wireframe color="#111" />
          {parts.map(p => (
            <Instance
              key={p.key}
              position={p.pos}
              rotation={p.rot}
              color={p.isHighlighted ? '#e3b341' : (p.part.color ?? PART_COLORS[p.index % PART_COLORS.length])}
            />
          ))}
        </Instances>
      ) : (
        <Instances geometry={activeGeo} castShadow receiveShadow>
          <meshStandardMaterial roughness={0.35} metalness={0.4} side={THREE.DoubleSide} transparent opacity={0.7} />
          {parts.map(p => (
            <Instance
              key={p.key}
              position={p.pos}
              rotation={p.rot}
              color={p.isHighlighted ? '#e3b341' : (p.part.color ?? PART_COLORS[p.index % PART_COLORS.length])}
            />
          ))}
        </Instances>
      )}
      {(selectionActive || isKinematicsMode || !!onStandardPartDrop) && parts.map(p => (
        <group key={`sel_${p.key}`} position={p.pos} rotation={p.rot}>
          <SelectionMeshR3F
            geometry={geometry}
            onSelect={(info) => onElementSelect?.({ ...info, partName: p.key })}
          />
        </group>
      ))}
    </group>
  );
}

interface ShapePreviewProps {
  result: ShapeResult | null;
  bomParts?: BomPartResult[];
  highlightedPartId?: string | null;
  assemblyLabel?: string;
  onCapture?: (cb: () => string | null) => void;
  editMode?: EditMode;
  onDragStateChange?: (dragging: boolean) => void;
  showDimensions?: boolean;
  measureActive?: boolean;
  measureMode?: 'distance' | 'angle' | 'radius';
  sectionActive?: boolean;
  sectionAxis?: 'x' | 'y' | 'z';
  sectionOffset?: number;
  showPlanes?: boolean;
  constructPlanes?: Array<{ id: string; type: 'xy' | 'xz' | 'yz' | 'offset'; offset?: number; visible: boolean; label?: string }>;
  transformMode?: TransformMode;
  onTransformChange?: (matrix: number[]) => void;
  snapGrid?: number;
  unitSystem?: UnitSystem;
  showPerf?: boolean;
  materialId?: string;
  collabUsers?: CollabUser[];
  showPrintAnalysis?: boolean;
  printAnalysis?: import('./analysis/printAnalysis').PrintAnalysisResult | null;
  printBuildDirection?: [number, number, number];
  printOverhangAngle?: number;
  renderMode?: 'standard' | 'photorealistic';
  renderSettings?: RenderSettings;
  onCaptureScreenshot?: () => void;
  explodeFactor?: number;
  interferenceHighlights?: Array<{ partA: string; partB: string; volume: number; boundingBox: THREE.Box3 }>;
  showFEA?: boolean;
  feaResult?: FEAResult | null;
  feaDisplayMode?: FEADisplayMode;
  feaDeformationScale?: number;
  /** FEA boundary conditions to visualize as 3D markers (during setup, before solve) */
  feaConditions?: FEABoundaryCondition[];
  /** Index of currently highlighted condition (e.g., panel hover) */
  feaHighlightedConditionIdx?: number | null;
  /** Click on a 3D condition marker → callback (panel can scroll/select that row) */
  onFEAConditionClick?: (idx: number) => void;
  showDFM?: boolean;
  dfmResults?: DFMResult[] | null;
  dfmHighlightedIssue?: DFMIssue | null;
  showDraftAnalysis?: boolean;
  draftResult?: import('./analysis/draftAnalysis').DraftAnalysisResult | null;
  draftMinDeg?: number;
  showCenterOfMass?: [number, number, number] | null;
  gdtAnnotations?: GDTAnnotation[];
  dimensionAnnotations?: DimensionAnnotation[];
  onSceneReady?: (scene: THREE.Scene) => void;
  arrayPattern?: ArrayPattern | null;
  showArray?: boolean;
  onCameraPlaneChange?: (plane: 'xy' | 'xz' | 'yz') => void;
  sketchPlane?: 'xy' | 'xz' | 'yz';
  onSketchPlaneChange?: (p: 'xy' | 'xz' | 'yz') => void;
  onOpenLibrary?: () => void;
  onStartSketch?: () => void;
  onOpenChat?: () => void;
  // Pin comments
  pinComments?: import('./comments/PinComments').MeshComment[];
  isPlacingComment?: boolean;
  focusedPinCommentId?: string | null;
  onAddPinComment?: (position: [number, number, number], text: string, type?: import('./comments/PinComments').MeshComment['type']) => void;
  onResolvePinComment?: (id: string) => void;
  onDeletePinComment?: (id: string) => void;
  onReactPinComment?: (id: string, emoji: string) => void;
  onReplyPinComment?: (id: string, text: string) => void;
  pinCommentRoomUsers?: Array<{ id: string; name: string; color: string }>;
  pinCommentCurrentUserId?: string;
  onGeometryApply?: (geo: THREE.BufferGeometry) => void;
  onFaceSketch?: (faceId: number) => void;
  onDimClick?: (dim: 'w' | 'h' | 'd', currentValue: number) => void;
  lang?: string;
  /** Called when a supported CAD/mesh file is dropped onto the viewport */
  onFileImport?: (file: File) => void;
  /** Whether snap is enabled (shows snap guides) */
  snapEnabled?: boolean;
  /** Ghost (preview) result — shown semi-transparent alongside the main shape */
  ghostResult?: ShapeResult | null;
  /** Turntable animation mode: 'turntable' rotates the shape automatically */
  animateMode?: 'none' | 'turntable';
  /** Per-part transforms from motion simulation playback (partId → Matrix4) */
  motionPartTransforms?: Record<string, THREE.Matrix4> | null;
  /** NURBS control point editor: show when nurbsSurface feature is active */
  nurbsCPEdit?: boolean;
  nurbsCPParams?: Record<string, number>;
  onNurbsCPParamChange?: (key: string, value: number) => void;
  /** Face/edge selection: called when user clicks a face on the main mesh */
  onElementSelect?: (info: import('./editing/selectionInfo').ElementSelectionInfo) => void;
  /** Whether face selection click mode is active */
  selectionActive?: boolean;
  /** Triangle indices of the currently selected face group (for highlight rendering) */
  highlightTriangles?: number[];
  /** Assembly Mates to visualize */
  assemblyMates?: import('./assembly/AssemblyMates').AssemblyMate[];
  /** When true, empty 3D panel shows sketch-oriented copy (no duplicate "start sketch" CTA). */
  isSketchMode?: boolean;
  /** Face-edit mode: shown inside the canvas until the user picks a face (step-by-step help). */
  faceEditViewportCallout?: string;
  faceEditViewportCalloutTitle?: string;
  faceEditViewportCalloutTip?: string;
  faceEditCalloutDismiss?: string;
  /** Skip bbox-based camera fit (used when restoring orbit from .nfab until user clicks Fit). */
  blockAutomaticGeometryFit?: boolean;
  /** One-shot camera from project file — applied inside Canvas then cleared via `onProjectCameraApplied`. */
  projectCameraToApply?: { position: [number, number, number]; target: [number, number, number] } | null;
  onProjectCameraApplied?: () => void;
  isKinematicsMode?: boolean;
  onStandardPartDrop?: (evt: StandardPartDropEvent) => void;
  /** After each orbit interaction (main viewport). */
  onViewportCameraCommit?: (position: [number, number, number], target: [number, number, number]) => void;
  /** User clicked Fit / reset view — parent clears geometry-fit suppression. */
  onGeometryFitRequest?: () => void;
  onMaterialDrop?: (materialId: string) => void;
  onRadialCommand?: (cmd: string) => void;
  /** Toggles face selection mode */
  onToggleSelection?: () => void;
}

/* ─── i18n dict (preview chrome) ──────────────────────────────────────── */

const dict = {
  ko: { drop: 'CAD 파일을 여기에 놓으세요', material: '재료 프리뷰', turntable: '터닝테이블 애니메이션',
        front: '정면', right: '우측', top: '상면', fitAll: '전체 맞춤', fit: '전체 맞춤',
        snapOn: '스냅 ON', pickShape: '형상 선택', startSketch: '스케치 시작', aiChat: 'AI 채팅',
        selectFace: '면 선택', selectOn: '면 선택 ON',
        shapeLibraryTitle: '형상 라이브러리', aiChatTitle: 'AI 채팅',
        emptyTagline: '브라우저 기반 3D CAD — 라이브러리에서 고르거나 스케치로 시작하세요',
        sketchEmptyPreviewHint: '프로파일을 닫고 돌출하면 이 영역에 3D 미리보기가 나타납니다',
        shortcutsHint: '? 키를 눌러 단축키를 확인하세요',
        solid: '솔리드', edgeMode: '에지', wire: '와이어', iso: '등각', resetCamera: '뷰 맞춤', dimensions: '치수', fullscreenIn: '전체 화면', fullscreenOut: '전체 화면 닫기',
        preview3d: '3D 미리보기', editMode: '편집', assemblyShort: '어셈블리', viewWhenNoModel: '3D 모델이 있을 때 사용할 수 있습니다',
        assemblyLoadBadgeLight: '부하↑', assemblyLoadTitleLight: '파트가 늘면 렌더 비용이 조금씩 증가합니다.',
        assemblyLoadBadgeWarn: '다수 파트', assemblyLoadTitleWarn: '파트 수가 많아 브라우저 부하가 커질 수 있습니다.',
        assemblyLoadBadgeHeavy: '대형', assemblyLoadTitleHeavy: '대형 어셈블리입니다. 성능·메모리 사용량이 크게 늘 수 있습니다.',
        assemblyLoadBadgeExtreme: '초대형', assemblyLoadTitleExtreme: '매우 많은 파트입니다. 저해상 LOD가 자동 적용됩니다.',
        directEditNavHint: '핸들: 좌클 드래그 · 회전: 가운데 버튼 드래그 · 팬: 우클릭' },
  en: { drop: 'Drop CAD file here', material: 'Material Preview', turntable: 'Turntable Animation',
        front: 'Front', right: 'Right', top: 'Top', fitAll: 'Fit All', fit: 'Fit',
        snapOn: 'SNAP ON', pickShape: 'Pick Shape', startSketch: 'Start Sketch', aiChat: 'AI Chat',
        selectFace: 'Select Face', selectOn: 'Select ON',
        shapeLibraryTitle: 'Shape Library', aiChatTitle: 'AI Chat',
        emptyTagline: 'Browser-based 3D CAD — pick a template or start sketching',
        sketchEmptyPreviewHint: 'Close the profile and extrude to see the 3D preview here',
        shortcutsHint: 'Press ? for keyboard shortcuts',
        solid: 'Solid', edgeMode: 'Edge', wire: 'Wire', iso: 'Iso', resetCamera: 'Reset view', dimensions: 'Dimensions', fullscreenIn: 'Fullscreen', fullscreenOut: 'Exit fullscreen',
        preview3d: '3D preview', editMode: 'Edit', assemblyShort: 'Assembly', viewWhenNoModel: 'Available once a 3D model is shown',
        assemblyLoadBadgeLight: 'Load↑', assemblyLoadTitleLight: 'More parts gradually increase render cost.',
        assemblyLoadBadgeWarn: 'Many parts', assemblyLoadTitleWarn: 'Many parts may increase browser load and interaction latency.',
        assemblyLoadBadgeHeavy: 'Large asm', assemblyLoadTitleHeavy: 'Large assembly — expect higher GPU/memory use.',
        assemblyLoadBadgeExtreme: 'XL asm', assemblyLoadTitleExtreme: 'Very large assembly — lower-detail LOD is applied automatically.',
        directEditNavHint: 'Handles: left-drag · Orbit: middle-drag · Pan: right-drag' },
  ja: { drop: 'CADファイルをここにドロップ', material: 'マテリアルプレビュー', turntable: 'ターンテーブルアニメ',
        front: '正面', right: '右', top: '上', fitAll: '全体表示', fit: '全体',
        snapOn: 'スナップON', pickShape: '形状選択', startSketch: 'スケッチ開始', aiChat: 'AIチャット',
        selectFace: '面選択', selectOn: '面選択 ON',
        shapeLibraryTitle: '形状ライブラリ', aiChatTitle: 'AIチャット',
        emptyTagline: 'ブラウザ上の3D CAD — ライブラリから選ぶかスケッチで開始',
        sketchEmptyPreviewHint: 'プロファイルを閉じて押し出すと、ここに3Dプレビューが表示されます',
        shortcutsHint: '? キーでショートカットを表示',
        solid: 'ソリッド', edgeMode: 'エッジ', wire: 'ワイヤ', iso: '等角', resetCamera: 'ビュー合わせ', dimensions: '寸法', fullscreenIn: '全画面', fullscreenOut: '全画面解除',
        preview3d: '3Dプレビュー', editMode: '編集', assemblyShort: 'アセンブリ', viewWhenNoModel: '3Dモデル表示後に利用できます',
        assemblyLoadBadgeLight: '負荷↑', assemblyLoadTitleLight: 'パートが増えると描画コストが少しずつ増えます。',
        assemblyLoadBadgeWarn: '多パート', assemblyLoadTitleWarn: 'パート数が多く、ブラウザ負荷が高まることがあります。',
        assemblyLoadBadgeHeavy: '大型', assemblyLoadTitleHeavy: '大型アセンブリです。GPU/メモリ使用量が大きくなる場合があります。',
        assemblyLoadBadgeExtreme: '特大', assemblyLoadTitleExtreme: 'パート数が非常に多いです。低詳細LODを自動適用します。',
        directEditNavHint: 'ハンドル:左ドラッグ・回転:ホイールドラッグ・パン:右ドラッグ' },
  zh: { drop: '将 CAD 文件拖放到此处', material: '材质预览', turntable: '转盘动画',
        front: '正面', right: '右', top: '上', fitAll: '适应窗口', fit: '适应',
        snapOn: '捕捉 开', pickShape: '选择形状', startSketch: '开始草图', aiChat: 'AI 聊天',
        selectFace: '面选择', selectOn: '面选择 开',
        shapeLibraryTitle: '形状库', aiChatTitle: 'AI 聊天',
        emptyTagline: '浏览器 3D CAD — 从库中选择或开始草图',
        sketchEmptyPreviewHint: '闭合轮廓并拉伸后，将在此处显示 3D 预览',
        shortcutsHint: '按 ? 查看快捷键',
        solid: '实体', edgeMode: '边', wire: '线框', iso: '轴测', resetCamera: '重置视图', dimensions: '尺寸', fullscreenIn: '全屏', fullscreenOut: '退出全屏',
        preview3d: '3D 预览', editMode: '编辑', assemblyShort: '装配', viewWhenNoModel: '有 3D 模型后可用',
        assemblyLoadBadgeLight: '负载↑', assemblyLoadTitleLight: '零件增多会逐步提高渲染成本。',
        assemblyLoadBadgeWarn: '多零件', assemblyLoadTitleWarn: '零件较多时，浏览器负载可能升高。',
        assemblyLoadBadgeHeavy: '大型', assemblyLoadTitleHeavy: '大型装配体 — GPU/内存占用可能显著增加。',
        assemblyLoadBadgeExtreme: '超大', assemblyLoadTitleExtreme: '零件非常多 — 已自动使用较低细节 LOD。',
        directEditNavHint: '手柄：左键拖动 · 旋转：滚轮拖动 · 平移：右键拖动' },
  es: { drop: 'Suelte archivo CAD aquí', material: 'Vista Previa Material', turntable: 'Animación Giratoria',
        front: 'Frente', right: 'Derecha', top: 'Superior', fitAll: 'Ajustar Todo', fit: 'Ajustar',
        snapOn: 'AJUSTE ON', pickShape: 'Elegir Forma', startSketch: 'Iniciar Boceto', aiChat: 'Chat IA',
        selectFace: 'Seleccionar Cara', selectOn: 'Seleccion ON',
        shapeLibraryTitle: 'Biblioteca de formas', aiChatTitle: 'Chat IA',
        emptyTagline: 'CAD 3D en el navegador — elige una plantilla o empieza a dibujar',
        sketchEmptyPreviewHint: 'Cierra el perfil y extruye para ver la vista previa 3D aquí',
        shortcutsHint: 'Pulsa ? para ver atajos de teclado',
        solid: 'Sólido', edgeMode: 'Aristas', wire: 'Alámbrico', iso: 'Iso', resetCamera: 'Ajustar vista', dimensions: 'Cotas', fullscreenIn: 'Pantalla completa', fullscreenOut: 'Salir',
        preview3d: 'Vista 3D', editMode: 'Edición', assemblyShort: 'Ensamblaje', viewWhenNoModel: 'Disponible cuando haya modelo 3D',
        assemblyLoadBadgeLight: 'Carga↑', assemblyLoadTitleLight: 'Más piezas aumentan poco a poco el coste de render.',
        assemblyLoadBadgeWarn: 'Muchas piezas', assemblyLoadTitleWarn: 'Muchas piezas pueden aumentar la carga del navegador.',
        assemblyLoadBadgeHeavy: 'Gran ens.', assemblyLoadTitleHeavy: 'Ensamblaje grande: mayor uso de GPU/memoria.',
        assemblyLoadBadgeExtreme: 'XL', assemblyLoadTitleExtreme: 'Ensamblaje muy grande — LOD bajo automático.',
        directEditNavHint: 'Manijas: arrastre izq. · Órbita: botón central · Pan: derecho' },
  ar: { drop: 'أسقط ملف CAD هنا', material: 'معاينة المواد', turntable: 'رسوم متحركة دوارة',
        front: 'أمام', right: 'يمين', top: 'أعلى', fitAll: 'ملاءمة الكل', fit: 'ملاءمة',
        snapOn: 'الالتقاط مفعّل', pickShape: 'اختر شكلاً', startSketch: 'بدء الرسم', aiChat: 'دردشة AI',
        selectFace: 'Select Face', selectOn: 'Select ON',
        shapeLibraryTitle: 'مكتبة الأشكال', aiChatTitle: 'دردشة AI',
        emptyTagline: 'CAD ثلاثي الأبعاد في المتصفح — اختر قالباً أو ابدأ بالرسم',
        sketchEmptyPreviewHint: 'أغلق الملف الشخصي وابثق لعرض المعاينة ثلاثية الأبعاد هنا',
        shortcutsHint: 'اضغط ? لعرض اختصارات لوحة المفاتيح',
        solid: 'صلب', edgeMode: 'حواف', wire: 'إطار', iso: 'متساوٍ', resetCamera: 'ضبط العرض', dimensions: 'أبعاد', fullscreenIn: 'ملء الشاشة', fullscreenOut: 'خروج',
        preview3d: 'معاينة 3D', editMode: 'تحرير', assemblyShort: 'تجميع', viewWhenNoModel: 'يُتاح عند ظهور نموذج ثلاثي الأبعاد',
        assemblyLoadBadgeLight: 'حمل↑', assemblyLoadTitleLight: 'يزداد عبء الرسم تدريجياً مع ازدياد القطع.',
        assemblyLoadBadgeWarn: 'قطع كثيرة', assemblyLoadTitleWarn: 'قد تزداد أعباء المتصفح مع عدد كبير من القطع.',
        assemblyLoadBadgeHeavy: 'كبير', assemblyLoadTitleHeavy: 'تجميع كبير — قد يرتفع استخدام GPU/الذاكرة.',
        assemblyLoadBadgeExtreme: 'ضخم', assemblyLoadTitleExtreme: 'عدد قطع كبير جداً — يتم تطبيق LOD أقل تلقائياً.',
        directEditNavHint: 'المقابض: سحب يسار · المدار: زر العجلة · التحريك: يمين' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export default function ShapePreview({
  result, bomParts, highlightedPartId, assemblyLabel, onCapture, editMode = 'none', onDragStateChange,
  showDimensions = false, measureActive = false, measureMode = 'distance', sectionActive = false,
  sectionAxis = 'y', sectionOffset = 0.5, showPlanes = false, constructPlanes,
  transformMode = 'off', onTransformChange, snapGrid, unitSystem = 'mm',
  showPerf = false, materialId, collabUsers,
  showPrintAnalysis = false, printAnalysis = null,
  printBuildDirection = [0, 1, 0], printOverhangAngle = 45,
  renderMode = 'standard', renderSettings, onCaptureScreenshot: _onCaptureScreenshot,
  explodeFactor = 0, interferenceHighlights,
  showFEA = false, feaResult = null,
  feaDisplayMode = 'stress', feaDeformationScale = 100,
  feaConditions, feaHighlightedConditionIdx = null, onFEAConditionClick,
  showDFM = false, dfmResults = null, dfmHighlightedIssue = null,
  showDraftAnalysis = false, draftResult = null, draftMinDeg = 3,
  showCenterOfMass,
  gdtAnnotations, dimensionAnnotations,
  onSceneReady,
  arrayPattern = null, showArray = false,
  onCameraPlaneChange,
  sketchPlane, onSketchPlaneChange,
  onOpenLibrary, onStartSketch, onOpenChat,
  pinComments, isPlacingComment = false, focusedPinCommentId, onAddPinComment, onResolvePinComment, onDeletePinComment, onReactPinComment, onReplyPinComment, pinCommentRoomUsers, pinCommentCurrentUserId,
  onGeometryApply,
  onFaceSketch,
  onDimClick,
  lang = 'ko',
  onFileImport,
  snapEnabled: _snapEnabled = false,
  ghostResult = null,
  animateMode = 'none',
  motionPartTransforms = null,
  nurbsCPEdit = false,
  nurbsCPParams,
  onNurbsCPParamChange,
  onElementSelect,
  selectionActive = false,
  highlightTriangles,
  assemblyMates,
  isSketchMode = false,
  faceEditViewportCallout,
  faceEditViewportCalloutTitle,
  faceEditViewportCalloutTip,
  faceEditCalloutDismiss,
  blockAutomaticGeometryFit = false,
  projectCameraToApply = null,
  onProjectCameraApplied,
  onViewportCameraCommit,
  onGeometryFitRequest,
  onMaterialDrop,
  onRadialCommand,
  isKinematicsMode = false,
  onStandardPartDrop,
  onToggleSelection,
}: ShapePreviewProps) {
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [kinematicTransforms, setKinematicTransforms] = useState<Record<string, THREE.Matrix4>>({});
  const [kinematicState, setKinematicState] = useState<AssemblyState | null>(null);
  
  // Build kinematic state when entering mode
  useEffect(() => {
    const isAsm = bomParts && bomParts.length > 0;
    if (isKinematicsMode && isAsm && bomParts) {
      setKinematicState(bomPartResultsAndAssemblyMatesToSolverState(bomParts, assemblyMates || []));
      setKinematicTransforms({});
    }
  }, [isKinematicsMode, bomParts, assemblyMates]);

  const handleSolverUpdate = useCallback((bodies: { position: THREE.Vector3; rotation: THREE.Euler }[]) => {
    if (!kinematicState) return;
    const newTransforms: Record<string, THREE.Matrix4> = {};
    bodies.forEach((b, i) => {
      const partName = kinematicState.bodies[i].name;
      const matrix = new THREE.Matrix4().compose(b.position, new THREE.Quaternion().setFromEuler(b.rotation), new THREE.Vector3(1,1,1));
      newTransforms[partName] = matrix;
    });
    setKinematicTransforms(newTransforms);
  }, [kinematicState]);

  const [hitboxes, setHitboxes] = useState<THREE.Object3D[]>([]);
  const hitboxesGroupRef = useRef<THREE.Group>(null);
  useEffect(() => {
    if (isKinematicsMode && hitboxesGroupRef.current) {
      const meshes: THREE.Object3D[] = [];
      hitboxesGroupRef.current.traverse(c => {
        if (c.type === 'Mesh') meshes.push(c);
      });
      setHitboxes(meshes);
    }
  }, [isKinematicsMode, bomParts]);

  // Combine motionPartTransforms with kinematicTransforms
  const effectiveMotionTransforms = useMemo(() => {
    if (!motionPartTransforms && Object.keys(kinematicTransforms).length === 0) return null;
    return { ...(motionPartTransforms || {}), ...kinematicTransforms };
  }, [motionPartTransforms, kinematicTransforms]);

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('solid');
  const [fitKey, setFitKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [internalAnimateMode, setInternalAnimateMode] = useState<'none' | 'turntable'>('none');
  const effectiveAnimateMode = animateMode !== 'none' ? animateMode : internalAnimateMode;
  const [showDims, setShowDims] = useState(showDimensions);

  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── drag-drop import handler ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    const hasFile = e.dataTransfer.types.includes('Files');
    const hasText = e.dataTransfer.types.includes('text/plain');
    if ((hasFile && onFileImport) || (hasText && onMaterialDrop)) {
      e.preventDefault();
      setIsDragOver(true);
    }
  }, [onFileImport, onMaterialDrop]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // #14: always clear overlay first, even if import throws
    setIsDragOver(false);

    const draggedMatId = e.dataTransfer.getData('text/plain');
    if (draggedMatId && onMaterialDrop) {
      onMaterialDrop(draggedMatId);
      return;
    }

    if (!onFileImport) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      onFileImport(file);
    } catch {
      // overlay already cleared above; caller is responsible for error toast
    }
  }, [onFileImport, onMaterialDrop]);

  // ── dispatch standard view event ──
  const dispatchView = useCallback((view: string) => {
    window.dispatchEvent(new CustomEvent('nexyfab:view', { detail: view }));
  }, []);

  // PBR material override state
  const [pbrPanelOpen, setPbrPanelOpen] = useState(false);
  const [materialOverride, setMaterialOverride] = useState<MaterialOverride>({});
  const [envPreset, setEnvPreset] = useState<EnvPreset>('city');

  // Edge context panel state (for fillet/chamfer on selected edges — multi-select)
  const [selectedEdgesForPanel, setSelectedEdgesForPanel] = useState<import('./editing/types').UniqueEdge[]>([]);
  const selectedEdgeIdsForPanel = useMemo(() => new Set(selectedEdgesForPanel.map(e => e.id)), [selectedEdgesForPanel]);

  const handleEdgeSelect = useCallback((edge: import('./editing/types').UniqueEdge, additive: boolean) => {
    setSelectedEdgesForPanel(prev => {
      if (!additive) return [edge];
      const already = prev.some(e => e.id === edge.id);
      if (already) return prev.filter(e => e.id !== edge.id); // toggle off
      return [...prev, edge];
    });
  }, []);

  // Prevent page scroll when mouse wheel is used inside the 3D viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => e.stopPropagation();
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const activeMaterial = useMemo(() => materialId ? getMaterialPreset(materialId) : undefined, [materialId]);

  // Effective material = preset + user overrides from PBR panel
  const effectiveMaterial = useMemo(() => {
    if (!activeMaterial && Object.keys(materialOverride).length === 0) return undefined;
    return { ...activeMaterial, ...materialOverride } as typeof activeMaterial;
  }, [activeMaterial, materialOverride]);

  // Reset overrides when preset changes
  useEffect(() => {
    if (activeMaterial) {
      setMaterialOverride({
        color: activeMaterial.color,
        metalness: activeMaterial.metalness,
        roughness: activeMaterial.roughness,
        envMapIntensity: activeMaterial.envMapIntensity ?? 1,
      });
    }
  }, [materialId]); // eslint-disable-line react-hooks/exhaustive-deps

  const isAssembly = bomParts && bomParts.length > 0;

  const assemblyViewportBand = useMemo(
    () => (isAssembly && bomParts?.length ? assemblyViewportLoadBand(bomParts.length) : 'normal'),
    [isAssembly, bomParts?.length],
  );
  const assemblyLoadChrome = useMemo(
    () => assemblyViewportChrome(assemblyViewportBand, t),
    [assemblyViewportBand, t],
  );

  /** Align with M7 policy: simplify viewport meshes when part count is high (same thresholds as load badge). */
  const preferAssemblyLowLod =
    assemblyViewportBand === 'warn' ||
    assemblyViewportBand === 'heavy' ||
    assemblyViewportBand === 'extreme';

  const allResults = useMemo(() => {
    if (isAssembly && bomParts?.length) return bomParts.map(p => p.result);
    if (result) return [result];
    return EMPTY_SHAPE_RESULTS;
  }, [isAssembly, bomParts, result]);

  /** Bump camera fit only when mesh data identity changes, not when parent re-wraps `result`. */
  const geometryFitToken = useMemo(() => {
    if (isAssembly && bomParts?.length) {
      return bomParts.map((p, i) => `${i}:${p.result.geometry.uuid}`).join('|');
    }
    if (result?.geometry) return result.geometry.uuid;
    return '';
  }, [isAssembly, bomParts, result?.geometry]);

  const hasContent = allResults.length > 0;
  const isEditing = editMode !== 'none' && result && !isAssembly;
  const isTransforming = transformMode !== 'off' && result && !isAssembly && !isEditing;

  // Exploded view offsets
  const explodedOffsets = useMemo(() => {
    if (!isAssembly || explodeFactor <= 0) return null;
    const partsInput = bomParts.map((p, i) => {
      const mat = new THREE.Matrix4();
      if (p.rotation) {
        const rot = p.rotation.map(d => d * Math.PI / 180) as [number, number, number];
        mat.makeRotationFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
      }
      if (p.position) {
        const t = new THREE.Matrix4().makeTranslation(...p.position);
        mat.premultiply(t);
      }
      return { id: p.name || `part_${i}`, geometry: p.result.geometry, transform: mat };
    });
    return computeExplodedPositions(partsInput, explodeFactor);
  }, [isAssembly, bomParts, explodeFactor]);

  /** Union world-space AABB (shared util with MultiViewport section view). */
  const assemblySectionBounds = useMemo(() => {
    if (!isAssembly || !bomParts?.length) return null;
    return computeAssemblyWorldBounds(bomParts, explodeFactor);
  }, [isAssembly, bomParts, explodeFactor]);

  const prevGeometryFitToken = useRef<string | null>(null);
  useEffect(() => {
    if (!geometryFitToken) {
      prevGeometryFitToken.current = null;
      return;
    }
    if (prevGeometryFitToken.current === geometryFitToken) return;
    prevGeometryFitToken.current = geometryFitToken;
    setFitKey(k => k + 1);
  }, [geometryFitToken]);

  useEffect(() => {
    if (onCapture) {
      onCapture(() => {
        if (!canvasRef.current) return null;
        return canvasRef.current.toDataURL('image/png');
      });
    }
  }, [onCapture, result, bomParts]);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  };

  const bottomY = useMemo(() => {
    if (allResults.length === 0) return 0;
    let minY = Infinity;
    for (const r of allResults) {
      r.geometry.computeBoundingBox();
      const y = r.geometry.boundingBox?.min.y ?? 0;
      if (y < minY) minY = y;
    }
    return minY === Infinity ? 0 : minY;
  }, [allResults]);

  // Combined stats
  const stats = useMemo(() => {
    if (allResults.length === 0) return null;
    const totalVol = allResults.reduce((s, r) => s + r.volume_cm3, 0);
    const totalSA = allResults.reduce((s, r) => s + r.surface_area_cm2, 0);
    const combined = new THREE.Box3();
    for (const r of allResults) {
      r.geometry.computeBoundingBox();
      if (r.geometry.boundingBox) combined.union(r.geometry.boundingBox);
    }
    const size = combined.getSize(new THREE.Vector3());
    return { vol: totalVol, sa: totalSA, w: size.x, h: size.y, d: size.z };
  }, [allResults]);

  // Total triangle count across all displayed geometries (for the overlay badge)
  const totalTriCount = useMemo(() => {
    let sum = 0;
    for (const r of allResults) {
      const geo = r.geometry;
      const count = geo.index
        ? Math.floor(geo.index.count / 3)
        : Math.floor((geo.attributes.position?.count ?? 0) / 3);
      sum += count;
    }
    return sum;
  }, [allResults]);

  const handleOrbitStart = useCallback(() => setIsOrbiting(true), []);
  const handleOrbitEnd = useCallback(() => setIsOrbiting(false), []);

  // ── Radial Marking Menu State ──────────────────────────────────────────────
  const [radialMenu, setRadialMenu] = useState<{ x: number, y: number } | null>(null);
  const [radialScale, setRadialScale] = useState(0);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (e.type === 'contextmenu') return; // let the specific handler manage this
      setRadialMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setRadialMenu({ x: e.clientX, y: e.clientY });
    setRadialScale(0);
    requestAnimationFrame(() => requestAnimationFrame(() => setRadialScale(1)));
  }, []);

  const viewChromeDisabled = !hasContent;

  const MODES: { key: DisplayMode; label: string; icon: string }[] = [
    { key: 'solid', label: t.solid, icon: '⬛' },
    { key: 'edges', label: t.edgeMode, icon: '◻' },
    { key: 'wireframe', label: t.wire, icon: '⬡' },
  ];

  return (
    <>
      <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0d1117', borderRadius: 'inherit', overflow: 'hidden', touchAction: 'none', userSelect: 'none', position: 'relative' }}
        onDragStart={e => e.preventDefault()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={handleContextMenu}>

        {/* ── Radial Marking Menu Overlay ── */}
        {radialMenu && (
          <div style={{ position: 'fixed', top: radialMenu.y, left: radialMenu.x, zIndex: 99999, pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', transform: `translate(-50%, -50%) scale(${radialScale})`, pointerEvents: 'auto', transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)', transformOrigin: 'center center' }}>
              {/* Center Circle */}
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(36,41,47,0.95)', border: '1px solid #484f58', boxShadow: '0 8px 24px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => setRadialMenu(null)}>
                <span style={{ fontSize: 16, color: '#c9d1d9' }}>✕</span>
              </div>
              
              {/* Top Item */}
              <div style={{ position: 'absolute', top: -56, left: '50%', transform: 'translateX(-50%)' }}>
                <button onClick={() => { 
                  if (onRadialCommand) onRadialCommand(isSketchMode ? 'sketch_line' : 'extrude'); 
                  else { onGeometryFitRequest?.(); setFitKey(k => k + 1); }
                  setRadialMenu(null); 
                }} style={{ padding: '8px 16px', borderRadius: 24, border: '1px solid #484f58', background: 'rgba(36,41,47,0.95)', color: '#e6edf3', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 6px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap', transition: 'all 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = '#30363d'} onMouseLeave={e => e.currentTarget.style.background = 'rgba(36,41,47,0.95)'}>
                  {isSketchMode ? '↗ Line' : '⏫ Extrude'}
                </button>
              </div>

              {/* Bottom Item */}
              <div style={{ position: 'absolute', bottom: -56, left: '50%', transform: 'translateX(-50%)' }}>
                <button onClick={() => { 
                  if (onRadialCommand) onRadialCommand(isSketchMode ? 'sketch_circle' : 'fillet'); 
                  else dispatchView('iso');
                  setRadialMenu(null); 
                }} style={{ padding: '8px 16px', borderRadius: 24, border: '1px solid #484f58', background: 'rgba(36,41,47,0.95)', color: '#e6edf3', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 6px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap', transition: 'all 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = '#30363d'} onMouseLeave={e => e.currentTarget.style.background = 'rgba(36,41,47,0.95)'}>
                  {isSketchMode ? '⭕ Circle' : '🔘 Fillet'}
                </button>
              </div>

              {/* Left Item */}
              <div style={{ position: 'absolute', top: '50%', left: -90, transform: 'translateY(-50%)' }}>
                <button onClick={() => { 
                  if (onRadialCommand) onRadialCommand(isSketchMode ? 'sketch_finish' : 'cancel'); 
                  else setDisplayMode('wireframe');
                  setRadialMenu(null); 
                }} style={{ padding: '8px 16px', borderRadius: 24, border: '1px solid #484f58', background: 'rgba(36,41,47,0.95)', color: '#f85149', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 6px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap', transition: 'all 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = '#30363d'} onMouseLeave={e => e.currentTarget.style.background = 'rgba(36,41,47,0.95)'}>
                  {isSketchMode ? '✅ Finish' : '❌ Cancel'}
                </button>
              </div>

              {/* Right Item */}
              <div style={{ position: 'absolute', top: '50%', right: -90, transform: 'translateY(-50%)' }}>
                <button onClick={() => { 
                  if (onRadialCommand) onRadialCommand(isSketchMode ? 'sketch_rect' : 'sketch_start'); 
                  else setDisplayMode('solid');
                  setRadialMenu(null); 
                }} style={{ padding: '8px 16px', borderRadius: 24, border: '1px solid #484f58', background: 'rgba(36,41,47,0.95)', color: '#3fb950', fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 6px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap', transition: 'all 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = '#30363d'} onMouseLeave={e => e.currentTarget.style.background = 'rgba(36,41,47,0.95)'}>
                  {isSketchMode ? '▱ Rect' : '✏️ Sketch'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Drag-over drop zone overlay */}
        {isDragOver && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 500,
            background: 'rgba(56,139,253,0.12)',
            border: '2px dashed #388bfd',
            borderRadius: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}>
            <div style={{
              background: '#161b22ee', borderRadius: 12, padding: '20px 32px',
              border: '1px solid #388bfd',
              color: '#58a6ff', fontSize: 16, fontWeight: 700,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 32 }}>📂</span>
              <span>{t.drop}</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>STEP · STL · OBJ · PLY · DXF</span>
            </div>
          </div>
        )}

        {/* Fusion 360-style Top Left Info */}
        <div style={{ position: 'absolute', top: 16, left: 16, zIndex: 10, pointerEvents: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ color: '#ffffff', fontSize: 13, fontWeight: 700, textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}>
            {isEditing ? (
              <><span style={{ color: '#22c55e' }}>● </span>{t.editMode}: {editMode}</>
            ) : isAssembly ? (
              <>{assemblyLabel || t.assemblyShort}{' '}
                <span data-testid="assembly-bom-count" style={{ color: '#58a6ff', fontSize: 11 }}>({bomParts!.length})</span>
              </>
            ) : t.preview3d}
          </span>
          {isAssembly && assemblyLoadChrome && (
            <span
              data-testid="assembly-viewport-load-badge"
              title={assemblyLoadChrome.title}
              style={{
                pointerEvents: 'auto',
                alignSelf: 'flex-start',
                padding: '2px 8px',
                borderRadius: 6,
                fontSize: 10,
                fontWeight: 700,
                color: '#ffffff',
                background: assemblyLoadChrome.color,
                border: '1px solid rgba(0,0,0,0.12)',
                cursor: 'help',
                maxWidth: 280,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {assemblyLoadChrome.badge}
            </span>
          )}
        </div>

        {/* Fusion 360-style Top Right ViewCube */}
        <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, background: 'rgba(13,17,23,0.85)', padding: 4, borderRadius: 8, border: '1px solid #30363d', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}>
            {([
              { label: t.top, key: '7', view: 'top' },
              { label: t.front, key: '5', view: 'front' },
              { label: t.right, key: '6', view: 'right' },
              { label: t.iso, key: '0', view: 'iso' },
            ] satisfies { label: string; key: string; view: 'top' | 'front' | 'right' | 'iso' }[]).map(({ label, key, view }) => (
              <button
                key={view} type="button" disabled={viewChromeDisabled}
                onClick={() => { if (!viewChromeDisabled) dispatchView(view); }}
                title={viewChromeDisabled ? t.viewWhenNoModel : `${label} [${key}]`}
                style={{
                  padding: '6px 8px', borderRadius: 4, border: 'none', background: 'transparent', color: '#ffffff',
                  fontSize: 11, fontWeight: 700, cursor: viewChromeDisabled ? 'not-allowed' : 'pointer',
                  opacity: viewChromeDisabled ? 0.45 : 1, transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => { if (!viewChromeDisabled) e.currentTarget.style.background = 'rgba(56,139,253,0.15)'; e.currentTarget.style.color = '#58a6ff'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ffffff'; }}
              >
                {label}
              </button>
            ))}
            <button
              type="button" disabled={viewChromeDisabled}
              onClick={() => { if (!viewChromeDisabled) { onGeometryFitRequest?.(); setFitKey(k => k + 1); } }}
              title={viewChromeDisabled ? t.viewWhenNoModel : `${t.fitAll} [F]`}
              style={{
                padding: '6px 8px', borderRadius: 4, border: 'none', background: 'transparent', color: '#ffffff',
                fontSize: 11, fontWeight: 700, cursor: viewChromeDisabled ? 'not-allowed' : 'pointer',
                opacity: viewChromeDisabled ? 0.45 : 1, transition: 'all 0.15s', gridColumn: 'span 2', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { if (!viewChromeDisabled) e.currentTarget.style.background = 'rgba(56,139,253,0.15)'; e.currentTarget.style.color = '#58a6ff'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ffffff'; }}
            >
              {t.fit}
            </button>
          </div>
        </div>

        {/* Fusion 360-style Bottom Center Navigation Bar */}
        <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(13,17,23,0.85)', padding: '4px 6px', borderRadius: 12, border: '1px solid #30363d', boxShadow: '0 4px 16px rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', flexWrap: 'nowrap' }}>
          <div style={{ display: 'flex', gap: 2, flexWrap: 'nowrap' }}>
            {MODES.map(({ key, label, icon }) => (
              <button
                key={key} type="button" disabled={viewChromeDisabled}
                onClick={() => { if (!viewChromeDisabled) setDisplayMode(key); }}
                title={viewChromeDisabled ? t.viewWhenNoModel : label}
                style={{
                  padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  cursor: viewChromeDisabled ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
                  background: displayMode === key ? 'rgba(56,139,253,0.15)' : 'transparent',
                  color: displayMode === key ? '#58a6ff' : '#ffffff',
                  border: displayMode === key ? '1px solid rgba(56,139,253,0.3)' : '1px solid transparent',
                  display: 'flex', alignItems: 'center', gap: 4, opacity: viewChromeDisabled ? 0.45 : 1,
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
                onMouseEnter={e => { if (displayMode !== key) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; } }}
                onMouseLeave={e => { if (displayMode !== key) { e.currentTarget.style.background = 'transparent'; } }}
              >
                <span style={{ fontSize: 12 }}>{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div style={{ width: 1, height: 16, background: '#30363d', margin: '0 2px' }} />
          <div style={{ display: 'flex', gap: 2, flexWrap: 'nowrap' }}>
            {onToggleSelection && (
              <button
                type="button" disabled={viewChromeDisabled}
                onClick={() => { if (!viewChromeDisabled) onToggleSelection(); }}
                title={viewChromeDisabled ? t.viewWhenNoModel : (selectionActive ? t.selectOn : t.selectFace)}
                style={{
                  padding: '4px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  cursor: viewChromeDisabled ? 'not-allowed' : 'pointer', transition: 'all 0.15s',
                  background: selectionActive ? 'rgba(34,197,94,0.15)' : 'transparent',
                  color: selectionActive ? '#4ade80' : '#ffffff',
                  border: selectionActive ? '1px solid rgba(34,197,94,0.3)' : '1px solid transparent',
                  display: 'flex', alignItems: 'center', gap: 4, opacity: viewChromeDisabled ? 0.45 : 1,
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}
                onMouseEnter={e => { if (!selectionActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; } }}
                onMouseLeave={e => { if (!selectionActive) { e.currentTarget.style.background = 'transparent'; } }}
              >
                <span style={{ fontSize: 12 }}>🖱</span>
                <span>{selectionActive ? t.selectOn : t.selectFace}</span>
              </button>
            )}
            <button
              type="button" disabled={viewChromeDisabled}
              onClick={() => { if (!viewChromeDisabled) setPbrPanelOpen(v => !v); }}
              title={viewChromeDisabled ? t.viewWhenNoModel : t.material}
              style={{
                padding: '4px 8px', borderRadius: 8, border: '1px solid transparent',
                background: pbrPanelOpen ? 'rgba(217,119,6,0.15)' : 'transparent',
                borderColor: pbrPanelOpen ? 'rgba(217,119,6,0.3)' : 'transparent',
                color: pbrPanelOpen ? '#f59e0b' : '#ffffff', fontSize: 13, cursor: viewChromeDisabled ? 'not-allowed' : 'pointer',
                opacity: viewChromeDisabled ? 0.45 : 1, transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
              }}
              onMouseEnter={e => { if (!viewChromeDisabled && !pbrPanelOpen) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={e => { if (!viewChromeDisabled && !pbrPanelOpen) e.currentTarget.style.background = 'transparent'; }}
            >🎨</button>
            <button
              type="button" disabled={viewChromeDisabled}
              onClick={() => { if (!viewChromeDisabled) setShowDims(d => !d); }}
              title={viewChromeDisabled ? t.viewWhenNoModel : t.dimensions}
              style={{
                padding: '4px 8px', borderRadius: 8, border: '1px solid transparent',
                background: showDims ? 'rgba(56,139,253,0.15)' : 'transparent',
                borderColor: showDims ? 'rgba(56,139,253,0.3)' : 'transparent',
                color: showDims ? '#58a6ff' : '#ffffff', fontSize: 12, cursor: viewChromeDisabled ? 'not-allowed' : 'pointer',
                opacity: viewChromeDisabled ? 0.45 : 1, transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
              }}
              onMouseEnter={e => { if (!viewChromeDisabled && !showDims) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={e => { if (!viewChromeDisabled && !showDims) e.currentTarget.style.background = 'transparent'; }}
            >📏</button>
            <button
              type="button" disabled={viewChromeDisabled}
              onClick={() => { if (!viewChromeDisabled) setInternalAnimateMode(m => m === 'turntable' ? 'none' : 'turntable'); }}
              title={viewChromeDisabled ? t.viewWhenNoModel : t.turntable}
              style={{
                padding: '4px 8px', borderRadius: 8, border: '1px solid transparent',
                background: effectiveAnimateMode === 'turntable' ? 'rgba(124,58,237,0.15)' : 'transparent',
                borderColor: effectiveAnimateMode === 'turntable' ? 'rgba(124,58,237,0.3)' : 'transparent',
                color: effectiveAnimateMode === 'turntable' ? '#a78bfa' : '#ffffff', fontSize: 14, cursor: viewChromeDisabled ? 'not-allowed' : 'pointer',
                opacity: viewChromeDisabled ? 0.45 : 1, transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
              }}
              onMouseEnter={e => { if (!viewChromeDisabled && effectiveAnimateMode !== 'turntable') e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={e => { if (!viewChromeDisabled && effectiveAnimateMode !== 'turntable') e.currentTarget.style.background = 'transparent'; }}
            >⟲</button>
            <button
              type="button" onClick={toggleFullscreen} title={isFullscreen ? t.fullscreenOut : t.fullscreenIn}
              style={{ padding: '4px 8px', borderRadius: 8, border: 'none', background: 'transparent', color: '#ffffff', fontSize: 12, cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0 }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {isFullscreen ? '⊡' : '⛶'}
            </button>
          </div>
        </div>

        {/* PBR Material Properties Panel */}
        {pbrPanelOpen && (
          <MaterialPropertiesPanel
            override={materialOverride}
            onOverrideChange={setMaterialOverride}
            envPreset={envPreset}
            onEnvPresetChange={setEnvPreset}
            presetName={activeMaterial ? (lang === 'ko' ? activeMaterial.name.ko : activeMaterial.name.en) : undefined}
            onReset={() => {
              if (activeMaterial) {
                setMaterialOverride({
                  color: activeMaterial.color,
                  metalness: activeMaterial.metalness,
                  roughness: activeMaterial.roughness,
                  envMapIntensity: activeMaterial.envMapIntensity ?? 1,
                });
              } else {
                setMaterialOverride({});
              }
            }}
            lang={lang}
          />
        )}

        {/* Canvas */}
        <div style={{ flex: 1, position: 'relative', minHeight: 0, touchAction: 'none' }}
          onMouseDown={e => e.preventDefault()}
          onWheel={e => e.stopPropagation()}>

          {/* Edge context panel (fillet/chamfer — multi-select) */}
          {editMode === 'edge' && selectedEdgesForPanel.length > 0 && result && (
            <EdgeContextPanel
              selectedEdges={selectedEdgesForPanel}
              geometry={result.geometry}
              lang={lang}
              onApplyFillet={(radius, segments) => {
                import('./features/fillet').then(({ filletFeature }) => {
                  try {
                    const newGeo = filletFeature.apply(result.geometry, { radius, segments });
                    onGeometryApply?.(newGeo);
                  } catch { /* ignore */ }
                });
                setSelectedEdgesForPanel([]);
              }}
              onApplyChamfer={(distance) => {
                import('./features/chamfer').then(({ chamferFeature }) => {
                  try {
                    const newGeo = chamferFeature.apply(result.geometry, { distance });
                    onGeometryApply?.(newGeo);
                  } catch { /* ignore */ }
                });
                setSelectedEdgesForPanel([]);
              }}
              onClose={() => setSelectedEdgesForPanel([])}
              onClearSelection={() => setSelectedEdgesForPanel([])}
            />
          )}

          {/* Sketch plane selector overlay */}
          {onSketchPlaneChange && sketchPlane && (
            <div style={{
              position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
              zIndex: 20, display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(13,17,23,0.85)', borderRadius: 10,
              border: '1px solid #30363d', padding: '4px 10px',
              backdropFilter: 'blur(8px)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', flexWrap: 'nowrap'
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#ffffff', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>
                {lang === 'ko' ? '스케치 평면' : 'Sketch Plane'}
              </span>
              <div style={{ width: 1, height: 14, background: '#30363d' }} />
              <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
                {(['xy', 'xz', 'yz'] as const).map(p => (
                  <button key={p} onClick={() => onSketchPlaneChange(p)} style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 800, cursor: 'pointer',
                    border: sketchPlane === p ? '1px solid rgba(124,58,237,0.4)' : '1px solid transparent',
                    background: sketchPlane === p ? 'rgba(124,58,237,0.2)' : 'transparent',
                    color: sketchPlane === p ? '#a78bfa' : '#ffffff',
                    transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
                  }}
                  onMouseEnter={e => { if (sketchPlane !== p) { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; } }}
                  onMouseLeave={e => { if (sketchPlane !== p) { e.currentTarget.style.background = 'transparent'; } }}
                  >
                    {p.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!hasContent ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '32px', padding: '24px' }}>
              {/* Logo / Title */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '8px' }}>
                  <svg width="36" height="36" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect width="64" height="64" rx="14" fill="#0d1117"/>
                    <text x="10" y="50" fontFamily="'Segoe UI', Arial, sans-serif" fontWeight="700" fontSize="46" fill="#388bfd">N</text>
                  </svg>
                  <span style={{ fontSize: '22px', fontWeight: 700, color: '#e6edf3', letterSpacing: '-0.3px' }}>NexyFab</span>
                </div>
                <p style={{
                  color: '#9ca3af',
                  fontSize: '13px',
                  margin: 0,
                  width: '100%',
                  maxWidth: 320,
                  lineHeight: 1.55,
                  wordBreak: 'keep-all',
                  overflowWrap: 'break-word',
                }}>
                  {isSketchMode ? t.sketchEmptyPreviewHint : t.emptyTagline}
                </p>
              </div>

              {/* Action buttons — hide "start sketch" while already in sketch (left canvas is the sketch surface) */}
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={onOpenLibrary}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                    width: '140px', padding: '20px 12px', borderRadius: '12px',
                    border: '1px solid #30363d', background: '#161b22',
                    color: '#e6edf3', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#388bfd'; (e.currentTarget as HTMLButtonElement).style.background = '#1c2333'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d'; (e.currentTarget as HTMLButtonElement).style.background = '#161b22'; }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#388bfd" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                  </svg>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{t.shapeLibraryTitle}</div>
                    <div style={{ fontSize: '11px', color: '#6e7681', marginTop: '3px' }}>{t.pickShape}</div>
                  </div>
                </button>

                {!isSketchMode && (
                  <button
                    type="button"
                    onClick={onStartSketch}
                    style={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                      width: '140px', padding: '20px 12px', borderRadius: '12px',
                      border: '1px solid #30363d', background: '#161b22',
                      color: '#e6edf3', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#3fb950'; (e.currentTarget as HTMLButtonElement).style.background = '#1c2333'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d'; (e.currentTarget as HTMLButtonElement).style.background = '#161b22'; }}
                  >
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                    </svg>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{t.startSketch}</div>
                    </div>
                  </button>
                )}

                <button
                  type="button"
                  onClick={onOpenChat}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px',
                    width: '140px', padding: '20px 12px', borderRadius: '12px',
                    border: '1px solid #30363d', background: '#161b22',
                    color: '#e6edf3', cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#a371f7'; (e.currentTarget as HTMLButtonElement).style.background = '#1c2333'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = '#30363d'; (e.currentTarget as HTMLButtonElement).style.background = '#161b22'; }}
                >
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a371f7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{t.aiChatTitle}</div>
                    <div style={{ fontSize: '11px', color: '#6e7681', marginTop: '3px' }}>{t.aiChat}</div>
                  </div>
                </button>
              </div>

              <p style={{ color: '#484f58', fontSize: '11px', margin: 0 }}>{t.shortcutsHint}</p>
            </div>
          ) : (
            <>
            <ErrorBoundary
              onError={(error) => {
                console.error('[ShapePreview] 3D Canvas error:', error.message, error.stack);
              }}
            >
            <Canvas
              camera={{ position: [150, 120, 150], fov: 50, near: 0.05, far: 2_000_000 }}
              shadows
              gl={{ antialias: true, preserveDrawingBuffer: true }}
              onCreated={({ gl, scene }) => {
                gl.domElement.setAttribute('data-engine', NF_R3F_VIEWPORT_DATA_ENGINE);
                canvasRef.current = gl.domElement;
                onSceneReady?.(scene);
              }}
              style={{ width: '100%', height: '100%' }}
            >
              <SceneCleanup />
              {!viewChromeDisabled && (
                <GizmoHelper alignment="bottom-left" margin={[80, 80]}>
                  <GizmoViewport axisColors={['#ff3b30', '#34c759', '#007aff']} labelColor="white" hideNegativeAxes />
                </GizmoHelper>
              )}
              <color attach="background" args={['#0d1117']} />
              {renderMode === 'photorealistic' && renderSettings ? (
                <Suspense fallback={null}>
                  <RenderMode
                    environment={renderSettings.environment}
                    showBackground={renderSettings.showBackground}
                    shadowIntensity={renderSettings.shadowIntensity}
                    bloomIntensity={renderSettings.bloomIntensity}
                    showGround={renderSettings.showGround}
                    exposure={renderSettings.exposure}
                    customHdriUrl={renderSettings.customHdriUrl}
                  />
                  {renderSettings.pathTracing && (
                    <PathTracer enabled={true} />
                  )}
                </Suspense>
              ) : (
                <>
                  <hemisphereLight args={['#ffffff', '#f3f4f6', 0.8]} />
                  <ambientLight intensity={0.4} />
                  <directionalLight position={[20, 30, 15]} intensity={1.5} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} />
                  <directionalLight position={[-15, 10, -10]} intensity={0.6} color="#eef2ff" />
                  <pointLight position={[0, 50, 0]} intensity={0.3} color="#ffffff" />
                </>
              )}
              <Suspense fallback={null}>
                {renderMode !== 'photorealistic' && <Environment preset={envPreset} background={false} />}
                <CameraFitter
                  results={allResults}
                  bomParts={isAssembly ? bomParts : undefined}
                  fitKey={fitKey}
                  blockAuto={blockAutomaticGeometryFit}
                />
                <ViewportCameraPersistence enabled={hasContent && !viewChromeDisabled} onCommit={onViewportCameraCommit} />
                {projectCameraToApply && (
                  <ProjectCameraHydrate
                    position={projectCameraToApply.position}
                    target={projectCameraToApply.target}
                    onApplied={() => onProjectCameraApplied?.()}
                  />
                )}

                {isEditing && editMode === 'face' && result ? (
                  <FaceScene
                    sourceGeometry={result.geometry}
                    displayMode={displayMode}
                    onDragStateChange={onDragStateChange}
                    onGeometryApply={onGeometryApply}
                    onFaceSketch={onFaceSketch}
                    emptySelectionCallout={faceEditViewportCallout}
                    emptySelectionCalloutTitle={faceEditViewportCalloutTitle}
                    emptySelectionCalloutTip={faceEditViewportCalloutTip}
                    emptySelectionCalloutDismiss={faceEditCalloutDismiss}
                  />
                ) : isEditing && result ? (
                  <EditScene
                    sourceGeometry={result.geometry}
                    editMode={editMode}
                    displayMode={displayMode}
                    onDragStateChange={onDragStateChange}
                    snapGrid={snapGrid}
                    selectedEdgeIds={selectedEdgeIdsForPanel}
                    onEdgeSelect={handleEdgeSelect}
                  />
                ) : isTransforming && result ? (
                  <TransformScene
                    result={result}
                    displayMode={displayMode}
                    transformMode={transformMode as 'translate' | 'rotate' | 'scale'}
                    onTransformChange={onTransformChange}
                    snapGrid={snapGrid}
                  />
                ) : isAssembly ? (
                  <>
                    {/* Instanced assembly — LOD matches LODShapeMesh when M7 band is warn+ or while orbiting */}
                    {(() => {
                      const groups = new Map<string, { geometry: THREE.BufferGeometry; parts: AssemblyInstancePart[] }>();

                      bomParts.forEach((part, i) => {
                        const partKey = part.name || `part_${i}`;
                        const isHighlighted = highlightedPartId ? (partKey === highlightedPartId || i.toString() === highlightedPartId) : false;
                        const isFaded = highlightedPartId ? !isHighlighted : false;

                        const explodeOffset = explodedOffsets?.get(partKey);
                        const pos: [number, number, number] | undefined = part.position
                          ? [
                              part.position[0] + (explodeOffset?.x ?? 0),
                              part.position[1] + (explodeOffset?.y ?? 0),
                              part.position[2] + (explodeOffset?.z ?? 0),
                            ]
                          : explodeOffset
                            ? [explodeOffset.x, explodeOffset.y, explodeOffset.z]
                            : undefined;

                        const rot = part.rotation ? part.rotation.map(d => d * Math.PI / 180) as [number, number, number] : undefined;

                        const uuid = part.result.geometry.uuid;
                        if (!groups.has(uuid)) {
                          groups.set(uuid, { geometry: part.result.geometry, parts: [] });
                        }
                        groups.get(uuid)!.parts.push({ part, index: i, key: partKey, isHighlighted, isFaded, pos, rot });
                      });

                      return Array.from(groups.values()).map((group, gIdx) => (
                        <AssemblyInstancedGroup
                          key={`${group.geometry.uuid}_${gIdx}`}
                          geometry={group.geometry}
                          parts={group.parts}
                          displayMode={displayMode}
                          isOrbiting={isOrbiting}
                          preferLowDetail={preferAssemblyLowLod}
                          selectionActive={selectionActive}
                          isKinematicsMode={isKinematicsMode}
                          onStandardPartDrop={onStandardPartDrop}
                          onElementSelect={onElementSelect}
                        />
                      ));
                    })()}
                    {/* Interference highlight boxes */}
                    {interferenceHighlights && interferenceHighlights.map((ih, i) => {
                      const center = new THREE.Vector3();
                      ih.boundingBox.getCenter(center);
                      const size = new THREE.Vector3();
                      ih.boundingBox.getSize(size);
                      return (
                        <mesh key={`interference_${i}`} position={[center.x, center.y, center.z]}>
                          <boxGeometry args={[size.x, size.y, size.z]} />
                          <meshStandardMaterial color="#f85149" transparent opacity={0.35} depthWrite={false} side={THREE.DoubleSide} />
                        </mesh>
                      );
                    })}
                    {/* Assembly Mates Visualization */}
                    {assemblyMates && assemblyMates.map((mate) => {
                      const pA = bomParts.find(p => p.name === mate.partA);
                      const pB = bomParts.find(p => p.name === mate.partB);
                      if (!pA || !pB || !pA.position || !pB.position) return null;
                      
                      const ptA = new THREE.Vector3(...pA.position);
                      const ptB = new THREE.Vector3(...pB.position);
                      
                      const offA = explodedOffsets?.get(mate.partA);
                      const offB = explodedOffsets?.get(mate.partB);
                      if (offA) ptA.add(offA);
                      if (offB) ptB.add(offB);

                      const points = [ptA, ptB];
                      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);

                      const colorMap: Record<string, string> = {
                        coincident: '#388bfd',
                        concentric: '#3fb950',
                        distance: '#d29922',
                        angle: '#f85149',
                        parallel: '#a371f7',
                        perpendicular: '#f778ba',
                        tangent: '#2ea043'
                      };

                      return (
                        <group key={mate.id}>
                          <lineSegments geometry={lineGeo}>
                            <lineDashedMaterial color={colorMap[mate.type] || '#8b949e'} dashSize={2} gapSize={1} linewidth={2} />
                          </lineSegments>
                          <mesh position={ptA}>
                            <sphereGeometry args={[0.8, 8, 8]} />
                            <meshBasicMaterial color={colorMap[mate.type] || '#8b949e'} />
                          </mesh>
                          <mesh position={ptB}>
                            <sphereGeometry args={[0.8, 8, 8]} />
                            <meshBasicMaterial color={colorMap[mate.type] || '#8b949e'} />
                          </mesh>
                        </group>
                      );
                    })}
                    {isKinematicsMode && kinematicState && (
                      <KinematicDragManager
                        enabled={true}
                        bomParts={bomParts}
                        assemblyState={kinematicState}
                        onSolverUpdate={handleSolverUpdate}
                        onDragStateChange={(dragging) => onDragStateChange && onDragStateChange(dragging)}
                        hitboxes={hitboxes}
                      />
                    )}
                    {onStandardPartDrop && (
                      <StandardPartDropHandler onDropStandardPart={onStandardPartDrop} hitboxes={hitboxes} />
                    )}
                    <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={1} maxDistance={5000} onStart={handleOrbitStart} onEnd={handleOrbitEnd} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
                    {onCameraPlaneChange && <CameraPlaneDetector onChange={onCameraPlaneChange} />}
                  </>
                ) : (
                  <TurntableGroup active={effectiveAnimateMode === 'turntable'}>
                  <MotionMeshWrapper transforms={effectiveMotionTransforms}>
                  <>
                    {result && !showPrintAnalysis && !showFEA && !showDFM && !showDraftAnalysis && <LODShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" isOrbiting={isOrbiting} material={effectiveMaterial} override={materialOverride} />}
                    {result && selectionActive && onElementSelect && <SelectionMeshR3F geometry={result.geometry} onSelect={onElementSelect} />}
                    {result && highlightTriangles && highlightTriangles.length > 0 && <FaceHighlightMesh sourceGeometry={result.geometry} triangleIndices={highlightTriangles} />}
                    {ghostResult && (
                      <mesh geometry={ghostResult.geometry}>
                        <meshStandardMaterial color="#22d3ee" transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} roughness={0.5} metalness={0.1} />
                      </mesh>
                    )}
                    {result && showPrintAnalysis && printAnalysis && (
                      <PrintAnalysisOverlay
                        geometry={result.geometry}
                        analysis={printAnalysis}
                        overhangThreshold={printOverhangAngle}
                        buildDirection={printBuildDirection as [number, number, number]}
                      />
                    )}
                    {result && showPrintAnalysis && !printAnalysis && <LODShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" isOrbiting={isOrbiting} material={effectiveMaterial} override={materialOverride} />}
                    {result && showFEA && feaResult && (
                      <FEAOverlay
                        geometry={result.geometry}
                        result={feaResult}
                        displayMode={feaDisplayMode}
                        deformationScale={feaDeformationScale}
                      />
                    )}
                    {result && showFEA && !feaResult && <LODShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" isOrbiting={isOrbiting} material={effectiveMaterial} override={materialOverride} />}
                    {/* FEA boundary-condition markers — visible during setup */}
                    {result && showFEA && feaConditions && feaConditions.length > 0 && (
                      <FEAConditionMarkers
                        geometry={result.geometry}
                        conditions={feaConditions}
                        highlightedIdx={feaHighlightedConditionIdx}
                        onMarkerClick={onFEAConditionClick}
                      />
                    )}
                    {result && showDFM && dfmResults && dfmResults.length > 0 && (
                      <DFMOverlay
                        geometry={result.geometry}
                        results={dfmResults}
                        highlightedIssue={dfmHighlightedIssue}
                      />
                    )}
                    {result && showDFM && (!dfmResults || dfmResults.length === 0) && <LODShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" isOrbiting={isOrbiting} material={effectiveMaterial} override={materialOverride} />}
                    {result && showDraftAnalysis && draftResult && (
                      <DraftAnalysisOverlay
                        geometry={result.geometry}
                        result={draftResult}
                        minDraftDeg={draftMinDeg}
                      />
                    )}
                    {result && showDraftAnalysis && !draftResult && <LODShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" isOrbiting={isOrbiting} material={effectiveMaterial} override={materialOverride} />}
                    {/* Instance Array overlay */}
                    {result && showArray && arrayPattern && (() => {
                      const matrices = buildInstanceMatrices(arrayPattern);
                      const mat = new THREE.MeshStandardMaterial({ color: '#8b9cf4', roughness: 0.35, metalness: 0.4, side: THREE.DoubleSide });
                      return <InstanceArray geometry={result.geometry} material={mat} matrices={matrices} visible={true} />;
                    })()}
                    <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={1} maxDistance={5000} onStart={handleOrbitStart} onEnd={handleOrbitEnd} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
                    {onCameraPlaneChange && <CameraPlaneDetector onChange={onCameraPlaneChange} />}
                  </>
                  </MotionMeshWrapper>
                  </TurntableGroup>
                )}

                {/* Dimension annotations */}
                {showDims && !isAssembly && <DimensionOverlay result={result} visible={showDims} unitSystem={unitSystem} onDimClick={onDimClick} />}

                {/* GD&T / Dimension tolerance annotations */}
                {(gdtAnnotations || dimensionAnnotations) && (
                  <GDTOverlay gdtAnnotations={gdtAnnotations} dimensionAnnotations={dimensionAnnotations} />
                )}

                {/* ViewCube */}
                <ViewCube />

                {/* Snap Alignment Guides — colored X/Y/Z lines while dragging snapped vertex */}
                <SnapAlignGuides />

                {/* NURBS control point drag editor */}
                {nurbsCPEdit && nurbsCPParams && onNurbsCPParamChange && (
                  <NurbsCPEditor
                    params={nurbsCPParams}
                    onParamChange={onNurbsCPParamChange}
                    onDragStart={() => onDragStateChange?.(true)}
                    onDragEnd={() => onDragStateChange?.(false)}
                  />
                )}

                {/* Measure tool */}
                <MeasureTool active={measureActive} mode={measureMode} unitSystem={unitSystem} />

                {/* Section plane — single part uses mesh bbox; assembly uses union world AABB */}
                {sectionActive && (isAssembly && assemblySectionBounds ? (
                  <SectionPlane
                    enabled={sectionActive}
                    axis={sectionAxis}
                    offset={sectionOffset}
                    worldBoxMin={assemblySectionBounds.min}
                    worldBoxMax={assemblySectionBounds.max}
                  />
                ) : !isAssembly ? (
                  <SectionPlane enabled={sectionActive} axis={sectionAxis} offset={sectionOffset} result={result} />
                ) : null)}

                {/* Construction planes */}
                {showPlanes && constructPlanes && <ConstructPlane planes={constructPlanes} />}

                {/* Center of mass indicator */}
                {showCenterOfMass && (
                  <group position={showCenterOfMass}>
                    <mesh>
                      <sphereGeometry args={[2, 16, 16]} />
                      <meshStandardMaterial color="#facc15" emissive="#facc15" emissiveIntensity={0.6} />
                    </mesh>
                  </group>
                )}

                {/* Performance monitor */}
                <PerfMonitor visible={showPerf} lang={lang} />

                {/* Collaboration cursors */}
                {collabUsers && collabUsers.length > 0 && (
                  <CollabCursors users={collabUsers} />
                )}
              </Suspense>
              <group position={[0, bottomY - 2, 0]}>
                <Grid
                  args={[2000, 2000]}
                  cellSize={typeof snapGrid === 'number' && snapGrid > 0 ? snapGrid : 10}
                  cellThickness={0.6}
                  cellColor="#e5e7eb"
                  sectionSize={50}
                  sectionThickness={1.2}
                  sectionColor="#d1d5db"
                  fadeDistance={800}
                  fadeStrength={3}
                  infiniteGrid
                />
                <axesHelper args={[100]} />
              </group>
              {/* Pin Comments (Figma-style, manufacturer ↔ designer) */}
              {pinComments && onAddPinComment && onResolvePinComment && onDeletePinComment && (
                <PinComments
                  comments={pinComments}
                  isPlacingComment={isPlacingComment}
                  focusedId={focusedPinCommentId}
                  onAddComment={onAddPinComment}
                  onResolve={onResolvePinComment}
                  onDelete={onDeletePinComment}
                  onReact={onReactPinComment}
                  onReply={onReplyPinComment}
                  roomUsers={pinCommentRoomUsers}
                  currentUserId={pinCommentCurrentUserId}
                />
              )}
            </Canvas>
            </ErrorBoundary>
            {/* ViewCube overlay -- rendered outside Canvas to avoid R3F reconciler conflicts */}
            <ViewCubeOverlay />
            </>
          )}

          {/* Triangle count overlay */}
          {hasContent && totalTriCount > 0 && (
            <div style={{
              position: 'absolute', bottom: 6, right: 8,
              background: 'rgba(13,17,23,0.75)', borderRadius: '4px',
              padding: '2px 7px', fontSize: '10px', fontWeight: 600,
              color: isOrbiting ? '#f0883e' : '#6e7681',
              pointerEvents: 'none', userSelect: 'none',
              fontFamily: 'monospace', letterSpacing: '0.02em',
              border: '1px solid rgba(48,54,61,0.6)',
              transition: 'color 0.15s',
            }}>
              {totalTriCount >= 1000
                ? `${(totalTriCount / 1000).toFixed(1)}k`
                : totalTriCount} tris{isOrbiting ? ' (LOD)' : ''}
            </div>
          )}
        </div>

        {/* Stats bar */}
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 10px', background: '#161b22', borderTop: '1px solid #30363d', fontSize: '11px', flexShrink: 0, gap: '10px', flexWrap: 'wrap' }}>
          {stats ? (
            <>
              <span style={{ color: '#58a6ff', fontWeight: 700 }}>
                {stats.w.toFixed(1)} × {stats.h.toFixed(1)} × {stats.d.toFixed(1)} mm
              </span>
              <span style={{ color: '#30363d' }}>│</span>
              <span style={{ color: '#6e7681' }}>Vol: {stats.vol.toFixed(2)} cm³</span>
              <span style={{ color: '#30363d' }}>│</span>
              <span style={{ color: '#6e7681' }}>SA: {stats.sa.toFixed(2)} cm²</span>
              {isAssembly && (
                <>
                  <span style={{ color: '#30363d' }}>│</span>
                  <span style={{ color: '#8b9cf4' }}>{bomParts!.length} parts</span>
                </>
              )}
              {isEditing && (
                <>
                  <span style={{ color: '#30363d' }}>│</span>
                  <span style={{ color: '#22c55e' }}>Editing: {editMode}</span>
                </>
              )}
              {isTransforming && (
                <>
                  <span style={{ color: '#30363d' }}>│</span>
                  <span style={{ color: '#f0883e' }}>Transform: {transformMode}</span>
                </>
              )}
              <span style={{ marginLeft: 'auto', color: '#484f58' }}>
                {isEditing && (editMode === 'vertex' || editMode === 'edge')
                  ? (t as { directEditNavHint: string }).directEditNavHint
                  : isEditing
                    ? 'Click + drag handles to edit'
                    : isTransforming
                      ? 'Drag gizmo to transform'
                      : 'Drag · Right-click · Scroll'}
              </span>
            </>
          ) : (
            <span style={{ color: '#484f58' }}>Drag · Right-click · Scroll</span>
          )}
        </div>
      </div>
    </>
  );
}
