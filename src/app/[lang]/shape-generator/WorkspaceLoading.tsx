'use client';

import React from 'react';

export type WorkspaceLoadingVariant = 'page' | 'app';

/**
 * Shared splash while the shape-generator bundle or geometry stack loads.
 */
export function WorkspaceLoading({ variant = 'page' }: { variant?: WorkspaceLoadingVariant }) {
  if (variant === 'app') {
    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0d1117',
          color: '#c9d1d9',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ position: 'relative', width: 64, height: 64, marginBottom: 24 }}>
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              border: '4px solid rgba(88, 166, 255, 0.2)',
              borderRadius: '50%',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              border: '4px solid #58a6ff',
              borderRadius: '50%',
              borderTopColor: 'transparent',
              animation: 'nf-wl-spin-app 1s linear infinite',
            }}
          />
          <svg style={{ position: 'absolute', top: 16, left: 16 }} width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth={2}>
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
            <line x1="12" y1="22.08" x2="12" y2="12" />
          </svg>
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: '0.05em' }}>NexyFab CAD</h2>
        <p style={{ fontSize: 13, color: '#8b949e', marginTop: 8 }}>Loading geometry engine & workspace...</p>
        <style>{`@keyframes nf-wl-spin-app { 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100vh',
        background: '#0d1117',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div
        style={{
          width: '44px',
          height: '44px',
          border: '3px solid #1e293b',
          borderTopColor: '#0b5cff',
          borderRadius: '50%',
          animation: 'nf-wl-spin-page 0.7s linear infinite',
        }}
      />
      <p style={{ color: '#94a3b8', fontSize: '14px', fontWeight: 500 }}>Loading 3D workspace...</p>
      <style>{`@keyframes nf-wl-spin-page { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
