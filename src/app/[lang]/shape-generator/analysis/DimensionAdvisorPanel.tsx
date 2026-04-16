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

// ── i18n labels ───────────────────────────────────────────────────────────────

const USE_CASE_LABELS: Record<string, Record<UseCase, string>> = {
  ko: {
    general: '일반',
    lightweight: '경량화',
    high_strength: '고강도',
    aesthetic: '미관 중심',
    cost_optimized: '비용 최적화',
  },
  en: {
    general: 'General',
    lightweight: 'Lightweight',
    high_strength: 'High Strength',
    aesthetic: 'Aesthetic',
    cost_optimized: 'Cost Optimized',
  },
  ja: {
    general: '汎用',
    lightweight: '軽量化',
    high_strength: '高強度',
    aesthetic: '美観重視',
    cost_optimized: 'コスト最適',
  },
  cn: {
    general: '通用',
    lightweight: '轻量化',
    high_strength: '高强度',
    aesthetic: '美观优先',
    cost_optimized: '成本优化',
  },
  es: {
    general: 'General',
    lightweight: 'Ligero',
    high_strength: 'Alta Resistencia',
    aesthetic: 'Estético',
    cost_optimized: 'Costo Optimizado',
  },
  ar: {
    general: 'عام',
    lightweight: 'خفيف الوزن',
    high_strength: 'عالي القوة',
    aesthetic: 'جمالي',
    cost_optimized: 'تحسين التكلفة',
  },
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
  const isKo = lang === 'ko';
  const useCaseLabels = USE_CASE_LABELS[lang] ?? USE_CASE_LABELS.en;
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
      setError(isKo ? '분석 중 오류가 발생했습니다.' : 'An error occurred during analysis.');
      console.error('[DimensionAdvisorPanel]', err);
    } finally {
      setLoading(false);
    }
  }, [shape, params, material, useCase, lang, loadCtx, isKo, check, consume]);

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

  const title = isKo ? 'AI 치수·재료 추천' : 'AI Dimension & Material Advisor';
  const getSuggestionsLabel = isKo ? 'AI 제안 받기' : 'Get AI Suggestions';
  const applyAllLabel = isKo ? '모두 적용' : 'Apply All';
  const applyLabel = isKo ? '적용' : 'Apply';
  const appliedLabel = isKo ? '적용됨' : 'Applied';
  const useCaseLabel = isKo ? '사용 목적' : 'Use Case';
  const currentLabel = isKo ? '현재' : 'Current';
  const suggestedLabel = isKo ? '제안' : 'Suggested';

  const TEMP_OPTS: { v: LoadContext['temperature']; ko: string; en: string }[] = [
    { v: 'normal', ko: '상온 (<80°C)', en: 'Normal (<80°C)' },
    { v: 'high', ko: '고온 (80-500°C)', en: 'High (80-500°C)' },
    { v: 'cryogenic', ko: '극저온 (<0°C)', en: 'Cryogenic (<0°C)' },
  ];
  const ENV_OPTS: { v: LoadContext['environment']; ko: string; en: string }[] = [
    { v: 'indoor', ko: '실내', en: 'Indoor' },
    { v: 'outdoor', ko: '실외', en: 'Outdoor' },
    { v: 'corrosive', ko: '부식 환경', en: 'Corrosive' },
    { v: 'marine', ko: '해양·수중', en: 'Marine' },
  ];
  const PRIO_OPTS: { v: LoadContext['priority']; ko: string; en: string }[] = [
    { v: 'cost', ko: '비용 우선', en: 'Cost' },
    { v: 'weight', ko: '경량 우선', en: 'Weight' },
    { v: 'strength', ko: '강도 우선', en: 'Strength' },
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
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{title}</div>
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>
            {isKo ? '환경·용도 기반 치수 + 재질 최적 추천' : 'Environment-aware dimension & material optimization'}
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
            {isKo ? '현재 형상' : 'Current Shape'}
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
            {useCaseLabel}
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
            {isKo ? '사용 환경' : 'Environment'}
          </div>
          {/* Temperature */}
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>{isKo ? '온도 조건' : 'Temperature'}</div>
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
                  {isKo ? o.ko : o.en}
                </button>
              );
            })}
          </div>
          {/* Environment */}
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>{isKo ? '환경' : 'Environment'}</div>
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
                  {isKo ? o.ko : o.en}
                </button>
              );
            })}
          </div>
          {/* Priority */}
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>{isKo ? '설계 우선순위' : 'Design Priority'}</div>
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
                  {isKo ? o.ko : o.en}
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
              {isKo ? '분석 중...' : 'Analyzing...'}
            </>
          ) : (
            <>
              <span>🤖</span>
              {getSuggestionsLabel}
              {remaining !== Infinity && remaining > 0 && (
                <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.8 }}>
                  ({remaining}{isKo ? '회 남음' : ' left'})
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
                {isKo ? '추천 재질' : 'Recommended Material'}
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
                {isKo ? '현재' : 'current'}: {MATERIAL_NAMES[material] ?? material}
              </span>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5, marginBottom: 6 }}>
              {isKo ? materialAdvice.reasonKo : materialAdvice.reasonEn}
            </div>
            {materialAdvice.alternatives.length > 0 && (
              <div style={{ fontSize: 10, color: C.textDim }}>
                {isKo ? '대안' : 'Alternatives'}: {materialAdvice.alternatives.map(a => MATERIAL_NAMES[a] ?? a).join(', ')}
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {advice && advice.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {isKo ? `제안 ${advice.length}건` : `${advice.length} suggestion${advice.length > 1 ? 's' : ''}`}
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
                  {applyAllLabel}
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
                      <div style={{ fontSize: 9, color: C.textDim, fontWeight: 700, marginBottom: 2 }}>{currentLabel}</div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, fontFamily: 'monospace' }}>
                        {item.currentValue}
                      </div>
                    </div>
                    <div style={{ fontSize: 14, color: C.textDim }}>→</div>
                    <div style={{ flex: 1, background: '#0d1117', borderRadius: 6, padding: '6px 10px', textAlign: 'center', border: `1px solid ${C.accent}44` }}>
                      <div style={{ fontSize: 9, color: C.textDim, fontWeight: 700, marginBottom: 2 }}>{suggestedLabel}</div>
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
                    {isApplied ? `✓ ${appliedLabel}` : applyLabel}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Empty state after loading */}
        {!loading && !error && advice === null && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: C.textDim, fontSize: 12 }}>
            {isKo
              ? '위에서 사용 목적을 선택하고 "AI 제안 받기" 버튼을 클릭하세요.'
              : 'Select a use case above and click "Get AI Suggestions".'}
          </div>
        )}
      </div>

      {/* Inline keyframe for spinner */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

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
