'use client';

// Sketch mode right pane — ACTIVE SELECTION / CONSTRAINTS ON SELECTION /
// PARAMETERS / SOLVER sections. All sections are LIVE (2026-06-10): the
// previous hardcoded mockup (fake "4× ∅6.5 hole pattern", fake d4/d5
// params) was replaced with real data from the shell bridge —
//   selection      ← sketchSelectedEntityId (SketchCanvas select tool)
//   constraints    ← sketchConstraintList filtered to the selection
//   parameters     ← sketchDimensionList filtered to the selection
//   solver         ← live read-only diagnostic solve (sketchStatusLive)

import type { ReactNode } from 'react';
import { SidePanel, PropSection, PropRow, PropCheck } from './';
import { useShellBridge } from '../shellBridgeStore';
import { sketchStatusColor, sketchStatusLabel } from '../sketchStatusUi';
import { CONSTRAINT_GLYPH, DimensionEditableRow } from './SketchLeftPane';
import { I } from '../Icons';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';

const SKETCH_CATALOG_DICT_KO: CatalogPanelDict = {
  catalogTitle: '스케치 도구', catalogLoading: '불러오는 중…', catalogReady: '준비됨',
  catalogRun: '실행', catalogFailed: '불러오기 실패', catalogEmpty: '해당 기능이 없습니다',
};
const SKETCH_CATALOG_DICT_EN: CatalogPanelDict = {
  catalogTitle: 'Sketch Tools', catalogLoading: 'Loading…', catalogReady: 'Ready',
  catalogRun: 'Run', catalogFailed: 'Load failed', catalogEmpty: 'No matching feature',
};

const TYPE_LABEL_KO: Record<string, string> = {
  line: '선', arc: '호', circle: '원', rect: '사각형',
  polygon: '다각형', ellipse: '타원', slot: '슬롯', nurbs: '스플라인',
};

function Hint({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--nx-text-3)', padding: '4px 0' }}>
      {children}
    </div>
  );
}

export interface SketchRightPaneProps {
  isKo: boolean;
}

