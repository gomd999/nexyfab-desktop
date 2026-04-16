'use client';

import { Canvas, useThree, useFrame } from '@react-three/fiber';
import ErrorBoundary from '@/components/nexyfab/ErrorBoundary';
import { OrbitControls, Grid, TransformControls, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { ShapeResult } from './shapes';
import type { EditMode } from './editing/types';
import { useEditableGeometry } from './editing/useEditableGeometry';
import { useFaceEditing } from './editing/useFaceEditing';
import FaceHandles from './editing/FaceHandles';
import EdgeContextPanel from './editing/EdgeContextPanel';
import { useLOD } from './lod/useLOD';
import VertexHandles from './editing/VertexHandles';
import EdgeHandles from './editing/EdgeHandles';
import DimensionOverlay from './DimensionOverlay';
import ViewCube from './ViewCube';
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
import type { FEAResult } from './analysis/simpleFEA';
import type { FEADisplayMode } from './analysis/FEAOverlay';
import { computeExplodedPositions } from './assembly/ExplodedView';
import RenderMode from './rendering/RenderMode';
import type { RenderSettings } from './rendering/RenderPanel';
import DFMOverlay from './analysis/DFMOverlay';
import type { DFMResult, DFMIssue } from './analysis/dfmAnalysis';
import GDTOverlay from './annotations/GDTOverlay';
import type { GDTAnnotation, DimensionAnnotation } from './annotations/GDTTypes';
import InstanceArray from './InstanceArray';
import type { ArrayPattern } from './features/instanceArray';
import { buildInstanceMatrices } from './features/instanceArray';

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

function fitCamera(camera: THREE.Camera, box: THREE.Box3): THREE.Vector3 {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = (camera as THREE.PerspectiveCamera).fov * (Math.PI / 180);
  const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.9;
  camera.position.set(center.x + dist * 0.7, center.y + dist * 0.55, center.z + dist * 0.7);
  camera.lookAt(center);
  (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
  return center;
}

// Single shape mesh
function ShapeMesh({ result, displayMode, color, position, rotation, partIndex = 0, material }: { result: ShapeResult; displayMode: DisplayMode; color: string; position?: [number, number, number]; rotation?: [number, number, number]; partIndex?: number; material?: MaterialPreset }) {
  const geo = result.geometry;
  const edgeGeo = result.edgeGeometry;
  const rot = rotation ? rotation.map(d => d * Math.PI / 180) as [number, number, number] : undefined;

  const matColor = material?.color ?? color;
  const matRoughness = material?.roughness ?? 0.35;
  const matMetalness = material?.metalness ?? 0.4;
  const matOpacity = material?.opacity ?? 1;
  const matTransparent = material?.transparent ?? false;
  const matEnvMapIntensity = material?.envMapIntensity ?? 1;

  return (
    <group position={position} rotation={rot}>
      {displayMode !== 'wireframe' && (
        <mesh geometry={geo} castShadow receiveShadow>
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
        </mesh>
      )}
      {displayMode === 'wireframe' && (
        <mesh geometry={geo}>
          <meshBasicMaterial color="#22d3ee" wireframe />
        </mesh>
      )}
      {displayMode === 'edges' && edgeGeo && (
        <lineSegments geometry={edgeGeo}>
          <lineBasicMaterial color="#60a5fa" />
        </lineSegments>
      )}
    </group>
  );
}

// LOD-aware shape mesh: switches geometry detail based on orbit interaction state
function LODShapeMesh({
  result, displayMode, color, position, rotation, partIndex = 0, isOrbiting = false, material,
}: {
  result: ShapeResult; displayMode: DisplayMode; color: string;
  position?: [number, number, number]; rotation?: [number, number, number];
  partIndex?: number; isOrbiting?: boolean; material?: MaterialPreset;
}) {
  const { levels, skipped } = useLOD(result.geometry);

  const activeGeo = useMemo(() => {
    if (skipped || levels.length === 0) return result.geometry;
    // While orbiting use lowest available LOD; idle -> full resolution
    if (isOrbiting && levels.length >= 3) return levels[2];
    if (isOrbiting && levels.length >= 2) return levels[1];
    return levels[0];
  }, [isOrbiting, levels, skipped, result.geometry]);

  const lodResult: ShapeResult = useMemo(
    () => ({ ...result, geometry: activeGeo }),
    [result, activeGeo],
  );

  return <ShapeMesh result={lodResult} displayMode={displayMode} color={color} position={position} rotation={rotation} partIndex={partIndex} material={material} />;
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
    if (!transforms || !groupRef.current) return;
    const keys = Object.keys(transforms);
    if (keys.length === 0) return;
    const mat = transforms[keys[0]];
    groupRef.current.matrix.copy(mat);
    groupRef.current.matrixAutoUpdate = false;
    return () => {
      if (groupRef.current) {
        groupRef.current.matrix.identity();
        groupRef.current.matrixAutoUpdate = true;
      }
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
function CameraFitter({ results, bomParts, fitKey }: { results: ShapeResult[]; bomParts?: BomPartResult[]; fitKey: number }) {
  const { camera } = useThree();

  useEffect(() => {
    if (results.length === 0) return;
    const combined = new THREE.Box3();
    if (bomParts && bomParts.length > 0) {
      for (const part of bomParts) {
        part.result.geometry.computeBoundingBox();
        if (part.result.geometry.boundingBox) {
          const box = part.result.geometry.boundingBox.clone();
          // Apply rotation then translation to get accurate world-space bounds
          if (part.rotation) {
            const rot = part.rotation.map(d => d * Math.PI / 180) as [number, number, number];
            const mat = new THREE.Matrix4().makeRotationFromEuler(
              new THREE.Euler(rot[0], rot[1], rot[2])
            );
            box.applyMatrix4(mat);
          }
          if (part.position) {
            box.translate(new THREE.Vector3(...part.position));
          }
          combined.union(box);
        }
      }
    } else {
      for (const r of results) {
        r.geometry.computeBoundingBox();
        if (r.geometry.boundingBox) combined.union(r.geometry.boundingBox);
      }
    }
    if (!combined.isEmpty()) fitCamera(camera, combined);
  }, [results, bomParts, camera, fitKey]);

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

      <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={1} maxDistance={5000} enabled={!isDragging} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
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
}: {
  sourceGeometry: THREE.BufferGeometry;
  displayMode: DisplayMode;
  onDragStateChange?: (d: boolean) => void;
  onGeometryApply?: (geo: THREE.BufferGeometry) => void;
  onFaceSketch?: (faceId: number) => void;
}) {
  const { editGeometry, faces, selectedFaceId, setSelectedFaceId, hoveredFaceId, setHoveredFaceId, pushPullFace, resetEdits, hasEdits } = useFaceEditing(sourceGeometry);
  const [isDragging, setIsDragging] = useState(false);
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

  if (!editGeometry) return null;

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
      <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={1} maxDistance={5000} enabled={!isDragging} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
    </group>
  );
}

// Transform gizmo scene: renders mesh with TransformControls
function TransformScene({
  result,
  displayMode,
  transformMode,
  onTransformChange,
}: {
  result: ShapeResult;
  displayMode: DisplayMode;
  transformMode: 'translate' | 'rotate' | 'scale';
  onTransformChange?: (matrix: number[]) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const transformRef = useRef<any>(null!);
  const orbitRef = useRef<any>(null!);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const controls = transformRef.current;
    if (!controls) return;
    const cb = (e: { value: boolean }) => {
      setIsDragging(e.value);
    };
    controls.addEventListener('dragging-changed', cb);
    return () => controls.removeEventListener('dragging-changed', cb);
  }, []);

  useEffect(() => {
    const controls = transformRef.current;
    if (!controls) return;
    const cb = () => {
      if (meshRef.current && onTransformChange) {
        meshRef.current.updateWorldMatrix(true, false);
        onTransformChange(meshRef.current.matrixWorld.toArray());
      }
    };
    controls.addEventListener('objectChange', cb);
    return () => controls.removeEventListener('objectChange', cb);
  }, [onTransformChange]);

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
      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.07} minDistance={1} maxDistance={5000} enabled={!isDragging} />
    </group>
  );
}

