'use client';

/**
 * SketchConstraintAiPanel — Phase A standalone NL surface for *sketch-level*
 * constraint commands. Sibling of FeatureTreePlannerPanel (which works at
 * the feature-tree level).
 *
 * Architecture:
 *   - Standalone panel. Renders an input + Send → preview → Apply pipeline.
 *   - User types free-form NL (e.g. "make all lines horizontal").
 *   - `detectSketchConstraintIntent` (pure regex, zero latency) resolves
 *     the prompt to a SketchConstraintIntent. Null → "could not understand".
 *   - On Apply, calls `onApplyConstraints(intent)` so the host editor can
 *     route to the right `SketchSolver.add*` method (and substitute
 *     SELECTED_PLACEHOLDER ids with the editor's current selection).
 *   - Integration (panel ↔ editor) is intentionally deferred to the next
 *     batch — this PR keeps the panel completely standalone (no solver,
 *     no store, no editor refs).
 *
 * Why no LLM fallback in Phase A?
 *   - The sketch-constraint vocabulary is tiny (6 kinds) and the trigger
 *     keywords (horizontal/vertical/parallel/perpendicular/distance/
 *     coincident/merge) are unambiguous. An LLM hop would add latency
 *     with little upside. Phase B can add an `llmIntentFetcher` prop
 *     mirroring FeatureTreePlannerPanel.
 *
 * Preview policy:
 *   - For `make_horizontal` / `make_vertical` we show "Apply N
 *     horizontal/vertical constraints" if a known count is supplied via
 *     the `selectionCounts` prop, else a generic "Apply horizontal
 *     constraint to all lines" string.
 *   - For selection-bound intents we show the action ("Make selected
 *     lines parallel") without numeric counts.
 *   - For fix_distance we surface the captured value ("Fix distance to 50").
 *
 * Test surface (data-testids — all prefixed sketch-ai-):
 *   sketch-ai-panel,
 *   sketch-ai-input, sketch-ai-send, sketch-ai-apply,
 *   sketch-ai-status, sketch-ai-preview.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  detectSketchConstraintIntent,
  type SketchConstraintIntent,
} from '@/lib/ai/sketchConstraintIntent';

export type SketchAiLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  panelTitle: string;
  inputPlaceholder: string;
  send: string;
  apply: string;
  couldNotUnderstand: string;
  previewHeading: string;
  // Intent-specific preview strings (parametrized).
  previewHorizontalAll: string;
  previewHorizontalN: (n: number) => string;
  previewVerticalAll: string;
  previewVerticalN: (n: number) => string;
  previewParallel: string;
  previewPerpendicular: string;
  previewFixDistance: (d: number) => string;
  previewCoincident: string;
}

const dict: Record<SketchAiLang, Dict> = {
  ko: {
    panelTitle: '스케치 제약 AI',
    inputPlaceholder: '예: 모든 선을 수평으로',
    send: '전송',
    apply: '적용',
    couldNotUnderstand: '이해하지 못했습니다. 다시 시도해주세요.',
    previewHeading: '미리보기',
    previewHorizontalAll: '모든 선에 수평 제약 적용',
    previewHorizontalN: (n) => `${n}개의 수평 제약 적용`,
    previewVerticalAll: '모든 선에 수직 제약 적용',
    previewVerticalN: (n) => `${n}개의 수직 제약 적용`,
    previewParallel: '선택한 두 선을 평행으로',
    previewPerpendicular: '선택한 두 선을 수직으로',
    previewFixDistance: (d) => `거리를 ${d}(으)로 고정`,
    previewCoincident: '선택한 점들을 일치시킴',
  },
  en: {
    panelTitle: 'Sketch Constraint AI',
    inputPlaceholder: 'e.g., make all lines horizontal',
    send: 'Send',
    apply: 'Apply',
    couldNotUnderstand: 'Could not understand. Please try again.',
    previewHeading: 'Preview',
    previewHorizontalAll: 'Apply horizontal constraint to all lines',
    previewHorizontalN: (n) => `Apply ${n} horizontal constraints`,
    previewVerticalAll: 'Apply vertical constraint to all lines',
    previewVerticalN: (n) => `Apply ${n} vertical constraints`,
    previewParallel: 'Make selected lines parallel',
    previewPerpendicular: 'Make selected lines perpendicular',
    previewFixDistance: (d) => `Fix distance to ${d}`,
    previewCoincident: 'Make selected points coincident',
  },
  ja: {
    panelTitle: 'スケッチ拘束 AI',
    inputPlaceholder: '例: すべての線を水平に',
    send: '送信',
    apply: '適用',
    couldNotUnderstand: '理解できませんでした。再試行してください。',
    previewHeading: 'プレビュー',
    previewHorizontalAll: 'すべての線に水平拘束を適用',
    previewHorizontalN: (n) => `${n}個の水平拘束を適用`,
    previewVerticalAll: 'すべての線に垂直拘束を適用',
    previewVerticalN: (n) => `${n}個の垂直拘束を適用`,
    previewParallel: '選択した線を平行に',
    previewPerpendicular: '選択した線を直角に',
    previewFixDistance: (d) => `距離を${d}に固定`,
    previewCoincident: '選択した点を一致させる',
  },
  zh: {
    panelTitle: '草图约束 AI',
    inputPlaceholder: '例如: 让所有线水平',
    send: '发送',
    apply: '应用',
    couldNotUnderstand: '无法理解。请重试。',
    previewHeading: '预览',
    previewHorizontalAll: '对所有线应用水平约束',
    previewHorizontalN: (n) => `应用 ${n} 个水平约束`,
    previewVerticalAll: '对所有线应用垂直约束',
    previewVerticalN: (n) => `应用 ${n} 个垂直约束`,
    previewParallel: '让所选两条线平行',
    previewPerpendicular: '让所选两条线垂直',
    previewFixDistance: (d) => `将距离固定为 ${d}`,
    previewCoincident: '让所选点重合',
  },
  es: {
    panelTitle: 'IA de restricciones de croquis',
    inputPlaceholder: 'p. ej., haga todas las líneas horizontales',
    send: 'Enviar',
    apply: 'Aplicar',
    couldNotUnderstand: 'No se pudo entender. Vuelva a intentarlo.',
    previewHeading: 'Vista previa',
    previewHorizontalAll: 'Aplicar restricción horizontal a todas las líneas',
    previewHorizontalN: (n) => `Aplicar ${n} restricciones horizontales`,
    previewVerticalAll: 'Aplicar restricción vertical a todas las líneas',
    previewVerticalN: (n) => `Aplicar ${n} restricciones verticales`,
    previewParallel: 'Hacer paralelas las líneas seleccionadas',
    previewPerpendicular: 'Hacer perpendiculares las líneas seleccionadas',
    previewFixDistance: (d) => `Fijar distancia a ${d}`,
    previewCoincident: 'Hacer coincidir los puntos seleccionados',
  },
  ar: {
    panelTitle: 'ذكاء قيود الرسم',
    inputPlaceholder: 'مثال: اجعل كل الخطوط أفقية',
    send: 'إرسال',
    apply: 'تطبيق',
    couldNotUnderstand: 'تعذّر الفهم. يرجى المحاولة مرة أخرى.',
    previewHeading: 'معاينة',
    previewHorizontalAll: 'تطبيق قيد أفقي على جميع الخطوط',
    previewHorizontalN: (n) => `تطبيق ${n} قيود أفقية`,
    previewVerticalAll: 'تطبيق قيد رأسي على جميع الخطوط',
    previewVerticalN: (n) => `تطبيق ${n} قيود رأسية`,
    previewParallel: 'اجعل الخطوط المختارة متوازية',
    previewPerpendicular: 'اجعل الخطوط المختارة متعامدة',
    previewFixDistance: (d) => `تثبيت المسافة إلى ${d}`,
    previewCoincident: 'اجعل النقاط المختارة متطابقة',
  },
};

export interface SketchConstraintAiPanelProps {
  lang: SketchAiLang;
  /** Called when the user clicks Apply with a successfully detected intent. */
  onApplyConstraints: (intent: SketchConstraintIntent) => void;
  /**
   * Optional counts surfaced in the preview text. Currently only `lines`
   * is consumed (for make_horizontal / make_vertical "Apply N constraints"
   * messaging). Future intents can add more keys without an API break.
   */
  selectionCounts?: {
    lines?: number;
  };
}

