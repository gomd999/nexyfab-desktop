'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export interface StatusBarProps {
  lang: string;
  cursor3D: { x: number; y: number; z: number } | null;
  unitSystem: 'mm' | 'inch';
  onToggleUnit: () => void;
  selectionCount: number;
  activeTool: string | null;
  isSketchMode: boolean;
  editMode: string;
  featureCount: number;
  triangleCount: number;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  /** Grid / transform snap step (mm). Shown when snap is on. */
  snapSize?: number;
  onSnapSizeChange?: (mm: number) => void;
  sectionActive: boolean;
  sectionAxis: 'x' | 'y' | 'z';
  sectionOffset: number;
  onSectionAxisChange: (a: 'x' | 'y' | 'z') => void;
  onSectionOffsetChange: (v: number) => void;
  isOptimizing: boolean;
  progress: { iteration: number; maxIteration: number } | null;
  onShowShortcuts: () => void;
}

// ── i18n dict ──
// Keep English across langs: Sketch, Edit, Face, Edge, Vertex, Fillet, Chamfer.
const dict = {
  ko: {
    sketchMode: '스케치 모드', edit: 'Edit', modeling: '모델링', tool: '도구',
    selected: '선택됨', snap: '스냅', toggleSnap: '스냅 토글', features: '피처',
    toggleUnits: '단위 전환', shortcuts: '키보드 단축키', snapStep: '간격',
    line: '선', rect: '사각형', circle: '원', arc: '호', polygon: '다각형',
    spline: '스플라인', trim: '트림', offset: '오프셋', mirror: '미러',
    fillet: 'Fillet', chamfer: 'Chamfer', constraint: '구속', dimension: '치수',
    select: '선택', vertex: 'Vertex', edge: 'Edge', face: 'Face',
  },
  en: {
    sketchMode: 'Sketch Mode', edit: 'Edit', modeling: 'Modeling', tool: 'Tool',
    selected: 'selected', snap: 'Snap', toggleSnap: 'Toggle Snap', features: 'Features',
    toggleUnits: 'Toggle Units', shortcuts: 'Keyboard Shortcuts', snapStep: 'Step',
    line: 'Line', rect: 'Rectangle', circle: 'Circle', arc: 'Arc', polygon: 'Polygon',
    spline: 'Spline', trim: 'Trim', offset: 'Offset', mirror: 'Mirror',
    fillet: 'Fillet', chamfer: 'Chamfer', constraint: 'Constraint', dimension: 'Dimension',
    select: 'Select', vertex: 'Vertex', edge: 'Edge', face: 'Face',
  },
  ja: {
    sketchMode: 'スケッチモード', edit: 'Edit', modeling: 'モデリング', tool: 'ツール',
    selected: '選択済み', snap: 'スナップ', toggleSnap: 'スナップ切替', features: 'フィーチャー',
    toggleUnits: '単位切替', shortcuts: 'キーボードショートカット', snapStep: '間隔',
    line: '線', rect: '矩形', circle: '円', arc: '弧', polygon: '多角形',
    spline: 'スプライン', trim: 'トリム', offset: 'オフセット', mirror: 'ミラー',
    fillet: 'Fillet', chamfer: 'Chamfer', constraint: '拘束', dimension: '寸法',
    select: '選択', vertex: 'Vertex', edge: 'Edge', face: 'Face',
  },
  zh: {
    sketchMode: '草图模式', edit: 'Edit', modeling: '建模', tool: '工具',
    selected: '已选择', snap: '捕捉', toggleSnap: '切换捕捉', features: '特征',
    toggleUnits: '切换单位', shortcuts: '键盘快捷键', snapStep: '步长',
    line: '线', rect: '矩形', circle: '圆', arc: '弧', polygon: '多边形',
    spline: '样条线', trim: '修剪', offset: '偏移', mirror: '镜像',
    fillet: 'Fillet', chamfer: 'Chamfer', constraint: '约束', dimension: '尺寸',
    select: '选择', vertex: 'Vertex', edge: 'Edge', face: 'Face',
  },
  es: {
    sketchMode: 'Modo Boceto', edit: 'Edit', modeling: 'Modelado', tool: 'Herramienta',
    selected: 'seleccionados', snap: 'Snap', toggleSnap: 'Alternar Snap', features: 'Operaciones',
    toggleUnits: 'Cambiar Unidades', shortcuts: 'Atajos de Teclado', snapStep: 'Paso',
    line: 'Línea', rect: 'Rectángulo', circle: 'Círculo', arc: 'Arco', polygon: 'Polígono',
    spline: 'Spline', trim: 'Recortar', offset: 'Desfasar', mirror: 'Espejo',
    fillet: 'Fillet', chamfer: 'Chamfer', constraint: 'Restricción', dimension: 'Dimensión',
    select: 'Seleccionar', vertex: 'Vertex', edge: 'Edge', face: 'Face',
  },
  ar: {
    sketchMode: 'وضع الرسم', edit: 'Edit', modeling: 'نمذجة', tool: 'أداة',
    selected: 'محدد', snap: 'محاذاة', toggleSnap: 'تبديل المحاذاة', features: 'ميزات',
    toggleUnits: 'تبديل الوحدات', shortcuts: 'اختصارات لوحة المفاتيح', snapStep: 'خطوة',
    line: 'خط', rect: 'مستطيل', circle: 'دائرة', arc: 'قوس', polygon: 'مضلع',
    spline: 'منحنى', trim: 'قص', offset: 'إزاحة', mirror: 'مرآة',
    fillet: 'Fillet', chamfer: 'Chamfer', constraint: 'قيد', dimension: 'بُعد',
    select: 'تحديد', vertex: 'Vertex', edge: 'Edge', face: 'Face',
  },
} as const;

