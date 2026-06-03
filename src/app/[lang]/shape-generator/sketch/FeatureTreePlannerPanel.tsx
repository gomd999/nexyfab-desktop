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
 *     a localStorage-backed history (Agent-IIIII `useChatHistory`) and
 *     clear the input.
 *
 * Order of intent extraction:
 *   1. `detectIntent(text)` — pure regex, zero latency. Wins if non-null.
 *   2. `llmIntentFetcher?.(text)` — caller-provided LLM bridge. Only
 *      invoked when (1) fails AND the prop is wired. Async, may also
 *      return null (LLM punts on unparseable input).
 *   3. Both null → "Could not understand" status.
 *
 * History policy (Phase 3.AI.UI persist integration):
 *   - Backed by `useChatHistory` (localStorage, 50-entry cap, 500 ms
 *     debounced auto-save). Survives reload, tab close, key swap.
 *   - Each successful detect (regex OR LLM) records a `ChatHistoryEntry`
 *     of shape `{ prompt, source, intentKind, stepCount, warnings }`.
 *     `source` distinguishes regex vs llm so the user can see which path
 *     resolved each prompt.
 *   - Failed detections are NOT recorded — history is signal, not noise.
 *   - The `entryId` returned by `add()` is captured on the current plan
 *     status so a later Apply click can stamp `appliedAt` on the exact
 *     entry (no fragile id-by-prompt-string lookup).
 *
 * Apply behavior:
 *   - Disabled while no plan is loaded, while a plan has zero steps
 *     (warnings still shown), or while detection is in flight.
 *   - On click: `onApply(steps)` → input cleared → plan preview cleared
 *     → history retained, target entry stamped with `appliedAt`.
 *
 * History UI footer:
 *   - "Clear" wipes memory + localStorage in one call (`clear()`).
 *   - "Export" downloads the full envelope JSON as a blob via the
 *     standard <a download> trick. No network, no clipboard surprises.
 *   - Count badge `N / 50` reflects current vs cap.
 *   - Applied entries get a ✓ marker with the `appliedAt` ISO timestamp
 *     as tooltip (no extra row — keeps the list compact).
 *
 * Test surface (data-testids — all prefixed planner-):
 *   planner-panel,
 *   planner-input, planner-send, planner-apply,
 *   planner-status, planner-rationale, planner-warning-{idx},
 *   planner-step-{idx},
 *   planner-history, planner-history-item-{idx},
 *   planner-history-clear, planner-history-export,
 *   planner-history-count, planner-history-applied-{idx}.
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
import {
  useChatHistory,
  type ChatHistorySaveError,
} from '@/lib/ai/aiChatHistory';
import {
  explainFeatureTree,
  type ScadExplanation,
  type ExplainerLang,
} from '@/lib/ai/scadIntentFromTree';
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
  historyClear: string;
  historyExport: string;
  historyAppliedTooltipPrefix: string;
  stepAddNode: string;
  stepRemoveNode: string;
  stepMoveNode: string;
  stepToggleSuppress: string;
  errorPrefix: string;
  explainTree: string;
  designIntent: string;
  featuresHeading: string;
  scadComments: string;
  copyToClipboard: string;
  copied: string;
  showScadComments: string;
  hideScadComments: string;
  explainEmpty: string;
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
    historyClear: '지우기',
    historyExport: '내보내기',
    historyAppliedTooltipPrefix: '적용됨',
    stepAddNode: '노드 추가',
    stepRemoveNode: '노드 제거',
    stepMoveNode: '노드 이동',
    stepToggleSuppress: '억제 토글',
    errorPrefix: '오류',
    explainTree: '트리 설명',
    designIntent: '설계 의도',
    featuresHeading: '피처',
    scadComments: 'SCAD 주석',
    copyToClipboard: 'SCAD 복사',
    copied: '복사됨',
    showScadComments: 'SCAD 주석 보기',
    hideScadComments: 'SCAD 주석 숨기기',
    explainEmpty: '설명할 피처가 없습니다.',
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
    historyClear: 'Clear',
    historyExport: 'Export',
    historyAppliedTooltipPrefix: 'Applied',
    stepAddNode: 'Add node',
    stepRemoveNode: 'Remove node',
    stepMoveNode: 'Move node',
    stepToggleSuppress: 'Toggle suppress',
    errorPrefix: 'Error',
    explainTree: 'Explain tree',
    designIntent: 'Design intent',
    featuresHeading: 'Features',
    scadComments: 'SCAD comments',
    copyToClipboard: 'Copy SCAD',
    copied: 'Copied',
    showScadComments: 'Show SCAD comments',
    hideScadComments: 'Hide SCAD comments',
    explainEmpty: 'No features to explain.',
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
    historyClear: 'クリア',
    historyExport: 'エクスポート',
    historyAppliedTooltipPrefix: '適用済み',
    stepAddNode: 'ノード追加',
    stepRemoveNode: 'ノード削除',
    stepMoveNode: 'ノード移動',
    stepToggleSuppress: '抑制切替',
    errorPrefix: 'エラー',
    explainTree: 'ツリーを説明',
    designIntent: '設計意図',
    featuresHeading: 'フィーチャ',
    scadComments: 'SCADコメント',
    copyToClipboard: 'SCADコピー',
    copied: 'コピー済み',
    showScadComments: 'SCADコメント表示',
    hideScadComments: 'SCADコメント非表示',
    explainEmpty: '説明できるフィーチャがありません。',
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
    historyClear: '清除',
    historyExport: '导出',
    historyAppliedTooltipPrefix: '已应用',
    stepAddNode: '添加节点',
    stepRemoveNode: '移除节点',
    stepMoveNode: '移动节点',
    stepToggleSuppress: '切换抑制',
    errorPrefix: '错误',
    explainTree: '解释树',
    designIntent: '设计意图',
    featuresHeading: '特征',
    scadComments: 'SCAD注释',
    copyToClipboard: '复制SCAD',
    copied: '已复制',
    showScadComments: '显示SCAD注释',
    hideScadComments: '隐藏SCAD注释',
    explainEmpty: '没有可解释的特征。',
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
    historyClear: 'Limpiar',
    historyExport: 'Exportar',
    historyAppliedTooltipPrefix: 'Aplicado',
    stepAddNode: 'Añadir nodo',
    stepRemoveNode: 'Eliminar nodo',
    stepMoveNode: 'Mover nodo',
    stepToggleSuppress: 'Alternar supresión',
    errorPrefix: 'Error',
    explainTree: 'Explicar árbol',
    designIntent: 'Intención de diseño',
    featuresHeading: 'Características',
    scadComments: 'Comentarios SCAD',
    copyToClipboard: 'Copiar SCAD',
    copied: 'Copiado',
    showScadComments: 'Mostrar comentarios SCAD',
    hideScadComments: 'Ocultar comentarios SCAD',
    explainEmpty: 'No hay características para explicar.',
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
    historyClear: 'مسح',
    historyExport: 'تصدير',
    historyAppliedTooltipPrefix: 'مُطبَّق',
    stepAddNode: 'إضافة عقدة',
    stepRemoveNode: 'إزالة عقدة',
    stepMoveNode: 'نقل عقدة',
    stepToggleSuppress: 'تبديل الإخفاء',
    errorPrefix: 'خطأ',
    explainTree: 'شرح الشجرة',
    designIntent: 'نية التصميم',
    featuresHeading: 'الميزات',
    scadComments: 'تعليقات SCAD',
    copyToClipboard: 'نسخ SCAD',
    copied: 'تم النسخ',
    showScadComments: 'إظهار تعليقات SCAD',
    hideScadComments: 'إخفاء تعليقات SCAD',
    explainEmpty: 'لا توجد ميزات للشرح.',
  },
};

