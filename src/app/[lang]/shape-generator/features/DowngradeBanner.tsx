'use client';

/**
 * DowngradeBanner — surfaces OCCT→mesh downgrades to the user so a faceted
 * approximation never ships silently as precise CAD (commercial-trust gate #3).
 *
 * Pure render: all wording/dedup/ordering lives in `summarizeDowngrades`
 * (headless-tested). Pass the notices collected off the result geometry
 * (`collectDowngrades(geometry)`); the banner renders nothing when there are
 * none. Blocked (hard) rows read red, approximated (soft) rows amber.
 */

import React from 'react';
import type { MeshDowngradeNotice } from './downgradeNotice';
import { summarizeDowngrades } from './downgradeNoticeView';

interface DowngradeBannerProps {
  /** Notices stamped on the result geometry — `collectDowngrades(geometry)`. */
  notices: readonly MeshDowngradeNotice[];
  visible: boolean;
  lang: string;
}

export default function DowngradeBanner({ notices, visible, lang }: DowngradeBannerProps) {
  if (!visible) return null;
  const model = summarizeDowngrades(notices, lang);
  if (model.total === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxWidth: 320,
        pointerEvents: 'auto',
      }}
    >
      {model.items.slice(0, 4).map((item, i) => {
        const isBlocked = item.severity === 'blocked';
        const color = isBlocked ? 'var(--nx-error)' : 'var(--nx-warn)';
        const bg = isBlocked
          ? 'linear-gradient(135deg, rgba(248,81,73,0.15) 0%, rgba(218,54,51,0.2) 100%)'
          : 'linear-gradient(135deg, rgba(210,153,34,0.15) 0%, rgba(187,128,9,0.2) 100%)';
        const borderColor = isBlocked ? 'rgba(248,81,73,0.4)' : 'rgba(210,153,34,0.4)';
        return (
          <div
            key={`${item.severity}:${item.op}`}
            title={item.message}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: bg,
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: `1px solid ${borderColor}`,
              borderRadius: 12,
              padding: '6px 12px',
              animation: `downgradeIn 0.3s cubic-bezier(0.175,0.885,0.32,1.275) ${i * 0.05}s both`,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05) inset',
              cursor: 'help',
            }}
          >
            <span style={{ fontSize: 13 }}>{isBlocked ? '🚫' : '⚠️'}</span>
            <span
              style={{
                fontSize: 11,
                color,
                fontWeight: 600,
                letterSpacing: '0.01em',
                lineHeight: 1.3,
              }}
            >
              {item.message}
              {item.count > 1 ? ` ×${item.count}` : ''}
            </span>
          </div>
        );
      })}
      {model.items.length > 4 && (
        <span style={{ fontSize: 10, color: 'var(--nx-warn)', opacity: 0.8, paddingLeft: 4 }}>
          +{model.items.length - 4}
        </span>
      )}
      <style>{`
        @keyframes downgradeIn {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
