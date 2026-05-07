'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import * as THREE from 'three';
import {
  runModalAnalysis,
  MODAL_MATERIALS,
  applyModeShapeColor,
  type ModalResult,
} from './modalAnalysis';

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
};

/* ─── i18n ───────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    title: '모달 해석',
    material: '재질',
    numModes: '모드 수',
    gridRes: '격자 해상도',
    fixedFaces: '고정 면',
    run: '해석 실행',
    running: '해석 중...',
    results: '결과',
    mode: '모드',
    frequency: '주파수',
    participation: '참여 계수',
    totalMass: '총 질량',
    selectMode: '모드 선택',
    freqChart: '주파수 분포',
    noGeometry: '지오메트리가 없습니다',
    bottom: '하단',
    top: '상단',
    left: '좌측',
    right: '우측',
    front: '전면',
    back: '후면',
  },
  en: {
    title: 'Modal Analysis',
    material: 'Material',
    numModes: 'Number of Modes',
    gridRes: 'Grid Resolution',
    fixedFaces: 'Fixed Faces',
    run: 'Run Analysis',
    running: 'Running...',
    results: 'Results',
    mode: 'Mode',
    frequency: 'Frequency',
    participation: 'Participation',
    totalMass: 'Total Mass',
    selectMode: 'Select Mode',
    freqChart: 'Frequency Distribution',
    noGeometry: 'No geometry loaded',
    bottom: 'Bottom',
    top: 'Top',
    left: 'Left',
    right: 'Right',
    front: 'Front',
    back: 'Back',
  },
  ja: {
    title: 'モーダル解析',
    material: '材料',
    numModes: 'モード数',
    gridRes: 'グリッド解像度',
    fixedFaces: '固定面',
    run: '解析実行',
    running: '解析中...',
    results: '結果',
    mode: 'モード',
    frequency: '周波数',
    participation: '参加係数',
    totalMass: '総質量',
    selectMode: 'モード選択',
    freqChart: '周波数分布',
    noGeometry: 'ジオメトリなし',
    bottom: '下面',
    top: '上面',
    left: '左面',
    right: '右面',
    front: '前面',
    back: '背面',
  },
  zh: {
    title: '模态分析',
    material: '材料',
    numModes: '模态数',
    gridRes: '网格分辨率',
    fixedFaces: '固定面',
    run: '运行分析',
    running: '分析中...',
    results: '结果',
    mode: '模态',
    frequency: '频率',
    participation: '参与因子',
    totalMass: '总质量',
    selectMode: '选择模态',
    freqChart: '频率分布',
    noGeometry: '无几何体',
    bottom: '底面',
    top: '顶面',
    left: '左面',
    right: '右面',
    front: '前面',
    back: '后面',
  },
  es: {
    title: 'Análisis Modal',
    material: 'Material',
    numModes: 'Número de modos',
    gridRes: 'Resolución de malla',
    fixedFaces: 'Caras fijas',
    run: 'Ejecutar análisis',
    running: 'Ejecutando...',
    results: 'Resultados',
    mode: 'Modo',
    frequency: 'Frecuencia',
    participation: 'Participación',
    totalMass: 'Masa total',
    selectMode: 'Seleccionar modo',
    freqChart: 'Distribución de frecuencia',
    noGeometry: 'Sin geometría',
    bottom: 'Inferior',
    top: 'Superior',
    left: 'Izquierda',
    right: 'Derecha',
    front: 'Frontal',
    back: 'Trasera',
  },
  ar: {
    title: 'التحليل المشروط',
    material: 'المادة',
    numModes: 'عدد الأنماط',
    gridRes: 'دقة الشبكة',
    fixedFaces: 'الأوجه الثابتة',
    run: 'تشغيل التحليل',
    running: '...جاري التشغيل',
    results: 'النتائج',
    mode: 'النمط',
    frequency: 'التردد',
    participation: 'عامل المشاركة',
    totalMass: 'الكتلة الكلية',
    selectMode: 'اختر النمط',
    freqChart: 'توزيع التردد',
    noGeometry: 'لا يوجد هندسة',
    bottom: 'السفلي',
    top: 'العلوي',
    left: 'اليسار',
    right: 'اليمين',
    front: 'الأمامي',
    back: 'الخلفي',
  },
};

/* ─── Face list ──────────────────────────────────────────────────────────── */

