'use client';

import React, { useState, useCallback, useMemo } from 'react';
import * as THREE from 'three';
import {
  type CurvatureMode,
  type CurvatureData,
  type SurfaceQualityStats,
  computeVertexCurvature,
  applyCurvatureColormap,
  applyZebraStripes,
  applyDraftAnalysis,
  getSurfaceQualityStats,
} from './surfaceQuality';

/* ─── Styles ─────────────────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  accent: '#388bfd',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
  orange: '#f0883e',
};

/* ─── i18n ───────────────────────────────────────────────────────────────── */

const T: Record<string, Record<string, string>> = {
  ko: {
    title: '곡률 분석',
    gaussian: '가우시안 곡률',
    mean: '평균 곡률',
    maxPrincipal: '최대 주곡률',
    minPrincipal: '최소 주곡률',
    zebra: '제브라 스트라이프',
    draft: '드래프트 분석',
    analyze: '분석',
    results: '결과',
    minCurv: '최소 곡률',
    maxCurv: '최대 곡률',
    flatPct: '평면 비율',
    sharpEdges: '날카로운 에지',
    stripes: '줄무늬 수',
    pullDir: '인발 방향',
    minAngle: '최소 각도',
    close: '닫기',
  },
  en: {
    title: 'Curvature Analysis',
    gaussian: 'Gaussian',
    mean: 'Mean',
    maxPrincipal: 'Max Principal',
    minPrincipal: 'Min Principal',
    zebra: 'Zebra Stripes',
    draft: 'Draft Analysis',
    analyze: 'Analyze',
    results: 'Results',
    minCurv: 'Min Curvature',
    maxCurv: 'Max Curvature',
    flatPct: 'Flat %',
    sharpEdges: 'Sharp Edges',
    stripes: 'Stripe Count',
    pullDir: 'Pull Direction',
    minAngle: 'Min Angle',
    close: 'Close',
  },
  ja: {
    title: '曲率解析',
    gaussian: 'ガウス曲率',
    mean: '平均曲率',
    maxPrincipal: '最大主曲率',
    minPrincipal: '最小主曲率',
    zebra: 'ゼブラストライプ',
    draft: 'ドラフト解析',
    analyze: '解析',
    results: '結果',
    minCurv: '最小曲率',
    maxCurv: '最大曲率',
    flatPct: '平面率',
    sharpEdges: 'シャープエッジ',
    stripes: 'ストライプ数',
    pullDir: '引抜方向',
    minAngle: '最小角度',
    close: '閉じる',
  },
  cn: {
    title: '曲率分析',
    gaussian: '高斯曲率',
    mean: '平均曲率',
    maxPrincipal: '最大主曲率',
    minPrincipal: '最小主曲率',
    zebra: '斑马条纹',
    draft: '拔模分析',
    analyze: '分析',
    results: '结果',
    minCurv: '最小曲率',
    maxCurv: '最大曲率',
    flatPct: '平面比例',
    sharpEdges: '尖锐边',
    stripes: '条纹数',
    pullDir: '拔模方向',
    minAngle: '最小角度',
    close: '关闭',
  },
  es: {
    title: 'Analisis de Curvatura',
    gaussian: 'Gaussiana',
    mean: 'Media',
    maxPrincipal: 'Principal Max',
    minPrincipal: 'Principal Min',
    zebra: 'Rayas Zebra',
    draft: 'Analisis de Desmoldeo',
    analyze: 'Analizar',
    results: 'Resultados',
    minCurv: 'Curvatura Min',
    maxCurv: 'Curvatura Max',
    flatPct: '% Plano',
    sharpEdges: 'Aristas Vivas',
    stripes: 'Num. Rayas',
    pullDir: 'Direccion de Tiro',
    minAngle: 'Angulo Min',
    close: 'Cerrar',
  },
  ar: {
    title: 'تحليل الانحناء',
    gaussian: 'انحناء غاوسي',
    mean: 'متوسط الانحناء',
    maxPrincipal: 'الانحناء الرئيسي الأقصى',
    minPrincipal: 'الانحناء الرئيسي الأدنى',
    zebra: 'خطوط حمار الوحش',
    draft: 'تحليل السحب',
    analyze: 'تحليل',
    results: 'النتائج',
    minCurv: 'أدنى انحناء',
    maxCurv: 'أقصى انحناء',
    flatPct: 'نسبة مسطحة',
    sharpEdges: 'حواف حادة',
    stripes: 'عدد الخطوط',
    pullDir: 'اتجاه السحب',
    minAngle: 'الزاوية الدنيا',
    close: 'إغلاق',
  },
};

function t(lang: string, key: string): string {
  return T[lang]?.[key] ?? T.en[key] ?? key;
}

