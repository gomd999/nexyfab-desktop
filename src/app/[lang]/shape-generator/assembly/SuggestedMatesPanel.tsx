'use client';

/**
 * SuggestedMatesPanel — Phase 5.2.3 review UI for inferred STEP-import mates.
 *
 * Standalone-by-design:
 *   - No dependency on AssemblyBrowserModal, mateSolver, or the assembly
 *     state store. Pure presentation + accept/reject callbacks.
 *   - Renders the suggestions emitted by
 *     `inferMatesFromPlacements` (stepAssemblyMateInference.ts) as a
 *     diff-style review list. The wrapper component owns the persistence
 *     step — it pushes accepted mates into the AssemblyState and discards
 *     rejected ids. Wrapper integration is intentionally deferred to the
 *     next batch.
 *   - DOES NOT modify `mate.ts`, `stepAssemblyMateInference.ts`, or
 *     `AssemblyBrowserModal.tsx` — pure additive surface.
 *
 * Suggestion lifecycle (caller-controlled):
 *   1. Parent runs `inferMatesFromPlacements` → Mate[].
 *   2. Parent stores the result in component state and passes it as
 *      `suggestions`.
 *   3. User clicks Accept → onAccept(mate) fires. Parent removes the mate
 *      from `suggestions` and pushes it into AssemblyState.mates.
 *   4. User clicks Reject → onReject(mateId) fires. Parent removes the
 *      mate from `suggestions` (does NOT persist it).
 *   5. Accept All / Reject All emit one callback per remaining mate (this
 *      panel iterates and calls onAccept / onReject individually). When
 *      the parent provides the optional `onAcceptAll` / `onRejectAll`
 *      callbacks, those are invoked AFTER the per-mate dispatch so the
 *      parent can do a single state update instead of N (perf hint —
 *      useful when the list has 100+ inferences).
 *
 * Why the panel renders directly from props (no internal state):
 *   - Single source of truth lives in the parent (where AssemblyState
 *     also lives). The panel just shows what's there. When the parent
 *     re-renders with a shorter `suggestions` list after an accept, the
 *     row disappears naturally — no internal "accepted" set to keep in
 *     sync.
 *   - Tests still verify the "row disappears" behavior via a tiny
 *     parent harness that mutates its own state on each callback.
 *
 * Test surface (data-testids):
 *   solver-suggested-panel
 *   solver-suggested-empty
 *   solver-suggested-mate-${id}
 *   solver-suggested-mate-${id}-accept
 *   solver-suggested-mate-${id}-reject
 *   solver-suggested-accept-all
 *   solver-suggested-reject-all
 */

import React, { useCallback } from 'react';
import type { Mate, MateKind } from '@/lib/assembly/mate';

// ─── i18n ─────────────────────────────────────────────────────────────────

export type PanelLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  /** Panel header (count of remaining suggestions is appended dynamically). */
  header: string;
  acceptAll: string;
  rejectAll: string;
  accept: string;
  reject: string;
  empty: string;
  /** Localized mate kind names. Engineering-standard English where the
   *  industry uses English directly (Coincident etc. in en/ko/ja/zh) — see
   *  AssemblyMatesPanel.tsx for the same convention. */
  kindNames: Record<MateKind, string>;
}

