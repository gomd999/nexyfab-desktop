'use client';

import React, { useState, useCallback } from 'react';
import type { DimensionAdvice, UseCase, LoadContext, MaterialAdvice } from './aiDimensionAdvisor';
import { useFreemium } from '@/hooks/useFreemium';
import UpgradeModal from '@/components/nexyfab/UpgradeModal';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DimensionAdvisorPanelProps {
  shape: string;
  params: Record<string, number>;
  material: string;
  lang: string;
  onApplyDimension: (param: string, value: number) => void;
  onClose: () => void;
}

// ── i18n dict ─────────────────────────────────────────────────────────────────

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict = {
  ko: {
    title: 'AI 치수·재료 추천',
    subtitle: '환경·용도 기반 치수 + 재질 최적 추천',
    getSuggestions: 'AI 제안 받기',
    applyAll: '모두 적용',
    apply: '적용',
    applied: '적용됨',
    useCase: '사용 목적',
    current: '현재',
    suggested: '제안',
    currentShape: '현재 형상',
    environment: '사용 환경',
    temperature: '온도 조건',
    environmentLabel: '환경',
    priority: '설계 우선순위',
    analyzing: '분석 중...',
    leftSuffix: '회 남음',
    errorAnalysis: '분석 중 오류가 발생했습니다.',
    recommendedMaterial: '추천 재질',
    currentLower: '현재',
    alternatives: '대안',
    suggestion: '제안',
    suggestions: '제안',
    emptyState: '위에서 사용 목적을 선택하고 "AI 제안 받기" 버튼을 클릭하세요.',
    // Use cases
    uc_general: '일반',
    uc_lightweight: '경량화',
    uc_high_strength: '고강도',
    uc_aesthetic: '미관 중심',
    uc_cost_optimized: '비용 최적화',
    // Temperature
    temp_normal: '상온 (<80°C)',
    temp_high: '고온 (80-500°C)',
    temp_cryogenic: '극저온 (<0°C)',
    // Environment
    env_indoor: '실내',
    env_outdoor: '실외',
    env_corrosive: '부식 환경',
    env_marine: '해양·수중',
    // Priority
    prio_cost: '비용 우선',
    prio_weight: '경량 우선',
    prio_strength: '강도 우선',
  },
  en: {
    title: 'AI Dimension & Material Advisor',
    subtitle: 'Environment-aware dimension & material optimization',
    getSuggestions: 'Get AI Suggestions',
    applyAll: 'Apply All',
    apply: 'Apply',
    applied: 'Applied',
    useCase: 'Use Case',
    current: 'Current',
    suggested: 'Suggested',
    currentShape: 'Current Shape',
    environment: 'Environment',
    temperature: 'Temperature',
    environmentLabel: 'Environment',
    priority: 'Design Priority',
    analyzing: 'Analyzing...',
    leftSuffix: ' left',
    errorAnalysis: 'An error occurred during analysis.',
    recommendedMaterial: 'Recommended Material',
    currentLower: 'current',
    alternatives: 'Alternatives',
    suggestion: 'suggestion',
    suggestions: 'suggestions',
    emptyState: 'Select a use case above and click "Get AI Suggestions".',
    uc_general: 'General',
    uc_lightweight: 'Lightweight',
    uc_high_strength: 'High Strength',
    uc_aesthetic: 'Aesthetic',
    uc_cost_optimized: 'Cost Optimized',
    temp_normal: 'Normal (<80°C)',
    temp_high: 'High (80-500°C)',
    temp_cryogenic: 'Cryogenic (<0°C)',
    env_indoor: 'Indoor',
    env_outdoor: 'Outdoor',
    env_corrosive: 'Corrosive',
    env_marine: 'Marine',
    prio_cost: 'Cost',
    prio_weight: 'Weight',
    prio_strength: 'Strength',
  },
  ja: {
    title: 'AI 寸法・材料アドバイザー',
    subtitle: '環境・用途に基づく寸法と材質の最適化',
    getSuggestions: 'AI提案を取得',
    applyAll: 'すべて適用',
    apply: '適用',
    applied: '適用済み',
    useCase: '用途',
    current: '現在',
    suggested: '提案',
    currentShape: '現在の形状',
    environment: '使用環境',
    temperature: '温度条件',
    environmentLabel: '環境',
    priority: '設計優先度',
    analyzing: '分析中...',
    leftSuffix: '回残り',
    errorAnalysis: '分析中にエラーが発生しました。',
    recommendedMaterial: '推奨材質',
    currentLower: '現在',
    alternatives: '代替',
    suggestion: '件',
    suggestions: '件',
    emptyState: '上で用途を選択し、「AI提案を取得」ボタンをクリックしてください。',
    uc_general: '汎用',
    uc_lightweight: '軽量化',
    uc_high_strength: '高強度',
    uc_aesthetic: '美観重視',
    uc_cost_optimized: 'コスト最適',
    temp_normal: '常温 (<80°C)',
    temp_high: '高温 (80-500°C)',
    temp_cryogenic: '極低温 (<0°C)',
    env_indoor: '屋内',
    env_outdoor: '屋外',
    env_corrosive: '腐食環境',
    env_marine: '海洋・水中',
    prio_cost: 'コスト優先',
    prio_weight: '軽量優先',
    prio_strength: '強度優先',
  },
  zh: {
    title: 'AI 尺寸与材料顾问',
    subtitle: '基于环境和用途的尺寸与材料优化',
    getSuggestions: '获取AI建议',
    applyAll: '全部应用',
    apply: '应用',
    applied: '已应用',
    useCase: '用途',
    current: '当前',
    suggested: '建议',
    currentShape: '当前形状',
    environment: '使用环境',
    temperature: '温度条件',
    environmentLabel: '环境',
    priority: '设计优先级',
    analyzing: '分析中...',
    leftSuffix: '次剩余',
    errorAnalysis: '分析过程中发生错误。',
    recommendedMaterial: '推荐材料',
    currentLower: '当前',
    alternatives: '替代方案',
    suggestion: '条',
    suggestions: '条',
    emptyState: '在上方选择用途,然后点击"获取AI建议"按钮。',
    uc_general: '通用',
    uc_lightweight: '轻量化',
    uc_high_strength: '高强度',
    uc_aesthetic: '美观优先',
    uc_cost_optimized: '成本优化',
    temp_normal: '常温 (<80°C)',
    temp_high: '高温 (80-500°C)',
    temp_cryogenic: '超低温 (<0°C)',
    env_indoor: '室内',
    env_outdoor: '室外',
    env_corrosive: '腐蚀环境',
    env_marine: '海洋/水下',
    prio_cost: '成本优先',
    prio_weight: '轻量优先',
    prio_strength: '强度优先',
  },
  es: {
    title: 'Asesor de Dimensiones y Materiales IA',
    subtitle: 'Optimización de dimensiones y materiales según entorno',
    getSuggestions: 'Obtener Sugerencias IA',
    applyAll: 'Aplicar Todo',
    apply: 'Aplicar',
    applied: 'Aplicado',
    useCase: 'Caso de Uso',
    current: 'Actual',
    suggested: 'Sugerido',
    currentShape: 'Forma Actual',
    environment: 'Entorno',
    temperature: 'Temperatura',
    environmentLabel: 'Entorno',
    priority: 'Prioridad de Diseño',
    analyzing: 'Analizando...',
    leftSuffix: ' restantes',
    errorAnalysis: 'Ocurrió un error durante el análisis.',
    recommendedMaterial: 'Material Recomendado',
    currentLower: 'actual',
    alternatives: 'Alternativas',
    suggestion: 'sugerencia',
    suggestions: 'sugerencias',
    emptyState: 'Seleccione un caso de uso arriba y haga clic en "Obtener Sugerencias IA".',
    uc_general: 'General',
    uc_lightweight: 'Ligero',
    uc_high_strength: 'Alta Resistencia',
    uc_aesthetic: 'Estético',
    uc_cost_optimized: 'Costo Optimizado',
    temp_normal: 'Normal (<80°C)',
    temp_high: 'Alta (80-500°C)',
    temp_cryogenic: 'Criogénico (<0°C)',
    env_indoor: 'Interior',
    env_outdoor: 'Exterior',
    env_corrosive: 'Corrosivo',
    env_marine: 'Marino',
    prio_cost: 'Costo',
    prio_weight: 'Peso',
    prio_strength: 'Resistencia',
  },
  ar: {
    title: 'مستشار الأبعاد والمواد بالذكاء الاصطناعي',
    subtitle: 'تحسين الأبعاد والمواد بناءً على البيئة والاستخدام',
    getSuggestions: 'احصل على اقتراحات الذكاء الاصطناعي',
    applyAll: 'تطبيق الكل',
    apply: 'تطبيق',
    applied: 'تم التطبيق',
    useCase: 'حالة الاستخدام',
    current: 'الحالي',
    suggested: 'المقترح',
    currentShape: 'الشكل الحالي',
    environment: 'البيئة',
    temperature: 'درجة الحرارة',
    environmentLabel: 'البيئة',
    priority: 'أولوية التصميم',
    analyzing: 'جاري التحليل...',
    leftSuffix: ' متبقية',
    errorAnalysis: 'حدث خطأ أثناء التحليل.',
    recommendedMaterial: 'المادة الموصى بها',
    currentLower: 'الحالي',
    alternatives: 'البدائل',
    suggestion: 'اقتراح',
    suggestions: 'اقتراحات',
    emptyState: 'اختر حالة استخدام أعلاه وانقر على "احصل على اقتراحات الذكاء الاصطناعي".',
    uc_general: 'عام',
    uc_lightweight: 'خفيف الوزن',
    uc_high_strength: 'عالي القوة',
    uc_aesthetic: 'جمالي',
    uc_cost_optimized: 'تحسين التكلفة',
    temp_normal: 'عادي (<80°C)',
    temp_high: 'عالي (80-500°C)',
    temp_cryogenic: 'تبريد شديد (<0°C)',
    env_indoor: 'داخلي',
    env_outdoor: 'خارجي',
    env_corrosive: 'تآكلي',
    env_marine: 'بحري',
    prio_cost: 'التكلفة',
    prio_weight: 'الوزن',
    prio_strength: 'القوة',
  },
} as const;

