'use client';

import React from 'react';
import { usePdmProjectMetaStore } from './store/pdmProjectMetaStore';
import { useCloudProjectAccessStore } from './store/cloudProjectAccessStore';
import type { NfabLifecycleState } from './io/nfabPdmMeta';

interface PdmMetaWorkspaceStripProps {
  isKo?: boolean;
  onFieldsEdited?: () => void;
}

export default function PdmMetaWorkspaceStrip({ isKo, onFieldsEdited }: PdmMetaWorkspaceStripProps) {
  const partNumber = usePdmProjectMetaStore(s => s.partNumber);
  const lifecycle = usePdmProjectMetaStore(s => s.lifecycle);
  const revisionLabel = usePdmProjectMetaStore(s => s.revisionLabel);
  const setPartNumber = usePdmProjectMetaStore(s => s.setPartNumber);
  const setLifecycle = usePdmProjectMetaStore(s => s.setLifecycle);
  const setRevisionLabel = usePdmProjectMetaStore(s => s.setRevisionLabel);
  const cloudReadOnly = useCloudProjectAccessStore(s => s.hydrated && !s.canEdit);

  const inputStyle: React.CSSProperties = {
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 4,
    color: '#e6edf3',
    fontSize: 11,
    padding: '2px 6px',
    minWidth: 0,
    maxWidth: 140,
  };

  const bump = () => {
    if (cloudReadOnly) return;
    onFieldsEdited?.();
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: '4px 10px',
        borderBottom: '1px solid #21262d',
        background: '#0d1117',
        fontSize: 11,
      }}
    >
      <span style={{ color: '#8b949e', fontWeight: 600, letterSpacing: '0.02em' }}>PDM</span>
      {cloudReadOnly && (
        <span style={{ color: '#58a6ff', fontSize: 10, maxWidth: 280, lineHeight: 1.35 }}>
          {isKo
            ? '보기 전용: 팀 뷰어로 열려 있어 PDM 필드와 클라우드 저장을 변경할 수 없습니다.'
            : 'Read-only: opened as team viewer — PDM fields and cloud save are locked.'}
        </span>
      )}
      {lifecycle === 'released' && (
        <span style={{ color: '#d29922', fontSize: 10, maxWidth: 280, lineHeight: 1.35 }}>
          {isKo
            ? '릴리스 상태: 클라우드 저장 시 씬 변경이 거부됩니다. 편집하려면 상태를 WIP로 바꾸세요.'
            : 'Released: cloud saves reject scene changes until you set State to WIP.'}
        </span>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#8b949e' }}>
        {isKo ? '부품 번호' : 'Part #'}
        <input
          value={partNumber}
          onChange={e => {
            setPartNumber(e.target.value);
            bump();
          }}
          readOnly={cloudReadOnly}
          disabled={cloudReadOnly}
          style={inputStyle}
          maxLength={120}
          spellCheck={false}
          aria-label={isKo ? '부품 번호' : 'Part number'}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#8b949e' }}>
        {isKo ? '개정' : 'Rev'}
        <input
          value={revisionLabel}
          onChange={e => {
            setRevisionLabel(e.target.value);
            bump();
          }}
          readOnly={cloudReadOnly}
          disabled={cloudReadOnly}
          style={{ ...inputStyle, maxWidth: 72 }}
          maxLength={64}
          spellCheck={false}
          aria-label={isKo ? '개정 라벨' : 'Revision label'}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#8b949e' }}>
        {isKo ? '상태' : 'State'}
        <select
          value={lifecycle}
          onChange={e => {
            setLifecycle(e.target.value as NfabLifecycleState);
            bump();
          }}
          disabled={cloudReadOnly}
          style={{ ...inputStyle, maxWidth: 110, cursor: cloudReadOnly ? 'not-allowed' : 'pointer' }}
          aria-label={isKo ? '작업 상태' : 'Lifecycle state'}
        >
          <option value="wip">{isKo ? '작업 중' : 'WIP'}</option>
          <option value="released">{isKo ? '릴리스' : 'Released'}</option>
        </select>
      </label>
    </div>
  );
}
