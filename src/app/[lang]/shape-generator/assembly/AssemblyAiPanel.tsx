'use client';

/**
 * AssemblyAiPanel — Phase 3.AI.Assembly chat surface that exposes the
 * Agent-VVVV assembly-intent pipeline (regex `detectAssemblyIntent` →
 * LLM `/api/assembly-intent` fallback) to end users.
 *
 * Architecture:
 *   - Standalone panel — NOT wired into AssemblyBrowserModal in this
 *     batch (NNNN's inline 2-pattern NL builder lives there). The host
 *     wraps the panel and forwards the resolved AssemblyPlan to whatever
 *     "build assembly from plan" pipeline it owns.
 *
 * Order of intent extraction (mirrors FeatureTreePlannerPanel):
 *   1. `detectAssemblyIntent(text)` — pure regex, zero latency. Wins on
 *      a non-`unparsed` result.
 *   2. `intentFetcher(text)` — caller-injected LLM bridge. Defaults to
 *      `POST /api/assembly-intent` which itself runs the same regex pass
 *      and only invokes the LLM when configured. Returning a plan with
 *      `kind === 'unparsed'` is treated the same as a hard miss so the
 *      user gets the "Could not understand" banner.
 *   3. Both unparsed → "Could not understand" status.
 *
 * Apply behaviour:
 *   - "Apply" is disabled until detection succeeds with a non-unparsed
 *     plan. Click → `onBuildAssembly(plan)` → input cleared → plan
 *     preview cleared → status returns to idle so the user can type the
 *     next prompt without manually wiping the box.
 *
 * Test surface (data-testids — all prefixed `assembly-ai-`):
 *   assembly-ai-panel, assembly-ai-input, assembly-ai-send, assembly-ai-apply,
 *   assembly-ai-status, assembly-ai-preview-summary,
 *   assembly-ai-preview-part-{idx}, assembly-ai-preview-mate-{idx},
 *   assembly-ai-source-badge.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  detectAssemblyIntent,
  type AssemblyPlan,
} from '@/lib/ai/assemblyNlParser';

export type AssemblyAiLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  panelTitle: string;
  inputPlaceholder: string;
  send: string;
  apply: string;
  detecting: string;
  couldNotUnderstand: string;
  partsHeading: string;
  matesHeading: string;
  sourceRegex: string;
  sourceLlm: string;
  errorPrefix: string;
  /** "stacked 3 parts" / "grid 2 x 3" / "ring of 6" / "pair concentric" — summary line. */
  summaryStacked: (count: number, spacing?: number) => string;
  summaryGrid: (rows: number, cols: number, spacing?: number) => string;
  summaryRing: (count: number, radius?: number) => string;
  summaryPair: (mate: string) => string;
  partLabel: (idx: number) => string;
  /** Mate row preview ("concentric: part_0.z_axis ↔ part_1.z_axis"). */
  mateLabel: (kind: string, fromPart: string, toPart: string) => string;
}

