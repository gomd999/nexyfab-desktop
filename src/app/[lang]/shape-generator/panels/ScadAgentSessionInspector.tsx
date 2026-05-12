'use client';

// W3 — Session state inspector for the SCAD agent.
//
// Surfaces the live state the agent has built up so the user can see
// "what's in the session" without scrolling the chat: B-rep handles,
// modules, mates, sketches, GD&T frames, doc refs, checkpoints. Each
// row is read-only here; revert UI for checkpoints lives in W4.
//
// Designed as a collapsible sidebar — hidden by default to keep the
// agent panel uncluttered, expandable when the session has 5+ entries
// in any category.

import React, { useEffect, useState } from 'react';
import type { AgentSession } from '@/lib/ai/scad-agent/types';

const dict = {
  ko: {
    open: '📋 세션 상태', close: '닫기',
    sections: {
      brep: 'B-rep 핸들', modules: '모듈', sketches: '스케치', mates: '메이트',
      gdt: 'GD&T', docRefs: '외부 문서', checkpoints: '체크포인트', empty: '아직 비어있음',
    },
  },
  en: {
    open: '📋 Session state', close: 'Close',
    sections: {
      brep: 'B-rep handles', modules: 'Modules', sketches: 'Sketches', mates: 'Mates',
      gdt: 'GD&T frames', docRefs: 'External docs', checkpoints: 'Checkpoints', empty: 'empty',
    },
  },
  ja: {
    open: '📋 セッション状態', close: '閉じる',
    sections: {
      brep: 'B-repハンドル', modules: 'モジュール', sketches: 'スケッチ', mates: 'メイト',
      gdt: 'GD&T', docRefs: '外部ドキュメント', checkpoints: 'チェックポイント', empty: '空',
    },
  },
  zh: {
    open: '📋 会话状态', close: '关闭',
    sections: {
      brep: 'B-rep 句柄', modules: '模块', sketches: '草图', mates: '配合',
      gdt: 'GD&T', docRefs: '外部文档', checkpoints: '检查点', empty: '空',
    },
  },
  es: {
    open: '📋 Estado de sesión', close: 'Cerrar',
    sections: {
      brep: 'Handles B-rep', modules: 'Módulos', sketches: 'Bocetos', mates: 'Restricciones',
      gdt: 'GD&T', docRefs: 'Docs externos', checkpoints: 'Puntos de control', empty: 'vacío',
    },
  },
  ar: {
    open: '📋 حالة الجلسة', close: 'إغلاق',
    sections: {
      brep: 'مقابض B-rep', modules: 'الوحدات', sketches: 'الرسومات', mates: 'الاقترانات',
      gdt: 'GD&T', docRefs: 'مستندات خارجية', checkpoints: 'نقاط التفتيش', empty: 'فارغ',
    },
  },
};

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface SessionInspectorProps {
  lang: string;
  session: AgentSession | null;
  /** W4 — invoked when user clicks a checkpoint row. */
  onRevertToCheckpoint?: (index: number) => void;
}

export default function ScadAgentSessionInspector({ lang, session, onRevertToCheckpoint }: SessionInspectorProps) {
  const [open, setOpen] = useState(false);
  const t = dict[langMap[lang] ?? 'en'];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!session) return null;

  const counts = {
    brep: session.brepEntries.length,
    modules: Object.keys(session.modules).length,
    sketches: Object.keys(session.sketches).length,
    mates: session.mates.length,
    gdt: session.gdtFrames.length,
    docRefs: session.docRefs.length,
    checkpoints: session.checkpoints.length,
  };
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (total === 0 && !open) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '4px 10px', fontSize: 10, fontWeight: 700,
          borderRadius: 6,
          border: '1px solid #30363d',
          background: 'transparent', color: '#9ca3af',
          cursor: 'pointer',
        }}
      >
        {t.open} ({total})
      </button>
    );
  }

  return (
    <div style={{
      padding: 10, background: '#0d1117',
      border: '1px solid #30363d', borderRadius: 8,
      maxHeight: 320, overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: '#e6edf3' }}>{t.open} ({total})</span>
        <button onClick={() => setOpen(false)} style={btnClose}>{t.close}</button>
      </div>

      <Section label={t.sections.brep} count={counts.brep}>
        {session.brepEntries.map(e => (
          <Row key={e.handle} primary={e.handle} secondary={e.kind} />
        ))}
      </Section>

      <Section label={t.sections.modules} count={counts.modules}>
        {Object.entries(session.modules).map(([name, body]) => (
          <Row key={name} primary={name + '()'} secondary={`${body.length} bytes`} />
        ))}
      </Section>

      <Section label={t.sections.sketches} count={counts.sketches}>
        {Object.values(session.sketches).map(sk => (
          <Row
            key={sk.name}
            primary={sk.name}
            secondary={`${sk.entities.length} entities · ${sk.constraints.length} constraints${sk.solved ? ' · ✓ solved' : ''}`}
          />
        ))}
      </Section>

      <Section label={t.sections.mates} count={counts.mates}>
        {session.mates.map(m => (
          <Row key={m.id} primary={m.id} secondary={`${m.kind}: ${m.handleA} ↔ ${m.handleB}${typeof m.value === 'number' ? ` (${m.value})` : ''}`} />
        ))}
      </Section>

      <Section label={t.sections.gdt} count={counts.gdt}>
        {session.gdtFrames.map(f => (
          <Row key={f.id} primary={f.symbol} secondary={`${f.featureRef} · tol ${f.tolerance}`} />
        ))}
      </Section>

      <Section label={t.sections.docRefs} count={counts.docRefs}>
        {session.docRefs.map(d => (
          <Row key={d.id} primary={d.id} secondary={`${d.format}${d.brepHandle ? ` → ${d.brepHandle}` : ''}`} />
        ))}
      </Section>

      <Section label={t.sections.checkpoints} count={counts.checkpoints}>
        {session.checkpoints.map(cp => (
          <Row
            key={cp.index}
            primary={`#${cp.index}`}
            secondary={`${cp.label} · ${new Date(cp.ts).toISOString().slice(11, 19)}`}
            onClick={onRevertToCheckpoint ? () => onRevertToCheckpoint(cp.index) : undefined}
          />
        ))}
      </Section>
    </div>
  );
}

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: '#58a6ff',
        marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        {label} ({count})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
}

function Row({ primary, secondary, onClick }: { primary: string; secondary?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '3px 6px',
        fontSize: 11,
        fontFamily: 'monospace',
        borderRadius: 3,
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex', gap: 6, alignItems: 'baseline',
      }}
      onMouseEnter={onClick ? e => { e.currentTarget.style.background = '#161b22'; } : undefined}
      onMouseLeave={onClick ? e => { e.currentTarget.style.background = 'transparent'; } : undefined}
      title={onClick ? 'Click to revert' : undefined}
    >
      <code style={{ color: '#79c0ff' }}>{primary}</code>
      {secondary && <span style={{ color: '#8b949e', fontSize: 10 }}>{secondary}</span>}
    </div>
  );
}

const btnClose: React.CSSProperties = {
  padding: '3px 8px', fontSize: 10,
  borderRadius: 4, border: '1px solid #30363d',
  background: 'transparent', color: '#9ca3af', cursor: 'pointer',
};
