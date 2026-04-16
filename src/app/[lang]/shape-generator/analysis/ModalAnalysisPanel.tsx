'use client';

import React, { useState, useCallback, useMemo } from 'react';
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

const dict: Record<string, Record<string, string>> = {
  title:        { ko: '모달 해석', en: 'Modal Analysis', ja: 'モーダル解析', cn: '模态分析', es: 'Análisis Modal', ar: 'التحليل المشروط' },
  material:     { ko: '재질', en: 'Material', ja: '材料', cn: '材料', es: 'Material', ar: 'المادة' },
  numModes:     { ko: '모드 수', en: 'Number of Modes', ja: 'モード数', cn: '模态数', es: 'Número de modos', ar: 'عدد الأنماط' },
  gridRes:      { ko: '격자 해상도', en: 'Grid Resolution', ja: 'グリッド解像度', cn: '网格分辨率', es: 'Resolución de malla', ar: 'دقة الشبكة' },
  fixedFaces:   { ko: '고정 면', en: 'Fixed Faces', ja: '固定面', cn: '固定面', es: 'Caras fijas', ar: 'الأوجه الثابتة' },
  run:          { ko: '해석 실행', en: 'Run Analysis', ja: '解析実行', cn: '运行分析', es: 'Ejecutar análisis', ar: 'تشغيل التحليل' },
  running:      { ko: '해석 중...', en: 'Running...', ja: '解析中...', cn: '分析中...', es: 'Ejecutando...', ar: '...جاري التشغيل' },
  results:      { ko: '결과', en: 'Results', ja: '結果', cn: '结果', es: 'Resultados', ar: 'النتائج' },
  mode:         { ko: '모드', en: 'Mode', ja: 'モード', cn: '模态', es: 'Modo', ar: 'النمط' },
  frequency:    { ko: '주파수', en: 'Frequency', ja: '周波数', cn: '频率', es: 'Frecuencia', ar: 'التردد' },
  participation:{ ko: '참여 계수', en: 'Participation', ja: '参加係数', cn: '参与因子', es: 'Participación', ar: 'عامل المشاركة' },
  totalMass:    { ko: '총 질량', en: 'Total Mass', ja: '総質量', cn: '总质量', es: 'Masa total', ar: 'الكتلة الكلية' },
  selectMode:   { ko: '모드 선택', en: 'Select Mode', ja: 'モード選択', cn: '选择模态', es: 'Seleccionar modo', ar: 'اختر النمط' },
  freqChart:    { ko: '주파수 분포', en: 'Frequency Distribution', ja: '周波数分布', cn: '频率分布', es: 'Distribución de frecuencia', ar: 'توزيع التردد' },
  noGeometry:   { ko: '지오메트리가 없습니다', en: 'No geometry loaded', ja: 'ジオメトリなし', cn: '无几何体', es: 'Sin geometría', ar: 'لا يوجد هندسة' },
  bottom:       { ko: '하단', en: 'Bottom', ja: '下面', cn: '底面', es: 'Inferior', ar: 'السفلي' },
  top:          { ko: '상단', en: 'Top', ja: '上面', cn: '顶面', es: 'Superior', ar: 'العلوي' },
  left:         { ko: '좌측', en: 'Left', ja: '左面', cn: '左面', es: 'Izquierda', ar: 'اليسار' },
  right:        { ko: '우측', en: 'Right', ja: '右面', cn: '右面', es: 'Derecha', ar: 'اليمين' },
  front:        { ko: '전면', en: 'Front', ja: '前面', cn: '前面', es: 'Frontal', ar: 'الأمامي' },
  back:         { ko: '후면', en: 'Back', ja: '背面', cn: '后面', es: 'Trasera', ar: 'الخلفي' },
};

function t(key: string, lang: string): string {
  return dict[key]?.[lang] ?? dict[key]?.en ?? key;
}

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
  const l = dict[lang] ? lang : 'en';

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
        <span style={{ fontWeight: 700, fontSize: 14 }}>{t('title', l)}</span>
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
        <label style={{ color: C.textDim, fontSize: 11, marginBottom: -4 }}>{t('material', l)}</label>
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
          {t('numModes', l)}: {numModes}
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
          {t('gridRes', l)}: {gridSize}
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
        <label style={{ color: C.textDim, fontSize: 11, marginBottom: -4 }}>{t('fixedFaces', l)}</label>
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
              {t(face, l)}
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
          {!geometry ? t('noGeometry', l) : isRunning ? t('running', l) : t('run', l)}
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
              <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>{t('results', l)}</div>

              {/* Total mass */}
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 8 }}>
                {t('totalMass', l)}: {result.totalMass.toFixed(4)} kg
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
                    <th style={{ textAlign: 'left', padding: '3px 4px', color: C.textDim }}>{t('mode', l)}</th>
                    <th style={{ textAlign: 'right', padding: '3px 4px', color: C.textDim }}>{t('frequency', l)} (Hz)</th>
                    <th style={{ textAlign: 'right', padding: '3px 4px', color: C.textDim }}>{t('participation', l)}</th>
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
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>{t('freqChart', l)}</div>
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
                {t('selectMode', l)}: {selectedMode + 1}
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
