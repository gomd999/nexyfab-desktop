'use client';

import React, { useState, useCallback } from 'react';
import {
  runPipeline,
  type PipelineStage,
  type PipelineConfig,
  type PipelineResult,
  type CostBreakdown,
  type ManufacturerRecommendation,
} from './manufacturingPipeline';

/* ─── i18n ──────────────────────────────────────────────────────────────── */

type LangKey = 'ko' | 'en' | 'ja' | 'cn' | 'es' | 'ar';

const T: Record<string, Record<LangKey, string>> = {
  title:        { ko: '제조 파이프라인', en: 'Manufacturing Pipeline', ja: '製造パイプライン', cn: '制造管线', es: 'Pipeline de Fabricación', ar: 'خط أنابيب التصنيع' },
  process:      { ko: '공정', en: 'Process', ja: '工程', cn: '工艺', es: 'Proceso', ar: 'عملية' },
  quantity:     { ko: '수량', en: 'Quantity', ja: '数量', cn: '数量', es: 'Cantidad', ar: 'كمية' },
  urgency:      { ko: '긴급도', en: 'Urgency', ja: '緊急度', cn: '紧急程度', es: 'Urgencia', ar: 'الإلحاح' },
  quality:      { ko: '품질 등급', en: 'Quality Level', ja: '品質レベル', cn: '质量等级', es: 'Nivel de Calidad', ar: 'مستوى الجودة' },
  standard:     { ko: '표준', en: 'Standard', ja: '標準', cn: '标准', es: 'Estándar', ar: 'قياسي' },
  rush:         { ko: '긴급', en: 'Rush', ja: '急ぎ', cn: '加急', es: 'Urgente', ar: 'عاجل' },
  prototype:    { ko: '시제품', en: 'Prototype', ja: 'プロトタイプ', cn: '原型', es: 'Prototipo', ar: 'نموذج أولي' },
  precision:    { ko: '정밀', en: 'Precision', ja: '精密', cn: '精密', es: 'Precisión', ar: 'دقة' },
  aerospace:    { ko: '항공우주', en: 'Aerospace', ja: '航空宇宙', cn: '航空航天', es: 'Aeroespacial', ar: 'فضاء جوي' },
  runPipeline:  { ko: '파이프라인 실행', en: 'Run Pipeline', ja: 'パイプライン実行', cn: '运行管线', es: 'Ejecutar Pipeline', ar: 'تشغيل خط الأنابيب' },
  stage:        { ko: '단계', en: 'Stage', ja: 'ステージ', cn: '阶段', es: 'Etapa', ar: 'مرحلة' },
  dfmCheck:     { ko: 'DFM 검사', en: 'DFM Check', ja: 'DFM検査', cn: 'DFM检查', es: 'Verificación DFM', ar: 'فحص DFM' },
  costing:      { ko: '원가 산정', en: 'Costing', ja: '原価計算', cn: '成本核算', es: 'Costeo', ar: 'التكلفة' },
  quoting:      { ko: '견적', en: 'Quoting', ja: '見積り', cn: '报价', es: 'Cotización', ar: 'التسعير' },
  matching:     { ko: '제조사 매칭', en: 'Matching', ja: 'マッチング', cn: '匹配', es: 'Emparejamiento', ar: 'المطابقة' },
  complete:     { ko: '완료', en: 'Complete', ja: '完了', cn: '完成', es: 'Completo', ar: 'مكتمل' },
  cost:         { ko: '비용', en: 'Cost', ja: 'コスト', cn: '费用', es: 'Costo', ar: 'التكلفة' },
  material:     { ko: '재료', en: 'Material', ja: '材料', cn: '材料', es: 'Material', ar: 'المادة' },
  machining:    { ko: '가공', en: 'Machining', ja: '加工', cn: '加工', es: 'Mecanizado', ar: 'التشغيل الآلي' },
  finishing:    { ko: '후처리', en: 'Finishing', ja: '仕上げ', cn: '精加工', es: 'Acabado', ar: 'التشطيب' },
  tooling:      { ko: '금형/공구', en: 'Tooling', ja: '金型', cn: '模具', es: 'Herramental', ar: 'الأدوات' },
  setup:        { ko: '셋업', en: 'Setup', ja: 'セットアップ', cn: '设置', es: 'Configuración', ar: 'الإعداد' },
  shipping:     { ko: '배송', en: 'Shipping', ja: '配送', cn: '运输', es: 'Envío', ar: 'الشحن' },
  total:        { ko: '합계', en: 'Total', ja: '合計', cn: '总计', es: 'Total', ar: 'المجموع' },
  leadTime:     { ko: '리드타임', en: 'Lead Time', ja: 'リードタイム', cn: '交货期', es: 'Plazo', ar: 'وقت التسليم' },
  days:         { ko: '일', en: 'days', ja: '日', cn: '天', es: 'días', ar: 'أيام' },
  manufacturer: { ko: '제조사', en: 'Manufacturer', ja: 'メーカー', cn: '制造商', es: 'Fabricante', ar: 'الشركة المصنعة' },
  rating:       { ko: '평점', en: 'Rating', ja: '評価', cn: '评分', es: 'Calificación', ar: 'التقييم' },
  certifications: { ko: '인증', en: 'Certifications', ja: '認証', cn: '认证', es: 'Certificaciones', ar: 'الشهادات' },
  getQuote:     { ko: '견적 요청', en: 'Get Quote', ja: '見積依頼', cn: '获取报价', es: 'Obtener Cotización', ar: 'طلب عرض سعر' },
  risk:         { ko: '위험도', en: 'Risk', ja: 'リスク', cn: '风险', es: 'Riesgo', ar: 'المخاطر' },
  low:          { ko: '낮음', en: 'Low', ja: '低', cn: '低', es: 'Bajo', ar: 'منخفض' },
  medium:       { ko: '보통', en: 'Medium', ja: '中', cn: '中', es: 'Medio', ar: 'متوسط' },
  high:         { ko: '높음', en: 'High', ja: '高', cn: '高', es: 'Alto', ar: 'مرتفع' },
  close:        { ko: '닫기', en: 'Close', ja: '閉じる', cn: '关闭', es: 'Cerrar', ar: 'إغلاق' },
};

