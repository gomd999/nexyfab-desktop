'use client';

// Drawing mode right pane — VIEW PROPERTIES / DIMENSIONS / GD&T / TITLE BLOCK
// sections matching mockup #32 right side. Plot PDF / Export DWG CTA at bottom.

import { useState } from 'react';
import { SidePanel, PropSection, PropRow, PropSelect, PropCheck, PropItemRow } from './';
import { I } from '../Icons';
import { ToleranceStackSection } from './ToleranceStackSection';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';

// Wave 1 Phase E — drawing-side knobs. Same Local + event pattern as
// Phase F (Render) and Phase C (SketchRightPane). Inner (or a future
// DrawingFrame integration) listens to route to the actual SVG / PDF
// emitter when wiring lands.
function emitDrawingSet(key: string, value: number | string | boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nexyfab:set-drawing', { detail: { key, value } }));
}

const CATALOG_DICT_KO: CatalogPanelDict = {
  catalogTitle: 'GD&T 평가기', catalogLoading: '불러오는 중…', catalogReady: '준비됨',
  catalogRun: '실행', catalogFailed: '불러오기 실패', catalogEmpty: '해당 기능이 없습니다',
};
const CATALOG_DICT_EN: CatalogPanelDict = {
  catalogTitle: 'GD&T Evaluators', catalogLoading: 'Loading…', catalogReady: 'Ready',
  catalogRun: 'Run', catalogFailed: 'Load failed', catalogEmpty: 'No matching feature',
};

export interface DrawingRightPaneProps {
  isKo: boolean;
  onExportPdf: () => void;
  onExportDxf: () => void;
}

