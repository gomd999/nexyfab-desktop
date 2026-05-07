'use client';

import React from 'react';

const PAL = {
  ko: {
    title: '스케치 팔레트',
    grid: '스케치 그리드',
    snap: '스냅',
    slice: '슬라이스 가이드 (미리보기)',
    refSection: '참조 이미지',
    insertRef: '이미지 넣기',
    clearRef: '제거',
    refOpacity: '투명도',
    slicePlaneMm: '슬라이스 평면 X (mm)',
    refScale: '참조 배율',
    refLock: '참조 고정',
    refOffX: 'ΔX (mm)',
    refOffY: 'ΔY (mm)',
    opacityQuick: '빠른 투명도',
    profile: '프로파일 강조',
    dimensions: '치수 표시',
    constraints: '구속 표시',
    sketch3d: '3D 스케치 보기',
    finish: '스케치 마무리',
    exit: '스케치 종료',
    lightRibbonChrome: '밝은 리본 (작업 표시줄)',
    lineType: '선 종류',
    lineNormal: '일반',
    lineConstruction: '구성',
    lineCenterline: '중심선',
    lookAt: '스케치 평면 보기 (맞춤)',
  },
  en: {
    title: 'Sketch palette',
    grid: 'Sketch grid',
    snap: 'Snap',
    slice: 'Slice guide (preview)',
    refSection: 'Reference image',
    insertRef: 'Insert image',
    clearRef: 'Remove',
    refOpacity: 'Opacity',
    slicePlaneMm: 'Slice plane X (mm)',
    refScale: 'Reference scale',
    refLock: 'Lock underlay',
    refOffX: 'ΔX (mm)',
    refOffY: 'ΔY (mm)',
    opacityQuick: 'Opacity presets',
    profile: 'Profile highlight',
    dimensions: 'Dimensions',
    constraints: 'Constraints',
    sketch3d: '3D sketch view',
    finish: 'Finish sketch',
    exit: 'Exit sketch',
    lightRibbonChrome: 'Light ribbon (toolbar)',
    lineType: 'Line type',
    lineNormal: 'Normal',
    lineConstruction: 'Construction',
    lineCenterline: 'Centerline',
    lookAt: 'Look at (fit sketch)',
  },
  ja: {
    title: 'スケッチパレット',
    grid: 'スケッチグリッド',
    snap: 'スナップ',
    slice: 'スライスガイド（プレビュー）',
    refSection: '参照画像',
    insertRef: '画像を挿入',
    clearRef: '削除',
    refOpacity: '不透明度',
    slicePlaneMm: 'スライス面 X (mm)',
    refScale: '参照スケール',
    refLock: '参照を固定',
    refOffX: 'ΔX (mm)',
    refOffY: 'ΔY (mm)',
    opacityQuick: '不透明度プリセット',
    profile: 'プロファイル',
    dimensions: '寸法',
    constraints: '拘束',
    sketch3d: '3Dスケッチ',
    finish: 'スケッチ完了',
    exit: '終了',
    lightRibbonChrome: '明るいリボン（ツールバー）',
    lineType: '線の種類',
    lineNormal: '通常',
    lineConstruction: '構築',
    lineCenterline: '中心線',
    lookAt: '平面を表示（フィット）',
  },
  zh: {
    title: '草图面板',
    grid: '草图网格',
    snap: '捕捉',
    slice: '切片参考（预览）',
    refSection: '参考图',
    insertRef: '插入图片',
    clearRef: '移除',
    refOpacity: '不透明度',
    slicePlaneMm: '切片平面 X (mm)',
    refScale: '参考缩放',
    refLock: '锁定参考',
    refOffX: 'ΔX (mm)',
    refOffY: 'ΔY (mm)',
    opacityQuick: '透明度预设',
    profile: '轮廓',
    dimensions: '尺寸',
    constraints: '约束',
    sketch3d: '3D 草图',
    finish: '完成草图',
    exit: '退出草图',
    lightRibbonChrome: '浅色功能区（工具栏）',
    lineType: '线型',
    lineNormal: '普通',
    lineConstruction: '构造',
    lineCenterline: '中心线',
    lookAt: '正视草图平面',
  },
  es: {
    title: 'Paleta de boceto',
    grid: 'Cuadrícula',
    snap: 'Ajuste',
    slice: 'Guía de corte (vista previa)',
    refSection: 'Imagen de referencia',
    insertRef: 'Insertar imagen',
    clearRef: 'Quitar',
    refOpacity: 'Opacidad',
    slicePlaneMm: 'Plano de corte X (mm)',
    refScale: 'Escala de ref.',
    refLock: 'Fijar referencia',
    refOffX: 'ΔX (mm)',
    refOffY: 'ΔY (mm)',
    opacityQuick: 'Opacidad rápida',
    profile: 'Perfil',
    dimensions: 'Dimensiones',
    constraints: 'Restricciones',
    sketch3d: 'Vista 3D',
    finish: 'Finalizar boceto',
    exit: 'Salir',
    lightRibbonChrome: 'Cinta clara (barra de herramientas)',
    lineType: 'Tipo de línea',
    lineNormal: 'Normal',
    lineConstruction: 'Construcción',
    lineCenterline: 'Eje',
    lookAt: 'Ver plano (ajustar)',
  },
  ar: {
    title: 'لوحة الرسم',
    grid: 'شبكة',
    snap: 'التقاط',
    slice: 'دليل الشريحة (معاينة)',
    refSection: 'صورة مرجعية',
    insertRef: 'إدراج صورة',
    clearRef: 'إزالة',
    refOpacity: 'الشفافية',
    slicePlaneMm: 'مستوى الشريحة X (مم)',
    refScale: 'مقياس المرجع',
    refLock: 'قفل المرجع',
    refOffX: 'ΔX (مم)',
    refOffY: 'ΔY (مم)',
    opacityQuick: 'شفافية سريعة',
    profile: 'الملف',
    dimensions: 'أبعاد',
    constraints: 'قيود',
    sketch3d: 'عرض ثلاثي',
    finish: 'إنهاء الرسم',
    exit: 'خروج',
    lightRibbonChrome: 'شريط فاتح (شريط الأدوات)',
    lineType: 'نوع الخط',
    lineNormal: 'عادي',
    lineConstruction: 'إنشاء',
    lineCenterline: 'وسط',
    lookAt: 'عرض المستوى (ملاءمة)',
  },
};

