'use client';

import React, { useState } from 'react';
import * as THREE from 'three';
import { UniqueEdge } from './types';

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
  const [filletRadius, setFilletRadius] = useState(3);
  const [filletSegments, setFilletSegments] = useState(3);
  const [chamferDist, setChamferDist] = useState(2);

  if (selectedEdges.length === 0 || geometry === null) return null;

  const isKo = lang === 'ko';

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
        <span>{isKo ? '엣지 편집' : 'Edge Edit'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {edgeCount > 1 && (
            <span style={badgeStyle}>{edgeCount}{isKo ? '개 선택' : ' selected'}</span>
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
                {isKo ? '엣지 ID' : 'Edge ID'}: <strong style={{ color: '#e6edf3' }}>{firstEdge.id}</strong>
              </div>
              <div>
                {isKo ? '중점' : 'Midpoint'}:{' '}
                <strong style={{ color: '#e6edf3' }}>
                  ({mx.toFixed(1)}, {my.toFixed(1)}, {mz.toFixed(1)})
                </strong>
              </div>
            </>
          ) : (
            <>
              <div style={{ color: '#e6edf3', fontWeight: 600, marginBottom: 4 }}>
                {isKo ? `엣지 ${edgeCount}개 선택됨` : `${edgeCount} edges selected`}
              </div>
              <div style={{ fontSize: 11, color: '#6e7681' }}>
                IDs: {selectedEdges.map(e => e.id).join(', ')}
              </div>
              <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                {isKo ? 'Shift+클릭으로 추가 선택' : 'Shift+click to add more'}
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
            {isKo ? '선택 초기화' : 'Clear Selection'}
          </button>
        )}

        {/* Geometry warning */}
        {hasInsufficientGeometry && (
          <div style={warningStyle}>
            {isKo ? '형상을 먼저 생성하세요' : 'Please generate geometry first'}
          </div>
        )}

        {/* Fillet Section */}
        <div>
          <div style={sectionTitleStyle}>{isKo ? '필렛 (Fillet)' : 'Fillet'}</div>
          <div style={sectionBoxStyle}>
            {/* Radius */}
            <div>
              <div style={labelRowStyle}>
                <span>{isKo ? '반경' : 'Radius'}</span>
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
                <span>{isKo ? '세그먼트' : 'Segments'}</span>
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
              {isKo
                ? (edgeCount > 1 ? `필렛 적용 (${edgeCount}개)` : '필렛 적용')
                : (edgeCount > 1 ? `Apply Fillet (${edgeCount})` : 'Apply Fillet')}
            </button>
          </div>
        </div>

        {/* Chamfer Section */}
        <div>
          <div style={sectionTitleStyle}>{isKo ? '챔퍼 (Chamfer)' : 'Chamfer'}</div>
          <div style={sectionBoxStyle}>
            {/* Distance */}
            <div>
              <div style={labelRowStyle}>
                <span>{isKo ? '거리' : 'Distance'}</span>
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
              {isKo
                ? (edgeCount > 1 ? `챔퍼 적용 (${edgeCount}개)` : '챔퍼 적용')
                : (edgeCount > 1 ? `Apply Chamfer (${edgeCount})` : 'Apply Chamfer')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
