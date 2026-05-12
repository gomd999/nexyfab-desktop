'use client';

// A7 — SCAD authoring mode toggle.
//
// Small two-state pill that switches between the deterministic JSON-intent
// path ("Quick") and the multi-turn OpenSCAD coding agent ("Agent").
// Lives in the AI panel header so the user explicitly opts in to the
// higher-cost agent loop.
//
// Wired to uiStore.scadAuthoringMode. The actual agent client/session
// hooks land in a follow-up — this is the seat for the switch.

import React from 'react';
import { useUIStore } from '../store/uiStore';

const dict = {
  ko: { quick: '빠름', agent: '에이전트', tip: '에이전트는 OpenSCAD 코드를 직접 생성·수정하며 렌더 결과를 보고 자가-수정합니다. Pro 전용, 호출당 비용 더 높음.' },
  en: { quick: 'Quick', agent: 'Agent', tip: 'Agent writes OpenSCAD directly and self-corrects from render results. Pro-only, higher per-call cost.' },
  ja: { quick: 'クイック', agent: 'エージェント', tip: 'エージェントはOpenSCADコードを直接生成・修正し、レンダー結果から自己修正します。Pro限定、呼び出しコスト高め。' },
  zh: { quick: '快速', agent: '智能体', tip: '智能体直接编写 OpenSCAD 并根据渲染结果自我修正。Pro 专用，单次调用成本更高。' },
  es: { quick: 'Rápido', agent: 'Agente', tip: 'El agente escribe OpenSCAD directamente y se autocorrige según los resultados del renderizado. Solo Pro, mayor coste por llamada.' },
  ar: { quick: 'سريع', agent: 'وكيل', tip: 'الوكيل يكتب OpenSCAD مباشرة ويصحح نفسه من نتائج العرض. متاح للـ Pro فقط، تكلفة أعلى لكل استدعاء.' },
};
const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

function ScadModePill({
  label, active, onClick, locked, title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  locked?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '4px 10px',
        fontSize: 11,
        fontWeight: 700,
        borderRadius: 999,
        border: '1px solid',
        borderColor: active ? '#388bfd' : '#30363d',
        background: active ? '#1f6feb' : 'transparent',
        color: active ? '#fff' : (locked ? '#6b7280' : '#9ca3af'),
        cursor: locked ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s',
        opacity: locked ? 0.7 : 1,
      }}
    >
      {label}{locked ? ' 🔒' : ''}
    </button>
  );
}

interface ScadModeToggleProps {
  lang: string;
  /** Indicates whether the agent path is unlocked for this user (Pro plan). */
  agentUnlocked?: boolean;
  /** Fired when user attempts agent mode without unlock (so caller can upsell). */
  onLockedAgentClick?: () => void;
}

export default function ScadModeToggle({ lang, agentUnlocked = false, onLockedAgentClick }: ScadModeToggleProps) {
  const mode = useUIStore(s => s.scadAuthoringMode);
  const setMode = useUIStore(s => s.setScadAuthoringMode);
  const t = dict[langMap[lang] ?? 'en'];

  return (
    <div style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <ScadModePill
        label={t.quick}
        active={mode === 'quick'}
        onClick={() => setMode('quick')}
      />
      <ScadModePill
        label={t.agent}
        active={mode === 'agent'}
        locked={!agentUnlocked}
        title={t.tip}
        onClick={() => {
          if (!agentUnlocked) {
            onLockedAgentClick?.();
            return;
          }
          setMode('agent');
        }}
      />
    </div>
  );
}
