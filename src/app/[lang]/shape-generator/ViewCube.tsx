'use client';

import React, { useRef, useCallback, useState, useEffect, useMemo } from 'react';

import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

type FaceId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
type EdgeId =
  | 'front-top' | 'front-bottom' | 'front-left' | 'front-right'
  | 'back-top' | 'back-bottom' | 'back-left' | 'back-right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
type CornerId =
  | 'front-top-right' | 'front-top-left' | 'front-bottom-right' | 'front-bottom-left'
  | 'back-top-right' | 'back-top-left' | 'back-bottom-right' | 'back-bottom-left';

/* ------------------------------------------------------------------ */
/*  View target definitions                                           */
/* ------------------------------------------------------------------ */

const DIST = 1; // normalised – we scale by actual distance later

const FACE_VIEWS: Record<FaceId, THREE.Vector3> = {
  front:  new THREE.Vector3(0, 0, DIST),
  back:   new THREE.Vector3(0, 0, -DIST),
  left:   new THREE.Vector3(-DIST, 0, 0),
  right:  new THREE.Vector3(DIST, 0, 0),
  top:    new THREE.Vector3(0, DIST, 0),
  bottom: new THREE.Vector3(0, -DIST, 0),
};

// Edge views: midpoint between two adjacent face directions
function edgeDir(a: FaceId, b: FaceId): THREE.Vector3 {
  return FACE_VIEWS[a].clone().add(FACE_VIEWS[b]).normalize();
}

const EDGE_VIEWS: Record<EdgeId, THREE.Vector3> = {
  'front-top':     edgeDir('front', 'top'),
  'front-bottom':  edgeDir('front', 'bottom'),
  'front-left':    edgeDir('front', 'left'),
  'front-right':   edgeDir('front', 'right'),
  'back-top':      edgeDir('back', 'top'),
  'back-bottom':   edgeDir('back', 'bottom'),
  'back-left':     edgeDir('back', 'left'),
  'back-right':    edgeDir('back', 'right'),
  'top-left':      edgeDir('top', 'left'),
  'top-right':     edgeDir('top', 'right'),
  'bottom-left':   edgeDir('bottom', 'left'),
  'bottom-right':  edgeDir('bottom', 'right'),
};

// Corner views: sum of three adjacent face directions, normalised
function cornerDir(a: FaceId, b: FaceId, c: FaceId): THREE.Vector3 {
  return FACE_VIEWS[a].clone().add(FACE_VIEWS[b]).add(FACE_VIEWS[c]).normalize();
}

const CORNER_VIEWS: Record<CornerId, THREE.Vector3> = {
  'front-top-right':    cornerDir('front', 'top', 'right'),
  'front-top-left':     cornerDir('front', 'top', 'left'),
  'front-bottom-right': cornerDir('front', 'bottom', 'right'),
  'front-bottom-left':  cornerDir('front', 'bottom', 'left'),
  'back-top-right':     cornerDir('back', 'top', 'right'),
  'back-top-left':      cornerDir('back', 'top', 'left'),
  'back-bottom-right':  cornerDir('back', 'bottom', 'right'),
  'back-bottom-left':   cornerDir('back', 'bottom', 'left'),
};

/* ------------------------------------------------------------------ */
/*  CSS cube size                                                     */
/* ------------------------------------------------------------------ */

const CUBE_SIZE = 56; // px – visual size of each face
const HALF = CUBE_SIZE / 2;
const EDGE_THICK = 6; // px clickable zone for edges
const CORNER_SIZE = 10; // px clickable zone for corners

/* ------------------------------------------------------------------ */
/*  Animation helper                                                  */
/* ------------------------------------------------------------------ */

interface AnimState {
  running: boolean;
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  startUp: THREE.Vector3;
  endUp: THREE.Vector3;
  t: number;
  duration: number; // seconds
}