/**
 * History cap surfaced to the hook. 50 ≈ a normal week of CAD-NL prompts
 * for a heavy user; ~20 KB worst-case in localStorage. Caller-overridable
 * via the `maxHistoryEntries` prop for power-user surfaces.
 */
const DEFAULT_MAX_HISTORY_ENTRIES = 50;

export interface FeatureTreePlannerPanelProps {
  lang: PlannerLang;
  currentTree: FeatureTree;
  onApply: (steps: PlanStep[]) => void;
  /** LLM fallback fetcher used when `detectIntent` returns null. */
  llmIntentFetcher?: (text: string) => Promise<PlanIntent | null>;
  /**
   * Optional localStorage key override. When omitted the hook uses
   * `DEFAULT_STORAGE_KEY` ('nexyfab:ai-chat-history') so existing
   * call sites keep working without changes.
   */
  storageKey?: string;
  /** Optional history cap override. Defaults to 50. */
  maxHistoryEntries?: number;
  /**
   * Surfaces persistence failures (quota exceeded, no_storage, unknown).
   * The host can wire this to a toast — the panel does not render
   * persistence errors inline to keep the UI focused on the plan.
   */
  onHistoryError?: (error: ChatHistorySaveError, message: string) => void;
}

type PanelStatus =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'generating' }
  | {
      kind: 'plan';
      result: PlanResult;
      intentKind: PlanIntent['kind'];
      prompt: string;
      /** Id of the history entry created for this prompt — used by Apply
       *  to stamp `appliedAt` on the exact entry without prompt-string lookup. */
      entryId: string;
    }
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
  const {
    lang,
    currentTree,
    onApply,
    llmIntentFetcher,
    storageKey,
    maxHistoryEntries,
    onHistoryError,
  } = props;
  const d = dict[lang];

  const [input, setInput] = useState('');
  const [status, setStatus] = useState<PanelStatus>({ kind: 'idle' });

  // Explain state — populated when user clicks "Explain tree". Reset to null
  // when the host swaps `currentTree` (caller may force re-explain).
  const [explanation, setExplanation] = useState<ScadExplanation | null>(null);
  const [scadCommentsExpanded, setScadCommentsExpanded] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // Agent-IIIII chat history hook — localStorage-backed, 50-entry cap by
  // default, 500 ms debounced auto-save. The hook handles all eviction
  // logic; we just call add() / markApplied() / clear() / exportJson().
  const {
    history,
    add: addHistoryEntry,
    markApplied: markHistoryApplied,
    clear: clearHistory,
    exportJson: exportHistoryJson,
  } = useChatHistory({
    storageKey,
    maxEntries: maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES,
    onError: onHistoryError,
  });

  const trimmed = input.trim();
  const sendDisabled =
    trimmed.length === 0 || status.kind === 'detecting' || status.kind === 'generating';

  const handleSend = useCallback(async () => {
    if (!trimmed) return;
    const prompt = trimmed;
    setStatus({ kind: 'detecting' });

    let intent: PlanIntent | null = null;
    let source: 'regex' | 'llm' = 'regex';
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
        source = 'llm';
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

    // Record the entry first so its id can be stashed on the plan status
    // for the future Apply click. `warnings` is omitted when empty so the
    // persisted envelope stays small (the schema treats undefined as 0).
    const entryId = addHistoryEntry({
      prompt,
      source,
      intentKind: intent.kind,
      stepCount: plan.steps.length,
      ...(plan.warnings.length > 0 ? { warnings: [...plan.warnings] } : {}),
    });

    setStatus({
      kind: 'plan',
      result: plan,
      intentKind: intent.kind,
      prompt,
      entryId,
    });
  }, [trimmed, llmIntentFetcher, currentTree, addHistoryEntry]);

  const handleApply = useCallback(() => {
    if (status.kind !== 'plan') return;
    if (status.result.steps.length === 0) return;
    onApply(status.result.steps);
    markHistoryApplied(status.entryId);
    setInput('');
    setStatus({ kind: 'idle' });
  }, [status, onApply, markHistoryApplied]);

  const handleClearHistory = useCallback(() => {
    clearHistory();
  }, [clearHistory]);

  const handleExportHistory = useCallback(() => {
    // Best-effort browser download. SSR / non-browser environments
    // (no document) gracefully no-op — the hook's exportJson is still
    // available to programmatic callers if needed.
    if (typeof document === 'undefined') return;
    const json = exportHistoryJson();
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nexyfab-ai-chat-history-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Defer revoke a tick so Safari has time to start the download.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch {
      // Browser refused (e.g., URL/Blob unavailable). Silent — the user
      // can retry; we don't want a thrown error to break the panel.
    }
  }, [exportHistoryJson]);

  /**
   * Map the panel's 6-lang surface to the explainer's 2-lang surface. Only
   * Korean is its own bucket; everything else falls through to English. This
   * is intentional — adding ja/zh/es/ar to the explainer dictionary is a
   * future phase (see scadIntentFromTree.ts "Out of scope"). Keeps the UI
   * localized while the long-form narration stays in English for non-ko.
   */
  const explainerLang: ExplainerLang = lang === 'ko' ? 'ko' : 'en';

  const handleExplain = useCallback(() => {
    const next = explainFeatureTree(currentTree, { lang: explainerLang });
    setExplanation(next);
    setScadCommentsExpanded(false);
    setCopyState('idle');
  }, [currentTree, explainerLang]);

  const handleCopyScad = useCallback(async () => {
    if (!explanation) return;
    const text = explanation.scadComments;
    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(text);
        setCopyState('copied');
        // Auto-revert the "Copied" label after a short beat so the user can
        // copy twice in a row and still see feedback.
        setTimeout(() => setCopyState('idle'), 1500);
      }
    } catch {
      // Browser blocked clipboard (e.g., insecure context). Silent — the
      // user can fall back to selecting the visible SCAD block manually.
    }
  }, [explanation]);

  const maxCap = maxHistoryEntries ?? DEFAULT_MAX_HISTORY_ENTRIES;

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

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          data-testid="planner-explain-button"
          onClick={handleExplain}
          style={{
            padding: '4px 10px',
            border: '1px solid #6366f1',
            background: '#eef2ff',
            color: '#4338ca',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          {d.explainTree}
        </button>
      </div>

      {explanation && (
        <div
          data-testid="planner-explain-panel"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 8,
            background: '#f5f3ff',
            border: '1px solid #e0e7ff',
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 11, color: '#6b7280' }}>{d.designIntent}</div>
          <div
            data-testid="planner-explain-design-intent"
            style={{ fontSize: 12, lineHeight: 1.45 }}
          >
            {explanation.designIntent}
          </div>

          {explanation.features.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                {d.featuresHeading}
              </div>
              <ul
                data-testid="planner-explain-features"
                style={{ margin: 0, padding: 0, listStyle: 'none' }}
              >
                {explanation.features.map((f, idx) => (
                  <li
                    key={f.nodeId}
                    data-testid={`planner-explain-feature-${idx}`}
                    style={{
                      fontSize: 12,
                      padding: '2px 0',
                      borderBottom:
                        idx === explanation.features.length - 1
                          ? 'none'
                          : '1px solid #ede9fe',
                    }}
                  >
                    <span style={{ color: '#6b7280' }}>[{f.kind}]</span>{' '}
                    {f.intentDescription}
                  </li>
                ))}
              </ul>
            </>
          )}

          {explanation.warnings.length > 0 && (
            <div
              data-testid="planner-explain-warnings"
              role="alert"
              style={{
                marginTop: 4,
                padding: 6,
                background: '#fffbeb',
                border: '1px solid #fcd34d',
                borderRadius: 4,
                color: '#92400e',
                fontSize: 12,
              }}
            >
              <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                {explanation.warnings.map((w, idx) => (
                  <li
                    key={idx}
                    data-testid={`planner-explain-warning-${idx}`}
                  >
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {explanation.features.length === 0 &&
            explanation.warnings.length === 0 && (
              <div
                data-testid="planner-explain-empty"
                style={{ fontSize: 12, color: '#6b7280' }}
              >
                {d.explainEmpty}
              </div>
            )}

          {explanation.scadComments !== '' && (
            <div style={{ marginTop: 4 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                }}
              >
                <button
                  type="button"
                  data-testid="planner-explain-toggle-scad"
                  onClick={() => setScadCommentsExpanded((v) => !v)}
                  aria-expanded={scadCommentsExpanded}
                  style={{
                    padding: '3px 8px',
                    border: '1px solid #d1d5db',
                    background: '#fff',
                    color: '#374151',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  {scadCommentsExpanded
                    ? d.hideScadComments
                    : d.showScadComments}
                </button>
                <button
                  type="button"
                  data-testid="planner-explain-copy-scad"
                  onClick={handleCopyScad}
                  style={{
                    padding: '3px 8px',
                    border: '1px solid #059669',
                    background: copyState === 'copied' ? '#d1fae5' : '#fff',
                    color: '#059669',
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  {copyState === 'copied' ? d.copied : d.copyToClipboard}
                </button>
              </div>
              {scadCommentsExpanded && (
                <pre
                  data-testid="planner-explain-scad-comments"
                  style={{
                    marginTop: 6,
                    padding: 8,
                    background: '#1f2937',
                    color: '#e5e7eb',
                    borderRadius: 4,
                    fontSize: 11,
                    fontFamily:
                      'ui-monospace, SFMono-Regular, Menlo, monospace',
                    whiteSpace: 'pre-wrap',
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {explanation.scadComments}
                </pre>
              )}
            </div>
          )}
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
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 4,
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11, color: '#6b7280' }}>
            {d.historyHeading}
          </span>
          <span
            data-testid="planner-history-count"
            style={{
              fontSize: 10,
              color: '#9ca3af',
              padding: '1px 6px',
              border: '1px solid #e5e7eb',
              borderRadius: 9999,
            }}
          >
            {history.length} / {maxCap}
          </span>
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 12, color: '#9ca3af' }}>{d.historyEmpty}</div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {history.map((h, idx) => {
              const warningCount = h.warnings?.length ?? 0;
              const stepCount = h.stepCount ?? 0;
              const intentLabel = h.intentKind ?? h.source;
              const applied = typeof h.appliedAt === 'number';
              return (
                <li
                  key={h.id}
                  data-testid={`planner-history-item-${idx}`}
                  style={{
                    fontSize: 11,
                    padding: '2px 0',
                    borderBottom:
                      idx === history.length - 1 ? 'none' : '1px solid #f3f4f6',
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 4,
                  }}
                >
                  {applied && (
                    <span
                      data-testid={`planner-history-applied-${idx}`}
                      title={`${d.historyAppliedTooltipPrefix}: ${new Date(
                        h.appliedAt as number,
                      ).toISOString()}`}
                      aria-label={d.historyAppliedTooltipPrefix}
                      style={{ color: '#059669', fontWeight: 700 }}
                    >
                      {'✓'}
                    </span>
                  )}
                  <span style={{ fontWeight: 500 }}>{h.prompt}</span>
                  <span style={{ color: '#6b7280' }}>
                    {' · '}
                    {intentLabel} · {stepCount} steps
                    {warningCount > 0 ? ` · ${warningCount} warn` : ''}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div
          style={{
            display: 'flex',
            gap: 6,
            marginTop: 6,
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            data-testid="planner-history-export"
            onClick={handleExportHistory}
            disabled={history.length === 0}
            style={{
              padding: '3px 8px',
              border: '1px solid #d1d5db',
              background: history.length === 0 ? '#f3f4f6' : '#fff',
              color: history.length === 0 ? '#9ca3af' : '#374151',
              borderRadius: 4,
              fontSize: 11,
              cursor: history.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {d.historyExport}
          </button>
          <button
            type="button"
            data-testid="planner-history-clear"
            onClick={handleClearHistory}
            disabled={history.length === 0}
            style={{
              padding: '3px 8px',
              border: '1px solid #d1d5db',
              background: history.length === 0 ? '#f3f4f6' : '#fff',
              color: history.length === 0 ? '#9ca3af' : '#b91c1c',
              borderRadius: 4,
              fontSize: 11,
              cursor: history.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {d.historyClear}
          </button>
        </div>
      </div>
    </div>
  );
}
