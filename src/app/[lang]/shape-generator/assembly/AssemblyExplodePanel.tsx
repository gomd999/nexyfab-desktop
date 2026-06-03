'use client';

/**
 * AssemblyExplodePanel — Phase 3.4 of NexyFab Pro own-CAD (ADR-013).
 *
 * Standalone control surface for the exploded-view engine
 * (lib/assembly/explodeView.ts). Presentational only: the host
 * (AssemblyBrowserModal) owns the AssemblyState + the explode amount, runs
 * `buildExplodedState` / `interpolateExplode`, and feeds the displaced state
 * into Assembly3DViewer. This panel just renders the controls and reports
 * changes back via callbacks.
 *
 *   - Axis heuristic picker (mate_axes / bbox_center / gravity_normal).
 *   - Spread (scale) numeric input.
 *   - Amount slider t ∈ [0, 1] — 0 = assembled, 1 = fully exploded.
 *   - Reset button → snaps the amount back to 0.
 *   - Read-only "N parts move" count.
 *
 * Standalone-by-design: NO Three.js / OCCT import, mounts in jsdom without a
 * GL context. Does NOT modify explodeView.ts or Assembly3DViewer.tsx.
 *
 * Test surface (data-testids):
 *   solver-assembly-explode-panel
 *   solver-assembly-explode-heuristic    (select)
 *   solver-assembly-explode-scale        (number input)
 *   solver-assembly-explode-amount       (range slider)
 *   solver-assembly-explode-reset        (button)
 *   solver-assembly-explode-count        (read-only moving-parts count)
 */

import React, { useCallback } from 'react';
import type { ExplodeAxisHeuristic } from '@/lib/assembly/explodeView';

// ─── i18n (6 langs) ────────────────────────────────────────────────────────

export type AssemblyLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  title: string;
  axis: string;
  axisMateAxes: string;
  axisBboxCenter: string;
  axisGravityNormal: string;
  spread: string;
  amount: string;
  reset: string;
  partsMove: string; // "{n} parts move" — {n} substituted by caller
}

const dict: Record<AssemblyLang, Dict> = {
  ko: {
    title: '분해 보기', axis: '축',
    axisMateAxes: '메이트 축', axisBboxCenter: 'BBox 중심', axisGravityNormal: '중력 법선',
    spread: '간격', amount: '분해 정도', reset: '초기화', partsMove: '개 부품 이동',
  },
  en: {
    title: 'Exploded View', axis: 'Axis',
    axisMateAxes: 'Mate axes', axisBboxCenter: 'BBox center', axisGravityNormal: 'Gravity normal',
    spread: 'Spread', amount: 'Amount', reset: 'Reset', partsMove: 'parts move',
  },
  ja: {
    title: '分解表示', axis: '軸',
    axisMateAxes: 'メイト軸', axisBboxCenter: 'BBox中心', axisGravityNormal: '重力法線',
    spread: '間隔', amount: '分解量', reset: 'リセット', partsMove: '個の部品が移動',
  },
  zh: {
    title: '爆炸视图', axis: '轴',
    axisMateAxes: '配合轴', axisBboxCenter: 'BBox 中心', axisGravityNormal: '重力法线',
    spread: '间距', amount: '分解程度', reset: '重置', partsMove: '个零件移动',
  },
  es: {
    title: 'Vista explosionada', axis: 'Eje',
    axisMateAxes: 'Ejes de unión', axisBboxCenter: 'Centro BBox', axisGravityNormal: 'Normal de gravedad',
    spread: 'Separación', amount: 'Cantidad', reset: 'Reiniciar', partsMove: 'piezas se mueven',
  },
  ar: {
    title: 'عرض مفكك', axis: 'محور',
    axisMateAxes: 'محاور التزاوج', axisBboxCenter: 'مركز BBox', axisGravityNormal: 'العمودي للجاذبية',
    spread: 'تباعد', amount: 'المقدار', reset: 'إعادة', partsMove: 'قطعة تتحرك',
  },
};

