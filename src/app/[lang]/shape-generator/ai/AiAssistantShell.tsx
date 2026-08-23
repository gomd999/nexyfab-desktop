'use client';

/**
 * AiAssistantShell.tsx
 *
 * Single orchestrator that wires the AI surfaces (Phase-2 Week 2-3)
 * into ShapeGeneratorInner:
 *
 *   - FloatingAiPrompt — viewport-overlay quick prompt
 *   - useVoiceInput — Web Speech API mic
 *   - featureEditDispatcher — natural-language → feature tree
 *   - editOriginTracker — AI vs human origin tagging
 *
 * Parent passes the feature-store handles + AI brain (the LLM call
 * that turns a user prompt into a list of FeatureEditIntent). Shell
 * owns dispatch + origin tracking + voice transcript piping.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import FloatingAiPrompt from './FloatingAiPrompt';
import {
  dispatchFeatureEditBatchAtomic,
  type FeatureEditIntent,
  type FeatureStoreApi,
} from './featureEditDispatcher';
import { EditOriginTracker, nextBatchId } from './editOriginTracker';
import { useVoiceInput } from './useVoiceInput';
import type { SelectionContext } from '@/lib/ai/selectionContext';
import { selectionRequiresConfirmation } from '@/lib/ai/selectionContext';
import { updateGenerationSessionForEdit } from './generationSessionClient';
import { useManualEditProtectionLocks } from './manualEditProtectionStore';
import {
  createAiCanonicalCandidate,
  guardAiCanonicalCandidate,
  markAiCanonicalCandidateApplied,
  type AiCanonicalCandidate,
} from '@/lib/ai/aiCanonicalCandidate';
import type { GuidedRequirementGate } from '@/lib/ai/guidedDesignBrief';
import { GUIDED_LOCAL_MECHANICAL_PLAN } from './guidedLocalMechanicalPlan';
import { interpretCadRequest } from '@/lib/ai/cadInterpretationContract';
import { loc } from '@/lib/i18n/loc';
import { langDir } from '@/lib/i18n/normalize';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

export interface AiAssistantShellProps {
  lang: string;
  /** Bridge to the feature store. */
  store: FeatureStoreApi;
  /** Turn a natural-language prompt into a list of feature edit intents.
   *  Caller wires this to the existing intent-parser pipeline. */
  promptToIntents: (prompt: string) => Promise<{
    intents: FeatureEditIntent[];
    explanation: string;
    baseRevision?: string;
    selectionContext?: SelectionContext;
  }>;
  /** Current content revision, re-read after planning to reject stale edits. */
  getCurrentRevision?: () => string;
  /** Product UI may replace the default browser confirmation dialog. */
  confirmPlan?: (summary: string) => boolean | Promise<boolean>;
  /** Full model snapshot hooks make a multi-action AI edit atomic and undoable. */
  captureEditSnapshot?: () => unknown;
  restoreEditSnapshot?: (snapshot: unknown) => void | Promise<void>;
  /** Optional callback when origin tracker records a new AI batch. */
  onAiBatch?: (batchId: string, intentCount: number) => void;
  /** Optional: open the full chat sidebar. */
  onOpenFullChat?: () => void;
  /** Project/lineage scope prevents locks from one design affecting another. */
  protectionScope?: string;
  /** When true (a mesh has been imported), route prompts to onScadEdit — the
   *  SCAD path that edits the import — instead of parametric feature intents. */
  scadEditActive?: boolean;
  onScadEdit?: (prompt: string) => Promise<boolean | void>;
  /** Exact external object governed by the SCAD edit transaction. */
  externalEditScope?: { id: string; label: string };
  /** Fallback executor for a new product that has no catalog template. */
  onGenericPlan?: (prompt: string) => Promise<boolean | void>;
  /** Optional: build a model from an attached photo (vision → SCAD → mesh). */
  onImageGenerate?: (prompt: string, image: string) => Promise<string | null>;
  /** Disable when WASM not ready or user is in a modal flow. */
  disabled?: boolean;
}

interface LocalGuidedUndoTransaction {
  candidateId: string;
  baseRevision: string;
  appliedRevision: string | null;
  snapshotReady: boolean;
  snapshot: unknown;
}

