'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { ShapeParam } from './shapes';

/* ── i18n ─────────────────────────────────────────────────────────────── */

const dict = {
  ko: { title: '치수 기즈모', lock: '잠금', unlock: '해제', reset: '초기화' },
  en: { title: 'Dimension Gizmo', lock: 'Lock', unlock: 'Unlock', reset: 'Reset' },
  ja: { title: '寸法ギズモ', lock: 'ロック', unlock: '解除', reset: 'リセット' },
  zh: { title: '尺寸工具', lock: '锁定', unlock: '解锁', reset: '重置' },
  es: { title: 'Gizmo de Dimensiones', lock: 'Bloquear', unlock: 'Desbloquear', reset: 'Restablecer' },
  ar: { title: 'أداة الأبعاد', lock: 'قفل', unlock: 'فتح', reset: 'إعادة' },
} as const;
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

/* ── Props ────────────────────────────────────────────────────────────── */

export interface InViewportGizmoProps {
  shapeId: string | null;
  params: Record<string, number>;
  paramDefs: ShapeParam[];
  /** Label lookup dict from parent (maps paramWidth → '폭' etc.) */
  labelDict: Record<string, string>;
  onParamChange: (key: string, value: number) => void;
  visible: boolean;
}

/* ── Axis-color mapping ───────────────────────────────────────────────── */

const AXIS_COLORS: Record<string, string> = {
  width: '#ff6b6b',   // X → Red
  height: '#51cf66',  // Y → Green
  depth: '#339af0',   // Z → Blue
  radius: '#fcc419',  // Generic → Yellow
  diameter: '#fcc419',
  length: '#ff6b6b',
  innerRadius: '#e599f7',
  outerRadius: '#fcc419',
  thickness: '#74c0fc',
};

function getAxisColor(key: string): string {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(AXIS_COLORS)) {
    if (lower.includes(k.toLowerCase())) return v;
  }
  return '#58a6ff';
}

/* ── Single dimension row ──────────────────────────────────────────────── */

function DimensionRow({
  paramDef,
  value,
  label,
  onChange,
  locked,
  onToggleLock,
  tt,
}: {
  paramDef: ShapeParam;
  value: number;
  label: string;
  onChange: (v: number) => void;
  locked: boolean;
  onToggleLock: () => void;
  tt: { title: string; lock: string; unlock: string; reset: string };
}) {
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const axisColor = getAxisColor(paramDef.key);
  const [dragStart, setDragStart] = useState<{ x: number; val: number } | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commitEdit = useCallback(() => {
    const n = parseFloat(editVal);
    if (!isNaN(n)) {
      const clamped = Math.max(paramDef.min, Math.min(paramDef.max, n));
      onChange(clamped);
    }
    setEditing(false);
  }, [editVal, onChange, paramDef]);

  const handleDragPointerDown = useCallback((e: React.PointerEvent) => {
    if (locked) return;
    setDragStart({ x: e.clientX, val: value });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [locked, value]);

  const handleDragPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const sensitivity = paramDef.step * 0.5;
    const delta = Math.round(dx * sensitivity);
    const newVal = Math.max(paramDef.min, Math.min(paramDef.max, dragStart.val + delta));
    onChange(newVal);
  }, [dragStart, onChange, paramDef]);

  const handleDragPointerUp = useCallback((e: React.PointerEvent) => {
    setDragStart(null);
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '4px 0',
      opacity: locked ? 0.45 : 1,
      transition: 'opacity 0.15s',
    }}>
      {/* Color indicator */}
      <div style={{
        width: 3, height: 22, borderRadius: 2,
        background: axisColor,
        boxShadow: `0 0 6px ${axisColor}60`,
        flexShrink: 0,
      }} />

      {/* Label */}
      <span style={{
        fontSize: 11, color: '#8b949e', fontWeight: 600,
        minWidth: 44, flexShrink: 0,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>

      {/* Value: click to edit, drag to scrub */}
      {editing ? (
        <input
          ref={inputRef}
          type="number"
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
          style={{
            width: 56, padding: '2px 6px', border: `1px solid ${axisColor}`,
            borderRadius: 4, background: 'rgba(0,0,0,0.4)', color: '#fff',
            fontSize: 12, fontFamily: 'monospace', fontWeight: 700,
            outline: 'none', textAlign: 'right',
          }}
          step={paramDef.step}
          min={paramDef.min}
          max={paramDef.max}
        />
      ) : (
        <span
          onClick={() => { if (!locked) { setEditVal(String(value)); setEditing(true); } }}
          onPointerDown={handleDragPointerDown}
          onPointerMove={handleDragPointerMove}
          onPointerUp={handleDragPointerUp}
          style={{
            fontSize: 13, fontFamily: 'monospace', fontWeight: 700,
            color: '#ffffff', cursor: locked ? 'default' : 'ew-resize',
            padding: '2px 6px', borderRadius: 4,
            background: dragStart ? `${axisColor}22` : 'transparent',
            border: `1px solid ${dragStart ? axisColor : 'transparent'}`,
            transition: 'all 0.1s',
            userSelect: 'none',
            minWidth: 48, textAlign: 'right',
          }}
          title={locked ? '' : 'Click to edit, drag to scrub'}
        >
          {value}
        </span>
      )}

      {/* Unit */}
      <span style={{ fontSize: 10, color: '#484f58', fontWeight: 600, flexShrink: 0 }}>
        {paramDef.unit}
      </span>

      {/* Lock toggle */}
      <button
        onClick={onToggleLock}
        title={locked ? tt.unlock : tt.lock}
        style={{
          width: 18, height: 18, borderRadius: 4,
          border: 'none', background: locked ? 'rgba(255,255,255,0.08)' : 'transparent',
          color: locked ? '#fcc419' : '#484f58',
          cursor: 'pointer', fontSize: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, transition: 'all 0.12s',
        }}
      >
        {locked ? '🔒' : '🔓'}
      </button>
    </div>
  );
}

