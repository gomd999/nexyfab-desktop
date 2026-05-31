'use client';
/**
 * MatePickerOverlay — Phase F (click-to-mate UX).
 *
 * Renders after the user has clicked the first face (→ `mateFaceA`) AND
 * the second face on a different part (→ `pendingMate`). Lets the user
 * confirm or override the mate type the heuristic suggested before the
 * mate is committed to the assembly. The Apply path forwards through the
 * existing onMateCreated callback in useCanvasSelectionHandlers so the
 * assembly-mutation path stays a single point of truth — this component
 * never touches `assemblyMates` directly.
 *
 * Why a separate overlay instead of expanding SelectionInfoBadge:
 *   - SelectionInfoBadge is the read-only "you clicked this face" badge
 *     — adding mode-state controls there would muddy a 7-language badge
 *     used across the whole canvas. (Per phase brief: do not modify
 *     SelectionInfoBadge.)
 *   - This overlay is gated entirely on `pendingMate`, so it auto-mounts
 *     and auto-unmounts without the host having to manage a `showPicker`
 *     flag.
 *
 * Mate types exposed: coincident / concentric / distance / parallel.
 * The full MateType enum has 10 entries; the click overlay limits to
 * the 4 that take only "two faces" as input — hinge / slider / gear /
 * angle / tangent / perpendicular need extra parameters (axis, gear
 * ratio, angle value) that the click flow doesn't have UI for yet.
 * Users wanting those still edit in the AssemblyMatesPanel after.
 *
 * Heuristic deferral: mateInference.ts (Phase E) produces a richer
 * confidence-ranked suggestion list, but requires PartFingerprints
 * (intent + bbox + holes) that are not in scope at the click handler.
 * Wiring it in would be a separate phase — for now the in-hook
 * `suggestMateType` covers the common 90% (cylinder caps → concentric,
 * everything else → coincident) and the user can override here.
 */
import React from 'react';
import type { ClickMateType, PendingMate } from '../store/selectionStore';

interface PickerLabels {
  title: string;
  apply: string;
  cancel: string;
  suggested: string;
  flipHint: string;
  /** Per-type labels keyed by ClickMateType. */
  type: Record<ClickMateType, string>;
}

interface Props {
  /** Staged mate from the selection store; when null the overlay does not render. */
  pending: PendingMate | null;
  labels: PickerLabels;
  onApply: (type: ClickMateType) => void;
  onCancel: () => void;
}

/** Order matches a natural workflow priority: contact, axial, gap, alignment. */
const MATE_TYPE_ORDER: ClickMateType[] = ['coincident', 'concentric', 'distance', 'parallel'];

export default function MatePickerOverlay({ pending, labels, onApply, onCancel }: Props) {
  // Always-on local state — picker default is the heuristic's pick, user can override.
  // Initialized inside a state init when pending arrives; we re-sync if the
  // pending pair changes (rare in normal use, but defensive).
  const [chosen, setChosen] = React.useState<ClickMateType | null>(null);
  const suggested = pending?.suggestedType ?? null;
  // Re-sync chosen when the pending pair flips (e.g., user picked a new
  // pair without closing the picker). Comparing by faceA/faceB triangle
  // index (the chosen-face primary key) is enough — geometry-level identity
  // would over-trigger.
  const pendingKey = pending
    ? `${pending.faceA.partName}:${pending.faceA.triangleIndices[0]}/${pending.faceB.partName}:${pending.faceB.triangleIndices[0]}`
    : null;
  React.useEffect(() => {
    setChosen(suggested);
  }, [pendingKey, suggested]);

  if (!pending || !suggested) return null;
  const active: ClickMateType = chosen ?? suggested;

  return (
    <div
      data-testid="mate-picker-overlay"
      role="dialog"
      aria-label={labels.title}
      style={{
        position: 'absolute',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 220,
        minWidth: 320,
        maxWidth: 420,
        background: 'rgba(15,20,35,0.97)',
        border: '1px solid rgba(99,102,241,0.5)',
        borderRadius: 12,
        boxShadow: '0 4px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)',
        padding: '14px 16px',
        color: '#e5e7eb',
        fontSize: 12,
        backdropFilter: 'blur(12px)',
        pointerEvents: 'auto',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              width: 8, height: 8, borderRadius: '50%',
              background: '#a78bfa', boxShadow: '0 0 6px #a78bfa',
              display: 'inline-block', flexShrink: 0,
            }}
          />
          <span style={{ fontWeight: 700, color: '#ede9fe', fontSize: 13 }}>{labels.title}</span>
        </div>
        <div style={{ fontSize: 10, color: 'var(--nx-text-3)', fontFamily: 'monospace' }}>
          {pending.faceA.partName} ↔ {pending.faceB.partName}
        </div>
      </div>

      {/* Mate-type buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {MATE_TYPE_ORDER.map((type) => {
          const isActive = type === active;
          const isSuggested = type === suggested;
          return (
            <button
              key={type}
              data-testid={`mate-type-${type}`}
              onClick={() => setChosen(type)}
              aria-pressed={isActive}
              style={{
                padding: '6px 12px',
                background: isActive
                  ? 'rgba(167,139,250,0.30)'
                  : 'rgba(99,102,241,0.10)',
                border: isActive
                  ? '1px solid rgba(167,139,250,0.7)'
                  : '1px solid rgba(99,102,241,0.3)',
                borderRadius: 20,
                color: isActive ? '#ede9fe' : '#c7d2fe',
                fontSize: 11,
                fontWeight: isActive ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 0.12s, border-color 0.12s',
              }}
            >
              {labels.type[type]}
              {isSuggested && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 9,
                    opacity: 0.8,
                    fontWeight: 600,
                    color: '#a78bfa',
                  }}
                >
                  · {labels.suggested}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Flip hint — only when committing coincident against same-direction normals. */}
      {pending.parallelHint && active === 'coincident' && (
        <div
          style={{
            fontSize: 10,
            color: '#fbbf24',
            background: 'rgba(251,191,36,0.10)',
            border: '1px solid rgba(251,191,36,0.3)',
            borderRadius: 6,
            padding: '6px 8px',
            marginBottom: 10,
            lineHeight: 1.4,
          }}
        >
          ⚠ {labels.flipHint}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          data-testid="mate-cancel-button"
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '7px 0',
            background: 'transparent',
            border: '1px solid var(--nx-border)',
            borderRadius: 7,
            color: 'var(--nx-text-2)',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          {labels.cancel}
        </button>
        <button
          data-testid="mate-apply-button"
          onClick={() => onApply(active)}
          style={{
            flex: 2,
            padding: '7px 0',
            background: 'rgba(167,139,250,0.20)',
            border: '1px solid rgba(167,139,250,0.6)',
            borderRadius: 7,
            color: '#ede9fe',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {labels.apply}
        </button>
      </div>
    </div>
  );
}