const dict: Record<AssemblyAiLang, Dict> = {
  ko: {
    panelTitle: 'AI 어셈블리 빌더',
    inputPlaceholder: '예: 3 stacked plates / 2 x 3 grid / ring of 6',
    send: '전송',
    apply: '적용',
    detecting: '분석 중...',
    couldNotUnderstand: '입력을 이해할 수 없습니다',
    partsHeading: '부품',
    matesHeading: '메이트',
    sourceRegex: '정규식',
    sourceLlm: 'LLM',
    errorPrefix: '오류',
    summaryStacked: (count, spacing) =>
      spacing !== undefined
        ? `${count}개 부품 적층 (간격 ${spacing}mm)`
        : `${count}개 부품 적층`,
    summaryGrid: (rows, cols, spacing) =>
      spacing !== undefined
        ? `${rows} x ${cols} 격자 (간격 ${spacing}mm)`
        : `${rows} x ${cols} 격자`,
    summaryRing: (count, radius) =>
      radius !== undefined
        ? `${count}개 부품 원형 배치 (반경 ${radius}mm)`
        : `${count}개 부품 원형 배치`,
    summaryPair: (mate) => `2개 부품 짝짓기 (${mate})`,
    partLabel: (idx) => `부품 ${idx + 1}`,
    mateLabel: (kind, fromPart, toPart) => `${kind}: ${fromPart} ↔ ${toPart}`,
  },
  en: {
    panelTitle: 'AI Assembly Builder',
    inputPlaceholder: 'e.g., 3 stacked plates / 2 x 3 grid / ring of 6',
    send: 'Send',
    apply: 'Apply',
    detecting: 'Detecting...',
    couldNotUnderstand: 'Could not understand',
    partsHeading: 'Parts',
    matesHeading: 'Mates',
    sourceRegex: 'regex',
    sourceLlm: 'LLM',
    errorPrefix: 'Error',
    summaryStacked: (count, spacing) =>
      spacing !== undefined
        ? `stacked ${count} parts (spacing ${spacing}mm)`
        : `stacked ${count} parts`,
    summaryGrid: (rows, cols, spacing) =>
      spacing !== undefined
        ? `${rows} x ${cols} grid (spacing ${spacing}mm)`
        : `${rows} x ${cols} grid`,
    summaryRing: (count, radius) =>
      radius !== undefined
        ? `ring of ${count} parts (radius ${radius}mm)`
        : `ring of ${count} parts`,
    summaryPair: (mate) => `pair of 2 parts (${mate})`,
    partLabel: (idx) => `Part ${idx + 1}`,
    mateLabel: (kind, fromPart, toPart) => `${kind}: ${fromPart} ↔ ${toPart}`,
  },
  ja: {
    panelTitle: 'AI アセンブリビルダー',
    inputPlaceholder: '例: 3 stacked plates / 2 x 3 grid / ring of 6',
    send: '送信',
    apply: '適用',
    detecting: '解析中...',
    couldNotUnderstand: '入力を理解できません',
    partsHeading: 'パーツ',
    matesHeading: 'メイト',
    sourceRegex: '正規表現',
    sourceLlm: 'LLM',
    errorPrefix: 'エラー',
    summaryStacked: (count, spacing) =>
      spacing !== undefined
        ? `${count} パーツ積層 (間隔 ${spacing}mm)`
        : `${count} パーツ積層`,
    summaryGrid: (rows, cols, spacing) =>
      spacing !== undefined
        ? `${rows} x ${cols} グリッド (間隔 ${spacing}mm)`
        : `${rows} x ${cols} グリッド`,
    summaryRing: (count, radius) =>
      radius !== undefined
        ? `${count} パーツ円形配置 (半径 ${radius}mm)`
        : `${count} パーツ円形配置`,
    summaryPair: (mate) => `2 パーツのペア (${mate})`,
    partLabel: (idx) => `パーツ ${idx + 1}`,
    mateLabel: (kind, fromPart, toPart) => `${kind}: ${fromPart} ↔ ${toPart}`,
  },
  zh: {
    panelTitle: 'AI 装配生成器',
    inputPlaceholder: '例如: 3 stacked plates / 2 x 3 grid / ring of 6',
    send: '发送',
    apply: '应用',
    detecting: '分析中...',
    couldNotUnderstand: '无法理解输入',
    partsHeading: '零件',
    matesHeading: '配合',
    sourceRegex: '正则',
    sourceLlm: 'LLM',
    errorPrefix: '错误',
    summaryStacked: (count, spacing) =>
      spacing !== undefined
        ? `${count} 零件堆叠 (间距 ${spacing}mm)`
        : `${count} 零件堆叠`,
    summaryGrid: (rows, cols, spacing) =>
      spacing !== undefined
        ? `${rows} x ${cols} 网格 (间距 ${spacing}mm)`
        : `${rows} x ${cols} 网格`,
    summaryRing: (count, radius) =>
      radius !== undefined
        ? `${count} 零件环形 (半径 ${radius}mm)`
        : `${count} 零件环形`,
    summaryPair: (mate) => `2 零件配对 (${mate})`,
    partLabel: (idx) => `零件 ${idx + 1}`,
    mateLabel: (kind, fromPart, toPart) => `${kind}: ${fromPart} ↔ ${toPart}`,
  },
  es: {
    panelTitle: 'Constructor de ensamblaje IA',
    inputPlaceholder: 'p. ej., 3 stacked plates / 2 x 3 grid / ring of 6',
    send: 'Enviar',
    apply: 'Aplicar',
    detecting: 'Detectando...',
    couldNotUnderstand: 'No se pudo entender',
    partsHeading: 'Piezas',
    matesHeading: 'Restricciones',
    sourceRegex: 'regex',
    sourceLlm: 'LLM',
    errorPrefix: 'Error',
    summaryStacked: (count, spacing) =>
      spacing !== undefined
        ? `${count} piezas apiladas (espaciado ${spacing}mm)`
        : `${count} piezas apiladas`,
    summaryGrid: (rows, cols, spacing) =>
      spacing !== undefined
        ? `cuadrícula ${rows} x ${cols} (espaciado ${spacing}mm)`
        : `cuadrícula ${rows} x ${cols}`,
    summaryRing: (count, radius) =>
      radius !== undefined
        ? `${count} piezas en anillo (radio ${radius}mm)`
        : `${count} piezas en anillo`,
    summaryPair: (mate) => `par de 2 piezas (${mate})`,
    partLabel: (idx) => `Pieza ${idx + 1}`,
    mateLabel: (kind, fromPart, toPart) => `${kind}: ${fromPart} ↔ ${toPart}`,
  },
  ar: {
    panelTitle: 'منشئ التجميع بالذكاء الاصطناعي',
    inputPlaceholder: 'مثال: 3 stacked plates / 2 x 3 grid / ring of 6',
    send: 'إرسال',
    apply: 'تطبيق',
    detecting: 'جارٍ التحليل...',
    couldNotUnderstand: 'تعذّر فهم المدخل',
    partsHeading: 'الأجزاء',
    matesHeading: 'القيود',
    sourceRegex: 'تعبير نمطي',
    sourceLlm: 'LLM',
    errorPrefix: 'خطأ',
    summaryStacked: (count, spacing) =>
      spacing !== undefined
        ? `${count} أجزاء مكدسة (المسافة ${spacing}مم)`
        : `${count} أجزاء مكدسة`,
    summaryGrid: (rows, cols, spacing) =>
      spacing !== undefined
        ? `شبكة ${rows} x ${cols} (المسافة ${spacing}مم)`
        : `شبكة ${rows} x ${cols}`,
    summaryRing: (count, radius) =>
      radius !== undefined
        ? `${count} أجزاء في حلقة (نصف القطر ${radius}مم)`
        : `${count} أجزاء في حلقة`,
    summaryPair: (mate) => `زوج من جزأين (${mate})`,
    partLabel: (idx) => `جزء ${idx + 1}`,
    mateLabel: (kind, fromPart, toPart) => `${kind}: ${fromPart} ↔ ${toPart}`,
  },
};

