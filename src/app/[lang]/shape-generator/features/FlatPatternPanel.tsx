'use client';

import React, { useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  generateFlatPattern,
  detectBendZones,
  generateSimpleFlatPattern,
} from './flatPattern';
import type { FlatPatternResult } from './flatPattern';

interface FlatPatternPanelProps {
  geometry: THREE.BufferGeometry | null;
  thickness: number;
  theme: {
    panelBg: string;
    border: string;
    text: string;
    textMuted: string;
    cardBg: string;
    accent: string;
  };
  lang: string;
}

export default function FlatPatternPanel({
  geometry,
  thickness,
  theme,
  lang,
}: FlatPatternPanelProps) {
  const [result, setResult] = useState<FlatPatternResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isKo = lang === 'ko';

  const runFlatPattern = useCallback(async () => {
    if (!geometry) return;
    setLoading(true);
    setError(null);

    try {
      await new Promise<void>(resolve => setTimeout(resolve, 10)); // yield to UI
      const bends = detectBendZones(geometry, thickness);

      let res: FlatPatternResult;
      if (bends.length === 0) {
        // No bends detected — use simple approximation based on bounding box
        const bb = new THREE.Box3().setFromBufferAttribute(
          geometry.getAttribute('position') as THREE.BufferAttribute,
        );
        const size = new THREE.Vector3();
        bb.getSize(size);
        res = generateSimpleFlatPattern(size.x, size.y, size.z, thickness);
      } else {
        res = generateFlatPattern(geometry, bends);
      }
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [geometry, thickness]);

  const downloadDXF = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flat_pattern.dxf';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const downloadSVG = useCallback(() => {
    if (!result) return;
    const blob = new Blob([result.svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flat_pattern.svg';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
        {isKo ? '판금 전개도' : 'Sheet Metal Flat Pattern'}
      </div>

      <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.5 }}>
        {isKo
          ? '3D 판금 부품을 2D 전개도로 변환합니다. 굽힘 허용량(K=0.33)이 자동 계산됩니다.'
          : 'Unfolds the 3D sheet metal part to a 2D flat pattern. Bend allowance (K=0.33) is calculated automatically.'}
      </div>

      <div style={{ fontSize: 11, color: theme.textMuted }}>
        {isKo ? '두께' : 'Thickness'}: {thickness}mm &nbsp;|&nbsp; K-Factor: 0.33
      </div>

      <button
        onClick={runFlatPattern}
        disabled={!geometry || loading}
        style={{
          padding: '8px 14px',
          borderRadius: 6,
          border: 'none',
          background: theme.accent,
          color: '#fff',
          fontSize: 12,
          fontWeight: 700,
          cursor: geometry ? 'pointer' : 'default',
          opacity: geometry ? 1 : 0.4,
        }}
      >
        {loading
          ? (isKo ? '계산 중...' : 'Calculating...')
          : (isKo ? '전개도 생성' : 'Generate Flat Pattern')}
      </button>

      {error && (
        <div
          style={{
            fontSize: 11,
            color: '#f85149',
            padding: 8,
            background: '#2a1a1a',
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* SVG Preview */}
          <div
            dangerouslySetInnerHTML={{ __html: result.svg }}
            style={{
              borderRadius: 6,
              overflow: 'hidden',
              border: `1px solid ${theme.border}`,
            }}
          />

          {/* Dimensions */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 6,
              background: theme.cardBg,
              borderRadius: 6,
              padding: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 10, color: theme.textMuted }}>
                {isKo ? '전개 길이' : 'Flat Length'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
                {result.flatLength.toFixed(1)} mm
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textMuted }}>
                {isKo ? '전개 폭' : 'Flat Width'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
                {result.flatWidth.toFixed(1)} mm
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textMuted }}>
                {isKo ? '굽힘 수' : 'Bend Count'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
                {result.bendAllowances.length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textMuted }}>
                {isKo ? '총 굽힘 허용량' : 'Total BA'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
                {result.totalBendAllowance.toFixed(2)} mm
              </div>
            </div>
          </div>

          {/* Bend details */}
          {result.bendAllowances.length > 0 && (
            <div
              style={{
                background: theme.cardBg,
                borderRadius: 6,
                padding: 10,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: theme.textMuted,
                  marginBottom: 6,
                }}
              >
                {isKo ? '굽힘 상세' : 'Bend Details'}
              </div>
              {result.bendAllowances.map((ba, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 11,
                    color: theme.text,
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '2px 0',
                  }}
                >
                  <span>{isKo ? `굽힘 ${i + 1}` : `Bend ${i + 1}`}</span>
                  <span style={{ color: theme.textMuted }}>BA = {ba.toFixed(2)} mm</span>
                </div>
              ))}
            </div>
          )}

          {/* Download buttons */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={downloadDXF}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: 6,
                border: `1px solid ${theme.border}`,
                background: theme.cardBg,
                color: theme.text,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              DXF {isKo ? '다운로드' : 'Download'}
            </button>
            <button
              onClick={downloadSVG}
              style={{
                flex: 1,
                padding: '7px 10px',
                borderRadius: 6,
                border: `1px solid ${theme.border}`,
                background: theme.cardBg,
                color: theme.text,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              SVG {isKo ? '다운로드' : 'Download'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
