'use client';

/**
 * CmmComparePanel.tsx — CMM measurement vs CAD compare panel.
 *
 * User pastes CMM measurement XYZ points + CAD reference points.
 * Panel runs rigid alignment + per-point deviation + flatness
 * summary + heatmap legend.
 */

import React, { useMemo, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import { rigidAlign, computeDeviations, flatnessDeviation, type MeasuredPoint, type CadPoint } from './cmmCompare';

interface CmmComparePanelProps {
  lang: string;
  onClose?: () => void;
  /** Emit per-point deviations so caller can color the heat-map. */
  onResult?: (deviations: number[]) => void;
}

const COPY = {
  ko: {
    title: 'CMM 비교',
    pasteMeas: '측정점 (XYZ)',
    pasteCad: 'CAD 점 (X Y Z Nx Ny Nz)',
    tol: '공차 ±mm',
    run: '비교 실행',
    rms: 'RMS',
    max: '최대',
    mean: '평균',
    ootCount: '공차 초과',
    alignErr: '정렬 오차',
    flatness: '평탄도',
  },
  en: {
    title: 'CMM Compare',
    pasteMeas: 'Measured (XYZ)',
    pasteCad: 'CAD points (X Y Z Nx Ny Nz)',
    tol: 'Tolerance ±mm',
    run: 'Run Compare',
    rms: 'RMS',
    max: 'Max',
    mean: 'Mean',
    ootCount: 'Out of tolerance',
    alignErr: 'Align error',
    flatness: 'Flatness',
  },
  ja: {
    title: 'CMM 比較',
    pasteMeas: '測定点 (XYZ)',
    pasteCad: 'CAD 点 (X Y Z Nx Ny Nz)',
    tol: '公差 ±mm',
    run: '比較実行',
    rms: 'RMS',
    max: '最大',
    mean: '平均',
    ootCount: '公差超過',
    alignErr: '整列誤差',
    flatness: '平面度',
  },
  zh: {
    title: 'CMM 比较',
    pasteMeas: '测量点 (XYZ)',
    pasteCad: 'CAD 点 (X Y Z Nx Ny Nz)',
    tol: '公差 ±mm',
    run: '运行比较',
    rms: 'RMS',
    max: '最大',
    mean: '平均',
    ootCount: '超差数量',
    alignErr: '对齐误差',
    flatness: '平面度',
  },
  es: {
    title: 'Comparación CMM',
    pasteMeas: 'Puntos medidos (XYZ)',
    pasteCad: 'Puntos CAD (X Y Z Nx Ny Nz)',
    tol: 'Tolerancia ±mm',
    run: 'Ejecutar comparación',
    rms: 'RMS',
    max: 'Máx.',
    mean: 'Media',
    ootCount: 'Fuera de tolerancia',
    alignErr: 'Error de alineación',
    flatness: 'Planitud',
  },
  ar: {
    title: 'مقارنة CMM',
    pasteMeas: 'نقاط القياس (XYZ)',
    pasteCad: 'نقاط CAD (X Y Z Nx Ny Nz)',
    tol: 'التفاوت ±مم',
    run: 'تشغيل المقارنة',
    rms: 'RMS',
    max: 'الأقصى',
    mean: 'المتوسط',
    ootCount: 'خارج التفاوت',
    alignErr: 'خطأ المحاذاة',
    flatness: 'الاستواء',
  },
} as const;

function parsePoints(text: string, withNormals: boolean): Array<MeasuredPoint | CadPoint> {
  const out: Array<MeasuredPoint | CadPoint> = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts.length < 3 || !Number.isFinite(parts[0]!)) continue;
    if (withNormals && parts.length >= 6) {
      out.push({
        position: [parts[0]!, parts[1]!, parts[2]!],
        normal: [parts[3]!, parts[4]!, parts[5]!],
      } as CadPoint);
    } else {
      out.push({
        position: [parts[0]!, parts[1]!, parts[2]!],
      } as MeasuredPoint);
    }
  }
  return out;
}

