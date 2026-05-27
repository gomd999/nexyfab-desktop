'use client';

/**
 * ModelerFirstStepsChecklist.tsx
 *
 * In-modeler 5-step learning checklist for first-time users. Lives
 * docked at the bottom-left of the viewport, collapsible, and
 * auto-dismisses once all 5 steps are completed (or user clicks
 * "Got it").
 *
 * Differentiated from the existing dashboard-level
 * `OnboardingChecklist` (project / RFQ-scoped). This is *modeler*-
 * scoped: each step represents a learning milestone inside the
 * editing surface.
 *
 * State persistence via localStorage so the same user's progress
 * survives across sessions. Cleared when checklist is dismissed.
 */

import React, { useEffect, useState } from 'react';

export type StepKey = 'template' | 'modify' | 'export' | 'render' | 'save';

export interface ModelerFirstStepsChecklistProps {
  lang: string;
  /** Map of completed steps. Caller flips these as user does each action. */
  completed: Record<StepKey, boolean>;
  /** Optional collapse state — defaults to open. */
  defaultCollapsed?: boolean;
}

const STORAGE_DISMISSED = 'nexyfab_modeler_checklist_dismissed_v1';
const STORAGE_COLLAPSED = 'nexyfab_modeler_checklist_collapsed_v1';

const STEPS: ReadonlyArray<{
  key: StepKey;
  ko: string;
  en: string;
  hintKo: string;
  hintEn: string;
}> = [
  { key: 'template', ko: '템플릿 열기',     en: 'Open a template',         hintKo: '왼쪽 + 버튼으로 시작',           hintEn: 'Click the + button on the left' },
  { key: 'modify',   ko: '치수 1개 수정',   en: 'Change a dimension',      hintKo: 'Feature Tree의 숫자 클릭',       hintEn: 'Click a number in the Feature Tree' },
  { key: 'export',   ko: 'STL 다운로드',    en: 'Download STL',            hintKo: '오른쪽 아래 큰 버튼 또는 Ctrl+E', hintEn: 'Bottom-right button or Ctrl+E' },
  { key: 'render',   ko: '렌더 한 번 보기', en: 'Try a photorealistic render', hintKo: 'Ribbon의 Render 탭',           hintEn: 'Render tab on the ribbon' },
  { key: 'save',     ko: '프로젝트 저장',   en: 'Save your project',       hintKo: 'Ctrl+S 또는 File → Save',         hintEn: 'Ctrl+S or File → Save' },
];

export default function ModelerFirstStepsChecklist({
  lang, completed, defaultCollapsed = false,
}: ModelerFirstStepsChecklistProps) {
  const [dismissed, setDismissed] = useState(true);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_DISMISSED) === 'true');
      setCollapsed(window.localStorage.getItem(STORAGE_COLLAPSED) === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  const ko = lang === 'ko' || lang === 'kr';
  const t = ko
    ? { title: '5분 안내', dismiss: '닫기', completeMsg: '🎉 첫 부품 완성! 손에 받을 준비 됐어요.' }
    : { title: '5-min walkthrough', dismiss: 'Dismiss', completeMsg: '🎉 First part shipped — ready to order!' };

  const doneCount = STEPS.filter(s => completed[s.key]).length;
  const allDone = doneCount === STEPS.length;

  // Auto-dismiss when all 5 are checked + persist.
  useEffect(() => {
    if (allDone && !dismissed) {
      const timer = window.setTimeout(() => {
        try { window.localStorage.setItem(STORAGE_DISMISSED, 'true'); } catch { /* ok */ }
        setDismissed(true);
      }, 4000);
      return () => window.clearTimeout(timer);
    }
  }, [allDone, dismissed]);

  if (dismissed) return null;

  return (
    <div
      style={{
        position: 'fixed',
        // Sit above the bottom chrome (status bar + DFM/FEA tab row, ~64px) so
        // the onboarding panel doesn't cover the dimensions readout / axis gizmo.
        bottom: 72,
        left: 20,
        zIndex: 700,
        width: collapsed ? 'auto' : 280,
        background: '#1e293b',
        color: '#f1f5f9',
        borderRadius: 10,
        boxShadow: '0 8px 22px rgba(0,0,0,0.35)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        overflow: 'hidden',
      }}
      role="region"
      aria-label={t.title}
    >
      <button
        type="button"
        onClick={() => {
          const next = !collapsed;
          setCollapsed(next);
          try { window.localStorage.setItem(STORAGE_COLLAPSED, String(next)); } catch { /* ok */ }
        }}
        style={{
          width: '100%',
          background: '#0f172a',
          color: '#e2e8f0',
          border: 'none',
          padding: '10px 14px',
          textAlign: 'left',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span>
          {t.title}
          <span style={{ color: '#94a3b8', fontWeight: 400, marginLeft: 8 }}>
            {doneCount}/{STEPS.length}
          </span>
        </span>
        <span aria-hidden style={{ fontSize: 11 }}>{collapsed ? '▸' : '▾'}</span>
      </button>

      {!collapsed && (
        <ul style={{ listStyle: 'none', padding: '10px 14px 12px', margin: 0 }}>
          {STEPS.map(step => {
            const done = completed[step.key];
            return (
              <li
                key={step.key}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '6px 0',
                  opacity: done ? 0.6 : 1,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 18, height: 18, borderRadius: 4,
                    background: done ? '#22c55e' : 'transparent',
                    border: done ? 'none' : '1.5px solid #475569',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: 'white', flexShrink: 0, marginTop: 1,
                  }}
                >
                  {done ? '✓' : ''}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ textDecoration: done ? 'line-through' : 'none' }}>
                    {ko ? step.ko : step.en}
                  </div>
                  {!done && (
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      {ko ? step.hintKo : step.hintEn}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {allDone && (
            <div style={{
              marginTop: 8, padding: '8px 10px',
              background: '#0f172a', borderRadius: 6,
              fontSize: 12, color: '#86efac', textAlign: 'center',
            }}>
              {t.completeMsg}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              try { window.localStorage.setItem(STORAGE_DISMISSED, 'true'); } catch { /* ok */ }
              setDismissed(true);
            }}
            style={{
              marginTop: 10,
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: 11,
              cursor: 'pointer',
              display: 'block',
              width: '100%', textAlign: 'right',
            }}
          >
            {t.dismiss}
          </button>
        </ul>
      )}
    </div>
  );
}