/**
 * What the fetcher returns. We re-use `AssemblyPlan` so the panel and the
 * intent route share one type — the route's `unparsed` variant maps to
 * "Could not understand" exactly like the regex path does. The fetcher is
 * also allowed to return `null` (legacy LLM bridges treat ambiguous inputs
 * as null) which the panel coerces into the same "couldn't understand" UX.
 */
export type AssemblyAiIntentFetcher = (text: string) => Promise<AssemblyPlan | null>;

export interface AssemblyAiPanelProps {
  lang: AssemblyAiLang;
  /**
   * Optional LLM fetcher. Defaults to a `POST /api/assembly-intent` bridge
   * that mirrors the route contract — `{ ok, intent, source }` is unpacked
   * to surface the plan + source badge. Tests inject a mock to stay
   * hermetic.
   */
  intentFetcher?: AssemblyAiIntentFetcher;
  /** Click handler for the Apply button. Receives the resolved plan. */
  onBuildAssembly: (plan: AssemblyPlan) => void;
}

/**
 * Internal status machine.
 *   idle           → no input or nothing to show yet.
 *   detecting      → regex+LLM pipeline in flight.
 *   plan           → plan ready, Apply enabled.
 *   not_understood → both passes returned `unparsed`.
 *   error          → fetcher threw — surfaced verbatim under `errorPrefix:`.
 */
