'use client';

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { OrbitControls, Grid, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { SketchProfile, SketchPoint, SketchTool } from './types';
import { resolveCssColor } from '../lib/glColors';

/**
 * 3D Sketch Canvas — draw on a selected plane (XY, XZ, YZ) directly in the 3D viewport.
 * Engineering-drawing style: XYZ axes, coordinate labels, dimension annotations,
 * crosshair guides, snap lines, Ctrl+Z undo, camera-angle plane indicator.
 * Supports auto plane-switching when rotating to a face-on view.
 */

type PlaneType = 'xy' | 'xz' | 'yz';

// WebGL materials (three.js) CANNOT parse CSS custom properties — passing
// color="var(--nx-ok)" to a <lineBasicMaterial>/<meshBasicMaterial> makes
// THREE.Color fall back to white, so the sketch profile / points / guides
// rendered as near-invisible lines on the light viewport. Use explicit hex
// for everything that lives in the 3D scene (DOM/<Html> labels keep CSS vars,
// which resolve fine). Vivid mid-tones stay visible on light AND dark themes.
// (2026-06-12 sketch visibility fix)
const GL = {
  ok:      '#16a34a', // closed profile (green)
  warn:    '#f59e0b', // open profile / secondary points (amber)
  error:   '#ef4444', // start point (red)
  accent:  '#3b82f6', // guides / handles (blue)
  accent2: '#58a6ff',
  neutral: '#64748b', // origin marker
  guide:   '#94a3b8', // dashed helper lines
} as const;

interface Sketch3DCanvasProps {
  profile: SketchProfile;
  onProfileChange: (profile: SketchProfile) => void;
  activeTool: SketchTool;
  sketchPlane: PlaneType;
  onUndo?: () => void;
  onPlaneChange?: (plane: PlaneType) => void; // called when camera snaps to a face-on view
  extrudeDepth?: number;
  onExtrudeDepthChange?: (depth: number) => void;
}

// Camera preset positions for each plane + isometric
type ViewPreset = 'top' | 'front' | 'right' | 'iso';
const VIEW_PRESETS: Record<ViewPreset, { pos: THREE.Vector3; plane: PlaneType | null; label: string; key: string }> = {
  top:   { pos: new THREE.Vector3(0, 300, 0),   plane: 'xz', label: 'Top',   key: 'T' },
  front: { pos: new THREE.Vector3(0, 0, 300),   plane: 'xy', label: 'Front', key: 'F' },
  right: { pos: new THREE.Vector3(300, 0, 0),   plane: 'yz', label: 'Right', key: 'R' },
  iso:   { pos: new THREE.Vector3(160, 160, 160), plane: null, label: 'Iso',   key: 'I' },
};

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function to2D(point3D: THREE.Vector3, plane: 'xy' | 'xz' | 'yz'): SketchPoint {
  if (plane === 'xy') return { x: point3D.x, y: point3D.y };
  if (plane === 'xz') return { x: point3D.x, y: point3D.z };
  return { x: point3D.y, y: point3D.z };
}

function to3D(point: SketchPoint, plane: 'xy' | 'xz' | 'yz'): THREE.Vector3 {
  if (plane === 'xy') return new THREE.Vector3(point.x, point.y, 0);
  if (plane === 'xz') return new THREE.Vector3(point.x, 0, point.y);
  return new THREE.Vector3(0, point.x, point.y);
}

function snap(val: number, grid: number): number {
  return Math.round(val / grid) * grid;
}

function dist2D(a: SketchPoint, b: SketchPoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function midpoint2D(a: SketchPoint, b: SketchPoint): SketchPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function getAllUniquePoints(profile: SketchProfile): SketchPoint[] {
  const pts: SketchPoint[] = [];
  for (const seg of profile.segments) {
    for (const p of seg.points) {
      if (!pts.some(q => q.x === p.x && q.y === p.y)) pts.push(p);
    }
  }
  return pts;
}

/* ─── XYZ Axis Arrows ──────────────────────────────────────────────────── */

function AxisArrow({ dir, color, label }: { dir: [number, number, number]; color: string; label: string }) {
  const length = 60;
  const points = useMemo(() => [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(dir[0] * length, dir[1] * length, dir[2] * length),
  ], [dir]);
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);
  const tipPos: [number, number, number] = [dir[0] * length, dir[1] * length, dir[2] * length];
  const endPos: [number, number, number] = [dir[0] * (length + 8), dir[1] * (length + 8), dir[2] * (length + 8)];

  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize());
    return q;
  }, [dir]);

  return (
    <group>
      <lineSegments geometry={geo}>
        <lineBasicMaterial color={color} linewidth={2} />
      </lineSegments>
      <mesh position={tipPos} quaternion={quat}>
        <coneGeometry args={[2, 6, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Html position={endPos} center style={{ pointerEvents: 'none' }}>
        <div style={{ color, fontSize: 13, fontWeight: 900, fontFamily: 'monospace', textShadow: '0 0 2px var(--nx-bg), 0 0 4px var(--nx-bg)' }}>
          {label}
        </div>
      </Html>
    </group>
  );
}

function AxisSystem() {
  return (
    <group>
      <AxisArrow dir={[1, 0, 0]} color={GL.error} label="X" />
      <AxisArrow dir={[0, 1, 0]} color="#22c55e" label="Y" />
      <AxisArrow dir={[0, 0, 1]} color={GL.accent} label="Z" />
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[1.5, 12, 12]} />
        <meshBasicMaterial color={GL.neutral} />
      </mesh>
      <Html position={[-6, -6, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{ color: 'var(--nx-text-2)', fontSize: 10, fontWeight: 700, fontFamily: 'monospace', textShadow: '0 0 2px var(--nx-bg), 0 0 4px var(--nx-bg)' }}>
          O(0,0,0)
        </div>
      </Html>
    </group>
  );
}

/* ─── Grid Tick Labels ──────────────────────────────────────────────────── */

function GridTickLabels({ plane, range = 100, step = 25 }: { plane: 'xy' | 'xz' | 'yz'; range?: number; step?: number }) {
  const ticks = useMemo(() => {
    const arr: Array<{ pos: [number, number, number]; label: string }> = [];
    for (let v = -range; v <= range; v += step) {
      if (v === 0) continue;
      if (plane === 'xy') {
        arr.push({ pos: [v, -3, 0], label: `${v}` });
        arr.push({ pos: [-5, v, 0], label: `${v}` });
      } else if (plane === 'xz') {
        arr.push({ pos: [v, 0, -3], label: `${v}` });
        arr.push({ pos: [-5, 0, v], label: `${v}` });
      } else {
        arr.push({ pos: [0, v, -3], label: `${v}` });
        arr.push({ pos: [0, -5, v], label: `${v}` });
      }
    }
    return arr;
  }, [plane, range, step]);

  return (
    <>
      {ticks.map((t, i) => (
        <Html key={i} position={t.pos} center style={{ pointerEvents: 'none' }}>
          {/* Background-colored halo (not a dark blur) keeps the tick numbers
              crisp on both themes — the previous dark blur muddied dark-gray
              text on the light viewport. (2026-06-12 readability) */}
          <div style={{ color: 'var(--nx-text-2)', fontSize: 9, fontWeight: 700, fontFamily: 'monospace', textShadow: '0 0 2px var(--nx-bg), 0 0 4px var(--nx-bg)', whiteSpace: 'nowrap' }}>
            {t.label}
          </div>
        </Html>
      ))}
    </>
  );
}

/* ─── Sketch Plane Helper ──────────────────────────────────────────────── */

function SketchPlaneHelper({ plane, size = 200 }: { plane: 'xy' | 'xz' | 'yz'; size?: number }) {
  const rotation = useMemo(() => {
    if (plane === 'xz') return new THREE.Euler(-Math.PI / 2, 0, 0);
    if (plane === 'yz') return new THREE.Euler(0, Math.PI / 2, 0);
    return new THREE.Euler(0, 0, 0);
  }, [plane]);

  return (
    <mesh rotation={rotation}>
      <planeGeometry args={[size, size]} />
      <meshBasicMaterial color="#667eea" transparent opacity={0.04} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

/* ─── Crosshair + Snap Guide Lines (follow mouse on sketch plane) ──────── */

function Crosshair({
  plane, profile, onCursorChange,
}: {
  plane: 'xy' | 'xz' | 'yz';
  profile: SketchProfile;
  onCursorChange: (pt: SketchPoint | null) => void;
}) {
  const { camera, raycaster, pointer, size: _size } = useThree();
  const [cursorPt, setCursorPt] = useState<SketchPoint | null>(null);
  const [snapTarget, setSnapTarget] = useState<SketchPoint | null>(null);
  const planeObj = useMemo(() => {
    if (plane === 'xy') return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    if (plane === 'xz') return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    return new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  }, [plane]);

  const existingPoints = useMemo(() => getAllUniquePoints(profile), [profile]);

  useFrame(() => {
    raycaster.setFromCamera(pointer, camera);
    const intersection = new THREE.Vector3();
    const hit = raycaster.ray.intersectPlane(planeObj, intersection);
    if (!hit) { setCursorPt(null); onCursorChange(null); return; }

    const snapped = new THREE.Vector3(snap(intersection.x, 5), snap(intersection.y, 5), snap(intersection.z, 5));
    const pt = to2D(snapped, plane);

    // Snap to existing points (within 8mm)
    let snappedToExisting: SketchPoint | null = null;
    for (const ep of existingPoints) {
      if (dist2D(pt, ep) < 8) { snappedToExisting = ep; break; }
    }

    // Snap to axis-aligned with existing points (within 4mm tolerance)
    let alignX: number | null = null;
    let alignY: number | null = null;
    for (const ep of existingPoints) {
      if (Math.abs(pt.x - ep.x) < 4) alignX = ep.x;
      if (Math.abs(pt.y - ep.y) < 4) alignY = ep.y;
    }

    const finalPt = snappedToExisting || {
      x: alignX !== null ? alignX : pt.x,
      y: alignY !== null ? alignY : pt.y,
    };

    setCursorPt(finalPt);
    setSnapTarget(snappedToExisting);
    onCursorChange(finalPt);
  });

  // Crosshair lines
  const crosshairGeo = useMemo(() => {
    if (!cursorPt) return null;
    const c3 = to3D(cursorPt, plane);
    const len = 200;
    const pts: THREE.Vector3[] = [];
    // Horizontal line
    if (plane === 'xy') {
      pts.push(new THREE.Vector3(-len, c3.y, 0), new THREE.Vector3(len, c3.y, 0));
      pts.push(new THREE.Vector3(c3.x, -len, 0), new THREE.Vector3(c3.x, len, 0));
    } else if (plane === 'xz') {
      pts.push(new THREE.Vector3(-len, 0, c3.z), new THREE.Vector3(len, 0, c3.z));
      pts.push(new THREE.Vector3(c3.x, 0, -len), new THREE.Vector3(c3.x, 0, len));
    } else {
      pts.push(new THREE.Vector3(0, -len, c3.z), new THREE.Vector3(0, len, c3.z));
      pts.push(new THREE.Vector3(0, c3.y, -len), new THREE.Vector3(0, c3.y, len));
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [cursorPt, plane]);

  // Snap alignment lines (to the point we're snapping with)
  const alignGeo = useMemo(() => {
    if (!cursorPt) return null;
    const pts: THREE.Vector3[] = [];
    const c3 = to3D(cursorPt, plane);
    for (const ep of existingPoints) {
      if (ep.x === cursorPt.x && ep.y === cursorPt.y) continue;
      // Vertical alignment
      if (Math.abs(cursorPt.x - ep.x) < 0.5) {
        pts.push(to3D(ep, plane), c3.clone());
      }
      // Horizontal alignment
      if (Math.abs(cursorPt.y - ep.y) < 0.5) {
        pts.push(to3D(ep, plane), c3.clone());
      }
    }
    if (pts.length === 0) return null;
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [cursorPt, existingPoints, plane]);

  return (
    <group>
      {crosshairGeo && (
        <lineSegments geometry={crosshairGeo}>
          <lineBasicMaterial color={GL.accent} transparent opacity={0.35} depthTest={false} />
        </lineSegments>
      )}
      {alignGeo && (
        <lineSegments geometry={alignGeo}>
          <lineBasicMaterial color={GL.warn} transparent opacity={0.6} depthTest={false} />
        </lineSegments>
      )}
      {/* Snap indicator ring */}
      {snapTarget && (
        <mesh position={to3D(snapTarget, plane)}>
          <ringGeometry args={[3, 4.5, 16]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.8} side={THREE.DoubleSide} depthTest={false} />
        </mesh>
      )}
      {/* Cursor coordinate tooltip */}
      {cursorPt && (
        <Html position={to3D({ x: cursorPt.x + 6, y: cursorPt.y + 6 }, plane)} style={{ pointerEvents: 'none' }}>
          <div style={{
            color: snapTarget ? 'var(--nx-ok)' : 'var(--nx-accent-2)',
            fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
            background: 'var(--nx-glass-strong)', padding: '2px 6px', borderRadius: 3,
            border: snapTarget ? '1px solid #22c55e' : '1px solid rgba(99,102,241,0.4)',
            whiteSpace: 'nowrap',
          }}>
            {snapTarget ? 'SNAP ' : ''}{cursorPt.x}, {cursorPt.y}
          </div>
        </Html>
      )}
      {/* Preview line from last point to cursor */}
      {cursorPt && <PreviewLine profile={profile} cursorPt={cursorPt} plane={plane} />}
    </group>
  );
}

/* ─── Preview Line (rubber-band from last point to cursor) ─────────────── */

function PreviewLine({ profile, cursorPt, plane }: { profile: SketchProfile; cursorPt: SketchPoint; plane: 'xy' | 'xz' | 'yz' }) {
  const geo = useMemo(() => {
    if (profile.closed || profile.segments.length === 0) return null;
    const lastSeg = profile.segments[profile.segments.length - 1];
    const lastPt = lastSeg.points[lastSeg.points.length - 1];
    const pts = [to3D(lastPt, plane), to3D(cursorPt, plane)];
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [profile, cursorPt, plane]);

  if (!geo) return null;
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={GL.accent} transparent opacity={0.6} depthTest={false} />
    </lineSegments>
  );
}

/* ─── Click Plane for Point Placement ──────────────────────────────────── */

function ClickPlane({
  plane, profile, onProfileChange, activeTool, cursorPt,
}: {
  plane: 'xy' | 'xz' | 'yz';
  profile: SketchProfile;
  onProfileChange: (p: SketchProfile) => void;
  activeTool: SketchTool;
  cursorPt: SketchPoint | null;
}) {
  const handleClick = useCallback((e: ThreeEvent<MouseEvent>) => {
    if (activeTool === 'select' || profile.closed) return;
    e.stopPropagation();

    // Use the snapped cursor point if available, otherwise fall back to raw click
    let pt2d: SketchPoint;
    if (cursorPt) {
      pt2d = cursorPt;
    } else {
      const point = e.point as THREE.Vector3;
      const snapped = new THREE.Vector3(snap(point.x, 5), snap(point.y, 5), snap(point.z, 5));
      pt2d = to2D(snapped, plane);
    }

    // Check if closing the profile
    const allPoints = profile.segments.flatMap(s => s.points);
    if (allPoints.length >= 3) {
      const first = allPoints[0];
      if (dist2D(pt2d, first) < 8) {
        const lastPt = allPoints[allPoints.length - 1];
        onProfileChange({
          segments: [...profile.segments, { type: 'line', points: [lastPt, first] }],
          closed: true,
        });
        return;
      }
    }

    if (profile.segments.length === 0) {
      onProfileChange({
        segments: [{ type: 'line', points: [pt2d, pt2d] }],
        closed: false,
      });
    } else {
      const lastSeg = profile.segments[profile.segments.length - 1];
      const lastPt = lastSeg.points[lastSeg.points.length - 1];
      onProfileChange({
        segments: [...profile.segments, { type: activeTool === 'arc' ? 'arc' : 'line', points: [lastPt, pt2d] }],
        closed: false,
      });
    }
  }, [activeTool, profile, plane, onProfileChange, cursorPt]);

  const rotation = useMemo(() => {
    if (plane === 'xz') return new THREE.Euler(-Math.PI / 2, 0, 0);
    if (plane === 'yz') return new THREE.Euler(0, Math.PI / 2, 0);
    return new THREE.Euler(0, 0, 0);
  }, [plane]);

  return (
    <mesh rotation={rotation} onClick={handleClick}>
      <planeGeometry args={[400, 400]} />
      <meshBasicMaterial visible={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

/* ─── Camera-Angle Plane Indicator ─────────────────────────────────────── */

function CameraPlaneIndicator({
  onPlaneDetected,
  onPlaneChange,
}: {
  onPlaneDetected: (plane: PlaneType | null) => void;
  onPlaneChange?: (plane: PlaneType) => void;
}) {
  const { camera } = useThree();
  const lastPlane = useRef<string | null>(null);

  useFrame(() => {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const ax = Math.abs(dir.x);
    const ay = Math.abs(dir.y);
    const az = Math.abs(dir.z);

    let detected: PlaneType | null = null;
    const threshold = 0.85;
    if (az > threshold && az > ax && az > ay) detected = 'xy';      // looking along Z → XY plane
    else if (ay > threshold && ay > ax && ay > az) detected = 'xz'; // looking along Y → XZ plane (top)
    else if (ax > threshold && ax > ay && ax > az) detected = 'yz'; // looking along X → YZ plane

    if (detected !== lastPlane.current) {
      lastPlane.current = detected;
      onPlaneDetected(detected);
      if (detected) onPlaneChange?.(detected); // auto-switch sketch plane
    }
  });

  return null;
}

/* ─── Camera Preset Controller ─────────────────────────────────────────── */

function CameraPresetController({
  preset, onDone,
}: {
  preset: ViewPreset | null;
  onDone: () => void;
}) {
  const { camera, invalidate } = useThree();
  const _controlsRef = useRef<unknown>(null);

  useEffect(() => {
    if (!preset) return;
    const { pos } = VIEW_PRESETS[preset];
    camera.position.set(pos.x, pos.y, pos.z);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    invalidate();
    onDone();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  return null;
}

/* ─── Profile Lines ────────────────────────────────────────────────────── */

function ProfileLines({ profile, plane }: { profile: SketchProfile; plane: 'xy' | 'xz' | 'yz' }) {
  const points = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (const seg of profile.segments) {
      if (seg.type === 'line' && seg.points.length >= 2) {
        pts.push(to3D(seg.points[0], plane));
        pts.push(to3D(seg.points[1], plane));
      }
    }
    return pts;
  }, [profile, plane]);

  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);

  if (points.length === 0) return null;
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={profile.closed ? GL.ok : GL.warn} linewidth={2} />
    </lineSegments>
  );
}

/* ─── Point Markers with Coordinate Labels ─────────────────────────────── */

function PointMarkers({ profile, plane }: { profile: SketchProfile; plane: 'xy' | 'xz' | 'yz' }) {
  const allPoints = useMemo(() => getAllUniquePoints(profile), [profile]);

  return (
    <>
      {allPoints.map((p, i) => {
        const pos3d = to3D(p, plane);
        return (
          <group key={i}>
            <mesh position={pos3d}>
              <sphereGeometry args={[1.5, 8, 8]} />
              <meshBasicMaterial color={i === 0 ? GL.error : GL.warn} />
            </mesh>
            <Html position={[pos3d.x, pos3d.y + 4, pos3d.z]} style={{ pointerEvents: 'none' }}>
              <div style={{
                color: i === 0 ? '#fca5a5' : '#fde68a',
                fontSize: 9, fontWeight: 700, fontFamily: 'monospace',
                background: 'var(--nx-glass-strong)', border: '1px solid var(--nx-border)', padding: '1px 4px', borderRadius: 3,
                whiteSpace: 'nowrap', textShadow: '0 0 2px var(--nx-bg), 0 0 4px var(--nx-bg)',
              }}>
                P{i}{i === 0 ? '(S)' : ''} ({p.x},{p.y})
              </div>
            </Html>
          </group>
        );
      })}
    </>
  );
}

/* ─── Dimension Annotations on Segments ────────────────────────────────── */

function DimensionAnnotations({ profile, plane }: { profile: SketchProfile; plane: 'xy' | 'xz' | 'yz' }) {
  const annotations = useMemo(() => {
    const result: Array<{ midPos: THREE.Vector3; length: number }> = [];
    for (const seg of profile.segments) {
      if (seg.type === 'line' && seg.points.length >= 2) {
        const a = seg.points[0];
        const b = seg.points[1];
        const len = dist2D(a, b);
        if (len < 0.5) continue;
        const mid = midpoint2D(a, b);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const nx = -dy / len;
        const ny = dx / len;
        const offset2d: SketchPoint = { x: mid.x + nx * 6, y: mid.y + ny * 6 };
        result.push({ midPos: to3D(offset2d, plane), length: len });
      }
    }
    return result;
  }, [profile, plane]);

  return (
    <>
      {annotations.map((ann, i) => (
        <Html key={i} position={ann.midPos} center style={{ pointerEvents: 'none' }}>
          <div style={{
            color: '#93c5fd', fontSize: 10, fontWeight: 700, fontFamily: 'monospace',
            background: 'var(--nx-glass-strong)', padding: '1px 5px', borderRadius: 3,
            border: '1px solid rgba(59,130,246,0.3)', whiteSpace: 'nowrap',
          }}>
            {ann.length.toFixed(1)}mm
          </div>
        </Html>
      ))}
    </>
  );
}

/* ─── Bounding Box with Dimensions ─────────────────────────────────────── */

function ProfileBoundingBox({ profile, plane }: { profile: SketchProfile; plane: PlaneType }) {
  // All hooks must run unconditionally — compute everything including geometry in one memo
  const bbData = useMemo(() => {
    const allPoints: SketchPoint[] = [];
    for (const seg of profile.segments) {
      for (const p of seg.points) allPoints.push(p);
    }
    if (allPoints.length < 2) return null;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of allPoints) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const w = maxX - minX, h = maxY - minY;
    if (w < 1 && h < 1) return null;

    const corners = [
      to3D({ x: minX - 3, y: minY - 3 }, plane),
      to3D({ x: maxX + 3, y: minY - 3 }, plane),
      to3D({ x: maxX + 3, y: maxY + 3 }, plane),
      to3D({ x: minX - 3, y: maxY + 3 }, plane),
    ];
    const linePts: THREE.Vector3[] = [];
    for (let i = 0; i < corners.length; i++) linePts.push(corners[i], corners[(i + 1) % corners.length]);
    const bbGeo = new THREE.BufferGeometry().setFromPoints(linePts);

    return {
      minX, maxX, minY, maxY, w, h, bbGeo,
      wPos: to3D({ x: (minX + maxX) / 2, y: minY - 12 }, plane),
      hPos: to3D({ x: maxX + 12, y: (minY + maxY) / 2 }, plane),
    };
  }, [profile, plane]);

  if (!bbData) return null;
  const { w, h, bbGeo, wPos, hPos } = bbData;

  return (
    <group>
      <lineSegments geometry={bbGeo}>
        <lineDashedMaterial color={GL.guide} dashSize={4} gapSize={3} linewidth={1} />
      </lineSegments>
      {w > 1 && (
        <Html position={wPos} center style={{ pointerEvents: 'none' }}>
          <div style={{ color: 'var(--nx-error)', fontSize: 11, fontWeight: 800, fontFamily: 'monospace', background: 'var(--nx-glass-strong)', padding: '2px 6px', borderRadius: 3, border: '1px solid rgba(239,68,68,0.3)' }}>
            W: {w.toFixed(1)}mm
          </div>
        </Html>
      )}
      {h > 1 && (
        <Html position={hPos} center style={{ pointerEvents: 'none' }}>
          <div style={{ color: 'var(--nx-ok)', fontSize: 11, fontWeight: 800, fontFamily: 'monospace', background: 'var(--nx-glass-strong)', padding: '2px 6px', borderRadius: 3, border: '1px solid rgba(34,197,94,0.3)' }}>
            H: {h.toFixed(1)}mm
          </div>
        </Html>
      )}
    </group>
  );
}

/* ─── Info HUD ─────────────────────────────────────────────────────────── */

const PLANE_LABELS: Record<PlaneType, string> = { xy: 'X-Y (Front)', xz: 'X-Z (Top)', yz: 'Y-Z (Right)' };

function InfoHUD({
  plane, profile, detectedPlane, canUndo, onViewPreset, onPlaneSelect, cursorPt,
}: {
  plane: PlaneType;
  profile: SketchProfile;
  detectedPlane: PlaneType | null;
  canUndo: boolean;
  onViewPreset: (preset: ViewPreset) => void;
  onPlaneSelect: (plane: PlaneType) => void;
  cursorPt?: SketchPoint | null;
}) {
  const pointCount = useMemo(() => getAllUniquePoints(profile).length, [profile]);
  const segCount = profile.segments.length;

  return (
    <div style={{
      position: 'absolute', top: 10, left: 10, zIndex: 10,
      display: 'flex', flexDirection: 'column', gap: 5,
    }}>
      {/* Active plane badge */}
      <div style={{
        background: 'var(--nx-glass-strong)', border: '1px solid var(--nx-accent)',
        padding: '6px 12px', borderRadius: 8,
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>📐</span>
        <div>
          <div style={{ color: 'var(--nx-accent-2)', fontSize: 12, fontWeight: 800, fontFamily: 'monospace' }}>
            {PLANE_LABELS[plane]}
          </div>
          <div style={{ color: 'var(--nx-text-3)', fontSize: 10, fontWeight: 600 }}>
            {pointCount} pts · {segCount} segs · {profile.closed ? '✅ Closed' : '⏳ Open'}
          </div>
        </div>
      </div>

      {/* View presets + plane selector — merged onto a single row (separated by
          a thin divider) to flatten the top-left tower. View buttons reorient
          the camera; the compact XY/XZ/YZ group sets the active sketch plane.
          (2026-06-12 declutter) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {(Object.entries(VIEW_PRESETS) as [ViewPreset, typeof VIEW_PRESETS[ViewPreset]][]).map(([key, v]) => (
          <button
            key={key}
            onClick={() => onViewPreset(key)}
            title={`${v.label} view${v.plane ? ` → ${PLANE_LABELS[v.plane]}` : ''}`}
            style={{
              padding: '4px 9px', borderRadius: 6, border: '1px solid var(--nx-border)',
              background: detectedPlane === v.plane ? 'var(--nx-accent-soft)' : 'var(--nx-glass-strong)',
              color: detectedPlane === v.plane ? 'var(--nx-accent-2)' : 'var(--nx-text-2)',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'monospace',
              outline: 'none', transition: 'all 0.12s',
            }}
          >
            {v.label}
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: 'var(--nx-border)', margin: '0 2px' }} />
        {(['xz', 'xy', 'yz'] as PlaneType[]).map(p => (
          <button
            key={p}
            onClick={() => onPlaneSelect(p)}
            title={`Sketch plane → ${PLANE_LABELS[p]}`}
            style={{
              padding: '4px 8px', borderRadius: 5, cursor: 'pointer',
              border: `1px solid ${plane === p ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
              background: plane === p ? 'var(--nx-accent-soft)' : 'var(--nx-glass-strong)',
              color: plane === p ? 'var(--nx-accent-2)' : 'var(--nx-text-3)',
              fontSize: 10, fontWeight: 700, fontFamily: 'monospace', outline: 'none',
            }}
          >
            {p === 'xy' ? 'XY' : p === 'xz' ? 'XZ' : 'YZ'}
          </button>
        ))}
      </div>

      {/* Camera-detected plane badge */}
      {detectedPlane && detectedPlane !== plane && (
        <div style={{
          background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)',
          padding: '3px 10px', borderRadius: 6,
          fontSize: 9, fontWeight: 700, fontFamily: 'monospace', color: 'var(--nx-accent-2)',
        }}>
          👁 Facing {PLANE_LABELS[detectedPlane]} — auto-switching
        </div>
      )}

      {/* Cursor coordinate display */}
      {cursorPt && (
        <div style={{ background: 'var(--nx-glass-strong)', border: '1px solid var(--nx-panel-2)', padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, color: 'var(--nx-border-strong)', fontFamily: 'monospace', display: 'flex', gap: 6, pointerEvents: 'none' }}>
          <span style={{ color: 'var(--nx-error)' }}>X</span><span style={{ color: 'var(--nx-text)' }}>{cursorPt.x.toFixed(1)}</span>
          <span style={{ color: 'var(--nx-ok)' }}>Y</span><span style={{ color: 'var(--nx-text)' }}>{cursorPt.y.toFixed(1)}</span>
          {/* Z is always 0 on the sketch plane */}
          <span style={{ color: 'var(--nx-accent)' }}>Z</span><span style={{ color: 'var(--nx-text)' }}>0.0</span>
          <span style={{ color: 'var(--nx-border-strong)' }}>mm</span>
        </div>
      )}
    </div>
  );
}

/* ─── Extrude Depth Handle ──────────────────────────────────────────────── */

function ExtrudeDepthHandle({
  profile,
  plane,
  depth,
  onDepthChange,
}: {
  profile: SketchProfile;
  plane: PlaneType;
  depth: number;
  onDepthChange: (d: number) => void;
}) {
  const { camera, gl } = useThree();
  const isDragging = useRef(false);
  const _dragStartY = useRef(0);
  const dragStartDepth = useRef(depth);
  const _raycaster = useRef(new THREE.Raycaster());
  const _hit = useRef(new THREE.Vector3());
  const dragPlane = useRef(new THREE.Plane());

  // Compute centroid of all profile points
  const centroid = useMemo(() => {
    const pts: SketchPoint[] = [];
    for (const seg of profile.segments) {
      for (const p of seg.points) pts.push(p);
    }
    if (pts.length === 0) return new THREE.Vector3(0, 0, 0);
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return to3D({ x: cx, y: cy }, plane);
  }, [profile, plane]);

  // Direction to extrude (normal of sketch plane)
  const extrudeDir = useMemo((): THREE.Vector3 => {
    if (plane === 'xy') return new THREE.Vector3(0, 0, 1);
    if (plane === 'xz') return new THREE.Vector3(0, 1, 0);
    return new THREE.Vector3(1, 0, 0);
  }, [plane]);

  const arrowPos = useMemo(
    () => centroid.clone().add(extrudeDir.clone().multiplyScalar(depth / 2)),
    [centroid, extrudeDir, depth],
  );

  const arrowQuat = useMemo(() => {
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), extrudeDir);
    return q;
  }, [extrudeDir]);

  const shaftGeo = useMemo(() => new THREE.CylinderGeometry(1.2, 1.2, Math.max(depth, 2), 10), [depth]);
  const coneGeo = useMemo(() => new THREE.ConeGeometry(3, 6, 10), []);

  const handlePointerDown = useCallback((e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    isDragging.current = true;
    dragStartDepth.current = depth;
    // Drag plane perpendicular to camera, through arrow tip
    const normal = camera.position.clone().normalize();
    dragPlane.current.setFromNormalAndCoplanarPoint(normal, arrowPos);
    (e.nativeEvent.target as HTMLElement)?.setPointerCapture?.(e.nativeEvent.pointerId);
  }, [depth, arrowPos, camera]);

  const handlePointerMove = useCallback((e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    if (!isDragging.current) return;
    e.stopPropagation();
    const rect = gl.domElement.getBoundingClientRect();
    const ndcX = ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1;
    _raycaster.current.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const hit = _raycaster.current.ray.intersectPlane(dragPlane.current, _hit.current);
    if (hit) {
      const proj = hit.clone().sub(centroid).dot(extrudeDir);
      const newDepth = Math.max(1, Math.min(500, Math.round(proj * 2)));
      onDepthChange(newDepth);
    }
  }, [camera, gl, centroid, extrudeDir, onDepthChange]);

  const handlePointerUp = useCallback((e: import('@react-three/fiber').ThreeEvent<PointerEvent>) => {
    if (!isDragging.current) return;
    e.stopPropagation();
    isDragging.current = false;
    (e.nativeEvent.target as HTMLElement)?.releasePointerCapture?.(e.nativeEvent.pointerId);
  }, []);

  if (!profile.closed) return null;

  return (
    <>
      <group position={[centroid.x, centroid.y, centroid.z]}>
        {/* Shaft along extrude direction */}
        <group quaternion={arrowQuat} position={[extrudeDir.x * depth / 2, extrudeDir.y * depth / 2, extrudeDir.z * depth / 2]}>
          <mesh geometry={shaftGeo}>
            <meshStandardMaterial color={GL.accent} roughness={0.4} metalness={0.1} transparent opacity={0.7} />
          </mesh>
          {/* Cone tip at top of shaft (drag handle) */}
          <mesh
            geometry={coneGeo}
            position={[0, Math.max(depth, 2) / 2 + 3, 0]}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <meshStandardMaterial color="#60a5fa" roughness={0.3} metalness={0.2} />
          </mesh>
          {/* Label */}
          <Html position={[0, Math.max(depth, 2) / 2 + 10, 0]} center style={{ pointerEvents: 'none' }}>
            <div style={{
              background: 'rgba(56,139,253,0.9)', color: 'var(--nx-text)',
              fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
              fontFamily: 'monospace', whiteSpace: 'nowrap',
            }}>
              ↕ {depth}mm
            </div>
          </Html>
        </group>
      </group>

      {/* Ghost wireframe preview of the extruded shape. Built from the profile's
          own 2D sketch coords and placed at WORLD ORIGIN — to3D already yields
          absolute coords, so on XY this sits exactly on the drawn profile and
          rises along +Z. It previously lived INSIDE the arrow's centroid +
          quaternion groups, which double-offset and mis-rotated it, so the prism
          floated away from the profile (reported #132). */}
      {depth > 0 && (() => {
        const pts2d = profile.segments.map(s => s.points[0]);
        if (pts2d.length < 3) return null;
        const shape = new THREE.Shape(pts2d.map(p => new THREE.Vector2(p.x, p.y)));
        const extGeo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
        // ExtrudeGeometry lies in local XY and extrudes along +Z. Rotate so the
        // profile lands on the active sketch plane (xy = identity = exact match).
        const rotation: [number, number, number] =
          plane === 'xy' ? [0, 0, 0]
            : plane === 'xz' ? [Math.PI / 2, 0, 0]
              : [0, -Math.PI / 2, 0];
        return (
          <mesh geometry={extGeo} rotation={rotation}>
            <meshBasicMaterial color={GL.accent} wireframe transparent opacity={0.25} />
          </mesh>
        );
      })()}
    </>
  );
}

/* ─── Main Component ───────────────────────────────────────────────────── */

export default function Sketch3DCanvas({ profile, onProfileChange, activeTool, sketchPlane, onUndo, onPlaneChange, extrudeDepth, onExtrudeDepthChange }: Sketch3DCanvasProps) {
  const [detectedPlane, setDetectedPlane] = useState<PlaneType | null>(null);
  const [cursorPt, setCursorPt] = useState<SketchPoint | null>(null);
  const [activePreset, setActivePreset] = useState<ViewPreset | null>(null);
  // Always face the active sketch plane head-on (a flat 2D drawing canvas) on
  // entry AND whenever the plane changes — fixes the disorienting tilted/iso view
  // and the "axes flip around" feeling when switching XY/XZ/YZ.
  useEffect(() => {
    setActivePreset(sketchPlane === 'xy' ? 'front' : sketchPlane === 'xz' ? 'top' : 'right');
  }, [sketchPlane]);
  const canUndo = profile.segments.length > 0;

  // Keyboard: Ctrl+Z undo, T/F/R/I view shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (onUndo) {
          onUndo();
        } else if (profile.segments.length > 0) {
          onProfileChange({ segments: profile.segments.slice(0, -1), closed: false });
        }
        return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === 't' || e.key === 'T') setActivePreset('top');
        if (e.key === 'f' || e.key === 'F') setActivePreset('front');
        if (e.key === 'r' || e.key === 'R') setActivePreset('right');
        if (e.key === 'i' || e.key === 'I') setActivePreset('iso');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUndo, profile, onProfileChange]);

  // When a preset is chosen, also switch the sketch plane immediately
  const handleViewPreset = useCallback((preset: ViewPreset) => {
    setActivePreset(preset);
    const targetPlane = VIEW_PRESETS[preset].plane;
    if (targetPlane) onPlaneChange?.(targetPlane);
  }, [onPlaneChange]);

  // Grid orientation per plane
  const gridProps = useMemo(() => {
    if (sketchPlane === 'xz') return { position: [0, 0, 0] as [number,number,number], rotation: undefined };
    if (sketchPlane === 'yz') return { position: [0, 0, 0] as [number,number,number], rotation: [0, 0, Math.PI / 2] as [number,number,number] };
    return { position: [0, -0.1, 0] as [number,number,number], rotation: [0, 0, 0] as [number,number,number] };
  }, [sketchPlane]);

  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--nx-bg)', position: 'relative', touchAction: 'none', userSelect: 'none' }}
      onDragStart={e => e.preventDefault()}>
      {/* HUD overlay */}
      <InfoHUD
        plane={sketchPlane}
        profile={profile}
        detectedPlane={detectedPlane}
        canUndo={canUndo}
        onViewPreset={handleViewPreset}
        onPlaneSelect={(p) => onPlaneChange?.(p)}
        cursorPt={cursorPt}
      />

      <Canvas camera={{ position: [80, 120, 160], fov: 50 }} style={{ width: '100%', height: '100%' }}>
        <color attach="background" args={[resolveCssColor('--nx-bg', '#0c0f14')]} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[20, 30, 15]} intensity={1} />

        {/* Camera plane detector — auto-switches sketch plane */}
        <CameraPlaneIndicator onPlaneDetected={setDetectedPlane} onPlaneChange={onPlaneChange} />

        {/* Camera preset teleporter */}
        <CameraPresetController preset={activePreset} onDone={() => setActivePreset(null)} />

        {/* XYZ Axis System */}
        <AxisSystem />

        {/* Sketch plane surface */}
        <SketchPlaneHelper plane={sketchPlane} />
        <ClickPlane plane={sketchPlane} profile={profile} onProfileChange={onProfileChange} activeTool={activeTool} cursorPt={cursorPt} />

        {/* Crosshair + snap guides + preview line */}
        <Crosshair plane={sketchPlane} profile={profile} onCursorChange={setCursorPt} />

        {/* Drawn profile */}
        <ProfileLines profile={profile} plane={sketchPlane} />
        <PointMarkers profile={profile} plane={sketchPlane} />

        {/* Engineering annotations */}
        <DimensionAnnotations profile={profile} plane={sketchPlane} />
        <ProfileBoundingBox profile={profile} plane={sketchPlane} />

        {/* Grid with tick labels */}
        <GridTickLabels plane={sketchPlane} range={100} step={25} />

        {/* Explicit hex — drei <Grid> feeds these to a WebGL shader as
            THREE.Color, which can't parse CSS vars (var(--…) → black). Mid
            grays stay visible on both light and dark themes; majors thicker
            so the scale reads clearly. (2026-06-12 contrast fix) */}
        <Grid
          args={[400, 400]}
          position={gridProps.position}
          rotation={gridProps.rotation}
          cellSize={5} cellThickness={0.5} cellColor="#aab1bd"
          sectionSize={25} sectionThickness={1.0} sectionColor="#727b8a"
          fadeDistance={320} fadeStrength={2} infiniteGrid
        />

        {/* Extrude depth drag handle */}
        {profile.closed && onExtrudeDepthChange && (
          <ExtrudeDepthHandle
            profile={profile}
            plane={sketchPlane}
            depth={extrudeDepth ?? 50}
            onDepthChange={onExtrudeDepthChange}
          />
        )}

        {/* Damping disabled for the sketch view: inertial glide left the camera
            micro-jittering as it settled after a view-preset switch (the whole
            scene incl. the axes appeared to shake then stop). A sketch is a
            precise editing surface — instant, stable framing beats the glide
            and removes the settle jitter entirely. */}
        <OrbitControls makeDefault enableDamping={false} />
      </Canvas>
    </div>
  );
}
