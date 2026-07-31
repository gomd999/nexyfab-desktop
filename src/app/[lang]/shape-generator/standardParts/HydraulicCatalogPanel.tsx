'use client';

/**
 * HydraulicCatalogPanel.tsx — Browse + filter hydraulic fittings.
 *
 * Filters by standard, shape, bore range. Also computes a
 * flow-rate-based recommendation for the selected line type.
 */

import React, { useMemo, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';
import {
  HYDRAULIC_CATALOG, findHydraulicFittings, recommendFittingForFlow,
  type HydraulicStandard, type FittingShape, type HydraulicFitting,
} from './hydraulicFittings';

interface HydraulicCatalogPanelProps {
  lang: string;
  onClose?: () => void;
  onPick?: (fitting: HydraulicFitting) => void;
}

const COPY = {
  ko: {
    title: '유압 카탈로그',
    filterStandard: '규격',
    filterShape: '형태',
    flowQuery: '유량 기반 추천',
    flow: '유량 (L/min)',
    line: '라인',
    pressure: '압력', return: '리턴', suction: '석션',
    recommend: '추천',
    pickBtn: '선택',
    boreMm: 'Bore (mm)',
    thread: '나사',
    pressureBar: '압력 bar',
    seal: '실링',
    none: '—',
  },
  en: {
    title: 'Hydraulic Catalog',
    filterStandard: 'Standard',
    filterShape: 'Shape',
    flowQuery: 'Flow-based',
    flow: 'Flow (L/min)',
    line: 'Line',
    pressure: 'Pressure', return: 'Return', suction: 'Suction',
    recommend: 'Recommend',
    pickBtn: 'Pick',
    boreMm: 'Bore',
    thread: 'Thread',
    pressureBar: 'Pressure (bar)',
    seal: 'Seal',
    none: '—',
  },
  ja: {
    title: '油圧カタログ',
    filterStandard: '規格',
    filterShape: '形状',
    flowQuery: '流量ベースの推奨',
    flow: '流量 (L/min)',
    line: 'ライン',
    pressure: '圧力', return: 'リターン', suction: 'サクション',
    recommend: '推奨',
    pickBtn: '選択',
    boreMm: 'ボア (mm)',
    thread: 'ねじ',
    pressureBar: '圧力 bar',
    seal: 'シール',
    none: '—',
  },
  zh: {
    title: '液压目录',
    filterStandard: '标准',
    filterShape: '形式',
    flowQuery: '按流量推荐',
    flow: '流量 (L/min)',
    line: '管路',
    pressure: '压力', return: '回油', suction: '吸油',
    recommend: '推荐',
    pickBtn: '选择',
    boreMm: '内径 (mm)',
    thread: '螺纹',
    pressureBar: '压力 bar',
    seal: '密封',
    none: '—',
  },
  es: {
    title: 'Catálogo hidráulico',
    filterStandard: 'Norma',
    filterShape: 'Forma',
    flowQuery: 'Recomendación por caudal',
    flow: 'Caudal (L/min)',
    line: 'Línea',
    pressure: 'Presión', return: 'Retorno', suction: 'Aspiración',
    recommend: 'Recomendar',
    pickBtn: 'Seleccionar',
    boreMm: 'Diámetro interior (mm)',
    thread: 'Rosca',
    pressureBar: 'Presión bar',
    seal: 'Junta',
    none: '—',
  },
  ar: {
    title: 'كتالوج الهيدروليك',
    filterStandard: 'المعيار',
    filterShape: 'الشكل',
    flowQuery: 'التوصية حسب التدفّق',
    flow: 'التدفّق (لتر/دقيقة)',
    line: 'الخط',
    pressure: 'الضغط', return: 'العودة', suction: 'السحب',
    recommend: 'توصية',
    pickBtn: 'اختيار',
    boreMm: 'قطر التجويف (مم)',
    thread: 'السن',
    pressureBar: 'الضغط بار',
    seal: 'الإحكام',
    none: '—',
  },
} as const;

const STANDARDS: HydraulicStandard[] = ['ISO 6149', 'SAE J1926', 'BSPP', 'JIS B 2351'];
const SHAPES: FittingShape[] = ['straight', 'elbow-90', 'elbow-45', 'tee', 'cross', 'reducer', 'cap', 'plug', 'flange'];

export default function HydraulicCatalogPanel({ lang, onClose, onPick }: HydraulicCatalogPanelProps) {
  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = COPY[toIsoLang(lang)] ?? COPY.en;
  const [standard, setStandard] = useState<HydraulicStandard | ''>('');
  const [shape, setShape] = useState<FittingShape | ''>('');
  const [flowLpm, setFlowLpm] = useState<number | ''>('');
  const [lineKind, setLineKind] = useState<'pressure' | 'return' | 'suction'>('pressure');

  const filtered = useMemo(() => {
    return findHydraulicFittings({
      standard: standard || undefined,
      shape: shape || undefined,
    });
  }, [standard, shape]);

  const flowRecommendation = useMemo(() => {
    if (typeof flowLpm !== 'number' || flowLpm <= 0) return null;
    return recommendFittingForFlow(flowLpm, lineKind);
  }, [flowLpm, lineKind]);

  return (
    <div style={panelStyle()}>
      <div style={headerStyle()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>{t.title}</h3>
        {onClose && <button onClick={onClose} style={xBtnStyle()}>✕</button>}
      </div>

      <div style={{ marginBottom: 10 }}>
        <Row label={t.filterStandard}>
          <select value={standard} onChange={e => setStandard(e.target.value as HydraulicStandard | '')} style={fieldStyle()}>
            <option value="">{t.none}</option>
            {STANDARDS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Row>
        <Row label={t.filterShape}>
          <select value={shape} onChange={e => setShape(e.target.value as FittingShape | '')} style={fieldStyle()}>
            <option value="">{t.none}</option>
            {SHAPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Row>
      </div>

      <div style={{ marginBottom: 10, padding: 8, background: 'var(--nx-panel-2)', borderRadius: 6 }}>
        <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 4 }}>{t.flowQuery}</div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="number" value={flowLpm}
            onChange={e => setFlowLpm(e.target.value ? Number(e.target.value) : '')}
            placeholder={t.flow}
            style={{ ...fieldStyle(), flex: 1 }} />
          <select value={lineKind} onChange={e => setLineKind(e.target.value as 'pressure' | 'return' | 'suction')} style={fieldStyle()}>
            <option value="pressure">{t.pressure}</option>
            <option value="return">{t.return}</option>
            <option value="suction">{t.suction}</option>
          </select>
        </div>
        {flowRecommendation && (
          <div style={{ marginTop: 6, fontSize: 11 }}>
            <strong>{t.recommend}:</strong> {flowRecommendation.standard} {flowRecommendation.threadSize} (bore {flowRecommendation.boreMm} mm)
          </div>
        )}
      </div>

      <div style={{ maxHeight: '40vh', overflowY: 'auto', fontSize: 11 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--nx-text-2)', borderBottom: '1px solid var(--nx-border)' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 500 }}>{t.thread}</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 500 }}>{t.boreMm}</th>
              <th style={{ textAlign: 'right', padding: '4px 6px', fontWeight: 500 }}>{t.pressureBar}</th>
              {onPick && <th />}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 30).map((f, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--nx-panel-2)' }}>
                <td style={{ padding: '4px 6px' }}>{f.threadSize}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{f.boreMm}</td>
                <td style={{ padding: '4px 6px', textAlign: 'right' }}>{f.workingPressureBar}</td>
                {onPick && (
                  <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                    <button onClick={() => onPick(f)} style={smallBtn()}>{t.pickBtn}</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 10, color: 'var(--nx-text-2)', marginTop: 6, textAlign: 'right' }}>
        Total: {HYDRAULIC_CATALOG.length}
      </div>
    </div>
  );
}

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
    <span style={{ width: 70, fontSize: 11, color: 'var(--nx-text-2)' }}>{label}</span>
    <span style={{ flex: 1 }}>{children}</span>
  </div>
);

// right: 340 clears the 320px right property pane (2026-06-12)
function panelStyle(): React.CSSProperties { return { position: 'fixed', top: 80, right: 340, zIndex: 700, width: 380, background: 'var(--nx-panel)', color: 'var(--nx-text)', borderRadius: 10, padding: '14px 16px', boxShadow: '0 12px 24px rgba(0,0,0,0.35)', fontFamily: 'system-ui, sans-serif' }; }
function headerStyle(): React.CSSProperties { return { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }; }
function xBtnStyle(): React.CSSProperties { return { background: 'transparent', border: 'none', color: 'var(--nx-text-2)', cursor: 'pointer', fontSize: 16 }; }
function fieldStyle(): React.CSSProperties { return { background: 'var(--nx-panel-2)', color: 'var(--nx-text)', border: '1px solid var(--nx-border)', borderRadius: 4, padding: '3px 6px', fontSize: 11 }; }
function smallBtn(): React.CSSProperties { return { background: '#3b82f6', color: 'white', border: 'none', padding: '2px 8px', borderRadius: 4, fontSize: 10, cursor: 'pointer' }; }
