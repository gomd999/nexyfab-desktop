'use client';

import React from 'react';
import { CAD_WORKSPACE_LABELS } from './constants/labels';
import type { CadWorkspaceId } from './cadWorkspace/cadWorkspaceIds';
import { applyCadWorkspace } from './cadWorkspace/applyCadWorkspace';

type Props = {
  lang: string;
  workspace: CadWorkspaceId;
  workspaceEmptyNeedShape: (workspaceLabel: string) => string;
  workspaceEmptyGoDesign: string;
  isSketchMode: boolean;
};

export default function WorkspaceEmptyHint({
  lang,
  workspace,
  workspaceEmptyNeedShape,
  workspaceEmptyGoDesign,
  isSketchMode,
}: Props) {
  const L = CAD_WORKSPACE_LABELS[lang] ?? CAD_WORKSPACE_LABELS.en;
  const name = L[workspace];
  const msg = workspaceEmptyNeedShape(name);

  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        right: 8,
        zIndex: 25,
        padding: '8px 12px',
        borderRadius: 8,
        background: 'rgba(22,27,34,0.92)',
        border: '1px solid #30363d',
        fontSize: 11,
        fontWeight: 600,
        color: '#c9d1d9',
        lineHeight: 1.45,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        pointerEvents: 'auto',
      }}
    >
      <span style={{ fontSize: 14 }}>💡</span>
      <span style={{ flex: 1 }}>{msg}</span>
      <button
        type="button"
        onClick={() => applyCadWorkspace('design', { isSketchMode })}
        style={{
          flexShrink: 0,
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px solid #388bfd',
          background: 'rgba(56,139,253,0.12)',
          color: '#58a6ff',
          fontSize: 10,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        {workspaceEmptyGoDesign}
      </button>
    </div>
  );
}
