'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';

/* ── i18n ─────────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    placeholder: '명령어 또는 AI에게 질문하기… (Ctrl+K)',
    noResults: '일치하는 명령어가 없습니다',
    askAiPrefix: 'AI에게 요청: ',
    catShape: '형상',
    catFeature: '피처',
    catView: '보기',
    catAnalysis: '분석',
    catExport: '내보내기',
    catAi: 'AI',
    catEdit: '편집',
  },
  en: {
    placeholder: 'Search commands or ask AI… (Ctrl+K)',
    noResults: 'No matching commands',
    askAiPrefix: 'Ask AI: ',
    catShape: 'Shape',
    catFeature: 'Feature',
    catView: 'View',
    catAnalysis: 'Analysis',
    catExport: 'Export',
    catAi: 'AI',
    catEdit: 'Edit',
  },
  ja: {
    placeholder: 'コマンドを検索… (Ctrl+K)',
    noResults: '一致するコマンドがありません',
    catShape: '形状',
    catFeature: 'フィーチャ',
    catView: '表示',
    catAnalysis: '分析',
    catExport: 'エクスポート',
    catAi: 'AI',
    catEdit: '編集',
  },
  zh: {
    placeholder: '搜索命令… (Ctrl+K)',
    noResults: '没有匹配的命令',
    catShape: '形状',
    catFeature: '特征',
    catView: '视图',
    catAnalysis: '分析',
    catExport: '导出',
    catAi: 'AI',
    catEdit: '编辑',
  },
  es: {
    placeholder: 'Buscar comandos… (Ctrl+K)',
    noResults: 'Sin resultados',
    catShape: 'Forma',
    catFeature: 'Operación',
    catView: 'Vista',
    catAnalysis: 'Análisis',
    catExport: 'Exportar',
    catAi: 'IA',
    catEdit: 'Editar',
  },
  ar: {
    placeholder: 'بحث الأوامر… (Ctrl+K)',
    noResults: 'لا توجد نتائج',
    catShape: 'شكل',
    catFeature: 'ميزة',
    catView: 'عرض',
    catAnalysis: 'تحليل',
    catExport: 'تصدير',
    catAi: 'ذكاء',
    catEdit: 'تحرير',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

/* ── Command definition ───────────────────────────────────────────────── */

export interface CommandItem {
  id: string;
  label: string;
  labelKo?: string;
  icon: string;
  shortcut?: string;
  category: string;
  keywords?: string;
  action?: () => void;
}

/** Backward compat alias */
export type Command = CommandItem;

export interface CommandPaletteProps {
  visible: boolean;
  onClose: () => void;
  commands: CommandItem[];
  lang: string;
  onAskAI?: (prompt: string) => void;
}

/* ── Component ────────────────────────────────────────────────────────── */

