'use client';

// Drawing mode left pane — SHEETS / VIEWS ON SHEET / LAYERS sections
// matching mockup #32. SHEETS is the multi-sheet pagination already wired
// in Phase 2-10; this re-renders it inside the v3 SidePanel.

import { SidePanel, PropSection, PropItemRow } from './';
import { I } from '../Icons';

export type DrawingSheetLayout = 'ortho4' | 'iso-only' | 'section' | 'detail';

export interface DrawingSheet {
  id: string;
  title: string;
  layout: DrawingSheetLayout;
}

export interface DrawingLeftPaneProps {
  isKo: boolean;
  sheets: DrawingSheet[];
  activeSheet: string;
  onSelectSheet: (id: string) => void;
  onAddSheet: () => void;
}

export function DrawingLeftPane({
  isKo, sheets, activeSheet, onSelectSheet, onAddSheet,
}: DrawingLeftPaneProps) {
  const active = sheets.find(s => s.id === activeSheet) ?? sheets[0];
  return (
    <SidePanel side="left" title={isKo ? '도면' : 'DRAWINGS'} titleIcon={<I.doc size={12} />}>
      <PropSection title={isKo ? '시트' : 'Sheets'}>
        {sheets.map((s, i) => (
          <div
            key={s.id}
            onClick={() => onSelectSheet(s.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 4px', cursor: 'pointer',
              background: s.id === activeSheet ? 'var(--nx-accent-soft)' : 'transparent',
              borderRadius: 3,
              borderLeft: s.id === activeSheet ? '2px solid var(--nx-accent)' : '2px solid transparent',
              paddingLeft: s.id === activeSheet ? 6 : 8,
            }}
          >
            <span
              style={{
                width: 22, height: 28, flex: '0 0 22px',
                background: 'var(--nx-panel-2)', border: '1px solid var(--nx-border)',
                borderRadius: 2, fontSize: 9, color: 'var(--nx-text-3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--nx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.title}
              </div>
              <div style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>
                {s.layout === 'ortho4' ? (isKo ? '4뷰 직교' : '4-view ortho') :
                  s.layout === 'iso-only' ? (isKo ? '아이소' : 'Isometric') :
                  s.layout === 'section' ? (isKo ? '단면' : 'Section') : (isKo ? '상세' : 'Detail')}
              </div>
            </div>
          </div>
        ))}
        <button
          onClick={onAddSheet}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            width: '100%', height: 28, marginTop: 6,
            border: '1px dashed var(--nx-border)', borderRadius: 3,
            background: 'transparent', color: 'var(--nx-text-3)',
            fontSize: 11, cursor: 'pointer',
          }}
        >
          <I.plus size={11} /> {isKo ? '시트 추가' : 'Add sheet'}
        </button>
      </PropSection>

      <PropSection title={isKo ? `${active?.title ?? ''} 뷰` : `Views on ${active?.title ?? ''}`}>
        {viewsForLayout(active?.layout ?? 'ortho4').map(v => (
          <PropItemRow key={v.id} bullet="◧" label={v.label} meta={v.meta} />
        ))}
      </PropSection>

      <PropSection title={isKo ? '레이어' : 'Layers'} defaultExpanded={false}>
        <PropItemRow bullet="●" label={isKo ? '보이는 선' : 'Visible'} meta="0.7 mm" />
        <PropItemRow bullet="┄" label={isKo ? '숨겨진 선' : 'Hidden'} meta="0.35 mm" />
        <PropItemRow bullet="┅" label={isKo ? '중심선' : 'Centerline'} meta="0.35 mm" />
        <PropItemRow bullet="↔" label={isKo ? '치수' : 'Dimensions'} meta="0.18 mm" />
        <PropItemRow bullet="·" label={isKo ? '구성선' : 'Construction'} meta="0.18 mm" />
      </PropSection>
    </SidePanel>
  );
}

function viewsForLayout(layout: DrawingSheetLayout) {
  if (layout === 'ortho4') {
    return [
      { id: 'top', label: 'Top View', meta: 'ortho · 1:1' },
      { id: 'front', label: 'Front View', meta: 'ortho · 1:1' },
      { id: 'right', label: 'Right View', meta: 'ortho · 1:1' },
      { id: 'iso', label: 'Isometric', meta: 'shaded · 1:1' },
    ];
  }
  if (layout === 'iso-only') return [{ id: 'iso', label: 'Isometric', meta: 'shaded · 1:1' }];
  if (layout === 'section') return [{ id: 'sec', label: 'Section A-A', meta: 'cut · 2:1' }];
  return [{ id: 'det', label: 'Detail', meta: '2:1' }];
}
