import { useState, useCallback, useEffect } from 'react';
import { TUTORIAL_STEPS, SKETCH_TUTORIAL_STEPS } from './tutorialSteps';
import type { TutorialStep } from './tutorialSteps';

export const TUTORIAL_KEY = 'nexyfab_tutorial_done';
const SKETCH_TUTORIAL_KEY = 'nexyfab_sketch_tutorial_done';
const VISITED_KEY         = 'nexyfab_visited';

/** @param suppressAutoWelcome true while another first-run surface (the sample
 *  template picker, shown when the part is empty) owns the screen — so the legacy
 *  welcome banner / tutorial don't auto-pop ON TOP of it. Manual start
 *  (startTutorial / restartTutorial from the help menu) is unaffected. */
export function useTutorial(suppressAutoWelcome = false) {
  const [showTutorial, setShowTutorial] = useState(false);
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [activeSteps, setActiveSteps] = useState<TutorialStep[]>(TUTORIAL_STEPS);

  // On mount: show WelcomeBanner for brand-new visitors — UNLESS the template
  // picker is the active first-run surface (then it would stack on top, the
  // reported clutter). Skipping the auto-banner there; the picker is the
  // onboarding and the tutorial stays available from the help menu.
  useEffect(() => {
    if (suppressAutoWelcome) return;
    try {
      const done    = localStorage.getItem(TUTORIAL_KEY);
      const visited = localStorage.getItem(VISITED_KEY);
      if (done) return;
      localStorage.setItem(VISITED_KEY, 'true');
      if (!visited) {
        const timer = setTimeout(() => setShowWelcomeBanner(true), 800);
        return () => clearTimeout(timer);
      }
    } catch {
      // localStorage unavailable (SSR / private mode)
    }
  }, [suppressAutoWelcome]);

  const completeTutorial = useCallback(() => {
    setShowTutorial(false);
    setShowWelcomeBanner(false);
    setCurrentStep(0);
    try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch (err) { console.error('[useTutorial] caught', err); }
  }, []);

  const startTutorial = useCallback(() => {
    setShowWelcomeBanner(false);
    setActiveSteps(TUTORIAL_STEPS);
    setCurrentStep(0);
    setShowTutorial(true);
  }, []);

  /** Start the sketch-specific 4-step tutorial */
  const startSketchTutorial = useCallback(() => {
    setActiveSteps(SKETCH_TUTORIAL_STEPS);
    setCurrentStep(0);
    setShowTutorial(true);
  }, []);

  const nextStep = useCallback(() => {
    if (currentStep < activeSteps.length - 1) {
      setCurrentStep(s => s + 1);
    } else {
      completeTutorial();
    }
  }, [currentStep, activeSteps.length, completeTutorial]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(s => s - 1);
    }
  }, [currentStep]);

  const restartTutorial = useCallback(() => {
    setActiveSteps(TUTORIAL_STEPS);
    setCurrentStep(0);
    setShowTutorial(true);
    try { localStorage.removeItem(TUTORIAL_KEY); } catch (err) { console.error('[useTutorial] caught', err); }
  }, []);

  const restartSketchTutorial = useCallback(() => {
    setActiveSteps(SKETCH_TUTORIAL_STEPS);
    setCurrentStep(0);
    setShowTutorial(true);
    try { localStorage.removeItem(SKETCH_TUTORIAL_KEY); } catch (err) { console.error('[useTutorial] caught', err); }
  }, []);

  return {
    showTutorial,
    showWelcomeBanner,
    currentStep,
    totalSteps: activeSteps.length,
    step: activeSteps[currentStep],
    nextStep,
    prevStep,
    skipTutorial: completeTutorial,
    completeTutorial,
    startTutorial,
    startSketchTutorial,
    restartTutorial,
    restartSketchTutorial,
    isFirstStep: currentStep === 0,
    isLastStep: currentStep === activeSteps.length - 1,
  };
}