export default function CommandPalette({ visible, onClose, commands, lang, onAskAI }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const tt = dict[langMap[seg] ?? 'en'];

  // Focus input when opened
  useEffect(() => {
    if (visible) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [visible]);

  // Filter commands and optionally inject Ask AI
  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const q = query.toLowerCase();
    const results = commands.filter(c =>
      c.label.toLowerCase().includes(q) ||
      c.category.toLowerCase().includes(q) ||
      (c.keywords || '').toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q)
    );

    // Inject AI Command if query is not empty and onAskAI is provided
    if (onAskAI) {
      results.unshift({
        id: 'ask-ai-dynamic',
        label: `${(tt as any).askAiPrefix || 'Ask AI: '} "${query}"`,
        labelKo: `${(tt as any).askAiPrefix || 'AI에게 요청: '} "${query}"`,
        icon: '🤖',
        category: tt.catAi || 'AI',
        action: () => onAskAI(query),
      });
    }

    return results;
  }, [commands, query, onAskAI, tt]);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const c of filtered) {
      if (!map.has(c.category)) map.set(c.category, []);
      map.get(c.category)!.push(c);
    }
    return map;
  }, [filtered]);

  // Flat list for keyboard nav
  const flatList = useMemo(() => {
    const arr: CommandItem[] = [];
    for (const items of grouped.values()) arr.push(...items);
    return arr;
  }, [grouped]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, flatList.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flatList[selectedIdx]) {
      e.preventDefault();
      flatList[selectedIdx].action?.();
      onClose();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [flatList, selectedIdx, onClose]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-cmd-idx="${selectedIdx}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (!visible) return null;

  let flatIdx = -1;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 9998,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
        }}
      />

      {/* Palette */}
      <div style={{
        position: 'fixed',
        top: '15%',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        width: 520,
        maxWidth: 'calc(100vw - 32px)',
        maxHeight: '60vh',
        background: 'rgba(13, 17, 23, 0.95)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 16,
        boxShadow: '0 16px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(88,166,255,0.1)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'cmdPaletteIn 0.15s ease-out',
      }}>
        {/* Search input */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <span style={{ fontSize: 16, color: '#58a6ff', flexShrink: 0 }}>&#x2318;</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder={tt.placeholder}
            style={{
              flex: 1,
              border: 'none',
              background: 'transparent',
              color: '#ffffff',
              fontSize: 15,
              fontWeight: 500,
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
          <kbd style={{
            fontSize: 10, color: '#484f58', fontWeight: 700,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: '2px 6px', borderRadius: 4,
            fontFamily: 'monospace',
          }}>ESC</kbd>
        </div>

        {/* Results */}
        <div
          ref={listRef}
          style={{
            flex: 1, overflowY: 'auto',
            padding: '8px',
          }}
        >
          {flatList.length === 0 ? (
            <div style={{
              padding: '24px 16px',
              textAlign: 'center',
              color: '#484f58',
              fontSize: 13,
            }}>
              {tt.noResults}
            </div>
          ) : (
            Array.from(grouped.entries()).map(([category, items]) => (
              <div key={category} style={{ marginBottom: 8 }}>
                {/* Category header */}
                <div style={{
                  fontSize: 10, fontWeight: 700, color: '#8b949e',
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  padding: '4px 12px 4px',
                }}>
                  {category}
                </div>
                {items.map(cmd => {
                  flatIdx++;
                  const isSel = flatIdx === selectedIdx;
                  const thisIdx = flatIdx;
                  const isAi = cmd.id === 'ask-ai-dynamic';
                  return (
                      <button
                        key={cmd.id}
                        data-cmd-idx={thisIdx}
                        onClick={() => { cmd.action?.(); onClose(); }}
                        onMouseEnter={() => setSelectedIdx(thisIdx)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          padding: '8px 12px',
                          border: 'none',
                          borderRadius: 8,
                          background: isSel 
                            ? (isAi ? 'rgba(168, 85, 247, 0.15)' : 'rgba(88,166,255,0.12)') 
                            : 'transparent',
                          color: isSel ? '#ffffff' : '#c9d1d9',
                          cursor: 'pointer',
                          fontSize: 13,
                          fontWeight: isSel ? 600 : 500,
                          textAlign: 'left',
                          transition: 'background 0.08s',
                          fontFamily: 'inherit',
                          ...(isAi && isSel ? {
                            boxShadow: 'inset 0 0 0 1px rgba(168, 85, 247, 0.4)',
                          } : {})
                        }}
                      >
                        <span style={{
                          width: 28, height: 28, borderRadius: 6,
                          background: isSel 
                            ? (isAi ? 'linear-gradient(135deg, rgba(168,85,247,0.4) 0%, rgba(59,130,246,0.4) 100%)' : 'rgba(88,166,255,0.2)') 
                            : 'rgba(255,255,255,0.04)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, flexShrink: 0,
                          transition: 'background 0.08s',
                        }}>
                          {cmd.icon}
                        </span>
                      <span style={{ flex: 1 }}>{(lang === 'ko' || lang === 'kr') && cmd.labelKo ? cmd.labelKo : cmd.label}</span>
                      {cmd.shortcut && (
                        <kbd style={{
                          fontSize: 10, color: '#484f58', fontWeight: 600,
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.06)',
                          padding: '2px 6px', borderRadius: 3,
                          fontFamily: 'monospace',
                        }}>
                          {cmd.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Animation keyframes */}
      <style>{`
        @keyframes cmdPaletteIn {
          from { opacity: 0; transform: translateX(-50%) scale(0.96) translateY(-8px); }
          to { opacity: 1; transform: translateX(-50%) scale(1) translateY(0); }
        }
      `}</style>
    </>
  );
}
