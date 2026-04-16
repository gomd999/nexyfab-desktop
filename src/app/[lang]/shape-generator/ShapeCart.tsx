'use client';

import React, { useState } from 'react';
import type { CartItem } from './useShapeCart';

interface ShapeCartProps {
  items: CartItem[];
  onRemove: (id: string) => void;
  onClear: () => void;
  onBatchQuote: () => void;
  t: Record<string, string>;
}

export default function ShapeCart({ items, onRemove, onClear, onBatchQuote, t }: ShapeCartProps) {
  const [expanded, setExpanded] = useState(true);

  if (items.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 90,
      background: 'rgba(22,27,34,0.97)', backdropFilter: 'blur(16px)',
      borderTop: '1px solid #30363d',
      boxShadow: '0 -4px 24px rgba(0,0,0,0.3)',
      transition: 'transform 0.3s ease',
      transform: expanded ? 'translateY(0)' : 'translateY(calc(100% - 48px))',
    }}>
      {/* Toggle bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '12px 24px', border: 'none', background: 'transparent', cursor: 'pointer',
        }}
      >
        <span style={{ fontSize: 18 }}>🛒</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#c9d1d9' }}>
          {t.cart || 'Cart'} ({items.length})
        </span>
        <span style={{ fontSize: 12, color: '#484f58', transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }}>▲</span>
      </button>

      {/* Cart content */}
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px 16px' }}>
        {/* Items scroll row */}
        <div className="nf-scroll" style={{
          display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12,
          scrollbarWidth: 'thin',
        }}>
          {items.map((item, idx) => (
            <div key={item.id} style={{
              flexShrink: 0, width: 160,
              background: '#21262d', borderRadius: 12, border: '1px solid #30363d',
              overflow: 'hidden', position: 'relative', transition: 'border-color 0.15s',
            }}>
              {/* Thumbnail or placeholder */}
              <div style={{
                width: '100%', height: 100, background: '#0d1117',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden',
              }}>
                {item.thumbnail ? (
                  <img src={item.thumbnail} alt={item.shapeName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <span style={{ fontSize: 32, opacity: 0.3 }}>🧊</span>
                )}
              </div>

              {/* Info */}
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#c9d1d9', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.shapeName}
                </div>
                <div style={{ fontSize: 10, color: '#8b949e', lineHeight: 1.3 }}>
                  {item.bbox.w.toFixed(0)}×{item.bbox.h.toFixed(0)}×{item.bbox.d.toFixed(0)}mm
                </div>
                <div style={{ fontSize: 10, color: '#8b949e' }}>
                  {item.volume_cm3.toFixed(1)} cm³
                </div>
                {item.featureCount > 0 && (
                  <div style={{ fontSize: 9, color: '#58a6ff', fontWeight: 600, marginTop: 2 }}>
                    +{item.featureCount} {t.cartFeatures || 'features'}
                  </div>
                )}
              </div>

              {/* Remove button */}
              <button
                onClick={() => onRemove(item.id)}
                style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 20, height: 20, borderRadius: '50%',
                  border: 'none', background: 'rgba(0,0,0,0.6)', color: '#8b949e',
                  fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1, transition: 'color 0.12s',
                }}
              >×</button>

              {/* Index badge */}
              <div style={{
                position: 'absolute', top: 4, left: 4,
                background: '#388bfd', color: '#fff', borderRadius: '50%',
                width: 18, height: 18, fontSize: 10, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{idx + 1}</div>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClear} style={{
            padding: '8px 16px', borderRadius: 10, border: '1px solid #30363d',
            background: '#21262d', color: '#8b949e', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.12s',
          }}>
            {t.cartClear || 'Clear All'}
          </button>
          <button onClick={onBatchQuote} style={{
            padding: '10px 24px', borderRadius: 12, border: 'none',
            background: 'linear-gradient(135deg, #1f6feb 0%, #388bfd 100%)',
            color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(31,111,235,0.3)',
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'all 0.15s',
          }}>
            🛒 {t.cartBatchQuote || 'Get Batch Quote'} ({items.length}{t.cartPcs || ' items'})
          </button>
        </div>
      </div>
    </div>
  );
}
