'use client';

// PushPullBanner — viewport overlay shown while `pushPullMode` is on.
//
// Phase-2A scope: tell the user the mode is active and surface the
// currently-selected face's normal label so they know what would be
// pushed/pulled. Phase-2B will replace this passive banner with an
// interactive 3-D arrow rendered inside the Canvas.

import { useSceneStore as _useSceneStore } from '../store/sceneStore';
import { useUIStore } from '../store/uiStore';
import { useSelectionStore } from '../store/selectionStore';

void _useSceneStore;

export default function PushPullBanner() {
  const active = useUIStore(s => s.pushPullMode);
  const sel = useSelectionStore(s => s.selectedElement);
  if (!active) return null;
  const faceLabel = sel && sel.type === 'face'
    ? (sel.normalLabel ?? 'face')
    : null;
  return (
    <div
      style={{
        position: 'fixed',
        top: 84, left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 600,
        background: 'rgba(0,0,0,0.78)',
        color: 'var(--nx-text)',
        border: '1px solid var(--nx-accent)',
        borderRadius: 8,
        padding: '8px 14px',
        fontSize: 12, fontWeight: 600,
        boxShadow: '0 6px 16px rgba(0,0,0,0.32)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ color: 'var(--nx-accent)' }}>Push/Pull</span>
      {' · '}
      {faceLabel ? `face: ${faceLabel}` : 'select a face'}
      {' · '}
      <span style={{ color: 'var(--nx-text-3)', fontWeight: 500 }}>
        gizmo coming in phase-2B
      </span>
    </div>
  );
}
