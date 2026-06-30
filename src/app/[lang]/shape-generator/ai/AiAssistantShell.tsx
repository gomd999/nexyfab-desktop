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
  type FeatureEditIntent,
  type FeatureStoreApi,
} from './featureEditDispatcher';
import { EditOriginTracker, nextBatchId } from './editOriginTracker';
import { useVoiceInput } from './useVoiceInput';

export interface AiAssistantShellProps {
  lang: string;
  /** Bridge to the feature store. */
  store: FeatureStoreApi;
  /** Turn a natural-language prompt into a list of feature edit intents.
   *  Caller wires this to the existing intent-parser pipeline. */
  promptToIntents: (prompt: string) => Promise<{
    intents: FeatureEditIntent[];
    explanation: string;
  }>;
  /** Optional callback when origin tracker records a new AI batch. */
  onAiBatch?: (batchId: string, intentCount: number) => void;
  /** Optional: open the full chat sidebar. */
  onOpenFullChat?: () => void;
  /** When true (a mesh has been imported), route prompts to onScadEdit — the
   *  SCAD path that edits the import — instead of parametric feature intents. */
  scadEditActive?: boolean;
  onScadEdit?: (prompt: string) => Promise<void>;
  /** Disable when WASM not ready or user is in a modal flow. */
  disabled?: boolean;
}

export default function AiAssistantShell({
  lang, store, promptToIntents, onAiBatch, onOpenFullChat, disabled,
  scadEditActive, onScadEdit,
}: AiAssistantShellProps) {
  const trackerRef = useRef<EditOriginTracker | null>(null);
  if (!trackerRef.current) trackerRef.current = new EditOriginTracker();

  const [voiceTranscript, setVoiceTranscript] = useState<string>('');

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
      const { intents, explanation } = await promptToIntents(prompt);
      if (intents.length === 0) return explanation || 'No actions inferred.';
      const batchId = nextBatchId();
      const results = dispatchFeatureEditBatch(intents, store);
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
      let reply = `${explanation}\n\nApplied ${applied}/${intents.length} action(s).`;
      // Surface WHICH actions failed and WHY, instead of a silent partial apply.
      if (failed.length > 0) {
        reply += '\n' + failed
          .map(r => `⚠️ ${r.summary || 'action'}${r.errorReason ? ` — ${r.errorReason}` : ''}`)
          .join('\n');
      }
      return reply;
    } catch (err) {
      return `AI error: ${(err as Error)?.message ?? err}`;
    }
  }, [disabled, promptToIntents, store, onAiBatch, scadEditActive, onScadEdit]);

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
      onOpenFullChat={onOpenFullChat}
      disabled={disabled}
    />
  );
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
