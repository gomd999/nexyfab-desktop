'use client';

import React, { useCallback } from 'react';
import { useUIStore } from './store/uiStore';
import { CAD_WORKSPACE_LABELS, CAD_WORKSPACE_SWITCHER_HEADING } from './constants/labels';
import { applyCadWorkspace, CAD_WORKSPACE_ORDER, type CadWorkspaceId } from './cadWorkspace/applyCadWorkspace';

type Props = {
  lang: string;
  isSketchMode?: boolean;
  /** View-only share link: show current workspace but do not allow changes. */
  readOnly?: boolean;
  /** Accessible name for the select (localized). */
  selectAriaLabel?: string;
  onOptimizeBlockedBySketch?: () => void;
};

export default function CadWorkspaceSwitcher({
  lang,
  isSketchMode,
  readOnly,
  selectAriaLabel,
  onOptimizeBlockedBySketch,
}: Props) {
  const cadWorkspace = useUIStore((s) => s.cadWorkspace);

  const labels = CAD_WORKSPACE_LABELS[lang] ?? CAD_WORKSPACE_LABELS.en;
  const heading = CAD_WORKSPACE_SWITCHER_HEADING[lang] ?? CAD_WORKSPACE_SWITCHER_HEADING.en;

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (readOnly) return;
      const id = e.target.value as CadWorkspaceId;
      const r = applyCadWorkspace(id, { isSketchMode });
      if (!r.ok && r.reason === 'sketch') {
        onOptimizeBlockedBySketch?.();
      }
    },
    [readOnly, isSketchMode, onOptimizeBlockedBySketch]
  );

  return (
    <label
      className="sg-autohide"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        paddingLeft: 8,
        paddingRight: 4,
        height: 20,
        fontSize: 10,
        fontWeight: 600,
        color: 'var(--nx-text-2)',
        flexShrink: 0,
        borderBottom: '1px solid var(--nx-panel-2)',
      }}
    >
      <span style={{ whiteSpace: 'nowrap' }}>{heading}</span>
      <select
        value={cadWorkspace}
        onChange={onChange}
        disabled={!!readOnly}
        aria-label={selectAriaLabel ? `${heading}: ${labels[cadWorkspace]}. ${selectAriaLabel}` : `${heading}: ${labels[cadWorkspace]}`}
        title={readOnly ? heading : undefined}
        style={{
          maxWidth: 148,
          padding: '2px 6px',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
          border: '1px solid var(--nx-border)',
          background: readOnly ? 'var(--nx-panel)' : 'var(--nx-panel-2)',
          color: readOnly ? 'var(--nx-text-3)' : 'var(--nx-text)',
          cursor: readOnly ? 'not-allowed' : 'pointer',
          opacity: readOnly ? 0.85 : 1,
        }}
      >
        {CAD_WORKSPACE_ORDER.map((id) => (
          <option key={id} value={id}>
            {labels[id]}
          </option>
        ))}
      </select>
    </label>
  );
}
