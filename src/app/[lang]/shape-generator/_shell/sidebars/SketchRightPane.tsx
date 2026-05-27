'use client';

// Sketch mode right pane — ACTIVE SELECTION / CONSTRAINTS ON SELECTION /
// PARAMETERS / SOLVER sections matching mockup #30.

import { useState } from 'react';
import { SidePanel, PropSection, PropRow, PropNumber, PropSelect, PropCheck, PropItemRow } from './';
import { useShellBridge } from '../shellBridgeStore';
import { I } from '../Icons';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';

// Wave 1 Phase C — sketch-side events. Inner (or future SketchStoreBridge)
// listens to route the user's input through the real sketch solver /
// pattern engine. UI keeps local state so the input is responsive
// immediately; deep wiring is Wave 2 polish.
function emitSketchSet(key: string, value: number | string | boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nexyfab:set-sketch', { detail: { key, value } }));
}

const SKETCH_CATALOG_DICT_KO: CatalogPanelDict = {
  catalogTitle: '스케치 도구', catalogLoading: '불러오는 중…', catalogReady: '준비됨',
  catalogRun: '실행', catalogFailed: '불러오기 실패', catalogEmpty: '해당 기능이 없습니다',
};
const SKETCH_CATALOG_DICT_EN: CatalogPanelDict = {
  catalogTitle: 'Sketch Tools', catalogLoading: 'Loading…', catalogReady: 'Ready',
  catalogRun: 'Run', catalogFailed: 'Load failed', catalogEmpty: 'No matching feature',
};

export interface SketchRightPaneProps {
  isKo: boolean;
}

export function SketchRightPane({ isKo }: SketchRightPaneProps) {
  const entities = useShellBridge(s => s.sketchEntities);
  const constraints = useShellBridge(s => s.sketchConstraints);
  const dof = useShellBridge(s => s.sketchDof);
  const solverOk = useShellBridge(s => s.sketchSolverOk);
  const solveMs = useShellBridge(s => s.sketchSolveMs);

  // Local state for selection-property edits. Defaults match the mockup
  // (4× ∅6.5 hole pattern). Each change dispatches `nexyfab:set-sketch`
  // for Inner to subscribe to once the real sketch engine binding lands.
  const [holeDiameter, setHoleDiameter] = useState(6.5);
  const [patternType, setPatternType] = useState<'rect' | 'circular' | 'linear'>('rect');
  const [spacingX, setSpacingX] = useState(50.0);
  const [spacingY, setSpacingY] = useState(26.0);
  const [construction, setConstruction] = useState(false);
  const [d4, setD4] = useState(6.5);
  const [d5, setD5] = useState(15.0);
  const [d6, setD6] = useState(12.0);

  return (
    <SidePanel
      side="right"
      title={isKo ? '스케치 속성' : 'SKETCH PROPERTIES'}
      titleIcon={<I.sketch size={12} />}
    >
      <PropSection title={isKo ? '활성 선택' : 'Active Selection'}>
        <PropRow label={isKo ? '선택' : 'Selected'}>
          <span style={{ fontSize: 11, color: 'var(--nx-accent)' }}>
            {isKo ? `4× ∅${holeDiameter} 홀 패턴` : `4× ∅${holeDiameter} hole pattern`}
          </span>
        </PropRow>
        <PropRow label={isKo ? '지름' : 'Diameter'}>
          <PropNumber
            value={holeDiameter}
            onChange={v => { setHoleDiameter(v); emitSketchSet('holeDiameter', v); }}
            suffix="mm"
          />
        </PropRow>
        <PropRow label={isKo ? '패턴' : 'Pattern'}>
          <PropSelect
            value={patternType}
            onChange={v => { setPatternType(v as typeof patternType); emitSketchSet('patternType', v); }}
            options={[
              { value: 'rect', label: isKo ? '직사각형 · 2×2' : 'Rectangular · 2×2' },
              { value: 'circular', label: isKo ? '원형' : 'Circular' },
              { value: 'linear', label: isKo ? '선형' : 'Linear' },
            ]}
          />
        </PropRow>
        <PropRow label={isKo ? '간격 X' : 'Spacing X'}>
          <PropNumber
            value={spacingX}
            onChange={v => { setSpacingX(v); emitSketchSet('spacingX', v); }}
            suffix="mm"
          />
        </PropRow>
        <PropRow label={isKo ? '간격 Y' : 'Spacing Y'}>
          <PropNumber
            value={spacingY}
            onChange={v => { setSpacingY(v); emitSketchSet('spacingY', v); }}
            suffix="mm"
          />
        </PropRow>
        <PropRow label={isKo ? '구성선' : 'Construction'}>
          <PropCheck
            checked={construction}
            onChange={v => { setConstruction(v); emitSketchSet('construction', v); }}
            label={isKo ? '예' : 'Yes'}
          />
        </PropRow>
      </PropSection>

      <PropSection title={isKo ? '선택에 적용된 구속조건' : 'Constraints on Selection'}>
        <PropItemRow bullet="↗" label="Concentric · Line.4.center" />
        <PropItemRow bullet="≡" label="Equal · Circle.2 ..." />
        <PropItemRow bullet="⇆" label="Symmetric · X axis" />
      </PropSection>

      <PropSection title={isKo ? '파라미터' : 'Parameters'}>
        <PropRow label="d4 (∅)">
          <PropNumber
            value={d4}
            onChange={v => { setD4(v); emitSketchSet('d4', v); }}
            suffix="mm"
          />
        </PropRow>
        <PropRow label="d5 (X pos)">
          <PropNumber
            value={d5}
            onChange={v => { setD5(v); emitSketchSet('d5', v); }}
            suffix="mm"
          />
        </PropRow>
        <PropRow label="d6 (Y pos)">
          <PropNumber
            value={d6}
            onChange={v => { setD6(v); emitSketchSet('d6', v); }}
            suffix="mm"
          />
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

      <PropSection title={isKo ? '스케치 도구 (라이브)' : 'Sketch Tools (live)'}>
        <FeatureCatalogPanel
          route="sketch"
          license="pro"
          dict={isKo ? SKETCH_CATALOG_DICT_KO : SKETCH_CATALOG_DICT_EN}
          onRun={(featureId, entryFn) => {
             
            console.info(`[catalog] run ${featureId} via ${entryFn}()`);
          }}
        />
      </PropSection>
    </SidePanel>
  );
}