type PanelStatus =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'plan'; plan: Exclude<AssemblyPlan, { kind: 'unparsed' }>; source: 'regex' | 'llm' }
  | { kind: 'not_understood' }
  | { kind: 'error'; message: string };

/**
 * Default fetcher → POST /api/assembly-intent. Returns the unwrapped
 * `intent` (which may be `{ kind: 'unparsed' }`) on success, else `null`
 * on a non-OK response (so the panel's "couldn't understand" path fires
 * instead of an opaque error toast).
 */
const defaultIntentFetcher: AssemblyAiIntentFetcher = async (text) => {
  try {
    const res = await fetch('/api/assembly-intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; intent?: AssemblyPlan };
    if (!data.ok) return null;
    return data.intent ?? null;
  } catch {
    return null;
  }
};

/** Number of placeholder part rows we render in the preview. Caps so a
 * runaway "1000 stacked" input doesn't blow up the panel; the actual
 * build still uses the full count from the plan. */
const MAX_PREVIEW_PARTS = 12;
const MAX_PREVIEW_MATES = 12;

/**
 * Build the preview metadata (parts list + mates list) for the resolved
 * plan. Kept as a derivation so the render stays declarative. The mates
 * column is only meaningful for `stacked` and `pair`; `grid` / `ring`
 * have no mates in the Phase 1 IR (the planner adds them downstream).
 */
function buildPreview(
  plan: Exclude<AssemblyPlan, { kind: 'unparsed' }>,
  d: Dict,
): { parts: string[]; mates: string[] } {
  switch (plan.kind) {
    case 'stacked': {
      const partCount = Math.min(plan.count, MAX_PREVIEW_PARTS);
      const parts = Array.from({ length: partCount }, (_, i) => d.partLabel(i));
      const mateCount = Math.min(plan.count - 1, MAX_PREVIEW_MATES);
      const mates: string[] = [];
      for (let i = 0; i < mateCount; i += 1) {
        mates.push(d.mateLabel('concentric', `part_${i}.z_axis`, `part_${i + 1}.z_axis`));
      }
      return { parts, mates };
    }
    case 'grid': {
      const total = plan.rows * plan.cols;
      const partCount = Math.min(total, MAX_PREVIEW_PARTS);
      const parts = Array.from({ length: partCount }, (_, i) => d.partLabel(i));
      return { parts, mates: [] };
    }
    case 'ring': {
      const partCount = Math.min(plan.count, MAX_PREVIEW_PARTS);
      const parts = Array.from({ length: partCount }, (_, i) => d.partLabel(i));
      return { parts, mates: [] };
    }
    case 'pair': {
      const parts = [d.partLabel(0), d.partLabel(1)];
      const mates = [d.mateLabel(plan.mate, 'part_0', 'part_1')];
      return { parts, mates };
    }
  }
}

function summarisePlan(
  plan: Exclude<AssemblyPlan, { kind: 'unparsed' }>,
  d: Dict,
): string {
  switch (plan.kind) {
    case 'stacked':
      return d.summaryStacked(plan.count, plan.spacing);
    case 'grid':
      return d.summaryGrid(plan.rows, plan.cols, plan.spacing);
    case 'ring':
      return d.summaryRing(plan.count, plan.radius);
    case 'pair':
      return d.summaryPair(plan.mate);
  }
}

export default function AssemblyAiPanel(
  props: AssemblyAiPanelProps,
): React.ReactElement {
  const { lang, intentFetcher, onBuildAssembly } = props;
  const d = dict[lang];

  const [input, setInput] = useState('');
  const [status, setStatus] = useState<PanelStatus>({ kind: 'idle' });

  const trimmed = input.trim();
  const sendDisabled = trimmed.length === 0 || status.kind === 'detecting';

  const handleSend = useCallback(async () => {
    if (!trimmed) return;
    setStatus({ kind: 'detecting' });

    // 1. Regex pass — pure, zero-latency. Hits short-circuit before any
    //    network/LLM work happens.
    let regexResult: AssemblyPlan;
    try {
      regexResult = detectAssemblyIntent(trimmed);
    } catch {
      regexResult = { kind: 'unparsed' };
    }
    if (regexResult.kind !== 'unparsed') {
      setStatus({ kind: 'plan', plan: regexResult, source: 'regex' });
      return;
    }

    // 2. LLM fallback. `intentFetcher` is optional but the default routes
    //    through /api/assembly-intent, which itself re-runs the regex pass
    //    server-side (cheap, deterministic) and only invokes the LLM when
    //    an API key is configured.
    const fetcher = intentFetcher ?? defaultIntentFetcher;
    let llmResult: AssemblyPlan | null;
    try {
      llmResult = await fetcher(trimmed);
    } catch (e) {
      setStatus({
        kind: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (llmResult === null || llmResult.kind === 'unparsed') {
      setStatus({ kind: 'not_understood' });
      return;
    }

    setStatus({ kind: 'plan', plan: llmResult, source: 'llm' });
  }, [trimmed, intentFetcher]);

  const handleApply = useCallback(() => {
    if (status.kind !== 'plan') return;
    onBuildAssembly(status.plan);
    // Clear input + preview so the panel is ready for the next prompt.
    setInput('');
    setStatus({ kind: 'idle' });
  }, [status, onBuildAssembly]);

  const statusText = useMemo(() => {
    switch (status.kind) {
      case 'detecting':
        return d.detecting;
      case 'not_understood':
        return d.couldNotUnderstand;
      case 'error':
        return `${d.errorPrefix}: ${status.message}`;
      default:
        return '';
    }
  }, [status, d]);

  const applyDisabled = status.kind !== 'plan';

  const preview = useMemo(() => {
    if (status.kind !== 'plan') return null;
    return {
      summary: summarisePlan(status.plan, d),
      ...buildPreview(status.plan, d),
    };
  }, [status, d]);

  return (
    <div
      data-testid="assembly-ai-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        border: '1px solid var(--nx-border)',
        borderRadius: 8,
        background: 'var(--nx-panel)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        minWidth: 280,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14 }}>{d.panelTitle}</div>

      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          data-testid="assembly-ai-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={d.inputPlaceholder}
          rows={2}
          style={{
            flex: 1,
            padding: 6,
            border: '1px solid var(--nx-border)',
            borderRadius: 4,
            fontFamily: 'inherit',
            fontSize: 12,
            resize: 'vertical',
          }}
        />
        <button
          type="button"
          data-testid="assembly-ai-send"
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
          data-testid="assembly-ai-status"
          style={{
            fontSize: 12,
            color:
              status.kind === 'error' || status.kind === 'not_understood'
                ? '#dc2626'
                : 'var(--nx-text-2)',
          }}
        >
          {statusText}
        </div>
      )}

      {status.kind === 'plan' && preview !== null && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            padding: 8,
            background: 'var(--nx-panel-2)',
            borderRadius: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              data-testid="assembly-ai-preview-summary"
              style={{ fontSize: 13, fontWeight: 500 }}
            >
              {preview.summary}
            </span>
            <span
              data-testid="assembly-ai-source-badge"
              style={{
                fontSize: 10,
                color: 'var(--nx-text-2)',
                padding: '1px 6px',
                border: '1px solid var(--nx-border)',
                borderRadius: 9999,
              }}
            >
              {status.source === 'regex' ? d.sourceRegex : d.sourceLlm}
            </span>
          </div>

          {preview.parts.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 2 }}>
                {d.partsHeading}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {preview.parts.map((p, idx) => (
                  <li
                    key={idx}
                    data-testid={`assembly-ai-preview-part-${idx}`}
                    style={{ fontSize: 12, padding: '2px 0' }}
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.mates.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginBottom: 2 }}>
                {d.matesHeading}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {preview.mates.map((m, idx) => (
                  <li
                    key={idx}
                    data-testid={`assembly-ai-preview-mate-${idx}`}
                    style={{ fontSize: 12, padding: '2px 0' }}
                  >
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            type="button"
            data-testid="assembly-ai-apply"
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
    </div>
  );
}
