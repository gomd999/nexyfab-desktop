'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Joint, JointType, MotionStudyConfig, MotionFrame, MotionSummary } from './motionStudy';
import {
  createDefaultJoint,
  runMotionStudy,
  summarizeMotion,
  buildPartBBoxesFromGeometries,
} from './motionStudy';
import * as THREE from 'three';

const L: Record<string, Record<string, string>> = {
  ko: { title: '동작 해석', joint: '관절', addJoint: '관절 추가', run: '시뮬레이션 실행', playing: '재생 중...', stop: '정지', speed: '속도', duration: '시간(초)', fps: 'FPS', loop: '반복', collision: '충돌 감지', results: '결과', collisions: '충돌 횟수', frames: '프레임', noJoints: '관절을 추가하세요', revolute: '회전', prismatic: '직선', ball: '볼', cylindrical: '원통', planar: '평면', fixed: '고정', axis: '축', limits: '범위', parent: '부모', child: '자식', close: '닫기', maxVel: '최대 속도', liveJoints: '실시간 관절 값', velTable: '속도/가속도', joint_col: '관절', maxVel_col: '최대 속도', peakAcc_col: '최대 가속도', diagram: '관절 다이어그램' },
  en: { title: 'Motion Study', joint: 'Joint', addJoint: 'Add Joint', run: 'Run Simulation', playing: 'Playing...', stop: 'Stop', speed: 'Speed', duration: 'Duration (s)', fps: 'FPS', loop: 'Loop', collision: 'Collision Detect', results: 'Results', collisions: 'Collisions', frames: 'Frames', noJoints: 'Add joints to start', revolute: 'Revolute', prismatic: 'Prismatic', ball: 'Ball', cylindrical: 'Cylindrical', planar: 'Planar', fixed: 'Fixed', axis: 'Axis', limits: 'Limits', parent: 'Parent', child: 'Child', close: 'Close', maxVel: 'Max Velocity', liveJoints: 'Live Joint Values', velTable: 'Velocity / Acceleration', joint_col: 'Joint', maxVel_col: 'Max Vel', peakAcc_col: 'Peak Acc', diagram: 'Joint Diagram' },
  ja: { title: 'モーションスタディ', joint: 'ジョイント', addJoint: 'ジョイント追加', run: 'シミュレーション実行', playing: '再生中...', stop: '停止', speed: '速度', duration: '時間(秒)', fps: 'FPS', loop: 'ループ', collision: '衝突検出', results: '結果', collisions: '衝突回数', frames: 'フレーム', noJoints: 'ジョイントを追加してください', revolute: '回転', prismatic: '直動', ball: 'ボール', cylindrical: '円筒', planar: '平面', fixed: '固定', axis: '軸', limits: '範囲', parent: '親', child: '子', close: '閉じる', maxVel: '最大速度', liveJoints: 'リアルタイム関節値', velTable: '速度/加速度', joint_col: '関節', maxVel_col: '最大速度', peakAcc_col: 'ピーク加速度', diagram: '関節図' },
  cn: { title: '运动仿真', joint: '关节', addJoint: '添加关节', run: '运行仿真', playing: '播放中...', stop: '停止', speed: '速度', duration: '时长(秒)', fps: 'FPS', loop: '循环', collision: '碰撞检测', results: '结果', collisions: '碰撞次数', frames: '帧数', noJoints: '请添加关节', revolute: '旋转', prismatic: '移动', ball: '球', cylindrical: '圆柱', planar: '平面', fixed: '固定', axis: '轴', limits: '范围', parent: '父级', child: '子级', close: '关闭', maxVel: '最大速度', liveJoints: '实时关节值', velTable: '速度/加速度', joint_col: '关节', maxVel_col: '最大速度', peakAcc_col: '峰值加速度', diagram: '关节图' },
  es: { title: 'Estudio de Movimiento', joint: 'Junta', addJoint: 'Añadir Junta', run: 'Ejecutar Simulación', playing: 'Reproduciendo...', stop: 'Detener', speed: 'Velocidad', duration: 'Duración (s)', fps: 'FPS', loop: 'Bucle', collision: 'Detectar Colisión', results: 'Resultados', collisions: 'Colisiones', frames: 'Fotogramas', noJoints: 'Añadir juntas para comenzar', revolute: 'Revoluta', prismatic: 'Prismática', ball: 'Esférica', cylindrical: 'Cilíndrica', planar: 'Planar', fixed: 'Fija', axis: 'Eje', limits: 'Límites', parent: 'Padre', child: 'Hijo', close: 'Cerrar', maxVel: 'Vel. Máxima', liveJoints: 'Valores en Vivo', velTable: 'Vel / Aceleración', joint_col: 'Junta', maxVel_col: 'Vel. Máx', peakAcc_col: 'Acc. Pico', diagram: 'Diagrama' },
  ar: { title: 'دراسة الحركة', joint: 'مفصل', addJoint: 'إضافة مفصل', run: 'تشغيل المحاكاة', playing: 'جارٍ التشغيل...', stop: 'إيقاف', speed: 'السرعة', duration: 'المدة (ث)', fps: 'FPS', loop: 'تكرار', collision: 'كشف التصادم', results: 'النتائج', collisions: 'التصادمات', frames: 'الإطارات', noJoints: 'أضف مفاصل للبدء', revolute: 'دوراني', prismatic: 'منزلق', ball: 'كروي', cylindrical: 'أسطواني', planar: 'مستوي', fixed: 'ثابت', axis: 'محور', limits: 'حدود', parent: 'أب', child: 'ابن', close: 'إغلاق', maxVel: 'السرعة القصوى', liveJoints: 'قيم المفاصل المباشرة', velTable: 'السرعة / التسارع', joint_col: 'مفصل', maxVel_col: 'أقصى سرعة', peakAcc_col: 'ذروة التسارع', diagram: 'مخطط المفاصل' },
};
function t(lang: string, k: string) { return (L[lang] ?? L.en)[k] ?? (L.en[k] ?? k); }

