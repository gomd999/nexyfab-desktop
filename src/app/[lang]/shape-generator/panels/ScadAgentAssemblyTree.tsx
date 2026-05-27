'use client';

// A2 — Hierarchical assembly tree for the SCAD agent session.
//
// W3's session inspector shows everything as flat lists, which is fine
// for "what's here?" but useless for "how is it connected?". This tree
// view re-organizes the same session data into a parent → children
// hierarchy so the user can see the assembly structure:
//
//   Project root
//   ├── Modules
//   │   ├── nema17_mount() — 1.4 KB
//   │   └── m3_bolt() — 320 B
//   ├── B-rep parts
//   │   ├── occt:1 (cylinder)
//   │   │   └── ↔ concentric to occt:2  (mate#m1, value=10)
//   │   └── occt:2 (boolean)
//   └── Sketches / GD&T (collapsed by default)
//
// Click a row to send the agent a focused query about that node.
// Empty lists are auto-hidden. Pure presentational — same data shape
// the inspector already consumes, no extra fetches.

import React, { useMemo, useState } from 'react';
import type { AgentSession, AssemblyMate } from '@/lib/ai/scad-agent/types';
import { buildMateAdjacency, connectedComponent } from '@/lib/ai/scad-agent/bvh';

const dict = {
  ko: { title: '🌲 어셈블리 트리', open: '🌲 트리', close: '닫기', rootLabel: '프로젝트',
    modules: '모듈', breps: 'B-rep 파트', sketches: '스케치', gdt: 'GD&T',
    docRefs: '외부 문서', matedTo: '↔ ', queryPrefix: '에 대해 알려줘' },
  en: { title: '🌲 Assembly tree', open: '🌲 Tree', close: 'Close', rootLabel: 'Project',
    modules: 'Modules', breps: 'B-rep parts', sketches: 'Sketches', gdt: 'GD&T',
    docRefs: 'External docs', matedTo: '↔ ', queryPrefix: 'tell me about' },
  ja: { title: '🌲 アセンブリツリー', open: '🌲 ツリー', close: '閉じる', rootLabel: 'プロジェクト',
    modules: 'モジュール', breps: 'B-rep パーツ', sketches: 'スケッチ', gdt: 'GD&T',
    docRefs: '外部ドキュメント', matedTo: '↔ ', queryPrefix: 'について教えて' },
  zh: { title: '🌲 装配树', open: '🌲 树', close: '关闭', rootLabel: '项目',
    modules: '模块', breps: 'B-rep 零件', sketches: '草图', gdt: 'GD&T',
    docRefs: '外部文档', matedTo: '↔ ', queryPrefix: '告诉我关于' },
  es: { title: '🌲 Árbol ensamblaje', open: '🌲 Árbol', close: 'Cerrar', rootLabel: 'Proyecto',
    modules: 'Módulos', breps: 'Partes B-rep', sketches: 'Bocetos', gdt: 'GD&T',
    docRefs: 'Docs externos', matedTo: '↔ ', queryPrefix: 'cuéntame sobre' },
  ar: { title: '🌲 شجرة التجميع', open: '🌲 شجرة', close: 'إغلاق', rootLabel: 'المشروع',
    modules: 'الوحدات', breps: 'أجزاء B-rep', sketches: 'الرسومات', gdt: 'GD&T',
    docRefs: 'مستندات خارجية', matedTo: '↔ ', queryPrefix: 'أخبرني عن' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

export interface AssemblyTreeProps {
  lang: string;
  session: AgentSession | null;
  /** When provided, clicking a node sends the agent a query about it. */
  onQuery?: (prompt: string) => void;
}

export default function ScadAgentAssemblyTree({ lang, session, onQuery }: AssemblyTreeProps) {
  const [open, setOpen] = useState(false);
  // T4 — clicking a B-rep entry highlights its connected mate component.
  const [highlightedHandle, setHighlightedHandle] = useState<string | null>(null);
  const t = dict[langMap[lang] ?? 'en'];

  // Build mate adjacency once per session.mates change. Returns the
  // connected component for the currently highlighted handle, used to
  // tint sibling nodes in the tree.
  const adjacency = useMemo(
    () => buildMateAdjacency(session?.mates ?? []),
    [session?.mates],
  );
  const highlightedComponent = useMemo(
    () => highlightedHandle ? connectedComponent(adjacency, highlightedHandle) : new Set<string>(),
    [adjacency, highlightedHandle],
  );

  if (!session) return null;

  const totalNodes = session.brepEntries.length
    + Object.keys(session.modules).length
    + Object.keys(session.sketches).length
    + session.gdtFrames.length
    + session.docRefs.length;
  if (totalNodes === 0 && !open) return null;

  if (!open) {
    return <button onClick={() => setOpen(true)} style={pillStyle}>{t.open} ({totalNodes})</button>;
  }

  // Build inverse map: handle → mates that touch it.
  const matesByHandle = new Map<string, AssemblyMate[]>();
  for (const mate of session.mates) {
    for (const h of [mate.handleA, mate.handleB]) {
      if (!matesByHandle.has(h)) matesByHandle.set(h, []);
      matesByHandle.get(h)!.push(mate);
    }
  }

  const askAbout = (node: string) => {
    if (onQuery) onQuery(`${t.queryPrefix} ${node}`);
  };

  return (
    <div style={treeContainerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: 'var(--nx-text)' }}>{t.title}</span>
        <button onClick={() => setOpen(false)} style={btnClose}>{t.close}</button>
      </div>

      <Branch label={t.rootLabel} accent>
        {Object.keys(session.modules).length > 0 && (
          <Branch label={t.modules}>
            {Object.entries(session.modules).map(([name, body]) => (
              <Leaf key={name} primary={`${name}()`} secondary={`${body.length} B`} onClick={onQuery && (() => askAbout(name))} />
            ))}
          </Branch>
        )}

        {session.brepEntries.length > 0 && (
          <Branch label={t.breps}>
            {session.brepEntries.map(entry => {
              const mates = matesByHandle.get(entry.handle) ?? [];
              const isHighlighted = highlightedComponent.has(entry.handle);
              const isPivot = entry.handle === highlightedHandle;
              const tag = isPivot ? ' ●' : isHighlighted ? ' ◌' : '';
              return (
                <div
                  key={entry.handle}
                  onClick={(e) => {
                    e.stopPropagation();
                    setHighlightedHandle(prev => prev === entry.handle ? null : entry.handle);
                  }}
                  style={{
                    background: isPivot ? '#1f6feb33' : isHighlighted ? 'var(--nx-ok)18' : 'transparent',
                    borderLeft: isPivot ? '2px solid #1f6feb' : isHighlighted ? '2px solid var(--nx-ok)66' : '2px solid transparent',
                    borderRadius: 3,
                    cursor: mates.length > 0 ? 'pointer' : 'default',
                    transition: 'background 0.12s',
                  }}
                  title={mates.length > 0 ? 'Click to highlight mate component' : undefined}
                >
                <Branch key={entry.handle} label={`${entry.handle} (${entry.kind})${entry.label ? ` "${entry.label}"` : ''}${tag}`} compact>
                  {mates.map(m => {
                    const otherHandle = m.handleA === entry.handle ? m.handleB : m.handleA;
                    return (
                      <Leaf
                        key={m.id}
                        primary={`${t.matedTo}${otherHandle}`}
                        secondary={`${m.kind}${typeof m.value === 'number' ? ` = ${m.value}` : ''}  (${m.id})`}
                        muted
                        onClick={onQuery && (() => askAbout(m.id))}
                      />
                    );
                  })}
                </Branch>
                </div>
              );
            })}
          </Branch>
        )}

        {Object.keys(session.sketches).length > 0 && (
          <Branch label={t.sketches} initiallyClosed>
            {Object.values(session.sketches).map(sk => (
              <Leaf
                key={sk.name}
                primary={sk.name}
                secondary={`${sk.entities.length}e ${sk.constraints.length}c${sk.solved ? ' ✓' : ''}`}
                onClick={onQuery && (() => askAbout(sk.name))}
              />
            ))}
          </Branch>
        )}

        {session.gdtFrames.length > 0 && (
          <Branch label={t.gdt} initiallyClosed>
            {session.gdtFrames.map(f => (
              <Leaf key={f.id} primary={`${f.symbol} ${f.featureRef}`} secondary={`tol ${f.tolerance}`} />
            ))}
          </Branch>
        )}

        {session.docRefs.length > 0 && (
          <Branch label={t.docRefs} initiallyClosed>
            {session.docRefs.map(d => (
              <Leaf key={d.id} primary={d.id} secondary={`${d.format}${d.brepHandle ? ` → ${d.brepHandle}` : ''}`} />
            ))}
          </Branch>
        )}
      </Branch>
    </div>
  );
}

function Branch({ label, children, accent, compact, initiallyClosed }: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
  compact?: boolean;
  initiallyClosed?: boolean;
}) {
  const [openLocal, setOpenLocal] = useState(!initiallyClosed);
  return (
    <div style={{ marginLeft: compact ? 8 : 0, marginBottom: 2 }}>
      <button
        onClick={() => setOpenLocal(o => !o)}
        style={{
          padding: '2px 4px',
          fontSize: compact ? 10 : 11, fontWeight: accent ? 700 : 600,
          color: accent ? 'var(--nx-accent-2)' : (compact ? 'var(--nx-text)' : 'var(--nx-accent-2)'),
          background: 'transparent',
          border: 'none', cursor: 'pointer',
          fontFamily: compact ? 'monospace' : 'inherit',
          textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 3,
        }}
      >
        <span style={{ fontSize: 9, opacity: 0.7, width: 10 }}>{openLocal ? '▼' : '▶'}</span>
        <span>{label}</span>
      </button>
      {openLocal && (
        <div style={{ marginLeft: 14, borderLeft: '1px dashed var(--nx-border)', paddingLeft: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function Leaf({ primary, secondary, onClick, muted }: {
  primary: string;
  secondary?: string;
  onClick?: (() => void) | undefined;
  muted?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '2px 4px',
        fontSize: 10,
        fontFamily: 'monospace',
        color: muted ? 'var(--nx-text-2)' : 'var(--nx-text)',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 3,
        display: 'flex', gap: 6, alignItems: 'baseline',
      }}
      onMouseEnter={onClick ? e => { e.currentTarget.style.background = 'var(--nx-panel)'; } : undefined}
      onMouseLeave={onClick ? e => { e.currentTarget.style.background = 'transparent'; } : undefined}
      title={onClick ? 'Click to ask the agent about this' : undefined}
    >
      <code style={{ color: muted ? 'var(--nx-text-2)' : 'var(--nx-accent-2)' }}>{primary}</code>
      {secondary && <span style={{ color: 'var(--nx-text-2)' }}>{secondary}</span>}
    </div>
  );
}

const pillStyle: React.CSSProperties = {
  padding: '4px 10px', fontSize: 10, fontWeight: 700,
  borderRadius: 6, border: '1px solid var(--nx-border)',
  background: 'transparent', color: 'var(--nx-text-2)', cursor: 'pointer',
};
const treeContainerStyle: React.CSSProperties = {
  padding: 10, background: 'var(--nx-bg)',
  border: '1px solid var(--nx-border)', borderRadius: 8,
  maxHeight: 360, overflowY: 'auto',
};
const btnClose: React.CSSProperties = {
  padding: '3px 8px', fontSize: 10,
  borderRadius: 4, border: '1px solid var(--nx-border)',
  background: 'transparent', color: 'var(--nx-text-2)', cursor: 'pointer',
};
