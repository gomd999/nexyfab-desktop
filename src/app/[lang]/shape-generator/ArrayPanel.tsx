'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import type { ArrayPattern } from './features/instanceArray';
import { instanceCount } from './features/instanceArray';

interface ArrayPanelProps {
  onApply: (pattern: ArrayPattern) => void;
  onClose: () => void;
  isKo?: boolean;
  /** External translation dict (unused by this panel, kept for compat) */
  t?: Record<string, string>;
}

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  muted: '#8b949e',
  accent: '#388bfd',
  danger: '#f85149',
};

// Note: 'Pattern' is kept in English across langs (technical term).
const dict = {
  ko: {
    title: '배열/Pattern',
    subtitle: '인스턴싱으로 복수 복사',
    arrayType: '배열 유형',
    linear: '직선',
    radial: '원형',
    grid: '격자',
    linearSettings: '직선 배열 설정',
    radialSettings: '원형 배열 설정',
    gridSettings: '격자 배열 설정 (XZ 평면)',
    countX: 'X 개수',
    countY: 'Y 개수',
    countZ: 'Z 개수',
    spacingX: 'X 간격',
    spacingY: 'Y 간격',
    spacingZ: 'Z 간격',
    count: '개수',
    radius: '반경',
    axis: '회전 축',
    instanceCount: '인스턴스 수',
    applyAsFeature: '피처로 적용',
    close: '닫기',
  },
  en: {
    title: 'Array / Pattern',
    subtitle: 'Instanced mesh copies',
    arrayType: 'Array Type',
    linear: 'Linear',
    radial: 'Radial',
    grid: 'Grid',
    linearSettings: 'Linear Array Settings',
    radialSettings: 'Radial Array Settings',
    gridSettings: 'Grid Settings (XZ Plane)',
    countX: 'Count X',
    countY: 'Count Y',
    countZ: 'Count Z',
    spacingX: 'Spacing X',
    spacingY: 'Spacing Y',
    spacingZ: 'Spacing Z',
    count: 'Count',
    radius: 'Radius',
    axis: 'Axis',
    instanceCount: 'Instance Count',
    applyAsFeature: 'Apply as Feature',
    close: 'Close',
  },
  ja: {
    title: '配列 / Pattern',
    subtitle: 'インスタンス化による複数コピー',
    arrayType: '配列タイプ',
    linear: '直線',
    radial: '円形',
    grid: '格子',
    linearSettings: '直線配列設定',
    radialSettings: '円形配列設定',
    gridSettings: '格子配列設定 (XZ平面)',
    countX: 'X 数',
    countY: 'Y 数',
    countZ: 'Z 数',
    spacingX: 'X 間隔',
    spacingY: 'Y 間隔',
    spacingZ: 'Z 間隔',
    count: '数',
    radius: '半径',
    axis: '回転軸',
    instanceCount: 'インスタンス数',
    applyAsFeature: 'フィーチャとして適用',
    close: '閉じる',
  },
  zh: {
    title: '阵列 / Pattern',
    subtitle: '实例化多重复制',
    arrayType: '阵列类型',
    linear: '直线',
    radial: '圆形',
    grid: '网格',
    linearSettings: '直线阵列设置',
    radialSettings: '圆形阵列设置',
    gridSettings: '网格设置 (XZ平面)',
    countX: 'X 数量',
    countY: 'Y 数量',
    countZ: 'Z 数量',
    spacingX: 'X 间距',
    spacingY: 'Y 间距',
    spacingZ: 'Z 间距',
    count: '数量',
    radius: '半径',
    axis: '旋转轴',
    instanceCount: '实例数量',
    applyAsFeature: '作为特征应用',
    close: '关闭',
  },
  es: {
    title: 'Matriz / Pattern',
    subtitle: 'Copias de malla instanciadas',
    arrayType: 'Tipo de matriz',
    linear: 'Lineal',
    radial: 'Radial',
    grid: 'Cuadrícula',
    linearSettings: 'Ajustes de matriz lineal',
    radialSettings: 'Ajustes de matriz radial',
    gridSettings: 'Ajustes de cuadrícula (Plano XZ)',
    countX: 'Cantidad X',
    countY: 'Cantidad Y',
    countZ: 'Cantidad Z',
    spacingX: 'Espaciado X',
    spacingY: 'Espaciado Y',
    spacingZ: 'Espaciado Z',
    count: 'Cantidad',
    radius: 'Radio',
    axis: 'Eje',
    instanceCount: 'Nº de instancias',
    applyAsFeature: 'Aplicar como característica',
    close: 'Cerrar',
  },
  ar: {
    title: 'مصفوفة / Pattern',
    subtitle: 'نسخ مجسمة مُنسخة',
    arrayType: 'نوع المصفوفة',
    linear: 'خطي',
    radial: 'دائري',
    grid: 'شبكي',
    linearSettings: 'إعدادات المصفوفة الخطية',
    radialSettings: 'إعدادات المصفوفة الدائرية',
    gridSettings: 'إعدادات الشبكة (مستوى XZ)',
    countX: 'العدد X',
    countY: 'العدد Y',
    countZ: 'العدد Z',
    spacingX: 'المسافة X',
    spacingY: 'المسافة Y',
    spacingZ: 'المسافة Z',
    count: 'العدد',
    radius: 'نصف القطر',
    axis: 'المحور',
    instanceCount: 'عدد المثيلات',
    applyAsFeature: 'تطبيق كميزة',
    close: 'إغلاق',
  },
};

const DEFAULT_PATTERN: ArrayPattern = {
  type: 'linear',
  countX: 3, countY: 1, countZ: 1,
  spacingX: 60, spacingY: 60, spacingZ: 60,
  radialCount: 6, radialRadius: 80, radialAxis: 'y',
};

