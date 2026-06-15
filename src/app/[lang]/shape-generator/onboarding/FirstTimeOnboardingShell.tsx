'use client';

/**
 * FirstTimeOnboardingShell.tsx
 *
 * Single orchestrator that wires the four Phase-2 Week-1 first-time
 * UX surfaces into ShapeGeneratorInner. The parent passes in
 * minimal state hooks; this component decides when each surface
 * appears, persists the dismissal flags, and tracks the 5-step
 * checklist.
 *
 *   - SampleTemplatePicker: shown when features.length === 0 and
 *     user has not dismissed the picker permanently.
 *   - FirstTimeTutorial: shown immediately after picker.onPick
 *     until the user has finished or skipped (LS flag).
 *   - QuickExportButton: floats over the viewport once
 *     `hasGeometry` is true, until user exports once (LS flag).
 *   - ModelerFirstStepsChecklist: docked bottom-left until all 5
 *     steps complete OR user dismisses.
 *
 * Keeping all this in one component lets ShapeGeneratorInner add a
 * single JSX node + 1 prop set instead of 5 scattered hooks.
 */

import React, { useEffect, useState } from 'react';
import SampleTemplatePicker from '../templates/SampleTemplatePicker';
import { type SampleTemplate } from '../templates/sampleTemplates';
import FirstTimeTutorial, {
  hasCompletedTutorial,
  markTutorialDone,
  type TutorialStep,
} from './FirstTimeTutorial';
import QuickExportButton from '../export/QuickExportButton';
import ModelerFirstStepsChecklist, { type StepKey } from './ModelerFirstStepsChecklist';

const PICKER_DISMISSED_KEY = 'nexyfab_template_picker_dismissed_v1';

export interface FirstTimeOnboardingShellProps {
  lang: string;
  featureCount: number;
  hasGeometry: boolean;
  /** Called when user picks a template. Caller should load the
   *  template's features into the feature store. */
  onLoadTemplate: (template: SampleTemplate) => void;
  /** AI front door: caller routes this natural-language prompt to the
   *  generation agent. When omitted, the picker hides its AI section. */
  onAiPrompt?: (prompt: string) => void;
  /** STL export — caller wires to the actual STL exporter. */
  onExportStl: () => void | Promise<void>;
  /** Optional override on which steps are completed (for testing /
   *  external state sync). When omitted, this component derives
   *  step completion from internal heuristics. */
  stepsCompletedOverride?: Partial<Record<StepKey, boolean>>;
}

export default function FirstTimeOnboardingShell({
  lang,
  featureCount,
  hasGeometry,
  onLoadTemplate,
  onAiPrompt,
  onExportStl,
  stepsCompletedOverride,
}: FirstTimeOnboardingShellProps) {
  // Picker is shown when the canvas is empty AND not permanently dismissed.
  const [pickerDismissed, setPickerDismissed] = useState(true);
  // Tutorial state machine: -1 = not active, 1-3 = step number.
  const [tutorialStep, setTutorialStep] = useState<-1 | TutorialStep>(-1);
  // Steps derived from user actions + override.
  const [internalSteps, setInternalSteps] = useState<Record<StepKey, boolean>>({
    template: false, modify: false, export: false, render: false, save: false,
  });

  useEffect(() => {
    // Blank workspace is the default (pro-CAD: open straight into an empty part).
    // The full-screen template picker no longer auto-opens as a forced first-run
    // modal — the empty-canvas Shape Library / AI Chat cards are the discoverable
    // entry points. A future "New from template" button can flip this back on
    // demand. (Retired the forced modal 2026-06-09 per UX review.)
    setPickerDismissed(true);
  }, []);

  // When the first feature is added, mark 'template' step done.
  useEffect(() => {
    if (featureCount > 0 && !internalSteps.template) {
      setInternalSteps(s => ({ ...s, template: true }));
    }
  }, [featureCount, internalSteps.template]);

  // Picker shows only when canvas empty + not dismissed.
  const showPicker = featureCount === 0 && !pickerDismissed;

  const handlePick = (template: SampleTemplate) => {
    onLoadTemplate(template);
    try { window.localStorage.setItem(PICKER_DISMISSED_KEY, 'true'); } catch { /* ok */ }
    setPickerDismissed(true);
    // Start the 3-step tutorial unless previously completed.
    if (!hasCompletedTutorial()) setTutorialStep(1);
  };

  const handleSkipPicker = () => {
    try { window.localStorage.setItem(PICKER_DISMISSED_KEY, 'true'); } catch { /* ok */ }
    setPickerDismissed(true);
  };

  // AI front door: dismiss the picker so the agent / canvas takes over, then
  // hand the prompt up to the host (which opens the generation agent).
  const handleAiPrompt = onAiPrompt
    ? (prompt: string) => {
        try { window.localStorage.setItem(PICKER_DISMISSED_KEY, 'true'); } catch { /* ok */ }
        setPickerDismissed(true);
        onAiPrompt(prompt);
      }
    : undefined;

  const advanceTutorial = () => {
    if (tutorialStep === -1) return;
    if (tutorialStep === 3) {
      markTutorialDone();
      setTutorialStep(-1);
    } else {
      setTutorialStep((tutorialStep + 1) as TutorialStep);
    }
  };

  const skipTutorial = () => {
    markTutorialDone();
    setTutorialStep(-1);
  };

  // Wrap onExportStl so we can mark 'export' step done.
  const wrappedExport = async () => {
    setInternalSteps(s => ({ ...s, export: true }));
    await onExportStl();
  };

  // Tutorial step targets — best-effort CSS selectors. If a target
  // isn't present (different shell layout), the callout centers
  // itself which still reads as helpful.
  const tutorialTarget = tutorialStep === 1
    ? '[data-onboarding="template-picker"]'
    : tutorialStep === 2
      ? '[data-onboarding="feature-tree"]'
      : tutorialStep === 3
        ? '[data-onboarding="export"]'
        : null;

  const completed: Record<StepKey, boolean> = {
    ...internalSteps,
    ...stepsCompletedOverride,
  };

  return (
    <>
      {showPicker && (
        <div
          data-onboarding="template-picker"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 600,
            background: 'rgba(15,23,42,0.85)',
            overflowY: 'auto',
            padding: '20px',
          }}
        >
          <SampleTemplatePicker
            lang={lang}
            onPick={handlePick}
            onSkip={handleSkipPicker}
            onAiPrompt={handleAiPrompt}
          />
        </div>
      )}

      {tutorialStep !== -1 && (
        <FirstTimeTutorial
          lang={lang}
          open
          step={tutorialStep as TutorialStep}
          targetSelector={tutorialTarget}
          onNext={advanceTutorial}
          onSkip={skipTutorial}
        />
      )}

      <QuickExportButton
        lang={lang}
        hasGeometry={hasGeometry}
        onExportStl={wrappedExport}
      />

      <ModelerFirstStepsChecklist
        lang={lang}
        completed={completed}
      />
    </>
  );
}
