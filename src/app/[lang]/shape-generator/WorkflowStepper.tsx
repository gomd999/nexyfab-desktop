'use client';

import React from 'react';

interface WorkflowStepperProps {
  isSketchMode: boolean;
  sketchClosed: boolean;
  hasResult: boolean;
  featuresCount: number;
  lang: string;
}

const STEPS_KO = ['스케치', '돌출', '피쳐', '완료'];
const STEPS_EN = ['Sketch', 'Extrude', 'Features', 'Done'];
const STEPS_JA = ['スケッチ', '押し出し', 'フィーチャー', '完了'];
const STEPS_CN = ['草图', '拉伸', '特征', '完成'];
const STEPS_ES = ['Croquis', 'Extruir', 'Operaciones', 'Listo'];
const STEPS_AR = ['الرسم', 'بثق', 'الميزات', 'تم'];

const STEPS_BY_LANG: Record<string, string[]> = {
  ko: STEPS_KO,
  en: STEPS_EN,
  ja: STEPS_JA,
  cn: STEPS_CN,
  es: STEPS_ES,
  ar: STEPS_AR,
};

function getActiveStep(
  isSketchMode: boolean,
  sketchClosed: boolean,
  hasResult: boolean,
  featuresCount: number,
): number {
  if (!isSketchMode && hasResult && featuresCount > 0) return 4;
  if (!isSketchMode && hasResult) return 3;
  if (isSketchMode && sketchClosed) return 2;
  if (isSketchMode && !sketchClosed) return 1;
  return 0;
}

export default function WorkflowStepper({
  isSketchMode,
  sketchClosed,
  hasResult,
  featuresCount,
  lang,
}: WorkflowStepperProps) {
  const activeStep = getActiveStep(isSketchMode, sketchClosed, hasResult, featuresCount);
  const labels = STEPS_BY_LANG[lang] ?? STEPS_EN;

  return (
    <div className="sg-autohide" style={{
      display: 'flex',
      alignItems: 'center',
      height: 20,
      background: 'var(--nx-panel)',
      borderBottom: '1px solid var(--nx-border)',
      padding: '0 12px',
      gap: 0,
      flexShrink: 0,
      userSelect: 'none',
    }}>
      {labels.map((label, idx) => {
        const stepNum = idx + 1;
        const isDone = activeStep > stepNum;
        const isActive = activeStep === stepNum;
        const isFuture = activeStep < stepNum;

        const circleColor = isDone
          ? 'var(--nx-ok)'
          : isActive
          ? 'var(--nx-accent)'
          : 'var(--nx-border-strong)';

        const textColor = isDone
          ? 'var(--nx-ok)'
          : isActive
          ? 'var(--nx-text)'
          : 'var(--nx-border-strong)';

        return (
          <React.Fragment key={stepNum}>
            {idx > 0 && (
              <div style={{
                flex: 1,
                height: 1,
                background: isDone ? 'var(--nx-ok)' : 'var(--nx-border)',
                minWidth: 16,
                maxWidth: 48,
                transition: 'background 0.2s',
              }} />
            )}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              opacity: isFuture ? 0.45 : 1,
              transition: 'opacity 0.2s',
            }}>
              <div style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                background: circleColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 8,
                fontWeight: 700,
                color: 'var(--nx-text)',
                flexShrink: 0,
                transition: 'background 0.2s',
                boxShadow: isActive ? `0 0 5px ${circleColor}80` : 'none',
              }}>
                {isDone ? (
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                    <polyline points="2,5 4,8 8,2" stroke="var(--nx-text)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : stepNum}
              </div>
              <span style={{
                fontSize: 10,
                fontWeight: isActive ? 700 : 500,
                color: textColor,
                transition: 'color 0.2s',
                whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
