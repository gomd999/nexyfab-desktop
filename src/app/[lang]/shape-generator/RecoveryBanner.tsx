'use client';

import React, { useState, useEffect } from 'react';

interface RecoveryBannerProps {
  timestamp: number;
  lang: string;
  onRestore: () => void;
  onDismiss: () => void;
}

function formatTimeAgo(ts: number, lang: string): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  const ko = lang === 'ko';

  if (days > 0) return ko ? `${days}일 전` : `${days} day${days > 1 ? 's' : ''} ago`;
  if (hours > 0) return ko ? `${hours}시간 전` : `${hours} hour${hours > 1 ? 's' : ''} ago`;
  if (minutes > 0) return ko ? `${minutes}분 전` : `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  return ko ? '방금 전' : 'just now';
}

export default function RecoveryBanner({ timestamp, lang, onRestore, onDismiss }: RecoveryBannerProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  const ko = lang === 'ko';

  useEffect(() => {
    // Trigger slide-in on mount
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => onDismiss(), 300);
  };

  const handleRestore = () => {
    setExiting(true);
    setTimeout(() => onRestore(), 300);
  };

  const timeAgo = formatTimeAgo(timestamp, lang);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 20px',
        background: '#21262d',
        borderBottom: '1px solid #30363d',
        flexShrink: 0,
        transform: visible && !exiting ? 'translateY(0)' : 'translateY(-100%)',
        opacity: visible && !exiting ? 1 : 0,
        transition: 'transform 0.3s ease, opacity 0.3s ease',
        overflow: 'hidden',
        maxHeight: visible && !exiting ? 60 : 0,
      }}
    >
      {/* Warning icon */}
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: '#f59e0b',
        boxShadow: '0 0 8px rgba(245, 158, 11, 0.5)',
        flexShrink: 0,
      }} />

      {/* Message */}
      <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>
        {ko ? '미저장 작업 복구됨' : 'Unsaved work recovered'}
      </span>
      <span style={{ fontSize: 11, color: '#8b949e' }}>
        — {timeAgo}
      </span>

      <div style={{ flex: 1 }} />

      {/* Restore button */}
      <button
        onClick={handleRestore}
        style={{
          padding: '4px 14px',
          borderRadius: 6,
          border: '1px solid #f59e0b',
          background: 'rgba(245, 158, 11, 0.15)',
          color: '#f59e0b',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'rgba(245, 158, 11, 0.3)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(245, 158, 11, 0.15)';
        }}
      >
        {ko ? '복원' : 'Restore'}
      </button>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        style={{
          padding: '4px 14px',
          borderRadius: 6,
          border: '1px solid #30363d',
          background: '#21262d',
          color: '#8b949e',
          fontSize: 11,
          fontWeight: 700,
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = '#30363d';
          e.currentTarget.style.color = '#c9d1d9';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = '#21262d';
          e.currentTarget.style.color = '#8b949e';
        }}
      >
        {ko ? '무시' : 'Dismiss'}
      </button>
    </div>
  );
}
