'use client';

import React, { useEffect, useRef } from 'react';

/** Marking menu: wedges around cursor (2D sketch context). */
export interface RadialItem {
  id: string;
  label: string;
  icon: string;
  /** Native tooltip (defaults to label). */
  title?: string;
}

const MENU_R = 88;
const BTN_R = 26;
const MENU_INNER_R = 40;
const BTN_INNER_R = 20;
const LINEAR_GAP = 10;
const LINEAR_W = 216;

/** Vertical command column (OK / Cancel / shortcuts). */
export interface RadialLinearItem {
  id: string;
  label: string;
  shortcut?: string;
}

export default function SketchRadialMenu({
  x,
  y,
  visible,
  items,
  innerItems,
  linearItems,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  visible: boolean;
  items: RadialItem[];
  /** Optional second ring (smaller radius, staggered angles). */
  innerItems?: RadialItem[];
  /** Optional vertical list to the right of the radial cluster. */
  linearItems?: RadialLinearItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [visible, onClose]);

  const outer = items.length;
  const inner = innerItems?.length ?? 0;
  const linear = linearItems?.length ?? 0;
  if (!visible || outer === 0) return null;

  const centerX = x;
  const centerY = y;
  const ringBox = (MENU_R + BTN_R) * 2;
  const wrapW = ringBox + (linear > 0 ? LINEAR_GAP + LINEAR_W : 0);

  const placeOuter = (i: number, n: number, r: number, btnR: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const bx = MENU_R + BTN_R + Math.cos(a) * r - btnR;
    const by = MENU_R + BTN_R + Math.sin(a) * r - btnR;
    return { bx, by, btnR };
  };

  /** Stagger inner ring so buttons do not sit under outer wedges. */
  const placeInner = (i: number, n: number) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2 + (Math.PI / n);
    const bx = MENU_R + BTN_R + Math.cos(a) * MENU_INNER_R - BTN_INNER_R;
    const by = MENU_R + BTN_R + Math.sin(a) * MENU_INNER_R - BTN_INNER_R;
    return { bx, by };
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: centerX - MENU_R - BTN_R,
        top: centerY - MENU_R - BTN_R,
        width: wrapW,
        height: (MENU_R + BTN_R) * 2,
        zIndex: 10050,
        pointerEvents: 'none',
      }}
    >
      {/* Dim ring */}
      <div
        style={{
          position: 'absolute',
          left: MENU_R * 0.15,
          top: MENU_R * 0.15,
          width: MENU_R * 1.7,
          height: MENU_R * 1.7,
          borderRadius: '50%',
          background: 'rgba(241,243,245,0.92)',
          border: '1px solid #c9d1d9',
          boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          pointerEvents: 'auto',
        }}
      />
      {inner > 0 && innerItems!.map((item, i) => {
        const { bx, by } = placeInner(i, inner);
        return (
          <button
            key={`in-${item.id}`}
            type="button"
            title={item.title ?? item.label}
            onClick={() => {
              onSelect(item.id);
              onClose();
            }}
            style={{
              position: 'absolute',
              left: bx,
              top: by,
              width: BTN_INNER_R * 2,
              height: BTN_INNER_R * 2,
              borderRadius: '50%',
              border: '1px solid #bfbfbf',
              background: '#f0f3f6',
              color: '#24292f',
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 1px 6px rgba(0,0,0,0.07)',
              pointerEvents: 'auto',
              transition: 'transform 0.08s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'scale(1.06)';
              e.currentTarget.style.background = '#e2e8f0';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.background = '#f0f3f6';
            }}
          >
            <span style={{ lineHeight: 1 }}>{item.icon}</span>
          </button>
        );
      })}
      {items.map((item, i) => {
        const { bx, by } = placeOuter(i, outer, MENU_R, BTN_R);
        return (
          <button
            key={item.id}
            type="button"
            title={item.title ?? item.label}
            onClick={() => {
              onSelect(item.id);
              onClose();
            }}
            style={{
              position: 'absolute',
              left: bx,
              top: by,
              width: BTN_R * 2,
              height: BTN_R * 2,
              borderRadius: '50%',
              border: '1px solid #d0d7de',
              background: '#ffffff',
              color: '#24292f',
              fontSize: 14,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              pointerEvents: 'auto',
              transition: 'transform 0.08s ease',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'scale(1.06)';
              e.currentTarget.style.background = '#f6f8fa';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.background = '#ffffff';
            }}
          >
            <span style={{ lineHeight: 1 }}>{item.icon}</span>
          </button>
        );
      })}
      {linear > 0 && (
        <div
          style={{
            position: 'absolute',
            left: ringBox + LINEAR_GAP,
            top: 8,
            width: LINEAR_W,
            maxHeight: (MENU_R + BTN_R) * 2 - 16,
            overflowY: 'auto',
            background: 'rgba(255,255,255,0.98)',
            border: '1px solid #c9d1d9',
            borderRadius: 8,
            boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
            pointerEvents: 'auto',
            padding: '6px 0',
          }}
        >
          {linearItems!.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.id);
                onClose();
              }}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 12px',
                border: 'none',
                borderBottom: '1px solid #eaeef2',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                color: '#24292f',
                textAlign: 'left',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#f0f3f6'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontWeight: 600 }}>{item.label}</span>
              {item.shortcut ? (
                <span style={{ fontSize: 10, color: '#6e7781', fontFamily: 'ui-monospace, monospace' }}>{item.shortcut}</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
