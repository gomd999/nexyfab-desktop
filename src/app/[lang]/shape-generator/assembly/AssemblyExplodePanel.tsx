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

import React, { useCallback, useRef, useState } from 'react';
import type { ExplodeAxisHeuristic } from '@/lib/assembly/explodeView';
import { parseExplodeImport, type ImportedExplode } from '@/lib/assembly/explodeImport';

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
  play: string;
  exportSteps: string;
  importSteps: string;
  clearImport: string;
  importedBadge: string;
  partsMove: string; // "{n} parts move" — {n} substituted by caller
}

const dict: Record<AssemblyLang, Dict> = {
  ko: {
    title: '분해 보기', axis: '축',
    axisMateAxes: '메이트 축', axisBboxCenter: 'BBox 중심', axisGravityNormal: '중력 법선',
    spread: '간격', amount: '분해 정도', reset: '초기화', play: '재생', exportSteps: '단계 내보내기',
    importSteps: '단계 가져오기', clearImport: '가져오기 해제', importedBadge: '가져옴', partsMove: '개 부품 이동',
  },
  en: {
    title: 'Exploded View', axis: 'Axis',
    axisMateAxes: 'Mate axes', axisBboxCenter: 'BBox center', axisGravityNormal: 'Gravity normal',
    spread: 'Spread', amount: 'Amount', reset: 'Reset', play: 'Play', exportSteps: 'Export steps',
    importSteps: 'Import steps', clearImport: 'Clear', importedBadge: 'imported', partsMove: 'parts move',
  },
  ja: {
    title: '分解表示', axis: '軸',
    axisMateAxes: 'メイト軸', axisBboxCenter: 'BBox中心', axisGravityNormal: '重力法線',
    spread: '間隔', amount: '分解量', reset: 'リセット', play: '再生', exportSteps: 'ステップ出力',
    importSteps: 'ステップ読込', clearImport: '解除', importedBadge: '読込済', partsMove: '個の部品が移動',
  },
  zh: {
    title: '爆炸视图', axis: '轴',
    axisMateAxes: '配合轴', axisBboxCenter: 'BBox 中心', axisGravityNormal: '重力法线',
    spread: '间距', amount: '分解程度', reset: '重置', play: '播放', exportSteps: '导出步骤',
    importSteps: '导入步骤', clearImport: '清除', importedBadge: '已导入', partsMove: '个零件移动',
  },
  es: {
    title: 'Vista explosionada', axis: 'Eje',
    axisMateAxes: 'Ejes de unión', axisBboxCenter: 'Centro BBox', axisGravityNormal: 'Normal de gravedad',
    spread: 'Separación', amount: 'Cantidad', reset: 'Reiniciar', play: 'Reproducir', exportSteps: 'Exportar pasos',
    importSteps: 'Importar pasos', clearImport: 'Borrar', importedBadge: 'importado', partsMove: 'piezas se mueven',
  },
  ar: {
    title: 'عرض مفكك', axis: 'محور',
    axisMateAxes: 'محاور التزاوج', axisBboxCenter: 'مركز BBox', axisGravityNormal: 'العمودي للجاذبية',
    spread: 'تباعد', amount: 'المقدار', reset: 'إعادة', play: 'تشغيل', exportSteps: 'تصدير الخطوات',
    importSteps: 'استيراد الخطوات', clearImport: 'مسح', importedBadge: 'مستورد', partsMove: 'قطعة تتحرك',
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
  /** Animate the assembly apart (host ramps amount 0 → 1). */
  onPlay?: () => void;
  /** Download the ordered explode steps as a JSON keyframe sequence. */
  onExport?: () => void;
  /** Receive a parsed, imported step sequence for replay. */
  onImport?: (imported: ImportedExplode) => void;
  /** Whether an imported sequence is currently driving the view. */
  imported?: boolean;
  /** Revert from the imported sequence back to the computed one. */
  onClearImport?: () => void;
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
  onPlay,
  onExport,
  onImport,
  imported = false,
  onClearImport,
}: AssemblyExplodePanelProps): React.ReactElement {
  const t = dict[lang];
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importErr, setImportErr] = useState<string | null>(null);

  const handleFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-selecting the same file
      if (!file || !onImport) return;
      // FileReader (not Blob.text) for broad jsdom / browser support.
      const reader = new FileReader();
      reader.onload = (): void => {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const res = parseExplodeImport(text);
        if (res.ok) {
          setImportErr(null);
          onImport(res.value);
        } else {
          setImportErr(res.error);
        }
      };
      reader.onerror = (): void => setImportErr('failed to read file');
      reader.readAsText(file);
    },
    [onImport],
  );

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
        background: 'var(--nx-panel)',
        border: '1px solid var(--nx-border)',
        borderRadius: 6,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: 'var(--nx-text)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t.title}</h3>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {imported && (
            <span
              data-testid="solver-assembly-explode-imported-badge"
              style={{
                fontSize: 10, fontWeight: 600, color: '#155e75',
                background: '#cffafe', border: '1px solid #67e8f9',
                borderRadius: 3, padding: '1px 5px',
              }}
            >
              {t.importedBadge}
            </span>
          )}
          <span data-testid="solver-assembly-explode-count" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {movingCount} {t.partsMove}
          </span>
        </span>
      </header>

      {/* axis heuristic */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 56, color: 'var(--nx-text-2)' }}>{t.axis}</span>
        <select
          data-testid="solver-assembly-explode-heuristic"
          value={heuristic}
          onChange={(e) => onHeuristicChange(e.target.value as ExplodeAxisHeuristic)}
          style={{ flex: '1 1 auto', fontSize: 11, padding: '2px 4px', border: '1px solid var(--nx-border)', borderRadius: 3 }}
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
        <span style={{ width: 56, color: 'var(--nx-text-2)' }}>{t.spread}</span>
        <input
          data-testid="solver-assembly-explode-scale"
          type="number"
          min={0}
          step={0.5}
          value={scale}
          onChange={(e) => handleScale(e.target.value)}
          style={{ width: 72, fontSize: 11, padding: '2px 4px', border: '1px solid var(--nx-border)', borderRadius: 3 }}
        />
      </label>

      {/* amount slider */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 56, color: 'var(--nx-text-2)' }}>{t.amount}</span>
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

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          data-testid="solver-assembly-explode-reset"
          onClick={() => onAmountChange(0)}
          disabled={amount === 0}
          style={{
            padding: '4px 10px', fontSize: 11,
            background: amount === 0 ? 'var(--nx-panel-2)' : 'var(--nx-panel)',
            color: amount === 0 ? 'var(--nx-text-2)' : 'var(--nx-text-2)',
            border: '1px solid ' + (amount === 0 ? 'var(--nx-border)' : 'var(--nx-border)'),
            borderRadius: 4,
            cursor: amount === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {t.reset}
        </button>
        {onPlay && (
          <button
            type="button"
            data-testid="solver-assembly-explode-play"
            onClick={onPlay}
            style={{
              padding: '4px 10px', fontSize: 11, background: '#0e7490', color: '#fff',
              border: '1px solid #0e7490', borderRadius: 4, cursor: 'pointer',
            }}
          >
            ▶ {t.play}
          </button>
        )}
        {onExport && (
          <button
            type="button"
            data-testid="solver-assembly-explode-export"
            onClick={onExport}
            disabled={movingCount === 0}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: movingCount === 0 ? 'var(--nx-panel-2)' : 'var(--nx-panel)',
              color: movingCount === 0 ? 'var(--nx-text-2)' : 'var(--nx-text-2)',
              border: '1px solid ' + (movingCount === 0 ? 'var(--nx-border)' : 'var(--nx-border)'),
              borderRadius: 4,
              cursor: movingCount === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {t.exportSteps}
          </button>
        )}
        {onImport && (
          <button
            type="button"
            data-testid="solver-assembly-explode-import"
            onClick={() => fileRef.current?.click()}
            style={{
              padding: '4px 10px', fontSize: 11, background: 'var(--nx-panel)', color: 'var(--nx-text-2)',
              border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer',
            }}
          >
            {t.importSteps}
          </button>
        )}
        {imported && onClearImport && (
          <button
            type="button"
            data-testid="solver-assembly-explode-clear-import"
            onClick={onClearImport}
            style={{
              padding: '4px 10px', fontSize: 11, background: 'var(--nx-panel)', color: '#b91c1c',
              border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer',
            }}
          >
            {t.clearImport}
          </button>
        )}
      </div>

      {onImport && (
        <input
          ref={fileRef}
          data-testid="solver-assembly-explode-file"
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
      )}
      {importErr && (
        <div
          data-testid="solver-assembly-explode-import-error"
          style={{
            fontSize: 10, color: '#b91c1c', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: 4, padding: '3px 6px',
          }}
        >
          {importErr}
        </div>
      )}
    </div>
  );
}
