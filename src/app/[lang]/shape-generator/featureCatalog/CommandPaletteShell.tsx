'use client';

/**
 * CommandPaletteShell.tsx — ⌘K modal that drives the command palette.
 *
 * Press ⌘K (Mac) / Ctrl-K (Win) anywhere in the shell to open. Type
 * to fuzzy-search the registry. Arrow keys navigate, Enter activates.
 *
 * Wires `commandPalette.ts` (logic) to React state + DOM events. The
 * actual feature activation is delegated to a caller-supplied
 * `onActivate(featureId)` callback so this component stays UI-only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FrecencyTracker,
  searchPalette,
  initPaletteNav,
  navUp,
  navDown,
  getCurrentHit,
  type PaletteNavState,
  type PaletteHit,
} from './commandPalette';
import type { FeatureLicense } from './registry';
import { loc } from '@/lib/i18n/loc';

export interface CommandPaletteShellProps {
  lang?: string;
  /** True when the modal should be visible. */
  open: boolean;
  /** Close request from the modal (ESC / outside-click). */
  onClose: () => void;
  /** Activate a feature by id. */
  onActivate: (featureId: string) => void;
  /** User's tier — entries above this tier won't show. */
  userTier?: FeatureLicense;
  /** Frecency tracker (persisted by parent). */
  frecency?: FrecencyTracker;
  /** Max results to display. */
  maxResults?: number;
}

export function CommandPaletteShell({
  lang,
  open,
  onClose,
  onActivate,
  userTier = 'free',
  frecency,
  maxResults = 10,
}: CommandPaletteShellProps) {
  const copy = {
    dialog: loc(lang, { ko: '명령 팔레트', en: 'Command palette', ja: 'コマンドパレット', zh: '命令面板', es: 'Paleta de comandos', ar: 'لوحة الأوامر' }),
    search: loc(lang, { ko: '기능 검색…  (⌘K)', en: 'Search features…  (⌘K)', ja: '機能を検索…  (⌘K)', zh: '搜索功能…  (⌘K)', es: 'Buscar funciones…  (⌘K)', ar: 'البحث في الميزات…  (⌘K)' }),
    noMatches: loc(lang, { ko: '일치하는 기능이 없습니다', en: 'No matches', ja: '一致する機能はありません', zh: '没有匹配项', es: 'Sin coincidencias', ar: 'لا توجد نتائج مطابقة' }),
  };
  const [query, setQuery] = useState('');
  const [navState, setNavState] = useState<PaletteNavState>(() => initPaletteNav([]));
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Recompute hits whenever the query changes.
  const hits = useMemo<PaletteHit[]>(
    () => searchPalette(query, { userTier, frecency, maxResults }),
    [query, userTier, frecency, maxResults],
  );

  // Reset nav when hits change.
  useEffect(() => {
    setNavState({ focusedIndex: 0, hits });
  }, [hits]);

  // Focus the input on open + clear query.
  useEffect(() => {
    if (open) {
      setQuery('');
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  const activateCurrent = useCallback(() => {
    const hit = getCurrentHit(navState);
    if (!hit) return;
    frecency?.record(hit.entry.id);
    onActivate(hit.entry.id);
    onClose();
  }, [navState, frecency, onActivate, onClose]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setNavState(s => navDown(s));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setNavState(s => navUp(s));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      activateCurrent();
    }
  }, [activateCurrent, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={copy.dialog}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 80,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '90%', maxWidth: 600,
          background: 'var(--panel, #0f172a)',
          color: 'var(--text, #f1f5f9)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
        }}
        onClick={e => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          placeholder={copy.search}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%', padding: '14px 18px', border: 'none',
            background: 'transparent', color: 'inherit',
            fontSize: 16, outline: 'none',
            borderBottom: '1px solid var(--border, #334155)',
          }}
        />
        <ul
          role="listbox"
          style={{
            listStyle: 'none', margin: 0, padding: 4,
            maxHeight: 400, overflowY: 'auto',
          }}
        >
          {hits.length === 0 ? (
            <li style={{ padding: 12, fontSize: 13, opacity: 0.6 }}>{copy.noMatches}</li>
          ) : (
            hits.map((hit, i) => (
              <li
                key={hit.entry.id}
                role="option"
                aria-selected={i === navState.focusedIndex}
                onMouseEnter={() => setNavState(s => ({ ...s, focusedIndex: i }))}
                onClick={() => {
                  setNavState(s => ({ ...s, focusedIndex: i }));
                  activateCurrent();
                }}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: i === navState.focusedIndex ? 'var(--panel-2, #1e293b)' : 'transparent',
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <strong>{hit.entry.name}</strong>
                  <span style={{
                    fontSize: 10, opacity: 0.7,
                    padding: '0 6px', borderRadius: 4,
                    background: hit.entry.license === 'free' ? 'transparent' : 'var(--accent-soft, rgba(59,130,246,0.15))',
                  }}>
                    {hit.entry.license !== 'free' ? hit.entry.license.toUpperCase() : ''}
                  </span>
                </div>
                <span style={{ fontSize: 11, opacity: 0.7 }}>{hit.entry.description}</span>
                <span style={{ fontSize: 9, opacity: 0.5 }}>
                  {hit.entry.id} · {hit.entry.routes.join(', ')}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

// ── Global keyboard shortcut ─────────────────────────────────────

/** React hook that opens/closes the palette in response to ⌘K / Ctrl-K. */
export function useCommandPaletteShortcut(setOpen: (open: boolean) => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setOpen]);
}
