'use client';

/**
 * CostCopilotPanel.tsx — Design-for-Cost Copilot UI (Phase 4).
 *
 * Conversational panel: user types a goal ("cut cost by 20%", "faster lead time"),
 * LLM returns 1-4 concrete suggestions. Each card shows title + rationale +
 * a real cost delta computed locally by costCopilot.ts, plus an "Apply" button
 * that invokes setParam / setMaterialId callbacks supplied by the parent.
 */

import React, { useCallback, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { GeometryMetrics, CostEstimationContext } from '../estimation/CostEstimator';
import { formatCost } from '../estimation/CostEstimator';
import { askCostCopilot, type AskCopilotResult, type CopilotSuggestionWithDelta } from './costCopilot';

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  purple: '#a371f7',
  gold: '#d29922',
  green: '#3fb950',
  red: '#f85149',
  text: '#c9d1d9',
  dim: '#8b949e',
};

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict: Record<Lang, {
  title: string;
  subtitle: string;
  quickPrompts: string;
  thinking: string;
  rerouteCta: string;
  suggestions: string;
  materialSwap: string;
  processSwap: string;
  applied: string;
  apply: string;
  placeholder: string;
  proRequired: string;
  quick: Array<string>;
}> = {
  ko: {
    title: '비용 절감 코파일럿',
    subtitle: '자연어로 원하는 목표를 입력하세요',
    quickPrompts: '빠른 질문',
    thinking: '분석 중…',
    rerouteCta: '변경된 설계로 최적 공정 다시 찾기 →',
    suggestions: '제안',
    materialSwap: '재료 → ',
    processSwap: '공정 → ',
    applied: '적용됨',
    apply: '적용',
    placeholder: '예: 비용 20% 절감',
    proRequired: 'Pro 플랜이 필요합니다',
    quick: ['비용 20% 줄여줘', '납기 단축하는 방법', '재료를 바꿔서 절감', '강도는 유지하고 절감'],
  },
  en: {
    title: 'Design-for-Cost Copilot',
    subtitle: 'Describe your cost/lead-time goal in plain language',
    quickPrompts: 'Quick prompts',
    thinking: 'Thinking…',
    rerouteCta: 'Re-route process for the new design →',
    suggestions: 'Suggestions',
    materialSwap: 'material → ',
    processSwap: 'process → ',
    applied: 'Applied',
    apply: 'Apply',
    placeholder: 'e.g. cut cost by 20%',
    proRequired: 'Pro plan required',
    quick: ['Cut cost by 20%', 'How to shorten lead time', 'Save by swapping material', 'Save without losing strength'],
  },
  ja: {
    title: 'コスト削減コパイロット',
    subtitle: '目標を自然な言葉で入力してください',
    quickPrompts: 'クイック入力',
    thinking: '思考中…',
    rerouteCta: '変更設計で最適工程を再探索 →',
    suggestions: '提案',
    materialSwap: '素材 → ',
    processSwap: '工程 → ',
    applied: '適用済み',
    apply: '適用',
    placeholder: '例: コスト20%削減',
    proRequired: 'Proプランが必要です',
    quick: ['コストを20%削減', '納期を短縮する方法', '素材を変えて節約', '強度を保ったまま節約'],
  },
  zh: {
    title: '成本节约副驾驶',
    subtitle: '请用自然语言描述您的目标',
    quickPrompts: '快速提问',
    thinking: '思考中…',
    rerouteCta: '为新设计重新规划工艺 →',
    suggestions: '建议',
    materialSwap: '材料 → ',
    processSwap: '工艺 → ',
    applied: '已应用',
    apply: '应用',
    placeholder: '例如:降低20%成本',
    proRequired: '需要Pro套餐',
    quick: ['成本降低20%', '如何缩短交期', '换材料节省成本', '保持强度并节省成本'],
  },
  es: {
    title: 'Copiloto de diseño para costo',
    subtitle: 'Describe tu meta de costo/plazo en lenguaje natural',
    quickPrompts: 'Consultas rápidas',
    thinking: 'Pensando…',
    rerouteCta: 'Reenrutar proceso para el nuevo diseño →',
    suggestions: 'Sugerencias',
    materialSwap: 'material → ',
    processSwap: 'proceso → ',
    applied: 'Aplicado',
    apply: 'Aplicar',
    placeholder: 'ej.: reducir costo un 20%',
    proRequired: 'Se requiere plan Pro',
    quick: ['Reducir costo un 20%', 'Cómo acortar el plazo', 'Ahorrar cambiando material', 'Ahorrar sin perder resistencia'],
  },
  ar: {
    title: 'مساعد تصميم لتقليل التكلفة',
    subtitle: 'صف هدفك للتكلفة/المهلة بلغة طبيعية',
    quickPrompts: 'مطالبات سريعة',
    thinking: 'جارٍ التفكير…',
    rerouteCta: 'إعادة توجيه العملية للتصميم الجديد →',
    suggestions: 'اقتراحات',
    materialSwap: 'مادة → ',
    processSwap: 'عملية → ',
    applied: 'تم التطبيق',
    apply: 'تطبيق',
    placeholder: 'مثال: خفض التكلفة بنسبة 20%',
    proRequired: 'يتطلب خطة Pro',
    quick: ['خفض التكلفة بنسبة 20%', 'كيفية تقصير المهلة', 'التوفير بتبديل المادة', 'التوفير دون فقدان القوة'],
  },
};