interface PendingPlanReview {
  id: string;
  summary: string;
  baseRevision: string;
  mode: 'new_design' | 'request_only_edit';
  changedTargets: string[];
  executionTool: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function localGuidedIntents(payload: Record<string, unknown>): FeatureEditIntent[] | null {
  if (payload.planner !== GUIDED_LOCAL_MECHANICAL_PLAN || payload.aiModelExecution !== 'NOT_RUN' || payload.units !== 'mm') return null;
  if (!Array.isArray(payload.intents) || payload.intents.length !== 1) return null;
  const intent = object(payload.intents[0]);
  const params = object(intent?.params);
  if (!intent || intent.kind !== 'set_base_shape' || intent.shapeId !== 'lBracket' || !params) return null;
  const keys = ['width', 'height', 'depth', 'thickness'] as const;
  if (keys.some(key => typeof params[key] !== 'number' || !Number.isFinite(params[key]) || Number(params[key]) <= 0)) return null;
  if (Number(params.thickness) >= Math.min(Number(params.width), Number(params.height))) return null;
  const requirements = object(payload.authoritativeRequirements);
  if (!requirements || ['functional_requirements', 'critical_dimensions', 'material_process'].some(key => {
    const item = object(requirements[key]);
    return !item || item.value === undefined || typeof item.sourceRef !== 'string' || !item.sourceRef.trim();
  })) return null;
  return payload.intents as FeatureEditIntent[];
}

function sameCandidate(left: AiCanonicalCandidate, right: AiCanonicalCandidate): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export default function AiAssistantShell({
  lang, store, promptToIntents, onAiBatch, onOpenFullChat, disabled,
  scadEditActive, onScadEdit, externalEditScope, onGenericPlan, onImageGenerate, getCurrentRevision, confirmPlan,
  captureEditSnapshot, restoreEditSnapshot, protectionScope,
}: AiAssistantShellProps) {
  const L = createCommercialLocalizer(lang);
  const trackerRef = useRef<EditOriginTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = new EditOriginTracker();

  const [voiceTranscript, setVoiceTranscript] = useState<string>('');
  const [undoAiEdit, setUndoAiEdit] = useState<(() => Promise<void>) | null>(null);
  const [pendingPlanReview, setPendingPlanReview] = useState<PendingPlanReview | null>(null);
  const pendingPlanReviewRef = useRef<{ request: PendingPlanReview; resolve: (accepted: boolean) => void } | null>(null);
  const reviewCancelRef = useRef<HTMLButtonElement | null>(null);
  const reviewDialogRef = useRef<HTMLDivElement | null>(null);
  const reviewPreviouslyFocusedRef = useRef<HTMLElement | null>(null);
  const protectedManualEdits = useManualEditProtectionLocks(protectionScope ?? 'local-workspace');
  const reviewedLocalCandidatesRef = useRef(new Map<string, AiCanonicalCandidate>());
  const localGuidedUndoRef = useRef<LocalGuidedUndoTransaction | null>(null);
  const liveRevision = getCurrentRevision?.() ?? '';
  const rtl = langDir(lang) === 'rtl';
  const reviewCopy = planReviewCopy(lang);

  const requestInAppPlanReview = useCallback((request: Omit<PendingPlanReview, 'id'>): Promise<boolean> => {
    // A review without a known revision cannot be safely applied. This is
    // deliberately fail-closed instead of silently treating a missing
    // revision as an approval.
    if (!request.baseRevision || !getCurrentRevision || getCurrentRevision() !== request.baseRevision) return Promise.resolve(false);
    return new Promise(resolve => {
      pendingPlanReviewRef.current?.resolve(false);
      const pending = { id: `ai-review-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...request };
      pendingPlanReviewRef.current = { request: pending, resolve };
      setPendingPlanReview(pending);
    });
  }, [getCurrentRevision]);

  const settlePlanReview = useCallback((accepted: boolean) => {
    const pending = pendingPlanReviewRef.current;
    if (!pending) return;
    const current = getCurrentRevision?.() ?? '';
    const revisionMatches = Boolean(current && current === pending.request.baseRevision);
    pendingPlanReviewRef.current = null;
    setPendingPlanReview(null);
    pending.resolve(accepted && revisionMatches);
  }, [getCurrentRevision]);

  useEffect(() => {
    if (!pendingPlanReview) return;
    reviewPreviouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Destructive confirmation starts on Cancel. Keep keyboard focus inside
    // the modal until it settles, then restore the invoking control.
    reviewCancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settlePlanReview(false);
      } else if (event.key === 'Tab') {
        const focusable = Array.from(reviewDialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? []).filter(element => element.getAttribute('aria-hidden') !== 'true');
        const first = focusable[0];
        const last = focusable.at(-1);
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const previous = reviewPreviouslyFocusedRef.current;
      if (previous?.isConnected) previous.focus();
      reviewPreviouslyFocusedRef.current = null;
    };
  }, [pendingPlanReview, settlePlanReview]);

  useEffect(() => () => {
    // Do not leave a prompt awaiting approval if the shell unmounts.
    pendingPlanReviewRef.current?.resolve(false);
    pendingPlanReviewRef.current = null;
  }, []);

  useEffect(() => {
    const transaction = localGuidedUndoRef.current;
    if (transaction && !transaction.appliedRevision && liveRevision && liveRevision !== transaction.baseRevision) {
      transaction.appliedRevision = liveRevision;
    }
  }, [liveRevision]);

  const runExternalAgentMutation = useCallback(async (input: {
    prompt: string;
    execute: (prompt: string) => Promise<boolean | void>;
    mode: 'new_design' | 'request_only_edit';
    scope?: { id: string; label: string };
    executionTool: string;
  }): Promise<string> => {
    if (protectedManualEdits.length > 0) {
      return loc(lang, {
        ko: `사용자가 잠근 값 ${protectedManualEdits.length}개를 보존하기 위해 AI 편집을 차단했습니다.`,
        en: `The AI edit was blocked to preserve ${protectedManualEdits.length} user-locked value(s).`,
        ja: `ユーザーがロックした値 ${protectedManualEdits.length} 件を保持するため、AI 編集をブロックしました。`,
        zh: `为保留用户锁定的 ${protectedManualEdits.length} 个值，已阻止 AI 编辑。`,
        es: `Se bloqueó la edición por IA para conservar ${protectedManualEdits.length} valor(es) bloqueado(s) por el usuario.`,
        ar: `تم حظر تعديل الذكاء الاصطناعي للحفاظ على ${protectedManualEdits.length} من القيم المقفلة بواسطة المستخدم.`,
      });
    }
    const baseRevision = getCurrentRevision?.() ?? '';
    if (!baseRevision || !captureEditSnapshot || !restoreEditSnapshot) {
      return loc(lang, {
        ko: '리비전과 원자적 스냅샷을 확인할 수 없어 AI 변경을 적용하지 않았습니다.',
        en: 'The AI change was not applied because a revision-bound atomic snapshot is unavailable.',
        ja: 'リビジョンに紐づくアトミックスナップショットを利用できないため、AI 変更は適用されませんでした。',
        zh: '由于缺少绑定修订版的原子快照，未应用 AI 更改。',
        es: 'No se aplicó el cambio de IA porque no hay una instantánea atómica vinculada a la revisión.',
        ar: 'لم يُطبَّق تغيير الذكاء الاصطناعي لعدم توفر لقطة ذرية مرتبطة بالمراجعة.',
      });
    }
    if (input.mode === 'request_only_edit' && !input.scope?.id.trim()) {
      return loc(lang, {
        ko: '수정할 정확한 모델 범위를 선택한 뒤 다시 요청해 주세요.', en: 'Select the exact model scope to edit, then retry.',
        ja: '編集する正確なモデル範囲を選択してから再試行してください。', zh: '请选择要修改的准确模型范围，然后重试。',
        es: 'Seleccione el alcance exacto del modelo que desea editar y vuelva a intentarlo.', ar: 'حدّد نطاق النموذج الدقيق المراد تعديله ثم أعد المحاولة.',
      });
    }
    const interpretation = interpretCadRequest({
      message: input.prompt,
      selectedPartInstanceId: input.scope?.id,
      existingDesign: input.mode === 'request_only_edit',
    });
    const interpreted = interpretation.candidates[0];
    const reviewable = interpretation.candidates.length === 1
      && interpreted?.intent !== 'clarification'
      && interpreted?.ambiguities.every(issue => issue === 'recovered_typo_or_noncanonical_term' || issue === 'unknown_product_or_vocabulary');
    if ((interpretation.intent === 'request_only_edit' && !interpreted?.scope)
      || (interpretation.requiresConfirmation && !reviewable)) {
      return interpretation.confirmationPrompt ?? loc(lang, {
        ko: '요청 의미와 수정 범위를 더 구체적으로 알려주세요.', en: 'Please clarify the intended operation and edit scope.',
        ja: '意図する操作と編集範囲を具体的にしてください。', zh: '请明确预期操作和编辑范围。',
        es: 'Aclare la operación prevista y el alcance de edición.', ar: 'يرجى توضيح العملية المقصودة ونطاق التعديل.',
      });
    }
    const meaning = interpretation.requiresConfirmation && interpretation.confirmationPrompt
      ? `${interpretation.confirmationPrompt}\n\n`
      : '';
    const summary = `${meaning}${loc(lang, {
      ko: input.mode === 'request_only_edit' ? `${input.scope!.label}만 요청 내용대로 수정합니다.` : '템플릿 없이 일반 파라메트릭 Planner로 새 설계를 생성합니다.',
      en: input.mode === 'request_only_edit' ? `Only ${input.scope!.label} will be changed as requested.` : 'A new design will be generated with the generic parametric planner.',
      ja: input.mode === 'request_only_edit' ? `${input.scope!.label} のみを依頼内容どおりに変更します。` : '汎用パラメトリック Planner で新しい設計を生成します。',
      zh: input.mode === 'request_only_edit' ? `仅按请求修改 ${input.scope!.label}。` : '将使用通用参数化 Planner 生成新设计。',
      es: input.mode === 'request_only_edit' ? `Solo se modificará ${input.scope!.label} según lo solicitado.` : 'Se generará un diseño nuevo con el Planner paramétrico genérico.',
      ar: input.mode === 'request_only_edit' ? `سيتم تعديل ${input.scope!.label} فقط حسب الطلب.` : 'سيتم إنشاء تصميم جديد باستخدام المخطط البارامتري العام.',
    })}`;
    const accepted = confirmPlan
      ? await confirmPlan(summary)
      : await requestInAppPlanReview({
        summary,
        baseRevision,
        mode: input.mode,
        changedTargets: [input.scope?.label ?? 'new parametric design'],
        executionTool: input.executionTool,
      });
    if (!accepted) return loc(lang, {
      ko: '변경을 적용하지 않았습니다.', en: 'The edit was not applied.', ja: '変更は適用されませんでした。',
      zh: '未应用更改。', es: 'No se aplicó el cambio.', ar: 'لم يتم تطبيق التغيير.',
    });
    if (getCurrentRevision?.() !== baseRevision) {
      return loc(lang, {
        ko: '검토 중 모델이 변경되어 적용을 중단했습니다.', en: 'The model changed during review, so Apply was stopped.',
        ja: 'レビュー中にモデルが変更されたため、適用を中止しました。', zh: '审核期间模型已更改，因此停止应用。',
        es: 'El modelo cambió durante la revisión, por lo que se detuvo la aplicación.', ar: 'تغيّر النموذج أثناء المراجعة، لذلك تم إيقاف التطبيق.',
      });
    }
    const snapshot = captureEditSnapshot();
    try {
      const outcome = await input.execute(input.prompt);
      if (outcome === false) throw new Error('external_agent_execution_failed');
      const appliedRevision = getCurrentRevision?.() ?? '';
      if (!appliedRevision || appliedRevision === baseRevision) throw new Error('external_agent_revision_not_advanced');
      setUndoAiEdit(() => async () => {
        await restoreEditSnapshot(snapshot);
        setUndoAiEdit(null);
      });
      return loc(lang, {
        ko: '적용했습니다. 3D 미리보기와 변경 범위를 확인하세요.', en: 'Applied. Review the 3D preview and changed scope.',
        ja: '適用しました。3D プレビューと変更範囲を確認してください。', zh: '已应用。请检查 3D 预览和更改范围。',
        es: 'Aplicado. Revise la vista previa 3D y el alcance modificado.', ar: 'تم التطبيق. راجع المعاينة ثلاثية الأبعاد ونطاق التغيير.',
      });
    } catch (error) {
      await restoreEditSnapshot(snapshot);
      const detail = error instanceof Error ? error.message : String(error);
      return loc(lang, {
        ko: `AI 변경에 실패해 이전 상태를 복구했습니다: ${detail}`, en: `The AI change failed and the previous state was restored: ${detail}`,
        ja: `AI 変更に失敗したため以前の状態を復元しました: ${detail}`, zh: `AI 更改失败，已恢复先前状态：${detail}`,
        es: `El cambio de IA falló y se restauró el estado anterior: ${detail}`, ar: `فشل تغيير الذكاء الاصطناعي وتمت استعادة الحالة السابقة: ${detail}`,
      });
    }
  }, [captureEditSnapshot, confirmPlan, getCurrentRevision, lang, protectedManualEdits, requestInAppPlanReview, restoreEditSnapshot]);

  // Voice input — pipes transcripts into the prompt input via a
  // controlled flow. Caller can subscribe to the latest transcript
  // by reading `voiceTranscript` from a parent if needed.
  const voice = useVoiceInput({
    lang,
    onFinal: (text) => {
      setVoiceTranscript(text);
      // Also auto-submit when voice ends.
      void runPrompt(text);
    },
  });

  const runPrompt = useCallback(async (prompt: string): Promise<string | null> => {
    if (disabled) return 'AI is currently unavailable.';
    // Imported mesh: no feature tree to edit — hand off to the SCAD path which
    // wraps import("model.stl") and edits it through OpenSCAD.
    if (scadEditActive && onScadEdit) {
      return runExternalAgentMutation({
        prompt,
        execute: onScadEdit,
        mode: externalEditScope ? 'request_only_edit' : 'new_design',
        scope: externalEditScope,
        executionTool: externalEditScope ? 'Scoped OpenSCAD mesh edit (atomic)' : 'Governed domain planner (atomic)',
      });
    }
    // If the user is mid-sketch, commit it first so the AI edits a consistent
    // feature tree (prevents the sketch↔tree desync / orphaned-node corruption
    // when manual sketching and AI run against the same state). No-op if not in
    // sketch mode. This makes the manual→AI→manual workflow safe.
    try { window.dispatchEvent(new CustomEvent('nexyfab:tool', { detail: { id: 'sketch.finish' } })); } catch { /* ok */ }
    try {
      const { intents, explanation, baseRevision, selectionContext } = await promptToIntents(prompt);
      const interpretation = interpretCadRequest({
        message: prompt,
        selectedFeatureId: selectionContext?.featureId,
        selectedPartInstanceId: selectionContext?.partInstanceId,
        existingDesign: store.features.length > 0,
      });
      const interpreted = interpretation.candidates[0];
      if (intents.length === 0) {
        if (interpreted?.plannerPath === 'generic-parametric' && onGenericPlan) {
          return runExternalAgentMutation({
            prompt,
            execute: onGenericPlan,
            mode: 'new_design',
            executionTool: 'Generic parametric product planner (atomic)',
          });
        }
        return interpretation.confirmationPrompt || explanation || 'Please clarify the intended CAD operation.';
      }
      const confirmableAmbiguities = new Set(['recovered_typo_or_noncanonical_term', 'unknown_product_or_vocabulary']);
      const canConfirmInPlanReview = interpretation.candidates.length === 1
        && interpreted?.intent !== 'clarification'
        && interpreted?.ambiguities.every(issue => confirmableAmbiguities.has(issue));
      if ((interpretation.intent === 'request_only_edit' && !interpreted?.scope)
        || (interpretation.requiresConfirmation && !canConfirmInPlanReview)) {
        return interpretation.confirmationPrompt ?? 'Please clarify the intended CAD operation and select its exact target.';
      }
      const currentRevision = getCurrentRevision?.();
      if (baseRevision && currentRevision && baseRevision !== currentRevision) {
        return L('모델이 AI 분석 이후 변경되어 적용을 중단했습니다. 현재 상태에서 다시 요청해 주세요.', 'The model changed after AI planning, so the edit was not applied. Please retry on the current state.');
      }
      if (selectionContext && currentRevision && selectionContext.projectRevision !== currentRevision) {
        return loc(lang, {
          ko: '선택 대상이 현재 모델 리비전과 일치하지 않아 적용을 중단했습니다.',
          en: 'Apply was stopped because the selected target is not bound to the current model revision.',
          ja: '選択対象が現在のモデルリビジョンに紐付いていないため、適用を中止しました。',
          zh: '所选目标未绑定到当前模型修订版，因此已停止应用。',
          es: 'Se detuvo la aplicación porque el objetivo seleccionado no está vinculado a la revisión actual del modelo.',
          ar: 'تم إيقاف التطبيق لأن الهدف المحدد غير مرتبط بمراجعة النموذج الحالية.',
        });
      }
      if (!currentRevision) {
        return L('현재 모델 리비전을 확인할 수 없어 AI 변경 후보를 만들지 않았습니다.', 'The current model revision is unavailable, so no AI change candidate was created.');
      }
      if (!captureEditSnapshot || !restoreEditSnapshot) {
        return loc(lang, {
          ko: '원자적 스냅샷을 사용할 수 없어 AI 변경을 적용하지 않았습니다.',
          en: 'The AI edit was not applied because an atomic snapshot is unavailable.',
          ja: 'アトミックスナップショットを利用できないため、AI変更は適用されませんでした。',
          zh: '由于原子快照不可用，未应用 AI 更改。',
          es: 'El cambio de IA no se aplicó porque no hay una instantánea atómica disponible.',
          ar: 'لم يُطبَّق تعديل الذكاء الاصطناعي لأن اللقطة الذرية غير متاحة.',
        });
      }
      const candidate = createAiCanonicalCandidate({
        id: `feature-batch-${Date.now()}`,
        kind: 'feature_batch',
        baseRevision: currentRevision,
        summary: explanation || `${intents.length} AI feature action(s)`,
        payload: { intents: structuredClone(intents) },
        locks: protectedManualEdits,
        scope: interpretation.intent === 'request_only_edit'
          ? {
            mode: 'request_only_edit',
            ...(interpreted?.scope?.kind === 'feature' ? { featureId: interpreted.scope.target } : {}),
            ...(interpreted?.scope?.kind === 'part' ? { partInstanceId: interpreted.scope.target } : {}),
          }
          : { mode: 'new_design' },
      });
      if (candidate.state !== 'PREVIEW') {
        return `${explanation}\n\n${L('AI 변경 후보가 차단되었습니다', 'AI change candidate was blocked')}: ${[...candidate.issues, ...candidate.blockedLockIds].join(', ')}`;
      }
      const uncertainTarget = selectionContext ? selectionRequiresConfirmation(selectionContext) : false;
      // Every AI mutation has an explicit plan-review boundary. The atomic
      // snapshot below remains the single-step undo boundary after approval.
      if (intents.length > 0) {
        const meaning = interpretation.requiresConfirmation ? `${interpretation.confirmationPrompt}\n\n` : '';
        const summary = meaning + formatPlanConfirmation(intents, uncertainTarget, lang, store);
        const accepted = confirmPlan
          ? await confirmPlan(summary)
          : await requestInAppPlanReview({
            summary,
            baseRevision: candidate.baseRevision,
            mode: candidate.scope?.mode ?? 'new_design',
            changedTargets: candidate.changedTargets.map(target => `${target.kind}:${target.objectId}${target.field ? `.${target.field}` : ''}`),
            executionTool: candidate.scope?.mode === 'request_only_edit' ? 'Scoped featureEditDispatcher (atomic)' : 'FeatureEditDispatcher (atomic)',
          });
        if (!accepted) return L('변경을 적용하지 않았습니다.', 'The edit was not applied.');
      }
      const applyGuard = guardAiCanonicalCandidate(candidate, getCurrentRevision?.() ?? '', protectedManualEdits);
      if (!applyGuard.allowed) {
        return L(`적용 직전 리비전 또는 잠금이 변경되어 중단했습니다: ${[...applyGuard.issues, ...applyGuard.blockedLockIds].join(', ')}`, `Apply was stopped because the revision or locks changed: ${[...applyGuard.issues, ...applyGuard.blockedLockIds].join(', ')}`);
      }
      const batchId = nextBatchId();
      const atomic = await dispatchFeatureEditBatchAtomic(
        intents, store, captureEditSnapshot, restoreEditSnapshot,
        { locks: protectedManualEdits },
      );
      const results = atomic.results;
      if (!atomic.committed) {
        return `${explanation}\n\n${L('변경 도중 오류가 발생해 전체 상태를 자동 복구했습니다.', 'An edit failed, so the complete model state was restored.')}${atomic.errorReason ? `\n${atomic.errorReason}` : ''}`;
      }
      setUndoAiEdit(() => async () => {
        await restoreEditSnapshot(atomic.snapshot);
        setUndoAiEdit(null);
      });
      // Record each applied action in the origin tracker.
      for (let i = 0; i < intents.length; i++) {
        const intent = intents[i]!;
        const r = results[i];
        if (!r || !r.applied) continue;
        const action = intentToAction(intent, store);
        if (action) {
          trackerRef.current?.record('ai', action, batchId);
        }
      }
      onAiBatch?.(batchId, intents.length);
      const applied = results.filter(r => r.applied).length;
      const failed = results.filter(r => !r.applied);
      let generationStateWarning = '';
      const appliedIntents = intents.filter((_, index) => results[index]?.applied);
      if (appliedIntents.length > 0) {
        try { await updateGenerationSessionForEdit(appliedIntents, selectionContext); }
        catch (error) { generationStateWarning = `\n⚠️ Generation verification state was not updated: ${error instanceof Error ? error.message : String(error)}`; }
      }
      let reply = `${explanation}\n\nApplied ${applied}/${intents.length} action(s).`;
      // Surface WHICH actions failed and WHY, instead of a silent partial apply.
      if (failed.length > 0) {
        reply += '\n' + failed
          .map(r => `⚠️ ${r.summary || 'action'}${r.errorReason ? ` — ${r.errorReason}` : ''}`)
          .join('\n');
      }
      reply += generationStateWarning;
      return reply;
    } catch (err) {
      return `AI error: ${(err as Error)?.message ?? err}`;
    }
  }, [disabled, promptToIntents, store, onAiBatch, scadEditActive, onScadEdit, externalEditScope, onGenericPlan, runExternalAgentMutation, getCurrentRevision, confirmPlan, requestInAppPlanReview, lang, captureEditSnapshot, restoreEditSnapshot, protectedManualEdits]);

  // The docked Nexy AI panel normally uses the richer streaming endpoint.
  // Keep deterministic parametric edits available when that service is
  // offline by bridging the panel to this same parser-first, atomic edit path.
  // A request id prevents multiple mounted workspaces consuming each other's
  // response.
  useEffect(() => {
    const onLocalPrompt = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string; prompt?: string }>).detail;
      if (!detail?.requestId || !detail.prompt?.trim()) return;
      void runPrompt(detail.prompt).then((message) => {
        window.dispatchEvent(new CustomEvent('nexyfab:local-ai-response', {
          detail: {
            requestId: detail.requestId,
            ok: message !== null && !message.startsWith('AI error:'),
            message: message ?? (L('적용할 변경을 찾지 못했습니다.', 'No applicable change was found.')),
          },
        }));
      }).catch((error: unknown) => {
        window.dispatchEvent(new CustomEvent('nexyfab:local-ai-response', {
          detail: {
            requestId: detail.requestId,
            ok: false,
            message: error instanceof Error ? error.message : String(error),
          },
        }));
      });
    };
    window.addEventListener('nexyfab:run-local-ai-prompt', onLocalPrompt);
    return () => window.removeEventListener('nexyfab:run-local-ai-prompt', onLocalPrompt);
  }, [lang, runPrompt]);

  // The docked guided flow plans locally, but still uses the canonical
  // candidate contract. Review is inert; Apply is atomic; Undo is accepted
  // only while the exact revision created by that Apply is still current.
  useEffect(() => {
    const respond = (name: string, detail: Record<string, unknown>) => {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    };
    const onReview = (event: Event) => {
      const detail = (event as CustomEvent<{
        requestId?: string;
        candidateId?: string;
        payload?: Record<string, unknown>;
        summary?: string;
        requirementGate?: GuidedRequirementGate;
      }>).detail;
      if (!detail?.requestId || !detail.candidateId || !detail.payload || !detail.requirementGate) return;
      const intents = localGuidedIntents(detail.payload);
      const revision = getCurrentRevision?.() ?? '';
      if (!intents || !revision) {
        respond('nexyfab:guided-local-candidate-reviewed', {
          requestId: detail.requestId,
          ok: false,
          error: !intents ? 'invalid_local_guided_plan' : 'workspace_revision_not_available',
        });
        return;
      }
      const candidate = createAiCanonicalCandidate({
        id: detail.candidateId,
        kind: 'feature_batch',
        baseRevision: revision,
        summary: detail.summary?.trim() || 'Local deterministic mechanical plan',
        payload: detail.payload,
        locks: protectedManualEdits,
        requirementGate: detail.requirementGate,
      });
      reviewedLocalCandidatesRef.current.set(candidate.id, structuredClone(candidate));
      respond('nexyfab:guided-local-candidate-reviewed', {
        requestId: detail.requestId,
        ok: candidate.state === 'PREVIEW',
        candidate,
        ...(candidate.state === 'BLOCKED' ? { error: candidate.issues.join(', ') } : {}),
      });
    };
    const onApply = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string; candidate?: AiCanonicalCandidate }>).detail;
      if (!detail?.requestId || !detail.candidate) return;
      void (async () => {
        const reviewed = reviewedLocalCandidatesRef.current.get(detail.candidate!.id);
        const candidateUnchanged = Boolean(reviewed && sameCandidate(reviewed, detail.candidate!));
        const intents = localGuidedIntents(detail.candidate!.payload);
        const guard = guardAiCanonicalCandidate(detail.candidate!, getCurrentRevision?.() ?? '', protectedManualEdits);
        if (!candidateUnchanged || !intents || !guard.allowed) {
          respond('nexyfab:guided-local-candidate-apply-result', {
            requestId: detail.requestId!,
            ok: false,
            candidate: detail.candidate!,
            error: [
              ...(!candidateUnchanged ? ['candidate_changed_after_review'] : []),
              ...(!intents ? ['invalid_local_guided_plan'] : []),
              ...guard.issues,
              ...guard.blockedLockIds,
            ].join(', '),
          });
          return;
        }
        if (!captureEditSnapshot || !restoreEditSnapshot) {
          respond('nexyfab:guided-local-candidate-apply-result', {
            requestId: detail.requestId!, ok: false, candidate: detail.candidate!, error: 'atomic_snapshot_unavailable',
          });
          return;
        }
        // Register the transaction before dispatch. The model store can render
        // synchronously while the atomic helper is still resolving; creating
        // this ref after dispatch would miss the only render that exposes the
        // applied revision and leave a valid Undo permanently unavailable.
        localGuidedUndoRef.current = {
          candidateId: detail.candidate!.id,
          baseRevision: detail.candidate!.baseRevision,
          appliedRevision: null,
          snapshotReady: false,
          snapshot: undefined,
        };
        const atomic = await dispatchFeatureEditBatchAtomic(
          intents,
          store,
          captureEditSnapshot,
          restoreEditSnapshot,
          { locks: protectedManualEdits },
        );
        if (!atomic.committed) {
          if (localGuidedUndoRef.current?.candidateId === detail.candidate!.id) localGuidedUndoRef.current = null;
          respond('nexyfab:guided-local-candidate-apply-result', {
            requestId: detail.requestId!, ok: false, candidate: detail.candidate!, error: atomic.errorReason ?? 'local_guided_apply_failed',
          });
          return;
        }
        const applied = markAiCanonicalCandidateApplied(detail.candidate!);
        const transaction = localGuidedUndoRef.current;
        if (!transaction || transaction.candidateId !== applied.id) {
          await restoreEditSnapshot(atomic.snapshot);
          respond('nexyfab:guided-local-candidate-apply-result', {
            requestId: detail.requestId!, ok: false, candidate: detail.candidate!, error: 'local_guided_revision_binding_lost',
          });
          return;
        }
        transaction.snapshot = atomic.snapshot;
        transaction.snapshotReady = true;
        reviewedLocalCandidatesRef.current.delete(applied.id);
        respond('nexyfab:guided-local-candidate-apply-result', {
          requestId: detail.requestId!, ok: true, candidate: applied, undoAvailable: true,
        });
      })().catch(error => {
        if (localGuidedUndoRef.current?.candidateId === detail.candidate?.id) localGuidedUndoRef.current = null;
        respond('nexyfab:guided-local-candidate-apply-result', {
          requestId: detail.requestId!, ok: false, candidate: detail.candidate!, error: error instanceof Error ? error.message : String(error),
        });
      });
    };
    const onUndo = (event: Event) => {
      const detail = (event as CustomEvent<{ requestId?: string; candidateId?: string; currentRevision?: string }>).detail;
      if (!detail?.requestId || !detail.candidateId) return;
      void (async () => {
        const transaction = localGuidedUndoRef.current;
        const currentRevision = getCurrentRevision?.() ?? '';
        if (!transaction || transaction.candidateId !== detail.candidateId || !transaction.snapshotReady || !transaction.appliedRevision
          || detail.currentRevision !== transaction.appliedRevision || currentRevision !== transaction.appliedRevision
          || !restoreEditSnapshot) {
          respond('nexyfab:guided-local-candidate-undo-result', {
            requestId: detail.requestId!, ok: false, error: 'stale_or_unavailable_local_guided_undo',
          });
          return;
        }
        await restoreEditSnapshot(transaction.snapshot);
        localGuidedUndoRef.current = null;
        respond('nexyfab:guided-local-candidate-undo-result', {
          requestId: detail.requestId!, ok: true, restoredRevision: transaction.baseRevision,
        });
      })().catch(error => {
        respond('nexyfab:guided-local-candidate-undo-result', {
          requestId: detail.requestId!, ok: false, error: error instanceof Error ? error.message : String(error),
        });
      });
    };
    window.addEventListener('nexyfab:review-guided-local-candidate', onReview);
    window.addEventListener('nexyfab:apply-guided-local-candidate', onApply);
    window.addEventListener('nexyfab:undo-guided-local-candidate', onUndo);
    return () => {
      window.removeEventListener('nexyfab:review-guided-local-candidate', onReview);
      window.removeEventListener('nexyfab:apply-guided-local-candidate', onApply);
      window.removeEventListener('nexyfab:undo-guided-local-candidate', onUndo);
    };
  }, [captureEditSnapshot, getCurrentRevision, protectedManualEdits, restoreEditSnapshot, store]);

  // Cleanup voice on unmount.
  useEffect(() => {
    return () => { voice.stop(); };
  }, [voice]);

  // Expose tracker via window for debugging (dev only).
  useEffect(() => {
    if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
      (window as unknown as { __nexyfabAiTracker?: EditOriginTracker }).__nexyfabAiTracker
        = trackerRef.current!;
    }
  }, []);

  void voiceTranscript; // available for future surfacing
  return (
    <>
      <FloatingAiPrompt
        lang={lang}
        onSubmit={runPrompt}
        onImageGenerate={onImageGenerate}
        onOpenFullChat={onOpenFullChat}
        disabled={disabled}
        onUndo={undoAiEdit ?? undefined}
      />
      {pendingPlanReview && (
        <div
          ref={reviewDialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-plan-review-title"
          aria-describedby="ai-plan-review-summary"
          data-testid="ai-plan-review"
          dir={rtl ? 'rtl' : 'ltr'}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200, display: 'grid', placeItems: 'center',
            padding: 16, background: 'rgba(0, 0, 0, 0.52)',
          }}
        >
          <section style={{ width: 'min(560px, 100%)', maxHeight: 'min(680px, 90vh)', overflow: 'auto', padding: 18, borderRadius: 12, background: 'var(--nx-panel, #171923)', color: 'var(--nx-text, #fff)', border: '1px solid var(--nx-border, #3b4050)', boxShadow: '0 18px 50px rgba(0,0,0,.45)' }}>
            <h2 id="ai-plan-review-title" style={{ margin: '0 0 10px', fontSize: 16 }}>{reviewCopy.title}</h2>
            <p id="ai-plan-review-summary" style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5, fontSize: 13 }}>{pendingPlanReview.summary}</p>
            <p role="status" style={{ margin: '12px 0 0', fontSize: 11, color: 'var(--nx-text-2, #aeb4c2)' }}>
              {reviewCopy.revision}: {pendingPlanReview.baseRevision}
            </p>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '5px 10px', margin: '12px 0 0', fontSize: 11 }}>
              <dt style={{ color: 'var(--nx-text-2, #aeb4c2)' }}>{reviewCopy.mode}</dt>
              <dd style={{ margin: 0 }}>{pendingPlanReview.mode === 'request_only_edit' ? reviewCopy.requestOnly : reviewCopy.newDesign}</dd>
              <dt style={{ color: 'var(--nx-text-2, #aeb4c2)' }}>{reviewCopy.impact}</dt>
              <dd style={{ margin: 0 }}>{pendingPlanReview.changedTargets.length ? pendingPlanReview.changedTargets.join(', ') : reviewCopy.selectedReference}</dd>
              <dt style={{ color: 'var(--nx-text-2, #aeb4c2)' }}>{reviewCopy.tool}</dt>
              <dd style={{ margin: 0 }}>{pendingPlanReview.executionTool}</dd>
            </dl>
            <p role="note" style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--nx-warn, #fbbf24)' }}>
              {reviewCopy.note}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button ref={reviewCancelRef} type="button" onClick={() => settlePlanReview(false)} data-testid="ai-plan-review-cancel" style={{ minHeight: 36, padding: '0 14px', borderRadius: 7, border: '1px solid var(--nx-border, #3b4050)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
                {reviewCopy.cancel}
              </button>
              <button type="button" onClick={() => settlePlanReview(true)} disabled={!liveRevision || liveRevision !== pendingPlanReview.baseRevision} data-testid="ai-plan-review-apply" style={{ minHeight: 36, padding: '0 14px', borderRadius: 7, border: 0, background: 'var(--nx-accent, #3b82f6)', color: '#fff', cursor: liveRevision === pendingPlanReview.baseRevision ? 'pointer' : 'not-allowed', opacity: liveRevision === pendingPlanReview.baseRevision ? 1 : .5 }}>
                {reviewCopy.apply}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function planReviewCopy(lang: string) {
  const pick = (ko: string, en: string, ja: string, zh: string, es: string, ar: string) =>
    loc(lang, { ko, en, ja, zh, es, ar });
  return {
    title: pick('AI 변경 검토', 'Review AI changes', 'AI変更を確認', '审查 AI 更改', 'Revisar cambios de IA', 'مراجعة تعديلات الذكاء الاصطناعي'),
    revision: pick('기준 리비전', 'Bound to revision', '基準リビジョン', '绑定到修订版', 'Vinculado a la revisión', 'مرتبط بالمراجعة'),
    mode: pick('모드', 'Mode', 'モード', '模式', 'Modo', 'الوضع'),
    requestOnly: pick('요청 범위만 수정', 'Request-only edit', '依頼範囲のみ編集', '仅编辑请求范围', 'Edición limitada a la solicitud', 'تعديل ضمن نطاق الطلب فقط'),
    newDesign: pick('새 설계 생성', 'New design', '新規設計', '新建设计', 'Diseño nuevo', 'تصميم جديد'),
    impact: pick('영향 범위', 'Impact scope', '影響範囲', '影响范围', 'Alcance del impacto', 'نطاق التأثير'),
    selectedReference: pick('선택 참조/새 기능', 'Selected reference / new feature', '選択参照／新規フィーチャー', '所选引用／新特征', 'Referencia seleccionada / función nueva', 'المرجع المحدد / الميزة الجديدة'),
    tool: pick('실행 도구', 'Execution tool', '実行ツール', '执行工具', 'Herramienta de ejecución', 'أداة التنفيذ'),
    note: pick(
      '적용 전까지 모델은 변경되지 않습니다. 현재 모델이 바뀌면 적용이 차단됩니다.',
      'The model is unchanged until Apply. Apply is blocked if the current model changes.',
      '適用するまでモデルは変更されません。現在のモデルが変わると適用はブロックされます。',
      '应用前模型不会改变。如果当前模型发生变化，应用将被阻止。',
      'El modelo no cambia hasta Aplicar. La aplicación se bloquea si cambia el modelo actual.',
      'لن يتغير النموذج حتى التطبيق. يُمنع التطبيق إذا تغير النموذج الحالي.',
    ),
    cancel: pick('취소', 'Cancel', 'キャンセル', '取消', 'Cancelar', 'إلغاء'),
    apply: pick('검토 후 적용', 'Apply reviewed changes', '確認した変更を適用', '应用已审查的更改', 'Aplicar cambios revisados', 'تطبيق التعديلات التي تمت مراجعتها'),
  };
}

function formatPlanConfirmation(
  intents: FeatureEditIntent[],
  uncertainTarget: boolean,
  lang: string,
  store: FeatureStoreApi,
): string {
  const actions = intents.map(intent => {
    switch (intent.kind) {
      case 'update_param': {
        const feature = store.features.find(item => item.id === intent.featureId);
        const before = feature?.params[intent.paramKey];
        return `${feature?.type ?? intent.featureId}.${intent.paramKey}: ${before ?? '?'} → ${intent.value}`;
      }
      case 'add_feature': return `+ ${intent.featureType} ${JSON.stringify(intent.params)}`;
      case 'add_feature_on_selection': return `+ ${intent.featureType} on selected ${intent.edgeSelections?.length ? 'edge' : 'face'}`;
      case 'remove_feature': return `− ${store.features.find(item => item.id === intent.featureId)?.type ?? 'feature'} [${intent.featureId}]`;
      case 'clear_all': return `− all ${store.features.length} features`;
      case 'replace_pipeline': return `${store.features.length} → ${intent.features.length} features`;
      case 'set_assembly_parts': return `assembly → ${intent.parts.length} independent parts`;
      case 'set_base_shape': return `base shape → ${intent.shapeId} ${JSON.stringify(intent.params)}`;
      case 'toggle_feature': return `${intent.featureId}: ${intent.enabled ? 'enabled' : 'suppressed'}`;
      case 'reorder_feature': return `${intent.featureId} → position ${intent.newIndex + 1}`;
      case 'add_sketch_extrude': return `+ sketch extrude ${intent.sketchData.config.depth} mm`;
    }
  }).join('\n- ');
  return loc(lang, {
    ko: `AI 변경 미리보기\n- ${actions}${uncertainTarget ? '\n\n선택 대상이 파생 참조이므로 형상 변경 후 달라질 수 있습니다.' : ''}\n\n적용할까요?`,
    en: `AI edit preview\n- ${actions}${uncertainTarget ? '\n\nThe selected target uses a derived reference and may change after regeneration.' : ''}\n\nApply these changes?`,
    ja: `AI変更プレビュー\n- ${actions}${uncertainTarget ? '\n\n選択対象は派生参照のため、再生成後に変わる可能性があります。' : ''}\n\n適用しますか？`,
    zh: `AI更改预览\n- ${actions}${uncertainTarget ? '\n\n所选目标使用派生引用，重新生成后可能发生变化。' : ''}\n\n应用这些更改吗？`,
    es: `Vista previa de cambios de IA\n- ${actions}${uncertainTarget ? '\n\nEl objetivo seleccionado usa una referencia derivada y puede cambiar tras regenerar.' : ''}\n\n¿Aplicar estos cambios?`,
    ar: `معاينة تغييرات الذكاء الاصطناعي\n- ${actions}${uncertainTarget ? '\n\nيستخدم الهدف المحدد مرجعاً مشتقاً وقد يتغير بعد إعادة الإنشاء.' : ''}\n\nهل تريد تطبيق هذه التغييرات؟`,
  });
}

/** Convert a successful intent into an EditAction record. Best-effort:
 *  some intents don't map cleanly so we drop them from the tracker. */
function intentToAction(
  intent: FeatureEditIntent,
  store: FeatureStoreApi,
): import('./editOriginTracker').EditAction | null {
  switch (intent.kind) {
    case 'add_feature':
    case 'add_sketch_extrude': {
      const last = store.features[store.features.length - 1];
      if (!last) return null;
      return { kind: 'add', feature: last };
    }
    case 'remove_feature': {
      // The feature is already gone; record by id only.
      return { kind: 'remove', feature: { id: intent.featureId, type: 'fillet', params: {}, enabled: true } };
    }
    case 'update_param': {
      // We don't know the previous value here; record after-only.
      return {
        kind: 'update_param',
        featureId: intent.featureId,
        paramKey: intent.paramKey,
        before: NaN,
        after: intent.value,
      };
    }
    default:
      return null;
  }
}
