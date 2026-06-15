'use client';

/**
 * ConflictResolutionOverlay — A1 viewport feedback UI.
 *
 * Renders the NON-DESTRUCTIVE proposals from
 * `mateConflictResolver.proposeConflictResolutions` as a floating panel over the
 * 3D viewport: one card per over-constrained subgraph, its relax options as
 * ranked chips (the recommended/weakest first, badged), and an "auto-resolve"
 * shortcut. Hovering a card asks the host to HIGHLIGHT the involved mates in the
 * viewport (`onHighlight`) — the actual 3D mesh highlight is the host's job; this
 * component only emits the mate-id set. Accepting an option asks the host to drop
 * that mate (`onAccept`). Nothing is mutated here — the user stays in control.
 *
 * Pure presentation over the tested proposal data → jsdom-testable; only the 3D
 * highlight wiring is browser-gated.
 */

import * as React from 'react';
import type { ConflictProposal, ResolutionOption } from './mateConflictResolver';

export interface ConflictResolutionOverlayProps {
  lang?: string;
  proposals: ConflictProposal[];
  /** Apply one relax option (the host drops/suppresses that mate + re-solves). */
  onAccept: (dropMateId: string) => void;
  /** Apply every conflict's recommended option at once. */
  onAcceptAllRecommended?: () => void;
  /** Hover feedback: host highlights these mates in the 3D viewport. */
  onHighlight?: (mateIds: string[]) => void;
  onClose?: () => void;
}

interface Dict {
  title: string;
  over: string;
  removes: (a: number, b: number) => string;
  relax: string;
  recommended: string;
  autoResolve: string;
  freesDof: (n: number) => string;
}

const DICT: Record<string, Dict> = {
  en: {
    title: 'Mate Conflicts', over: 'Over-constrained',
    removes: (a, b) => `removes ${a} of ${b} DOF`,
    relax: 'Relax', recommended: 'Recommended', autoResolve: 'Auto-resolve (recommended)',
    freesDof: (n) => `frees ${n} DOF`,
  },
  ko: {
    title: '메이트 충돌', over: '과구속',
    removes: (a, b) => `${b} 중 ${a} DOF 제거`,
    relax: '완화', recommended: '권장', autoResolve: '자동 해소 (권장)',
    freesDof: (n) => `${n} DOF 해제`,
  },
  ja: {
    title: 'メイト競合', over: '過拘束',
    removes: (a, b) => `${b}中${a} DOFを除去`,
    relax: '緩和', recommended: '推奨', autoResolve: '自動解決 (推奨)',
    freesDof: (n) => `${n} DOFを開放`,
  },
  zh: {
    title: '配合冲突', over: '过约束',
    removes: (a, b) => `移除 ${b} 中的 ${a} 个自由度`,
    relax: '放松', recommended: '推荐', autoResolve: '自动解决 (推荐)',
    freesDof: (n) => `释放 ${n} 个自由度`,
  },
};

function pickDict(lang?: string): Dict {
  const key = lang === 'cn' ? 'zh' : lang === 'kr' ? 'ko' : (lang ?? 'en');
  return DICT[key] ?? DICT.en;
}

const C = {
  bg: 'var(--nx-panel)', card: 'var(--nx-panel-2)', border: 'var(--nx-border)',
  text: 'var(--nx-text)', dim: 'var(--nx-text-2)', accent: 'var(--nx-accent)',
  warn: 'var(--nx-warn)', ok: 'var(--nx-ok)',
};

export default function ConflictResolutionOverlay({
  lang, proposals, onAccept, onAcceptAllRecommended, onHighlight, onClose,
}: ConflictResolutionOverlayProps): React.ReactElement | null {
  const t = pickDict(lang);
  if (proposals.length === 0) return null;

  return (
    <div
      data-testid="conflict-overlay"
      style={{
        position: 'fixed', top: 60, left: 16, width: 300, maxHeight: 'calc(100vh - 80px)',
        overflowY: 'auto', background: C.bg, border: `1px solid ${C.warn}`, borderRadius: 10,
        zIndex: 850, color: C.text, fontSize: 13,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        boxShadow: '0 8px 32px rgba(0,0,0,.45)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontWeight: 700, color: C.warn }}>⚠ {t.title} ({proposals.length})</span>
        {onClose ? (
          <button data-testid="conflict-overlay-close" onClick={onClose} style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
        ) : null}
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {onAcceptAllRecommended ? (
          <button
            data-testid="conflict-accept-all"
            onClick={onAcceptAllRecommended}
            style={{ width: '100%', padding: '6px 0', background: C.accent, color: 'var(--nx-text)', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
          >
            {t.autoResolve}
          </button>
        ) : null}

        {proposals.map((p, i) => (
          <div
            key={i}
            data-testid={`conflict-card-${i}`}
            onMouseEnter={() => onHighlight?.(p.highlightMateIds)}
            onMouseLeave={() => onHighlight?.([])}
            style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}
          >
            <div style={{ fontSize: 11, color: C.dim, marginBottom: 8 }}>
              {t.over}: {t.removes(p.conflict.totalRemoved, p.conflict.availableDofs)}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {p.options.map((opt: ResolutionOption, j) => {
                const isRec = p.recommended?.dropMateId === opt.dropMateId;
                return (
                  <button
                    key={opt.dropMateId}
                    data-testid={`conflict-${i}-option-${j}`}
                    data-recommended={isRec ? 'true' : 'false'}
                    onClick={() => onAccept(opt.dropMateId)}
                    onMouseEnter={() => onHighlight?.([opt.dropMateId])}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6,
                      padding: '5px 8px', background: 'transparent',
                      border: `1px solid ${isRec ? C.accent : C.border}`, borderRadius: 6,
                      color: C.text, cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span>
                      {t.relax} <code style={{ fontFamily: 'monospace' }}>{opt.dropMateId}</code>
                      <span style={{ color: C.dim }}> · {opt.mateType}</span>
                    </span>
                    {isRec ? (
                      <span data-testid={`conflict-${i}-recommended`} style={{ fontSize: 10, color: C.ok, fontWeight: 700, whiteSpace: 'nowrap' }}>
                        ★ {t.recommended}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
