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
  dispatchFeatureEditBatch,
  dispatchFeatureEditBatchAtomic,
  type FeatureEditIntent,
  type FeatureStoreApi,
} from './featureEditDispatcher';
import { EditOriginTracker, nextBatchId } from './editOriginTracker';
import { useVoiceInput } from './useVoiceInput';
import type { SelectionContext } from '@/lib/ai/selectionContext';
import { selectionRequiresConfirmation } from '@/lib/ai/selectionContext';
import { updateGenerationSessionForEdit } from './generationSessionClient';

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
  /** When true (a mesh has been imported), route prompts to onScadEdit — the
   *  SCAD path that edits the import — instead of parametric feature intents. */
  scadEditActive?: boolean;
  onScadEdit?: (prompt: string) => Promise<void>;
  /** Optional: build a model from an attached photo (vision → SCAD → mesh). */
  onImageGenerate?: (prompt: string, image: string) => Promise<string | null>;
  /** Disable when WASM not ready or user is in a modal flow. */
  disabled?: boolean;
}

export default function AiAssistantShell({
  lang, store, promptToIntents, onAiBatch, onOpenFullChat, disabled,
  scadEditActive, onScadEdit, onImageGenerate, getCurrentRevision, confirmPlan,
  captureEditSnapshot, restoreEditSnapshot,
}: AiAssistantShellProps) {
  const trackerRef = useRef<EditOriginTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = new EditOriginTracker();

  const [voiceTranscript, setVoiceTranscript] = useState<string>('');
  const [undoAiEdit, setUndoAiEdit] = useState<(() => Promise<void>) | null>(null);

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
      try {
        await onScadEdit(prompt);
        // Never return null here — a silent null reads as "no reaction" in the
        // floating prompt. Give explicit confirmation instead.
        return '✓ 적용했어요. 3D 미리보기를 확인하세요. / Applied — check the 3D preview.';
      } catch (err) { return `AI error: ${(err as Error)?.message ?? err}`; }
    }
    // If the user is mid-sketch, commit it first so the AI edits a consistent
    // feature tree (prevents the sketch↔tree desync / orphaned-node corruption
    // when manual sketching and AI run against the same state). No-op if not in
    // sketch mode. This makes the manual→AI→manual workflow safe.
    try { window.dispatchEvent(new CustomEvent('nexyfab:tool', { detail: { id: 'sketch.finish' } })); } catch { /* ok */ }
    try {
      const { intents, explanation, baseRevision, selectionContext } = await promptToIntents(prompt);
      if (intents.length === 0) return explanation || 'No actions inferred.';
      const currentRevision = getCurrentRevision?.();
      if (baseRevision && currentRevision && baseRevision !== currentRevision) {
        return lang === 'ko'
          ? '모델이 AI 분석 이후 변경되어 적용을 중단했습니다. 현재 상태에서 다시 요청해 주세요.'
          : 'The model changed after AI planning, so the edit was not applied. Please retry on the current state.';
      }
      const destructive = intents.some(intent =>
        intent.kind === 'clear_all' || intent.kind === 'replace_pipeline' ||
        intent.kind === 'remove_feature' || intent.kind === 'set_assembly_parts');
      const uncertainTarget = selectionContext ? selectionRequiresConfirmation(selectionContext) : false;
      if (destructive || uncertainTarget) {
        const summary = formatPlanConfirmation(intents, uncertainTarget, lang, store);
        const accepted = confirmPlan
          ? await confirmPlan(summary)
          : (typeof window !== 'undefined' ? window.confirm(summary) : false);
        if (!accepted) return lang === 'ko' ? '변경을 적용하지 않았습니다.' : 'The edit was not applied.';
      }
      const batchId = nextBatchId();
      let results;
      if (captureEditSnapshot && restoreEditSnapshot) {
        const atomic = await dispatchFeatureEditBatchAtomic(
          intents, store, captureEditSnapshot, restoreEditSnapshot,
        );
        results = atomic.results;
        if (!atomic.committed) {
          return `${explanation}\n\n${lang === 'ko' ? '변경 도중 오류가 발생해 전체 상태를 자동 복구했습니다.' : 'An edit failed, so the complete model state was restored.'}${atomic.errorReason ? `\n${atomic.errorReason}` : ''}`;
        }
        setUndoAiEdit(() => async () => {
          await restoreEditSnapshot(atomic.snapshot);
          setUndoAiEdit(null);
        });
      } else {
        results = dispatchFeatureEditBatch(intents, store);
        setUndoAiEdit(null);
      }
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
  }, [disabled, promptToIntents, store, onAiBatch, scadEditActive, onScadEdit, getCurrentRevision, confirmPlan, lang, captureEditSnapshot, restoreEditSnapshot]);

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
    <FloatingAiPrompt
      lang={lang}
      onSubmit={runPrompt}
      onImageGenerate={onImageGenerate}
      onOpenFullChat={onOpenFullChat}
      disabled={disabled}
      onUndo={undoAiEdit ?? undefined}
    />
  );
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
  if (lang === 'ko') {
    return `AI 변경 미리보기\n- ${actions}${uncertainTarget ? '\n\n선택 대상이 파생 참조이므로 형상 변경 후 달라질 수 있습니다.' : ''}\n\n적용할까요?`;
  }
  return `AI edit preview\n- ${actions}${uncertainTarget ? '\n\nThe selected target uses a derived reference and may change after regeneration.' : ''}\n\nApply these changes?`;
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
