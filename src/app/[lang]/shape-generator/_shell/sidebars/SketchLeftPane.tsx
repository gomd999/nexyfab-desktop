'use client';

// Sketch mode left pane — ENTITIES / CONSTRAINTS / DIMENSIONS three sections
// matching mockup #30. Footer shows the "Fully constrained · DOF 0 · Solver OK"
// pill so users know at a glance whether the sketch is closed.

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
            <PropItemRow
              key={d.id}
              bullet="↔"
              label={`${d.value.toFixed(2)}${d.unit ? ` ${d.unit}` : ''}`}
              meta={d.name}
            />
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