function computeTargetUp(dir: THREE.Vector3): THREE.Vector3 {
  // For top/bottom views we need a different up vector
  const absY = Math.abs(dir.y);
  if (absY > 0.99) {
    // Looking straight down or up — use -Z or +Z as up
    return dir.y > 0 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1);
  }
  return new THREE.Vector3(0, 1, 0);
}

/* ------------------------------------------------------------------ */
/*  Global camera rotation store (bridge R3F ↔ DOM)                   */
/* ------------------------------------------------------------------ */

// We use a simple module-level store with subscribe/getSnapshot pattern
// to bridge the R3F useFrame loop with the DOM overlay component.

type CubeListener = () => void;

let _cubeMatrix = 'none'; // CSS matrix3d string
const _listeners = new Set<CubeListener>();

function setCubeMatrix(css: string) {
  if (css === _cubeMatrix) return;
  _cubeMatrix = css;
  _listeners.forEach(fn => fn());
}

function getCubeMatrix(): string {
  return _cubeMatrix;
}

function subscribeCubeMatrix(listener: CubeListener): () => void {
  _listeners.add(listener);
  return () => { _listeners.delete(listener); };
}

/* ------------------------------------------------------------------ */
/*  ViewCube R3F component (place inside <Canvas>)                    */
/*  – Only handles camera animation + rotation broadcast              */
/* ------------------------------------------------------------------ */

export default function ViewCube({ target = new THREE.Vector3() }: { target?: THREE.Vector3 }) {
  const { camera } = useThree();
  const animRef = useRef<AnimState>({
    running: false,
    startPos: new THREE.Vector3(),
    endPos: new THREE.Vector3(),
    startUp: new THREE.Vector3(0, 1, 0),
    endUp: new THREE.Vector3(0, 1, 0),
    t: 0,
    duration: 0.5,
  });

  /* ---------- animate camera on click ---------- */
  const navigateTo = useCallback(
    (direction: THREE.Vector3) => {
      const dist = camera.position.distanceTo(target);
      const endPos = direction.clone().multiplyScalar(dist).add(target);
      const endUp = computeTargetUp(direction);

      const a = animRef.current;
      a.startPos.copy(camera.position);
      a.endPos.copy(endPos);
      a.startUp.copy(camera.up);
      a.endUp.copy(endUp);
      a.t = 0;
      a.running = true;
    },
    [camera, target],
  );

  /* ---------- global keyboard-triggered view preset ---------- */
  useEffect(() => {
    const handler = (e: Event) => {
      const view = (e as CustomEvent<FaceId | 'iso' | 'fit'>).detail;
      if (view === 'fit') {
        const iso = new THREE.Vector3(1, 1, 1).normalize();
        navigateTo(iso);
        return;
      }
      if (view === 'iso') {
        const iso = new THREE.Vector3(1, 1, 1).normalize();
        navigateTo(iso);
        return;
      }
      if (FACE_VIEWS[view as FaceId]) {
        navigateTo(FACE_VIEWS[view as FaceId]);
      }
    };
    window.addEventListener('nexyfab:view', handler);
    return () => window.removeEventListener('nexyfab:view', handler);
  }, [navigateTo]);

  /* ---------- listen for click events from the DOM overlay ---------- */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ type: string; id: string }>).detail;
      if (!detail) return;
      if (detail.type === 'face' && FACE_VIEWS[detail.id as FaceId]) {
        navigateTo(FACE_VIEWS[detail.id as FaceId]);
      } else if (detail.type === 'edge' && EDGE_VIEWS[detail.id as EdgeId]) {
        navigateTo(EDGE_VIEWS[detail.id as EdgeId]);
      } else if (detail.type === 'corner' && CORNER_VIEWS[detail.id as CornerId]) {
        navigateTo(CORNER_VIEWS[detail.id as CornerId]);
      } else if (detail.type === 'home') {
        navigateTo(new THREE.Vector3(1, 1, 1).normalize());
      }
    };
    window.addEventListener('nexyfab:viewcube-click', handler);
    return () => window.removeEventListener('nexyfab:viewcube-click', handler);
  }, [navigateTo]);

  /* ---------- per-frame: animate + broadcast cube rotation ---------- */
  useFrame((_, delta) => {
    const a = animRef.current;
    if (a.running) {
      a.t += delta / a.duration;
      if (a.t >= 1) {
        a.t = 1;
        a.running = false;
      }
      const t = a.t * a.t * (3 - 2 * a.t);
      camera.position.lerpVectors(a.startPos, a.endPos, t);
      camera.up.lerpVectors(a.startUp, a.endUp, t).normalize();
      camera.lookAt(target);
    }

    // Broadcast rotation matrix as CSS matrix3d to the DOM overlay
    const m = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion);
    m.invert();
    const e = m.elements;
    setCubeMatrix(
      `rotateX(0deg) matrix3d(${e[0]},${e[1]},${e[2]},${e[3]},${e[4]},${e[5]},${e[6]},${e[7]},${e[8]},${e[9]},${e[10]},${e[11]},${e[12]},${e[13]},${e[14]},${e[15]})`,
    );
  });

  return null; // No DOM output — rendering is in ViewCubeOverlay
}