export interface BomPartResult {
  name: string;
  result: ShapeResult;
  position?: [number, number, number];
  rotation?: [number, number, number];
  color?: string;
}

interface ShapePreviewProps {
  result: ShapeResult | null;
  bomParts?: BomPartResult[];
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
  showDFM?: boolean;
  dfmResults?: DFMResult[] | null;
  dfmHighlightedIssue?: DFMIssue | null;
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
  onAddPinComment?: (position: [number, number, number], text: string) => void;
  onResolvePinComment?: (id: string) => void;
  onDeletePinComment?: (id: string) => void;
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
}

export default function ShapePreview({
  result, bomParts, assemblyLabel, onCapture, editMode = 'none', onDragStateChange,
  showDimensions = false, measureActive = false, measureMode = 'distance', sectionActive = false,
  sectionAxis = 'y', sectionOffset = 0.5, showPlanes = false, constructPlanes,
  transformMode = 'off', onTransformChange, snapGrid, unitSystem = 'mm',
  showPerf = false, materialId, collabUsers,
  showPrintAnalysis = false, printAnalysis = null,
  printBuildDirection = [0, 1, 0], printOverhangAngle = 45,
  renderMode = 'standard', renderSettings, onCaptureScreenshot,
  explodeFactor = 0, interferenceHighlights,
  showFEA = false, feaResult = null,
  feaDisplayMode = 'stress', feaDeformationScale = 100,
  showDFM = false, dfmResults = null, dfmHighlightedIssue = null,
  showCenterOfMass,
  gdtAnnotations, dimensionAnnotations,
  onSceneReady,
  arrayPattern = null, showArray = false,
  onCameraPlaneChange,
  sketchPlane, onSketchPlaneChange,
  onOpenLibrary, onStartSketch, onOpenChat,
  pinComments, isPlacingComment = false, onAddPinComment, onResolvePinComment, onDeletePinComment,
  onGeometryApply,
  onFaceSketch,
  onDimClick,
  lang = 'ko',
  onFileImport,
  snapEnabled = false,
  ghostResult = null,
  animateMode = 'none',
  motionPartTransforms = null,
}: ShapePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('solid');
  const [fitKey, setFitKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [internalAnimateMode, setInternalAnimateMode] = useState<'none' | 'turntable'>('none');
  const effectiveAnimateMode = animateMode !== 'none' ? animateMode : internalAnimateMode;
  const [showDims, setShowDims] = useState(showDimensions);
  const [isOrbiting, setIsOrbiting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── drag-drop import handler ──
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!onFileImport) return;
    const types = Array.from(e.dataTransfer.items).map(i => i.type);
    const hasFile = e.dataTransfer.types.includes('Files');
    if (hasFile) { e.preventDefault(); setIsDragOver(true); }
  }, [onFileImport]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // #14: always clear overlay first, even if import throws
    setIsDragOver(false);
    if (!onFileImport) return;
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      onFileImport(file);
    } catch {
      // overlay already cleared above; caller is responsible for error toast
    }
  }, [onFileImport]);

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
  const allResults = isAssembly ? bomParts.map(p => p.result) : result ? [result] : [];
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

  useEffect(() => {
    setFitKey(k => k + 1);
  }, [result, bomParts]);

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

  const MODES: { key: DisplayMode; label: string; icon: string }[] = [
    { key: 'solid', label: 'Solid', icon: '⬛' },
    { key: 'edges', label: 'Edge', icon: '◻' },
    { key: 'wireframe', label: 'Wire', icon: '⬡' },
  ];

  return (
    <>
      <style>{`@keyframes nf-spin { to { transform: rotate(360deg); } }`}</style>
      <div ref={containerRef} style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0d1117', borderRadius: 'inherit', overflow: 'hidden', touchAction: 'none', userSelect: 'none', position: 'relative' }}
        onDragStart={e => e.preventDefault()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}>

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
              <span>{lang === 'ko' ? 'CAD 파일을 여기에 놓으세요' : 'Drop CAD file here'}</span>
              <span style={{ fontSize: 11, color: '#8b949e' }}>STEP · STL · OBJ · PLY · DXF</span>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', background: '#161b22', borderBottom: '1px solid #30363d', flexShrink: 0 }}>
          <span style={{ color: '#c9d1d9', fontSize: '12px', fontWeight: 600, flex: 1 }}>
            {isEditing ? (
              <><span style={{ color: '#22c55e' }}>● </span>Edit Mode: {editMode}</>
            ) : isAssembly ? (
              <>{assemblyLabel || 'Assembly'} <span style={{ color: '#8b9cf4', fontSize: 11 }}>({bomParts.length} parts)</span></>
            ) : '3D Preview'}
          </span>

          <div style={{ display: 'flex', gap: '2px', background: '#21262d', borderRadius: '6px', padding: '2px', flexShrink: 0, flexWrap: 'nowrap' }}>
            {MODES.map(({ key, label, icon }) => (
              <button key={key} onClick={() => setDisplayMode(key)} title={label} aria-label={label} aria-pressed={displayMode === key} style={{
                padding: '3px 7px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: displayMode === key ? '#388bfd' : 'transparent',
                color: displayMode === key ? '#fff' : '#6e7681',
                display: 'flex', alignItems: 'center', gap: '3px',
                whiteSpace: 'nowrap',
              }}>
                <span style={{ fontSize: '10px' }}>{icon}</span>
                <span style={{ display: 'var(--mode-label-display, inline)' }}>{label}</span>
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '3px', flexShrink: 0 }}>
            <button onClick={() => setPbrPanelOpen(v => !v)} title={lang === 'ko' ? '재료 프리뷰' : 'Material Preview'} style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: pbrPanelOpen ? '#f59e0b33' : '#21262d', color: pbrPanelOpen ? '#f59e0b' : '#6e7681', fontSize: '12px', fontWeight: 700, cursor: 'pointer', lineHeight: 1, transition: 'all 0.15s' }}>🎨</button>
            <button onClick={() => setShowDims(d => !d)} title="Dimensions" style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: showDims ? '#388bfd' : '#21262d', color: showDims ? '#fff' : '#6e7681', fontSize: '11px', fontWeight: 700, cursor: 'pointer', lineHeight: 1, transition: 'all 0.15s' }}>📏</button>
            <button
              onClick={() => setInternalAnimateMode(m => m === 'turntable' ? 'none' : 'turntable')}
              title={lang === 'ko' ? '터닝테이블 애니메이션' : 'Turntable Animation'}
              style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: effectiveAnimateMode === 'turntable' ? 'rgba(139,92,246,0.25)' : '#21262d', color: effectiveAnimateMode === 'turntable' ? '#a78bfa' : '#6e7681', fontSize: '13px', cursor: 'pointer', lineHeight: 1, transition: 'all 0.15s' }}
            >⟲</button>
            <button onClick={() => setFitKey(k => k + 1)} title="Reset Camera" style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: '#21262d', color: '#6e7681', fontSize: '14px', cursor: 'pointer', lineHeight: 1 }}>⟳</button>
            <button onClick={toggleFullscreen} title={isFullscreen ? 'Exit' : 'Fullscreen'} style={{ padding: '4px 8px', borderRadius: '6px', border: 'none', background: '#21262d', color: '#6e7681', fontSize: '12px', cursor: 'pointer', lineHeight: 1 }}>
              {isFullscreen ? '⊡' : '⛶'}
            </button>
          </div>
        </div>

        {/* Standard View Controls Strip */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          padding: '3px 10px', background: '#0d1117',
          borderBottom: '1px solid #21262d', flexShrink: 0,
          overflowX: 'auto',
        }}>
          {[
            { label: lang === 'ko' ? '정면' : 'Front', key: '5', view: 'front' },
            { label: lang === 'ko' ? '우측' : 'Right', key: '6', view: 'right' },
            { label: lang === 'ko' ? '상면' : 'Top', key: '7', view: 'top' },
            { label: 'Iso', key: '0', view: 'iso' },
          ].map(({ label, key, view }) => (
            <button
              key={view}
              onClick={() => dispatchView(view)}
              title={`${label} [${key}]`}
              style={{
                padding: '2px 7px', borderRadius: 4, border: '1px solid #21262d',
                background: 'transparent', color: '#6e7681',
                fontSize: 10, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'system-ui, sans-serif',
                transition: 'all 0.1s', whiteSpace: 'nowrap',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.color = '#c9d1d9'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6e7681'; }}
            >
              {label}
              <span style={{ color: '#484f58', marginLeft: 3 }}>[{key}]</span>
            </button>
          ))}
          <div style={{ width: 1, height: 14, background: '#21262d', margin: '0 4px' }} />
          <button
            onClick={() => setFitKey(k => k + 1)}
            title={lang === 'ko' ? '전체 맞춤 [F]' : 'Fit All [F]'}
            style={{
              padding: '2px 7px', borderRadius: 4, border: '1px solid #21262d',
              background: 'transparent', color: '#6e7681',
              fontSize: 10, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'system-ui, sans-serif',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.color = '#c9d1d9'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#6e7681'; }}
          >
            {lang === 'ko' ? '전체 맞춤' : 'Fit'}
            <span style={{ color: '#484f58', marginLeft: 3 }}>[F]</span>
          </button>
          {snapEnabled && (
            <>
              <div style={{ width: 1, height: 14, background: '#21262d', margin: '0 4px' }} />
              <span style={{ fontSize: 9, color: '#388bfd', fontWeight: 700, padding: '2px 6px', background: '#1f3158', borderRadius: 3 }}>
                ⊞ {lang === 'ko' ? '스냅 ON' : 'SNAP ON'}
              </span>
            </>
          )}
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
              position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
              zIndex: 20, display: 'flex', gap: 4,
              background: 'rgba(13,17,23,0.85)', borderRadius: 8,
              border: '1px solid #30363d', padding: '4px 6px',
              backdropFilter: 'blur(4px)',
            }}>
              {(['xy', 'xz', 'yz'] as const).map(p => (
                <button key={p} onClick={() => onSketchPlaneChange(p)} style={{
                  padding: '4px 12px', borderRadius: 5, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  border: sketchPlane === p ? '2px solid #7c3aed' : '1px solid #30363d',
                  background: sketchPlane === p ? 'rgba(124,58,237,0.2)' : 'transparent',
                  color: sketchPlane === p ? '#a78bfa' : '#6e7681',
                  transition: 'all 0.12s',
                }}>
                  {p.toUpperCase()}
                </button>
              ))}
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
                <p style={{ color: '#6e7681', fontSize: '13px', margin: 0 }}>Browser-based 3D CAD — start building your shape</p>
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
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
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Shape Library</div>
                    <div style={{ fontSize: '11px', color: '#6e7681', marginTop: '3px' }}>형상 선택</div>
                  </div>
                </button>

                <button
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
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>Start Sketch</div>
                    <div style={{ fontSize: '11px', color: '#6e7681', marginTop: '3px' }}>스케치 시작</div>
                  </div>
                </button>

                <button
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
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>AI Chat</div>
                    <div style={{ fontSize: '11px', color: '#6e7681', marginTop: '3px' }}>AI 채팅</div>
                  </div>
                </button>
              </div>

              <p style={{ color: '#484f58', fontSize: '11px', margin: 0 }}>Press <kbd style={{ background: '#21262d', border: '1px solid #30363d', borderRadius: '4px', padding: '1px 5px', fontSize: '10px', color: '#8b949e' }}>?</kbd> for keyboard shortcuts</p>
            </div>
          ) : (
            <ErrorBoundary
              fallback={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', background: '#0d1117', color: '#6e7681', fontSize: 13 }}>
                  3D viewer failed to load. Please refresh.
                </div>
              }
            >
            <Canvas
              camera={{ position: [150, 120, 150], fov: 50 }}
              shadows
              gl={{ antialias: true, preserveDrawingBuffer: true }}
              onCreated={({ gl, scene }) => { canvasRef.current = gl.domElement; onSceneReady?.(scene); }}
              style={{ width: '100%', height: '100%' }}
            >
              <SceneCleanup />
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
                  />
                </Suspense>
              ) : (
                <>
                  <hemisphereLight args={['#c8d8ff', '#0a0a1a', 0.7]} />
                  <ambientLight intensity={0.25} />
                  <directionalLight position={[20, 30, 15]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
                  <directionalLight position={[-15, 10, -10]} intensity={0.5} color="#c8d8ff" />
                  <pointLight position={[0, 50, 0]} intensity={0.3} color="#ffffff" />
                </>
              )}
              <Suspense fallback={null}>
                {renderMode !== 'photorealistic' && <Environment preset={envPreset} background={false} />}
                <CameraFitter results={allResults} bomParts={isAssembly ? bomParts : undefined} fitKey={fitKey} />

                {isEditing && editMode === 'face' && result ? (
                  <FaceScene
                    sourceGeometry={result.geometry}
                    displayMode={displayMode}
                    onDragStateChange={onDragStateChange}
                    onGeometryApply={onGeometryApply}
                    onFaceSketch={onFaceSketch}
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
                  />
                ) : isAssembly ? (
                  <>
                    {bomParts.map((part, i) => {
                      const partKey = part.name || `part_${i}`;
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
                      return (
                        <LODShapeMesh key={i} result={part.result} displayMode={displayMode} color={part.color ?? PART_COLORS[i % PART_COLORS.length]} position={pos} rotation={part.rotation} partIndex={i} isOrbiting={isOrbiting} />
                      );
                    })}
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
                    <OrbitControls makeDefault enableDamping dampingFactor={0.07} minDistance={1} maxDistance={5000} onStart={handleOrbitStart} onEnd={handleOrbitEnd} mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }} touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }} />
                    {onCameraPlaneChange && <CameraPlaneDetector onChange={onCameraPlaneChange} />}
                  </>
                ) : (
                  <TurntableGroup active={effectiveAnimateMode === 'turntable'}>
                  <MotionMeshWrapper transforms={motionPartTransforms}>
                  <>
                    {result && !showPrintAnalysis && !showFEA && !showDFM && <LODShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" isOrbiting={isOrbiting} material={effectiveMaterial} />}
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
                    {result && showPrintAnalysis && !printAnalysis && <LODShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" isOrbiting={isOrbiting} material={effectiveMaterial} />}
                    {result && showFEA && feaResult && (
                      <FEAOverlay
                        geometry={result.geometry}
                        result={feaResult}
                        displayMode={feaDisplayMode}
                        deformationScale={feaDeformationScale}
                      />
                    )}
                    {result && showFEA && !feaResult && <LODShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" isOrbiting={isOrbiting} material={effectiveMaterial} />}
                    {result && showDFM && dfmResults && dfmResults.length > 0 && (
                      <DFMOverlay
                        geometry={result.geometry}
                        results={dfmResults}
                        highlightedIssue={dfmHighlightedIssue}
                      />
                    )}
                    {result && showDFM && (!dfmResults || dfmResults.length === 0) && <LODShapeMesh result={result} displayMode={displayMode} color="#8b9cf4" isOrbiting={isOrbiting} material={effectiveMaterial} />}
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

                {/* Measure tool */}
                <MeasureTool active={measureActive} mode={measureMode} unitSystem={unitSystem} />

                {/* Section plane */}
                {sectionActive && <SectionPlane enabled={sectionActive} axis={sectionAxis} offset={sectionOffset} result={result} />}

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
                <PerfMonitor visible={showPerf} />

                {/* Collaboration cursors */}
                {collabUsers && collabUsers.length > 0 && (
                  <CollabCursors users={collabUsers} />
                )}
              </Suspense>
              <Grid
                args={[2000, 2000]}
                position={[0, bottomY - 2, 0]}
                cellSize={10}
                cellThickness={0.4}
                cellColor="#1c2128"
                sectionSize={50}
                sectionThickness={0.8}
                sectionColor="#30363d"
                fadeDistance={600}
                fadeStrength={3}
                infiniteGrid
              />
              {/* Pin Comments (Figma-style, manufacturer ↔ designer) */}
              {pinComments && onAddPinComment && onResolvePinComment && onDeletePinComment && (
                <PinComments
                  comments={pinComments}
                  isPlacingComment={isPlacingComment}
                  onAddComment={onAddPinComment}
                  onResolve={onResolvePinComment}
                  onDelete={onDeletePinComment}
                />
              )}
            </Canvas>
            </ErrorBoundary>
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
                {isEditing ? 'Click + drag handles to edit' : isTransforming ? 'Drag gizmo to transform' : 'Drag · Right-click · Scroll'}
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