function t(key: string, lang: string): string {
  const l = (lang as LangKey) || 'en';
  return T[key]?.[l] ?? T[key]?.en ?? key;
}

/* ─── Styles ────────────────────────────────────────────────────────────── */

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
  purple: '#a371f7',
};

const PROCESS_OPTIONS = [
  { value: 'cnc', label: 'CNC Milling' },
  { value: 'injection', label: 'Injection Molding' },
  { value: '3dprint', label: '3D Printing' },
  { value: 'sheetmetal', label: 'Sheet Metal' },
];

const STAGES: { key: PipelineStage; labelKey: string }[] = [
  { key: 'dfm', labelKey: 'dfmCheck' },
  { key: 'costing', labelKey: 'costing' },
  { key: 'quoting', labelKey: 'quoting' },
  { key: 'matching', labelKey: 'matching' },
  { key: 'complete', labelKey: 'complete' },
];

const COST_COLORS: Record<string, string> = {
  material: '#388bfd',
  machining: '#f0883e',
  finishing: '#a371f7',
  tooling: '#d29922',
  setup: '#3fb950',
  shipping: '#f85149',
};

/* ─── Component ─────────────────────────────────────────────────────────── */

interface ManufacturingPipelinePanelProps {
  lang: string;
  volumeCm3: number;
  surfaceAreaCm2: number;
  material: string;
  complexity: number;
  onGetQuote: (manufacturerId: string) => void;
  onClose: () => void;
}