export function SketchRightPane({ isKo }: SketchRightPaneProps) {
  const entities = useShellBridge(s => s.sketchEntities);
  const constraints = useShellBridge(s => s.sketchConstraints);
  const dof = useShellBridge(s => s.sketchDof);
  const status = useShellBridge(s => s.sketchStatus);
  const redundantCount = useShellBridge(s => s.sketchRedundantCount);
  const solveMs = useShellBridge(s => s.sketchSolveMs);
  const entityList = useShellBridge(s => s.sketchEntityList);
  const constraintList = useShellBridge(s => s.sketchConstraintList);
  const dimensionList = useShellBridge(s => s.sketchDimensionList);
  const selectedEntityId = useShellBridge(s => s.sketchSelectedEntityId);

  const selected = selectedEntityId
    ? entityList.find(e => e.id === selectedEntityId) ?? null
    : null;
  // Constraints / dimensions can reference the segment id OR its point ids.
  const selectedIds = selected
    ? new Set<string>([selected.id, ...(selected.pointIds ?? [])])
    : null;
  const selConstraints = selectedIds
    ? constraintList.filter(c => c.entityIds?.some(id => selectedIds.has(id)))
    : [];
  const selDims = selectedIds
    ? dimensionList.filter(d => d.entityIds?.some(id => selectedIds.has(id)))
    : [];

  const typeLabel = selected
    ? (isKo ? TYPE_LABEL_KO[selected.type] ?? selected.type : selected.type)
    : null;

  return (
    <SidePanel
      side="right"
      title={isKo ? '스케치 속성' : 'SKETCH PROPERTIES'}
      titleIcon={<I.sketch size={12} />}
    >
      <PropSection title={isKo ? '활성 선택' : 'Active Selection'}>
        {!selected ? (
          <Hint>
            {isKo
              ? '선택 도구로 엔티티를 클릭하세요'
              : 'Click an entity with the Select tool'}
          </Hint>
        ) : (
          <>
            <PropRow label={isKo ? '선택' : 'Selected'}>
              <span style={{ fontSize: 11, color: 'var(--nx-accent)' }}>{selected.label}</span>
            </PropRow>
            <PropRow label={isKo ? '유형' : 'Type'}>
              <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{typeLabel}</span>
            </PropRow>
            {selected.meta && (
              <PropRow label={isKo ? '정보' : 'Info'}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{selected.meta}</span>
              </PropRow>
            )}
            <PropRow label={isKo ? '구성선' : 'Construction'}>
              <PropCheck
                checked={selected.construction === true}
                onChange={() => {
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('nexyfab:toggle-sketch-construction', {
                    detail: { id: selected.id },
                  }));
                }}
                label={isKo ? '예' : 'Yes'}
              />
            </PropRow>
          </>
        )}
      </PropSection>

      <PropSection title={isKo ? '선택에 적용된 구속조건' : 'Constraints on Selection'}>
        {!selected ? (
          <Hint>{isKo ? '선택 없음' : 'No selection'}</Hint>
        ) : selConstraints.length === 0 ? (
          <Hint>{isKo ? '이 엔티티에 구속조건 없음' : 'No constraints on this entity'}</Hint>
        ) : (
          selConstraints.map(c => (
            <div
              key={c.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 11 }}
            >
              <span style={{ flex: '0 0 auto', color: 'var(--nx-accent)' }}>
                {CONSTRAINT_GLYPH[c.type] ?? '◦'}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--nx-text)' }}>
                {c.type}
              </span>
              {c.satisfied === false && (
                <span
                  title={isKo ? '솔버가 만족시키지 못한 구속조건' : 'Constraint the solver could not satisfy'}
                  style={{ fontSize: 10, color: 'var(--nx-error, #f85149)' }}
                >
                  ⚠
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  if (typeof window === 'undefined') return;
                  window.dispatchEvent(new CustomEvent('nexyfab:delete-sketch-constraint', {
                    detail: { id: c.id },
                  }));
                }}
                aria-label={isKo ? '구속조건 제거' : 'Remove constraint'}
                style={{
                  width: 16, height: 16, border: 0, background: 'transparent',
                  color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 12,
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </PropSection>

      <PropSection title={isKo ? '파라미터' : 'Parameters'}>
        {!selected ? (
          <Hint>{isKo ? '선택 없음' : 'No selection'}</Hint>
        ) : selDims.length === 0 ? (
          <Hint>
            {isKo
              ? '이 엔티티에 치수 없음 — 치수 도구로 추가'
              : 'No dimensions on this entity — add with the Dimension tool'}
          </Hint>
        ) : (
          selDims.map(d => (
            <DimensionEditableRow key={d.id} dim={d} isKo={isKo} />
          ))
        )}
      </PropSection>

      <PropSection title={isKo ? '솔버' : 'Solver'}>
        <PropRow label={isKo ? '상태' : 'status'}>
          <span className="mono" style={{ fontSize: 11, color: sketchStatusColor(status) }}>
            {sketchStatusLabel(status, dof, redundantCount, isKo) ?? '—'}
          </span>
        </PropRow>
        <PropRow label={isKo ? '엔티티' : 'entities'}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{entities}</span>
        </PropRow>
        <PropRow label={isKo ? '구속조건' : 'constraints'}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{constraints}</span>
        </PropRow>
        <PropRow label="DOF">
          <span className="mono" style={{ fontSize: 11, color: sketchStatusColor(status) }}>
            {dof ?? '—'}
          </span>
        </PropRow>
        <PropRow label={isKo ? '잉여 구속' : 'redundant'}>
          <span className="mono" style={{ fontSize: 11, color: redundantCount > 0 ? 'var(--nx-error, #f85149)' : 'var(--nx-text-2)' }}>
            {redundantCount}
          </span>
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