interface MotionStudyPanelProps {
  lang: string;
  partIds: string[];
  /** Optional per-part geometries used to compute real bounding boxes for collision. */
  partGeometries?: Record<string, THREE.BufferGeometry>;
  onFrameUpdate?: (transforms: Record<string, THREE.Matrix4>) => void;
  onClose: () => void;
}

const JOINT_TYPES: JointType[] = ['revolute', 'prismatic', 'ball', 'cylindrical', 'planar', 'fixed'];

// ── Recompute joint value at a given time (mirrors runMotionStudy logic) ───────
function getJointValueAtTime(joint: Joint, effectiveTime: number): number {
  const range = joint.limits.max - joint.limits.min;
  const mid   = (joint.limits.max + joint.limits.min) / 2;
  return mid + (range / 2) * Math.sin(effectiveTime * joint.speed);
}

// ── Bar color based on how close to limit ────────────────────────────────────
function limitColor(ratio: number): string {
  if (ratio >= 1)   return '#f85149'; // at limit
  if (ratio >= 0.8) return '#e3b341'; // near limit
  return '#3fb950';                   // within limits
}

// ── Kinematic schematic SVG ──────────────────────────────────────────────────
interface JointDiagramProps {
  joints: Joint[];
  jointValues: Record<string, number>; // jointId → current value
}