export default function CmmComparePanel({ lang, onClose, onResult }: CmmComparePanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;
  const [measText, setMeasText] = useState('');
  const [cadText, setCadText] = useState('');
  const [toleranceMm, setToleranceMm] = useState(0.1);
  const [result, setResult] = useState<null | {
    rms: number; max: number; mean: number; ootCount: number;
    alignErr: number; flatness: number;
  }>(null);

  const run = () => {
    const meas = parsePoints(measText, false) as MeasuredPoint[];
    const cad = parsePoints(cadText, true) as CadPoint[];
    if (meas.length === 0 || cad.length === 0) return;

    // Rigid align first (using same indices — alignment quality depends on order).
    const align = rigidAlign(
      meas.map(m => m.position),
      cad.map(c => c.position),
    );

    const deviations = computeDeviations(meas, cad, toleranceMm);
    const flat = flatnessDeviation(meas);
    onResult?.(deviations.perPointMm);
    setResult({
      rms: deviations.rmsMm,
      max: deviations.maxMm,
      mean: deviations.meanMm,
      ootCount: deviations.outOfTolerance.length,
      alignErr: align.rmsError,
      flatness: flat,
    });
  };

  return (
    <div style={panelStyle()}>
      <div style={headerStyle()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
      </div>

      <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>{t.pasteMeas}</div>
      <textarea value={measText} onChange={e => setMeasText(e.target.value)} rows={4} style={textareaStyle()} />

      <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginTop: 8, marginBottom: 4 }}>{t.pasteCad}</div>
      <textarea value={cadText} onChange={e => setCadText(e.target.value)} rows={4} style={textareaStyle()} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{t.tol}:</span>
        <input type="number" value={toleranceMm} onChange={e => setToleranceMm(Number(e.target.value))} style={{ ...fieldStyle(), width: 80 }} />
      </div>

      <button onClick={run} style={primaryBtn()}>{t.run}</button>

      {result && (
        <div style={{ marginTop: 12, fontSize: 11, lineHeight: 1.7 }}>
          <Row label={t.rms}>{result.rms.toFixed(4)} mm</Row>
          <Row label={t.max}>{result.max.toFixed(4)} mm</Row>
          <Row label={t.mean}>{result.mean.toFixed(4)} mm</Row>
          <Row label={t.ootCount}>{result.ootCount}</Row>
          <Row label={t.alignErr}>{result.alignErr.toFixed(4)} mm</Row>
          <Row label={t.flatness}>{result.flatness.toFixed(4)} mm</Row>

          <div style={{ marginTop: 10, display: 'flex', gap: 4 }}>
            <span style={{ ...legendSwatch('#16a34a'), }} /> 양호
            <span style={{ ...legendSwatch('#f59e0b'), marginLeft: 12 }} /> 주의
            <span style={{ ...legendSwatch('#dc2626'), marginLeft: 12 }} /> 초과
          </div>
        </div>
      )}
    </div>
  );
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
    <span style={{ color: 'var(--nx-text-2)' }}>{label}</span>
    <strong>{children}</strong>
  </div>
);

// right: 340 clears the 320px right property pane (2026-06-12)
function panelStyle(): React.CSSProperties { return { position: 'fixed', top: 80, right: 340, zIndex: 700, width: 360, background: 'var(--nx-panel)', color: 'var(--nx-text)', borderRadius: 10, padding: '14px 16px', boxShadow: '0 12px 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }; }
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 16 }; }
function textareaStyle(): React.CSSProperties { return { width: '100%', background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 6, padding: '6px 8px', fontSize: 10, fontFamily: 'monospace', resize: 'vertical' }; }
function fieldStyle(): React.CSSProperties { return { background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '3px 6px', fontSize: 11 }; }
function primaryBtn(): React.CSSProperties { return { width: '100%', marginTop: 8, background: '#3b82f6', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer' }; }
function legendSwatch(c: string): React.CSSProperties { return { display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: c, marginRight: 4, fontSize: 10 }; }
