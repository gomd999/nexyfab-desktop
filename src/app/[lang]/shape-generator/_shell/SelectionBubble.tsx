'use client';

// Floating selection bubble — mirrors mockup #14's
// "Fillet 1 · 12 edges · R 2.000 mm  [Edit] [Suppress]" callout shown next
// to a selected feature. Reads selection from the bridge store. Edit /
// Suppress dispatch the existing tool event channel so Inner can handle.

import { useShellBridge } from './shellBridgeStore';

interface SelectionBubbleProps {
  isKo: boolean;
}

export function SelectionBubble({ isKo }: SelectionBubbleProps) {
  const kind = useShellBridge(s => s.selectionKind);
  const label = useShellBridge(s => s.selectionLabel);
  const count = useShellBridge(s => s.selectionCount);
  const editMode = useShellBridge(s => s.editMode);

  if (!kind || !label || editMode === 'sketch') return null;

  const noun =
    kind === 'edge' ? (isKo ? '엣지' : 'edge') :
    kind === 'face' ? (isKo ? '면' : 'face') :
    kind === 'vertex' ? (isKo ? '꼭짓점' : 'vertex') :
    kind === 'multi' ? (isKo ? '항목' : 'items') :
    kind;
  const suffix = count > 1 ? `${count}` : '1';
  const summary = `${suffix} ${noun}${count > 1 && !isKo ? 's' : ''}`;

  return (
    <div
      className="nx-floater"
      style={{
        position: 'absolute',
        bottom: 60,
        right: 20,
        minWidth: 220,
        padding: '10px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'auto',
        zIndex: 5,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: 'var(--nx-select)',
          }}
        />
        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--nx-text)' }}>
          {label}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--nx-text-3)' }}>
          {summary}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          className="nx-pillbtn"
          style={{ height: 22, padding: '0 10px', fontSize: 10 }}
          onClick={() => window.dispatchEvent(new CustomEvent('nexyfab:selection-edit'))}
        >
          {isKo ? '편집' : 'Edit'}
        </button>
        <button
          type="button"
          className="nx-pillbtn"
          style={{ height: 22, padding: '0 10px', fontSize: 10 }}
          onClick={() => window.dispatchEvent(new CustomEvent('nexyfab:selection-suppress'))}
        >
          {isKo ? '억제' : 'Suppress'}
        </button>
      </div>
    </div>
  );
}
