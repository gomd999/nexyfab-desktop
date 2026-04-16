'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

/* ─── Types ─────────────────────────────────────────────────────────────── */

export interface Command {
  id: string;
  label: string;
  labelKo?: string;
  category: string;
  shortcut?: string;
  icon?: string;
  action: () => void;
  enabled?: () => boolean;
}

interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  commands: Command[];
  lang: string;
}

/* ─── Constants ─────────────────────────────────────────────────────────── */

const CATEGORY_KO: Record<string, string> = {
  File: '파일',
  Edit: '편집',
  View: '보기',
  Sketch: '스케치',
  Features: '피처',
  Analysis: '분석',
  Tools: '도구',
  Transform: '변환',
};

const RECENT_KEY = 'nexyfab-command-palette-recent';
const MAX_RECENT = 5;

/* ─── Fuzzy search ──────────────────────────────────────────────────────── */

function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Exact match
  if (t === q) return 100;
  // Starts with
  if (t.startsWith(q)) return 80;
  // Contains
  if (t.includes(q)) return 60;

  // Fuzzy: character-by-character
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      score += consecutive * 2;
    } else {
      consecutive = 0;
    }
  }
  return qi === q.length ? Math.min(40, score) : 0;
}

function searchCommands(query: string, commands: Command[], lang: string): Command[] {
  if (!query.trim()) return commands;
  const q = query.trim();
  const scored = commands.map(cmd => {
    const enScore = fuzzyScore(q, cmd.label);
    const koScore = cmd.labelKo ? fuzzyScore(q, cmd.labelKo) : 0;
    const catScore = fuzzyScore(q, cmd.category) * 0.3;
    const catKoScore = CATEGORY_KO[cmd.category] ? fuzzyScore(q, CATEGORY_KO[cmd.category]) * 0.3 : 0;
    const best = Math.max(enScore, koScore, catScore, catKoScore);
    return { cmd, score: best };
  }).filter(s => s.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.cmd);
}

/** Highlight matched characters in text */
function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const q = query.toLowerCase();
  const t = text.toLowerCase();

  // Try substring match first
  const idx = t.indexOf(q);
  if (idx >= 0) {
    return (
      <>
        {text.slice(0, idx)}
        <span style={{ color: '#58a6ff', fontWeight: 700 }}>{text.slice(idx, idx + q.length)}</span>
        {text.slice(idx + q.length)}
      </>
    );
  }

  // Fuzzy highlight
  const chars: React.ReactNode[] = [];
  let qi = 0;
  for (let i = 0; i < text.length; i++) {
    if (qi < q.length && t[i] === q[qi]) {
      chars.push(<span key={i} style={{ color: '#58a6ff', fontWeight: 700 }}>{text[i]}</span>);
      qi++;
    } else {
      chars.push(text[i]);
    }
  }
  return <>{chars}</>;
}

/* ─── Recent commands (localStorage) ────────────────────────────────────── */

function getRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRecent(ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids.slice(0, MAX_RECENT)));
  } catch { /* ignore */ }
}

function pushRecent(id: string) {
  const prev = getRecent().filter(r => r !== id);
  saveRecent([id, ...prev]);
}

/* ─── Styles ────────────────────────────────────────────────────────────── */

const CATEGORY_COLORS: Record<string, string> = {
  File: '#3fb950',
  Edit: '#d2a8ff',
  View: '#58a6ff',
  Sketch: '#f0883e',
  Features: '#bc8cff',
  Analysis: '#f778ba',
  Tools: '#8b949e',
  Transform: '#79c0ff',
};

/* ─── Component ─────────────────────────────────────────────────────────── */

