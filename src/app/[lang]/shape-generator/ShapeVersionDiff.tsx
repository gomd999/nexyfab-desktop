'use client';

import React, { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';

const langMap: Record<string, string> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'cn', zh: 'cn', es: 'es', ar: 'ar',
};

// ─── i18n ─────────────────────────────────────────────────────────────────────

const L: Record<string, Record<string, string>> = {
  ko: {
    title: '버전 형상 비교',
    width: '너비',
    height: '높이',
    depth: '깊이',
    volume: '체적',
    surfaceArea: '표면적',
    vertices: '정점 수',
    dimension: '치수',
    before: '이전',
    after: '이후',
    change: '변화',
    unchanged: '변화 없음',
    increased: '증가',
    decreased: '감소',
    changed: '치수 변경됨',
    summary: '개 치수 변경',
    volumeIncreased: '체적 증가',
    volumeDecreased: '체적 감소',
    volumeUnchanged: '체적 변화 없음',
    by: '',
    close: '닫기',
    overlap: '겹침',
    bboxViz: '바운딩 박스 비교',
    mm: 'mm',
    cm3: 'cm³',
    cm2: 'cm²',
    noGeom: '형상 데이터 없음',
  },
  en: {
    title: 'Shape Version Diff',
    width: 'Width',
    height: 'Height',
    depth: 'Depth',
    volume: 'Volume',
    surfaceArea: 'Surface Area',
    vertices: 'Vertices',
    dimension: 'Dimension',
    before: 'Before',
    after: 'After',
    change: 'Change (Δ)',
    unchanged: 'Unchanged',
    increased: 'increased',
    decreased: 'decreased',
    changed: 'dimensions changed',
    summary: 'dimensions changed',
    volumeIncreased: 'volume increased',
    volumeDecreased: 'volume decreased',
    volumeUnchanged: 'volume unchanged',
    by: 'by',
    close: 'Close',
    overlap: 'Overlap',
    bboxViz: 'Bounding Box Comparison',
    mm: 'mm',
    cm3: 'cm³',
    cm2: 'cm²',
    noGeom: 'No geometry data',
  },
  ja: {
    title: 'バージョン形状差分',
    width: '幅',
    height: '高さ',
    depth: '奥行き',
    volume: '体積',
    surfaceArea: '表面積',
    vertices: '頂点数',
    dimension: '寸法',
    before: '変更前',
    after: '変更後',
    change: '変化 (Δ)',
    unchanged: '変化なし',
    increased: '増加',
    decreased: '減少',
    changed: '寸法変更',
    summary: '寸法変更',
    volumeIncreased: '体積増加',
    volumeDecreased: '体積減少',
    volumeUnchanged: '体積変化なし',
    by: '',
    close: '閉じる',
    overlap: 'オーバーラップ',
    bboxViz: 'バウンディングボックス比較',
    mm: 'mm',
    cm3: 'cm³',
    cm2: 'cm²',
    noGeom: 'ジオメトリデータなし',
  },
  cn: {
    title: '版本形状对比',
    width: '宽度',
    height: '高度',
    depth: '深度',
    volume: '体积',
    surfaceArea: '表面积',
    vertices: '顶点数',
    dimension: '尺寸',
    before: '之前',
    after: '之后',
    change: '变化 (Δ)',
    unchanged: '无变化',
    increased: '增加',
    decreased: '减少',
    changed: '尺寸已变更',
    summary: '尺寸已变更',
    volumeIncreased: '体积增加',
    volumeDecreased: '体积减少',
    volumeUnchanged: '体积无变化',
    by: '',
    close: '关闭',
    overlap: '重叠',
    bboxViz: '包围盒对比',
    mm: 'mm',
    cm3: 'cm³',
    cm2: 'cm²',
    noGeom: '无几何数据',
  },
  es: {
    title: 'Diff de Versión de Forma',
    width: 'Ancho',
    height: 'Alto',
    depth: 'Profundidad',
    volume: 'Volumen',
    surfaceArea: 'Área Superficial',
    vertices: 'Vértices',
    dimension: 'Dimensión',
    before: 'Antes',
    after: 'Después',
    change: 'Cambio (Δ)',
    unchanged: 'Sin cambio',
    increased: 'aumentó',
    decreased: 'disminuyó',
    changed: 'dimensiones cambiadas',
    summary: 'dimensiones cambiadas',
    volumeIncreased: 'volumen aumentó',
    volumeDecreased: 'volumen disminuyó',
    volumeUnchanged: 'volumen sin cambio',
    by: 'en',
    close: 'Cerrar',
    overlap: 'Superposición',
    bboxViz: 'Comparación de Caja Delimitadora',
    mm: 'mm',
    cm3: 'cm³',
    cm2: 'cm²',
    noGeom: 'Sin datos de geometría',
  },
  ar: {
    title: 'فرق إصدار الشكل',
    width: 'العرض',
    height: 'الارتفاع',
    depth: 'العمق',
    volume: 'الحجم',
    surfaceArea: 'مساحة السطح',
    vertices: 'الرؤوس',
    dimension: 'البُعد',
    before: 'قبل',
    after: 'بعد',
    change: 'التغيير (Δ)',
    unchanged: 'بدون تغيير',
    increased: 'زيادة',
    decreased: 'نقصان',
    changed: 'أبعاد تغيرت',
    summary: 'أبعاد تغيرت',
    volumeIncreased: 'حجم زاد',
    volumeDecreased: 'حجم نقص',
    volumeUnchanged: 'حجم بدون تغيير',
    by: 'بنسبة',
    close: 'إغلاق',
    overlap: 'تداخل',
    bboxViz: 'مقارنة الصندوق المحيط',
    mm: 'mm',
    cm3: 'cm³',
    cm2: 'cm²',
    noGeom: 'لا توجد بيانات هندسية',
  },
};

