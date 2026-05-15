'use client';

// J4 — Thread/Hole callout dock.
//
// Wraps ThreadHoleCalloutPanel in its slide-in container with a close button.
// State setters are passed in by the host so this stays controlled.

import React from 'react';
import dynamic from 'next/dynamic';
import type { ThreadCallout, HoleCallout } from '../annotations/GDTTypes';

const ThreadHoleCalloutPanel = dynamic(
  () => import('../annotations/ThreadHoleCalloutPanel'),
  { ssr: false },
);

interface ThreadHoleCalloutDockProps {
  open: boolean;
  lang: string;
  threadCallouts: ThreadCallout[];
  holeCallouts: HoleCallout[];
  setThreadCallouts: React.Dispatch<React.SetStateAction<ThreadCallout[]>>;
  setHoleCallouts: React.Dispatch<React.SetStateAction<HoleCallout[]>>;
  onClose: () => void;
}

export default function ThreadHoleCalloutDock({
  open, lang, threadCallouts, holeCallouts,
  setThreadCallouts, setHoleCallouts, onClose,
}: ThreadHoleCalloutDockProps) {
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: 340,
      zIndex: 8000,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
      border: '1px solid var(--nx-panel-2)',
    }}>
      <ThreadHoleCalloutPanel
        threadCallouts={threadCallouts}
        holeCallouts={holeCallouts}
        onAddThread={(t) => setThreadCallouts(prev => [...prev, { ...t, id: `${Date.now()}`, position: [0, 0, 0] }])}
        onAddHole={(h) => setHoleCallouts(prev => [...prev, { ...h, id: `${Date.now()}`, position: [0, 0, 0] }])}
        onDeleteThread={(id) => setThreadCallouts(prev => prev.filter(t => t.id !== id))}
        onDeleteHole={(id) => setHoleCallouts(prev => prev.filter(h => h.id !== id))}
        lang={lang}
      />
      <button
        onClick={onClose}
        style={{
          position: 'absolute', top: 10, right: 10,
          background: 'none', border: 'none', color: 'var(--nx-text-3)',
          fontSize: 16, cursor: 'pointer', zIndex: 1,
        }}
      >✕</button>
    </div>
  );
}
