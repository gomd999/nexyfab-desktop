'use client';

// File menu — dropdown anchored to TitleBar's File icon. Provides
// New/Open/Save/Save As/Import/Export/Recent items. Each menu item
// dispatches the relevant event so Inner (or ShapeGenerator-wide handlers)
// can pick it up. Kept in shell-v2 so it stays mountable from any route.

import { useEffect, useRef } from 'react';
import { I } from './Icons';

export interface FileMenuItem {
  id: string;
  label: string;
  shortcut?: string;
  divider?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

interface FileMenuProps {
  open: boolean;
  onClose: () => void;
  items: FileMenuItem[];
}

export function FileMenu({ open, onClose, items }: FileMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Slight delay so the click that OPENED the menu doesn't immediately
    // close it on bubble-up.
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDocClick);
    }, 0);
    document.addEventListener('keydown', onEsc);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: 'fixed',
        top: 40,
        left: 12,
        minWidth: 220,
        background: 'var(--nx-panel)',
        border: '1px solid var(--nx-border)',
        borderRadius: 8,
        boxShadow: 'var(--nx-shadow)',
        padding: 4,
        zIndex: 9000,
        fontSize: 12,
        color: 'var(--nx-text)',
      }}
    >
      {items.map(item => {
        if (item.divider) {
          return (
            <div
              key={item.id}
              style={{ height: 1, background: 'var(--nx-border)', margin: '4px 0' }}
            />
          );
        }
        return (
          <button
            type="button"
            key={item.id}
            data-testid={`file-menu-item-${item.id}`}
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.();
              onClose();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              padding: '7px 10px',
              borderRadius: 4,
              border: 0,
              background: 'transparent',
              color: 'var(--nx-text)',
              cursor: item.disabled ? 'not-allowed' : 'pointer',
              opacity: item.disabled ? 0.45 : 1,
              fontSize: 12,
              textAlign: 'left',
            }}
            onMouseEnter={e => {
              if (!item.disabled) e.currentTarget.style.background = 'var(--nx-hover)';
            }}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <I.file size={12} />
            <span style={{ flex: 1 }}>{item.label}</span>
            {item.shortcut && (
              <span
                className="mono"
                style={{ fontSize: 10, color: 'var(--nx-text-3)' }}
              >
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
