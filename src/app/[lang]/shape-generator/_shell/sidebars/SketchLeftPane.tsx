'use client';

// Sketch mode left pane — ENTITIES / CONSTRAINTS / DIMENSIONS three sections
// matching mockup #30. Footer shows the "Fully constrained · DOF 0 · Solver OK"
// pill so users know at a glance whether the sketch is closed.

import React, { useState } from 'react';
import { SidePanel, PropSection, PropItemRow } from './';
import { useShellBridge } from '../shellBridgeStore';
import { sketchStatusColor, sketchStatusLabel } from '../sketchStatusUi';
import { I } from '../Icons';
import { pickShellDict, type ShellDict } from '../shellDict';

export interface SketchLeftPaneProps {
  lang: string;
}

export function SketchLeftPane({ lang }: SketchLeftPaneProps) {
  const d = pickShellDict(lang);
  const entities = useShellBridge(s => s.sketchEntities);
  const constraints = useShellBridge(s => s.sketchConstraints);
  const dimensions = useShellBridge(s => s.sketchDimensions);
  const status = useShellBridge(s => s.sketchStatus);
  const redundantCount = useShellBridge(s => s.sketchRedundantCount);
  const dof = useShellBridge(s => s.sketchDof);
  const entityList = useShellBridge(s => s.sketchEntityList);
  const constraintList = useShellBridge(s => s.sketchConstraintList);
  const dimensionList = useShellBridge(s => s.sketchDimensionList);
  // Group constraints by type → "Coincident · 6" rows like the mockup.
  const groupedConstraints = Array.from(
    constraintList.reduce((map, c) => {
      const key = c.type;
      map.set(key, (map.get(key) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  ).map(([type, count]) => ({ type, count }));

  return (
    <SidePanel
      side="left"
      title={d.sketchPaneTitle}
      titleIcon={<I.sketch size={12} />}
      footer={
        <span
          className={`nx-panel-footer-pill ${status === 'over-defined' || status === 'inconsistent' || status === 'under-defined' ? 'warn' : ''}`}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: sketchStatusColor(status) }} />
          {sketchStatusLabel(status, dof, redundantCount, d)
            ?? d.emptySketch}
        </span>
      }
    >
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--nx-border)', color: 'var(--nx-text-3)', fontSize: 11 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <I.plane size={11} />
          {d.onXyPlane}
        </span>
      </div>

      <PropSection title={`${d.entitiesTitle} (${entities})`}>
        {entityList.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
            {d.noEntities}
          </div>
        ) : (
          entityList.map(seg => (
            <PropItemRow
              key={seg.id}
              bullet={seg.type === 'circle' ? '○' : seg.type === 'rect' ? '■' : seg.type === 'arc' ? '⌒' : seg.construction ? '┊' : '✏'}
              label={seg.label}
              meta={seg.meta}
              onRemove={() => {
                if (typeof window === 'undefined') return;
                window.dispatchEvent(new CustomEvent('nexyfab:delete-sketch-entity', { detail: { id: seg.id } }));
              }}
            />
          ))
        )}
      </PropSection>

      <PropSection title={`${d.constraintsTitle} (${constraints})`}>
        {groupedConstraints.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
            {d.noConstraints}
          </div>
        ) : (
          groupedConstraints.map(g => (
            <PropItemRow key={g.type} bullet={CONSTRAINT_GLYPH[g.type] ?? '◦'} label={g.type} meta={`· ${g.count}`} />
          ))
        )}
      </PropSection>

      <PropSection title={`${d.dimensionsTitle} (${dimensions})`}>
        {dimensionList.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
            {d.noDimensions}
          </div>
        ) : (
          dimensionList.map(dim => (
            <DimensionEditableRow key={dim.id} dim={dim} d={d} />
          ))
        )}
      </PropSection>
    </SidePanel>
  );
}

export const CONSTRAINT_GLYPH: Record<string, string> = {
  coincident: '↗',
  horizontal: '—',
  vertical: '|',
  perpendicular: '⊥',
  parallel: '∥',
  tangent: '◜',
  concentric: '◎',
  equal: '≡',
  symmetric: '⇆',
  fix: '◇',
};

export type DimensionRowData = {
  id: string;
  name: string;
  value: number;
  unit?: string;
  expression?: string;
  expressionError?: { reason: 'syntax' | 'unknown-identifier' | 'cycle' | 'runtime' | 'non-finite'; detail?: string };
};