export default function CommandPalette({ visible, onClose, commands, lang }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const isKo = lang === 'ko';

  const recentIds = useMemo(() => visible ? getRecent() : [], [visible]);

  const filtered = useMemo(() => searchCommands(query, commands, lang), [query, commands, lang]);

  // Build display list: recent section + filtered results
  const displayItems = useMemo(() => {
    if (query.trim()) return filtered;
    // Show recent first, then all
    const recentCmds = recentIds
      .map(id => commands.find(c => c.id === id))
      .filter((c): c is Command => !!c);
    const recentSet = new Set(recentIds);
    const rest = commands.filter(c => !recentSet.has(c.id));
    return [...recentCmds, ...rest];
  }, [query, filtered, recentIds, commands]);

  const recentCount = useMemo(() => {
    if (query.trim()) return 0;
    return recentIds.filter(id => commands.some(c => c.id === id)).length;
  }, [query, recentIds, commands]);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [visible]);

  // Reset index on query change
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Keyboard handler
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, displayItems.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); return; }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = displayItems[selectedIndex];
        if (cmd && (!cmd.enabled || cmd.enabled())) {
          pushRecent(cmd.id);
          onClose();
          cmd.action();
        }
        return;
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [visible, displayItems, selectedIndex, onClose]);

  const handleSelect = useCallback((cmd: Command) => {
    if (cmd.enabled && !cmd.enabled()) return;
    pushRecent(cmd.id);
    onClose();
    cmd.action();
  }, [onClose]);

  if (!visible) return null;

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        background: '#161b22', border: '1px solid #30363d', borderRadius: 12,
        width: 560, maxWidth: '90vw',
        boxShadow: '0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(56,139,253,0.1)',
        display: 'flex', flexDirection: 'column',
        maxHeight: '60vh',
        overflow: 'hidden',
      }}>
        {/* Search input */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid #21262d',
        }}>
          <span style={{ fontSize: 16, color: '#8b949e', flexShrink: 0 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isKo ? '명령어 검색...' : 'Type a command...'}
            style={{
              flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
              padding: '8px 12px', color: '#c9d1d9', fontSize: 14,
              outline: 'none', fontFamily: 'inherit',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = '#388bfd'; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = '#30363d'; }}
          />
          <kbd style={{
            padding: '2px 6px', borderRadius: 4, border: '1px solid #30363d',
            background: '#21262d', color: '#8b949e', fontSize: 10, fontFamily: 'monospace',
            flexShrink: 0,
          }}>Esc</kbd>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          style={{
            overflowY: 'auto', padding: '4px 8px 8px',
            maxHeight: 'calc(60vh - 56px)',
          }}
        >
          {/* Recent header */}
          {recentCount > 0 && !query.trim() && (
            <div style={{
              fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase',
              letterSpacing: '0.06em', padding: '8px 8px 4px',
            }}>
              {isKo ? '최근 사용' : 'Recent'}
            </div>
          )}

          {displayItems.length === 0 && (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: '#484f58', fontSize: 13 }}>
              {isKo ? '일치하는 명령이 없습니다' : 'No matching commands'}
            </div>
          )}

          {displayItems.map((cmd, i) => {
            const isSelected = i === selectedIndex;
            const isDisabled = cmd.enabled ? !cmd.enabled() : false;
            const showAllHeader = !query.trim() && recentCount > 0 && i === recentCount;
            const catColor = CATEGORY_COLORS[cmd.category] || '#8b949e';
            const displayLabel = isKo && cmd.labelKo ? cmd.labelKo : cmd.label;
            const displayCat = isKo && CATEGORY_KO[cmd.category] ? CATEGORY_KO[cmd.category] : cmd.category;

            return (
              <React.Fragment key={cmd.id}>
                {showAllHeader && (
                  <div style={{
                    fontSize: 10, fontWeight: 700, color: '#8b949e', textTransform: 'uppercase',
                    letterSpacing: '0.06em', padding: '12px 8px 4px',
                    borderTop: '1px solid #21262d', marginTop: 4,
                  }}>
                    {isKo ? '모든 명령' : 'All Commands'}
                  </div>
                )}
                <div
                  onClick={() => handleSelect(cmd)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', borderRadius: 8,
                    background: isSelected ? '#388bfd18' : 'transparent',
                    border: isSelected ? '1px solid #388bfd44' : '1px solid transparent',
                    cursor: isDisabled ? 'default' : 'pointer',
                    opacity: isDisabled ? 0.4 : 1,
                    transition: 'background 0.06s, border 0.06s',
                    marginBottom: 1,
                  }}
                >
                  {/* Icon */}
                  <span style={{ fontSize: 16, width: 22, textAlign: 'center', flexShrink: 0 }}>
                    {cmd.icon || '▪'}
                  </span>

                  {/* Label */}
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: isSelected ? '#e6edf3' : '#c9d1d9' }}>
                    <HighlightMatch text={displayLabel} query={query} />
                  </span>

                  {/* Category badge */}
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: `${catColor}18`, color: catColor, textTransform: 'uppercase',
                    letterSpacing: '0.04em', flexShrink: 0,
                  }}>
                    {displayCat}
                  </span>

                  {/* Shortcut hint */}
                  {cmd.shortcut && (
                    <kbd style={{
                      fontSize: 10, fontFamily: 'monospace', padding: '1px 5px', borderRadius: 3,
                      border: '1px solid #30363d', background: '#161b22', color: '#8b949e',
                      flexShrink: 0,
                    }}>
                      {cmd.shortcut}
                    </kbd>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px',
          borderTop: '1px solid #21262d', fontSize: 10, color: '#484f58',
        }}>
          <span><kbd style={{ padding: '1px 4px', borderRadius: 2, border: '1px solid #30363d', background: '#21262d', color: '#8b949e', fontFamily: 'monospace', fontSize: 9 }}>↑↓</kbd> {isKo ? '탐색' : 'navigate'}</span>
          <span><kbd style={{ padding: '1px 4px', borderRadius: 2, border: '1px solid #30363d', background: '#21262d', color: '#8b949e', fontFamily: 'monospace', fontSize: 9 }}>Enter</kbd> {isKo ? '실행' : 'execute'}</span>
          <span><kbd style={{ padding: '1px 4px', borderRadius: 2, border: '1px solid #30363d', background: '#21262d', color: '#8b949e', fontFamily: 'monospace', fontSize: 9 }}>Esc</kbd> {isKo ? '닫기' : 'close'}</span>
          <div style={{ flex: 1 }} />
          <span style={{ color: '#6e7681' }}>
            {displayItems.length} {isKo ? '개 명령' : 'commands'}
          </span>
        </div>
      </div>
    </div>
  );
}