const dict: Record<PanelLang, Dict> = {
  ko: {
    header: '추천 메이트',
    acceptAll: '모두 적용',
    rejectAll: '모두 거부',
    accept: '적용',
    reject: '거부',
    empty: '추천된 메이트가 없습니다',
    kindNames: {
      coincident: '일치',
      concentric: '동심',
      parallel: '평행',
      perpendicular: '수직',
      distance: '거리',
      angle: '각도',
      tangent: '접선',
      hinge: '힌지',
      slot: '슬롯',
      gear: '기어',
      rack_pinion: '랙피니언',
    },
  },
  en: {
    header: 'Suggested Mates',
    acceptAll: 'Accept all',
    rejectAll: 'Reject all',
    accept: 'Accept',
    reject: 'Reject',
    empty: 'No mate suggestions found',
    kindNames: {
      coincident: 'Coincident',
      concentric: 'Concentric',
      parallel: 'Parallel',
      perpendicular: 'Perpendicular',
      distance: 'Distance',
      angle: 'Angle',
      tangent: 'Tangent',
      hinge: 'Hinge',
      slot: 'Slot',
      gear: 'Gear',
      rack_pinion: 'Rack & Pinion',
    },
  },
  ja: {
    header: '推奨合致',
    acceptAll: 'すべて適用',
    rejectAll: 'すべて拒否',
    accept: '適用',
    reject: '拒否',
    empty: '推奨される合致はありません',
    kindNames: {
      coincident: '一致',
      concentric: '同心',
      parallel: '平行',
      perpendicular: '直角',
      distance: '距離',
      angle: '角度',
      tangent: '接線',
      hinge: 'ヒンジ',
      slot: 'スロット',
      gear: 'ギア',
      rack_pinion: 'ラック&ピニオン',
    },
  },
  zh: {
    header: '建议配合',
    acceptAll: '全部接受',
    rejectAll: '全部拒绝',
    accept: '接受',
    reject: '拒绝',
    empty: '未找到配合建议',
    kindNames: {
      coincident: '重合',
      concentric: '同心',
      parallel: '平行',
      perpendicular: '垂直',
      distance: '距离',
      angle: '角度',
      tangent: '相切',
      hinge: '铰链',
      slot: '滑槽',
      gear: '齿轮',
      rack_pinion: '齿轮齿条',
    },
  },
  es: {
    header: 'Restricciones sugeridas',
    acceptAll: 'Aceptar todo',
    rejectAll: 'Rechazar todo',
    accept: 'Aceptar',
    reject: 'Rechazar',
    empty: 'No se encontraron sugerencias',
    kindNames: {
      coincident: 'Coincidente',
      concentric: 'Concéntrico',
      parallel: 'Paralelo',
      perpendicular: 'Perpendicular',
      distance: 'Distancia',
      angle: 'Ángulo',
      tangent: 'Tangente',
      hinge: 'Bisagra',
      slot: 'Ranura',
      gear: 'Engranaje',
      rack_pinion: 'Cremallera y piñón',
    },
  },
  ar: {
    header: 'القيود المقترحة',
    acceptAll: 'قبول الكل',
    rejectAll: 'رفض الكل',
    accept: 'قبول',
    reject: 'رفض',
    empty: 'لا توجد قيود مقترحة',
    kindNames: {
      coincident: 'تطابق',
      concentric: 'متمركز',
      parallel: 'متوازي',
      perpendicular: 'متعامد',
      distance: 'المسافة',
      angle: 'الزاوية',
      tangent: 'مماس',
      hinge: 'مفصلة',
      slot: 'مزلاج',
      gear: 'ترس',
      rack_pinion: 'ترس ومسنن',
    },
  },
};

// ─── kind → icon registry ─────────────────────────────────────────────────

/**
 * Kind → glyph map. Matches the symbols used in the toolbar / mates panel
 * for visual continuity. Some characters are encoded as escapes to keep
 * the source ASCII-clean — they render the same as inline glyphs.
 *
 *   coincident      ⊕   stacked overlap
 *   concentric      ⊙   ring on a point (concentric circles)
 *   parallel        ∥   two vertical bars
 *   perpendicular   ⟂   perpendicular sign
 *   distance        ⇔   double-arrow (measured offset)
 *   angle           ∠   angle sign
 *   tangent         ⌒   tangent arc
 *   hinge           ↺   counter-clockwise rotation
 *   slot            ⇄   horizontal slide
 *   gear            ⚙   gear glyph
 *   rack_pinion     ⤨   skewed coupling arrow (linear ↔ rotary)
 */
export const MATE_KIND_ICONS: Record<MateKind, string> = {
  coincident: '⊕',
  concentric: '⊙',
  parallel: '∥',
  perpendicular: '⟂',
  distance: '⇔',
  angle: '∠',
  tangent: '⌒',
  hinge: '↺',
  slot: '⇄',
  gear: '⚙',
  rack_pinion: '⤨',
};

// ─── Props ────────────────────────────────────────────────────────────────