type PanelStatus =
  | { kind: 'idle' }
  | { kind: 'intent'; intent: SketchConstraintIntent; prompt: string }
  | { kind: 'not_understood' };

function previewFor(
  intent: SketchConstraintIntent,
  d: Dict,
  counts: SketchConstraintAiPanelProps['selectionCounts'],
): string {
  switch (intent.kind) {
    case 'make_horizontal': {
      const n = counts?.lines;
      return typeof n === 'number' && n > 0
        ? d.previewHorizontalN(n)
        : d.previewHorizontalAll;
    }
    case 'make_vertical': {
      const n = counts?.lines;
      return typeof n === 'number' && n > 0
        ? d.previewVerticalN(n)
        : d.previewVerticalAll;
    }
    case 'make_parallel':
      return d.previewParallel;
    case 'make_perpendicular':
      return d.previewPerpendicular;
    case 'fix_distance':
      return d.previewFixDistance(intent.distance);
    case 'coincident_points':
      return d.previewCoincident;
  }
}

export default function SketchConstraintAiPanel(
  props: SketchConstraintAiPanelProps,
): React.ReactElement {
  const { lang, onApplyConstraints, selectionCounts } = props;
  const d = dict[lang];

  const [input, setInput] = useState('');
  const [status, setStatus] = useState<PanelStatus>({ kind: 'idle' });

  const trimmed = input.trim();
  const sendDisabled = trimmed.length === 0;

  const handleSend = useCallback(() => {
    if (!trimmed) return;
    const intent = detectSketchConstraintIntent(trimmed);
    if (intent === null) {
      setStatus({ kind: 'not_understood' });
      return;
    }
    setStatus({ kind: 'intent', intent, prompt: trimmed });
  }, [trimmed]);

  const handleApply = useCallback(() => {
    if (status.kind !== 'intent') return;
    onApplyConstraints(status.intent);
    setInput('');
    setStatus({ kind: 'idle' });
  }, [status, onApplyConstraints]);

  const applyDisabled = status.kind !== 'intent';

  const previewText = useMemo(() => {
    if (status.kind !== 'intent') return '';
    return previewFor(status.intent, d, selectionCounts);
  }, [status, d, selectionCounts]);

  const statusText = useMemo(() => {
    if (status.kind === 'not_understood') return d.couldNotUnderstand;
    return '';
  }, [status, d]);

  return (
    <div
      data-testid="sketch-ai-panel"
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
          data-testid="sketch-ai-input"
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
          data-testid="sketch-ai-send"
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
          data-testid="sketch-ai-status"
          style={{ fontSize: 12, color: '#dc2626' }}
        >
          {statusText}
        </div>
      )}

      {status.kind === 'intent' && (
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
            {d.previewHeading}
          </div>
          <div data-testid="sketch-ai-preview" style={{ fontSize: 12 }}>
            {previewText}
          </div>

          <button
            type="button"
            data-testid="sketch-ai-apply"
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
