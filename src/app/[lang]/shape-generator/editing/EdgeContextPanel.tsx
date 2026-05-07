'use client';

import React, { useState } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import { UniqueEdge } from './types';

const dict = {
  ko: {
    edgeEdit: '엣지 편집',
    selected: '개 선택',
    edgeId: '엣지 ID',
    midpoint: '중점',
    edgesSelected: (n: number) => `엣지 ${n}개 선택됨`,
    shiftHint: 'Shift+클릭으로 추가 선택',
    clearSelection: '선택 초기화',
    genGeomFirst: '형상을 먼저 생성하세요',
    filletTitle: '필렛 (Fillet)',
    chamferTitle: '챔퍼 (Chamfer)',
    radius: '반경',
    segments: '세그먼트',
    distance: '거리',
    applyFillet: '필렛 적용',
    applyFilletN: (n: number) => `필렛 적용 (${n}개)`,
    applyChamfer: '챔퍼 적용',
    applyChamferN: (n: number) => `챔퍼 적용 (${n}개)`,
  },
  en: {
    edgeEdit: 'Edge Edit',
    selected: ' selected',
    edgeId: 'Edge ID',
    midpoint: 'Midpoint',
    edgesSelected: (n: number) => `${n} edges selected`,
    shiftHint: 'Shift+click to add more',
    clearSelection: 'Clear Selection',
    genGeomFirst: 'Please generate geometry first',
    filletTitle: 'Fillet',
    chamferTitle: 'Chamfer',
    radius: 'Radius',
    segments: 'Segments',
    distance: 'Distance',
    applyFillet: 'Apply Fillet',
    applyFilletN: (n: number) => `Apply Fillet (${n})`,
    applyChamfer: 'Apply Chamfer',
    applyChamferN: (n: number) => `Apply Chamfer (${n})`,
  },
  ja: {
    edgeEdit: 'エッジ編集',
    selected: '個選択',
    edgeId: 'エッジID',
    midpoint: '中点',
    edgesSelected: (n: number) => `エッジ ${n} 個選択中`,
    shiftHint: 'Shift+クリックで追加選択',
    clearSelection: '選択をクリア',
    genGeomFirst: '先に形状を生成してください',
    filletTitle: 'Fillet (フィレット)',
    chamferTitle: 'Chamfer (面取り)',
    radius: '半径',
    segments: 'セグメント',
    distance: '距離',
    applyFillet: 'Fillet 適用',
    applyFilletN: (n: number) => `Fillet 適用 (${n} 個)`,
    applyChamfer: 'Chamfer 適用',
    applyChamferN: (n: number) => `Chamfer 適用 (${n} 個)`,
  },
  zh: {
    edgeEdit: '边编辑',
    selected: '已选',
    edgeId: '边ID',
    midpoint: '中点',
    edgesSelected: (n: number) => `已选 ${n} 条边`,
    shiftHint: 'Shift+点击继续选择',
    clearSelection: '清除选择',
    genGeomFirst: '请先生成几何',
    filletTitle: 'Fillet (圆角)',
    chamferTitle: 'Chamfer (倒角)',
    radius: '半径',
    segments: '分段',
    distance: '距离',
    applyFillet: '应用 Fillet',
    applyFilletN: (n: number) => `应用 Fillet (${n})`,
    applyChamfer: '应用 Chamfer',
    applyChamferN: (n: number) => `应用 Chamfer (${n})`,
  },
  es: {
    edgeEdit: 'Editar Arista',
    selected: ' seleccionado(s)',
    edgeId: 'ID de Arista',
    midpoint: 'Punto medio',
    edgesSelected: (n: number) => `${n} aristas seleccionadas`,
    shiftHint: 'Shift+clic para añadir más',
    clearSelection: 'Limpiar Selección',
    genGeomFirst: 'Genere la geometría primero',
    filletTitle: 'Fillet',
    chamferTitle: 'Chamfer',
    radius: 'Radio',
    segments: 'Segmentos',
    distance: 'Distancia',
    applyFillet: 'Aplicar Fillet',
    applyFilletN: (n: number) => `Aplicar Fillet (${n})`,
    applyChamfer: 'Aplicar Chamfer',
    applyChamferN: (n: number) => `Aplicar Chamfer (${n})`,
  },
  ar: {
    edgeEdit: 'تحرير الحافة',
    selected: ' محدد',
    edgeId: 'معرف الحافة',
    midpoint: 'نقطة المنتصف',
    edgesSelected: (n: number) => `${n} حواف محددة`,
    shiftHint: 'Shift+نقرة للإضافة',
    clearSelection: 'مسح التحديد',
    genGeomFirst: 'يرجى إنشاء الهندسة أولاً',
    filletTitle: 'Fillet',
    chamferTitle: 'Chamfer',
    radius: 'نصف القطر',
    segments: 'الأجزاء',
    distance: 'المسافة',
    applyFillet: 'تطبيق Fillet',
    applyFilletN: (n: number) => `تطبيق Fillet (${n})`,
    applyChamfer: 'تطبيق Chamfer',
    applyChamferN: (n: number) => `تطبيق Chamfer (${n})`,
  },
};