export default function ManufacturingPipelinePanel({
  lang,
  volumeCm3,
  surfaceAreaCm2,
  material,
  complexity,
  onGetQuote,
  onClose,
}: ManufacturingPipelinePanelProps) {
  const [process, setProcess] = useState('cnc');
  const [quantity, setQuantity] = useState(10);
  const [urgency, setUrgency] = useState<'standard' | 'rush' | 'prototype'>('standard');
  const [qualityLevel, setQualityLevel] = useState<'standard' | 'precision' | 'aerospace'>('standard');
  const [currentStage, setCurrentStage] = useState<PipelineStage | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [running, setRunning] = useState(false);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setResult(null);
    const config: PipelineConfig = { material, process, quantity, urgency, qualityLevel };
    try {
      const r = await runPipeline(config, volumeCm3, surfaceAreaCm2, complexity, setCurrentStage);
      setResult(r);
    } finally {
      setRunning(false);
    }
  }, [material, process, quantity, urgency, qualityLevel, volumeCm3, surfaceAreaCm2, complexity]);

  /* ── Stage progress indicator ─ */
  const stageIdx = currentStage ? STAGES.findIndex(s => s.key === currentStage) : -1;

  function renderStages() {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, margin: '12px 0' }}>
        {STAGES.map((s, i) => {
          const done = stageIdx > i;
          const active = stageIdx === i;
          const color = done ? C.green : active ? C.accent : C.border;
          return (
            <React.Fragment key={s.key}>
              {i > 0 && (
                <div style={{
                  flex: 1, height: 2,
                  background: done ? C.green : C.border,
                  transition: 'background 0.3s',
                }} />
              )}
              <div style={{
                width: 28, height: 28, borderRadius: '50%',
                background: done ? C.green : active ? C.accent : 'transparent',
                border: `2px solid ${color}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 600, color: done || active ? '#fff' : C.textDim,
                transition: 'all 0.3s',
                animation: active ? 'pipelinePulse 1s ease-in-out infinite' : undefined,
                flexShrink: 0,
              }}>
                {done ? '\u2713' : i + 1}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  /* ── Stage labels ─ */
  function renderStageLabels() {
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '0 0 8px' }}>
        {STAGES.map((s) => (
          <span key={s.key} style={{ fontSize: 9, color: C.textDim, textAlign: 'center', width: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t(s.labelKey, lang)}
          </span>
        ))}
      </div>
    );
  }

  /* ── DFM gauge ─ */
  function renderDFMGauge(score: number) {
    const color = score >= 80 ? C.green : score >= 50 ? C.yellow : C.red;
    const pct = Math.max(0, Math.min(100, score));
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 12, color: C.text }}>DFM Score</span>
          <span style={{ fontSize: 14, fontWeight: 700, color }}>{score}/100</span>
        </div>
        <div style={{ height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.5s' }} />
        </div>
      </div>
    );
  }

  /* ── Cost breakdown ─ */
  function renderCostBreakdown(cb: CostBreakdown) {
    const items: { key: string; value: number }[] = [
      { key: 'material', value: cb.material },
      { key: 'machining', value: cb.machining },
      { key: 'finishing', value: cb.finishing },
      { key: 'tooling', value: cb.tooling },
      { key: 'setup', value: cb.setup },
      { key: 'shipping', value: cb.shipping },
    ];
    const total = cb.total || 1;
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.text, marginBottom: 6 }}>{t('cost', lang)}</div>
        {/* Pie chart bar */}
        <div style={{ display: 'flex', height: 14, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
          {items.map(it => {
            const w = (it.value / total) * 100;
            if (w < 0.5) return null;
            return (
              <div key={it.key} style={{ width: `${w}%`, background: COST_COLORS[it.key], minWidth: 2 }}
                title={`${t(it.key, lang)}: $${it.value.toFixed(2)}`} />
            );
          })}
        </div>
        {/* Legend */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 8px', fontSize: 11 }}>
          {items.map(it => (
            <div key={it.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: COST_COLORS[it.key], flexShrink: 0 }} />
              <span style={{ color: C.textDim }}>{t(it.key, lang)}</span>
              <span style={{ color: C.text, marginLeft: 'auto' }}>${it.value.toFixed(0)}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{t('total', lang)}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.accent }}>${cb.total.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  /* ── Risk badge ─ */
  function renderRisk(level: 'low' | 'medium' | 'high') {
    const color = level === 'low' ? C.green : level === 'medium' ? C.yellow : C.red;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color, fontWeight: 600 }}>
        {t('risk', lang)}: {t(level, lang)}
      </span>
    );
  }

  /* ── Manufacturer cards ─ */
  function renderManufacturer(m: ManufacturerRecommendation) {
    const stars = '\u2605'.repeat(Math.round(m.rating)) + '\u2606'.repeat(5 - Math.round(m.rating));
    const nameDisplay = lang === 'ko' ? m.nameKo : m.name;
    return (
      <div key={m.id} style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
        padding: '10px 12px', marginBottom: 8,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{nameDisplay}</span>
          <span style={{ fontSize: 11, color: C.yellow }}>{stars}</span>
        </div>
        <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>{m.location}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
          <span style={{ color: C.text }}>{t('leadTime', lang)}: <b>{m.leadTimeDays}</b> {t('days', lang)}</span>
          <span style={{ color: C.accent, fontWeight: 700 }}>${m.costEstimate.toFixed(2)}</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
          {m.certifications.map(c => (
            <span key={c} style={{
              fontSize: 9, padding: '2px 6px', borderRadius: 4,
              background: 'rgba(56,139,253,0.15)', color: C.accent, border: `1px solid rgba(56,139,253,0.3)`,
            }}>{c}</span>
          ))}
        </div>
        <button
          onClick={() => onGetQuote(m.id)}
          style={{
            width: '100%', padding: '6px 0', borderRadius: 6, border: `1px solid ${C.accent}`,
            background: 'rgba(56,139,253,0.1)', color: C.accent, fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {t('getQuote', lang)}
        </button>
      </div>
    );
  }

  /* ── Radio helper ─ */
  function Radio({ name, value, current, onChange, label }: {
    name: string; value: string; current: string; onChange: (v: string) => void; label: string;
  }) {
    const active = value === current;
    return (
      <label style={{
        display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer',
        padding: '3px 8px', borderRadius: 4,
        background: active ? 'rgba(56,139,253,0.15)' : 'transparent',
        border: `1px solid ${active ? C.accent : C.border}`,
        color: active ? C.accent : C.textDim,
      }}>
        <input type="radio" name={name} value={value} checked={active}
          onChange={() => onChange(value)}
          style={{ display: 'none' }} />
        {label}
      </label>
    );
  }

  /* ── Main render ─ */
  return (
    <div style={{
      position: 'fixed', top: 60, right: 16, width: 380,
      maxHeight: 'calc(100vh - 80px)', overflowY: 'auto',
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      zIndex: 800, color: C.text, fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Pulse animation */}
      <style>{`
        @keyframes pipelinePulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(56,139,253,0.5); }
          50% { box-shadow: 0 0 0 6px rgba(56,139,253,0); }
        }
      `}</style>

      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{t('title', lang)}</span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: C.textDim, fontSize: 18,
          cursor: 'pointer', lineHeight: 1,
        }}>{'\u2715'}</button>
      </div>

      <div style={{ padding: '12px 16px' }}>
        {/* ── Configuration ─ */}
        {/* Process */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 }}>
            {t('process', lang)}
          </label>
          <select value={process} onChange={e => setProcess(e.target.value)} style={{
            width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12,
            background: C.card, color: C.text, border: `1px solid ${C.border}`,
            outline: 'none',
          }}>
            {PROCESS_OPTIONS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Quantity */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 }}>
            {t('quantity', lang)}
          </label>
          <input type="number" min={1} max={100000} value={quantity}
            onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            style={{
              width: '100%', padding: '6px 8px', borderRadius: 6, fontSize: 12,
              background: C.card, color: C.text, border: `1px solid ${C.border}`,
              outline: 'none', boxSizing: 'border-box',
            }} />
        </div>

        {/* Urgency */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 }}>
            {t('urgency', lang)}
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Radio name="urgency" value="standard" current={urgency} onChange={v => setUrgency(v as typeof urgency)} label={t('standard', lang)} />
            <Radio name="urgency" value="rush" current={urgency} onChange={v => setUrgency(v as typeof urgency)} label={t('rush', lang)} />
            <Radio name="urgency" value="prototype" current={urgency} onChange={v => setUrgency(v as typeof urgency)} label={t('prototype', lang)} />
          </div>
        </div>

        {/* Quality */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: C.textDim, display: 'block', marginBottom: 4 }}>
            {t('quality', lang)}
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <Radio name="quality" value="standard" current={qualityLevel} onChange={v => setQualityLevel(v as typeof qualityLevel)} label={t('standard', lang)} />
            <Radio name="quality" value="precision" current={qualityLevel} onChange={v => setQualityLevel(v as typeof qualityLevel)} label={t('precision', lang)} />
            <Radio name="quality" value="aerospace" current={qualityLevel} onChange={v => setQualityLevel(v as typeof qualityLevel)} label={t('aerospace', lang)} />
          </div>
        </div>

        {/* Run button */}
        <button onClick={handleRun} disabled={running} style={{
          width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
          background: running ? C.border : `linear-gradient(135deg, ${C.accent}, ${C.purple})`,
          color: '#fff', fontSize: 14, fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer',
          marginBottom: 14, transition: 'opacity 0.2s',
          opacity: running ? 0.6 : 1,
        }}>
          {running ? '...' : t('runPipeline', lang)}
        </button>

        {/* Pipeline stages */}
        {(running || result) && (
          <>
            {renderStages()}
            {renderStageLabels()}
          </>
        )}

        {/* ── Results ─ */}
        {result && (
          <>
            {/* DFM Score gauge */}
            {renderDFMGauge(result.dfmScore)}

            {/* DFM Issues */}
            {result.dfmIssues.length > 0 && (
              <div style={{ marginBottom: 10, padding: '8px 10px', background: C.card, borderRadius: 6, border: `1px solid ${C.border}` }}>
                {result.dfmIssues.map((issue, i) => (
                  <div key={i} style={{ fontSize: 11, color: C.yellow, marginBottom: i < result.dfmIssues.length - 1 ? 4 : 0 }}>
                    {'\u26A0'} {issue}
                  </div>
                ))}
              </div>
            )}

            {/* Cost breakdown */}
            {renderCostBreakdown(result.costBreakdown)}

            {/* Lead time + risk */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: C.text }}>
                {t('leadTime', lang)}: <b style={{ color: C.accent }}>{result.leadTimeDays}</b> {t('days', lang)}
              </span>
              {renderRisk(result.riskLevel)}
            </div>

            {/* Suggestions */}
            {result.suggestions.length > 0 && (
              <div style={{ marginBottom: 12, padding: '8px 10px', background: 'rgba(56,139,253,0.08)', borderRadius: 6, border: `1px solid rgba(56,139,253,0.2)` }}>
                {result.suggestions.map((s, i) => (
                  <div key={i} style={{ fontSize: 11, color: C.accent, marginBottom: i < result.suggestions.length - 1 ? 3 : 0 }}>
                    {'\u2192'} {s}
                  </div>
                ))}
              </div>
            )}

            {/* Manufacturers */}
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
              {t('manufacturer', lang)}
            </div>
            {result.recommendations.map(m => renderManufacturer(m))}
          </>
        )}

        {/* Close button */}
        <button onClick={onClose} style={{
          width: '100%', padding: '8px 0', borderRadius: 6,
          background: 'transparent', border: `1px solid ${C.border}`,
          color: C.textDim, fontSize: 12, cursor: 'pointer', marginTop: 8,
        }}>
          {t('close', lang)}
        </button>
      </div>
    </div>
  );
}
