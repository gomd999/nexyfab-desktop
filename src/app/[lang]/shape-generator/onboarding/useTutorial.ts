import { useState, useCallback, useEffect } from 'react';
import { TUTORIAL_STEPS, SKETCH_TUTORIAL_STEPS } from './tutorialSteps';
import type { TutorialStep } from './tutorialSteps';

export const TUTORIAL_KEY = 'nexyfab_tutorial_done';
const SKETCH_TUTORIAL_KEY = 'nexyfab_sketch_tutorial_done';
const VISITED_KEY         = 'nexyfab_visited';

export function useTutorial() {
  const [showTutorial, setShowTutorial] = useState(false);
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [activeSteps, setActiveSteps] = useState<TutorialStep[]>(TUTORIAL_STEPS);

  // On mount: show WelcomeBanner for brand-new visitors, auto-show tutorial if
  // they reload before dismissing the banner (visited but not done).
  useEffect(() => {
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
  }, []);

  const completeTutorial = useCallback(() => {
    setShowTutorial(false);
    setShowWelcomeBanner(false);
    setCurrentStep(0);
    try { localStorage.setItem(TUTORIAL_KEY, 'true'); } catch {}
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
    try { localStorage.removeItem(TUTORIAL_KEY); } catch {}
  }, []);

  const restartSketchTutorial = useCallback(() => {
    setActiveSteps(SKETCH_TUTORIAL_STEPS);
    setCurrentStep(0);
    setShowTutorial(true);
    try { localStorage.removeItem(SKETCH_TUTORIAL_KEY); } catch {}
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
