'use client';

// BottomDrawer — slides up between the viewport and statusbar to surface
// analytical panels (DFM / FEA / Cost / Design variants). Replaces the
// modal-driven flow so analysis tools live alongside the model, mirroring
// Onshape/Fusion 360 conventions. Token-driven so light/dark works free.

import React, { useEffect } from 'react';

export interface BottomDrawerTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

export interface BottomDrawerProps {
  open: boolean;
  activeTab: string;
  tabs: BottomDrawerTab[];
  onTabChange: (id: string) => void;
  onClose: () => void;
  /** Drawer body — usually the selected tab's panel rendered conditionally. */
  children: React.ReactNode;
  /** Height in px when open. Default 280. */
  height?: number;
}

export function BottomDrawer({
  open, activeTab, tabs, onTabChange, onClose, children, height = 280,
}: BottomDrawerProps) {
  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div
      className="nx-bottom-drawer"
      style={{ height: open ? height : 24 }}
      aria-hidden={!open}
    >
      <div className="nx-bottom-drawer-handle">
        <span
          style={{ flex: '0 0 auto', cursor: 'pointer', userSelect: 'none' }}
          onClick={onClose}
          aria-label={open ? 'Collapse drawer' : 'Expand drawer'}
        >
          {open ? '▼' : '▲'}
        </span>
        {tabs.map(tab => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              style={{
                height: 22,
                padding: '0 10px',
                border: 0,
                background: isActive ? 'var(--nx-panel)' : 'transparent',
                color: isActive ? 'var(--nx-text)' : 'var(--nx-text-2)',
                borderBottom: isActive ? '2px solid var(--nx-accent)' : '2px solid transparent',
                marginBottom: -2,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span style={{
                  padding: '0 4px',
                  fontSize: 9,
                  marginLeft: 4,
                  borderRadius: 3,
                  background: 'var(--nx-panel-3)',
                  color: 'var(--nx-text-2)',
                }}>
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          aria-label="Close drawer"
          style={{
            width: 18, height: 18, padding: 0, border: 0, background: 'transparent',
            color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 14,
          }}
        >
          ×
        </button>
      </div>
      {open && (
        <div className="nx-bottom-drawer-body">
          {children}
        </div>
      )}
    </div>
  );
}
