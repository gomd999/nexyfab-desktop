'use client';

import React, { useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import type { TutorialStep } from './tutorialSteps';
import { getStepTitle, getStepDescription } from './tutorialSteps';

interface TutorialOverlayProps {
  visible: boolean;
  step: TutorialStep;
  currentStep: number;
  totalSteps: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  lang: string;
}

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;
const TOOLTIP_GAP = 14;
const TOOLTIP_W = 320;
const FADE_MS = 220;
const RETRY_INTERVAL_MS = 500;
const MAX_RETRIES = 5;

export default function TutorialOverlay({
  visible, step, currentStep, totalSteps,
  isFirstStep, isLastStep,
  onNext, onPrev, onSkip, lang,
}: TutorialOverlayProps) {
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [fadeIn, setFadeIn] = useState(false);
  // isTransitioning drives opacity-0 between step changes
  const [isTransitioning, setIsTransitioning] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref so event handlers always call the latest measureTarget
  // without needing to re-register listeners on every step change.
  // Initialized with a no-op; assigned in useLayoutEffect below.
  const measureTargetRef = useRef<() => boolean>(() => false);

  const isKo = lang === 'ko';

  // i18n helpers for button labels
  const NAV = {
    skip:  { ko: '건너뛰기', en: 'Skip',   ja: 'スキップ', cn: '跳过', es: 'Saltar', ar: 'تخطى' },
    back:  { ko: '이전',     en: 'Back',   ja: '前へ',    cn: '上一步', es: 'Atrás', ar: 'السابق' },
    next:  { ko: '다음',     en: 'Next',   ja: '次へ',    cn: '下一步', es: 'Siguiente', ar: 'التالي' },
    done:  { ko: '완료',     en: 'Done',   ja: '完了',    cn: '完成', es: 'Listo', ar: 'تم' },
  } as const;
  type NavKey = keyof typeof NAV;
  function nt(key: NavKey): string {
    const map = NAV[key] as Record<string, string>;
    return map[lang] ?? map['en'];
  }

  // ── Find and measure target element, with retry ───────────────────────────
  const measureTarget = useCallback(() => {
    if (!step) return false;
    const el = document.querySelector(step.targetSelector);
    if (!el) {
      return false; // signal not found
    }
    const r = el.getBoundingClientRect();
    setTargetRect({
      top: r.top - PADDING,
      left: r.left - PADDING,
      width: r.width + PADDING * 2,
      height: r.height + PADDING * 2,
    });
    return true;
  }, [step]);

  const startRetry = useCallback(() => {
    retryCountRef.current = 0;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);

    const attempt = () => {
      if (retryCountRef.current >= MAX_RETRIES) {
        // All retries exhausted — use centered fallback
        setTargetRect({
          top: window.innerHeight / 2 - 30,
          left: window.innerWidth / 2 - 30,
          width: 60,
          height: 60,
        });
        return;
      }
      const found = measureTarget();
      if (!found) {
        retryCountRef.current += 1;
        retryTimerRef.current = setTimeout(attempt, RETRY_INTERVAL_MS);
      }
    };
    attempt();
  }, [measureTarget]);

  // Keep ref in sync with latest measureTarget (runs before paint)
  useLayoutEffect(() => { measureTargetRef.current = measureTarget; });

  // Re-measure when the step target changes (without re-registering listeners)
  useEffect(() => {
    if (!visible) return;
    const found = measureTarget();
    if (!found) startRetry();
  }, [visible, measureTarget, startRetry]);

  // Register resize/scroll listeners once per visibility change only
  useEffect(() => {
    if (!visible) return;
    const handler = () => measureTargetRef.current();
    const observer = new ResizeObserver(handler);
    observer.observe(document.body);
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Compute tooltip position ───────────────────────────────────────────────
  useEffect(() => {
    if (!targetRect || !tooltipRef.current) return;
    const tt = tooltipRef.current.getBoundingClientRect();
    const ttH = tt.height || 180;
    const ttW = TOOLTIP_W;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = 0;
    let left = 0;
    const preferred = step.position;
    const positions: Array<'top' | 'bottom' | 'left' | 'right'> = [preferred, 'bottom', 'top', 'right', 'left'];

    for (const pos of positions) {
      if (pos === 'bottom') {
        top  = targetRect.top + targetRect.height + TOOLTIP_GAP;
        left = targetRect.left + targetRect.width / 2 - ttW / 2;
      } else if (pos === 'top') {
        top  = targetRect.top - ttH - TOOLTIP_GAP;
        left = targetRect.left + targetRect.width / 2 - ttW / 2;
      } else if (pos === 'right') {
        top  = targetRect.top + targetRect.height / 2 - ttH / 2;
        left = targetRect.left + targetRect.width + TOOLTIP_GAP;
      } else if (pos === 'left') {
        top  = targetRect.top + targetRect.height / 2 - ttH / 2;
        left = targetRect.left - ttW - TOOLTIP_GAP;
      }

      left = Math.max(12, Math.min(left, vw - ttW - 12));
      top  = Math.max(12, Math.min(top,  vh - ttH - 12));

      const tooltipBox = { top, left, right: left + ttW, bottom: top + ttH };
      const targetBox  = {
        top:    targetRect.top,
        left:   targetRect.left,
        right:  targetRect.left + targetRect.width,
        bottom: targetRect.top  + targetRect.height,
      };
      const overlaps = !(
        tooltipBox.right  < targetBox.left  ||
        tooltipBox.left   > targetBox.right ||
        tooltipBox.bottom < targetBox.top   ||
        tooltipBox.top    > targetBox.bottom
      );

      if (!overlaps || pos === positions[positions.length - 1]) break;
    }

    setTooltipPos({ top, left });
  }, [targetRect, step.position]);

  // ── Fade in on mount / step change ────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    setFadeIn(false);
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => setFadeIn(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [visible, currentStep]);

  // ── Step-change cross-fade ─────────────────────────────────────────────────
  //    Consumers call onNext/onPrev which update currentStep from outside.
  //    We wrap them so the tooltip fades out first, then the parent updates.
  const handleNext = useCallback(() => {
    setIsTransitioning(true);
    setTimeout(() => {
      setIsTransitioning(false);
      onNext();
    }, FADE_MS);
  }, [onNext]);

  const handlePrev = useCallback(() => {
    setIsTransitioning(true);
    setTimeout(() => {
      setIsTransitioning(false);
      onPrev();
    }, FADE_MS);
  }, [onPrev]);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape')                           { onSkip();      return; }
      if (e.key === 'ArrowRight' || e.key === 'Enter')  { handleNext();  return; }
      if (e.key === 'ArrowLeft')                        { handlePrev();  return; }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, handleNext, handlePrev, onSkip]);

  if (!visible || !targetRect) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const tooltipOpacity = fadeIn && !isTransitioning ? 1 : 0;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 10000,
      pointerEvents: 'auto',
      opacity: fadeIn ? 1 : 0,
      transition: `opacity ${FADE_MS}ms ease`,
    }}>
      {/* Dark overlay with cutout */}
      <svg width={vw} height={vh} style={{ position: 'absolute', top: 0, left: 0 }}>
        <defs>
          <mask id="tutorial-mask">
            <rect x={0} y={0} width={vw} height={vh} fill="white" />
            <rect
              x={targetRect.left} y={targetRect.top}
              width={targetRect.width} height={targetRect.height}
              rx={8} ry={8} fill="black"
            />
          </mask>
        </defs>
        <rect
          x={0} y={0} width={vw} height={vh}
          fill="rgba(0,0,0,0.72)" mask="url(#tutorial-mask)"
        />
      </svg>

      {/* Pulse ring around target */}
      <div style={{
        position: 'absolute',
        top:    targetRect.top  - 2,
        left:   targetRect.left - 2,
        width:  targetRect.width  + 4,
        height: targetRect.height + 4,
        borderRadius: 10,
        border: '2px solid #58a6ff',
        animation: 'tutorial-pulse 1.8s ease-in-out infinite',
        pointerEvents: 'none',
        transition: `top ${FADE_MS}ms ease, left ${FADE_MS}ms ease, width ${FADE_MS}ms ease, height ${FADE_MS}ms ease`,
      }} />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          position: 'absolute',
          top:  tooltipPos.top,
          left: tooltipPos.left,
          width: TOOLTIP_W,
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 12,
          padding: 20,
          boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
          opacity: tooltipOpacity,
          transform: tooltipOpacity === 1 ? 'translateY(0)' : 'translateY(6px)',
          transition: `opacity ${FADE_MS}ms ease, transform ${FADE_MS}ms ease, top ${FADE_MS}ms ease, left ${FADE_MS}ms ease`,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          pointerEvents: isTransitioning ? 'none' : 'auto',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Progress dots */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div
                key={i}
                style={{
                  width:  i === currentStep ? 18 : 6,
                  height: 6,
                  borderRadius: 3,
                  background:
                    i === currentStep ? '#58a6ff'
                    : i < currentStep ? '#388bfd'
                    : '#30363d',
                  transition: 'all 0.25s ease',
                  flexShrink: 0,
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 11, color: '#484f58', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {currentStep + 1} / {totalSteps}
          </span>
        </div>

        {/* Title */}
        <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: '#e6edf3', lineHeight: 1.3 }}>
          {getStepTitle(step, lang)}
        </h3>

        {/* Description */}
        <p style={{ margin: '0 0 18px', fontSize: 13, color: '#8b949e', lineHeight: 1.65, fontWeight: 500 }}>
          {getStepDescription(step, lang)}
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={onSkip}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: '1px solid #30363d', background: 'transparent',
              color: '#8b949e', fontSize: 12, fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#484f58'; e.currentTarget.style.color = '#c9d1d9'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
          >
            {nt('skip')}
          </button>

          <div style={{ flex: 1 }} />

          {!isFirstStep && (
            <button
              onClick={handlePrev}
              style={{
                padding: '6px 14px', borderRadius: 6,
                border: '1px solid #30363d', background: '#21262d',
                color: '#c9d1d9', fontSize: 12, fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; }}
            >
              {nt('back')}
            </button>
          )}

          <button
            onClick={handleNext}
            style={{
              padding: '6px 18px', borderRadius: 6,
              border: 'none', background: '#388bfd',
              color: '#fff', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#58a6ff'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#388bfd'; }}
          >
            {isLastStep ? nt('done') : nt('next')}
          </button>
        </div>
      </div>

      {/* Click overlay → skip */}
      <div
        style={{ position: 'absolute', inset: 0, zIndex: -1 }}
        onClick={onSkip}
      />

      {/* Keyframes */}
      <style>{`
        @keyframes tutorial-pulse {
          0%   { box-shadow: 0 0 0 0   rgba(88,166,255,0.55); }
          50%  { box-shadow: 0 0 0 10px rgba(88,166,255,0);   }
          100% { box-shadow: 0 0 0 0   rgba(88,166,255,0);    }
        }
      `}</style>
    </div>
  );
}