const FACE_KEYS = ['bottom', 'top', 'left', 'right', 'front', 'back'] as const;

/* ─── Props ──────────────────────────────────────────────────────────────── */

interface ModalAnalysisPanelProps {
  lang: string;
  geometry: THREE.BufferGeometry | null;
  dimensions: { x: number; y: number; z: number };
  onResult: (geo: THREE.BufferGeometry) => void;
  onClose: () => void;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function ModalAnalysisPanel({
  lang,
  geometry,
  dimensions,
  onResult,
  onClose,
}: ModalAnalysisPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];

  const [materialKey, setMaterialKey] = useState('steel');
  const [numModes, setNumModes] = useState(5);
  const [gridSize, setGridSize] = useState(6);
  const [fixedFaces, setFixedFaces] = useState<string[]>(['bottom']);
  const [progress, setProgress] = useState(-1);
  const [result, setResult] = useState<ModalResult | null>(null);
  const [selectedMode, setSelectedMode] = useState(0);

  const isRunning = progress >= 0 && progress < 100;

  /* ── toggle fixed face ── */
  const toggleFace = useCallback((face: string) => {
    setFixedFaces(prev =>
      prev.includes(face) ? prev.filter(f => f !== face) : [...prev, face],
    );
  }, []);

  /* ── run analysis ── */
  const handleRun = useCallback(async () => {
    if (!geometry) return;
    setProgress(0);
    setResult(null);
    try {
      const res = await runModalAnalysis(
        {
          material: materialKey,
          numModes,
          gridSize,
          fixedFaces,
          dimensions,
        },
        pct => setProgress(pct),
      );
      setResult(res);
      setSelectedMode(0);
      setProgress(-1);

      // Apply first mode shape
      const cloned = geometry.clone();
      applyModeShapeColor(cloned, res.modeShapes[0], res.gridSize);
      onResult(cloned);
    } catch {
      setProgress(-1);
    }
  }, [geometry, materialKey, numModes, gridSize, fixedFaces, dimensions, onResult]);

  /* ── select mode ── */
  const handleModeSelect = useCallback(
    (idx: number) => {
      setSelectedMode(idx);
      if (!result || !geometry) return;
      const cloned = geometry.clone();
      applyModeShapeColor(cloned, result.modeShapes[idx], result.gridSize);
      onResult(cloned);
    },
    [result, geometry, onResult],
  );

  /* ── bar chart max ── */
  const maxFreq = useMemo(() => {
    if (!result) return 1;
    return Math.max(...result.frequencies, 1);
  }, [result]);

  /* ── face label ── */
  const faceLabel = (face: string): string => {
    return (t as Record<string, string>)[face] ?? face;
  };

  /* ─────────────────────── Render ─────────────────────── */

  return (
    <div
      style={{
        position: 'fixed',
        top: 60,
        right: 16,
        width: 320,
        maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto',
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        zIndex: 800,
        color: C.text,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        fontSize: 13,
        boxShadow: '0 8px 32px rgba(0,0,0,.45)',
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14 }}>{t.title}</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: C.textDim,
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* ── Material selector ── */}
        <label style={{ color: C.textDim, fontSize: 11, marginBottom: -4 }}>{t.material}</label>
        <select
          value={materialKey}
          onChange={e => setMaterialKey(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 8px',
            background: C.card,
            color: C.text,
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            fontSize: 13,
            outline: 'none',
          }}
        >
          {Object.entries(MODAL_MATERIALS).map(([key, mat]) => (
            <option key={key} value={key}>
              {mat.name} ({(mat.density).toLocaleString()} kg/m³)
            </option>
          ))}
        </select>

        {/* ── Number of modes ── */}
        <label style={{ color: C.textDim, fontSize: 11, marginBottom: -4 }}>
          {t.numModes}: {numModes}
        </label>
        <input
          type="range"
          min={1}
          max={10}
          value={numModes}
          onChange={e => setNumModes(Number(e.target.value))}
          style={{ width: '100%', accentColor: C.accent }}
        />

