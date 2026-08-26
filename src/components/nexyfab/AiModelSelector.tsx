'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CODEGEN_MODELS,
  canUseCodegenModel,
  defaultCodegenModelForPlan,
  findCodegenModel,
  type AiAccessPlan,
} from '@/lib/ai/codegenModels';
import { aiModelBetaAccessEnabled } from '@/lib/ai/aiModelBetaAccess';

export const AI_MODEL_STORAGE_KEY = 'nexyfab:ai-model';

const COPY: Record<string, { choose: string; autoVision: string; parallel: string; locked: string; recommended: string }> = {
  ko: { choose: 'AI 모델 선택', autoVision: '선택 모델이 VL을 지원하면 그대로 사용하고, 미지원 시 GPT-5.6 Luna로 전환합니다.', parallel: '복잡하거나 모호한 설계만 Luna가 용어·요구사항을 사전 점검합니다.', locked: '요금제 필요', recommended: '추천' },
  en: { choose: 'Choose AI model', autoVision: 'Native vision is used when supported; otherwise the visual stage uses GPT-5.6 Luna.', parallel: 'Luna preflights terminology and requirements only for complex or ambiguous designs.', locked: 'Plan required', recommended: 'Recommended' },
  ja: { choose: 'AIモデルを選択', autoVision: '選択モデルが画像対応ならそのまま使い、非対応時は GPT-5.6 Luna に切り替えます。', parallel: '複雑または曖昧な設計のみ Luna が用語と要件を事前確認します。', locked: 'プランが必要', recommended: '推奨' },
  zh: { choose: '选择 AI 模型', autoVision: '所选模型支持视觉时直接使用；不支持时视觉阶段切换到 GPT-5.6 Luna。', parallel: '仅对复杂或含糊的设计，由 Luna 预检术语与需求。', locked: '需要套餐', recommended: '推荐' },
  cn: { choose: '选择 AI 模型', autoVision: '所选模型支持视觉时直接使用；不支持时视觉阶段切换到 GPT-5.6 Luna。', parallel: '仅对复杂或含糊的设计，由 Luna 预检术语与需求。', locked: '需要套餐', recommended: '推荐' },
  es: { choose: 'Elegir modelo de IA', autoVision: 'Se usa la visión nativa cuando existe; si no, la etapa visual usa GPT-5.6 Luna.', parallel: 'Luna revisa terminología y requisitos solo en diseños complejos o ambiguos.', locked: 'Requiere plan', recommended: 'Recomendado' },
  ar: { choose: 'اختيار نموذج الذكاء الاصطناعي', autoVision: 'تُستخدم الرؤية الأصلية عند دعمها، وإلا تنتقل المرحلة المرئية إلى GPT-5.6 Luna.', parallel: 'يراجع Luna المصطلحات والمتطلبات فقط للتصاميم المعقدة أو الغامضة.', locked: 'تتطلب خطة', recommended: 'موصى به' },
};

const BETA_ACCESS_COPY: Record<string, string> = {
  ko: '결제 없는 운영 베타: 모든 모델 선택 가능',
  en: 'No-payment production beta: all models are selectable',
  ja: '決済なしの運用ベータ: すべてのモデルを選択可能',
  zh: '无付费运营测试：可选择所有模型',
  cn: '无付费运营测试：可选择所有模型',
  es: 'Beta de producción sin pago: todos los modelos están disponibles',
  ar: 'نسخة تشغيلية تجريبية بدون دفع: جميع النماذج متاحة',
};

function copyFor(lang: string) {
  return COPY[lang] ?? COPY.en;
}

export function useAiModelPreference(plan: AiAccessPlan | string | null | undefined) {
  const fallback = defaultCodegenModelForPlan(plan);
  const [modelId, setModelId] = useState(fallback);

  useEffect(() => {
    let active = true;
    let nextModelId = fallback;
    try {
      const saved = localStorage.getItem(AI_MODEL_STORAGE_KEY)
        ?? localStorage.getItem('nexyfab:studio-model');
      const model = findCodegenModel(saved);
      nextModelId = model && canUseCodegenModel(model, plan) ? model.id : fallback;
    } catch { /* storage may be unavailable */ }
    queueMicrotask(() => {
      if (active) setModelId(nextModelId);
    });
    return () => { active = false; };
  }, [fallback, plan]);

  const pickModel = useCallback((id: string) => {
    const model = findCodegenModel(id);
    if (!model || !canUseCodegenModel(model, plan)) return false;
    setModelId(model.id);
    try {
      localStorage.setItem(AI_MODEL_STORAGE_KEY, model.id);
      localStorage.removeItem('nexyfab:studio-model');
    } catch { /* storage may be unavailable */ }
    return true;
  }, [plan]);

  return { modelId, pickModel };
}