/* ─── Mode Icons ─────────────────────────────────────────────────────────── */

const MODE_ICONS: Record<CurvatureMode, string> = {
  gaussian: '\u2248',       // ≈
  mean: '\u03BC',           // μ
  max_principal: '\u2191',  // ↑
  min_principal: '\u2193',  // ↓
  zebra: '\u2261',          // ≡
  draft: '\u2220',          // ∠
};

/* ─── Component ──────────────────────────────────────────────────────────── */

interface SurfaceQualityPanelProps {
  lang: string;
  geometry: THREE.BufferGeometry | null;
  onResult: (geo: THREE.BufferGeometry) => void;
  onClose: () => void;
}

export default function SurfaceQualityPanel({
  lang,
  geometry,
  onResult,
  onClose,
}: SurfaceQualityPanelProps) {
  const [mode, setMode] = useState<CurvatureMode>('gaussian');
  const [stripeCount, setStripeCount] = useState(8);
  const [pullDir, setPullDir] = useState<[number, number, number]>([0, 1, 0]);
  const [minAngle, setMinAngle] = useState(3);
  const [stats, setStats] = useState<SurfaceQualityStats | null>(null);
  const [curvData, setCurvData] = useState<CurvatureData | null>(null);

  const modes: CurvatureMode[] = [
    'gaussian', 'mean', 'max_principal', 'min_principal', 'zebra', 'draft',
  ];

  const modeLabel = useCallback(
    (m: CurvatureMode) => {
      const keyMap: Record<CurvatureMode, string> = {
        gaussian: 'gaussian',
        mean: 'mean',
        max_principal: 'maxPrincipal',
        min_principal: 'minPrincipal',
        zebra: 'zebra',
        draft: 'draft',
      };
      return t(lang, keyMap[m]);
    },
    [lang],
  );

  const qualityScore = useMemo(() => {
    if (!stats) return null;
    // Simple quality heuristic: high flat %, low sharp edges = good
    let score = 100;
    score -= stats.sharpEdgeCount * 2;
    score -= Math.abs(stats.avgGaussian) * 10;
    score += stats.flatFacePercent * 0.3;
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [stats]);

  const handleAnalyze = useCallback(() => {
    if (!geometry) return;
    const geo = geometry.clone();

    if (mode === 'zebra') {
      applyZebraStripes(geo, stripeCount);
      onResult(geo);
      // Compute stats anyway
      const cd = computeVertexCurvature(geometry);
      setCurvData(cd);
      setStats(getSurfaceQualityStats(cd.gaussian, cd.mean));
      return;
    }

    if (mode === 'draft') {
      const dir = new THREE.Vector3(pullDir[0], pullDir[1], pullDir[2]);
      applyDraftAnalysis(geo, dir, minAngle);
      onResult(geo);
      const cd = computeVertexCurvature(geometry);
      setCurvData(cd);
      setStats(getSurfaceQualityStats(cd.gaussian, cd.mean));
      return;
    }

    // Curvature modes
    const cd = computeVertexCurvature(geo);
    setCurvData(cd);

    const valuesMap: Record<string, Float32Array> = {
      gaussian: cd.gaussian,
      mean: cd.mean,
      max_principal: cd.maxPrincipal,
      min_principal: cd.minPrincipal,
    };

    applyCurvatureColormap(geo, valuesMap[mode], mode);
    setStats(getSurfaceQualityStats(cd.gaussian, cd.mean));
    onResult(geo);
  }, [geometry, mode, stripeCount, pullDir, minAngle, onResult]);

  const fmt = (v: number) => {
    if (Math.abs(v) < 0.001) return v.toExponential(2);
    return v.toFixed(4);
  };

  /* ─── Render ─────────────────────────────────────────────────────────── */

  return (
    <div
      style={{
        position: 'fixed',
        top: 60,
        right: 16,
        width: 300,
        zIndex: 800,
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        color: C.text,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto',
        boxShadow: '0 8px 24px rgba(0,0,0,.4)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>{t(lang, 'title')}</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: C.textDim,
            cursor: 'pointer',
            fontSize: 16,
            padding: '2px 6px',
          }}
          title={t(lang, 'close')}
        >
          &times;
        </button>
      </div>

      <div style={{ padding: '10px 14px' }}>
        {/* Mode Selector */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
            marginBottom: 12,
          }}
        >
          {modes.map((m) => (
            <label
              key={m}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                borderRadius: 4,
                background: mode === m ? C.accent + '22' : C.card,
                border: `1px solid ${mode === m ? C.accent : C.border}`,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              <input
                type="radio"
                name="curvMode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                style={{ display: 'none' }}
              />
              <span style={{ fontSize: 15, width: 18, textAlign: 'center' }}>
                {MODE_ICONS[m]}
              </span>
              <span>{modeLabel(m)}</span>
            </label>
          ))}
        </div>

        {/* Zebra controls */}
        {mode === 'zebra' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ color: C.textDim, fontSize: 11 }}>
              {t(lang, 'stripes')}: {stripeCount}
            </label>
            <input
              type="range"
              min={2}
              max={32}
              value={stripeCount}
              onChange={(e) => setStripeCount(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
          </div>
        )}

        {/* Draft controls */}
        {mode === 'draft' && (
          <div style={{ marginBottom: 12 }}>
            <label style={{ color: C.textDim, fontSize: 11, display: 'block', marginBottom: 4 }}>
              {t(lang, 'pullDir')}
            </label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {(['X', 'Y', 'Z'] as const).map((axis, idx) => (
                <div key={axis} style={{ flex: 1 }}>
                  <label style={{ color: C.textDim, fontSize: 10 }}>{axis}</label>
                  <input
                    type="number"
                    step={0.1}
                    value={pullDir[idx]}
                    onChange={(e) => {
                      const next: [number, number, number] = [...pullDir];
                      next[idx] = Number(e.target.value);
                      setPullDir(next);
                    }}
                    style={{
                      width: '100%',
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 4,
                      color: C.text,
                      padding: '3px 6px',
                      fontSize: 12,
                    }}
                  />
                </div>
              ))}
            </div>
            <label style={{ color: C.textDim, fontSize: 11 }}>
              {t(lang, 'minAngle')}: {minAngle}&deg;
            </label>
            <input
              type="range"
              min={0}
              max={30}
              step={0.5}
              value={minAngle}
              onChange={(e) => setMinAngle(Number(e.target.value))}
              style={{ width: '100%', accentColor: C.accent }}
            />
          </div>
        )}

        {/* Analyze button */}
        <button
          onClick={handleAnalyze}
          disabled={!geometry}
          style={{
            width: '100%',
            padding: '8px 0',
            background: geometry ? C.accent : C.card,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
            cursor: geometry ? 'pointer' : 'not-allowed',
            opacity: geometry ? 1 : 0.5,
            marginBottom: 12,
          }}
        >
          {t(lang, 'analyze')}
        </button>

        {/* Results */}
        {stats && (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>{t(lang, 'results')}</span>
              {qualityScore !== null && (
                <span
                  style={{
                    padding: '2px 10px',
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 700,
                    background:
                      qualityScore >= 80
                        ? C.green + '33'
                        : qualityScore >= 50
                          ? C.yellow + '33'
                          : C.red + '33',
                    color:
                      qualityScore >= 80
                        ? C.green
                        : qualityScore >= 50
                          ? C.yellow
                          : C.red,
                  }}
                >
                  {qualityScore}/100
                </span>
              )}
            </div>

            {/* Stats cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 6,
                marginBottom: 10,
              }}
            >
              {[
                { label: t(lang, 'minCurv') + ' (G)', value: fmt(stats.minGaussian) },
                { label: t(lang, 'maxCurv') + ' (G)', value: fmt(stats.maxGaussian) },
                { label: t(lang, 'minCurv') + ' (M)', value: fmt(stats.minMean) },
                { label: t(lang, 'maxCurv') + ' (M)', value: fmt(stats.maxMean) },
                { label: t(lang, 'flatPct'), value: stats.flatFacePercent.toFixed(1) + '%' },
                { label: t(lang, 'sharpEdges'), value: String(stats.sharpEdgeCount) },
              ].map((s, i) => (
                <div
                  key={i}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 6,
                    padding: '6px 8px',
                  }}
                >
                  <div style={{ color: C.textDim, fontSize: 10, marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Colorbar legend */}
            {mode !== 'zebra' && mode !== 'draft' && (
              <div style={{ marginBottom: 8 }}>
                <div
                  style={{
                    height: 12,
                    borderRadius: 4,
                    background: 'linear-gradient(to right, #0044ff, #00cc44, #ff2200)',
                  }}
                />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    color: C.textDim,
                    marginTop: 2,
                  }}
                >
                  <span>{t(lang, 'minCurv')}</span>
                  <span>{t(lang, 'maxCurv')}</span>
                </div>
              </div>
            )}

            {/* Draft legend */}
            {mode === 'draft' && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  fontSize: 11,
                  marginBottom: 8,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: C.green,
                      display: 'inline-block',
                    }}
                  />
                  OK
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: C.yellow,
                      display: 'inline-block',
                    }}
                  />
                  Marginal
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: C.red,
                      display: 'inline-block',
                    }}
                  />
                  Undercut
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
