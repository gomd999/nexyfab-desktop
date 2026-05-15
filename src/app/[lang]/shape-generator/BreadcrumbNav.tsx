'use client';

import React from 'react';

export interface BreadcrumbItem {
  label: string;
  icon?: string;
  active?: boolean;
  onClick?: () => void;
}

interface BreadcrumbNavProps {
  items: BreadcrumbItem[];
}

export default function BreadcrumbNav({ items }: BreadcrumbNavProps) {
  if (items.length === 0) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 0,
      padding: '0 10px', height: 20,
      background: 'var(--nx-bg)', borderBottom: '1px solid var(--nx-panel-2)',
      fontSize: 10, fontWeight: 600, flexShrink: 0,
      overflow: 'hidden', whiteSpace: 'nowrap',
    }}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span style={{ color: 'var(--nx-border)', margin: '0 4px', fontSize: 9 }}>▸</span>
          )}
          <button
            onClick={item.onClick}
            disabled={!item.onClick}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '1px 5px', borderRadius: 3,
              border: 'none', cursor: item.onClick ? 'pointer' : 'default',
              background: item.active ? 'rgba(56,139,253,0.12)' : 'transparent',
              color: item.active ? 'var(--nx-accent-2)' : 'var(--nx-text-3)',
              fontSize: 10, fontWeight: item.active ? 700 : 500,
              fontFamily: 'system-ui, sans-serif',
              transition: 'all 0.1s',
            }}
            onMouseEnter={e => { if (item.onClick) e.currentTarget.style.color = 'var(--nx-text)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = item.active ? 'var(--nx-accent-2)' : 'var(--nx-text-3)'; }}
          >
            {item.icon && <span style={{ fontSize: 10 }}>{item.icon}</span>}
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
