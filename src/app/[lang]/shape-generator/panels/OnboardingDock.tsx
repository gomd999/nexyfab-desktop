'use client';

// A3 — Onboarding cluster.
//
// Bundles the first-time-user surfaces: tutorial overlay, welcome banner,
// and the post-signup first-time tour. Each is conditional on tutorial
// state; this dock keeps Inner.tsx free of their props.

import React from 'react';
import dynamic from 'next/dynamic';
import type { TutorialStep } from '../onboarding/tutorialSteps';

const TutorialOverlay = dynamic(() => import('../onboarding/TutorialOverlay'), {
  ssr: false,
  loading: () => null,
});
const WelcomeBanner = dynamic(() => import('../onboarding/WelcomeBanner'), {
  ssr: false,
  loading: () => null,
});
const FirstTimeTour = dynamic(() => import('../onboarding/FirstTimeTour'), { ssr: false });

interface TutorialState {
  showTutorial: boolean;
  showWelcomeBanner: boolean;
  step: TutorialStep | undefined;
  currentStep: number;
  totalSteps: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  startTutorial: () => void;
  nextStep: () => void;
  prevStep: () => void;
  skipTutorial: () => void;
  completeTutorial: () => void;
}

interface OnboardingDockProps {
  lang: string;
  tutorial: TutorialState;
  userId: string | null;
  onOpenChat: () => void;
}

export default function OnboardingDock({
  lang, tutorial, userId, onOpenChat,
}: OnboardingDockProps) {
  return (
    <>
      {tutorial.showTutorial && tutorial.step != null && (
        <TutorialOverlay
          visible={tutorial.showTutorial}
          step={tutorial.step}
          currentStep={tutorial.currentStep}
          totalSteps={tutorial.totalSteps}
          isFirstStep={tutorial.isFirstStep}
          isLastStep={tutorial.isLastStep}
          onNext={tutorial.nextStep}
          onPrev={tutorial.prevStep}
          onSkip={tutorial.skipTutorial}
          lang={lang}
        />
      )}
      {tutorial.showWelcomeBanner && (
        <WelcomeBanner
          lang={lang}
          onStartTutorial={tutorial.startTutorial}
          onDismiss={tutorial.completeTutorial}
        />
      )}
      <FirstTimeTour userId={userId} lang={lang} onOpenChat={onOpenChat} />
    </>
  );
}
