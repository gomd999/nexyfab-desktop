'use client';

import React, { useRef, useCallback, useState, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
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
/*  ViewCube component (place inside <Canvas>)                        */
/* ------------------------------------------------------------------ */

export default function ViewCube({ target = new THREE.Vector3() }: { target?: THREE.Vector3 }) {
  const { camera } = useThree();
  const cubeRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
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
        // Fit-all: move camera to iso distance covering target; navigateTo 사용
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

  /* ---------- per-frame: animate + sync cube rotation ---------- */
  useFrame((_, delta) => {
    const a = animRef.current;
    if (a.running) {
      a.t += delta / a.duration;
      if (a.t >= 1) {
        a.t = 1;
        a.running = false;
      }
      // smooth-step easing
      const t = a.t * a.t * (3 - 2 * a.t);
      camera.position.lerpVectors(a.startPos, a.endPos, t);
      camera.up.lerpVectors(a.startUp, a.endUp, t).normalize();
      camera.lookAt(target);
    }

    // Sync CSS cube rotation with camera orientation
    if (cubeRef.current) {
      // Build a rotation matrix that represents how the camera sees the world
      const m = new THREE.Matrix4().makeRotationFromQuaternion(camera.quaternion);
      // Invert because we want world-to-camera
      m.invert();
      // Extract as CSS matrix3d (column-major, but CSS uses column-major too)
      const e = m.elements;
      cubeRef.current.style.transform =
        `rotateX(0deg) matrix3d(${e[0]},${e[1]},${e[2]},${e[3]},${e[4]},${e[5]},${e[6]},${e[7]},${e[8]},${e[9]},${e[10]},${e[11]},${e[12]},${e[13]},${e[14]},${e[15]})`;
    }
  });

  /* ---------- face click handler ---------- */
  const onFaceClick = useCallback(
    (id: FaceId) => (e: React.MouseEvent) => {
      e.stopPropagation();
      navigateTo(FACE_VIEWS[id]);
    },
    [navigateTo],
  );

  const onEdgeClick = useCallback(
    (id: EdgeId) => (e: React.MouseEvent) => {
      e.stopPropagation();
      navigateTo(EDGE_VIEWS[id]);
    },
    [navigateTo],
  );

  const onCornerClick = useCallback(
    (id: CornerId) => (e: React.MouseEvent) => {
      e.stopPropagation();
      navigateTo(CORNER_VIEWS[id]);
    },
    [navigateTo],
  );

  /* ---------- face style helper ---------- */
  const faceStyle = (
    transform: string,
    id: string,
  ): React.CSSProperties => ({
    position: 'absolute',
    width: CUBE_SIZE,
    height: CUBE_SIZE,
    background: hovered === id ? 'rgba(100,160,255,0.85)' : 'rgba(60,68,86,0.82)',
    border: '1.5px solid rgba(180,190,210,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 9,
    fontWeight: 600,
    fontFamily: 'system-ui, sans-serif',
    color: hovered === id ? '#fff' : 'rgba(220,225,235,0.92)',
    cursor: 'pointer',
    userSelect: 'none',
    transform,
    backfaceVisibility: 'hidden',
    transition: 'background 0.15s',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  });

  /* ---------- faces definition ---------- */
  const faces: { id: FaceId; label: string; transform: string }[] = [
    { id: 'front',  label: 'Front',  transform: `rotateY(0deg) translateZ(${HALF}px)` },
    { id: 'back',   label: 'Back',   transform: `rotateY(180deg) translateZ(${HALF}px)` },
    { id: 'left',   label: 'Left',   transform: `rotateY(-90deg) translateZ(${HALF}px)` },
    { id: 'right',  label: 'Right',  transform: `rotateY(90deg) translateZ(${HALF}px)` },
    { id: 'top',    label: 'Top',    transform: `rotateX(90deg) translateZ(${HALF}px)` },
    { id: 'bottom', label: 'Bottom', transform: `rotateX(-90deg) translateZ(${HALF}px)` },
  ];

  /* ---------- edges: thin clickable strips between faces ---------- */
  const edges: { id: EdgeId; style: React.CSSProperties }[] = [
    // Front edges
    { id: 'front-top',    style: { width: CUBE_SIZE, height: EDGE_THICK, transform: `rotateY(0deg) translateZ(${HALF}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'front-bottom', style: { width: CUBE_SIZE, height: EDGE_THICK, transform: `rotateY(0deg) translateZ(${HALF}px) translateY(${HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'front-left',   style: { width: EDGE_THICK, height: CUBE_SIZE, transform: `rotateY(0deg) translateZ(${HALF}px) translateX(${-HALF}px) translateX(${-EDGE_THICK/2}px)` } },
    { id: 'front-right',  style: { width: EDGE_THICK, height: CUBE_SIZE, transform: `rotateY(0deg) translateZ(${HALF}px) translateX(${HALF}px) translateX(${-EDGE_THICK/2}px)` } },
    // Back edges
    { id: 'back-top',     style: { width: CUBE_SIZE, height: EDGE_THICK, transform: `rotateY(180deg) translateZ(${HALF}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'back-bottom',  style: { width: CUBE_SIZE, height: EDGE_THICK, transform: `rotateY(180deg) translateZ(${HALF}px) translateY(${HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'back-left',    style: { width: EDGE_THICK, height: CUBE_SIZE, transform: `rotateY(180deg) translateZ(${HALF}px) translateX(${-HALF}px) translateX(${-EDGE_THICK/2}px)` } },
    { id: 'back-right',   style: { width: EDGE_THICK, height: CUBE_SIZE, transform: `rotateY(180deg) translateZ(${HALF}px) translateX(${HALF}px) translateX(${-EDGE_THICK/2}px)` } },
    // Vertical edges (between left/right and top/bottom)
    { id: 'top-left',     style: { width: EDGE_THICK, height: EDGE_THICK, transform: `rotateX(90deg) translateZ(${HALF}px) translateX(${-HALF}px) translateX(${-EDGE_THICK/2}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'top-right',    style: { width: EDGE_THICK, height: EDGE_THICK, transform: `rotateX(90deg) translateZ(${HALF}px) translateX(${HALF}px) translateX(${-EDGE_THICK/2}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'bottom-left',  style: { width: EDGE_THICK, height: EDGE_THICK, transform: `rotateX(-90deg) translateZ(${HALF}px) translateX(${-HALF}px) translateX(${-EDGE_THICK/2}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
    { id: 'bottom-right', style: { width: EDGE_THICK, height: EDGE_THICK, transform: `rotateX(-90deg) translateZ(${HALF}px) translateX(${HALF}px) translateX(${-EDGE_THICK/2}px) translateY(${-HALF}px) translateY(${-EDGE_THICK/2}px)` } },
  ];

  /* ---------- corners ---------- */
  const corners: { id: CornerId; transform: string }[] = [
    { id: 'front-top-right',    transform: `translateX(${HALF}px) translateY(${-HALF}px) translateZ(${HALF}px)` },
    { id: 'front-top-left',     transform: `translateX(${-HALF}px) translateY(${-HALF}px) translateZ(${HALF}px)` },
    { id: 'front-bottom-right', transform: `translateX(${HALF}px) translateY(${HALF}px) translateZ(${HALF}px)` },
    { id: 'front-bottom-left',  transform: `translateX(${-HALF}px) translateY(${HALF}px) translateZ(${HALF}px)` },
    { id: 'back-top-right',     transform: `translateX(${HALF}px) translateY(${-HALF}px) translateZ(${-HALF}px)` },
    { id: 'back-top-left',      transform: `translateX(${-HALF}px) translateY(${-HALF}px) translateZ(${-HALF}px)` },
    { id: 'back-bottom-right',  transform: `translateX(${HALF}px) translateY(${HALF}px) translateZ(${-HALF}px)` },
    { id: 'back-bottom-left',   transform: `translateX(${-HALF}px) translateY(${HALF}px) translateZ(${-HALF}px)` },
  ];

  /* ---------- render ---------- */
  return (
    <Html
      as="div"
      wrapperClass="viewcube-wrapper"
      // Position way out so the Html anchor is off-screen; we position via CSS
      position={[0, 0, 0]}
      // Disable raycaster interference
      style={{
        position: 'fixed',
        bottom: 48,
        right: 12,
        width: CUBE_SIZE + 40,
        height: CUBE_SIZE + 40,
        pointerEvents: 'none',
        zIndex: 1000,
      }}
      // These prevent Html from doing its own transforms
      transform={false}
      portal={{ current: null as unknown as HTMLElement }}
    >
      {/* We break out of Html's transform and position ourselves fixed */}
      <div
        style={{
          position: 'fixed',
          top: 12,
          right: 12,
          width: CUBE_SIZE + 40,
          height: CUBE_SIZE + 40,
          pointerEvents: 'none',
          perspective: 300,
          zIndex: 1000,
        }}
      >
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
                background: hovered === edge.id ? 'rgba(100,160,255,0.7)' : 'transparent',
                cursor: 'pointer',
                pointerEvents: 'auto',
                zIndex: 2,
                borderRadius: 2,
                transition: 'background 0.15s',
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
                width: CORNER_SIZE,
                height: CORNER_SIZE,
                transform: `${c.transform} translate(-50%, -50%)`,
                background: hovered === c.id ? 'rgba(100,160,255,0.85)' : 'transparent',
                cursor: 'pointer',
                pointerEvents: 'auto',
                zIndex: 3,
                borderRadius: '50%',
                transition: 'background 0.15s',
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
            marginTop: 4,
            fontSize: 9,
            color: 'rgba(180,190,210,0.7)',
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none',
            letterSpacing: '0.5px',
          }}
        >
          {hovered ? hovered.replace(/-/g, ' ').toUpperCase() : ''}
        </div>
      </div>
    </Html>
  );
}
