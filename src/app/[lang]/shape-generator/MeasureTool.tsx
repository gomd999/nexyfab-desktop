'use client';
/**
 * MeasureTool.tsx — 완성형 측정 도구
 *
 * 모드:
 *   distance — 2점 클릭 → 거리 측정
 *   angle    — 3점 클릭 → 각도 측정 (중간점이 꼭짓점)
 *   radius   — 3점 클릭 → 원호/원 반지름 계산
 *
 * 기능:
 *   - 치수선(화살표) 렌더링
 *   - 측정 기록 (토글 꺼도 유지 — zustand measureStore)
 *   - 개별 삭제 / 전체 지우기
 *   - 클립보드 복사
 *   - Esc로 진행 중 측정 취소
 */

import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { create } from 'zustand';
import { formatWithUnit, type UnitSystem } from './units';

// ─── 전역 측정 스토어 (토글 꺼도 기록 유지) ──────────────────────────────────

export type MeasureMode = 'distance' | 'angle' | 'radius';

export interface MeasureEntry {
  id: number;
  mode: MeasureMode;
  value: number;   // distance mm | angle deg | radius mm
  points: { x: number; y: number; z: number }[];
  label: string;
  createdAt: number;
}

interface MeasureStore {
  entries: MeasureEntry[];
  addEntry: (e: MeasureEntry) => void;
  removeEntry: (id: number) => void;
  clearAll: () => void;
}

let _nextId = 1;

export const useMeasureStore = create<MeasureStore>((set) => ({
  entries: [],
  addEntry: (e) => set((s) => ({ entries: [e, ...s.entries].slice(0, 30) })),
  removeEntry: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
  clearAll: () => set({ entries: [] }),
}));

// ─── 원 3점 통과 반지름 계산 ──────────────────────────────────────────────────

function circumradius(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  const ab = b.distanceTo(a);
  const bc = c.distanceTo(b);
  const ca = a.distanceTo(c);
  const area2 = new THREE.Vector3()
    .crossVectors(
      new THREE.Vector3().subVectors(b, a),
      new THREE.Vector3().subVectors(c, a),
    )
    .length();
  if (area2 < 1e-10) return Infinity;
  return (ab * bc * ca) / (2 * area2);
}

// ─── 치수선 컴포넌트 ──────────────────────────────────────────────────────────