export function AiModelSelector({
  modelId,
  onChange,
  plan,
  lang = 'en',
  compact = false,
}: {
  modelId: string;
  onChange: (id: string) => void;
  plan: AiAccessPlan | string;
  lang?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const copy = copyFor(lang);
  const betaAccess = aiModelBetaAccessEnabled();
  const current = useMemo(
    () => findCodegenModel(modelId) ?? findCodegenModel(defaultCodegenModelForPlan(plan))!,
    [modelId, plan],
  );

  return (
    <div style={{ position: 'relative', minWidth: 0 }} data-testid="ai-model-selector">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        title={copy.choose}
        style={{
          minHeight: compact ? 26 : 32,
          maxWidth: '100%',
          padding: compact ? '3px 8px' : '6px 11px',
          border: '1px solid var(--nx-border, rgba(148,163,184,.35))',
          borderRadius: 999,
          background: 'var(--nx-panel-2, rgba(15,23,42,.82))',
          color: 'var(--nx-text, inherit)',
          fontSize: compact ? 10 : 11,
          fontWeight: 750,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          cursor: 'pointer',
        }}
      >
        <span aria-hidden="true">✦</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.label}</span>
        <span style={{ opacity: .62 }}>▾</span>
      </button>

      {open && (
        <>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 79, border: 0, background: 'transparent' }} />
          <div
            role="listbox"
            aria-label={copy.choose}
            style={{
              position: 'absolute',
              zIndex: 80,
              insetInlineEnd: 0,
              marginTop: 5,
              width: 'min(310px, calc(100vw - 24px))',
              maxHeight: 'min(480px, 70vh)',
              overflow: 'auto',
              border: '1px solid var(--nx-border, #334155)',
              borderRadius: 10,
              background: 'var(--nx-panel, #0f172a)',
              boxShadow: '0 18px 48px rgba(0,0,0,.36)',
              padding: 5,
            }}
          >
            {CODEGEN_MODELS.map(model => {
              const allowed = canUseCodegenModel(model, plan);
              const selected = model.id === current.id;
              return (
                <button
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  aria-disabled={!allowed}
                  disabled={!allowed}
                  onClick={() => { onChange(model.id); setOpen(false); }}
                  style={{
                    width: '100%',
                    padding: '8px 9px',
                    border: 0,
                    borderRadius: 7,
                    background: selected ? 'rgba(59,130,246,.16)' : 'transparent',
                    color: allowed ? 'var(--nx-text, #e2e8f0)' : 'var(--nx-text-3, #64748b)',
                    textAlign: 'start',
                    cursor: allowed ? 'pointer' : 'not-allowed',
                    opacity: allowed ? 1 : .62,
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <strong style={{ fontSize: 11.5 }}>{model.label}{selected ? ' ✓' : ''}</strong>
                    <span style={{ display: 'flex', gap: 4, fontSize: 8.5, textTransform: 'uppercase' }}>
                      {model.recommended && <span style={{ color: '#60a5fa' }}>{copy.recommended}</span>}
                      {model.availability === 'preview' && <span style={{ color: '#f59e0b' }}>PREVIEW</span>}
                      {model.vision && <span style={{ color: '#22c55e' }}>VL</span>}
                      <span>{allowed ? model.tier : `🔒 ${model.tier}`}</span>
                    </span>
                  </span>
                  <span style={{ display: 'block', marginTop: 2, fontSize: 9.5, opacity: .78 }}>
                    {allowed ? model.note : `${model.note} · ${copy.locked}`}
                  </span>
                </button>
              );
            })}
            <div style={{ margin: '5px 5px 2px', paddingTop: 7, borderTop: '1px solid var(--nx-border, #334155)', color: 'var(--nx-text-3, #94a3b8)', fontSize: 9.5, lineHeight: 1.4 }}>
              {betaAccess && <><strong style={{ color: '#22c55e' }}>{BETA_ACCESS_COPY[lang] ?? BETA_ACCESS_COPY.en}</strong><br /></>}
              ◉ {copy.autoVision}
              <br />↳ {copy.parallel}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