/** i18n for the expression error tooltip. Reasons map to short human strings —
 *  detail is appended verbatim (e.g. the offending identifier name). */
function formatExprError(err: NonNullable<DimensionRowData['expressionError']>, d: ShellDict): string {
  const detail = err.detail ? ` (${err.detail})` : '';
  switch (err.reason) {
    case 'syntax':              return `${d.errSyntax}${detail}`;
    case 'unknown-identifier':  return `${d.errUnknownVar}${detail}`;
    case 'cycle':               return `${d.errCycle}${detail}`;
    case 'runtime':             return `${d.errRuntime}${detail}`;
    case 'non-finite':          return `${d.errNonFinite}${detail}`;
  }
}

// Inline-editable dimension row. Click value → input. When the dim has an
// `expression`, the input pre-fills with the expression text so the user
// can edit the formula directly; otherwise it's a plain numeric input.
// Commit via nexyfab:update-sketch-dimension event — Inner listens and
// calls the sketch store's setDimensionValue (or setDimensionExpression
// when the committed text isn't a bare number).
export function DimensionEditableRow({ dim, d }: { dim: DimensionRowData; d: ShellDict }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(dim.expression ?? String(dim.value));
  React.useEffect(() => setDraft(dim.expression ?? String(dim.value)), [dim.expression, dim.value]);

  const commit = () => {
    const trimmed = draft.trim();
    if (typeof window === 'undefined') { setEditing(false); return; }
    // Bare number → value update (clears expression). Anything else →
    // expression update so the auto-resolver handles it next snapshot.
    const asNum = Number(trimmed);
    if (trimmed !== '' && Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
      if (Math.abs(asNum - dim.value) > 1e-6 || dim.expression) {
        window.dispatchEvent(new CustomEvent('nexyfab:update-sketch-dimension', {
          detail: { id: dim.id, name: dim.name, value: asNum, expression: null },
        }));
      }
    } else if (trimmed !== '' && trimmed !== dim.expression) {
      window.dispatchEvent(new CustomEvent('nexyfab:update-sketch-dimension', {
        detail: { id: dim.id, name: dim.name, value: dim.value, expression: trimmed },
      }));
    }
    setEditing(false);
  };

  const errMsg = dim.expressionError ? formatExprError(dim.expressionError, d) : null;
  const hasExpr = !!dim.expression;
  const valueLabel = hasExpr
    ? `${dim.expression} → ${dim.value.toFixed(2)}`
    : `${dim.value.toFixed(2)}`;

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
        <span style={{ flex: '0 0 auto', color: 'var(--nx-accent)' }}>↔</span>
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(dim.expression ?? String(dim.value)); setEditing(false); }
          }}
          placeholder={d.valueOrExpr}
          style={{
            flex: 1, minWidth: 0, height: 20, padding: '0 6px',
            border: `1px solid ${errMsg ? 'var(--nx-error)' : 'var(--nx-accent)'}`, borderRadius: 3,
            background: 'var(--nx-bg)', color: 'var(--nx-text)',
            fontSize: 11, fontFamily: 'ui-monospace, monospace', textAlign: 'right',
          }}
          title={errMsg ?? undefined}
        />
        <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{dim.unit ?? 'mm'} · {dim.name}</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 0',
        borderRadius: 3,
      }}
      title={errMsg ?? undefined}
    >
      <span style={{ flex: '0 0 auto', color: errMsg ? 'var(--nx-error)' : 'var(--nx-accent)' }}>
        {errMsg ? '⚠' : hasExpr ? 'fx' : '↔'}
      </span>
      <span
        onClick={() => setEditing(true)}
        title={errMsg ?? d.clickToEdit}
        style={{
          flex: 1, minWidth: 0,
          fontSize: 11,
          color: errMsg ? 'var(--nx-error)' : hasExpr ? 'var(--nx-accent-2)' : 'var(--nx-text)',
          fontFamily: 'ui-monospace, monospace', cursor: 'text',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {valueLabel} {dim.unit ?? 'mm'}
      </span>
      <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{dim.name}</span>
      <button
        type="button"
        onClick={() => {
          if (typeof window === 'undefined') return;
          window.dispatchEvent(new CustomEvent('nexyfab:delete-sketch-dimension', { detail: { id: dim.id } }));
        }}
        aria-label={d.removeDimension}
        style={{
          width: 16, height: 16, border: 0, background: 'transparent',
          color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 12,
        }}
      >
        ×
      </button>
    </div>
  );
}