function JointDiagram({ joints, jointValues }: JointDiagramProps) {
  if (joints.length === 0) return null;

  const W = 288;
  const H = 150;
  // Lay joints out horizontally, centred
  const spacing = Math.min(80, (W - 24) / Math.max(joints.length, 1));
  const startX  = (W - spacing * (joints.length - 1)) / 2;
  const cy      = H / 2;

  const elements: React.ReactNode[] = [];

  // Connecting backbone line
  if (joints.length > 1) {
    elements.push(
      <line
        key="backbone"
        x1={startX} y1={cy}
        x2={startX + spacing * (joints.length - 1)} y2={cy}
        stroke="#30363d" strokeWidth={2}
      />
    );
  }

  joints.forEach((joint, i) => {
    const cx = startX + i * spacing;
    const val = jointValues[joint.id] ?? 0;
    const range = joint.limits.max - joint.limits.min || 1;
    const ratio = Math.abs(val - (joint.limits.max + joint.limits.min) / 2) / (range / 2);
    const color = limitColor(Math.min(ratio, 1));

    if (joint.type === 'revolute' || joint.type === 'ball' || joint.type === 'cylindrical') {
      // Draw arc for range of motion
      const r   = 22;
      const minDeg = (joint.limits.min * 180) / Math.PI - 90;
      const maxDeg = (joint.limits.max * 180) / Math.PI - 90;
      const toRad  = (d: number) => (d * Math.PI) / 180;
      const ax1 = cx + r * Math.cos(toRad(minDeg));
      const ay1 = cy + r * Math.sin(toRad(minDeg));
      const ax2 = cx + r * Math.cos(toRad(maxDeg));
      const ay2 = cy + r * Math.sin(toRad(maxDeg));
      const large = Math.abs(joint.limits.max - joint.limits.min) > Math.PI ? 1 : 0;

      elements.push(
        <g key={joint.id}>
          {/* Range arc */}
          <path
            d={`M ${cx} ${cy} L ${ax1} ${ay1} A ${r} ${r} 0 ${large} 1 ${ax2} ${ay2} Z`}
            fill="rgba(139,92,246,0.12)" stroke="#6e40c9" strokeWidth={0.8}
          />
          {/* Current angle line */}
          <line
            x1={cx} y1={cy}
            x2={cx + r * Math.cos(toRad(val * 180 / Math.PI - 90))}
            y2={cy + r * Math.sin(toRad(val * 180 / Math.PI - 90))}
            stroke={color} strokeWidth={2} strokeLinecap="round"
          />
          {/* Joint circle */}
          <circle cx={cx} cy={cy} r={6} fill="#161b22" stroke={color} strokeWidth={1.5} />
          {/* Label */}
          <text x={cx} y={cy + r + 14} textAnchor="middle" fill="#8b949e" fontSize={8} fontFamily="monospace">
            {joint.name.slice(0, 8)}
          </text>
          <text x={cx} y={cy + r + 24} textAnchor="middle" fill={color} fontSize={7} fontFamily="monospace">
            {(val * 180 / Math.PI).toFixed(1)}°
          </text>
        </g>
      );
    } else if (joint.type === 'prismatic') {
      // Double-headed arrow showing range + current position indicator
      const halfLen = 28;
      const normVal = range > 0 ? (val - joint.limits.min) / range : 0.5;
      const dotX    = cx - halfLen + normVal * halfLen * 2;

      elements.push(
        <g key={joint.id}>
          {/* Track */}
          <line x1={cx - halfLen} y1={cy} x2={cx + halfLen} y2={cy} stroke="#30363d" strokeWidth={3} strokeLinecap="round" />
          {/* Arrowheads */}
          <polygon points={`${cx - halfLen - 6},${cy} ${cx - halfLen + 4},${cy - 4} ${cx - halfLen + 4},${cy + 4}`} fill="#6e7681" />
          <polygon points={`${cx + halfLen + 6},${cy} ${cx + halfLen - 4},${cy - 4} ${cx + halfLen - 4},${cy + 4}`} fill="#6e7681" />
          {/* Position indicator */}
          <circle cx={dotX} cy={cy} r={5} fill={color} />
          {/* Label */}
          <text x={cx} y={cy + 20} textAnchor="middle" fill="#8b949e" fontSize={8} fontFamily="monospace">
            {joint.name.slice(0, 8)}
          </text>
          <text x={cx} y={cy + 30} textAnchor="middle" fill={color} fontSize={7} fontFamily="monospace">
            {val.toFixed(1)} mm
          </text>
        </g>
      );
    } else {
      // Fixed / planar — gray rectangle
      elements.push(
        <g key={joint.id}>
          <rect x={cx - 8} y={cy - 8} width={16} height={16} fill="#21262d" stroke="#30363d" strokeWidth={1} rx={2} />
          <text x={cx} y={cy + 22} textAnchor="middle" fill="#484f58" fontSize={8} fontFamily="monospace">
            {joint.name.slice(0, 8)}
          </text>
        </g>
      );
    }
  });

  return (
    <svg width={W} height={H} style={{ display: 'block', background: '#0d1117', borderRadius: 6, border: '1px solid #21262d' }}>
      {elements}
    </svg>
  );
}