function DimensionLine({ p1, p2, label, color = '#fbbf24' }: {
  p1: THREE.Vector3; p2: THREE.Vector3; label: string; color?: string;
}) {
  const mid = useMemo(() => new THREE.Vector3().addVectors(p1, p2).multiplyScalar(0.5), [p1, p2]);
  const lineGeo = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints([p1, p2]);
  }, [p1, p2]);

  // 화살표 콘 방향 계산
  const dir = useMemo(() => new THREE.Vector3().subVectors(p2, p1).normalize(), [p1, p2]);
  const rot1 = useMemo(() => {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return new THREE.Euler().setFromQuaternion(q);
  }, [dir]);
  const rot2 = useMemo(() => {
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
    return new THREE.Euler().setFromQuaternion(q);
  }, [dir]);

  const arrowSize = 0.8;

  const lineObj = useMemo(() => {
    const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
    return new THREE.Line(lineGeo, mat);
  }, [lineGeo, color]);

  return (
    <group>
      <primitive object={lineObj} />
      {/* 화살촉 p1 */}
      <mesh position={p1} rotation={rot2}>
        <coneGeometry args={[arrowSize * 0.3, arrowSize, 8]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      {/* 화살촉 p2 */}
      <mesh position={p2} rotation={rot1}>
        <coneGeometry args={[arrowSize * 0.3, arrowSize, 8]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      {/* 라벨 */}
      <Html position={mid} center style={{ pointerEvents: 'none' }}>
        <div style={{
          background: 'rgba(0,0,0,0.85)',
          color,
          fontSize: 11,
          fontWeight: 700,
          padding: '3px 8px',
          borderRadius: 4,
          whiteSpace: 'nowrap',
          border: `1px solid ${color}55`,
          fontFamily: 'monospace',
          userSelect: 'none',
        }}>
          {label}
        </div>
      </Html>
    </group>
  );
}

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────

interface MeasureToolProps {
  active: boolean;
  mode?: MeasureMode;
  unitSystem?: UnitSystem;
  lang?: string;
}

export default function MeasureTool({
  active,
  mode = 'distance',
  unitSystem = 'mm',
  lang = 'ko',
}: MeasureToolProps) {
  const { scene, camera, gl } = useThree();
  const raycasterRef = useRef(new THREE.Raycaster());
  const [wip, setWip] = useState<THREE.Vector3[]>([]); // work-in-progress points

  const { entries, addEntry, removeEntry, clearAll } = useMeasureStore();

  const requiredClicks = mode === 'angle' ? 3 : mode === 'radius' ? 3 : 2;
  const isKo = lang === 'ko';

  // Esc로 진행 중 취소
  useEffect(() => {
    if (!active) { setWip([]); return; }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWip([]);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active]);

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!active) return;
      e.stopPropagation();

      const rect = gl.domElement.getBoundingClientRect();
      const ne = e.nativeEvent ?? e;
      const x = ((ne.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((ne.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(new THREE.Vector2(x, y), camera);
      const meshes: THREE.Object3D[] = [];
      scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o); });
      const hits = raycasterRef.current.intersectObjects(meshes, false);
      if (!hits.length) return;

      const pt = hits[0].point.clone();
      const next = [...wip, pt];

      if (next.length < requiredClicks) {
        setWip(next);
        return;
      }

      // 계산 완료
      let value: number;
      let label: string;
      if (mode === 'distance') {
        value = next[0].distanceTo(next[1]);
        label = formatWithUnit(value, unitSystem, 2);
      } else if (mode === 'angle') {
        const v1 = new THREE.Vector3().subVectors(next[0], next[1]).normalize();
        const v2 = new THREE.Vector3().subVectors(next[2], next[1]).normalize();
        value = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, v1.dot(v2)))));
        label = `${value.toFixed(1)}°`;
      } else {
        // radius — 3점 외접원 반지름
        value = circumradius(next[0], next[1], next[2]);
        label = isFinite(value) ? `R${formatWithUnit(value, unitSystem, 2)}` : 'R∞';
      }

      const entry: MeasureEntry = {
        id: _nextId++,
        mode,
        value,
        points: next.map(p => ({ x: p.x, y: p.y, z: p.z })),
        label,
        createdAt: Date.now(),
      };
      addEntry(entry);
      setWip([]);
    },
    [active, camera, gl, scene, wip, mode, unitSystem, requiredClicks, addEntry, isKo],
  );

  // ── WIP 라인 지오메트리
  const wipLineGeo = useMemo(() => {
    if (wip.length < 2) return null;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < wip.length - 1; i++) pts.push(wip[i], wip[i + 1]);
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [wip]);

  const wipLabelPos = useMemo(() => {
    if (wip.length < 2) return null;
    if (mode === 'angle' && wip.length === 3) return wip[1].clone();
    return new THREE.Vector3().addVectors(wip[0], wip[1]).multiplyScalar(0.5);
  }, [wip, mode]);

  const wipLabel = useMemo(() => {
    if (mode === 'distance' && wip.length === 2)
      return formatWithUnit(wip[0].distanceTo(wip[1]), unitSystem, 2);
    if (mode === 'angle' && wip.length === 3) {
      const v1 = new THREE.Vector3().subVectors(wip[0], wip[1]).normalize();
      const v2 = new THREE.Vector3().subVectors(wip[2], wip[1]).normalize();
      const deg = THREE.MathUtils.radToDeg(Math.acos(Math.max(-1, Math.min(1, v1.dot(v2)))));
      return `${deg.toFixed(1)}°`;
    }
    if (mode === 'radius' && wip.length === 3) {
      const r = circumradius(wip[0], wip[1], wip[2]);
      return isFinite(r) ? `R${formatWithUnit(r, unitSystem, 2)}` : 'R∞';
    }
    return null;
  }, [wip, mode, unitSystem]);

  const promptText = useMemo(() => {
    if (!active) return null;
    const clicks = requiredClicks - wip.length;
    if (mode === 'distance') {
      return wip.length === 0
        ? (isKo ? '첫 번째 점 클릭' : 'Click first point')
        : (isKo ? '두 번째 점 클릭' : 'Click second point');
    }
    if (mode === 'angle') {
      const msgs = isKo
        ? ['시작점 클릭', '꼭짓점 클릭', '끝점 클릭']
        : ['Click start', 'Click vertex', 'Click end'];
      return msgs[wip.length] ?? '';
    }
    // radius
    const msgs = isKo
      ? ['첫 번째 점 클릭', '두 번째 점 클릭', '세 번째 점 클릭']
      : ['Click point 1', 'Click point 2', 'Click point 3'];
    return msgs[wip.length] ?? '';
  }, [active, mode, wip, requiredClicks, isKo]);

  const POINT_COLORS = ['#ef4444', '#3b82f6', '#22c55e'];

  if (!active && entries.length === 0) return null;

  return (
    <>
      {/* ── 3D 레이어 (active일 때만) ── */}
      {active && (
        <group onPointerDown={handlePointerDown}>
          {/* 클릭 인터셉터 */}
          <mesh visible={false}>
            <sphereGeometry args={[20000, 1, 1]} />
            <meshBasicMaterial />
          </mesh>

          {/* WIP 점 */}
          {wip.map((p, i) => (
            <mesh key={i} position={p}>
              <sphereGeometry args={[0.6, 16, 16]} />
              <meshBasicMaterial color={POINT_COLORS[i % POINT_COLORS.length]} depthTest={false} />
            </mesh>
          ))}

          {/* WIP 라인 */}
          {wipLineGeo && (
            <lineSegments geometry={wipLineGeo}>
              <lineDashedMaterial color="#fbbf24" dashSize={2} gapSize={1.5} linewidth={1} depthTest={false} />
            </lineSegments>
          )}

          {/* WIP 라이브 라벨 */}
          {wipLabelPos && wipLabel && (
            <Html position={wipLabelPos} center style={{ pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(0,0,0,0.82)',
                color: '#fbbf24',
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: 4,
                whiteSpace: 'nowrap',
                border: '1px solid rgba(251,191,36,0.4)',
                fontFamily: 'monospace',
              }}>
                {wipLabel}
              </div>
            </Html>
          )}
        </group>
      )}

      {/* ── 확정된 측정 치수선 ── */}
      {entries.map((entry) => {
        const pts = entry.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
        if (entry.mode === 'distance' && pts.length === 2) {
          return (
            <DimensionLine key={entry.id} p1={pts[0]} p2={pts[1]} label={entry.label} />
          );
        }
        if (entry.mode === 'angle' && pts.length === 3) {
          return (
            <group key={entry.id}>
              <DimensionLine p1={pts[0]} p2={pts[1]} label="" color="#a78bfa" />
              <DimensionLine p1={pts[1]} p2={pts[2]} label={entry.label} color="#a78bfa" />
            </group>
          );
        }
        if (entry.mode === 'radius' && pts.length === 3) {
          // 세 점 표시 + 중심점 계산 (근사)
          return (
            <group key={entry.id}>
              {pts.map((p, i) => (
                <mesh key={i} position={p}>
                  <sphereGeometry args={[0.4, 12, 12]} />
                  <meshBasicMaterial color="#34d399" depthTest={false} />
                </mesh>
              ))}
              <Html
                position={new THREE.Vector3().addVectors(pts[0], pts[2]).multiplyScalar(0.5)}
                center
                style={{ pointerEvents: 'none' }}
              >
                <div style={{
                  background: 'rgba(0,0,0,0.82)',
                  color: '#34d399',
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: 4,
                  border: '1px solid rgba(52,211,153,0.4)',
                  fontFamily: 'monospace',
                  whiteSpace: 'nowrap',
                }}>
                  {entry.label}
                </div>
              </Html>
            </group>
          );
        }
        return null;
      })}

      {/* ── HUD: 프롬프트 + 기록 패널 ── */}
      <Html fullscreen style={{ pointerEvents: 'none' }}>
        {/* 프롬프트 */}
        {active && promptText && (
          <div style={{
            position: 'absolute',
            bottom: 56,
            left: '50%',
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
          }}>
            <div style={{
              background: 'rgba(0,0,0,0.8)',
              color: '#e6edf3',
              fontSize: 11,
              fontWeight: 600,
              padding: '5px 14px',
              borderRadius: 6,
              border: '1px solid #30363d',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{ opacity: 0.6 }}>📐</span>
              {promptText}
              {wip.length > 0 && (
                <span style={{ color: '#8b949e', fontSize: 10 }}>
                  {isKo ? '(Esc: 취소)' : '(Esc: cancel)'}
                </span>
              )}
            </div>
          </div>
        )}

        {/* 측정 기록 패널 */}
        {entries.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 56,
              right: 12,
              width: 200,
              background: 'rgba(13,17,23,0.93)',
              border: '1px solid #30363d',
              borderRadius: 10,
              padding: '8px 0',
              pointerEvents: 'auto',
              boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{
              padding: '0 10px 5px',
              fontSize: 10,
              fontWeight: 800,
              color: '#8b949e',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              borderBottom: '1px solid #30363d',
              marginBottom: 2,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>{isKo ? '측정 기록' : 'Measurements'}</span>
              <button
                onClick={clearAll}
                style={{ fontSize: 10, color: '#8b949e', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                {isKo ? '모두 지우기' : 'Clear all'}
              </button>
            </div>

            <div style={{ maxHeight: 240, overflowY: 'auto' }}>
              {entries.map((entry) => (
                <MeasureEntryRow
                  key={entry.id}
                  entry={entry}
                  onDelete={() => removeEntry(entry.id)}
                  isKo={isKo}
                />
              ))}
            </div>
          </div>
        )}
      </Html>
    </>
  );
}

// ─── 기록 행 ──────────────────────────────────────────────────────────────────

function MeasureEntryRow({
  entry,
  onDelete,
  isKo,
}: {
  entry: MeasureEntry;
  onDelete: () => void;
  isKo: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const modeIcon = entry.mode === 'distance' ? '↔' : entry.mode === 'angle' ? '∠' : 'R';
  const modeColor = entry.mode === 'distance' ? '#fbbf24' : entry.mode === 'angle' ? '#a78bfa' : '#34d399';

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(entry.label).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch(() => {});
  }, [entry.label]);

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '4px 10px',
      gap: 6,
      fontSize: 11,
      borderBottom: '1px solid #21262d',
    }}>
      <span style={{ color: modeColor, fontWeight: 700, minWidth: 14, textAlign: 'center' }}>
        {modeIcon}
      </span>
      <span style={{ color: modeColor, fontWeight: 700, fontFamily: 'monospace', flex: 1 }}>
        {entry.label}
      </span>
      <button
        onClick={handleCopy}
        title={isKo ? '복사' : 'Copy'}
        style={{
          fontSize: 10,
          color: copied ? '#22d3ee' : '#8b949e',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 2px',
        }}
      >
        {copied ? '✓' : '⎘'}
      </button>
      <button
        onClick={onDelete}
        title={isKo ? '삭제' : 'Delete'}
        style={{
          fontSize: 10,
          color: '#8b949e',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0 2px',
        }}
      >
        ×
      </button>
    </div>
  );
}
