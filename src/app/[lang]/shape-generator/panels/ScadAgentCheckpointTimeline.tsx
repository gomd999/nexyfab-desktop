'use client';

// W4 — Visual checkpoint timeline with one-click revert.
//
// Each successful render captures a checkpoint (B2 in the agent
// pipeline). Surfacing them as a horizontal chip strip lets the user
// time-travel without scrolling the chat: click the chip, the agent
// gets a `revert to checkpoint #N` instruction, no typing.
//
// Design choices:
//   - Horizontal scroll, newest on the right (matches chat reading
//     direction); the strip auto-scrolls right when checkpoints grow.
//   - No "active checkpoint" marker — checkpoints are immutable
//     snapshots, not a current pointer. Showing one as "active" would
//     be misleading after a revert produces a new checkpoint chain.
//   - Hidden when there are <2 checkpoints (revert is meaningless with
//     only one snapshot).

import React, { useEffect, useRef } from 'react';
import type { Checkpoint } from '@/lib/ai/scad-agent/types';

const dict = {
  ko: { label: '체크포인트', revert: '되돌리기', hint: '클릭해서 이 시점으로 자동 되돌리기' },
  en: { label: 'Checkpoints', revert: 'Revert', hint: 'Click to auto-revert to this point' },
  ja: { label: 'チェックポイント', revert: '戻す', hint: 'クリックでこの時点に自動復元' },
  zh: { label: '检查点', revert: '回滚', hint: '点击自动回滚到此点' },
  es: { label: 'Puntos de control', revert: 'Revertir', hint: 'Click para revertir automáticamente a este punto' },
  ar: { label: 'نقاط التفتيش', revert: 'تراجع', hint: 'انقر للعودة تلقائيًا إلى هذه النقطة' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface CheckpointTimelineProps {
  lang: string;
  checkpoints: Checkpoint[];
  /** Fires the revert as a normal user prompt (auto-send). */
  onRevert: (index: number) => void;
}

export default function ScadAgentCheckpointTimeline({ lang, checkpoints, onRevert }: CheckpointTimelineProps) {
  const t = dict[langMap[lang] ?? 'en'];
  const stripRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (stripRef.current) {
      stripRef.current.scrollLeft = stripRef.current.scrollWidth;
    }
  }, [checkpoints.length]);

  if (checkpoints.length < 2) return null;

  return (
    <div style={{
      padding: '6px 10px',
      borderTop: '1px solid #21262d',
      borderBottom: '1px solid #21262d',
      background: '#0a0e14',
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, color: '#58a6ff',
        textTransform: 'uppercase', letterSpacing: 0.5,
        flexShrink: 0,
      }}>
        ⏱ {t.label}
      </span>
      <div
        ref={stripRef}
        style={{
          display: 'flex', gap: 4, overflowX: 'auto', flex: 1,
          scrollbarWidth: 'thin',
        }}
      >
        {checkpoints.map((cp, i) => {
          const isLatest = i === checkpoints.length - 1;
          return (
            <button
              key={cp.index}
              onClick={() => onRevert(cp.index)}
              title={`${cp.label} · ${new Date(cp.ts).toLocaleTimeString()}\n${t.hint}`}
              disabled={isLatest}
              style={{
                padding: '3px 8px',
                fontSize: 10, fontWeight: 600,
                fontFamily: 'monospace',
                borderRadius: 12,
                border: `1px solid ${isLatest ? '#238636' : '#30363d'}`,
                background: isLatest ? '#0d3819' : 'transparent',
                color: isLatest ? '#7ee787' : '#c9d1d9',
                cursor: isLatest ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
                transition: 'all 0.15s',
              }}
              onMouseEnter={!isLatest ? e => {
                e.currentTarget.style.background = '#1f6feb';
                e.currentTarget.style.borderColor = '#1f6feb';
                e.currentTarget.style.color = '#ffffff';
              } : undefined}
              onMouseLeave={!isLatest ? e => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.borderColor = '#30363d';
                e.currentTarget.style.color = '#c9d1d9';
              } : undefined}
            >
              #{cp.index} {truncate(cp.label, 14)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