/* ── Main Component ───────────────────────────────────────────────────── */

export default function InViewportGizmo({
  shapeId,
  params,
  paramDefs,
  labelDict,
  onParamChange,
  visible,
}: InViewportGizmoProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const tt = dict[langMap[seg] ?? 'en'];

  const [collapsed, setCollapsed] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 16, y: 120 });
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const dragRef = useRef({ active: false, sx: 0, sy: 0, ix: 0, iy: 0 });

  // Max 6 params shown (most important ones)
  const visibleParams = paramDefs.slice(0, 6);

  if (!visible || !shapeId || visibleParams.length === 0) return null;

  const toggleLock = (key: string) => {
    setLocked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        zIndex: 80,
        minWidth: collapsed ? 36 : 210,
        background: 'rgba(13, 17, 23, 0.82)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 14,
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        padding: collapsed ? '6px' : '10px 12px',
        pointerEvents: 'auto',
        transition: 'min-width 0.2s, padding 0.2s',
      }}
    >
      {/* Drag Handle / Header */}
      <div
        onPointerDown={e => {
          dragRef.current = { active: true, sx: e.clientX, sy: e.clientY, ix: pos.x, iy: pos.y };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={e => {
          if (!dragRef.current.active) return;
          setPos({
            x: dragRef.current.ix + (e.clientX - dragRef.current.sx),
            y: dragRef.current.iy + (e.clientY - dragRef.current.sy),
          });
        }}
        onPointerUp={e => {
          dragRef.current.active = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'grab', marginBottom: collapsed ? 0 : 6,
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>📐</span>
          {!collapsed && (
            <span style={{ fontSize: 11, fontWeight: 800, color: '#ffffff', letterSpacing: '0.02em' }}>
              {tt.title}
            </span>
          )}
        </div>
        <button
          onClick={() => setCollapsed(c => !c)}
          style={{
            border: 'none', background: 'rgba(255,255,255,0.05)',
            color: '#8b949e', cursor: 'pointer', fontSize: 10,
            width: 20, height: 20, borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {/* Dimension Rows */}
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibleParams.map(pd => (
            <DimensionRow
              key={pd.key}
              paramDef={pd}
              value={params[pd.key] ?? pd.default}
              label={labelDict[pd.labelKey] || pd.key}
              onChange={v => onParamChange(pd.key, v)}
              locked={locked.has(pd.key)}
              onToggleLock={() => toggleLock(pd.key)}
              tt={tt}
            />
          ))}
        </div>
      )}
    </div>
  );
}
