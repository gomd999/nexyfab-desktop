'use client';

// Sketch mode left pane — ENTITIES / CONSTRAINTS / DIMENSIONS three sections
// matching mockup #30. Footer shows the "Fully constrained · DOF 0 · Solver OK"
// pill so users know at a glance whether the sketch is closed.

import React, { useState } from 'react';
import { SidePanel, PropSection, PropItemRow } from './';
import { useShellBridge } from '../shellBridgeStore';
import { I } from '../Icons';

export interface SketchLeftPaneProps {
  isKo: boolean;
}

export function SketchLeftPane({ isKo }: SketchLeftPaneProps) {
  const entities = useShellBridge(s => s.sketchEntities);
  const constraints = useShellBridge(s => s.sketchConstraints);
  const dimensions = useShellBridge(s => s.sketchDimensions);
  const solverOk = useShellBridge(s => s.sketchSolverOk);
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
          className={`nx-panel-footer-pill ${solverOk === false ? 'warn' : ''}`}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: solverOk === false ? 'var(--nx-warn, #ffa800)' : 'var(--nx-accent)' }} />
          {solverOk === false
            ? (isKo ? `미정의 · DOF ${dof ?? '?'}` : `Under-defined · DOF ${dof ?? '?'}`)
            : (isKo ? `완전 정의 · DOF ${dof ?? 0} · Solver OK` : `Fully constrained · DOF ${dof ?? 0} · Solver OK`)}
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

const CONSTRAINT_GLYPH: Record<string, string> = {
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

// Inline-editable dimension row. Click value → number input. Enter or blur
// commits via nexyfab:update-sketch-dimension event; Inner listens and
// calls the sketch store's setDimensionValue.
function DimensionEditableRow({ dim, isKo }: { dim: { id: string; name: string; value: number; unit?: string }; isKo: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(dim.value));
  React.useEffect(() => setDraft(String(dim.value)), [dim.value]);

  const commit = () => {
    const v = parseFloat(draft);
    if (Number.isFinite(v) && typeof window !== 'undefined' && Math.abs(v - dim.value) > 1e-6) {
      window.dispatchEvent(new CustomEvent('nexyfab:update-sketch-dimension', {
        detail: { id: dim.id, name: dim.name, value: v },
      }));
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
        <span style={{ flex: '0 0 auto', color: 'var(--nx-accent)' }}>↔</span>
        <input
          autoFocus
          type="number"
          step={0.01}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(String(dim.value)); setEditing(false); }
          }}
          style={{
            flex: 1, minWidth: 0, height: 20, padding: '0 6px',
            border: '1px solid var(--nx-accent)', borderRadius: 3,
            background: 'var(--nx-bg)', color: 'var(--nx-text)',
            fontSize: 11, fontFamily: 'ui-monospace, monospace', textAlign: 'right',
          }}
        />
        <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{dim.unit ?? 'mm'} · {dim.name}</span>
      </div>
    );
  }

  return (
    <div
      onClick={() => setEditing(true)}
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '3px 0', cursor: 'text',
        borderRadius: 3,
      }}
      title={isKo ? '클릭하여 편집' : 'Click to edit'}
    >
      <span style={{ flex: '0 0 auto', color: 'var(--nx-accent)' }}>↔</span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: 'var(--nx-text)', fontFamily: 'ui-monospace, monospace' }}>
        {dim.value.toFixed(2)} {dim.unit ?? 'mm'}
      </span>
      <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>{dim.name}</span>
    </div>
  );
}