        {/* ── Grid resolution ── */}
        <label style={{ color: C.textDim, fontSize: 11, marginBottom: -4 }}>
          {t.gridRes}: {gridSize}
        </label>
        <input
          type="range"
          min={4}
          max={10}
          value={gridSize}
          onChange={e => setGridSize(Number(e.target.value))}
          style={{ width: '100%', accentColor: C.accent }}
        />

        {/* ── Fixed faces ── */}
        <label style={{ color: C.textDim, fontSize: 11, marginBottom: -4 }}>{t.fixedFaces}</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {FACE_KEYS.map(face => (
            <label
              key={face}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                fontSize: 12,
                color: fixedFaces.includes(face) ? C.accent : C.textDim,
              }}
            >
              <input
                type="checkbox"
                checked={fixedFaces.includes(face)}
                onChange={() => toggleFace(face)}
                style={{ accentColor: C.accent }}
              />
              {faceLabel(face)}
            </label>
          ))}
        </div>

        {/* ── Run button ── */}
        <button
          onClick={handleRun}
          disabled={isRunning || !geometry}
          style={{
            width: '100%',
            padding: '8px 0',
            background: geometry ? C.accent : C.border,
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontWeight: 600,
            fontSize: 13,
            cursor: geometry && !isRunning ? 'pointer' : 'not-allowed',
            opacity: isRunning ? 0.7 : 1,
          }}
        >
          {!geometry ? t.noGeometry : isRunning ? t.running : t.run}
        </button>

        {/* ── Progress bar ── */}
        {isRunning && (
          <div style={{ width: '100%', height: 4, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                background: C.accent,
                borderRadius: 2,
                transition: 'width 0.2s ease',
              }}
            />
          </div>
        )}

        {/* ── Results ── */}
        {result && (
          <>
            <div
              style={{
                borderTop: `1px solid ${C.border}`,
                paddingTop: 10,
                marginTop: 4,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>{t.results}</div>

              {/* Total mass */}
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>
                {t.totalMass}: {result.totalMass.toFixed(4)} kg
              </div>

              {/* ── Frequency table ── */}
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontSize: 11,
                  marginBottom: 10,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ textAlign: 'left', padding: '3px 4px', color: C.textDim }}>{t.mode}</th>
                    <th style={{ textAlign: 'right', padding: '3px 4px', color: C.textDim }}>{t.frequency} (Hz)</th>
                    <th style={{ textAlign: 'right', padding: '3px 4px', color: C.textDim }}>{t.participation}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.frequencies.map((freq, i) => (
                    <tr
                      key={i}
                      onClick={() => handleModeSelect(i)}
                      style={{
                        cursor: 'pointer',
                        background: i === selectedMode ? 'rgba(56,139,253,0.15)' : 'transparent',
                        borderBottom: `1px solid ${C.border}`,
                      }}
                    >
                      <td style={{ padding: '4px', fontWeight: i === selectedMode ? 700 : 400 }}>
                        {i + 1}
                      </td>
                      <td style={{ textAlign: 'right', padding: '4px', fontFamily: 'monospace' }}>
                        {freq.toFixed(1)}
                      </td>
                      <td style={{ textAlign: 'right', padding: '4px', fontFamily: 'monospace' }}>
                        {(result.participationFactors[i] * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ── Bar chart ── */}
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>{t.freqChart}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
                {result.frequencies.map((freq, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 18, textAlign: 'right', fontSize: 10, color: C.textDim }}>
                      {i + 1}
                    </span>
                    <div style={{ flex: 1, height: 10, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${(freq / maxFreq) * 100}%`,
                          height: '100%',
                          background: i === selectedMode ? C.accent : C.green,
                          borderRadius: 3,
                          transition: 'width 0.2s ease',
                        }}
                      />
                    </div>
                    <span style={{ width: 54, textAlign: 'right', fontSize: 10, fontFamily: 'monospace' }}>
                      {freq.toFixed(1)} Hz
                    </span>
                  </div>
                ))}
              </div>

              {/* ── Mode selector ── */}
              <label style={{ color: C.textDim, fontSize: 11, marginBottom: -2, display: 'block' }}>
                {t.selectMode}: {selectedMode + 1}
              </label>
              <input
                type="range"
                min={0}
                max={result.frequencies.length - 1}
                value={selectedMode}
                onChange={e => handleModeSelect(Number(e.target.value))}
                style={{ width: '100%', accentColor: C.accent }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