function t(lang: string, k: string): string {
  return (L[lang] ?? L.en)[k] ?? (L.en[k] ?? k);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShapeVersionDiffProps {
  lang: string;
  geometryA: THREE.BufferGeometry;
  geometryB: THREE.BufferGeometry;
  labelA?: string;
  labelB?: string;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface BBoxMetrics {
  w: number;  // width  (x)
  h: number;  // height (y)
  d: number;  // depth  (z)
  volume: number;    // cm³ (approximate, from bbox)
  surface: number;   // cm² (approximate, from bbox)
  vertices: number;
}

function computeBBoxMetrics(geo: THREE.BufferGeometry): BBoxMetrics {
  geo.computeBoundingBox();
  const box = geo.boundingBox ?? new THREE.Box3();
  const size = new THREE.Vector3();
  box.getSize(size);
  const w = size.x;
  const h = size.y;
  const d = size.z;
  // Approximate volume and surface area from bounding box
  const volume = (w * h * d) / 1000;  // mm³ → cm³
  const surface = (2 * (w * h + h * d + w * d)) / 100;  // mm² → cm²
  const vertices = geo.attributes.position?.count ?? 0;
  return { w, h, d, volume, surface, vertices };
}

function fmt(v: number, decimals = 2): string {
  return v.toFixed(decimals);
}

function pct(a: number, b: number): string {
  if (a === 0) return b === 0 ? '0' : '∞';
  return fmt(((b - a) / a) * 100, 1);
}

// ─── SVG BBox Wireframe visualization ────────────────────────────────────────

interface BBoxSvgProps {
  w: number;
  h: number;
  d: number;
  color: string;
  label: string;
  svgSize?: number;
}

function BBoxSvgWireframe({ w, h, d, color, label, svgSize = 120 }: BBoxSvgProps) {
  // Simple isometric-ish projection of a box
  const pad = 18;
  const maxDim = Math.max(w, h, d, 1);
  const scale = (svgSize - pad * 2) / maxDim;

  // projected box dimensions
  const pw = w * scale;
  const ph = h * scale;
  const pd = d * scale;

  // Isometric offsets (oblique 30°)
  const ox = pd * Math.cos(Math.PI / 6);
  const oy = pd * Math.sin(Math.PI / 6);

  // Front face bottom-left origin
  const bx = pad + ox;
  const by = svgSize - pad;

  // Front face corners (y goes up → svg y goes down)
  const frontBL = { x: bx, y: by };
  const frontBR = { x: bx + pw, y: by };
  const frontTR = { x: bx + pw, y: by - ph };
  const frontTL = { x: bx, y: by - ph };

  // Back face corners (shifted by oblique offset)
  const backBL = { x: bx - ox, y: by - oy };
  const backBR = { x: bx + pw - ox, y: by - oy };
  const backTR = { x: bx + pw - ox, y: by - ph - oy };
  const backTL = { x: bx - ox, y: by - ph - oy };

  const polyPoints = (pts: { x: number; y: number }[]) =>
    pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  const strokeProps = { stroke: color, strokeWidth: 1.5, fill: 'none', strokeLinejoin: 'round' as const };

  return (
    <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`}>
      {/* Back edges (dashed) */}
      <polyline
        points={polyPoints([backBL, backBR, backTR, backTL, backBL])}
        {...strokeProps}
        stroke={color}
        strokeOpacity={0.4}
        strokeDasharray="3 2"
      />
      {/* Hidden back-to-front edges */}
      <line x1={backBR.x} y1={backBR.y} x2={frontBR.x} y2={frontBR.y} {...strokeProps} strokeOpacity={0.4} strokeDasharray="3 2" />
      {/* Front face */}
      <polyline
        points={polyPoints([frontBL, frontBR, frontTR, frontTL, frontBL])}
        {...strokeProps}
      />
      {/* Top face */}
      <polyline
        points={polyPoints([frontTL, frontTR, backTR, backTL, frontTL])}
        {...strokeProps}
        strokeOpacity={0.7}
      />
      {/* Left side face */}
      <polyline
        points={polyPoints([frontBL, backBL, backTL, frontTL, frontBL])}
        {...strokeProps}
        strokeOpacity={0.7}
      />
      {/* Label */}
      <text
        x={svgSize / 2}
        y={12}
        textAnchor="middle"
        fontSize={10}
        fill={color}
        fontFamily="monospace"
      >
        {label}
      </text>
    </svg>
  );
}

// ─── Overlay SVG (both boxes together) ───────────────────────────────────────

function OverlaySvg({
  mA,
  mB,
  svgSize = 120,
}: {
  mA: BBoxMetrics;
  mB: BBoxMetrics;
  svgSize?: number;
}) {
  const maxDim = Math.max(mA.w, mA.h, mA.d, mB.w, mB.h, mB.d, 1);
  const pad = 18;
  const scale = (svgSize - pad * 2) / maxDim;

  function buildPoints(m: BBoxMetrics) {
    const pw = m.w * scale;
    const ph = m.h * scale;
    const pd = m.d * scale;
    const ox = pd * Math.cos(Math.PI / 6);
    const oy = pd * Math.sin(Math.PI / 6);
    const bx = pad + ox;
    const by = svgSize - pad;
    return {
      frontBL: { x: bx, y: by },
      frontBR: { x: bx + pw, y: by },
      frontTR: { x: bx + pw, y: by - ph },
      frontTL: { x: bx, y: by - ph },
      backTL: { x: bx - ox, y: by - ph - oy },
      backTR: { x: bx + pw - ox, y: by - ph - oy },
    };
  }

  const pA = buildPoints(mA);
  const pB = buildPoints(mB);

  const poly = (pts: { x: number; y: number }[]) =>
    pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  return (
    <svg width={svgSize} height={svgSize} viewBox={`0 0 ${svgSize} ${svgSize}`}>
      {/* Geometry A - blue */}
      <polyline
        points={poly([pA.frontBL, pA.frontBR, pA.frontTR, pA.frontTL, pA.frontBL])}
        stroke="#58a6ff" strokeWidth={1.5} fill="none" strokeOpacity={0.7}
      />
      <polyline
        points={poly([pA.frontTL, pA.frontTR, pA.backTR, pA.backTL, pA.frontTL])}
        stroke="#58a6ff" strokeWidth={1.5} fill="none" strokeOpacity={0.5}
      />
      {/* Geometry B - yellow */}
      <polyline
        points={poly([pB.frontBL, pB.frontBR, pB.frontTR, pB.frontTL, pB.frontBL])}
        stroke="#e3b341" strokeWidth={1.5} fill="none" strokeOpacity={0.7} strokeDasharray="4 2"
      />
      <polyline
        points={poly([pB.frontTL, pB.frontTR, pB.backTR, pB.backTL, pB.frontTL])}
        stroke="#e3b341" strokeWidth={1.5} fill="none" strokeOpacity={0.5} strokeDasharray="4 2"
      />
      {/* Legend */}
      <rect x={4} y={svgSize - 24} width={8} height={8} fill="#58a6ff" rx={1} />
      <text x={15} y={svgSize - 16} fontSize={8} fill="#8b949e" fontFamily="monospace">A</text>
      <rect x={28} y={svgSize - 24} width={8} height={8} fill="#e3b341" rx={1} />
      <text x={39} y={svgSize - 16} fontSize={8} fill="#8b949e" fontFamily="monospace">B</text>
    </svg>
  );
}

// ─── Diff row helper ──────────────────────────────────────────────────────────

interface DiffRowProps {
  label: string;
  valA: number;
  valB: number;
  unit: string;
  decimals?: number;
}

function DiffRow({ label, valA, valB, unit, decimals = 2 }: DiffRowProps) {
  const delta = valB - valA;
  const absDelta = Math.abs(delta);
  const isPositive = delta > 0.001;
  const isNegative = delta < -0.001;
  const color = isPositive ? '#3fb950' : isNegative ? '#f85149' : '#8b949e';
  const sign = isPositive ? '+' : '';

  return (
    <tr style={{ borderBottom: '1px solid #21262d' }}>
      <td style={{ padding: '6px 8px', color: '#8b949e', fontSize: 12, whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ padding: '6px 8px', color: '#58a6ff', fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
        {fmt(valA, decimals)} {unit}
      </td>
      <td style={{ padding: '6px 8px', color: '#e3b341', fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
        {fmt(valB, decimals)} {unit}
      </td>
      <td style={{ padding: '6px 8px', color, fontSize: 12, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
        {isPositive || isNegative ? `${sign}${fmt(absDelta * (isNegative ? -1 : 1) * (delta < 0 ? -1 : 1), decimals)} ${unit}` : '—'}
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ShapeVersionDiff({
  lang,
  geometryA,
  geometryB,
  labelA,
  labelB,
  onClose,
}: ShapeVersionDiffProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const resolvedLang = langMap[seg] ?? langMap[lang] ?? 'en';
  const lA = labelA ?? t(resolvedLang, 'before');
  const lB = labelB ?? t(resolvedLang, 'after');

  const { mA, mB, changedCount, volumePct, summaryText } = useMemo(() => {
    const mA = computeBBoxMetrics(geometryA);
    const mB = computeBBoxMetrics(geometryB);

    const eps = 0.01;
    const dims = [
      Math.abs(mB.w - mA.w) > eps,
      Math.abs(mB.h - mA.h) > eps,
      Math.abs(mB.d - mA.d) > eps,
    ];
    const changedCount = dims.filter(Boolean).length;

    const volumePct = mA.volume > 0
      ? ((mB.volume - mA.volume) / mA.volume) * 100
      : 0;

    let volText: string;
    if (Math.abs(volumePct) < 0.05) {
      volText = t(resolvedLang, 'volumeUnchanged');
    } else if (volumePct > 0) {
      const byStr = t(resolvedLang, 'by');
      volText = `${t(resolvedLang, 'volumeIncreased')}${byStr ? ' ' + byStr : ''} ${Math.abs(volumePct).toFixed(1)}%`;
    } else {
      const byStr = t(resolvedLang, 'by');
      volText = `${t(resolvedLang, 'volumeDecreased')}${byStr ? ' ' + byStr : ''} ${Math.abs(volumePct).toFixed(1)}%`;
    }

    const summaryText = `${changedCount} ${t(resolvedLang, 'summary')}, ${volText}`;

    return { mA, mB, changedCount, volumePct, summaryText };
  }, [geometryA, geometryB, resolvedLang]);

  const summaryColor = Math.abs(volumePct) < 0.05 ? '#8b949e' : volumePct > 0 ? '#3fb950' : '#f85149';

  return (
    <div
      style={{
        position: 'fixed',
        top: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 560,
        maxWidth: 'calc(100vw - 32px)',
        background: '#161b22',
        border: '1px solid #30363d',
        borderRadius: 10,
        zIndex: 800,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflow: 'hidden',
        maxHeight: 'calc(100vh - 80px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          background: '#1c2128',
          borderBottom: '1px solid #30363d',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14, color: '#e6edf3', fontWeight: 600 }}>
            {t(resolvedLang, 'title')}
          </span>
          <span
            style={{
              fontSize: 11,
              color: '#58a6ff',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 4,
              padding: '1px 6px',
              fontFamily: 'monospace',
            }}
          >
            {lA}
          </span>
          <span style={{ color: '#8b949e', fontSize: 12 }}>→</span>
          <span
            style={{
              fontSize: 11,
              color: '#e3b341',
              background: '#0d1117',
              border: '1px solid #30363d',
              borderRadius: 4,
              padding: '1px 6px',
              fontFamily: 'monospace',
            }}
          >
            {lB}
          </span>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#8b949e',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '2px 6px',
            borderRadius: 4,
          }}
          title={t(resolvedLang, 'close')}
        >
          ✕
        </button>
      </div>

      {/* Scrollable body */}
      <div
        className="nf-scroll"
        style={{ overflowY: 'auto', flex: 1 }}
      >
        {/* Summary banner */}
        <div
          style={{
            padding: '8px 14px',
            background: '#0d1117',
            borderBottom: '1px solid #21262d',
            fontSize: 12,
            color: summaryColor,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: summaryColor,
              flexShrink: 0,
            }}
          />
          {summaryText}
        </div>

        {/* BBox SVG visualization */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            padding: '14px',
            borderBottom: '1px solid #21262d',
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#58a6ff', marginBottom: 4, fontFamily: 'monospace' }}>{lA}</div>
            <BBoxSvgWireframe
              w={mA.w} h={mA.h} d={mA.d}
              color="#58a6ff"
              label=""
              svgSize={110}
            />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>{t(resolvedLang, 'overlap')}</div>
            <OverlaySvg mA={mA} mB={mB} svgSize={110} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: '#e3b341', marginBottom: 4, fontFamily: 'monospace' }}>{lB}</div>
            <BBoxSvgWireframe
              w={mB.w} h={mB.h} d={mB.d}
              color="#e3b341"
              label=""
              svgSize={110}
            />
          </div>
        </div>

        {/* Diff table */}
        <div style={{ padding: '4px 14px 14px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #30363d' }}>
                <th style={{ padding: '6px 8px', color: '#8b949e', fontSize: 11, textAlign: 'left', fontWeight: 500 }}>
                  {t(resolvedLang, 'dimension')}
                </th>
                <th style={{ padding: '6px 8px', color: '#58a6ff', fontSize: 11, textAlign: 'right', fontWeight: 500 }}>
                  {lA}
                </th>
                <th style={{ padding: '6px 8px', color: '#e3b341', fontSize: 11, textAlign: 'right', fontWeight: 500 }}>
                  {lB}
                </th>
                <th style={{ padding: '6px 8px', color: '#8b949e', fontSize: 11, textAlign: 'right', fontWeight: 500 }}>
                  {t(resolvedLang, 'change')}
                </th>
              </tr>
            </thead>
            <tbody>
              <DiffRow label={`${t(resolvedLang, 'width')} (${t(resolvedLang, 'mm')})`} valA={mA.w} valB={mB.w} unit={t(resolvedLang, 'mm')} />
              <DiffRow label={`${t(resolvedLang, 'height')} (${t(resolvedLang, 'mm')})`} valA={mA.h} valB={mB.h} unit={t(resolvedLang, 'mm')} />
              <DiffRow label={`${t(resolvedLang, 'depth')} (${t(resolvedLang, 'mm')})`} valA={mA.d} valB={mB.d} unit={t(resolvedLang, 'mm')} />
              <DiffRow label={`${t(resolvedLang, 'volume')} (${t(resolvedLang, 'cm3')})`} valA={mA.volume} valB={mB.volume} unit={t(resolvedLang, 'cm3')} />
              <DiffRow label={`${t(resolvedLang, 'surfaceArea')} (${t(resolvedLang, 'cm2')})`} valA={mA.surface} valB={mB.surface} unit={t(resolvedLang, 'cm2')} />
              <tr>
                <td style={{ padding: '6px 8px', color: '#8b949e', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {t(resolvedLang, 'vertices')}
                </td>
                <td style={{ padding: '6px 8px', color: '#58a6ff', fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
                  {mA.vertices.toLocaleString()}
                </td>
                <td style={{ padding: '6px 8px', color: '#e3b341', fontSize: 12, textAlign: 'right', fontFamily: 'monospace' }}>
                  {mB.vertices.toLocaleString()}
                </td>
                <td
                  style={{
                    padding: '6px 8px',
                    fontSize: 12,
                    textAlign: 'right',
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    color:
                      mB.vertices > mA.vertices
                        ? '#3fb950'
                        : mB.vertices < mA.vertices
                        ? '#f85149'
                        : '#8b949e',
                  }}
                >
                  {mB.vertices !== mA.vertices
                    ? `${mB.vertices > mA.vertices ? '+' : ''}${(mB.vertices - mA.vertices).toLocaleString()}`
                    : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Volume % change bar */}
        {Math.abs(volumePct) >= 0.05 && (
          <div
            style={{
              padding: '0 14px 14px',
            }}
          >
            <div style={{ fontSize: 11, color: '#8b949e', marginBottom: 4 }}>
              {t(resolvedLang, 'volume')} Δ {pct(mA.volume, mB.volume)}%
            </div>
            <div
              style={{
                height: 6,
                background: '#21262d',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(Math.abs(volumePct), 100)}%`,
                  background: volumePct > 0 ? '#3fb950' : '#f85149',
                  borderRadius: 3,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
