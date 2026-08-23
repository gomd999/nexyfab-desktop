'use client';

/** ChatGPT/Gemini-style left rail for Studio: new design, search, recent
 *  designs history, links into the expert app, theme toggle, and account.
 *  Colours come from the global --nx- theme vars (the site's blue accent) so it
 *  matches the rest of NexyFab and follows light/dark automatically. */
import React, { useMemo, useState } from 'react';
import type { StudioDesign } from './studioDesigns';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

const COPY: Record<IsoLang, {
  close: string; newDesign: string; search: string; projects: string; parts: string;
  recent: string; empty: string; deleteDesign: string; expertTitle: string;
  expert: string; guest: string; theme: string; signIn: string;
}> = {
  ko: { close: '닫기', newDesign: '새 디자인', search: '디자인 검색', projects: '프로젝트', parts: '부품 라이브러리', recent: '최근 디자인', empty: '아직 디자인이 없어요. “새 디자인”으로 시작해 보세요.', deleteDesign: '디자인 삭제', expertTitle: '전문 CAD 모델러', expert: '전문가형 CAD', guest: '게스트', theme: '테마 전환', signIn: '로그인' },
  en: { close: 'Close', newDesign: 'New design', search: 'Search designs', projects: 'Projects', parts: 'Part library', recent: 'Recent', empty: 'No designs yet — start with “New design”.', deleteDesign: 'Delete design', expertTitle: 'Expert CAD modeler', expert: 'Expert CAD', guest: 'Guest', theme: 'Toggle theme', signIn: 'Sign in' },
  ja: { close: '閉じる', newDesign: '新しいデザイン', search: 'デザインを検索', projects: 'プロジェクト', parts: '部品ライブラリ', recent: '最近のデザイン', empty: 'デザインはまだありません。「新しいデザイン」から始めましょう。', deleteDesign: 'デザインを削除', expertTitle: 'エキスパート CAD モデラー', expert: 'エキスパート CAD', guest: 'ゲスト', theme: 'テーマを切り替え', signIn: 'ログイン' },
  zh: { close: '关闭', newDesign: '新建设计', search: '搜索设计', projects: '项目', parts: '零件库', recent: '最近设计', empty: '暂无设计，请从“新建设计”开始。', deleteDesign: '删除设计', expertTitle: '专业 CAD 建模器', expert: '专业 CAD', guest: '访客', theme: '切换主题', signIn: '登录' },
  es: { close: 'Cerrar', newDesign: 'Nuevo diseño', search: 'Buscar diseños', projects: 'Proyectos', parts: 'Biblioteca de piezas', recent: 'Recientes', empty: 'Aún no hay diseños. Empiece con “Nuevo diseño”.', deleteDesign: 'Eliminar diseño', expertTitle: 'Modelador CAD experto', expert: 'CAD experto', guest: 'Invitado', theme: 'Cambiar tema', signIn: 'Iniciar sesión' },
  ar: { close: 'إغلاق', newDesign: 'تصميم جديد', search: 'البحث في التصاميم', projects: 'المشروعات', parts: 'مكتبة الأجزاء', recent: 'التصاميم الأخيرة', empty: 'لا توجد تصاميم بعد. ابدأ بـ «تصميم جديد».', deleteDesign: 'حذف التصميم', expertTitle: 'مصمم CAD احترافي', expert: 'CAD احترافي', guest: 'زائر', theme: 'تبديل السمة', signIn: 'تسجيل الدخول' },
};

interface Props {
  lang: string;
  isKo: boolean;
  designs: StudioDesign[];
  currentId: string | null;
  userName?: string | null;
  open: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onClose: () => void;
  onNew: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onExpert: () => void;
}

