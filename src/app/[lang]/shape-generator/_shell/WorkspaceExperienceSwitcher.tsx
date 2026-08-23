'use client';

import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

export type WorkspaceExperienceMode = 'studio' | 'expert';

type WorkspaceCopy = {
  label: string;
  guided: string;
  expert: string;
  note: string;
  current: string;
};

const WORKSPACE_COPY: Record<IsoLang, WorkspaceCopy> = {
  ko: {
    label: '작업 화면', guided: 'AI 안내', expert: '전문 CAD', current: '현재',
    note: '화면만 전환합니다. 검증 상태는 자동으로 승격되지 않습니다.',
  },
  en: {
    label: 'Workspace view', guided: 'Guided AI', expert: 'Expert CAD', current: 'Current',
    note: 'This changes the workspace view only. Verification is not promoted automatically.',
  },
  ja: {
    label: 'ワークスペース表示', guided: 'AIガイド', expert: 'エキスパートCAD', current: '現在',
    note: 'ワークスペース表示だけを切り替えます。検証状態は自動的に昇格しません。',
  },
  zh: {
    label: '工作区视图', guided: 'AI 引导', expert: '专家 CAD', current: '当前',
    note: '仅切换工作区视图，验证状态不会自动升级。',
  },
  es: {
    label: 'Vista del espacio de trabajo', guided: 'IA guiada', expert: 'CAD experto', current: 'Actual',
    note: 'Solo cambia la vista del espacio de trabajo. La verificación no se promociona automáticamente.',
  },
  ar: {
    label: 'عرض مساحة العمل', guided: 'ذكاء اصطناعي موجّه', expert: 'CAD متقدم', current: 'الحالي',
    note: 'يغيّر هذا عرض مساحة العمل فقط. لا تتم ترقية حالة التحقق تلقائيًا.',
  },
};

export function WorkspaceExperienceSwitcher({
  mode,
  lang,
  onChange,
}: {
  mode: WorkspaceExperienceMode;
  lang: string;
  onChange: (mode: WorkspaceExperienceMode) => void;
}) {
  const copy = WORKSPACE_COPY[toIsoLang(lang)];
  const { label, guided, expert, current: currentLabel, note } = copy;
  const current = mode === 'studio' ? guided : expert;

  return (
    <aside
      aria-label={label}
      data-testid="workspace-experience-switcher"
      style={{
        position: 'fixed', bottom: 14, left: 14, zIndex: 9998,
        display: 'grid', gap: 5, minWidth: 250, padding: 8,
        border: '1px solid var(--nx-border, #334155)', borderRadius: 10,
        background: 'var(--nx-panel, #0f172a)', color: 'var(--nx-text, #f8fafc)',
        boxShadow: '0 6px 20px rgba(2,6,23,0.35)',
      }}
    >
      <div role="group" aria-label={label} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {([
          ['studio', guided],
          ['expert', expert],
        ] as const).map(([value, text]) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(value)}
              style={{
                minHeight: 34, border: `1px solid ${active ? 'var(--nx-accent, #10b981)' : 'var(--nx-border, #334155)'}`,
                borderRadius: 7, background: active ? 'var(--nx-accent, #10b981)' : 'transparent',
                color: active ? 'var(--nx-on-accent, #052e24)' : 'inherit', fontSize: 12, fontWeight: 800,
                cursor: active ? 'default' : 'pointer',
              }}
            >
              {text}
            </button>
          );
        })}
      </div>
      <span role="status" aria-live="polite" aria-atomic="true" style={{ fontSize: 10, lineHeight: 1.35, color: 'var(--nx-text-2, #cbd5e1)' }}>
        <strong>{currentLabel}: {current}</strong> · {note}
      </span>
    </aside>
  );
}
