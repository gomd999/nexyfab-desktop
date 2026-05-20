'use client';

/**
 * FirstTimeTutorial.tsx
 *
 * 3-step interactive onboarding shown the first time a user opens
 * the 3D modeler after signup. Once dismissed (Skip or finish), the
 * `localStorage` flag `nexyfab_tutorial_done_v1` prevents re-show.
 *
 * The three steps are deliberately *small wins* that build a
 * complete cycle:
 *   1. 템플릿 열기 — show how easy it is to start
 *   2. 치수 1개 수정 — show parametric editing
 *   3. STL export — show shippable output
 *
 * Spotlight pattern: a translucent overlay dims everything except
 * the target element + a callout balloon explaining what to click.
 * The target selectors are passed via props so the same component
 * can adapt to layout changes.
 */

import React, { useEffect, useState } from 'react';

export type TutorialStep = 1 | 2 | 3;

export interface FirstTimeTutorialProps {
  lang: string;
  open: boolean;
  step: TutorialStep;
  /** CSS selector or null. null = center the modal (no spotlight). */
  targetSelector: string | null;
  onNext: () => void;
  onSkip: () => void;
}

const STORAGE_KEY = 'nexyfab_tutorial_done_v1';

export function hasCompletedTutorial(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return true;
  }
}

export function markTutorialDone(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, 'true');
  } catch { /* private mode — fine */ }
}

const COPY = {
  ko: {
    step1Title: '템플릿 하나를 골라보세요',
    step1Body: '브래킷, 박스, 디스크 — 5초 안에 첫 모델이 나옵니다.',
    step2Title: '치수를 바꿔보세요',
    step2Body: 'Feature Tree의 숫자를 클릭해 길이나 두께를 조절해보세요.',
    step3Title: 'STL을 다운로드하세요',
    step3Body: '오른쪽 위 Export 버튼으로 3D 프린터 / CNC용 STL을 받습니다.',
    next: '다음',
    finish: '시작하기',
    skip: '건너뛰기',
    stepLabel: (n: number, total: number) => `${n}/${total} 단계`,
  },
  en: {
    step1Title: 'Pick a starter template',
    step1Body: 'Bracket, box, disk — your first model appears in seconds.',
    step2Title: 'Change a dimension',
    step2Body: 'Click a number in the Feature Tree to adjust length or thickness.',
    step3Title: 'Export your STL',
    step3Body: 'Use the Export button to download an STL for 3D printing / CNC.',
    next: 'Next',
    finish: 'Start',
    skip: 'Skip',
    stepLabel: (n: number, total: number) => `Step ${n} of ${total}`,
  },
};

export default function FirstTimeTutorial({
  lang, open, step, targetSelector, onNext, onSkip,
}: FirstTimeTutorialProps) {
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!open || !targetSelector) {
      setTargetRect(null);
      return;
    }
    const update = () => {
      const el = document.querySelector(targetSelector);
      if (el) setTargetRect(el.getBoundingClientRect());
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, targetSelector]);

  if (!open) return null;

  const t = lang === 'ko' || lang === 'kr' ? COPY.ko : COPY.en;
  const stepCopy = step === 1
    ? { title: t.step1Title, body: t.step1Body }
    : step === 2
      ? { title: t.step2Title, body: t.step2Body }
      : { title: t.step3Title, body: t.step3Body };

  const isFinal = step === 3;

  // Position the callout near the spotlight target, or center it
  // when no target is given (e.g. step 1 before user clicks anything).
  const calloutStyle: React.CSSProperties = targetRect
    ? {
        position: 'fixed',
        top: Math.min(targetRect.bottom + 12, window.innerHeight - 200),
        left: Math.max(16, Math.min(targetRect.left, window.innerWidth - 320)),
        width: 300,
      }
    : {
        position: 'fixed',
        top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 320,
      };

  return (
    <>
      {/* Backdrop with spotlight cutout */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 1500,
          background: 'rgba(15,23,42,0.55)',
          pointerEvents: targetRect ? 'none' : 'auto',
        }}
        onClick={!targetRect ? onSkip : undefined}
      />
      {targetRect && (
        <div
          aria-hidden
          style={{
            position: 'fixed',
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
            border: '2px solid #3b82f6',
            borderRadius: 8,
            boxShadow: '0 0 0 9999px rgba(15,23,42,0.55)',
            zIndex: 1501,
            pointerEvents: 'none',
          }}
        />
      )}

      <div
        role="dialog"
        aria-labelledby="tutorial-title"
        style={{
          ...calloutStyle,
          zIndex: 1502,
          background: '#1e293b',
          color: '#f1f5f9',
          padding: '16px 18px',
          borderRadius: 10,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: '#3b82f6',
            fontWeight: 600,
            marginBottom: 6,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          {t.stepLabel(step, 3)}
        </div>
        <h3
          id="tutorial-title"
          style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 700, lineHeight: 1.3 }}
        >
          {stepCopy.title}
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: '#cbd5e1' }}>
          {stepCopy.body}
        </p>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button
            type="button"
            onClick={onSkip}
            style={{
              background: 'transparent', border: 'none', color: '#94a3b8',
              fontSize: 12, cursor: 'pointer',
            }}
          >
            {t.skip}
          </button>
          <button
            type="button"
            onClick={onNext}
            style={{
              background: '#3b82f6', color: 'white', border: 'none',
              padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isFinal ? t.finish : t.next}
          </button>
        </div>
      </div>
    </>
  );
}
