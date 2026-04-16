'use client';

import React from 'react';

export type MobileTab = 'shape' | 'features' | 'sketch' | 'analysis' | 'export' | '3d';

interface MobileToolbarProps {
  activeTab: MobileTab | null;
  onTabChange: (tab: MobileTab) => void;
  accentColor?: string;
}

const TABS: { id: MobileTab; icon: string; label: string }[] = [
  { id: 'shape', icon: '\uD83E\uDDCA', label: 'Shape' },
  { id: 'features', icon: '\u2699\uFE0F', label: 'Features' },
  { id: 'sketch', icon: '\u270F\uFE0F', label: 'Sketch' },
  { id: 'analysis', icon: '\uD83D\uDD2C', label: 'Analysis' },
  { id: 'export', icon: '\uD83D\uDCE4', label: 'Export' },
];

export default function MobileToolbar({ activeTab, onTabChange, accentColor = '#388bfd' }: MobileToolbarProps) {
  return (
    <div style={{
      position: 'fixed',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 920,
      height: 56,
      background: '#161b22',
      borderTop: '1px solid #30363d',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-around',
      padding: '0 4px',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    }}>
      {TABS.map(tab => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(active ? tab.id : tab.id)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              padding: '6px 0',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              transition: 'all 0.15s',
              position: 'relative',
            }}
          >
            {active && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: '25%',
                right: '25%',
                height: 2,
                borderRadius: 1,
                background: accentColor,
              }} />
            )}
            <span style={{ fontSize: 18, lineHeight: 1 }}>{tab.icon}</span>
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              color: active ? accentColor : '#8b949e',
              letterSpacing: '0.02em',
            }}>
              {tab.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