// ── Live Joint Values panel ───────────────────────────────────────────────────
interface LiveJointValuesProps {
  joints: Joint[];
  jointValues: Record<string, number>;
}

function LiveJointValues({ joints, jointValues }: LiveJointValuesProps) {
  if (joints.length === 0) return null;

  return (
    <div style={{ marginTop: 8, padding: 8, background: '#0d1117', borderRadius: 8, border: '1px solid #21262d' }}>
      {joints.map(joint => {
        const val   = jointValues[joint.id] ?? 0;
        const isRev = joint.type === 'revolute' || joint.type === 'ball' || joint.type === 'cylindrical';
        const range = joint.limits.max - joint.limits.min || 1;
        const mid   = (joint.limits.max + joint.limits.min) / 2;
        // ratio: 0 = at centre, 1 = at limit extreme
        const ratio = Math.min(1, Math.abs(val - mid) / (range / 2));
        const pct   = ratio * 100;
        const color = limitColor(ratio);
        const displayVal = isRev
          ? `${(val * 180 / Math.PI).toFixed(1)}°`
          : `${val.toFixed(2)} mm`;

        return (
          <div key={joint.id} style={{ marginBottom: 5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
              <span style={{ fontSize: 9, color: '#8b949e', fontFamily: 'monospace' }}>
                {joint.name}
                <span style={{ color: '#484f58' }}> {joint.parentPartId.slice(0, 6)} → {joint.childPartId.slice(0, 6)}</span>
              </span>
              <span style={{ fontSize: 9, color: color, fontFamily: 'monospace', fontWeight: 700 }}>{displayVal}</span>
            </div>
            <div style={{ height: 4, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.05s linear' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Velocity / Acceleration Table ────────────────────────────────────────────
interface VelAccTableProps {
  lang: string;
  joints: Joint[];
  summary: MotionSummary;
}

// Typical servo limits for colour-coding
const SERVO_MAX_VEL_DEG_S  = 360; // deg/s
const SERVO_MAX_ACC_DEG_S2 = 720; // deg/s²

function VelAccTable({ lang, joints, summary }: VelAccTableProps) {
  if (joints.length === 0) return null;

  const rows = joints.map(joint => {
    const maxVelRaw = summary.maxVelocity[joint.id] ?? 0; // rad/s or mm/s (from summarizeMotion)
    const isRev     = joint.type === 'revolute' || joint.type === 'ball' || joint.type === 'cylindrical';
    // Convert to deg/s for revolute, keep mm/s for prismatic
    const maxVelDisplay = isRev ? maxVelRaw * 180 / Math.PI : maxVelRaw;
    // Estimated peak acceleration: vel × speed (angular frequency ≈ speed)
    const peakAcc    = maxVelDisplay * Math.abs(joint.speed);
    const unit       = isRev ? 'deg/s' : 'mm/s';
    const accUnit    = isRev ? 'deg/s²' : 'mm/s²';

    const velLimit  = isRev ? SERVO_MAX_VEL_DEG_S  : 500;
    const accLimit  = isRev ? SERVO_MAX_ACC_DEG_S2  : 1000;
    const velRatio  = maxVelDisplay / velLimit;
    const accRatio  = peakAcc / accLimit;
    const velColor  = limitColor(Math.min(velRatio, 1));
    const accColor  = limitColor(Math.min(accRatio, 1));

    return { joint, maxVelDisplay, peakAcc, unit, accUnit, velColor, accColor };
  });

  return (
    <div style={{ marginTop: 8, padding: 8, background: '#0d1117', borderRadius: 8, border: '1px solid #21262d' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', marginBottom: 6 }}>{t(lang, 'velTable')}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9, fontFamily: 'monospace' }}>
        <thead>
          <tr>
            <th style={{ color: '#484f58', fontWeight: 600, textAlign: 'left', paddingBottom: 4 }}>{t(lang, 'joint_col')}</th>
            <th style={{ color: '#484f58', fontWeight: 600, textAlign: 'right', paddingBottom: 4 }}>{t(lang, 'maxVel_col')}</th>
            <th style={{ color: '#484f58', fontWeight: 600, textAlign: 'right', paddingBottom: 4 }}>{t(lang, 'peakAcc_col')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ joint, maxVelDisplay, peakAcc, unit, accUnit, velColor, accColor }) => (
            <tr key={joint.id}>
              <td style={{ color: '#8b949e', paddingBottom: 3, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{joint.name}</td>
              <td style={{ color: velColor, textAlign: 'right', paddingBottom: 3 }}>{maxVelDisplay.toFixed(1)} {unit}</td>
              <td style={{ color: accColor, textAlign: 'right', paddingBottom: 3 }}>{peakAcc.toFixed(1)} {accUnit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────
export default function MotionStudyPanel({
  lang,
  partIds,
  partGeometries,
  onFrameUpdate,
  onClose,
}: MotionStudyPanelProps) {
  const [joints, setJoints]               = useState<Joint[]>([]);
  const [duration, setDuration]           = useState(3);
  const [fps, setFps]                     = useState(30);
  const [loop, setLoop]                   = useState(true);
  const [collisionDetect, setCollisionDetect] = useState(true);
  const [running, setRunning]             = useState(false);
  const [playing, setPlaying]             = useState(false);
  const [progress, setProgress]           = useState(0);
  const [frames, setFrames]               = useState<MotionFrame[]>([]);
  const [summary, setSummary]             = useState<MotionSummary | null>(null);
  const [playIdx, setPlayIdx]             = useState(0);
  // Stored config (joints + duration) needed for live value recompute during playback
  const lastConfigRef = useRef<{ joints: Joint[]; duration: number } | null>(null);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addJoint = useCallback(() => {
    const parent = partIds[0] || 'part_0';
    const child  = partIds[1] || partIds[0] || 'part_1';
    setJoints(prev => [...prev, createDefaultJoint(parent, child)]);
  }, [partIds]);

  const updateJoint = useCallback((id: string, patch: Partial<Joint>) => {
    setJoints(prev => prev.map(j => j.id === id ? { ...j, ...patch } : j));
  }, []);

  const removeJoint = useCallback((id: string) => {
    setJoints(prev => prev.filter(j => j.id !== id));
  }, []);

  const handleRun = useCallback(async () => {
    if (joints.length === 0) return;
    setRunning(true);
    setProgress(0);

    const config: MotionStudyConfig = {
      name: 'study_1',
      joints,
      keyframes: [],
      duration,
      fps,
      loop,
      collisionDetect,
    };

    // Store config for later value recomputation
    lastConfigRef.current = { joints: [...joints], duration };

    // Build bounding boxes — use real geometries when available, fall back to unit boxes
    let bboxes: Record<string, THREE.Box3>;
    if (partGeometries && Object.keys(partGeometries).length > 0) {
      bboxes = buildPartBBoxesFromGeometries(partGeometries);
      // Fill in any part that has no geometry with a small unit box
      partIds.forEach(id => {
        if (!bboxes[id]) {
          bboxes[id] = new THREE.Box3(
            new THREE.Vector3(-10, -10, -10),
            new THREE.Vector3(10, 10, 10),
          );
        }
      });
    } else {
      // No geometries — space parts out in X so they don't start overlapping
      bboxes = {};
      partIds.forEach((id, i) => {
        bboxes[id] = new THREE.Box3(
          new THREE.Vector3(-15 + i * 40, -15, -15),
          new THREE.Vector3(15 + i * 40, 15, 15),
        );
      });
    }

    const result = await runMotionStudy(
      config,
      bboxes,
      (f, total) => setProgress(Math.round((f / total) * 100)),
    );
    setFrames(result);
    setSummary(summarizeMotion(result, config));
    setRunning(false);
    setProgress(100);
  }, [joints, duration, fps, loop, collisionDetect, partIds, partGeometries]);

  // ── Playback loop ──────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    if (playing) {
      if (playRef.current) clearInterval(playRef.current);
      playRef.current = null;
      setPlaying(false);
    } else {
      setPlaying(true);
      setPlayIdx(0);
    }
  }, [playing]);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    playRef.current = setInterval(() => {
      setPlayIdx(prev => {
        const next = prev + 1;
        if (next >= frames.length) {
          if (loop) return 0;
          setPlaying(false);
          return prev;
        }
        const frame = frames[next];
        if (frame && onFrameUpdate) onFrameUpdate(frame.transforms);
        return next;
      });
    }, 1000 / fps);
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [playing, frames, fps, loop, onFrameUpdate]);

  // ── Compute live joint values for current playIdx ─────────────────────────
  const liveJointValues = useMemo<Record<string, number>>(() => {
    const cfg = lastConfigRef.current;
    if (!cfg || frames.length === 0) return {};
    const frame = frames[Math.min(playIdx, frames.length - 1)];
    if (!frame) return {};
    const effectiveTime = cfg.duration > 0
      ? (frame.time % cfg.duration)
      : frame.time;
    const vals: Record<string, number> = {};
    for (const joint of cfg.joints) {
      vals[joint.id] = getJointValueAtTime(joint, effectiveTime);
    }
    return vals;
  }, [playIdx, frames]);

  // Active joints for live display (use lastConfigRef to keep stable after run)
  const activeJoints = lastConfigRef.current?.joints ?? joints;

  return (
    <div style={{ position: 'fixed', top: 60, right: 16, width: 320, maxHeight: 'calc(100vh - 80px)', overflow: 'auto', background: '#161b22', border: '1px solid #30363d', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.6)', zIndex: 800, direction: lang === 'ar' ? 'rtl' : 'ltr' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #21262d', background: 'rgba(139,92,246,0.06)' }}>
        <span style={{ fontSize: 16, marginRight: 6 }}>🎬</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#c9d1d9', flex: 1 }}>{t(lang, 'title')}</span>
        <button onClick={onClose} style={{ border: 'none', background: 'none', color: '#6e7681', fontSize: 16, cursor: 'pointer' }}>✕</button>
      </div>

      <div style={{ padding: 12 }}>
        {/* Joint list */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#8b949e' }}>{t(lang, 'joint')} ({joints.length})</span>
          <button onClick={addJoint} style={{ padding: '3px 10px', borderRadius: 5, border: '1px solid #30363d', background: '#21262d', color: '#58a6ff', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>+ {t(lang, 'addJoint')}</button>
        </div>

        {joints.length === 0 && (
          <div style={{ padding: 16, textAlign: 'center', color: '#484f58', fontSize: 11 }}>{t(lang, 'noJoints')}</div>
        )}

        {joints.map(j => (
          <div key={j.id} style={{ padding: 8, background: '#0d1117', borderRadius: 8, border: '1px solid #21262d', marginBottom: 6, fontSize: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <input value={j.name} onChange={e => updateJoint(j.id, { name: e.target.value })} style={{ flex: 1, background: 'transparent', border: 'none', color: '#c9d1d9', fontWeight: 700, fontSize: 11 }} />
              <button onClick={() => removeJoint(j.id)} style={{ border: 'none', background: 'none', color: '#f85149', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              <div>
                <label style={{ color: '#6e7681', fontSize: 9 }}>{t(lang, 'joint')}</label>
                <select value={j.type} onChange={e => updateJoint(j.id, { type: e.target.value as JointType })} style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 10, padding: '2px 4px' }}>
                  {JOINT_TYPES.map(jt => <option key={jt} value={jt}>{t(lang, jt)}</option>)}
                </select>
              </div>
              <div>
                <label style={{ color: '#6e7681', fontSize: 9 }}>{t(lang, 'speed')}</label>
                <input type="number" value={j.speed} step={0.1} onChange={e => updateJoint(j.id, { speed: parseFloat(e.target.value) || 0 })} style={{ width: '100%', background: '#161b22', border: '1px solid #30363d', borderRadius: 4, color: '#c9d1d9', fontSize: 10, padding: '2px 4px' }} />
              </div>
            </div>
          </div>
        ))}

        {/* Config */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
          <div>
            <label style={{ fontSize: 9, color: '#6e7681', fontWeight: 600 }}>{t(lang, 'duration')}</label>
            <input type="number" value={duration} min={0.5} max={60} step={0.5} onChange={e => setDuration(parseFloat(e.target.value) || 3)} style={{ width: '100%', background: '#0d1117', border: '1px solid #21262d', borderRadius: 4, color: '#c9d1d9', fontSize: 10, padding: '3px 6px' }} />
          </div>
          <div>
            <label style={{ fontSize: 9, color: '#6e7681', fontWeight: 600 }}>{t(lang, 'fps')}</label>
            <input type="number" value={fps} min={10} max={60} onChange={e => setFps(parseInt(e.target.value) || 30)} style={{ width: '100%', background: '#0d1117', border: '1px solid #21262d', borderRadius: 4, color: '#c9d1d9', fontSize: 10, padding: '3px 6px' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#8b949e', cursor: 'pointer' }}>
            <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} style={{ accentColor: '#8b5cf6' }} />
            {t(lang, 'loop')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#8b949e', cursor: 'pointer' }}>
            <input type="checkbox" checked={collisionDetect} onChange={e => setCollisionDetect(e.target.checked)} style={{ accentColor: '#f85149' }} />
            {t(lang, 'collision')}
          </label>
        </div>

        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={running || joints.length === 0}
          style={{ width: '100%', padding: '8px 0', marginTop: 10, borderRadius: 6, border: 'none', background: running ? '#21262d' : 'linear-gradient(135deg, #8b5cf6, #388bfd)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: running ? 'default' : 'pointer' }}
        >
          {running ? `${progress}%...` : t(lang, 'run')}
        </button>

        {/* Playback controls + scrubber */}
        {frames.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button onClick={togglePlay} style={{ padding: '4px 12px', borderRadius: 5, border: 'none', background: playing ? '#f85149' : '#3fb950', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                {playing ? '⏹ ' + t(lang, 'stop') : '▶ Play'}
              </button>
              <input
                type="range" min={0} max={frames.length - 1} value={playIdx}
                onChange={e => {
                  const idx = parseInt(e.target.value);
                  setPlayIdx(idx);
                  const f = frames[idx];
                  if (f && onFrameUpdate) onFrameUpdate(f.transforms);
                }}
                style={{ flex: 1, accentColor: '#8b5cf6', height: 3 }}
              />
              <span style={{ fontSize: 9, color: '#6e7681', fontFamily: 'monospace', minWidth: 30 }}>{playIdx}/{frames.length - 1}</span>
            </div>
            {/* Time label */}
            {frames[playIdx] && (
              <div style={{ fontSize: 9, color: '#484f58', textAlign: 'right', marginTop: 2, fontFamily: 'monospace' }}>
                {frames[playIdx].time.toFixed(2)}s
              </div>
            )}
          </div>
        )}

        {/* ── Live Joint Values ── */}
        {frames.length > 0 && activeJoints.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', marginBottom: 4 }}>{t(lang, 'liveJoints')}</div>
            <LiveJointValues joints={activeJoints} jointValues={liveJointValues} />
          </div>
        )}

        {/* ── Joint Diagram ── */}
        {frames.length > 0 && activeJoints.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', marginBottom: 4 }}>{t(lang, 'diagram')}</div>
            <JointDiagram joints={activeJoints} jointValues={liveJointValues} />
          </div>
        )}

        {/* ── Results ── */}
        {summary && (
          <div style={{ marginTop: 10, padding: 8, background: '#0d1117', borderRadius: 8, border: '1px solid #21262d' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8b949e', marginBottom: 4 }}>{t(lang, 'results')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 10 }}>
              <div style={{ color: '#6e7681' }}>{t(lang, 'frames')}</div>
              <div style={{ color: '#c9d1d9', fontWeight: 700, textAlign: 'right' }}>{summary.totalFrames}</div>
              <div style={{ color: '#6e7681' }}>{t(lang, 'collisions')}</div>
              <div style={{ color: summary.collisionCount > 0 ? '#f85149' : '#3fb950', fontWeight: 700, textAlign: 'right' }}>{summary.collisionCount}</div>
            </div>
          </div>
        )}

        {/* ── Velocity / Acceleration Table ── */}
        {summary && (
          <VelAccTable lang={lang} joints={activeJoints} summary={summary} />
        )}
      </div>
    </div>
  );
}