const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

const USE_CASES: UseCase[] = ['general', 'lightweight', 'high_strength', 'aesthetic', 'cost_optimized'];

// ── Styles ────────────────────────────────────────────────────────────────────

const C = {
  bg: '#161b22',
  panel: '#1c2128',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  accentGreen: '#3fb950',
  accentOrange: '#f0883e',
  text: '#c9d1d9',
  textDim: '#8b949e',
  hover: '#30363d',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DimensionAdvisorPanel({
  shape,
  params,
  material,
  lang,
  onApplyDimension,
  onClose,
}: DimensionAdvisorPanelProps) {
  const t = dict[langMap[lang] ?? 'en'];
  const isKo = (langMap[lang] ?? 'en') === 'ko';
  const { check, consume, getRemainingCount } = useFreemium();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [upgradeOverLimit, setUpgradeOverLimit] = useState(false);
  const [upgradeUsed, setUpgradeUsed] = useState(0);
  const remaining = getRemainingCount('ai_advisor');

  const [useCase, setUseCase] = useState<UseCase>('general');
  const [loadCtx, setLoadCtx] = useState<LoadContext>({
    temperature: 'normal',
    environment: 'indoor',
    priority: 'cost',
  });
  const [loading, setLoading] = useState(false);
  const [advice, setAdvice] = useState<DimensionAdvice[] | null>(null);
  const [materialAdvice, setMaterialAdvice] = useState<MaterialAdvice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const useCaseLabels: Record<UseCase, string> = {
    general: t.uc_general,
    lightweight: t.uc_lightweight,
    high_strength: t.uc_high_strength,
    aesthetic: t.uc_aesthetic,
    cost_optimized: t.uc_cost_optimized,
  };

  const handleGetSuggestions = useCallback(async () => {
    // Freemium gate
    const gate = check('ai_advisor');
    if (!gate.allowed) {
      setUpgradeOverLimit(gate.overLimit);
      setUpgradeUsed(gate.used);
      setShowUpgrade(true);
      return;
    }

    setLoading(true);
    setError(null);
    setAdvice(null);
    setMaterialAdvice(null);
    setApplied(new Set());
    try {
      const { getAIDimensionAdvice } = await import('./aiDimensionAdvisor');
      const result = await getAIDimensionAdvice(shape, params, material, useCase, lang, loadCtx);
      consume('ai_advisor');
      setAdvice(result.advice);
      setMaterialAdvice(result.materialAdvice ?? null);
    } catch (err) {
      setError(t.errorAnalysis);
      console.error('[DimensionAdvisorPanel]', err);
    } finally {
      setLoading(false);
    }
  }, [shape, params, material, useCase, lang, loadCtx, t, check, consume]);

  const handleApply = useCallback((item: DimensionAdvice) => {
    onApplyDimension(item.param, item.suggestedValue);
    setApplied(prev => new Set(prev).add(item.param));
  }, [onApplyDimension]);

  const handleApplyAll = useCallback(() => {
    if (!advice) return;
    advice.forEach(item => {
      onApplyDimension(item.param, item.suggestedValue);
    });
    setApplied(new Set(advice.map(a => a.param)));
  }, [advice, onApplyDimension]);

  const TEMP_OPTS: { v: LoadContext['temperature']; label: string }[] = [
    { v: 'normal', label: t.temp_normal },
    { v: 'high', label: t.temp_high },
    { v: 'cryogenic', label: t.temp_cryogenic },
  ];
  const ENV_OPTS: { v: LoadContext['environment']; label: string }[] = [
    { v: 'indoor', label: t.env_indoor },
    { v: 'outdoor', label: t.env_outdoor },
    { v: 'corrosive', label: t.env_corrosive },
    { v: 'marine', label: t.env_marine },
  ];
  const PRIO_OPTS: { v: LoadContext['priority']; label: string }[] = [
    { v: 'cost', label: t.prio_cost },
    { v: 'weight', label: t.prio_weight },
    { v: 'strength', label: t.prio_strength },
  ];

  const MATERIAL_NAMES: Record<string, string> = {
    aluminum: 'Al6061', steel: 'S45C', stainless: 'SUS304', titanium: 'Ti-6Al-4V',
    abs_white: 'ABS', nylon: 'PA12', brass: 'C3604', copper: 'C1100',
  };

  return (
    <div style={{
      width: 320,
      flexShrink: 0,
      borderLeft: `1px solid ${C.border}`,
      background: C.bg,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 14px',
        borderBottom: `1px solid ${C.border}`,
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{t.title}</div>
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>
            {t.subtitle}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            border: 'none', background: '#21262d', cursor: 'pointer',
            fontSize: 12, color: C.textDim,
            width: 24, height: 24, borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = C.hover; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; e.currentTarget.style.color = C.textDim; }}
        >
          ✕
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Context info */}
        <div style={{ background: C.card, borderRadius: 8, border: `1px solid ${C.border}`, padding: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            {t.currentShape}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 12, background: '#388bfd22', color: '#58a6ff', border: '1px solid #388bfd44', fontWeight: 700 }}>
              {shape}
            </span>
            <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 12, background: '#3fb95022', color: '#3fb950', border: '1px solid #3fb95044', fontWeight: 700 }}>
              {material}
            </span>
          </div>
        </div>

        {/* Use case selector */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
            {t.useCase}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {USE_CASES.map(uc => {
              const active = useCase === uc;
              return (
                <button
                  key={uc}
                  onClick={() => setUseCase(uc)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: active ? `2px solid ${C.accent}` : `1px solid ${C.border}`,
                    background: active ? '#388bfd18' : 'transparent',
                    color: active ? '#79c0ff' : C.text,
                    fontSize: 12,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = C.hover; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  {useCaseLabels[uc]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Load / environment context */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
            {t.environment}
          </div>
          {/* Temperature */}
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>{t.temperature}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {TEMP_OPTS.map(o => {
              const active = loadCtx.temperature === o.v;
              return (
                <button key={o.v} onClick={() => setLoadCtx(c => ({ ...c, temperature: o.v }))} style={{
                  padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: active ? 700 : 500,
                  border: `1px solid ${active ? C.accent : C.border}`,
                  background: active ? '#388bfd18' : 'transparent',
                  color: active ? '#79c0ff' : C.text, cursor: 'pointer',
                }}>
                  {o.label}
                </button>
              );
            })}
          </div>
          {/* Environment */}
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>{t.environmentLabel}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {ENV_OPTS.map(o => {
              const active = loadCtx.environment === o.v;
              return (
                <button key={o.v} onClick={() => setLoadCtx(c => ({ ...c, environment: o.v }))} style={{
                  padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: active ? 700 : 500,
                  border: `1px solid ${active ? C.accent : C.border}`,
                  background: active ? '#388bfd18' : 'transparent',
                  color: active ? '#79c0ff' : C.text, cursor: 'pointer',
                }}>
                  {o.label}
                </button>
              );
            })}
          </div>
          {/* Priority */}
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>{t.priority}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {PRIO_OPTS.map(o => {
              const active = loadCtx.priority === o.v;
              return (
                <button key={o.v} onClick={() => setLoadCtx(c => ({ ...c, priority: o.v }))} style={{
                  padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: active ? 700 : 500,
                  border: `1px solid ${active ? C.accent : C.border}`,
                  background: active ? '#388bfd18' : 'transparent',
                  color: active ? '#79c0ff' : C.text, cursor: 'pointer',
                }}>
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Get suggestions button */}
        <button
          onClick={handleGetSuggestions}
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px',
            borderRadius: 8,
            border: 'none',
            background: loading ? '#30363d' : C.accent,
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: loading ? 'default' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.background = '#4493ff'; }}
          onMouseLeave={e => { if (!loading) e.currentTarget.style.background = C.accent; }}
        >
          {loading ? (
            <>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 14 }}>⏳</span>
              {t.analyzing}
            </>
          ) : (
            <>
              <span>🤖</span>
              {t.getSuggestions}
              {remaining !== Infinity && remaining > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.8 }}>
                  ({remaining}{t.leftSuffix})
                </span>
              )}
            </>
          )}
        </button>

        {/* Error */}
        {error && (
          <div style={{
            background: '#3d1c1c',
            border: `1px solid #f8514955`,
            borderRadius: 8,
            padding: '10px 12px',
            fontSize: 12,
            color: '#f85149',
          }}>
            {error}
          </div>
        )}

        {/* Material Recommendation Card */}
        {materialAdvice && (
          <div style={{
            background: '#1a2332',
            borderRadius: 10,
            border: `1px solid #388bfd55`,
            padding: '10px 12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>🔬</span>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#79c0ff' }}>
                {t.recommendedMaterial}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                fontSize: 13, fontWeight: 800, padding: '4px 10px', borderRadius: 8,
                background: '#388bfd22', color: '#58a6ff', border: '1px solid #388bfd44',
              }}>
                {MATERIAL_NAMES[materialAdvice.recommendedMaterial] ?? materialAdvice.recommendedMaterial}
              </span>
              <span style={{ fontSize: 10, color: C.textDim }}>
                {t.currentLower}: {MATERIAL_NAMES[material] ?? material}
              </span>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5, marginBottom: 6 }}>
              {isKo ? materialAdvice.reasonKo : materialAdvice.reasonEn}
            </div>
            {materialAdvice.alternatives.length > 0 && (
              <div style={{ fontSize: 10, color: C.textDim }}>
                {t.alternatives}: {materialAdvice.alternatives.map(a => MATERIAL_NAMES[a] ?? a).join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {advice && advice.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {`${advice.length} ${advice.length > 1 ? t.suggestions : t.suggestion}`}
              </div>
              {advice.length > 1 && (
                <button
                  onClick={handleApplyAll}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 6,
                    border: `1px solid ${C.accentGreen}`,
                    background: '#3fb95018',
                    color: C.accentGreen,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.12s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#3fb95030'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#3fb95018'; }}
                >
                  {t.applyAll}
                </button>
              )}
            </div>

            {advice.map((item) => {
              const isApplied = applied.has(item.param);
              const delta = item.suggestedValue - item.currentValue;
              const deltaSign = delta > 0 ? '+' : '';
              const reason = isKo ? item.reasonKo : item.reason;

              return (
                <div
                  key={item.param}
                  style={{
                    background: C.card,
                    borderRadius: 10,
                    border: `1px solid ${isApplied ? C.accentGreen + '66' : C.border}`,
                    padding: '10px 12px',
                    transition: 'border-color 0.2s',
                  }}
                >
                  {/* Param name */}
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 8 }}>
                    {item.param}
                  </div>

                  {/* Current → Suggested */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div style={{ flex: 1, background: '#0d1117', borderRadius: 6, padding: '6px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: 9, color: C.textDim, fontWeight: 700, marginBottom: 2 }}>{t.current}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, fontFamily: 'monospace' }}>
                        {item.currentValue}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, color: C.textDim }}>→</div>
                    <div style={{ flex: 1, background: '#0d1117', borderRadius: 6, padding: '6px 10px', textAlign: 'center', border: `1px solid ${C.accent}44` }}>
                      <div style={{ fontSize: 9, color: C.textDim, fontWeight: 700, marginBottom: 2 }}>{t.suggested}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: '#79c0ff', fontFamily: 'monospace' }}>
                        {item.suggestedValue}
                        <span style={{
                          fontSize: 10,
                          marginLeft: 4,
                          color: delta > 0 ? C.accentOrange : delta < 0 ? C.accentGreen : C.textDim,
                          fontWeight: 600,
                        }}>
                          ({deltaSign}{delta.toFixed(1)})
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Reason */}
                  <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5, marginBottom: 10 }}>
                    {reason}
                  </div>

                  {/* Apply button */}
                  <button
                    onClick={() => handleApply(item)}
                    disabled={isApplied}
                    style={{
                      width: '100%',
                      padding: '6px',
                      borderRadius: 6,
                      border: 'none',
                      background: isApplied ? '#3fb95022' : C.accent,
                      color: isApplied ? C.accentGreen : '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: isApplied ? 'default' : 'pointer',
                      transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => { if (!isApplied) e.currentTarget.style.background = '#4493ff'; }}
                    onMouseLeave={e => { if (!isApplied) e.currentTarget.style.background = isApplied ? '#3fb95022' : C.accent; }}
                  >
                    {isApplied ? `✓ ${t.applied}` : t.apply}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state after loading */}
        {!loading && !error && advice === null && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: C.textDim, fontSize: 12 }}>
            {t.emptyState}
          </div>
        )}
      </div>

      <UpgradeModal
        open={showUpgrade}
        feature="ai_advisor"
        overLimit={upgradeOverLimit}
        used={upgradeUsed}
        limit={5}
        lang={lang}
        onClose={() => setShowUpgrade(false)}
      />
    </div>
  );
}
