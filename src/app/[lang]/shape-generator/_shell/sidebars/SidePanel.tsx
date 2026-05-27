'use client';

// SidePanel — public container shared by all left/right shell-v2 sidebars.
// Header (28px) + optional tabs (26px) + scrollable content + optional
// footer. All sizing/spacing matches the Nexyfab 3d design/ mockup so the
// six modes (Solid/Sketch/Assembly/Drawing/Render + Hub) share one visual
// vocabulary.

import React from 'react';

export interface SidePanelTab {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

export interface SidePanelProps {
  side: 'left' | 'right';
  title?: string;
  titleIcon?: React.ReactNode;
  tabs?: SidePanelTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** Right-side header actions (collapse/expand/pin). */
  headerActions?: React.ReactNode;
  /** Footer slot — used for filter input, solver chip, etc. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function SidePanel({
  side,
  title,
  titleIcon,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
  footer,
  children,
}: SidePanelProps) {
  return (
    <div
      className={`nx-panel ${side === 'right' ? 'right' : ''}`}
      style={{
        background: 'var(--nx-panel)',
        color: 'var(--nx-text)',
        borderRight: side === 'left' ? '1px solid var(--nx-border)' : 0,
        borderLeft: side === 'right' ? '1px solid var(--nx-border)' : 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
      }}
    >
      {title && (
        <div
          className="nx-panel-h"
          style={{
            height: 28,
            flex: '0 0 28px',
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            borderBottom: '1px solid var(--nx-border)',
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--nx-text)',
            letterSpacing: '0.02em',
            gap: 6,
          }}
        >
          {titleIcon && <span style={{ color: 'var(--nx-text-2)', display: 'inline-flex' }}>{titleIcon}</span>}
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </span>
          {headerActions && <span style={{ display: 'flex', gap: 1 }}>{headerActions}</span>}
        </div>
      )}
      {tabs && tabs.length > 0 && (
        <div
          className="nx-panel-tabs"
          style={{
            height: 26,
            flex: '0 0 26px',
            display: 'flex',
            alignItems: 'stretch',
            borderBottom: '1px solid var(--nx-border)',
            background: 'var(--nx-panel-2)',
          }}
        >
          {tabs.map(tab => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange?.(tab.id)}
                title={tab.label}
                style={{
                  // Equal share + min-width:0 so 3-4 tabs distribute across the
                  // fixed panel width and the label ellipsizes instead of
                  // truncating/overlapping the next tab or the collapse control.
                  flex: '1 1 0',
                  minWidth: 0,
                  padding: '0 6px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  fontSize: 11,
                  color: isActive ? 'var(--nx-text)' : 'var(--nx-text-2)',
                  cursor: 'pointer',
                  border: 0,
                  background: isActive ? 'var(--nx-panel)' : 'transparent',
                  borderRight: '1px solid var(--nx-border)',
                  borderBottom: isActive ? '2px solid var(--nx-accent)' : '2px solid transparent',
                  marginBottom: isActive ? -1 : 0,
                  gap: 4,
                }}
              >
                <span style={{ flexShrink: 0, display: 'inline-flex' }}>{tab.icon}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    style={{
                      flexShrink: 0,
                      padding: '0 4px',
                      fontSize: 9,
                      marginLeft: 2,
                      borderRadius: 3,
                      background: 'var(--nx-panel-3)',
                      color: 'var(--nx-text-2)',
                    }}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div
        style={{
          flex: '1 1 auto',
          overflow: 'auto',
          minHeight: 0,
          fontSize: 12,
        }}
      >
        {children}
      </div>
      {footer && (
        <div
          style={{
            flex: '0 0 auto',
            borderTop: '1px solid var(--nx-border)',
            padding: '6px 8px',
            background: 'var(--nx-panel)',
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