function tr(lang: string) {
  const k = lang === 'kr' ? 'ko' : lang;
  return PAL[k as keyof typeof PAL] ?? PAL.en;
}

type RowProps = {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
};

function Row({ label, checked, onChange, disabled }: RowProps) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 2px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        fontSize: 12,
        color: '#24292f',
        userSelect: 'none',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        style={{ width: 15, height: 15, accentColor: '#0969da' }}
      />
      <span>{label}</span>
    </label>
  );
}

/** Floating sketch palette (light chrome panel). */
export default function SketchPalette({
  lang,
  gridVisible,
  snapEnabled,
  showDimensions,
  showConstraints,
  sliceEnabled,
  profileHighlight,
  hasReferenceImage,
  referenceOpacity,
  referenceScale,
  referenceOffsetX,
  referenceOffsetY,
  referenceLocked,
  slicePlaneMm,
  onGridChange,
  onSnapChange,
  onDimensionsChange,
  onConstraintsChange,
  onSliceChange,
  onSlicePlaneMmChange,
  onProfileHighlightChange,
  onInsertReference,
  onClearReference,
  onReferenceOpacityChange,
  onReferenceScaleChange,
  onReferenceOffsetChange,
  onReferenceLockedChange,
  onFinishSketch,
  onExitSketch,
  onOpen3dSketch,
  lightRibbonChrome,
  onLightRibbonChromeChange,
  sketchLineStyle,
  onSketchLineStyleChange,
  onLookAtSketch,
}: {
  lang: string;
  gridVisible: boolean;
  snapEnabled: boolean;
  showDimensions: boolean;
  showConstraints: boolean;
  sliceEnabled: boolean;
  profileHighlight: boolean;
  hasReferenceImage: boolean;
  referenceOpacity: number;
  referenceScale: number;
  referenceOffsetX: number;
  referenceOffsetY: number;
  referenceLocked: boolean;
  slicePlaneMm: number;
  onGridChange: (v: boolean) => void;
  onSnapChange: (v: boolean) => void;
  onDimensionsChange: (v: boolean) => void;
  onConstraintsChange: (v: boolean) => void;
  onSliceChange: (v: boolean) => void;
  onSlicePlaneMmChange: (v: number) => void;
  onProfileHighlightChange: (v: boolean) => void;
  onInsertReference: () => void;
  onClearReference: () => void;
  onReferenceOpacityChange: (v: number) => void;
  onReferenceScaleChange: (v: number) => void;
  onReferenceOffsetChange: (x: number, y: number) => void;
  onReferenceLockedChange: (v: boolean) => void;
  onFinishSketch: () => void;
  onExitSketch: () => void;
  onOpen3dSketch: () => void;
  lightRibbonChrome: boolean;
  onLightRibbonChromeChange: (v: boolean) => void;
  sketchLineStyle: 'normal' | 'construction' | 'centerline';
  onSketchLineStyleChange: (v: 'normal' | 'construction' | 'centerline') => void;
  onLookAtSketch: () => void;
}) {
  const tt = tr(lang);

  return (
    <aside
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 260,
        maxWidth: 'calc(100% - 24px)',
        zIndex: 35,
        background: 'rgba(13, 17, 23, 0.65)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 16,
        boxShadow: '0 24px 48px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
        padding: '16px',
        fontFamily: 'var(--font-inter), system-ui, -apple-system, sans-serif',
        pointerEvents: 'auto',
      }}
    >
      <div style={{
        fontSize: 14,
        fontWeight: 600,
        color: '#ffffff',
        marginBottom: 16,
        paddingBottom: 10,
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        letterSpacing: '0.02em',
      }}>
        {tt.title}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#8b949e', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{tt.lineType}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['normal', 'construction', 'centerline'] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => onSketchLineStyleChange(mode)}
              style={{
                flex: 1,
                padding: '6px 4px',
                borderRadius: 8,
                fontSize: 10,
                fontWeight: 600,
                border: sketchLineStyle === mode ? '1px solid #388bfd' : '1px solid rgba(255,255,255,0.08)',
                background: sketchLineStyle === mode ? 'rgba(56, 139, 253, 0.15)' : 'rgba(255,255,255,0.03)',
                color: sketchLineStyle === mode ? '#58a6ff' : '#c9d1d9',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { if (sketchLineStyle !== mode) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
              onMouseLeave={e => { if (sketchLineStyle !== mode) e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
            >
              {mode === 'normal' ? tt.lineNormal : mode === 'construction' ? tt.lineConstruction : tt.lineCenterline}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onLookAtSketch}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '8px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#ffffff',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
        >
          {tt.lookAt}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Row label={tt.grid} checked={gridVisible} onChange={onGridChange} />
        <Row label={tt.snap} checked={snapEnabled} onChange={onSnapChange} />
        <Row label={tt.slice} checked={sliceEnabled} onChange={onSliceChange} />
        {sliceEnabled && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 2px', fontSize: 12, color: '#c9d1d9' }}>
            <span style={{ minWidth: 120 }}>{tt.slicePlaneMm}</span>
            <input
              type="range"
              min={-200}
              max={400}
              step={1}
              value={slicePlaneMm}
              onChange={e => onSlicePlaneMmChange(Number(e.target.value))}
              style={{ flex: 1, accentColor: '#ea580c' }}
            />
            <span style={{ fontFamily: 'monospace', fontSize: 11, minWidth: 36, color: '#8b949e' }}>{slicePlaneMm}</span>
          </label>
        )}
        <Row label={tt.profile} checked={profileHighlight} onChange={onProfileHighlightChange} />
        <Row label={tt.dimensions} checked={showDimensions} onChange={onDimensionsChange} />
        <Row label={tt.constraints} checked={showConstraints} onChange={onConstraintsChange} />
      </div>

      <div style={{
        marginTop: 16,
        paddingTop: 12,
        borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        fontSize: 11,
        fontWeight: 600,
        color: '#8b949e',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 10,
      }}>
        {tt.refSection}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          onClick={onInsertReference}
          style={{
            flex: 1,
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: 'rgba(255, 255, 255, 0.03)',
            color: '#c9d1d9',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
        >
          {tt.insertRef}
        </button>
        <button
          type="button"
          onClick={onClearReference}
          disabled={!hasReferenceImage}
          style={{
            padding: '7px 10px',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            background: hasReferenceImage ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.02)',
            color: '#c9d1d9',
            fontSize: 12,
            fontWeight: 600,
            cursor: hasReferenceImage ? 'pointer' : 'default',
            opacity: hasReferenceImage ? 1 : 0.4,
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={e => { if (hasReferenceImage) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)'; }}
          onMouseLeave={e => { if (hasReferenceImage) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
        >
          {tt.clearRef}
        </button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#c9d1d9', marginBottom: 6 }}>
        <span style={{ minWidth: 72 }}>{tt.refOpacity}</span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.05}
          value={referenceOpacity}
          onChange={e => onReferenceOpacityChange(Number(e.target.value))}
          disabled={!hasReferenceImage || referenceLocked}
          style={{ flex: 1, accentColor: '#388bfd', opacity: hasReferenceImage && !referenceLocked ? 1 : 0.4 }}
        />
      </label>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#8b949e', width: '100%' }}>{tt.opacityQuick}</span>
        {[0.25, 0.5, 0.75].map(p => (
          <button
            key={p}
            type="button"
            disabled={!hasReferenceImage || referenceLocked}
            onClick={() => onReferenceOpacityChange(p)}
            style={{
              flex: 1,
              minWidth: 56,
              padding: '6px 0',
              borderRadius: 6,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              background: 'rgba(255, 255, 255, 0.03)',
              color: '#c9d1d9',
              fontSize: 11,
              fontWeight: 600,
              cursor: hasReferenceImage && !referenceLocked ? 'pointer' : 'default',
              opacity: hasReferenceImage && !referenceLocked ? 1 : 0.4,
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => { if (hasReferenceImage && !referenceLocked) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'; }}
            onMouseLeave={e => { if (hasReferenceImage && !referenceLocked) e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'; }}
          >
            {Math.round(p * 100)}%
          </button>
        ))}
      </div>
      <Row label={tt.refLock} checked={referenceLocked} onChange={onReferenceLockedChange} disabled={!hasReferenceImage} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: '#c9d1d9', marginBottom: 6 }}>
        <span style={{ minWidth: 72 }}>{tt.refScale}</span>
        <input
          type="range"
          min={0.2}
          max={3}
          step={0.05}
          value={referenceScale}
          onChange={e => onReferenceScaleChange(Number(e.target.value))}
          disabled={!hasReferenceImage || referenceLocked}
          style={{ flex: 1, accentColor: '#388bfd', opacity: hasReferenceImage && !referenceLocked ? 1 : 0.4 }}
        />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 11, color: '#c9d1d9' }}>
          {tt.refOffX}
          <input
            type="number"
            step={1}
            value={referenceOffsetX}
            onChange={e => onReferenceOffsetChange(Number(e.target.value), referenceOffsetY)}
            disabled={!hasReferenceImage || referenceLocked}
            style={{ width: '100%', marginTop: 4, padding: '6px', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.15)', background: 'rgba(0,0,0,0.2)', color: '#fff' }}
          />
        </label>
        <label style={{ fontSize: 11, color: '#c9d1d9' }}>
          {tt.refOffY}
          <input
            type="number"
            step={1}
            value={referenceOffsetY}
            onChange={e => onReferenceOffsetChange(referenceOffsetX, Number(e.target.value))}
            disabled={!hasReferenceImage || referenceLocked}
            style={{ width: '100%', marginTop: 4, padding: '6px', borderRadius: 6, border: '1px solid rgba(255, 255, 255, 0.15)', background: 'rgba(0,0,0,0.2)', color: '#fff' }}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={onOpen3dSketch}
        style={{
          marginTop: 12,
          width: '100%',
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.08)',
          background: 'rgba(255, 255, 255, 0.03)',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.03)'}
      >
        {tt.sketch3d}
      </button>

      {/* lightRibbonChrome is removed from display since it is unified to dark */}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          type="button"
          onClick={onFinishSketch}
          style={{
            flex: 1,
            padding: '10px 12px',
            borderRadius: 8,
            border: 'none',
            background: 'linear-gradient(180deg, #388bfd 0%, #2169ce 100%)',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(56,139,253,0.3)',
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          {tt.finish}
        </button>
        <button
          type="button"
          data-testid="exit-sketch"
          onClick={onExitSketch}
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            background: 'rgba(255, 255, 255, 0.05)',
            color: '#c9d1d9',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 0.15s ease',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
          onMouseLeave={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)'}
        >
          {tt.exit}
        </button>
      </div>
    </aside>
  );
}
