'use client';

// Sketch mode left pane — ENTITIES / CONSTRAINTS / DIMENSIONS three sections
// matching mockup #30. Footer shows the "Fully constrained · DOF 0 · Solver OK"
// pill so users know at a glance whether the sketch is closed.

import React, { useState } from 'react';
import { SidePanel, PropSection, PropItemRow } from './';
import { useShellBridge } from '../shellBridgeStore';
import { sketchStatusColor, sketchStatusLabel } from '../sketchStatusUi';
import { I } from '../Icons';

export interface SketchLeftPaneProps {
  isKo: boolean;
}

export function SketchLeftPane({ isKo }: SketchLeftPaneProps) {
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
      title={isKo ? '스케치 1 — 기본 프로파일' : 'SKETCH 1 — BASE PROFILE'}
      titleIcon={<I.sketch size={12} />}
      footer={
        <span
          className={`nx-panel-footer-pill ${status === 'over-defined' || status === 'inconsistent' || status === 'under-defined' ? 'warn' : ''}`}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: sketchStatusColor(status) }} />
          {sketchStatusLabel(status, dof, redundantCount, isKo)
            ?? (isKo ? '빈 스케치 — 그리기로 시작' : 'Empty sketch — start drawing')}
        </span>
      }
    >
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--nx-border)', color: 'var(--nx-text-3)', fontSize: 11 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <I.plane size={11} />
          {isKo ? 'XY 평면 위' : 'On XY Plane'}
        </span>
      </div>

      <PropSection title={isKo ? `엔티티 (${entities})` : `Entities (${entities})`}>
        {entityList.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
            {isKo ? '엔티티 없음 — 라인 / 사각형 / 원으로 시작' : 'No entities — draw a line / rect / circle to start'}
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

      <PropSection title={isKo ? `구속조건 (${constraints})` : `Constraints (${constraints})`}>
        {groupedConstraints.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
            {isKo ? '구속조건 없음' : 'No constraints'}
          </div>
        ) : (
          groupedConstraints.map(g => (
            <PropItemRow key={g.type} bullet={CONSTRAINT_GLYPH[g.type] ?? '◦'} label={g.type} meta={`· ${g.count}`} />
          ))
        )}
      </PropSection>

      <PropSection title={isKo ? `치수 (${dimensions})` : `Dimensions (${dimensions})`}>
        {dimensionList.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
            {isKo ? '치수 없음' : 'No dimensions'}
          </div>
        ) : (
          dimensionList.map(d => (
            <DimensionEditableRow key={d.id} dim={d} isKo={isKo} />
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
function formatExprError(err: NonNullable<DimensionRowData['expressionError']>, isKo: boolean): string {
  const detail = err.detail ? ` (${err.detail})` : '';
  if (isKo) {
    switch (err.reason) {
      case 'syntax':              return `수식 오류${detail}`;
      case 'unknown-identifier':  return `미정의 변수${detail}`;
      case 'cycle':               return `순환 참조${detail}`;
      case 'runtime':             return `실행 오류${detail}`;
      case 'non-finite':          return `유효하지 않은 값${detail}`;
    }
  }
  switch (err.reason) {
    case 'syntax':              return `Syntax error${detail}`;
    case 'unknown-identifier':  return `Unknown variable${detail}`;
    case 'cycle':               return `Cyclic reference${detail}`;
    case 'runtime':             return `Runtime error${detail}`;
    case 'non-finite':          return `Non-finite value${detail}`;
  }
}

// Inline-editable dimension row. Click value → input. When the dim has an
// `expression`, the input pre-fills with the expression text so the user
// can edit the formula directly; otherwise it's a plain numeric input.
// Commit via nexyfab:update-sketch-dimension event — Inner listens and
// calls the sketch store's setDimensionValue (or setDimensionExpression
// when the committed text isn't a bare number).
export function DimensionEditableRow({ dim, isKo }: { dim: DimensionRowData; isKo: boolean }) {
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

  const errMsg = dim.expressionError ? formatExprError(dim.expressionError, isKo) : null;
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
          placeholder={isKo ? '값 또는 수식 (예: 2*D1)' : 'Value or expression (e.g. 2*D1)'}
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
        title={errMsg ?? (isKo ? '클릭하여 편집' : 'Click to edit')}
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
        aria-label={isKo ? '치수 제거' : 'Remove dimension'}
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
