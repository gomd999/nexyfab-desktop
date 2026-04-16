'use client';

// ─── History Panel UI ─────────────────────────────────────────────────────────

import React from 'react';
import { useCommandHistory } from './useCommandHistory';
import type { HistoryCommand } from './CommandHistory';

/* ── Design tokens ── */
const C = {
  bg: '#161b22',
  border: '#30363d',
  text: '#c9d1d9',
  textDim: '#8b949e',
  accent: '#388bfd',
  hover: '#21262d',
  past: '#1c2128',
  future: '#0d1117',
  currentBg: '#1f3158',
};

interface HistoryPanelProps {
  lang?: string;
  onClose?: () => void;
}

export default function HistoryPanel({ lang = 'en', onClose }: HistoryPanelProps) {
  const { canUndo, canRedo, undo, redo, clear, history } = useCommandHistory();
  const isKo = lang === 'ko';

  const labelFor = (cmd: HistoryCommand) => isKo ? cmd.labelKo : cmd.label;

  // Past commands in most-recent-first order
  const pastReversed = [...history.past].reverse();

  return (
    <div
      style={{
        position: 'fixed',
        top: 48,
        right: 16,
        width: 280,
        maxHeight: 'calc(100vh - 80px)',
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 300,
        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <span style={{ color: C.text, fontSize: 13, fontWeight: 700 }}>
          {isKo ? '명령 히스토리' : 'Command History'}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Undo button */}
          <button
            onClick={undo}
            disabled={!canUndo}
            title={isKo ? '실행 취소 (Ctrl+Z)' : 'Undo (Ctrl+Z)'}
            style={{
              padding: '3px 8px',
              borderRadius: 5,
              border: 'none',
              background: canUndo ? C.accent : C.hover,
              color: canUndo ? '#fff' : C.textDim,
              fontSize: 13,
              cursor: canUndo ? 'pointer' : 'default',
              opacity: canUndo ? 1 : 0.5,
            }}
          >
            ←
          </button>
          {/* Redo button */}
          <button
            onClick={redo}
            disabled={!canRedo}
            title={isKo ? '다시 실행 (Ctrl+Y)' : 'Redo (Ctrl+Y)'}
            style={{
              padding: '3px 8px',
              borderRadius: 5,
              border: 'none',
              background: canRedo ? C.accent : C.hover,
              color: canRedo ? '#fff' : C.textDim,
              fontSize: 13,
              cursor: canRedo ? 'pointer' : 'default',
              opacity: canRedo ? 1 : 0.5,
            }}
          >
            →
          </button>
          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                border: 'none',
                background: 'transparent',
                color: C.textDim,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Current position indicator */}
      <div
        style={{
          padding: '6px 14px',
          background: C.currentBg,
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <span style={{ color: C.accent, fontSize: 11, fontWeight: 600 }}>
          ▶ {isKo ? '현재' : 'Current'}
        </span>
        <span style={{ color: C.textDim, fontSize: 11, marginLeft: 8 }}>
          {history.past.length} {isKo ? '단계' : 'step'}{history.past.length !== 1 ? 's' : ''}
          {history.future.length > 0 && ` · ${history.future.length} ${isKo ? '재실행 가능' : 'redoable'}`}
        </span>
      </div>

      {/* Scrollable command list */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {/* Future (redo) stack — greyed out, bottom-first in display */}
        {history.future.length > 0 && (
          <>
            {[...history.future].reverse().map((cmd, idx) => (
              <div
                key={`future-${idx}-${cmd.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 14px',
                  background: C.future,
                  borderBottom: `1px solid ${C.border}`,
                  opacity: 0.45,
                }}
              >
                <span style={{ color: C.textDim, fontSize: 11 }}>↷</span>
                <span style={{ color: C.textDim, fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {labelFor(cmd)}
                </span>
              </div>
            ))}
          </>
        )}

        {/* Separator when both stacks have items */}
        {history.future.length > 0 && history.past.length > 0 && (
          <div style={{ height: 1, background: C.accent, opacity: 0.4 }} />
        )}

        {/* Past (undo) stack — most recent first */}
        {pastReversed.length > 0 ? (
          pastReversed.map((cmd, idx) => (
            <div
              key={`past-${idx}-${cmd.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 14px',
                background: idx === 0 ? C.past : 'transparent',
                borderBottom: `1px solid ${C.border}`,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.hover; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = idx === 0 ? C.past : 'transparent'; }}
            >
              <span style={{ color: idx === 0 ? C.accent : C.textDim, fontSize: 11 }}>
                {idx === 0 ? '●' : '○'}
              </span>
              <span
                style={{
                  color: idx === 0 ? C.text : C.textDim,
                  fontSize: 12,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontWeight: idx === 0 ? 600 : 400,
                }}
              >
                {labelFor(cmd)}
              </span>
            </div>
          ))
        ) : (
          <div style={{ padding: '16px 14px', color: C.textDim, fontSize: 12, textAlign: 'center' }}>
            {isKo ? '히스토리 없음' : 'No history'}
          </div>
        )}
      </div>

      {/* Footer — Clear history */}
      <div
        style={{
          padding: '8px 14px',
          borderTop: `1px solid ${C.border}`,
          flexShrink: 0,
        }}
      >
        <button
          onClick={clear}
          disabled={history.past.length === 0 && history.future.length === 0}
          style={{
            width: '100%',
            padding: '5px 0',
            borderRadius: 5,
            border: `1px solid ${C.border}`,
            background: 'transparent',
            color: C.textDim,
            fontSize: 11,
            fontWeight: 600,
            cursor: history.past.length === 0 && history.future.length === 0 ? 'default' : 'pointer',
            opacity: history.past.length === 0 && history.future.length === 0 ? 0.4 : 1,
            transition: 'all 0.1s',
          }}
          onMouseEnter={e => {
            if (history.past.length > 0 || history.future.length > 0) {
              (e.currentTarget as HTMLElement).style.background = C.hover;
              (e.currentTarget as HTMLElement).style.color = '#e6edf3';
            }
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = C.textDim;
          }}
        >
          {isKo ? '히스토리 지우기' : 'Clear History'}
        </button>
      </div>
    </div>
  );
}
