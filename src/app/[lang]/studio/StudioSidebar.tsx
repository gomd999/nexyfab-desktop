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

  const Item = ({ icon, label, onClick, href }: { icon: string; label: string; onClick?: () => void; href?: string }) => {
    const cls = 'flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] st-text-2 st-hover cursor-pointer';
    return href
      ? <a href={href} className={cls}><span className="w-4 text-center">{icon}</span>{label}</a>
      : <button onClick={onClick} className={`${cls} w-full text-left`}><span className="w-4 text-center">{icon}</span>{label}</button>;
  };

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onClose} />}
      <aside className={`${open ? 'flex' : 'hidden'} md:flex fixed md:static z-40 left-0 top-0 h-dvh w-[260px] shrink-0 flex-col st-panel border-r st-bd`}>
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-[15px] font-bold tracking-tight st-text">NexyFab <span className="text-emerald-500">Studio</span></span>
          <button onClick={onClose} className="md:hidden st-text-3 hover:opacity-70" aria-label="close">✕</button>
        </div>

        <div className="px-2 flex flex-col gap-0.5">
          <button onClick={onNew} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-500">
            <span>✏️</span>{T('새 디자인', 'New design')}
          </button>
        </div>

        <div className="px-3 pt-2">
          <div className="flex items-center gap-2 st-input border rounded-lg px-2 py-1.5">
            <span className="st-text-3 text-xs">🔍</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={T('디자인 검색', 'Search designs')} className="flex-1 bg-transparent text-[12px] focus:outline-none st-text" />
          </div>
        </div>

        <div className="px-2 pt-2 flex flex-col gap-0.5">
          <Item icon="📁" label={T('프로젝트', 'Projects')} href={`/${lang}/nexyfab/projects`} />
          <Item icon="🔩" label={T('부품 라이브러리', 'Part library')} href={`/${lang}/nexyfab/cots`} />
        </div>

        <div className="flex-1 overflow-auto px-2 pt-3 min-h-0">
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide st-text-3">{T('최근 디자인', 'Recent')}</div>
          {filtered.length === 0 && <div className="px-2 py-1 text-[11px] st-text-3">{T('아직 없어요', 'Nothing yet')}</div>}
          {filtered.map(d => (
            <div key={d.id} className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer ${d.id === currentId ? 'st-panel-2' : 'st-hover'}`} onClick={() => onLoad(d.id)}>
              {d.thumb ? <img src={d.thumb} alt="" className="w-7 h-7 rounded object-cover bg-black/20 shrink-0" /> : <span className="w-7 h-7 rounded st-panel-2 flex items-center justify-center text-[11px] shrink-0">🧊</span>}
              <span className="flex-1 truncate text-[12px] st-text-2" title={d.title}>{d.title}</span>
              <button onClick={e => { e.stopPropagation(); onDelete(d.id); }} className="opacity-0 group-hover:opacity-100 st-text-3 hover:text-red-400 text-xs shrink-0" aria-label="delete">✕</button>
            </div>
          ))}
        </div>

        <div className="border-t st-bd p-2 flex flex-col gap-1">
          <button onClick={onExpert} className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12px] font-semibold text-indigo-500 st-hover" title={T('전문 CAD 모델러', 'Expert CAD modeler')}>
            <span>🛠️</span>{T('전문가형 CAD →', 'Expert CAD →')}
          </button>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-indigo-500 flex items-center justify-center text-[11px] font-bold text-white">{(userName ?? 'G')[0]?.toUpperCase()}</span>
            <span className="flex-1 truncate text-[12px] st-text-2">{userName ?? T('게스트', 'Guest')}</span>
            <button onClick={onToggleTheme} className="st-text-3 hover:opacity-70 text-sm" title={T('테마 전환', 'Toggle theme')} aria-label="toggle theme">{theme === 'dark' ? '☀️' : '🌙'}</button>
            {!userName && <a href={`/${lang}/login`} className="text-[11px] text-emerald-500 hover:text-emerald-400">{T('로그인', 'Sign in')}</a>}
          </div>
        </div>
      </aside>
    </>
  );
}
