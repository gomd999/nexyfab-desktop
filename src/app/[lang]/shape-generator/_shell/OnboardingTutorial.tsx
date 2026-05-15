'use client';

// First-touch tutorial overlay — 5-step guided tour of the 5-mode IA.
// Shows once per user (localStorage). Dismissable anytime via Esc / Skip.
// Triggered on first ModelerShell mount when `nexyfab.onboarded` is unset.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'nexyfab.onboarded.v1';

interface Step {
  id: string;
  ko: { title: string; body: string };
  en: { title: string; body: string };
  /** CSS selector of the element to highlight. Empty string = center modal. */
  anchor?: string;
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    ko: {
      title: 'NexyFab 에 오신 것을 환영합니다',
      body: '6개 모드 (Solid · Sketch · Assembly · Sheet Metal · Drawing · Render) 가 상단 탭으로 전환됩니다. 60초 안에 둘러볼게요.',
    },
    en: {
      title: 'Welcome to NexyFab',
      body: 'Six modes (Solid · Sketch · Assembly · Sheet Metal · Drawing · Render) switch via the top tabs. Quick 60-second tour.',
    },
  },
  {
    id: 'left',
    ko: {
      title: '좌측 — Features / Bodies / Components',
      body: '모델 트리, 바디 리스트, ISO 표준부품 카탈로그가 여기 있습니다. 트리 row 를 클릭하면 우측에 속성이 표시됩니다.',
    },
    en: {
      title: 'Left — Features / Bodies / Components',
      body: 'Model tree, body list, ISO standard parts catalog. Click any tree row to see its properties on the right.',
    },
    anchor: '.nx-panel:not(.right)',
  },
  {
    id: 'right',
    ko: {
      title: '우측 — Inspector / Nexy AI / Comments',
      body: 'Inspector 에서 파라미터를 직접 편집하고, ANALYZE 섹션으로 DFM/FEA/Cost 분석을, Nexy AI 탭에서는 자연어 요청을 보냅니다.',
    },
    en: {
      title: 'Right — Inspector / Nexy AI / Comments',
      body: 'Edit parameters directly, run DFM/FEA/Cost from ANALYZE, or chat in Nexy AI tab.',
    },
    anchor: '.nx-panel.right',
  },
  {
    id: 'ribbon',
    ko: {
      title: '상단 리본 — 모드별 도구',
      body: '활성 모드의 도구가 그룹별로 정렬됩니다. 모드 탭을 클릭하면 리본 + 사이드바가 함께 전환됩니다.',
    },
    en: {
      title: 'Top ribbon — mode-aware tools',
      body: 'Tools group per active mode. Click a mode tab to switch ribbon + sidebars together.',
    },
    anchor: '.nx-ribbon',
  },
  {
    id: 'drawer',
    ko: {
      title: '하단 드로어 — DFM · FEA · 비용 · 변형 · 모션',
      body: 'Inspector ANALYZE 행을 클릭하면 분석 드로어가 슬라이드업합니다. 모달 대신 모델 옆에서 즉시 결과 확인.',
    },
    en: {
      title: 'Bottom drawer — DFM · FEA · Cost · Variants · Motion',
      body: 'Click an ANALYZE row to slide the analytics drawer up. Results live alongside your model, not in a modal.',
    },
  },
];

export interface OnboardingTutorialProps {
  isKo: boolean;
}

export function OnboardingTutorial({ isKo }: OnboardingTutorialProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const seen = window.localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      // Slight delay so Shell mounts + DOM anchors exist.
      const id = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(id);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step]);

  if (!open) return null;
  const s = STEPS[step];
  const text = isKo ? s.ko : s.en;

  const next = () => {
    if (step >= STEPS.length - 1) dismiss();
    else setStep(s => s + 1);
  };
  const prev = () => setStep(s => Math.max(0, s - 1));
  const dismiss = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, '1');
    }
    setOpen(false);
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={dismiss}
        style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
        }}
      />
      {/* Card */}
      <div
        role="dialog"
        aria-modal
        style={{
          position: 'fixed', zIndex: 9001,
          left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(480px, 92vw)',
          background: 'var(--nx-panel)',
          border: '1px solid var(--nx-border)',
          borderRadius: 10,
          boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          padding: 20,
          color: 'var(--nx-text)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 28, height: 28, borderRadius: '50%',
            background: 'var(--nx-accent)', color: '#fff',
            fontSize: 13, fontWeight: 700,
          }}>
            {step + 1}
          </span>
          <h2 style={{ flex: 1, margin: 0, fontSize: 16, fontWeight: 700 }}>{text.title}</h2>
          <button
            onClick={dismiss}
            aria-label="Close"
            style={{
              width: 24, height: 24, border: 0, background: 'transparent',
              color: 'var(--nx-text-3)', fontSize: 18, cursor: 'pointer',
            }}
          >×</button>
        </div>
        <p style={{
          fontSize: 13, lineHeight: 1.6,
          color: 'var(--nx-text-2)',
          margin: '0 0 16px',
        }}>
          {text.body}
        </p>

        {/* Step dots */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          {STEPS.map((_, i) => (
            <span
              key={i}
              style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i <= step ? 'var(--nx-accent)' : 'var(--nx-border)',
              }}
            />
          ))}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={dismiss}
            style={{
              padding: '8px 12px', height: 32,
              border: 0, background: 'transparent',
              color: 'var(--nx-text-3)', fontSize: 12, cursor: 'pointer',
            }}
          >
            {isKo ? '건너뛰기' : 'Skip tour'}
          </button>
          <span style={{ flex: 1 }} />
          {step > 0 && (
            <button
              onClick={prev}
              style={{
                padding: '8px 14px', height: 32,
                border: '1px solid var(--nx-border)', borderRadius: 6,
                background: 'transparent', color: 'var(--nx-text)',
                fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >
              ← {isKo ? '이전' : 'Back'}
            </button>
          )}
          <button
            onClick={next}
            style={{
              padding: '8px 16px', height: 32,
              border: 0, borderRadius: 6,
              background: 'var(--nx-accent)', color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {step >= STEPS.length - 1
              ? (isKo ? '시작하기' : 'Get started')
              : (isKo ? '다음 →' : 'Next →')}
          </button>
        </div>
      </div>
    </>
  );
}