const HEURISTICS: ReadonlyArray<ExplodeAxisHeuristic> = [
  'mate_axes',
  'bbox_center',
  'gravity_normal',
];

// ─── props ────────────────────────────────────────────────────────────────

export interface AssemblyExplodePanelProps {
  lang?: AssemblyLang;
  heuristic: ExplodeAxisHeuristic;
  scale: number;
  /** Explode amount t ∈ [0, 1]. */
  amount: number;
  /** Number of parts that will move (distance > 0) at full explode. */
  movingCount: number;
  onHeuristicChange: (h: ExplodeAxisHeuristic) => void;
  onScaleChange: (scale: number) => void;
  onAmountChange: (t: number) => void;
}

// ─── component ────────────────────────────────────────────────────────────

export default function AssemblyExplodePanel({
  lang = 'en',
  heuristic,
  scale,
  amount,
  movingCount,
  onHeuristicChange,
  onScaleChange,
  onAmountChange,
}: AssemblyExplodePanelProps): React.ReactElement {
  const t = dict[lang];

  const heuristicLabel = useCallback(
    (h: ExplodeAxisHeuristic): string =>
      h === 'mate_axes' ? t.axisMateAxes : h === 'bbox_center' ? t.axisBboxCenter : t.axisGravityNormal,
    [t],
  );

  const handleScale = useCallback(
    (raw: string): void => {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) onScaleChange(n);
    },
    [onScaleChange],
  );

  const handleAmount = useCallback(
    (raw: string): void => {
      const n = Number(raw);
      if (Number.isFinite(n)) onAmountChange(Math.max(0, Math.min(1, n)));
    },
    [onAmountChange],
  );

  return (
    <div
      data-testid="solver-assembly-explode-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        background: '#ffffff',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: '#111827',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t.title}</h3>
        <span data-testid="solver-assembly-explode-count" style={{ fontSize: 11, color: '#6b7280' }}>
          {movingCount} {t.partsMove}
        </span>
      </header>

      {/* axis heuristic */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 56, color: '#6b7280' }}>{t.axis}</span>
        <select
          data-testid="solver-assembly-explode-heuristic"
          value={heuristic}
          onChange={(e) => onHeuristicChange(e.target.value as ExplodeAxisHeuristic)}
          style={{ flex: '1 1 auto', fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
        >
          {HEURISTICS.map((h) => (
            <option key={h} value={h}>
              {heuristicLabel(h)}
            </option>
          ))}
        </select>
      </label>

      {/* spread / scale */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 56, color: '#6b7280' }}>{t.spread}</span>
        <input
          data-testid="solver-assembly-explode-scale"
          type="number"
          min={0}
          step={0.5}
          value={scale}
          onChange={(e) => handleScale(e.target.value)}
          style={{ width: 72, fontSize: 11, padding: '2px 4px', border: '1px solid #d1d5db', borderRadius: 3 }}
        />
      </label>

      {/* amount slider */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 56, color: '#6b7280' }}>{t.amount}</span>
        <input
          data-testid="solver-assembly-explode-amount"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={amount}
          onChange={(e) => handleAmount(e.target.value)}
          style={{ flex: '1 1 auto' }}
        />
        <span style={{ width: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#0e7490' }}>
          {Math.round(amount * 100)}%
        </span>
      </label>

      <button
        type="button"
        data-testid="solver-assembly-explode-reset"
        onClick={() => onAmountChange(0)}
        disabled={amount === 0}
        style={{
          alignSelf: 'flex-start',
          padding: '4px 10px', fontSize: 11,
          background: amount === 0 ? '#f3f4f6' : '#fff',
          color: amount === 0 ? '#9ca3af' : '#374151',
          border: '1px solid ' + (amount === 0 ? '#e5e7eb' : '#d1d5db'),
          borderRadius: 4,
          cursor: amount === 0 ? 'not-allowed' : 'pointer',
        }}
      >
        {t.reset}
      </button>
    </div>
  );
}
