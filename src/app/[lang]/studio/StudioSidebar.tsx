'use client';

/** ChatGPT/Gemini-style left rail for Studio: new design, search, recent
 *  designs history, links into the expert app, theme toggle, and account.
 *  Colours come from the global --nx- theme vars so it follows light/dark. */
import React, { useMemo, useState } from 'react';
import type { StudioDesign } from './studioDesigns';

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
  lang, isKo, designs, currentId, userName, open, theme, onToggleTheme, onClose, onNew, onLoad, onDelete, onExpert,
}: Props) {
  const T = (ko: string, en: string) => (isKo ? ko : en);
  const [q, setQ] = useState('');
  const filtered = useMemo(
    () => (q.trim() ? designs.filter(d => d.title.toLowerCase().includes(q.trim().toLowerCase())) : designs),
    [q, designs],
  );

  // Pinned nav row — quiet by default, soft tinted hover, no underline.
  const Item = ({ icon, label, onClick, href }: { icon: string; label: string; onClick?: () => void; href?: string }) => {
    const cls = 'group/it flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] st-text-2 no-underline st-hover transition-colors cursor-pointer';
    const inner = (
      <>
        <span className="w-5 h-5 grid place-items-center text-[13px] opacity-80 group-hover/it:opacity-100">{icon}</span>
        <span className="truncate">{label}</span>
      </>
    );
    return href
      ? <a href={href} className={cls}>{inner}</a>
      : <button onClick={onClick} className={`${cls} w-full text-left`}>{inner}</button>;
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden" onClick={onClose} />}
      <aside className={`${open ? 'flex' : 'hidden'} md:flex fixed md:static z-40 left-0 top-0 h-dvh w-[264px] shrink-0 flex-col st-panel border-r st-bd`}>
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          <span className="w-7 h-7 shrink-0 rounded-[9px] grid place-items-center text-white text-[13px] font-black bg-gradient-to-br from-emerald-400 to-teal-500 shadow-sm shadow-emerald-500/30">N</span>
          <span className="text-[15px] font-bold tracking-tight st-text leading-none">NexyFab <span className="text-emerald-500">Studio</span></span>
          <button onClick={onClose} className="md:hidden ml-auto st-text-3 hover:opacity-70" aria-label="close">✕</button>
        </div>

        {/* Primary action — premium gradient */}
        <div className="px-3 pt-0.5 pb-2.5">
          <button
            onClick={onNew}
            className="group w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-500 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/35 hover:brightness-[1.06] active:brightness-95 transition-all"
          >
            <span className="grid place-items-center w-5 h-5 rounded-full bg-white/20 text-[14px] leading-none group-hover:rotate-90 transition-transform duration-200">+</span>
            {T('새 디자인', 'New design')}
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-1">
          <div className="flex items-center gap-2 st-input border st-bd rounded-lg px-2.5 py-2 focus-within:border-emerald-500/60 transition-colors">
            <span className="st-text-3 text-[13px]">🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={T('디자인 검색', 'Search designs')} className="flex-1 bg-transparent text-[12px] focus:outline-none st-text placeholder:st-text-3" />
          </div>
        </div>

        {/* Pinned nav */}
        <div className="px-2 pt-2 flex flex-col gap-0.5">
          <Item icon="📁" label={T('프로젝트', 'Projects')} href={`/${lang}/nexyfab/projects`} />
          <Item icon="🔩" label={T('부품 라이브러리', 'Part library')} href={`/${lang}/nexyfab/cots`} />
        </div>

        <div className="mx-3.5 my-2.5 h-px bg-current opacity-10" />

        {/* Recent */}
        <div className="flex-1 overflow-auto px-2 min-h-0">
          <div className="px-1.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] st-text-3">{T('최근 디자인', 'Recent')}</div>
          {filtered.length === 0 && (
            <div className="px-2.5 py-3 text-[11px] st-text-3 leading-relaxed">{T('아직 디자인이 없어요. “새 디자인”으로 시작해 보세요.', 'No designs yet — start with “New design”.')}</div>
          )}
          {filtered.map(d => (
            <div
              key={d.id}
              className={`group flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${d.id === currentId ? 'st-panel-2 ring-1 ring-emerald-500/30' : 'st-hover'}`}
              onClick={() => onLoad(d.id)}
            >
              {d.thumb
                ? <img src={d.thumb} alt="" className="w-8 h-8 rounded-md object-cover bg-black/20 shrink-0 ring-1 ring-black/5" />
                : <span className="w-8 h-8 rounded-md st-panel-2 grid place-items-center text-[12px] shrink-0">🧊</span>}
              <span className={`flex-1 truncate text-[12px] ${d.id === currentId ? 'st-text font-medium' : 'st-text-2'}`} title={d.title}>{d.title}</span>
              <button onClick={e => { e.stopPropagation(); onDelete(d.id); }} className="opacity-0 group-hover:opacity-100 st-text-3 hover:text-red-400 text-xs shrink-0 transition-opacity" aria-label="delete">✕</button>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t st-bd p-2 flex flex-col gap-1">
          <button
            onClick={onExpert}
            className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] font-semibold text-indigo-500 hover:bg-indigo-500/10 no-underline transition-colors"
            title={T('전문 CAD 모델러', 'Expert CAD modeler')}
          >
            <span className="w-5 h-5 grid place-items-center">🛠️</span>
            <span className="flex-1 text-left">{T('전문가형 CAD', 'Expert CAD')}</span>
            <span className="st-text-3 group-hover:translate-x-0.5">→</span>
          </button>
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg st-hover transition-colors">
            <span className="w-7 h-7 shrink-0 rounded-full bg-gradient-to-br from-emerald-500 to-indigo-500 grid place-items-center text-[11px] font-bold text-white">{(userName ?? 'G')[0]?.toUpperCase()}</span>
            <span className="flex-1 truncate text-[12px] st-text-2">{userName ?? T('게스트', 'Guest')}</span>
            <button onClick={onToggleTheme} className="st-text-3 hover:opacity-70 text-sm" title={T('테마 전환', 'Toggle theme')} aria-label="toggle theme">{theme === 'dark' ? '☀️' : '🌙'}</button>
            {!userName && <a href={`/login?next=${encodeURIComponent(`/${lang}/studio`)}`} className="text-[11px] font-semibold text-emerald-500 hover:text-emerald-400 no-underline">{T('로그인', 'Sign in')}</a>}
          </div>
        </div>
      </aside>
    </>
  );
}