export interface SuggestedMatesPanelProps {
  /** Active editor language. */
  lang: PanelLang;
  /** Inferred mates from `inferMatesFromPlacements`. */
  suggestions: ReadonlyArray<Mate>;
  /** Fires when the user accepts a single suggestion. */
  onAccept: (mate: Mate) => void;
  /**
   * Optional override for "Accept all". When absent the panel falls back to
   * dispatching one `onAccept` per remaining suggestion in render order.
   * Provide this when the parent wants a single state update for the whole
   * batch (perf hint).
   */
  onAcceptAll?: () => void;
  /** Fires when the user rejects a single suggestion. */
  onReject: (mateId: string) => void;
  /**
   * Optional override for "Reject all". Symmetric to `onAcceptAll` — when
   * absent the panel dispatches one `onReject(id)` per remaining suggestion
   * in render order.
   */
  onRejectAll?: () => void;
  /**
   * Optional lookup for friendly part names. Receives the raw `partId`
   * stored on each MateRef and returns the display name. When the function
   * is absent OR returns an empty / nullish string the panel falls back to
   * the raw partId — keeps the panel useful even before the wrapper has
   * resolved names.
   */
  partNameById?: (partId: string) => string | undefined | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Format a `Mate` as a human-readable "partAName:refA → partBName:refB"
 * string. The "name" portion runs through `partNameById` when provided; if
 * the lookup returns a falsy value we fall back to the raw partId so the
 * line is never blank.
 */
function formatMateRefs(
  mate: Mate,
  partNameById: SuggestedMatesPanelProps['partNameById'],
): string {
  const nameOf = (partId: string): string => {
    if (!partNameById) return partId;
    const resolved = partNameById(partId);
    return resolved && resolved.length > 0 ? resolved : partId;
  };
  const a = `${nameOf(mate.a.partId)}:${mate.a.refId}`;
  const b = `${nameOf(mate.b.partId)}:${mate.b.refId}`;
  return `${a} → ${b}`;
}

// ─── Component ────────────────────────────────────────────────────────────

export default function SuggestedMatesPanel(
  props: SuggestedMatesPanelProps,
): React.ReactElement {
  const {
    lang,
    suggestions,
    onAccept,
    onAcceptAll,
    onReject,
    onRejectAll,
    partNameById,
  } = props;

  const t = dict[lang] ?? dict.en;

  const handleAcceptAll = useCallback((): void => {
    if (onAcceptAll) {
      onAcceptAll();
      return;
    }
    // Fall back to per-mate dispatch — iterate over a snapshot so re-render
    // mid-loop (if the parent shrinks `suggestions` on each call) doesn't
    // skip entries.
    for (const m of [...suggestions]) onAccept(m);
  }, [onAccept, onAcceptAll, suggestions]);

  const handleRejectAll = useCallback((): void => {
    if (onRejectAll) {
      onRejectAll();
      return;
    }
    for (const m of [...suggestions]) onReject(m.id);
  }, [onReject, onRejectAll, suggestions]);

  const isEmpty = suggestions.length === 0;

  return (
    <div
      data-testid="solver-suggested-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 12,
        background: 'var(--nx-card-bg, #1a1a1a)',
        border: '1px solid var(--nx-border, #333)',
        borderRadius: 8,
        color: 'var(--nx-text, #eee)',
        fontSize: 12,
      }}
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          {t.header} ({suggestions.length})
        </div>
        {!isEmpty && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              data-testid="solver-suggested-accept-all"
              onClick={handleAcceptAll}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 4,
                border: '1px solid #16a34a55',
                background: '#16a34a22',
                color: '#22c55e',
                cursor: 'pointer',
              }}
            >
              {t.acceptAll}
            </button>
            <button
              type="button"
              data-testid="solver-suggested-reject-all"
              onClick={handleRejectAll}
              style={{
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 4,
                border: '1px solid #dc262655',
                background: '#dc262622',
                color: '#ef4444',
                cursor: 'pointer',
              }}
            >
              {t.rejectAll}
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {isEmpty ? (
        <div
          data-testid="solver-suggested-empty"
          style={{
            padding: 16,
            textAlign: 'center',
            color: 'var(--nx-text-muted, #888)',
            fontSize: 11,
            border: '1px dashed var(--nx-border, #333)',
            borderRadius: 6,
          }}
        >
          {t.empty}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          {suggestions.map((mate) => {
            const icon = MATE_KIND_ICONS[mate.kind];
            const kindName = t.kindNames[mate.kind] ?? mate.kind;
            const refsText = formatMateRefs(mate, partNameById);
            return (
              <div
                key={mate.id}
                data-testid={`solver-suggested-mate-${mate.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  background: 'var(--nx-bg, #111)',
                  borderRadius: 6,
                  border: '1px solid var(--nx-border, #333)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ fontSize: 16, lineHeight: 1, flexShrink: 0 }}
                >
                  {icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{kindName}</div>
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--nx-text-muted, #888)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                    title={refsText}
                  >
                    {refsText}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`solver-suggested-mate-${mate.id}-accept`}
                  onClick={() => onAccept(mate)}
                  aria-label={t.accept}
                  title={t.accept}
                  style={{
                    padding: '3px 8px',
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 4,
                    border: '1px solid #16a34a55',
                    background: '#16a34a22',
                    color: '#22c55e',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {'✓'}
                </button>
                <button
                  type="button"
                  data-testid={`solver-suggested-mate-${mate.id}-reject`}
                  onClick={() => onReject(mate.id)}
                  aria-label={t.reject}
                  title={t.reject}
                  style={{
                    padding: '3px 8px',
                    fontSize: 12,
                    fontWeight: 700,
                    borderRadius: 4,
                    border: '1px solid #dc262655',
                    background: '#dc262622',
                    color: '#ef4444',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {'✕'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
