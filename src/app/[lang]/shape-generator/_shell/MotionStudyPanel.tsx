'use client';

// Motion Study panel — timeline scrubber + play/pause + collision report.
// Drives motionStudy.runMotionStudy and motionDynamics.stepWorld. Lives in
// the BottomDrawer for now; promotable to a dedicated Motion mode later.
//
// Default scene seeded from the active assembly via shellBridgeStore.
// Manual driver editing is a follow-up; v1 lets the user attach revolute
// drives by name and watch collisions/IK update in real time.

import { useEffect, useMemo, useRef, useState } from 'react';
import { runMotionStudy, type MotionPart, type MotionDriver, type CollisionEvent } from '@/lib/nexyfab/motionStudy';
import { useShellBridge } from './shellBridgeStore';
import { useLang } from '../hooks/useLang';
import { loc } from '../lib/loc';

export interface MotionStudyPanelProps {
  isKo: boolean;
}

const STEP_MS = 50;

export function MotionStudyPanel({ isKo }: MotionStudyPanelProps) {
  const lang = useLang();
  const assemblyItems = useShellBridge(s => s.assemblyItems);
  const [durationSec, setDurationSec] = useState(5);
  const [tSec, setTSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [driver, setDriver] = useState<MotionDriver>({ kind: 'rotate', axis: 'z', degPerSec: 90 });
  const [driverPartId, setDriverPartId] = useState<string | null>(null);
  const [collisions, setCollisions] = useState<CollisionEvent[]>([]);
  const rafRef = useRef<number | null>(null);

  // Seed parts from assembly snapshot — center each part at origin with a
  // unit AABB. Real per-part bbox plugs in from sceneStore in a follow-up.
  const parts = useMemo<MotionPart[]>(() => {
    return assemblyItems.length > 0
      ? assemblyItems.slice(0, 8).map((item, idx) => ({
          id: item.id,
          aabb: {
            min: [idx * 30 - 20, -10, -10],
            max: [idx * 30 + 20, 10, 10],
          },
          motion: item.id === driverPartId ? driver : undefined,
        }))
      : [];
  }, [assemblyItems, driverPartId, driver]);

  useEffect(() => {
    if (parts.length === 0) {
      setCollisions([]);
      return;
    }
    const events = runMotionStudy(parts, { durationSec, stepMs: STEP_MS, maxCollisions: 50 });
    setCollisions(events);
  }, [parts, durationSec]);

  // Playback timer — advances tSec; clamps to duration; auto-pauses.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTSec(prev => {
        const next = prev + dt;
        if (next >= durationSec) {
          setPlaying(false);
          return durationSec;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, durationSec]);

  const activeCollisions = collisions.filter(c => c.timeSec <= tSec);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: 'var(--nx-text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{loc(lang, { ko: '모션 스터디', en: 'Motion Study', ja: 'モーションスタディ', zh: '运动仿真', es: 'Estudio de Movimiento', ar: 'دراسة الحركة' })}</div>
        <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
          {loc(lang, {
            ko: `${parts.length}개 파트 · ${collisions.length}개 충돌`,
            en: `${parts.length} parts · ${collisions.length} collisions`,
            ja: `${parts.length}個パーツ · ${collisions.length}個衝突`,
            zh: `${parts.length} 个零件 · ${collisions.length} 个干涉`,
            es: `${parts.length} piezas · ${collisions.length} colisiones`,
            ar: `${parts.length} قطعة · ${collisions.length} تصادم`,
          })}
        </div>
      </div>

      {/* Driver editor */}
      <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 1fr', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{loc(lang, { ko: '드라이브', en: 'Drive part', ja: '駆動パーツ', zh: '驱动零件', es: 'Pieza motriz', ar: 'الجزء المحرك' })}</span>
        <select
          value={driverPartId ?? ''}
          onChange={e => setDriverPartId(e.target.value || null)}
          style={selectStyle}
        >
          <option value="">{loc(lang, { ko: '(없음)', en: '(none)', ja: '(なし)', zh: '(无)', es: '(ninguno)', ar: '(لا شيء)' })}</option>
          {parts.map(p => <option key={p.id} value={p.id}>{p.id}</option>)}
        </select>
        <select
          value={driver.kind}
          onChange={e => {
            const k = e.target.value as 'rotate' | 'translate' | 'pendulum';
            setDriver(k === 'rotate' ? { kind: 'rotate', axis: 'z', degPerSec: 90 }
              : k === 'translate' ? { kind: 'translate', axis: 'x', mmPerSec: 20 }
              : { kind: 'pendulum', axis: 'z', amplitudeDeg: 30, periodSec: 2 });
          }}
          style={selectStyle}
        >
          <option value="rotate">{loc(lang, { ko: '회전', en: 'Rotate', ja: '回転', zh: '旋转', es: 'Rotar', ar: 'تدوير' })}</option>
          <option value="translate">{loc(lang, { ko: '병진', en: 'Translate', ja: '並進', zh: '平移', es: 'Trasladar', ar: 'إزاحة' })}</option>
          <option value="pendulum">{loc(lang, { ko: '진자', en: 'Pendulum', ja: '振り子', zh: '摆动', es: 'Péndulo', ar: 'بندول' })}</option>
        </select>
      </div>

      {/* Transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={() => setPlaying(p => !p)}
          style={{
            width: 32, height: 24, border: 0, borderRadius: 4,
            background: 'var(--nx-accent)', color: '#fff', cursor: 'pointer',
            fontSize: 12, fontWeight: 700,
          }}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button
          onClick={() => { setPlaying(false); setTSec(0); }}
          style={{
            width: 32, height: 24, border: '1px solid var(--nx-border)', borderRadius: 4,
            background: 'transparent', color: 'var(--nx-text)', cursor: 'pointer', fontSize: 12,
          }}
        >
          ⏮
        </button>
        <input
          type="range"
          min={0}
          max={durationSec}
          step={0.05}
          value={tSec}
          onChange={e => setTSec(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--nx-accent)' }}
        />
        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--nx-text-2)', minWidth: 60, textAlign: 'right' }}>
          {tSec.toFixed(2)} / {durationSec.toFixed(0)} s
        </span>
        <input
          type="number"
          min={1}
          max={120}
          value={durationSec}
          onChange={e => setDurationSec(Math.max(1, parseInt(e.target.value, 10) || 5))}
          style={{ width: 50, height: 22, padding: '0 4px', border: '1px solid var(--nx-border)', borderRadius: 3, background: 'var(--nx-bg)', color: 'var(--nx-text)', fontSize: 11, textAlign: 'right' }}
        />
      </div>

      {/* Collisions */}
      <div style={{ background: 'var(--nx-panel-2)', borderRadius: 4, padding: 8, maxHeight: 100, overflow: 'auto' }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--nx-text-2)', marginBottom: 4 }}>
          {loc(lang, {
            ko: `현재 시점까지 충돌 (${activeCollisions.length})`,
            en: `Collisions up to t (${activeCollisions.length})`,
            ja: `現在時点までの衝突 (${activeCollisions.length})`,
            zh: `截至当前时刻的干涉 (${activeCollisions.length})`,
            es: `Colisiones hasta t (${activeCollisions.length})`,
            ar: `التصادمات حتى اللحظة (${activeCollisions.length})`,
          })}
        </div>
        {activeCollisions.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)' }}>
            {loc(lang, { ko: '충돌 없음', en: 'No collisions', ja: '衝突なし', zh: '无干涉', es: 'Sin colisiones', ar: 'لا توجد تصادمات' })}
          </div>
        ) : (
          activeCollisions.map((c, i) => (
            <div key={i} style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: 'var(--nx-warn, #ffa800)' }}>
              t={c.timeSec.toFixed(2)}s — {c.partA} ↔ {c.partB} ({c.overlapMm.toFixed(2)} mm)
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  height: 22, padding: '0 6px', borderRadius: 3,
  border: '1px solid var(--nx-border)', background: 'var(--nx-bg)',
  color: 'var(--nx-text)', fontSize: 11,
};
