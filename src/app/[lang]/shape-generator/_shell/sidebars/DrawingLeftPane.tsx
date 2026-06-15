'use client';

// Drawing mode left pane — SHEETS / VIEWS ON SHEET / LAYERS sections
// matching mockup #32. SHEETS is the multi-sheet pagination already wired
// in Phase 2-10; this re-renders it inside the v3 SidePanel.

import { SidePanel, PropSection, PropItemRow } from './';
import { I } from '../Icons';
import { useLang } from '../../hooks/useLang';
import { loc } from '../../lib/loc';

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
  void isKo;
  const lang = useLang();
  const active = sheets.find(s => s.id === activeSheet) ?? sheets[0];
  return (
    <SidePanel side="left" title={loc(lang, { ko: '도면', en: 'DRAWINGS', ja: '図面', zh: '图纸', es: 'PLANOS', ar: 'الرسومات' })} titleIcon={<I.doc size={12} />}>
      <PropSection title={loc(lang, { ko: '시트', en: 'Sheets', ja: 'シート', zh: '图幅', es: 'Hojas', ar: 'الأوراق' })}>
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
                {s.layout === 'ortho4' ? loc(lang, { ko: '4뷰 직교', en: '4-view ortho', ja: '4面直交', zh: '四视图正交', es: 'Ortográfica 4 vistas', ar: 'إسقاط 4 مناظر' }) :
                  s.layout === 'iso-only' ? loc(lang, { ko: '아이소', en: 'Isometric', ja: '等角', zh: '等轴测', es: 'Isométrica', ar: 'متساوي القياس' }) :
                  s.layout === 'section' ? loc(lang, { ko: '단면', en: 'Section', ja: '断面', zh: '剖面', es: 'Sección', ar: 'مقطع' }) : loc(lang, { ko: '상세', en: 'Detail', ja: '詳細', zh: '详图', es: 'Detalle', ar: 'تفصيل' })}
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
          <I.plus size={11} /> {loc(lang, { ko: '시트 추가', en: 'Add sheet', ja: 'シート追加', zh: '添加图幅', es: 'Añadir hoja', ar: 'إضافة ورقة' })}
        </button>
      </PropSection>

      <PropSection title={loc(lang, {
        ko: `${active?.title ?? ''} 뷰`,
        en: `Views on ${active?.title ?? ''}`,
        ja: `${active?.title ?? ''} のビュー`,
        zh: `${active?.title ?? ''} 上的视图`,
        es: `Vistas en ${active?.title ?? ''}`,
        ar: `المناظر في ${active?.title ?? ''}`,
      })}>
        {viewsForLayout(active?.layout ?? 'ortho4').map(v => (
          <PropItemRow key={v.id} bullet="◧" label={v.label} meta={v.meta} />
        ))}
      </PropSection>

      <PropSection title={loc(lang, { ko: '레이어', en: 'Layers', ja: 'レイヤー', zh: '图层', es: 'Capas', ar: 'الطبقات' })} defaultExpanded={false}>
        <PropItemRow bullet="●" label={loc(lang, { ko: '보이는 선', en: 'Visible', ja: '実線', zh: '可见线', es: 'Visible', ar: 'الخطوط الظاهرة' })} meta="0.7 mm" />
        <PropItemRow bullet="┄" label={loc(lang, { ko: '숨겨진 선', en: 'Hidden', ja: '隠れ線', zh: '隐藏线', es: 'Oculta', ar: 'الخطوط المخفية' })} meta="0.35 mm" />
        <PropItemRow bullet="┅" label={loc(lang, { ko: '중심선', en: 'Centerline', ja: '中心線', zh: '中心线', es: 'Línea de centro', ar: 'خط المركز' })} meta="0.35 mm" />
        <PropItemRow bullet="↔" label={loc(lang, { ko: '치수', en: 'Dimensions', ja: '寸法', zh: '尺寸', es: 'Cotas', ar: 'الأبعاد' })} meta="0.18 mm" />
        <PropItemRow bullet="·" label={loc(lang, { ko: '구성선', en: 'Construction', ja: '構築線', zh: '构造线', es: 'Construcción', ar: 'خطوط الإنشاء' })} meta="0.18 mm" />
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
