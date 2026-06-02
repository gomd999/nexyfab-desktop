'use client';

/**
 * FeatureTreePlannerPanel — Phase 3.AI.UI surface that exposes the
 * FeatureTreePlanner (Agent-PPP) to end users as a chat-style NL panel.
 *
 * Architecture:
 *   - Standalone panel (NOT a wrapper). The host SolverSketchEditor
 *     mounts it next to FeatureTreeView and passes `currentTree`.
 *   - User types free-form NL → first attempt regex `detectIntent`.
 *     If that returns `null`, optionally fall back to `llmIntentFetcher`
 *     (injected so tests stay LLM-free).
 *   - On success, `planFromIntent(intent, currentTree)` produces a
 *     PlanResult. We show a per-step preview + Apply button.
 *   - Apply triggers `onApply(steps)` so the host can run them through
 *     `applyEdit` sequentially. We also push the prompt + result into
 *     a rolling 5-entry history list and clear the input.
 *
 * Order of intent extraction:
 *   1. `detectIntent(text)` — pure regex, zero latency. Wins if non-null.
 *   2. `llmIntentFetcher?.(text)` — caller-provided LLM bridge. Only
 *      invoked when (1) fails AND the prop is wired. Async, may also
 *      return null (LLM punts on unparseable input).
 *   3. Both null → "Could not understand" status.
 *
 * History policy:
 *   - Each successful detect (regex OR LLM) produces a history entry
 *     of shape `{ prompt, intentKind, stepCount, warnings }`.
 *   - Capped at the 5 most recent; oldest evicted on overflow.
 *   - Failed detections are NOT recorded — history is signal, not noise.
 *
 * Apply behavior:
 *   - Disabled while no plan is loaded, while a plan has zero steps
 *     (warnings still shown), or while detection is in flight.
 *   - On click: `onApply(steps)` → input cleared → plan preview cleared
 *     → history retained.
 *
 * Test surface (data-testids — all prefixed planner-):
 *   planner-panel,
 *   planner-input, planner-send, planner-apply,
 *   planner-status, planner-rationale, planner-warning-{idx},
 *   planner-step-{idx},
 *   planner-history, planner-history-item-{idx}.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { detectIntent } from '@/lib/ai/featureTreeIntentDetector';
import {
  planFromIntent,
  FeatureTreePlannerError,
  type PlanIntent,
  type PlanResult,
  type PlanStep,
} from '@/lib/ai/featureTreePlanner';
import type { FeatureTree } from '@/lib/cad/featureTree';

export type PlannerLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  panelTitle: string;
  inputPlaceholder: string;
  send: string;
  apply: string;
  detecting: string;
  generating: string;
  couldNotUnderstand: string;
  emptyPlanWarning: string;
  rationaleHeading: string;
  stepsHeading: string;
  warningsHeading: string;
  historyHeading: string;
  historyEmpty: string;
  stepAddNode: string;
  stepRemoveNode: string;
  stepMoveNode: string;
  stepToggleSuppress: string;
  errorPrefix: string;
}

const dict: Record<PlannerLang, Dict> = {
  ko: {
    panelTitle: 'AI 플래너',
    inputPlaceholder: '예: box 50x50x30 with fillet 5',
    send: '전송',
    apply: '적용',
    detecting: '의도 분석 중...',
    generating: '계획 생성 중...',
    couldNotUnderstand: '이해하지 못했습니다. 다시 시도해주세요.',
    emptyPlanWarning: '실행할 단계가 없습니다.',
    rationaleHeading: '계획 요약',
    stepsHeading: '단계',
    warningsHeading: '경고',
    historyHeading: '최근 기록',
    historyEmpty: '아직 기록이 없습니다.',
    stepAddNode: '노드 추가',
    stepRemoveNode: '노드 제거',
    stepMoveNode: '노드 이동',
    stepToggleSuppress: '억제 토글',
    errorPrefix: '오류',
  },
  en: {
    panelTitle: 'AI Planner',
    inputPlaceholder: 'e.g., box 50x50x30 with fillet 5',
    send: 'Send',
    apply: 'Apply',
    detecting: 'Detecting intent...',
    generating: 'Generating plan...',
    couldNotUnderstand: 'Could not understand. Please try again.',
    emptyPlanWarning: 'No actionable steps to apply.',
    rationaleHeading: 'Plan summary',
    stepsHeading: 'Steps',
    warningsHeading: 'Warnings',
    historyHeading: 'Recent history',
    historyEmpty: 'No history yet.',
    stepAddNode: 'Add node',
    stepRemoveNode: 'Remove node',
    stepMoveNode: 'Move node',
    stepToggleSuppress: 'Toggle suppress',
    errorPrefix: 'Error',
  },
  ja: {
    panelTitle: 'AIプランナー',
    inputPlaceholder: '例: box 50x50x30 with fillet 5',
    send: '送信',
    apply: '適用',
    detecting: '意図を解析中...',
    generating: 'プラン生成中...',
    couldNotUnderstand: '理解できませんでした。再試行してください。',
    emptyPlanWarning: '適用するステップがありません。',
    rationaleHeading: 'プラン概要',
    stepsHeading: 'ステップ',
    warningsHeading: '警告',
    historyHeading: '最近の履歴',
    historyEmpty: 'まだ履歴がありません。',
    stepAddNode: 'ノード追加',
    stepRemoveNode: 'ノード削除',
    stepMoveNode: 'ノード移動',
    stepToggleSuppress: '抑制切替',
    errorPrefix: 'エラー',
  },
  zh: {
    panelTitle: 'AI规划器',
    inputPlaceholder: '例如: box 50x50x30 with fillet 5',
    send: '发送',
    apply: '应用',
    detecting: '正在识别意图...',
    generating: '正在生成计划...',
    couldNotUnderstand: '无法理解。请重试。',
    emptyPlanWarning: '没有可应用的步骤。',
    rationaleHeading: '计划摘要',
    stepsHeading: '步骤',
    warningsHeading: '警告',
    historyHeading: '最近记录',
    historyEmpty: '暂无记录。',
    stepAddNode: '添加节点',
    stepRemoveNode: '移除节点',
    stepMoveNode: '移动节点',
    stepToggleSuppress: '切换抑制',
    errorPrefix: '错误',
  },
  es: {
    panelTitle: 'Planificador IA',
    inputPlaceholder: 'p. ej., box 50x50x30 with fillet 5',
    send: 'Enviar',
    apply: 'Aplicar',
    detecting: 'Detectando intención...',
    generating: 'Generando plan...',
    couldNotUnderstand: 'No se pudo entender. Vuelva a intentarlo.',
    emptyPlanWarning: 'No hay pasos aplicables.',
    rationaleHeading: 'Resumen del plan',
    stepsHeading: 'Pasos',
    warningsHeading: 'Advertencias',
    historyHeading: 'Historial reciente',
    historyEmpty: 'Sin historial aún.',
    stepAddNode: 'Añadir nodo',
    stepRemoveNode: 'Eliminar nodo',
    stepMoveNode: 'Mover nodo',
    stepToggleSuppress: 'Alternar supresión',
    errorPrefix: 'Error',
  },
  ar: {
    panelTitle: 'مخطط الذكاء الاصطناعي',
    inputPlaceholder: 'مثال: box 50x50x30 with fillet 5',
    send: 'إرسال',
    apply: 'تطبيق',
    detecting: 'جارٍ تحليل النية...',
    generating: 'جارٍ إنشاء الخطة...',
    couldNotUnderstand: 'تعذّر الفهم. يرجى المحاولة مرة أخرى.',
    emptyPlanWarning: 'لا توجد خطوات قابلة للتطبيق.',
    rationaleHeading: 'ملخص الخطة',
    stepsHeading: 'الخطوات',
    warningsHeading: 'تحذيرات',
    historyHeading: 'السجل الأخير',
    historyEmpty: 'لا يوجد سجل بعد.',
    stepAddNode: 'إضافة عقدة',
    stepRemoveNode: 'إزالة عقدة',
    stepMoveNode: 'نقل عقدة',
    stepToggleSuppress: 'تبديل الإخفاء',
    errorPrefix: 'خطأ',
  },
};

const HISTORY_LIMIT = 5;

export interface PlannerHistoryEntry {
  prompt: string;
  intentKind: PlanIntent['kind'];
  stepCount: number;
  warnings: number;
}

export interface FeatureTreePlannerPanelProps {
  lang: PlannerLang;
  currentTree: FeatureTree;
  onApply: (steps: PlanStep[]) => void;
  /** LLM fallback fetcher used when `detectIntent` returns null. */
  llmIntentFetcher?: (text: string) => Promise<PlanIntent | null>;
}