function SliderRow({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 11, color: C.muted, minWidth: 80, flexShrink: 0 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: C.accent, height: 4 }}
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{
          width: 52, padding: '2px 6px', background: '#0d1117', color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 4, fontSize: 11,
          fontFamily: 'monospace', textAlign: 'right',
        }}
      />
    </div>
  );
}

export default function ArrayPanel({ onApply, onClose, isKo: _isKo, t: _tt }: ArrayPanelProps) {
  void _isKo; void _tt;

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const resolvedKey = langMap[seg] ?? 'en';
  const t = dict[resolvedKey];

  const [pattern, setPattern] = useState<ArrayPattern>(DEFAULT_PATTERN);

  const count = instanceCount(pattern);

  const set = <K extends keyof ArrayPattern>(key: K, value: ArrayPattern[K]) => {
    setPattern(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div style={{
      width: 320, flexShrink: 0,
      background: C.bg, borderLeft: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '10px 14px',
        borderBottom: `1px solid ${C.border}`, gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 16 }}>⊞</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text, lineHeight: 1.2 }}>
            {t.title}
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 1 }}>
            {t.subtitle}
          </div>
        </div>
        <button onClick={onClose} style={{
          border: 'none', background: C.card, cursor: 'pointer', fontSize: 12,
          color: C.muted, width: 24, height: 24, borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.12s',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.card; e.currentTarget.style.color = C.muted; }}
        >✕</button>
      </div>

      {/* Scrollable body */}
      <div className="nf-scroll" style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Mode selector */}
        <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            {t.arrayType}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['linear', 'radial', 'grid'] as const).map(type => (
              <button
                key={type}
                onClick={() => set('type', type)}
                style={{
                  flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                  border: pattern.type === type ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                  background: pattern.type === type ? `${C.accent}22` : '#0d1117',
                  color: pattern.type === type ? C.accent : C.muted,
                  cursor: 'pointer', transition: 'all 0.12s',
                }}
              >
                {type === 'linear' ? t.linear : type === 'radial' ? t.radial : t.grid}
              </button>
            ))}
          </div>
        </div>

        {/* Linear params */}
        {pattern.type === 'linear' && (
          <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              {t.linearSettings}
            </div>
            <SliderRow label={t.countX} value={pattern.countX} min={1} max={20} onChange={v => set('countX', v)} />
            <SliderRow label={t.countY} value={pattern.countY} min={1} max={20} onChange={v => set('countY', v)} />
            <SliderRow label={t.countZ} value={pattern.countZ} min={1} max={20} onChange={v => set('countZ', v)} />
            <div style={{ height: 1, background: C.border, margin: '8px 0' }} />
            <SliderRow label={t.spacingX} value={pattern.spacingX} min={1} max={500} step={5} onChange={v => set('spacingX', v)} />
            <SliderRow label={t.spacingY} value={pattern.spacingY} min={1} max={500} step={5} onChange={v => set('spacingY', v)} />
            <SliderRow label={t.spacingZ} value={pattern.spacingZ} min={1} max={500} step={5} onChange={v => set('spacingZ', v)} />
          </div>
        )}

        {/* Radial params */}
        {pattern.type === 'radial' && (
          <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              {t.radialSettings}
            </div>
            <SliderRow label={t.count} value={pattern.radialCount} min={2} max={64} onChange={v => set('radialCount', v)} />
            <SliderRow label={t.radius} value={pattern.radialRadius} min={10} max={500} step={5} onChange={v => set('radialRadius', v)} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <span style={{ fontSize: 11, color: C.muted, minWidth: 80 }}>{t.axis}</span>
              <div style={{ display: 'flex', gap: 4, flex: 1 }}>
                {(['x', 'y', 'z'] as const).map(ax => (
                  <button key={ax} onClick={() => set('radialAxis', ax)} style={{
                    flex: 1, padding: '4px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                    border: pattern.radialAxis === ax ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                    background: pattern.radialAxis === ax ? `${C.accent}22` : '#0d1117',
                    color: pattern.radialAxis === ax ? C.accent : C.muted,
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}>
                    {ax.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Grid params */}
        {pattern.type === 'grid' && (
          <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
              {t.gridSettings}
            </div>
            <SliderRow label={t.countX} value={pattern.countX} min={1} max={20} onChange={v => set('countX', v)} />
            <SliderRow label={t.countZ} value={pattern.countZ} min={1} max={20} onChange={v => set('countZ', v)} />
            <div style={{ height: 1, background: C.border, margin: '8px 0' }} />
            <SliderRow label={t.spacingX} value={pattern.spacingX} min={1} max={500} step={5} onChange={v => set('spacingX', v)} />
            <SliderRow label={t.spacingZ} value={pattern.spacingZ} min={1} max={500} step={5} onChange={v => set('spacingZ', v)} />
          </div>
        )}

        {/* Instance count display */}
        <div style={{
          background: '#0d1117', borderRadius: 8, border: `1px solid ${C.border}`,
          padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 12, color: C.muted, fontWeight: 600 }}>
            {t.instanceCount}
          </span>
          <span style={{ fontSize: 18, fontWeight: 800, color: C.accent, fontFamily: 'monospace' }}>
            {count.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, flexShrink: 0, display: 'flex', gap: 8 }}>
        <button
          onClick={() => onApply(pattern)}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
            background: C.accent, color: '#fff', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1a7fe8'; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.accent; }}
        >
          ⊞ {t.applyAsFeature}
        </button>
        <button
          onClick={onClose}
          style={{
            padding: '9px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: 'transparent', color: C.muted, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.text; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted; }}
        >
          {t.close}
        </button>
      </div>
    </div>
  );
}