export default function StudioSidebar({
  lang, designs, currentId, userName, open, theme, onToggleTheme, onClose, onNew, onLoad, onDelete, onExpert,
}: Props) {
  const t = COPY[toIsoLang(lang)];
  const [q, setQ] = useState('');
  const filtered = useMemo(
    () => (q.trim() ? designs.filter(d => d.title.toLowerCase().includes(q.trim().toLowerCase())) : designs),
    [q, designs],
  );

  // Pinned nav row — quiet by default, soft tinted hover, no underline (the
  // studio page lacks Tailwind preflight so <a> would otherwise underline).
  const Item = ({ icon, label, onClick, href }: { icon: string; label: string; onClick?: () => void; href?: string }) => {
    const cls = 'group/it flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] st-text-2 st-hover transition-colors cursor-pointer';
    const inner = (
      <>
        <span className="w-5 h-5 grid place-items-center text-[13px] opacity-80 group-hover/it:opacity-100">{icon}</span>
        <span className="truncate">{label}</span>
      </>
    );
    return href
      ? <a href={href} className={cls} style={{ textDecoration: 'none' }}>{inner}</a>
      : <button onClick={onClick} className={`${cls} w-full text-left`}>{inner}</button>;
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden" onClick={onClose} />}
      <aside className={`${open ? 'flex' : 'hidden'} md:flex fixed md:static z-40 left-0 top-0 h-dvh w-[264px] shrink-0 flex-col st-panel border-r st-bd`}>
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          <span
            className="w-7 h-7 shrink-0 rounded-[9px] grid place-items-center text-white text-[13px] font-black shadow-sm"
            style={{ background: 'linear-gradient(135deg, var(--nx-accent-2), var(--nx-accent))' }}
          >N</span>
          <span className="text-[15px] font-bold tracking-tight st-text leading-none">
            NexyFab <span style={{ color: 'var(--nx-accent)' }}>Studio</span>
          </span>
          <button onClick={onClose} className="md:hidden ml-auto st-text-3 hover:opacity-70" aria-label={t.close}>✕</button>
        </div>

        {/* Primary action — site-blue gradient */}
        <div className="px-3 pt-0.5 pb-2.5">
          <button
            onClick={onNew}
            className="group w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold text-white hover:brightness-[1.07] active:brightness-95 transition-all"
            style={{
              background: 'linear-gradient(90deg, var(--nx-accent), var(--nx-accent-2))',
              boxShadow: '0 6px 18px -2px var(--nx-accent-line)',
            }}
          >
            <span className="grid place-items-center w-5 h-5 rounded-full bg-white/20 text-[14px] leading-none group-hover:rotate-90 transition-transform duration-200">+</span>
            {t.newDesign}
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-1">
          <div
            className="flex items-center gap-2 st-input border st-bd rounded-lg px-2.5 py-2 transition-colors"
            style={{ ['--tw-ring-color' as string]: 'var(--nx-accent)' }}
          >
            <span className="st-text-3 text-[13px]">🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.search} className="flex-1 bg-transparent text-[12px] focus:outline-none st-text placeholder:st-text-3" />
          </div>
        </div>

        {/* Pinned nav */}
        <div className="px-2 pt-2 flex flex-col gap-0.5">
          <Item icon="📁" label={t.projects} href={`/${lang}/nexyfab/projects`} />
          <Item icon="🔩" label={t.parts} href={`/${lang}/nexyfab/cots`} />
        </div>

        <div className="mx-3.5 my-2.5 h-px bg-current opacity-10" />

        {/* Recent */}
        <div className="flex-1 overflow-auto px-2 min-h-0">
          <div className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] st-text-3">{t.recent}</div>
          {filtered.length === 0 && (
            <div className="px-2.5 py-3 text-[11px] st-text-3 leading-relaxed">{t.empty}</div>
          )}
          {filtered.map(d => (
            <div
              key={d.id}
              className="group flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors st-hover"
              style={d.id === currentId ? { background: 'var(--nx-accent-soft)', boxShadow: 'inset 0 0 0 1px var(--nx-accent-line)' } : undefined}
              onClick={() => onLoad(d.id)}
            >
              {d.thumb
                ? <img src={d.thumb} alt="" className="w-8 h-8 rounded-md object-cover bg-black/20 shrink-0 ring-1 ring-black/5" />
                : <span className="w-8 h-8 rounded-md st-panel-2 grid place-items-center text-[12px] shrink-0">🧊</span>}
              <span className={`flex-1 truncate text-[12px] ${d.id === currentId ? 'st-text font-medium' : 'st-text-2'}`} title={d.title}>{d.title}</span>
              <button onClick={e => { e.stopPropagation(); onDelete(d.id); }} className="opacity-0 group-hover:opacity-100 st-text-3 hover:text-red-400 text-xs shrink-0 transition-opacity" aria-label={t.deleteDesign}>✕</button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t st-bd p-2 flex flex-col gap-1">
          <button
            onClick={onExpert}
            className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] font-semibold transition-colors"
            style={{ color: 'var(--nx-accent-2)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-accent-soft)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            title={t.expertTitle}
          >
            <span className="w-5 h-5 grid place-items-center">🛠️</span>
            <span className="flex-1 text-left">{t.expert}</span>
            <span className="st-text-3 group-hover:translate-x-0.5 transition-transform">→</span>
          </button>
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg st-hover transition-colors">
            <span
              className="w-7 h-7 shrink-0 rounded-full grid place-items-center text-[11px] font-bold text-white"
              style={{ background: 'linear-gradient(135deg, var(--nx-accent-2), var(--nx-accent))' }}
            >{(userName ?? 'G')[0]?.toUpperCase()}</span>
            <span className="flex-1 truncate text-[12px] st-text-2">{userName ?? t.guest}</span>
            <button onClick={onToggleTheme} className="st-text-3 hover:opacity-70 text-sm" title={t.theme} aria-label={t.theme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
            {!userName && <a href={`/login?next=${encodeURIComponent(`/${lang}/studio`)}`} className="text-[11px] font-semibold hover:opacity-80" style={{ color: 'var(--nx-accent)', textDecoration: 'none' }}>{t.signIn}</a>}
          </div>
        </div>
      </aside>
    </>
  );
}