interface CostCopilotPanelProps {
  params: Record<string, number>;
  materialId: string;
  process: string;
  quantity: number;
  metrics?: GeometryMetrics | null;
  ctx?: CostEstimationContext;
  lang: string;
  onClose: () => void;
  /** Apply a param change (key + absolute new value). */
  setParam?: (key: string, value: number) => void;
  /** Swap to a new material id. */
  setMaterialId?: (id: string) => void;
  /** Fired when the server returns requiresPro — parent should show the upgrade modal. */
  onRequirePro?: () => void;
  /** Optional follow-up: open Process Router after a suggestion is applied. */
  onContinueToProcessRouter?: () => void;
  /** Optional project link for history filtering. */
  projectId?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function CostCopilotPanel({
  params, materialId, process: processId, quantity, metrics, ctx, lang,
  onClose, setParam, setMaterialId, onRequirePro, onContinueToProcessRouter,
  projectId,
}: CostCopilotPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, Lang> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tt = dict[langMap[seg] ?? 'en'];

  const isKo = lang === 'ko';

  const [input, setInput] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [latest, setLatest] = useState<AskCopilotResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);

  const ask = useCallback(async (message: string) => {
    const msg = message.trim();
    if (!msg || loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    setInput('');
    const nextHistory: ChatMessage[] = [...history, { role: 'user', content: msg }];
    setHistory(nextHistory);

    try {
      const res = await askCostCopilot({
        userMessage: msg,
        params, materialId, process: processId, quantity,
        metrics, ctx, lang,
        history: nextHistory.slice(-6),
        signal: controller.signal,
        projectId,
      });
      setLatest(res);
      setHistory([...nextHistory, { role: 'assistant', content: isKo ? res.replyKo : res.reply }]);
      setAppliedIds(new Set());
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      const e = err as Error & { requiresPro?: boolean };
      if (e.requiresPro) {
        onRequirePro?.();
        setError(tt.proRequired);
      } else {
        setError(e.message);
      }
    } finally {
      setLoading(false);
    }
  }, [history, loading, params, materialId, processId, quantity, metrics, ctx, lang, isKo, onRequirePro, projectId, tt]);

  const applySuggestion = useCallback((s: CopilotSuggestionWithDelta) => {
    if (s.paramDeltas && setParam) {
      for (const [key, delta] of Object.entries(s.paramDeltas)) {
        const cur = params[key];
        if (typeof cur !== 'number' || typeof delta !== 'number') continue;
        setParam(key, cur + delta);
      }
    }
    if (s.materialSwap && setMaterialId) {
      setMaterialId(s.materialSwap);
    }
    setAppliedIds(prev => new Set(prev).add(s.id));
  }, [params, setParam, setMaterialId]);

  return (
    <div style={{
      position: 'fixed', top: 48, right: 16, zIndex: 900,
      width: 400, maxHeight: 'calc(100vh - 80px)',
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px', borderBottom: `1px solid ${C.border}`,
        background: `linear-gradient(135deg, ${C.gold}11, transparent)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>💰</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
              {tt.title}
            </div>
            <div style={{ fontSize: 10, color: C.dim }}>
              {tt.subtitle}
            </div>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: C.dim, fontSize: 18, cursor: 'pointer', padding: 4,
        }}>✕</button>
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {/* Quick prompts (shown only when no conversation yet) */}
        {history.length === 0 && !loading && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase', marginBottom: 6 }}>
              {tt.quickPrompts}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {tt.quick.map((q, i) => (
                <button key={i} onClick={() => ask(q)} style={{
                  padding: '8px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
                  background: C.card, color: C.text, fontSize: 11, fontWeight: 600,
                  textAlign: 'left', cursor: 'pointer',
                }}>
                  💬 {q}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Chat history */}
        {history.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {history.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '8px 10px', borderRadius: 10,
                background: m.role === 'user' ? `${C.accent}22` : C.card,
                border: `1px solid ${m.role === 'user' ? C.accent : C.border}44`,
                fontSize: 11, color: C.text, lineHeight: 1.4, whiteSpace: 'pre-wrap',
              }}>
                {m.content}
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div style={{ color: C.dim, fontSize: 11, textAlign: 'center', padding: 12 }}>
            {tt.thinking}
          </div>
        )}

        {error && (
          <div style={{
            padding: '10px 12px', borderRadius: 6, border: `1px solid ${C.red}44`,
            background: `${C.red}0d`, color: C.red, fontSize: 11, fontWeight: 600, marginBottom: 10,
          }}>
            ⚠️ {error}
          </div>
        )}

        {/* Chained next-step CTA */}
        {appliedIds.size > 0 && onContinueToProcessRouter && (
          <button
            onClick={onContinueToProcessRouter}
            style={{
              width: '100%', marginBottom: 10, padding: '10px 0', borderRadius: 8, border: 'none',
              background: 'linear-gradient(135deg, #a371f7, #388bfd)',
              color: '#fff', fontSize: 12, fontWeight: 800, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
            🧭 {tt.rerouteCta}
          </button>
        )}

        {/* Suggestion cards */}
        {latest && latest.suggestions.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, textTransform: 'uppercase' }}>
              {tt.suggestions}
            </div>
            {latest.suggestions.map((s) => {
              const applied = appliedIds.has(s.id);
              const canApply = (s.paramDeltas && setParam) || (s.materialSwap && setMaterialId);
              const deltaColor = s.costDelta && s.costDelta.delta < 0 ? C.green : s.costDelta && s.costDelta.delta > 0 ? C.red : C.dim;
              const sign = s.costDelta && s.costDelta.delta < 0 ? '' : '+';
              return (
                <div key={s.id} style={{
                  border: `1px solid ${C.border}`, borderRadius: 8,
                  background: C.card, padding: '10px 12px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: C.text, lineHeight: 1.3 }}>
                      {isKo ? s.titleKo : s.title}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: s.estimatedSavingsPercent > 0 ? C.green : C.dim, flexShrink: 0 }}>
                      ~{s.estimatedSavingsPercent > 0 ? '-' : '+'}{Math.abs(s.estimatedSavingsPercent)}%
                    </div>
                  </div>

                  <div style={{ fontSize: 10, color: C.text, lineHeight: 1.5, marginBottom: 6 }}>
                    {isKo ? s.rationaleKo : s.rationale}
                  </div>

                  {/* Swap / delta chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                    {s.paramDeltas && Object.entries(s.paramDeltas).map(([k, v]) => (
                      <span key={k} style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                        background: `${C.accent}22`, color: C.accent, border: `1px solid ${C.accent}44`,
                      }}>
                        {k} {v > 0 ? '+' : ''}{v}
                      </span>
                    ))}
                    {s.materialSwap && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                        background: `${C.purple}22`, color: C.purple, border: `1px solid ${C.purple}44`,
                      }}>
                        {tt.materialSwap}{s.materialSwap}
                      </span>
                    )}
                    {s.processSwap && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
                        background: `${C.gold}22`, color: C.gold, border: `1px solid ${C.gold}44`,
                      }}>
                        {tt.processSwap}{s.processSwap}
                      </span>
                    )}
                  </div>

                  {/* Real cost delta */}
                  {s.costDelta && (
                    <div style={{
                      marginBottom: 6, padding: '6px 8px', borderRadius: 6,
                      background: `${deltaColor}11`, border: `1px solid ${deltaColor}33`,
                      display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.text,
                    }}>
                      <span>
                        {formatCost(s.costDelta.before, s.costDelta.currency as 'USD' | 'KRW')} → {formatCost(s.costDelta.after, s.costDelta.currency as 'USD' | 'KRW')}
                      </span>
                      <span style={{ fontWeight: 800, color: deltaColor }}>
                        {sign}{formatCost(Math.abs(s.costDelta.delta), s.costDelta.currency as 'USD' | 'KRW')} ({s.costDelta.percentChange > 0 ? '+' : ''}{s.costDelta.percentChange}%)
                      </span>
                    </div>
                  )}

                  {/* Caveat */}
                  {(s.caveat || s.caveatKo) && (
                    <div style={{ fontSize: 9, color: C.gold, lineHeight: 1.4, marginBottom: 8 }}>
                      ⚠️ {isKo ? (s.caveatKo ?? s.caveat) : s.caveat}
                    </div>
                  )}

                  {/* Apply */}
                  {canApply && (
                    <button
                      onClick={() => applySuggestion(s)}
                      disabled={applied}
                      style={{
                        width: '100%', padding: '6px 0', borderRadius: 6, border: 'none',
                        background: applied ? `${C.green}33` : C.gold,
                        color: applied ? C.green : '#000',
                        fontSize: 11, fontWeight: 800, cursor: applied ? 'default' : 'pointer',
                      }}>
                      {applied ? `✓ ${tt.applied}` : `💰 ${tt.apply}`}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 6 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
          placeholder={tt.placeholder}
          disabled={loading}
          style={{
            flex: 1, padding: '7px 9px', borderRadius: 6, border: `1px solid ${C.border}`,
            background: C.card, color: C.text, fontSize: 11,
          }}
        />
        <button
          onClick={() => ask(input)}
          disabled={loading || !input.trim()}
          style={{
            padding: '7px 12px', borderRadius: 6, border: 'none',
            background: loading || !input.trim() ? C.border : `linear-gradient(135deg, ${C.gold}, ${C.accent})`,
            color: '#fff', fontSize: 11, fontWeight: 800,
            cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
          }}>
          {loading ? '…' : '▶'}
        </button>
      </div>
    </div>
  );
}
