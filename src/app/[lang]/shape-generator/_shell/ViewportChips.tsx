'use client';

// Top-of-viewport chip strip — mirrors mockup #14's
// `Shaded | Wireframe | Edges | Section` toggle. Today the chips just
// toggle Inner's existing viewport-state booleans where one exists; the
// truly visual-only chips (wireframe / shaded) stay informational until
// the underlying Three.js renderer exposes a toggle.

import { useState } from 'react';
import { useShellBridge } from './shellBridgeStore';

interface ViewportChipsProps {
  isKo: boolean;
}

type DisplayMode = 'solid' | 'edges' | 'wireframe';

function dispatchDisplayMode(mode: DisplayMode) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nexyfab:display-mode', { detail: { mode } }));
}

export function ViewportChips({ isKo }: ViewportChipsProps) {
  const editMode = useShellBridge(s => s.editMode);
  // Local visual state (mirrors what we dispatch to ShapePreview).
  const [activeMode, setActiveMode] = useState<DisplayMode>('solid');
  const [section, setSection] = useState(false);

  // Hide in sketch mode — these are 3D viewport chips.
  if (editMode === 'sketch') return null;

  const chip = (id: string, label: string, active: boolean, onClick: () => void) => (
    <button
      key={id}
      type="button"
      onClick={onClick}
      className={`nx-chip${active ? ' accent' : ''}`}
      style={{
        cursor: 'pointer',
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        background: active ? 'var(--nx-accent-soft)' : 'var(--nx-panel-2)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 4,
        zIndex: 5,
        pointerEvents: 'auto',
      }}
    >
      {chip('shaded', isKo ? '음영' : 'Shaded', activeMode === 'solid', () => {
        setActiveMode('solid');
        dispatchDisplayMode('solid');
      })}
      {chip('wire', isKo ? '와이어' : 'Wireframe', activeMode === 'wireframe', () => {
        setActiveMode('wireframe');
        dispatchDisplayMode('wireframe');
      })}
      {chip('edges', isKo ? '모서리' : 'Edges', activeMode === 'edges', () => {
        setActiveMode('edges');
        dispatchDisplayMode('edges');
      })}
      {chip('section', isKo ? '단면' : 'Section', section, () => {
        setSection(v => !v);
        window.dispatchEvent(new CustomEvent('nexyfab:tool', { detail: { id: 'section' } }));
      })}
    </div>
  );
}
