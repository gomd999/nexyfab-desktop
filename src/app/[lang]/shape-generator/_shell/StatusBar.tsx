'use client';

import type { ReactNode } from 'react';

export interface StatusPill {
  id: string;
  label: ReactNode;
  tone?: 'default' | 'ok' | 'warn' | 'error';
  saveState?: 'ready' | 'saving' | 'saved' | 'error';
}

export interface StatusSection {
  id: string;
  items: ReactNode[];
}

export interface StatusBarProps {
  left?: StatusSection[];
  pills?: StatusPill[];
  right?: StatusSection[];
}

const toneColor: Record<NonNullable<StatusPill['tone']>, string> = {
  default: 'var(--nx-text)',
  ok: 'var(--nx-ok)',
  warn: 'var(--nx-warn)',
  error: 'var(--nx-error)',
};

export function StatusBar({ left = [], pills = [], right = [] }: StatusBarProps) {
  return (
    <div className="nx-status">
      {left.map(s => (
        <div key={s.id} className="sect">
          {s.items.map((item, i) => (
            <span key={i}>{item}</span>
          ))}
        </div>
      ))}

      <div className="sp" />

      {pills.map(p => (
        <span
          key={p.id}
          className="pill"
          data-testid={p.id === 'cloud' ? 'autosave-indicator' : undefined}
          data-save-state={p.id === 'cloud' ? p.saveState : undefined}
          aria-label={p.id === 'cloud' ? `Autosave: ${String(p.label)}` : undefined}
          style={p.tone ? { color: toneColor[p.tone] } : undefined}
        >
          {p.tone === 'ok' && <span className="dot" />}
          {p.label}
        </span>
      ))}

      {right.map(s => (
        <div key={s.id} className="sect">
          {s.items.map((item, i) => (
            <span key={i}>{item}</span>
          ))}
        </div>
      ))}
    </div>
  );
}