// ── Static style constants (avoid per-render object allocation) ──────────────
const S = {
  root: (rtl: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '0 12px', background: '#0d1117',
    borderTop: '1px solid #21262d', fontSize: 11, fontWeight: 600,
    flexShrink: 0, height: 24, color: '#6e7681',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    direction: rtl ? 'rtl' : 'ltr',
  }),
  sep: { borderRight: '1px solid #21262d', height: '100%' } as React.CSSProperties,
  modeWrap: (sketch: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 4,
    padding: '0 8px', height: '100%',
    background: sketch ? 'rgba(56,139,253,0.12)' : 'transparent',
    borderRight: '1px solid #21262d',
  }),
  modeDot: (sketch: boolean, editing: boolean): React.CSSProperties => ({
    width: 6, height: 6, borderRadius: '50%',
    background: sketch ? '#388bfd' : editing ? '#d29922' : '#3fb950',
    flexShrink: 0,
  }),
  modeLabel: (sketch: boolean): React.CSSProperties => ({
    color: sketch ? '#58a6ff' : '#8b949e', fontSize: 10,
  }),
  toolWrap: { display: 'flex', alignItems: 'center', gap: 3, padding: '0 6px', borderRight: '1px solid #21262d', height: '100%' } as React.CSSProperties,
  toolLabelKey: { color: '#d2a8ff', fontSize: 10 } as React.CSSProperties,
  toolLabelVal: { color: '#c9d1d9', fontSize: 10 } as React.CSSProperties,
  coordWrap: { display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', borderRight: '1px solid #21262d', height: '100%', minWidth: 180 } as React.CSSProperties,
  coordEmpty: { color: '#484f58' } as React.CSSProperties,
  coordX: { color: '#f47067' } as React.CSSProperties,
  coordY: { color: '#7ee787' } as React.CSSProperties,
  coordZ: { color: '#79c0ff' } as React.CSSProperties,
  coordVal: { color: '#c9d1d9', minWidth: 42, textAlign: 'right' as const } as React.CSSProperties,
  selWrap: { display: 'flex', alignItems: 'center', gap: 3, padding: '0 6px', borderRight: '1px solid #21262d', height: '100%' } as React.CSSProperties,
  selCount: { color: '#d29922' } as React.CSSProperties,
  selLabel: { color: '#8b949e', fontSize: 10 } as React.CSSProperties,
  snapBtn: (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 3,
    padding: '0 6px', height: '100%',
    background: 'transparent', border: 'none', cursor: 'pointer',
    borderRight: '1px solid #21262d',
    color: on ? '#58a6ff' : '#484f58',
    fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
  }),
  sectionWrap: { display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', borderRight: '1px solid #21262d', height: '100%' } as React.CSSProperties,
  sectionAxisBtn: (active: boolean): React.CSSProperties => ({
    padding: '0 5px', borderRadius: 2, border: 'none', fontSize: 9, fontWeight: 700, cursor: 'pointer',
    background: active ? '#388bfd' : 'transparent', color: active ? '#fff' : '#6e7681',
    fontFamily: 'inherit',
  }),
  sectionPct: { fontSize: 9, color: '#6e7681', minWidth: 24 } as React.CSSProperties,
  optWrap: { display: 'flex', alignItems: 'center', gap: 4, padding: '0 6px', height: '100%' } as React.CSSProperties,
  optBarTrack: { width: 60, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' } as React.CSSProperties,
  optBarFill: (pct: number): React.CSSProperties => ({ width: `${pct}%`, height: '100%', background: '#8b5cf6', transition: 'width 0.3s' }),
  optPct: { fontSize: 9, color: '#8b5cf6' } as React.CSSProperties,
  statLabel: { color: '#484f58', fontSize: 9 } as React.CSSProperties,
  unitBtn: { padding: '0 6px', borderRadius: 3, border: '1px solid #21262d', background: 'transparent', cursor: 'pointer', fontSize: 10, fontWeight: 700, fontFamily: 'inherit', color: '#8b949e', height: 18, transition: 'all 0.12s' } as React.CSSProperties,
  unitMm: (on: boolean): React.CSSProperties => ({ color: on ? '#58a6ff' : undefined }),
  unitSep: { color: '#30363d', margin: '0 1px' } as React.CSSProperties,
  unitIn: (on: boolean): React.CSSProperties => ({ color: on ? '#58a6ff' : undefined }),
  shortcutBtn: { width: 16, height: 16, borderRadius: 3, border: '1px solid #21262d', background: 'transparent', color: '#6e7681', fontSize: 10, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
} as const;

export default function StatusBar({
  lang, cursor3D, unitSystem, onToggleUnit,
  selectionCount, activeTool, isSketchMode, editMode,
  featureCount, triangleCount, snapEnabled, onToggleSnap,
  snapSize, onSnapSizeChange,
  sectionActive, sectionAxis, sectionOffset,
  onSectionAxisChange, onSectionOffsetChange,
  isOptimizing, progress, onShowShortcuts,
}: StatusBarProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const fmt = (v: number) => {
    if (unitSystem === 'inch') v *= 0.03937;
    return v.toFixed(2);
  };

  const toolLabel = activeTool
    ? ((t as Record<string, string>)[activeTool] ?? activeTool)
    : null;

  const modeLabel = isSketchMode
    ? t.sketchMode
    : editMode !== 'none'
      ? `${t.edit}: ${editMode}`
      : t.modeling;

  const isRtl = (langMap[seg] ?? 'en') === 'ar';
  const optPct = progress ? Math.round((progress.iteration / progress.maxIteration) * 100) : 0;

  return (
    <div style={S.root(isRtl)}>
      {/* Mode indicator */}
      <div style={S.modeWrap(isSketchMode)}>
        <span style={S.modeDot(isSketchMode, editMode !== 'none')} />
        <span style={S.modeLabel(isSketchMode)}>{modeLabel}</span>
      </div>

      {/* Active tool */}
      {activeTool && (
        <div style={S.toolWrap}>
          <span style={S.toolLabelKey}>{t.tool}:</span>
          <span style={S.toolLabelVal}>{toolLabel}</span>
        </div>
      )}

      {/* 3D Cursor coordinates */}
      <div style={S.coordWrap}>
        {cursor3D ? (
          <>
            <span style={S.coordX}>X</span>
            <span style={S.coordVal}>{fmt(cursor3D.x)}</span>
            <span style={S.coordY}>Y</span>
            <span style={S.coordVal}>{fmt(cursor3D.y)}</span>
            <span style={S.coordZ}>Z</span>
            <span style={S.coordVal}>{fmt(cursor3D.z)}</span>
          </>
        ) : (
          <span style={S.coordEmpty}>--- , --- , ---</span>
        )}
      </div>

      {/* Selection info */}
      {selectionCount > 0 && (
        <div style={S.selWrap}>
          <span style={S.selCount}>{selectionCount}</span>
          <span style={S.selLabel}>{t.selected}</span>
        </div>
      )}

      {/* Snap indicator */}
      <button onClick={onToggleSnap} style={S.snapBtn(snapEnabled)} title={t.toggleSnap}>
        ⊞ {t.snap}: {snapEnabled ? 'ON' : 'OFF'}
      </button>
      {snapEnabled && typeof snapSize === 'number' && onSnapSizeChange && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '0 6px', borderRight: '1px solid #21262d', height: '100%' }}>
          <span style={{ fontSize: 9, color: '#484f58' }}>{t.snapStep}</span>
          {([1, 5, 10, 25] as const).map((mm) => (
            <button
              key={mm}
              type="button"
              onClick={() => onSnapSizeChange(mm)}
              style={{
                padding: '1px 5px',
                borderRadius: 2,
                border: 'none',
                fontSize: 9,
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: snapSize === mm ? '#388bfd' : 'transparent',
                color: snapSize === mm ? '#fff' : '#6e7681',
              }}
            >
              {mm}
            </button>
          ))}
        </div>
      )}

      {/* Section plane active */}
      {sectionActive && (
        <div style={S.sectionWrap}>
          {(['x', 'y', 'z'] as const).map(ax => (
            <button key={ax} onClick={() => onSectionAxisChange(ax)} style={S.sectionAxisBtn(sectionAxis === ax)}>
              {ax.toUpperCase()}
            </button>
          ))}
          <input type="range" min={0} max={1} step={0.01} value={sectionOffset}
            onChange={e => onSectionOffsetChange(parseFloat(e.target.value))}
            style={{ width: 60, accentColor: '#388bfd', height: 3 }} />
          <span style={S.sectionPct}>{(sectionOffset * 100).toFixed(0)}%</span>
        </div>
      )}

      {/* Optimization progress */}
      {isOptimizing && progress && (
        <div style={S.optWrap}>
          <div style={S.optBarTrack}>
            <div style={S.optBarFill(optPct)} />
          </div>
          <span style={S.optPct}>{optPct}%</span>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Stats */}
      <span style={S.statLabel}>{t.features}: {featureCount}</span>
      {triangleCount > 0 && (
        <span style={S.statLabel}>
          △ {triangleCount > 1000 ? `${(triangleCount / 1000).toFixed(1)}K` : triangleCount}
        </span>
      )}

      {/* Unit toggle */}
      <button onClick={onToggleUnit} style={S.unitBtn} title={t.toggleUnits}>
        <span style={S.unitMm(unitSystem === 'mm')}>mm</span>
        <span style={S.unitSep}>|</span>
        <span style={S.unitIn(unitSystem === 'inch')}>in</span>
      </button>

      {/* Shortcut help */}
      <button data-tour="shortcut-help" onClick={onShowShortcuts} style={S.shortcutBtn} title={t.shortcuts}>
        ?
      </button>
    </div>
  );
}