/* ------------------------------------------------------------------ */
/*  ViewCubeOverlay — pure DOM component (place OUTSIDE <Canvas>)     */
/* ------------------------------------------------------------------ */

export function ViewCubeOverlay() {
  const cubeRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // Subscribe to rotation matrix changes from R3F
  useEffect(() => {
    const unsub = subscribeCubeMatrix(() => {
      if (cubeRef.current) {
        cubeRef.current.style.transform = getCubeMatrix();
      }
    });
    return unsub;
  }, []);

  /* ---------- click dispatchers ---------- */
  const onFaceClick = useCallback(
    (id: FaceId) => (e: React.MouseEvent) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('nexyfab:viewcube-click', { detail: { type: 'face', id } }));
    },
    [],
  );

  const onEdgeClick = useCallback(
    (id: EdgeId) => (e: React.MouseEvent) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('nexyfab:viewcube-click', { detail: { type: 'edge', id } }));
    },
    [],
  );

  const onCornerClick = useCallback(
    (id: CornerId) => (e: React.MouseEvent) => {
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('nexyfab:viewcube-click', { detail: { type: 'corner', id } }));
    },
    [],
  );

  const onHomeClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('nexyfab:viewcube-click', { detail: { type: 'home', id: '' } }));
  }, []);

  /* ---------- face style helper ---------- */
  const faceStyle = (
    transform: string,
    id: string,
  ): React.CSSProperties => ({
    position: 'absolute',
    width: CUBE_SIZE,
    height: CUBE_SIZE,
    background: hovered === id ? 'rgba(88, 166, 255, 0.9)' : 'rgba(22, 27, 34, 0.75)',
    border: `1.5px solid ${hovered === id ? '#58a6ff' : 'rgba(255,255,255,0.15)'}`,
    boxShadow: hovered === id 
      ? '0 0 16px rgba(88, 166, 255, 0.4), inset 0 0 10px rgba(255,255,255,0.2)' 
      : 'inset 0 0 8px rgba(255,255,255,0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 10,
    fontWeight: 800,
    fontFamily: '"Inter", system-ui, sans-serif',
    color: hovered === id ? '#ffffff' : '#8b949e',
    cursor: 'pointer',
    userSelect: 'none',
    transform,
    backfaceVisibility: 'hidden',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  });

  /* ---------- faces definition ---------- */
  const faces: { id: FaceId; label: string; transform: string }[] = useMemo(() => [
    { id: 'front',  label: 'Front',  transform: `rotateY(0deg) translateZ(${HALF}px)` },
    { id: 'back',   label: 'Back',   transform: `rotateY(180deg) translateZ(${HALF}px)` },
    { id: 'left',   label: 'Left',   transform: `rotateY(-90deg) translateZ(${HALF}px)` },
    { id: 'right',  label: 'Right',  transform: `rotateY(90deg) translateZ(${HALF}px)` },
    { id: 'top',    label: 'Top',    transform: `rotateX(90deg) translateZ(${HALF}px)` },
    { id: 'bottom', label: 'Bottom', transform: `rotateX(-90deg) translateZ(${HALF}px)` },
  ], []);

  /* ---------- edges ---------- */
  const edges: { id: EdgeId; style: React.CSSProperties }[] = useMemo(() => [
    { id: 'front-top',    style: { width: CUBE_SIZE, height: EDGE_THICK, transform: `rotateY(0deg) translateZ(${HALF}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'front-bottom', style: { width: CUBE_SIZE, height: EDGE_THICK, transform: `rotateY(0deg) translateZ(${HALF}px) translateY(${HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'front-left',   style: { width: EDGE_THICK, height: CUBE_SIZE, transform: `rotateY(0deg) translateZ(${HALF}px) translateX(${-HALF}px) translateX(${-EDGE_THICK/2}px)` } },
    { id: 'front-right',  style: { width: EDGE_THICK, height: CUBE_SIZE, transform: `rotateY(0deg) translateZ(${HALF}px) translateX(${HALF}px) translateX(${-EDGE_THICK/2}px)` } },
    { id: 'back-top',     style: { width: CUBE_SIZE, height: EDGE_THICK, transform: `rotateY(180deg) translateZ(${HALF}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'back-bottom',  style: { width: CUBE_SIZE, height: EDGE_THICK, transform: `rotateY(180deg) translateZ(${HALF}px) translateY(${HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'back-left',    style: { width: EDGE_THICK, height: CUBE_SIZE, transform: `rotateY(180deg) translateZ(${HALF}px) translateX(${-HALF}px) translateX(${-EDGE_THICK/2}px)` } },
    { id: 'back-right',   style: { width: EDGE_THICK, height: CUBE_SIZE, transform: `rotateY(180deg) translateZ(${HALF}px) translateX(${HALF}px) translateX(${-EDGE_THICK/2}px)` } },
    { id: 'top-left',     style: { width: EDGE_THICK, height: EDGE_THICK, transform: `rotateX(90deg) translateZ(${HALF}px) translateX(${-HALF}px) translateX(${-EDGE_THICK/2}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'top-right',    style: { width: EDGE_THICK, height: EDGE_THICK, transform: `rotateX(90deg) translateZ(${HALF}px) translateX(${HALF}px) translateX(${-EDGE_THICK/2}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'bottom-left',  style: { width: EDGE_THICK, height: EDGE_THICK, transform: `rotateX(-90deg) translateZ(${HALF}px) translateX(${-HALF}px) translateX(${-EDGE_THICK/2}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'bottom-right', style: { width: EDGE_THICK, height: EDGE_THICK, transform: `rotateX(-90deg) translateZ(${HALF}px) translateX(${HALF}px) translateX(${-EDGE_THICK/2}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
  ], []);

  /* ---------- corners ---------- */
  const corners: { id: CornerId; transform: string }[] = useMemo(() => [
    { id: 'front-top-right',    transform: `translateX(${HALF}px) translateY(${-HALF}px) translateZ(${HALF}px)` },
    { id: 'front-top-left',     transform: `translateX(${-HALF}px) translateY(${-HALF}px) translateZ(${HALF}px)` },
    { id: 'front-bottom-right', transform: `translateX(${HALF}px) translateY(${HALF}px) translateZ(${HALF}px)` },
    { id: 'front-bottom-left',  transform: `translateX(${-HALF}px) translateY(${HALF}px) translateZ(${HALF}px)` },
    { id: 'back-top-right',     transform: `translateX(${HALF}px) translateY(${-HALF}px) translateZ(${-HALF}px)` },
    { id: 'back-top-left',      transform: `translateX(${-HALF}px) translateY(${-HALF}px) translateZ(${-HALF}px)` },
    { id: 'back-bottom-right',  transform: `translateX(${HALF}px) translateY(${HALF}px) translateZ(${-HALF}px)` },
    { id: 'back-bottom-left',   transform: `translateX(${-HALF}px) translateY(${HALF}px) translateZ(${-HALF}px)` },
  ], []);

  /* ---------- render ---------- */
  return (
    <div
      className="viewcube-wrapper"
      style={{
        position: 'absolute',
        top: 56,
        right: 24,
        width: CUBE_SIZE + 40,
        height: CUBE_SIZE + 40,
        pointerEvents: 'none',
        zIndex: 15,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          perspective: 300,
          zIndex: 15,
        }}
      >
        {/* Home Button */}
        <button
          onClick={onHomeClick}
          title="Home View"
          style={{
            position: 'absolute',
            top: -16,
            left: -16,
            width: 24,
            height: 24,
            borderRadius: '50%',
            background: 'rgba(22, 27, 34, 0.8)',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#c9d1d9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            pointerEvents: 'auto',
            fontSize: 12,
            transition: 'all 0.2s',
            boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
            zIndex: 10,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(88, 166, 255, 0.9)';
            e.currentTarget.style.color = '#fff';
            e.currentTarget.style.borderColor = '#58a6ff';
            e.currentTarget.style.boxShadow = '0 0 12px rgba(88, 166, 255, 0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(22, 27, 34, 0.8)';
            e.currentTarget.style.color = '#c9d1d9';
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.5)';
          }}
        >
          ⌂
        </button>

        <div
          ref={cubeRef}
          style={{
            width: CUBE_SIZE,
            height: CUBE_SIZE,
            position: 'relative',
            margin: '0 auto 4px auto',
            transformStyle: 'preserve-3d',
            pointerEvents: 'auto',
          }}
        >
          {/* Faces */}
          {faces.map((f) => (
            <div
              key={f.id}
              style={faceStyle(f.transform, f.id)}
              onClick={onFaceClick(f.id)}
              onMouseEnter={() => setHovered(f.id)}
              onMouseLeave={() => setHovered(null)}
            >
              {f.label}
            </div>
          ))}

          {/* Edges */}
          {edges.map((edge) => (
            <div
              key={edge.id}
              style={{
                position: 'absolute',
                ...edge.style,
                background: hovered === edge.id ? 'rgba(88, 166, 255, 0.9)' : 'transparent',
                boxShadow: hovered === edge.id ? '0 0 12px rgba(88, 166, 255, 0.5)' : 'none',
                cursor: 'pointer',
                pointerEvents: 'auto',
                zIndex: 2,
                borderRadius: 4,
                transition: 'all 0.15s',
              }}
              onClick={onEdgeClick(edge.id)}
              onMouseEnter={() => setHovered(edge.id)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}

          {/* Corners */}
          {corners.map((c) => (
            <div
              key={c.id}
              style={{
                position: 'absolute',
                width: CORNER_SIZE * 1.5,
                height: CORNER_SIZE * 1.5,
                transform: `${c.transform} translate(-50%, -50%)`,
                background: hovered === c.id ? 'rgba(88, 166, 255, 0.9)' : 'transparent',
                boxShadow: hovered === c.id ? '0 0 16px rgba(88, 166, 255, 0.6)' : 'none',
                cursor: 'pointer',
                pointerEvents: 'auto',
                zIndex: 3,
                borderRadius: '50%',
                transition: 'all 0.15s',
              }}
              onClick={onCornerClick(c.id)}
              onMouseEnter={() => setHovered(c.id)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </div>

        {/* Label under cube */}
        <div
          style={{
            textAlign: 'center',
            marginTop: 8,
            fontSize: 10,
            fontWeight: 700,
            color: 'rgba(139, 148, 158, 0.9)',
            fontFamily: '"Inter", system-ui, sans-serif',
            pointerEvents: 'none',
            letterSpacing: '0.1em',
            textShadow: '0 2px 4px rgba(0,0,0,0.5)'
          }}
        >
          {hovered ? hovered.replace(/-/g, ' ').toUpperCase() : ''}
        </div>
      </div>
    </div>
  );
}
