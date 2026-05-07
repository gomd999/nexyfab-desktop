'use client';

import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
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

const dict = {
  ko: {
    title: '판금 전개도 (Unfold)',
    description: '3D 판금 부품을 2D 전개도(Pattern)로 변환합니다. Bend 허용량(K-factor=0.33)이 자동 계산됩니다.',
    thickness: '두께',
    calculating: '계산 중...',
    generate: '전개도 생성',
    flatLength: '전개 길이',
    flatWidth: '전개 폭',
    bendCount: 'Bend 수',
    totalBA: '총 Bend 허용량',
    bendDetails: 'Bend 상세',
    bend: 'Bend',
    download: '다운로드',
  },
  en: {
    title: 'Sheet Metal Flat Pattern',
    description: 'Unfolds the 3D Sheet Metal part to a 2D flat pattern. Bend allowance (K-factor=0.33) is calculated automatically.',
    thickness: 'Thickness',
    calculating: 'Calculating...',
    generate: 'Generate Flat Pattern',
    flatLength: 'Flat Length',
    flatWidth: 'Flat Width',
    bendCount: 'Bend Count',
    totalBA: 'Total BA',
    bendDetails: 'Bend Details',
    bend: 'Bend',
    download: 'Download',
  },
  ja: {
    title: '板金展開図 (Unfold)',
    description: '3D Sheet Metal 部品を 2D Pattern に変換します。Bend 許容量 (K-factor=0.33) が自動計算されます。',
    thickness: '厚さ',
    calculating: '計算中...',
    generate: '展開図を生成',
    flatLength: '展開長さ',
    flatWidth: '展開幅',
    bendCount: 'Bend 数',
    totalBA: '合計 Bend 許容量',
    bendDetails: 'Bend 詳細',
    bend: 'Bend',
    download: 'ダウンロード',
  },
  zh: {
    title: '钣金展开图 (Unfold)',
    description: '将 3D Sheet Metal 零件转换为 2D Pattern。Bend 允许量 (K-factor=0.33) 自动计算。',
    thickness: '厚度',
    calculating: '计算中...',
    generate: '生成展开图',
    flatLength: '展开长度',
    flatWidth: '展开宽度',
    bendCount: 'Bend 数',
    totalBA: '总 Bend 允许量',
    bendDetails: 'Bend 详情',
    bend: 'Bend',
    download: '下载',
  },
  es: {
    title: 'Patrón Plano de Chapa (Unfold)',
    description: 'Desdobla la pieza 3D de Sheet Metal a un Pattern plano 2D. La tolerancia de Bend (K-factor=0.33) se calcula automáticamente.',
    thickness: 'Espesor',
    calculating: 'Calculando...',
    generate: 'Generar Patrón Plano',
    flatLength: 'Longitud Plana',
    flatWidth: 'Ancho Plano',
    bendCount: 'Cantidad de Bend',
    totalBA: 'BA Total',
    bendDetails: 'Detalles de Bend',
    bend: 'Bend',
    download: 'Descargar',
  },
  ar: {
    title: 'نمط مسطح للصاج (Unfold)',
    description: 'فرد قطعة Sheet Metal ثلاثية الأبعاد إلى Pattern مسطح ثنائي الأبعاد. يتم حساب سماح Bend (K-factor=0.33) تلقائيًا.',
    thickness: 'السماكة',
    calculating: 'جارٍ الحساب...',
    generate: 'إنشاء النمط المسطح',
    flatLength: 'الطول المسطح',
    flatWidth: 'العرض المسطح',
    bendCount: 'عدد Bend',
    totalBA: 'إجمالي BA',
    bendDetails: 'تفاصيل Bend',
    bend: 'Bend',
    download: 'تنزيل',
  },
};

export default function FlatPatternPanel({
  geometry,
  thickness,
  theme,
  lang,
}: FlatPatternPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [result, setResult] = useState<FlatPatternResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    void (async () => {
      if (!result) return;
      const { downloadBlob } = await import('@/lib/platform');
      const blob = new Blob([result.dxf], { type: 'application/dxf' });
      await downloadBlob('flat_pattern.dxf', blob);
    })();
  }, [result]);

  const downloadSVG = useCallback(() => {
    void (async () => {
      if (!result) return;
      const { downloadBlob } = await import('@/lib/platform');
      const blob = new Blob([result.svg], { type: 'image/svg+xml' });
      await downloadBlob('flat_pattern.svg', blob);
    })();
  }, [result]);

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>
        {t.title}
      </div>

      <div style={{ fontSize: 11, color: theme.textMuted, lineHeight: 1.5 }}>
        {t.description}
      </div>

      <div style={{ fontSize: 11, color: theme.textMuted }}>
        {t.thickness}: {thickness}mm &nbsp;|&nbsp; K-Factor: 0.33
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
        {loading ? t.calculating : t.generate}
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
                {t.flatLength}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
                {result.flatLength.toFixed(1)} mm
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textMuted }}>
                {t.flatWidth}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
                {result.flatWidth.toFixed(1)} mm
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textMuted }}>
                {t.bendCount}
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
                {result.bendAllowances.length}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: theme.textMuted }}>
                {t.totalBA}
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
                {t.bendDetails}
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
                  <span>{`${t.bend} ${i + 1}`}</span>
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
              DXF {t.download}
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
              SVG {t.download}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
