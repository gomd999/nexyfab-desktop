'use client';

import React, { useState, useCallback } from 'react';
import type { DesignBranch, BranchDiff } from './DesignBranch';
import type { Theme } from '../theme';

interface BranchCompareProps {
  visible: boolean;
  branches: DesignBranch[];
  activeBranch: string;
  onCompare: (branchAId: string, branchBId: string) => BranchDiff | null;
  onMerge: (sourceBranchId: string, targetBranchId: string) => void;
  onClose: () => void;
  theme: Theme;
  lang: string;
}

export default function BranchCompare({
  visible,
  branches,
  activeBranch,
  onCompare,
  onMerge,
  onClose,
  theme,
  lang,
}: BranchCompareProps) {
  const [branchAId, setBranchAId] = useState(activeBranch);
  const [branchBId, setBranchBId] = useState('');
  const [diff, setDiff] = useState<BranchDiff | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);

  const isKo = lang === 'ko';
  const labels = {
    title: isKo ? '브랜치 비교' : 'Branch Compare',
    compare: isKo ? '비교' : 'Compare',
    merge: isKo ? '병합' : 'Merge',
    mergeInto: isKo ? '에 병합' : 'Merge into',
    selectBranch: isKo ? '브랜치 선택...' : 'Select branch...',
    noDiff: isKo ? '차이가 없습니다' : 'No differences found',
    params: isKo ? '파라미터' : 'Parameters',
    features: isKo ? '피처' : 'Features',
    shape: isKo ? '형상' : 'Shape',
    confirmMerge: isKo ? '병합하시겠습니까?' : 'Confirm merge?',
    yes: isKo ? '예' : 'Yes',
    cancel: isKo ? '취소' : 'Cancel',
    added: isKo ? '추가됨' : 'added',
    removed: isKo ? '제거됨' : 'removed',
    onlyInA: isKo ? 'A에만 있음' : 'Only in A',
    onlyInB: isKo ? 'B에만 있음' : 'Only in B',
  };

  const handleCompare = useCallback(() => {
    if (!branchAId || !branchBId) return;
    const result = onCompare(branchAId, branchBId);
    setDiff(result);
    setConfirmMerge(false);
  }, [branchAId, branchBId, onCompare]);

  const handleMerge = useCallback(() => {
    if (!branchBId) return;
    onMerge(branchBId, branchAId);
    setDiff(null);
    setConfirmMerge(false);
    onClose();
  }, [branchAId, branchBId, onMerge, onClose]);

  const branchA = branches.find(b => b.id === branchAId);
  const branchB = branches.find(b => b.id === branchBId);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1100,
    }}
      onClick={onClose}
    >
      <div
        style={{
          width: 520,
          maxHeight: '80vh',
          background: theme.panelBg,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: `1px solid ${theme.border}`,
          gap: 8,
        }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 800, color: theme.text }}>
            {labels.title}
          </div>
          <button
            onClick={onClose}
            style={{
              border: 'none',
              background: theme.cardBg,
              cursor: 'pointer',
              fontSize: 12,
              color: theme.textMuted,
              width: 24,
              height: 24,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            &#x2715;
          </button>
        </div>

        {/* Branch selectors */}
        <div style={{ padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <select
            value={branchAId}
            onChange={e => { setBranchAId(e.target.value); setDiff(null); }}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.inputBg,
              color: theme.text,
              fontSize: 12,
              outline: 'none',
            }}
          >
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 700 }}>vs</span>
          <select
            value={branchBId}
            onChange={e => { setBranchBId(e.target.value); setDiff(null); }}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.inputBg,
              color: theme.text,
              fontSize: 12,
              outline: 'none',
            }}
          >
            <option value="">{labels.selectBranch}</option>
            {branches.filter(b => b.id !== branchAId).map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button
            onClick={handleCompare}
            disabled={!branchAId || !branchBId}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: branchBId ? theme.accent : theme.border,
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              cursor: branchBId ? 'pointer' : 'default',
            }}
          >
            {labels.compare}
          </button>
        </div>

        {/* Diff result */}
        <div className="nf-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
          {diff && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Thumbnail comparison */}
              {(diff.thumbnailA || diff.thumbnailB) && (
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: branchA?.color || theme.textMuted, marginBottom: 4 }}>
                      {branchA?.name || 'A'}
                    </div>
                    {diff.thumbnailA ? (
                      <img src={diff.thumbnailA} alt="" style={{
                        width: '100%',
                        height: 100,
                        objectFit: 'contain',
                        borderRadius: 6,
                        border: `1px solid ${theme.border}`,
                        background: theme.bg,
                      }} />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: 100,
                        borderRadius: 6,
                        border: `1px solid ${theme.border}`,
                        background: theme.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        color: theme.textMuted,
                      }}>
                        No preview
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: branchB?.color || theme.textMuted, marginBottom: 4 }}>
                      {branchB?.name || 'B'}
                    </div>
                    {diff.thumbnailB ? (
                      <img src={diff.thumbnailB} alt="" style={{
                        width: '100%',
                        height: 100,
                        objectFit: 'contain',
                        borderRadius: 6,
                        border: `1px solid ${theme.border}`,
                        background: theme.bg,
                      }} />
                    ) : (
                      <div style={{
                        width: '100%',
                        height: 100,
                        borderRadius: 6,
                        border: `1px solid ${theme.border}`,
                        background: theme.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        color: theme.textMuted,
                      }}>
                        No preview
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Shape diff */}
              {diff.shapeA !== diff.shapeB && (
                <div style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: `${theme.accent}10`,
                  border: `1px solid ${theme.accent}30`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: theme.textMuted, marginBottom: 4 }}>
                    {labels.shape}
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                    <span style={{ color: '#f85149', fontFamily: 'monospace' }}>- {diff.shapeA || '(none)'}</span>
                    <span style={{ color: '#3fb950', fontFamily: 'monospace' }}>+ {diff.shapeB || '(none)'}</span>
                  </div>
                </div>
              )}

              {/* Parameter diffs */}
              {diff.paramDiffs.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.text, marginBottom: 4 }}>
                    {labels.params}
                  </div>
                  {diff.paramDiffs.map((pd, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      gap: 8,
                      padding: '3px 8px',
                      borderRadius: 4,
                      marginBottom: 2,
                      fontFamily: 'monospace',
                      fontSize: 11,
                      background: theme.bg,
                    }}>
                      <span style={{ color: theme.textMuted, fontWeight: 600, minWidth: 80 }}>{pd.key}</span>
                      <span style={{ color: '#f85149' }}>
                        {pd.valueA !== undefined ? pd.valueA : '-'}
                      </span>
                      <span style={{ color: theme.textMuted }}>{'\u2192'}</span>
                      <span style={{ color: '#3fb950' }}>
                        {pd.valueB !== undefined ? pd.valueB : '-'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Feature diffs */}
              {(diff.featureDiffsA.length > 0 || diff.featureDiffsB.length > 0) && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.text, marginBottom: 4 }}>
                    {labels.features}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {/* Branch A features */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: branchA?.color || theme.textMuted, marginBottom: 4 }}>
                        {branchA?.name || 'A'}
                      </div>
                      {diff.featureDiffsA.map((f, i) => {
                        const inB = diff.featureDiffsB.some(fb => fb.type === f.type);
                        return (
                          <div key={i} style={{
                            padding: '2px 6px',
                            borderRadius: 3,
                            marginBottom: 2,
                            fontSize: 10,
                            fontFamily: 'monospace',
                            background: inB ? theme.bg : '#f8514915',
                            color: inB ? theme.text : '#f85149',
                          }}>
                            {f.type} {!f.enabled && '(off)'}
                            {!inB && <span style={{ marginLeft: 4, opacity: 0.7 }}>({labels.onlyInA})</span>}
                          </div>
                        );
                      })}
                    </div>
                    {/* Branch B features */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: branchB?.color || theme.textMuted, marginBottom: 4 }}>
                        {branchB?.name || 'B'}
                      </div>
                      {diff.featureDiffsB.map((f, i) => {
                        const inA = diff.featureDiffsA.some(fa => fa.type === f.type);
                        return (
                          <div key={i} style={{
                            padding: '2px 6px',
                            borderRadius: 3,
                            marginBottom: 2,
                            fontSize: 10,
                            fontFamily: 'monospace',
                            background: inA ? theme.bg : '#3fb95015',
                            color: inA ? theme.text : '#3fb950',
                          }}>
                            {f.type} {!f.enabled && '(off)'}
                            {!inA && <span style={{ marginLeft: 4, opacity: 0.7 }}>({labels.onlyInB})</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* No differences */}
              {diff.paramDiffs.length === 0 && diff.shapeA === diff.shapeB &&
                diff.featureDiffsA.length === diff.featureDiffsB.length &&
                diff.featureDiffsA.every((f, i) => f.type === diff.featureDiffsB[i]?.type) && (
                <div style={{ padding: 16, textAlign: 'center', color: theme.textMuted, fontSize: 12 }}>
                  {labels.noDiff}
                </div>
              )}

              {/* Merge button */}
              {branchBId && (
                <div style={{ marginTop: 8 }}>
                  {confirmMerge ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                      <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600 }}>
                        {labels.confirmMerge}
                      </span>
                      <button
                        onClick={handleMerge}
                        style={{
                          padding: '6px 16px',
                          borderRadius: 6,
                          border: 'none',
                          background: '#3fb950',
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {labels.yes}
                      </button>
                      <button
                        onClick={() => setConfirmMerge(false)}
                        style={{
                          padding: '6px 16px',
                          borderRadius: 6,
                          border: `1px solid ${theme.border}`,
                          background: theme.cardBg,
                          color: theme.textMuted,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmMerge(true)}
                      style={{
                        width: '100%',
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: `1px solid #3fb950`,
                        background: '#3fb95018',
                        color: '#3fb950',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#3fb95030'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#3fb95018'; }}
                    >
                      {labels.merge} &quot;{branchB?.name}&quot; {labels.mergeInto} &quot;{branchA?.name}&quot;
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