export function DrawingRightPane({ isKo, onExportPdf, onExportDxf }: DrawingRightPaneProps) {
  // Local state for view + title block knobs. Defaults match the mockup.
  const [projection, setProjection] = useState<'first' | 'third'>('first');
  const [scale, setScale] = useState<'1:1' | '1:2' | '2:1' | '5:1'>('1:1');
  const [style, setStyle] = useState<'hidden-visible' | 'hidden-removed' | 'shaded'>('hidden-visible');
  const [tangentPhantom, setTangentPhantom] = useState(true);
  const [standard, setStandard] = useState<'asme' | 'iso' | 'jis'>('asme');
  const [drawnBy, setDrawnBy] = useState('J. Kim');
  const [checkedBy, setCheckedBy] = useState('A. Moon');
  const [approvedBy, setApprovedBy] = useState('');

  return (
    <SidePanel
      side="right"
      title={isKo ? '뷰 속성' : 'VIEW PROPERTIES'}
      titleIcon={<I.plane size={12} />}
    >
      <PropSection title={isKo ? '평면도' : 'Top View'}>
        <PropRow label={isKo ? '소스' : 'Source'}>
          <span style={{ fontSize: 11, color: 'var(--nx-accent)' }}>Bracket_v14</span>
        </PropRow>
        <PropRow label={isKo ? '투영' : 'Projection'}>
          <PropSelect
            value={projection}
            onChange={v => { setProjection(v as typeof projection); emitDrawingSet('projection', v); }}
            options={[
              { value: 'first', label: isKo ? '1각법 (ISO)' : 'First angle (ISO)' },
              { value: 'third', label: isKo ? '3각법 (ANSI)' : 'Third angle (ANSI)' },
            ]}
          />
        </PropRow>
        <PropRow label={isKo ? '축척' : 'Scale'}>
          <PropSelect
            value={scale}
            onChange={v => { setScale(v as typeof scale); emitDrawingSet('scale', v); }}
            options={[
              { value: '1:1', label: '1 : 1' },
              { value: '1:2', label: '1 : 2' },
              { value: '2:1', label: '2 : 1' },
              { value: '5:1', label: '5 : 1' },
            ]}
          />
        </PropRow>
        <PropRow label={isKo ? '스타일' : 'Style'}>
          <PropSelect
            value={style}
            onChange={v => { setStyle(v as typeof style); emitDrawingSet('style', v); }}
            options={[
              { value: 'hidden-visible', label: isKo ? '숨김선 표시' : 'Hidden lines visible' },
              { value: 'hidden-removed', label: isKo ? '숨김선 제거' : 'Hidden lines removed' },
              { value: 'shaded', label: isKo ? '쉐이드' : 'Shaded' },
            ]}
          />
        </PropRow>
        <PropRow label={isKo ? '접선 엣지' : 'Tangent edges'}>
          <PropCheck
            checked={tangentPhantom}
            onChange={v => { setTangentPhantom(v); emitDrawingSet('tangentPhantom', v); }}
            label={isKo ? '팬텀' : 'Phantom'}
          />
        </PropRow>
      </PropSection>

      <PropSection title={isKo ? '치수 (6)' : 'Dimensions (6)'}>
        <PropItemRow bullet="↔" label="80.00" meta="d.1 · width" />
        <PropItemRow bullet="↕" label="50.00" meta="d.2 · depth" />
        <PropItemRow bullet="↔" label="50.00" meta="d.3 · hole spacing" />
        <PropItemRow bullet="∅" label="∅6.5" meta="d.4 · hole" />
        <PropItemRow bullet="⌀" label="∅10 ⌴ 3.5" meta="d.5 · counterbore" />
        <PropItemRow bullet="↶" label="R 2.0" meta="d.6 · fillet" />
      </PropSection>

      <PropSection title={isKo ? 'GD&T' : 'GD&T'}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <FcfBox sym="⌖" tol="∅0.2" datums={['A', 'B', 'C']} note={isKo ? '위치 공차: 4× ∅6.5 홀' : 'Position tolerance: 4× ∅6.5 holes'} />
          <FcfBox sym="⫳" tol="0.05" datums={['A']} note={isKo ? '평면도: 기준면' : 'Flatness: base face'} />
        </div>
      </PropSection>

      <PropSection title={isKo ? 'GD&T 평가기 (라이브)' : 'GD&T Evaluators (live)'}>
        <FeatureCatalogPanel
          routes={['inspection', 'drawing']}
          routeLabels={isKo ? { inspection: 'GD&T/검사', drawing: '도면' } : { inspection: 'GD&T/Inspect', drawing: 'Drawing' }}
          license="pro"
          dict={isKo ? CATALOG_DICT_KO : CATALOG_DICT_EN}
          onRun={(featureId, entryFn) => {
             
            console.info(`[catalog] run ${featureId} via ${entryFn}()`);
          }}
        />
      </PropSection>

      <ToleranceStackSection isKo={isKo} />

      <PropSection title={isKo ? '제목 블록' : 'Title Block'}>
        <PropRow label={isKo ? '제작자' : 'Drawn by'}>
          <input
            value={drawnBy}
            onChange={e => { setDrawnBy(e.target.value); emitDrawingSet('drawnBy', e.target.value); }}
            style={titleBlockInput}
          />
        </PropRow>
        <PropRow label={isKo ? '검토' : 'Checked'}>
          <input
            value={checkedBy}
            onChange={e => { setCheckedBy(e.target.value); emitDrawingSet('checkedBy', e.target.value); }}
            style={titleBlockInput}
          />
        </PropRow>
        <PropRow label={isKo ? '승인' : 'Approved'}>
          <input
            value={approvedBy}
            onChange={e => { setApprovedBy(e.target.value); emitDrawingSet('approvedBy', e.target.value); }}
            style={titleBlockInput}
          />
        </PropRow>
        <PropRow label={isKo ? '표준' : 'Standard'}>
          <PropSelect
            value={standard}
            onChange={v => { setStandard(v as typeof standard); emitDrawingSet('standard', v); }}
            options={[
              { value: 'asme', label: 'ASME Y14.5-2018' },
              { value: 'iso', label: 'ISO 8015' },
              { value: 'jis', label: 'JIS B 0024' },
            ]}
          />
        </PropRow>
      </PropSection>

      {/* Output CTA */}
      <div style={{
        position: 'sticky', bottom: 0,
        display: 'flex', gap: 6, padding: '10px 12px',
        background: 'var(--nx-panel)',
        borderTop: '1px solid var(--nx-border)',
      }}>
        <button onClick={onExportPdf} style={primaryBtn}>
          {isKo ? '📄 PDF 출력' : '📄 Plot PDF'}
        </button>
        <button onClick={onExportDxf} style={ghostBtn}>
          {isKo ? '⇩ DWG 내보내기' : '⇩ Export DWG'}
        </button>
      </div>
    </SidePanel>
  );
}

function FcfBox({ sym, tol, datums, note }: { sym: string; tol: string; datums: string[]; note: string }) {
  return (
    <div style={{ border: '1px solid var(--nx-border)', borderRadius: 3, padding: 4, fontSize: 10, color: 'var(--nx-text)', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 120 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'ui-monospace, monospace' }}>
        <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--nx-border)', borderRadius: 2 }}>{sym}</span>
        <span>{tol}</span>
        {datums.map(d => (
          <span key={d} style={{ width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--nx-border)', borderRadius: 2 }}>{d}</span>
        ))}
      </div>
      <div style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>{note}</div>
    </div>
  );
}

const titleBlockInput: React.CSSProperties = {
  width: '100%', height: 22, padding: '0 6px', borderRadius: 3,
  border: '1px solid var(--nx-border)', background: 'var(--nx-bg)',
  color: 'var(--nx-text)', fontSize: 11,
};

const primaryBtn: React.CSSProperties = {
  flex: 1, height: 26, padding: '0 10px',
  border: 0, borderRadius: 4,
  background: 'var(--nx-accent)', color: '#fff',
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
  flex: 1, height: 26, padding: '0 10px',
  border: '1px solid var(--nx-border)', borderRadius: 4,
  background: 'transparent', color: 'var(--nx-text)',
  fontSize: 11, fontWeight: 600, cursor: 'pointer',
};
