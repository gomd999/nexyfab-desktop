'use client';

// Sketch mode right pane — ACTIVE SELECTION / CONSTRAINTS ON SELECTION /
// PARAMETERS / SOLVER sections matching mockup #30.

import { SidePanel, PropSection, PropRow, PropNumber, PropSelect, PropCheck, PropItemRow } from './';
import { useShellBridge } from '../shellBridgeStore';
import { I } from '../Icons';

export interface SketchRightPaneProps {
  isKo: boolean;
}

export function SketchRightPane({ isKo }: SketchRightPaneProps) {
  const entities = useShellBridge(s => s.sketchEntities);
  const constraints = useShellBridge(s => s.sketchConstraints);
  const dof = useShellBridge(s => s.sketchDof);
  const solverOk = useShellBridge(s => s.sketchSolverOk);
  const solveMs = useShellBridge(s => s.sketchSolveMs);

  return (
    <SidePanel
      side="right"
      title={isKo ? '스케치 속성' : 'SKETCH PROPERTIES'}
      titleIcon={<I.sketch size={12} />}
    >
      <PropSection title={isKo ? '활성 선택' : 'Active Selection'}>
        <PropRow label={isKo ? '선택' : 'Selected'}>
          <span style={{ fontSize: 11, color: 'var(--nx-accent)' }}>
            {isKo ? '4× ∅6.5 홀 패턴' : '4× ∅6.5 hole pattern'}
          </span>
        </PropRow>
        <PropRow label={isKo ? '지름' : 'Diameter'}>
          <PropNumber value={6.5} onChange={() => { /* TODO wire */ }} suffix="mm" />
        </PropRow>
        <PropRow label={isKo ? '패턴' : 'Pattern'}>
          <PropSelect
            value="rect"
            onChange={() => { /* TODO */ }}
            options={[
              { value: 'rect', label: isKo ? '직사각형 · 2×2' : 'Rectangular · 2×2' },
              { value: 'circular', label: isKo ? '원형' : 'Circular' },
              { value: 'linear', label: isKo ? '선형' : 'Linear' },
            ]}
          />
        </PropRow>
        <PropRow label={isKo ? '간격 X' : 'Spacing X'}>
          <PropNumber value={50.0} onChange={() => { /* TODO */ }} suffix="mm" />
        </PropRow>
        <PropRow label={isKo ? '간격 Y' : 'Spacing Y'}>
          <PropNumber value={26.0} onChange={() => { /* TODO */ }} suffix="mm" />
        </PropRow>
        <PropRow label={isKo ? '구성선' : 'Construction'}>
          <PropCheck checked={false} onChange={() => { /* TODO */ }} label={isKo ? '예' : 'Yes'} />
        </PropRow>
      </PropSection>

      <PropSection title={isKo ? '선택에 적용된 구속조건' : 'Constraints on Selection'}>
        <PropItemRow bullet="↗" label="Concentric · Line.4.center" />
        <PropItemRow bullet="≡" label="Equal · Circle.2 ..." />
        <PropItemRow bullet="⇆" label="Symmetric · X axis" />
      </PropSection>

      <PropSection title={isKo ? '파라미터' : 'Parameters'}>
        <PropRow label="d4 (∅)">
          <PropNumber value={6.5} onChange={() => { /* TODO */ }} suffix="mm" />
        </PropRow>
        <PropRow label="d5 (X pos)">
          <PropNumber value={15.0} onChange={() => { /* TODO */ }} suffix="mm" />
        </PropRow>
        <PropRow label="d6 (Y pos)">
          <PropNumber value={12.0} onChange={() => { /* TODO */ }} suffix="mm" />
        </PropRow>
        <div style={{ fontSize: 10, color: 'var(--nx-accent)', padding: '4px 0' }}>
          ⊳ d5 = (d1 − 50) / 2 · {isKo ? '연결됨' : 'linked'}
        </div>
      </PropSection>

      <PropSection title={isKo ? '솔버' : 'Solver'}>
        <PropRow label={isKo ? '엔티티' : 'entities'}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{entities}</span>
        </PropRow>
        <PropRow label={isKo ? '구속조건' : 'constraints'}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{constraints}</span>
        </PropRow>
        <PropRow label={isKo ? '미정의' : 'under-defined'}>
          <span className="mono" style={{ fontSize: 11, color: solverOk === false ? 'var(--nx-warn, #ffa800)' : 'var(--nx-text-2)' }}>
            {dof ?? 0}
          </span>
        </PropRow>
        <PropRow label={isKo ? '과정의' : 'over-defined'}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>0</span>
        </PropRow>
        <PropRow label={isKo ? '풀이 시간' : 'solve time'}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
            {solveMs != null ? `${solveMs.toFixed(1)} ms` : '—'}
          </span>
        </PropRow>
      </PropSection>
    </SidePanel>
  );
}
