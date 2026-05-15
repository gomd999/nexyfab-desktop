'use client';

// J3 — Validation results modal extracted from ShapeGeneratorInner.
//
// Renders a compact 2-col stat grid + issue list when geometry validation
// has run. Stateless apart from the close handler — Inner owns the resolved.

import React from 'react';
import type { ValidationResult } from '../analysis/geometryValidation';
import { useAnalysisStore } from '../store/analysisStore';

interface ValidationResultsModalProps {
  open: boolean;
  /**
   * J5 migration path — when omitted, the modal reads from
   * useAnalysisStore.validationResult directly. This lets new call sites
   * skip the prop-drill chain (Inner.tsx → RightPanel → … → modal). Existing
   * call sites can keep passing `result` for backward compat.
   */
  result?: ValidationResult | null;
  onClose: () => void;
  labels: {
    geometryValidation: string;
    manifold: string;
    closedMesh: string;
    consistentNormals: string;
    openEdges: string;
    nonManifoldEdges: string;
    degenerateTri: string;
    duplicateVertices: string;
    totalTriangles: string;
    totalVertices: string;
    volumeLabel: string;
    surfaceAreaLabel: string;
    issuesLabel: string;
  };
}

export default function ValidationResultsModal({
  open, result, onClose, labels,
}: ValidationResultsModalProps) {
  // Fallback to the store when caller didn't pass a value — keeps the
  // controlled and direct-consumer styles both working.
  const storeResult = useAnalysisStore(s => s.validationResult);
  const effectiveResult = result ?? storeResult;
  if (!open || !effectiveResult) return null;
  // alias to the original variable name for the existing JSX below
  const resolved = effectiveResult;

  const rows: Array<[string, string]> = [
    [labels.manifold, resolved.isManifold ? '✅' : '❌'],
    [labels.closedMesh, resolved.isClosed ? '✅' : '❌'],
    [labels.consistentNormals, resolved.hasConsistentNormals ? '✅' : '❌'],
    [labels.openEdges, String(resolved.openEdges)],
    [labels.nonManifoldEdges, String(resolved.nonManifoldEdges)],
    [labels.degenerateTri, String(resolved.degenerateTriangles)],
    [labels.duplicateVertices, String(resolved.duplicateVertices)],
    [labels.totalTriangles, String(resolved.totalTriangles)],
    [labels.totalVertices, String(resolved.totalVertices)],
    [labels.volumeLabel, `${(resolved.volume / 1000).toFixed(2)} cm³`],
    [labels.surfaceAreaLabel, `${(resolved.surfaceArea / 100).toFixed(2)} cm²`],
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--nx-panel-2)', borderRadius: 14, padding: 24,
          maxWidth: 440, width: '90%',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          border: '1px solid var(--nx-border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--nx-text)' }}>
            {labels.geometryValidation}
          </h3>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'none', fontSize: 18,
              cursor: 'pointer', color: 'var(--nx-text-2)',
            }}
          >✕</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
          {rows.map(([label, val], i) => (
            <div
              key={i}
              style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '4px 8px',
                background: i % 2 === 0 ? 'var(--nx-panel)' : '#1b1f27',
                borderRadius: 6,
              }}
            >
              <span style={{ color: 'var(--nx-text-2)', fontWeight: 600 }}>{label}</span>
              <span style={{ fontWeight: 700, color: 'var(--nx-text)' }}>{val}</span>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 12, padding: 10,
          background: 'var(--nx-bg)', borderRadius: 8, fontSize: 11,
          border: '1px solid var(--nx-border)',
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--nx-ok)' }}>{labels.issuesLabel}</div>
          {resolved.issues.map((issue, i) => (
            <div key={i} style={{ color: 'var(--nx-text)', marginBottom: 2 }}>• {issue}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
