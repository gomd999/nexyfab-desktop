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
      background: '#0d1117', borderBottom: '1px solid #21262d',
      fontSize: 10, fontWeight: 600, flexShrink: 0,
      overflow: 'hidden', whiteSpace: 'nowrap',
    }}>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span style={{ color: '#30363d', margin: '0 4px', fontSize: 9 }}>▸</span>
          )}
          <button
            onClick={item.onClick}
            disabled={!item.onClick}
            style={{
              display: 'flex', alignItems: 'center', gap: 3,
              padding: '1px 5px', borderRadius: 3,
              border: 'none', cursor: item.onClick ? 'pointer' : 'default',
              background: item.active ? 'rgba(56,139,253,0.12)' : 'transparent',
              color: item.active ? '#58a6ff' : '#6e7681',
              fontSize: 10, fontWeight: item.active ? 700 : 500,
              fontFamily: 'system-ui, sans-serif',
              transition: 'all 0.1s',
            }}
            onMouseEnter={e => { if (item.onClick) e.currentTarget.style.color = '#c9d1d9'; }}
            onMouseLeave={e => { e.currentTarget.style.color = item.active ? '#58a6ff' : '#6e7681'; }}
          >
            {item.icon && <span style={{ fontSize: 10 }}>{item.icon}</span>}
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
