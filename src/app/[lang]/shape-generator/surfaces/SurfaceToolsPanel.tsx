'use client';

/**
 * SurfaceToolsPanel.tsx — Surface modeling tool launcher.
 *
 * Card grid for Coons / Network / Trim / Knit / Fillet / Offset
 * tools. Selecting a card opens that tool's curve-picker workflow
 * (caller integrates with the viewport selection state).
 */

import React, { useState } from 'react';

type SurfaceTool = 'coons' | 'network' | 'trim' | 'knit' | 'fillet' | 'offset' | 'thicken';

interface SurfaceToolsPanelProps {
  lang: string;
  onClose?: () => void;
  /** Caller starts the corresponding pick workflow. */
  onLaunchTool: (tool: SurfaceTool) => void;
}

const COPY = {
  ko: {
    title: '서피스 도구',
    coons: { label: 'Coons 패치', desc: '4개 경계 곡선 입력' },
    network: { label: '네트워크', desc: 'N×M 곡선 그리드' },
    trim: { label: '트림', desc: 'UV polyline 잘라내기' },
    knit: { label: '봉합', desc: '여러 surface 결합' },
    fillet: { label: '필렛', desc: '경계 G1 블렌드' },
    offset: { label: '오프셋', desc: '법선 방향 이동' },
    thicken: { label: '두께 부여', desc: 'Solid 변환' },
  },
  en: {
    title: 'Surface Tools',
    coons: { label: 'Coons Patch', desc: '4 boundary curves' },
    network: { label: 'Network', desc: 'N×M curve grid' },
    trim: { label: 'Trim', desc: 'Cut by UV polyline' },
    knit: { label: 'Knit', desc: 'Merge surfaces' },
    fillet: { label: 'Fillet', desc: 'G1 edge blend' },
    offset: { label: 'Offset', desc: 'Normal-direction shift' },
    thicken: { label: 'Thicken', desc: 'Convert to solid' },
  },
  ja: {
    title: 'サーフェスツール',
    coons: { label: 'Coons パッチ', desc: '4本の境界曲線を入力' },
    network: { label: 'ネットワーク', desc: 'N×M 曲線グリッド' },
    trim: { label: 'トリム', desc: 'UV ポリラインで切断' },
    knit: { label: 'ニット', desc: '複数サーフェスを結合' },
    fillet: { label: 'フィレット', desc: '境界の G1 ブレンド' },
    offset: { label: 'オフセット', desc: '法線方向へ移動' },
    thicken: { label: '厚み付け', desc: 'ソリッドへ変換' },
  },
  zh: {
    title: '曲面工具',
    coons: { label: 'Coons 曲面', desc: '输入 4 条边界曲线' },
    network: { label: '网格曲面', desc: 'N×M 曲线网格' },
    trim: { label: '修剪', desc: '按 UV 折线裁切' },
    knit: { label: '缝合', desc: '合并多个曲面' },
    fillet: { label: '圆角', desc: '边界 G1 过渡' },
    offset: { label: '偏移', desc: '沿法线方向移动' },
    thicken: { label: '加厚', desc: '转换为实体' },
  },
  es: {
    title: 'Herramientas de superficie',
    coons: { label: 'Parche de Coons', desc: '4 curvas de contorno' },
    network: { label: 'Red', desc: 'Malla de curvas N×M' },
    trim: { label: 'Recortar', desc: 'Cortar por polilínea UV' },
    knit: { label: 'Coser', desc: 'Unir superficies' },
    fillet: { label: 'Redondeo', desc: 'Mezcla G1 de bordes' },
    offset: { label: 'Desfase', desc: 'Desplazar según la normal' },
    thicken: { label: 'Engrosar', desc: 'Convertir en sólido' },
  },
  ar: {
    title: 'أدوات الأسطح',
    coons: { label: 'رقعة Coons', desc: 'أربعة منحنيات حدّية' },
    network: { label: 'شبكة', desc: 'شبكة منحنيات N×M' },
    trim: { label: 'قص', desc: 'القص بخط UV متعدد' },
    knit: { label: 'خياطة', desc: 'دمج عدة أسطح' },
    fillet: { label: 'تدوير الحواف', desc: 'مزج G1 عند الحدّ' },
    offset: { label: 'إزاحة', desc: 'إزاحة باتجاه العمودي' },
    thicken: { label: 'تسميك', desc: 'التحويل إلى مجسم صلب' },
  },
} as const;

export default function SurfaceToolsPanel({
  lang, onClose, onLaunchTool,
}: SurfaceToolsPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  const t = ko ? COPY.ko : COPY.en;
  const [hovered, setHovered] = useState<SurfaceTool | null>(null);

  const tools: Array<{ id: SurfaceTool; icon: string; }> = [
    { id: 'coons', icon: '◰' },
    { id: 'network', icon: '◫' },
    { id: 'trim', icon: '✂' },
    { id: 'knit', icon: '⌗' },
    { id: 'fillet', icon: '◖' },
    { id: 'offset', icon: '⤓' },
    { id: 'thicken', icon: '▦' },
  ];

  return (
    <div style={panelStyle()}>
      <div style={headerStyle()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {tools.map(tool => {
          const copy = t[tool.id];
          const isHov = hovered === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => onLaunchTool(tool.id)}
              onMouseEnter={() => setHovered(tool.id)}
              onMouseLeave={() => setHovered(null)}
              style={{
                background: isHov ? '#1e3a8a' : 'var(--nx-panel-2)',
                border: isHov ? '1px solid #3b82f6' : '1px solid var(--nx-border)',
                borderRadius: 8,
                padding: '14px 10px',
                color: 'var(--nx-text)',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                transition: 'background 120ms, border 120ms',
              }}
            >
              <div style={{ fontSize: 22 }}>{tool.icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4 }}>{copy.label}</div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginTop: 2 }}>{copy.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// right: 336 clears the 320px right property pane (2026-06-12)
function panelStyle(): React.CSSProperties { return { position: 'fixed', top: 80, right: 340, zIndex: 700, width: 320, background: 'var(--nx-panel)', color: 'var(--nx-text)', borderRadius: 10, padding: '14px 16px', boxShadow: '0 12px 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }; }
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 16 }; }
