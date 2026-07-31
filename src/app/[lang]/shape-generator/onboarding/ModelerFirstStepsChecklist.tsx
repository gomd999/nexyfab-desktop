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
import { loc } from '@/lib/i18n/loc';

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
  ja: string;
  zh: string;
  es: string;
  ar: string;
  hintKo: string;
  hintEn: string;
  hintJa: string;
  hintZh: string;
  hintEs: string;
  hintAr: string;
}> = [
  { key: 'template', ko: '템플릿 열기',     en: 'Open a template',         hintKo: '왼쪽 + 버튼으로 시작',           hintEn: 'Click the + button on the left', ja: 'テンプレートを開く', zh: '打开模板', es: 'Abrir una plantilla', ar: 'افتح قالباً', hintJa: '左の + ボタンから開始', hintZh: '点击左侧的 + 按钮', hintEs: 'Haga clic en el botón + de la izquierda', hintAr: 'انقر زر + على اليسار' },
  { key: 'modify',   ko: '치수 1개 수정',   en: 'Change a dimension',      hintKo: 'Feature Tree의 숫자 클릭',       hintEn: 'Click a number in the Feature Tree', ja: '寸法を 1 つ変更', zh: '修改一个尺寸', es: 'Cambiar una cota', ar: 'غيّر بُعداً واحداً', hintJa: 'フィーチャーツリーの数値をクリック', hintZh: '点击特征树中的数字', hintEs: 'Haga clic en un número del árbol de operaciones', hintAr: 'انقر رقماً في شجرة المعالم' },
  { key: 'export',   ko: 'STL 다운로드',    en: 'Download STL',            hintKo: '오른쪽 아래 큰 버튼 또는 Ctrl+E', hintEn: 'Bottom-right button or Ctrl+E', ja: 'STL をダウンロード', zh: '下载 STL', es: 'Descargar STL', ar: 'نزّل ملف STL', hintJa: '右下の大きなボタンまたは Ctrl+E', hintZh: '右下角的大按钮或 Ctrl+E', hintEs: 'Botón inferior derecho o Ctrl+E', hintAr: 'الزر الكبير أسفل اليمين أو Ctrl+E' },
  { key: 'render',   ko: '렌더 한 번 보기', en: 'Try a photorealistic render', hintKo: 'Ribbon의 Render 탭',           hintEn: 'Render tab on the ribbon', ja: 'レンダリングを試す', zh: '试用真实感渲染', es: 'Probar un render fotorrealista', ar: 'جرّب عرضاً واقعياً', hintJa: 'リボンの Render タブ', hintZh: '功能区的 Render 选项卡', hintEs: 'Pestaña Render de la cinta', hintAr: 'تبويب Render في الشريط' },
  { key: 'save',     ko: '프로젝트 저장',   en: 'Save your project',       hintKo: 'Ctrl+S 또는 File → Save',         hintEn: 'Ctrl+S or File → Save', ja: 'プロジェクトを保存', zh: '保存项目', es: 'Guardar el proyecto', ar: 'احفظ المشروع', hintJa: 'Ctrl+S または File → Save', hintZh: 'Ctrl+S 或 File → Save', hintEs: 'Ctrl+S o Archivo → Guardar', hintAr: 'Ctrl+S أو File → Save' },
];

export default function ModelerFirstStepsChecklist({
  lang, completed, defaultCollapsed = true,
}: ModelerFirstStepsChecklistProps) {
  const [dismissed, setDismissed] = useState(true);
  // Start COLLAPSED (a small pill) so the checklist isn't a persistent panel
  // across every mode — the user expands it on demand (2026-06-09 UX cleanup).
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(STORAGE_DISMISSED) === 'true');
      // Collapsed unless the user explicitly expanded it before (stored 'false').
      setCollapsed(window.localStorage.getItem(STORAGE_COLLAPSED) !== 'false');
    } catch {
      setDismissed(false);
    }
  }, []);

  const ko = lang === 'ko' || lang === 'kr';
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = {
    title: loc(lang, { ko: '5분 안내', en: '5-min walkthrough', ja: '5 分ガイド', zh: '5 分钟导览', es: 'Guía de 5 minutos', ar: 'جولة في 5 دقائق' }),
    dismiss: loc(lang, { ko: '닫기', en: 'Dismiss', ja: '閉じる', zh: '关闭', es: 'Descartar', ar: 'إغلاق' }),
    completeMsg: loc(lang, {
      ko: '🎉 첫 부품 완성! 손에 받을 준비 됐어요.',
      en: '🎉 First part shipped — ready to order!',
      ja: '🎉 最初の部品が完成 — 発注の準備ができました！',
      zh: '🎉 第一个零件完成 — 可以下单了！',
      es: '🎉 ¡Primera pieza lista para pedir!',
      ar: '🎉 اكتملت أول قطعة — جاهزة للطلب!',
    }),
  };

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
        background: 'var(--nx-panel-2)',
        color: 'var(--nx-text)',
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
          background: 'var(--nx-panel)',
          color: 'var(--nx-text)',
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
          <span style={{ color: 'var(--nx-text-2)', fontWeight: 400, marginLeft: 8 }}>
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
                    border: done ? 'none' : '1.5px solid var(--nx-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, color: 'white', flexShrink: 0, marginTop: 1,
                  }}
                >
                  {done ? '✓' : ''}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ textDecoration: done ? 'line-through' : 'none' }}>
                    {loc(lang, step)}
                  </div>
                  {!done && (
                    <div style={{ fontSize: 11, color: 'var(--nx-text-2)', marginTop: 2 }}>
                      {loc(lang, { ko: step.hintKo, en: step.hintEn, ja: step.hintJa, zh: step.hintZh, es: step.hintEs, ar: step.hintAr })}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {allDone && (
            <div style={{
              marginTop: 8, padding: '8px 10px',
              background: 'var(--nx-panel)', borderRadius: 6,
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
              color: 'var(--nx-text-2)',
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