interface EdgeContextPanelProps {
  selectedEdges: UniqueEdge[];
  geometry: THREE.BufferGeometry | null;
  lang: string;
  onApplyFillet: (radius: number, segments: number) => void;
  onApplyChamfer: (distance: number) => void;
  onClose: () => void;
  onClearSelection: () => void;
}

export default function EdgeContextPanel({
  selectedEdges,
  geometry,
  lang,
  onApplyFillet,
  onApplyChamfer,
  onClose,
  onClearSelection,
}: EdgeContextPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? langMap[lang] ?? 'en'];

  const [filletRadius, setFilletRadius] = useState(3);
  const [filletSegments, setFilletSegments] = useState(3);
  const [chamferDist, setChamferDist] = useState(2);

  if (selectedEdges.length === 0 || geometry === null) return null;

  const posAttr = geometry.getAttribute('position');
  const vertexCount = posAttr ? posAttr.count : 0;
  const hasInsufficientGeometry = vertexCount < 4;

  const edgeCount = selectedEdges.length;
  const firstEdge = selectedEdges[0];
  const [mx, my, mz] = firstEdge.midpoint;

  const panelStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 80,
    right: 20,
    zIndex: 500,
    width: 260,
    backgroundColor: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 12,
    color: '#e6edf3',
    fontFamily: 'sans-serif',
    fontSize: 13,
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    overflow: 'hidden',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid #30363d',
    fontWeight: 600,
    fontSize: 14,
  };

  const closeBtnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: '#8b949e',
    cursor: 'pointer',
    fontSize: 18,
    lineHeight: 1,
    padding: '0 2px',
  };

  const bodyStyle: React.CSSProperties = {
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  };

  const infoBoxStyle: React.CSSProperties = {
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 12,
    color: '#8b949e',
    lineHeight: 1.6,
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontWeight: 600,
    fontSize: 12,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: 8,
  };

  const sectionBoxStyle: React.CSSProperties = {
    backgroundColor: '#0d1117',
    border: '1px solid #30363d',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  };

  const labelRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 12,
    color: '#c9d1d9',
  };

  const sliderStyle: React.CSSProperties = {
    width: '100%',
    accentColor: '#58a6ff',
    cursor: 'pointer',
  };

  const applyBtnStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 0',
    backgroundColor: '#1f6feb',
    border: 'none',
    borderRadius: 6,
    color: '#ffffff',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
  };

  const segmentBtnBase: React.CSSProperties = {
    flex: 1,
    padding: '4px 0',
    border: '1px solid #30363d',
    borderRadius: 5,
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
  };

  const warningStyle: React.CSSProperties = {
    backgroundColor: '#2d1c1c',
    border: '1px solid #5a1d1d',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 12,
    color: '#f85149',
    textAlign: 'center',
  };

  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245,158,11,0.15)',
    border: '1px solid rgba(245,158,11,0.4)',
    borderRadius: 10,
    padding: '2px 8px',
    fontSize: 11,
    color: '#f59e0b',
    fontWeight: 700,
  };

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span>{t.edgeEdit}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {edgeCount > 1 && (
            <span style={badgeStyle}>{edgeCount}{t.selected}</span>
          )}
          <button style={closeBtnStyle} onClick={onClose} title="Close">×</button>
        </div>
      </div>

      <div style={bodyStyle}>
        {/* Edge Info */}
        <div style={infoBoxStyle}>
          {edgeCount === 1 ? (
            <>
              <div>
                {t.edgeId}: <strong style={{ color: '#e6edf3' }}>{firstEdge.id}</strong>
              </div>
              <div>
                {t.midpoint}:{' '}
                <strong style={{ color: '#e6edf3' }}>
                  ({mx.toFixed(1)}, {my.toFixed(1)}, {mz.toFixed(1)})
                </strong>
              </div>
            </>
          ) : (
            <>
              <div style={{ color: '#e6edf3', fontWeight: 600, marginBottom: 4 }}>
                {t.edgesSelected(edgeCount)}
              </div>
              <div style={{ fontSize: 11, color: '#6e7681' }}>
                IDs: {selectedEdges.map(e => e.id).join(', ')}
              </div>
              <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                {t.shiftHint}
              </div>
            </>
          )}
        </div>

        {/* Clear multi-selection */}
        {edgeCount > 1 && (
          <button
            onClick={onClearSelection}
            style={{ ...applyBtnStyle, backgroundColor: '#21262d', color: '#8b949e', border: '1px solid #30363d' }}
          >
            {t.clearSelection}
          </button>
        )}

        {/* Geometry warning */}
        {hasInsufficientGeometry && (
          <div style={warningStyle}>
            {t.genGeomFirst}
          </div>
        )}

        {/* Fillet Section */}
        <div>
          <div style={sectionTitleStyle}>{t.filletTitle}</div>
          <div style={sectionBoxStyle}>
            {/* Radius */}
            <div>
              <div style={labelRowStyle}>
                <span>{t.radius}</span>
                <span style={{ color: '#58a6ff', fontWeight: 600 }}>{filletRadius.toFixed(1)} mm</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={20}
                step={0.5}
                value={filletRadius}
                onChange={(e) => setFilletRadius(parseFloat(e.target.value))}
                style={sliderStyle}
              />
            </div>

            {/* Segments */}
            <div>
              <div style={{ ...labelRowStyle, marginBottom: 6 }}>
                <span>{t.segments}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {[1, 2, 3, 4, 5].map((seg) => (
                  <button
                    key={seg}
                    onClick={() => setFilletSegments(seg)}
                    style={{
                      ...segmentBtnBase,
                      backgroundColor: filletSegments === seg ? '#6e40c9' : '#161b22',
                      borderColor: filletSegments === seg ? '#7948d0' : '#30363d',
                      color: filletSegments === seg ? '#ffffff' : '#8b949e',
                    }}
                  >
                    {seg}
                  </button>
                ))}
              </div>
            </div>

            {/* Apply Fillet */}
            <button
              style={applyBtnStyle}
              disabled={hasInsufficientGeometry}
              onClick={() => onApplyFillet(filletRadius, filletSegments)}
            >
              {edgeCount > 1 ? t.applyFilletN(edgeCount) : t.applyFillet}
            </button>
          </div>
        </div>

        {/* Chamfer Section */}
        <div>
          <div style={sectionTitleStyle}>{t.chamferTitle}</div>
          <div style={sectionBoxStyle}>
            {/* Distance */}
            <div>
              <div style={labelRowStyle}>
                <span>{t.distance}</span>
                <span style={{ color: '#58a6ff', fontWeight: 600 }}>{chamferDist.toFixed(1)} mm</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={20}
                step={0.5}
                value={chamferDist}
                onChange={(e) => setChamferDist(parseFloat(e.target.value))}
                style={sliderStyle}
              />
            </div>

            {/* Apply Chamfer */}
            <button
              style={applyBtnStyle}
              disabled={hasInsufficientGeometry}
              onClick={() => onApplyChamfer(chamferDist)}
            >
              {edgeCount > 1 ? t.applyChamferN(edgeCount) : t.applyChamfer}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
