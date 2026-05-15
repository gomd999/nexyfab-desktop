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
        {/* Placeholder rows — real entity list populated when sketch store
            exposes a list snapshot. Until then we show count summaries. */}
        <PropItemRow bullet="■" label={isKo ? '외부 사각형' : 'Outer rectangle'} meta={isKo ? '4 라인 · 닫힘' : '4 lines · closed'} />
        <PropItemRow bullet="✏" label={isKo ? '노치 라인' : 'Notch lines'} meta="4 lines" />
        <PropItemRow bullet="○" label="∅6.5 hole" meta="4× pattern" />
        <PropItemRow bullet="┊" label={isKo ? '중심선' : 'Centerline'} meta={isKo ? '구성선' : 'construction'} />
      </PropSection>

      <PropSection title={isKo ? `구속조건 (${constraints})` : `Constraints (${constraints})`}>
        <PropItemRow bullet="↗" label="Coincident" meta="· 6" />
        <PropItemRow bullet="—" label="Horizontal" meta="· 4" />
        <PropItemRow bullet="|" label="Vertical" meta="· 2" />
        <PropItemRow bullet="⇆" label="Symmetric" meta="· 2" />
      </PropSection>

      <PropSection title={isKo ? `치수 (${dimensions})` : `Dimensions (${dimensions})`}>
        <PropItemRow bullet="↔" label="80.00 — width" meta="d1" />
        <PropItemRow bullet="↕" label="50.00 — height" meta="d2" />
        <PropItemRow bullet="↔" label="24.00 — notch" meta="d3" />
        <PropItemRow bullet="∅" label="∅6.5 — holes" meta="d4" />
        <PropItemRow bullet="↔" label="15.00 — hole pos X" meta="d5" />
        <PropItemRow bullet="↕" label="12.00 — hole pos Y" meta="d6" />
      </PropSection>
    </SidePanel>
  );
}