type PanelStatus =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'generating' }
  | { kind: 'plan'; result: PlanResult; intentKind: PlanIntent['kind']; prompt: string }
  | { kind: 'not_understood' }
  | { kind: 'error'; message: string };

function describeStep(step: PlanStep, idx: number, d: Dict): string {
  switch (step.type) {
    case 'add_node': {
      const name = step.node?.name ?? step.node?.id ?? '';
      return `${idx + 1}. ${d.stepAddNode}: ${name}`;
    }
    case 'remove_node':
      return `${idx + 1}. ${d.stepRemoveNode}: ${step.nodeId ?? ''}`;
    case 'move_node':
      return `${idx + 1}. ${d.stepMoveNode}: ${step.nodeId ?? ''} → ${step.toIdx ?? '?'}`;
    case 'toggle_suppress':
      return `${idx + 1}. ${d.stepToggleSuppress}: ${step.nodeId ?? ''}`;
  }
}

export default function FeatureTreePlannerPanel(
  props: FeatureTreePlannerPanelProps,
): React.ReactElement {
  const { lang, currentTree, onApply, llmIntentFetcher } = props;
  const d = dict[lang];

  const [input, setInput] = useState('');
  const [status, setStatus] = useState<PanelStatus>({ kind: 'idle' });
  const [history, setHistory] = useState<PlannerHistoryEntry[]>([]);

  const trimmed = input.trim();
  const sendDisabled =
    trimmed.length === 0 || status.kind === 'detecting' || status.kind === 'generating';

  const handleSend = useCallback(async () => {
    if (!trimmed) return;
    const prompt = trimmed;
    setStatus({ kind: 'detecting' });

    let intent: PlanIntent | null = null;
    try {
      intent = detectIntent(prompt);
    } catch (e) {
      // detectIntent is pure regex, but guard defensively.
      setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (intent === null && llmIntentFetcher) {
      setStatus({ kind: 'generating' });
      try {
        intent = await llmIntentFetcher(prompt);
      } catch (e) {
        setStatus({
          kind: 'error',
          message: e instanceof Error ? e.message : String(e),
        });
        return;
      }
    }

    if (intent === null) {
      setStatus({ kind: 'not_understood' });
      return;
    }

    let plan: PlanResult;
    try {
      plan = planFromIntent(intent, currentTree);
    } catch (e) {
      const msg =
        e instanceof FeatureTreePlannerError || e instanceof Error
          ? e.message
          : String(e);
      setStatus({ kind: 'error', message: msg });
      return;
    }

    setStatus({ kind: 'plan', result: plan, intentKind: intent.kind, prompt });
    setHistory((prev) => {
      const next: PlannerHistoryEntry[] = [
        {
          prompt,
          intentKind: intent.kind,
          stepCount: plan.steps.length,
          warnings: plan.warnings.length,
        },
        ...prev,
      ];
      return next.slice(0, HISTORY_LIMIT);
    });
  }, [trimmed, llmIntentFetcher, currentTree]);

  const handleApply = useCallback(() => {
    if (status.kind !== 'plan') return;
    if (status.result.steps.length === 0) return;
    onApply(status.result.steps);
    setInput('');
    setStatus({ kind: 'idle' });
  }, [status, onApply]);

  const applyDisabled =
    status.kind !== 'plan' || status.result.steps.length === 0;

  const statusText = useMemo(() => {
    switch (status.kind) {
      case 'detecting':
        return d.detecting;
      case 'generating':
        return d.generating;
      case 'not_understood':
        return d.couldNotUnderstand;
      case 'error':
        return `${d.errorPrefix}: ${status.message}`;
      default:
        return '';
    }
  }, [status, d]);

  return (
    <div
      data-testid="planner-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: '#fff',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        minWidth: 280,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14 }}>{d.panelTitle}</div>

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          data-testid="planner-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={d.inputPlaceholder}
          rows={2}
          style={{
            flex: 1,
            padding: 6,
            border: '1px solid #d1d5db',
            borderRadius: 4,
            fontFamily: 'inherit',
            fontSize: 12,
            resize: 'vertical',
          }}
        />
        <button
          type="button"
          data-testid="planner-send"
          onClick={handleSend}
          disabled={sendDisabled}
          style={{
            padding: '6px 12px',
            border: '1px solid #2563eb',
            background: sendDisabled ? '#9ca3af' : '#2563eb',
            color: '#fff',
            borderRadius: 4,
            cursor: sendDisabled ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          {d.send}
        </button>
      </div>

      {statusText !== '' && (
        <div
          data-testid="planner-status"
          style={{
            fontSize: 12,
            color: status.kind === 'error' ? '#dc2626' : '#6b7280',
          }}
        >
          {statusText}
        </div>
      )}

      {status.kind === 'plan' && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 8,
            background: '#f9fafb',
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 11, color: '#6b7280' }}>
            {d.rationaleHeading}
          </div>
          <div data-testid="planner-rationale" style={{ fontSize: 12 }}>
            {status.result.rationale}
          </div>

          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
            {d.stepsHeading}
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {status.result.steps.map((step, idx) => (
              <li
                key={idx}
                data-testid={`planner-step-${idx}`}
                style={{ fontSize: 12, padding: '2px 0' }}
              >
                {describeStep(step, idx, d)}
              </li>
            ))}
          </ol>

          {status.result.steps.length === 0 && (
            <div
              data-testid="planner-empty-warning"
              style={{ fontSize: 12, color: '#b45309' }}
            >
              {d.emptyPlanWarning}
            </div>
          )}

          {status.result.warnings.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                {d.warningsHeading}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {status.result.warnings.map((w, idx) => (
                  <li
                    key={idx}
                    data-testid={`planner-warning-${idx}`}
                    style={{ fontSize: 12, color: '#b45309', padding: '2px 0' }}
                  >
                    {w}
                  </li>
                ))}
              </ul>
            </>
          )}

          <button
            type="button"
            data-testid="planner-apply"
            onClick={handleApply}
            disabled={applyDisabled}
            style={{
              alignSelf: 'flex-start',
              padding: '6px 12px',
              border: '1px solid #059669',
              background: applyDisabled ? '#9ca3af' : '#059669',
              color: '#fff',
              borderRadius: 4,
              cursor: applyDisabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
              marginTop: 4,
            }}
          >
            {d.apply}
          </button>
        </div>
      )}

      <div data-testid="planner-history" style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4 }}>
          {d.historyHeading}
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>{d.historyEmpty}</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {history.map((h, idx) => (
              <li
                key={idx}
                data-testid={`planner-history-item-${idx}`}
                style={{
                  fontSize: 11,
                  padding: '2px 0',
                  borderBottom: idx === history.length - 1 ? 'none' : '1px solid #f3f4f6',
                }}
              >
                <span style={{ fontWeight: 500 }}>{h.prompt}</span>
                <span style={{ color: '#6b7280' }}>
                  {' · '}
                  {h.intentKind} · {h.stepCount} steps
                  {h.warnings > 0 ? ` · ${h.warnings} warn` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
