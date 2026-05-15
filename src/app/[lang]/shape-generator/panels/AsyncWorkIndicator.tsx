'use client';

// A3 — Global async-work indicator pill.
//
// Shows "running…" with a spinner when any of the heavy workers are busy
// (pipeline, DFM, FEA, CSG) and exposes a single cancel button that aborts
// whichever worker is currently active. Pulled out of ShapeGeneratorInner
// so the cancel-priority logic lives in one place.

import React from 'react';

interface AsyncWorkIndicatorProps {
  pipelineLoading: boolean;
  dfmLoading: boolean;
  feaLoading: boolean;
  csgLoading: boolean;
  cancelPipeline: () => void;
  cancelDfm: () => void;
  cancelFea: () => void;
  cancelCsg: () => void;
  labels: {
    feaRunning: string;
    dfmRunning: string;
    csgRunning: string;
    rebuildingGeometry: string;
    cancelLabel: string;
  };
}

export default function AsyncWorkIndicator({
  pipelineLoading, dfmLoading, feaLoading, csgLoading,
  cancelPipeline, cancelDfm, cancelFea, cancelCsg,
  labels,
}: AsyncWorkIndicatorProps) {
  const anyLoading = pipelineLoading || dfmLoading || feaLoading || csgLoading;
  if (!anyLoading) return null;

  // Priority order picks the most-specific message when multiple workers are
  // running at once. Same priority drives the cancel target.
  const message = feaLoading ? labels.feaRunning
    : dfmLoading ? labels.dfmRunning
    : csgLoading ? labels.csgRunning
    : labels.rebuildingGeometry;

  const handleCancel = () => {
    // Cancel whichever workers are loading — multiple may be active in
    // chained flows (e.g. CSG → pipeline rebuild).
    if (feaLoading) cancelFea();
    if (dfmLoading) cancelDfm();
    if (csgLoading) cancelCsg();
    if (pipelineLoading) cancelPipeline();
  };

  return (
    <div style={{
      position: 'fixed', bottom: 70, right: 20, zIndex: 9998,
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 6px 8px 14px', borderRadius: 999,
      background: 'rgba(22, 27, 34, 0.95)', backdropFilter: 'blur(8px)',
      border: '1px solid var(--nx-border)', color: 'var(--nx-text)',
      fontSize: 12, fontWeight: 600,
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: '50%',
        border: '2px solid var(--nx-border)', borderTopColor: 'var(--nx-accent-2)',
        animation: 'nf-spin 0.7s linear infinite',
      }} />
      <span>{message}</span>
      <button
        type="button"
        onClick={handleCancel}
        title={labels.cancelLabel}
        aria-label={labels.cancelLabel}
        style={{
          width: 22, height: 22, borderRadius: '50%',
          border: 'none', background: 'rgba(248, 81, 73, 0.16)',
          color: 'var(--nx-error)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, lineHeight: 1, fontWeight: 700, padding: 0,
        }}
      >×</button>
    </div>
  );
}
