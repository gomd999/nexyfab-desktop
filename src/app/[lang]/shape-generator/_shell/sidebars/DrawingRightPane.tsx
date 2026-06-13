'use client';

// Drawing mode right pane — VIEW PROPERTIES / DIMENSIONS / GD&T / TITLE BLOCK
// sections matching mockup #32 right side. Plot PDF / Export DWG CTA at bottom.

import type { ReactNode } from 'react';
import { SidePanel, PropSection, PropRow, PropSelect, PropCheck, PropItemRow } from './';
import { I } from '../Icons';
import { ToleranceStackSection } from './ToleranceStackSection';
import { FeatureCatalogPanel, type CatalogPanelDict } from '../../featureCatalog/FeatureCatalogPanel';
import { loc } from '../../lib/loc';

// Wraps a control whose handler isn't wired yet so it reads as unavailable
// instead of pretending to work (dimmed + non-interactive + tooltip).
// (2026-06-12 honesty: disable dead controls rather than show fake-working ones)
function Soon({ children, lang }: { children: ReactNode; lang: string }) {
  return (
    <span
      title={loc(lang, { ko: '준비 중 — 아직 적용되지 않습니다', en: 'Coming soon — not yet wired', ja: '近日対応 — 未接続です', zh: '即将推出 — 尚未接入', es: 'Próximamente — aún no conectado', ar: 'قريبًا — غير مفعّل بعد' })}
      style={{ display: 'block', opacity: 0.4, pointerEvents: 'none' }}
    >
      {children}
    </span>
  );
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
  lang: string;
  onExportPdf: () => void;
  onExportDxf: () => void;
}

export function DrawingRightPane({ isKo, lang, onExportPdf, onExportDxf }: DrawingRightPaneProps) {
  return (
    <SidePanel
      side="right"
      title={loc(lang, { ko: '뷰 속성', en: 'VIEW PROPERTIES', ja: 'ビュー プロパティ', zh: '视图属性', es: 'PROPIEDADES DE VISTA', ar: 'خصائص العرض' })}
      titleIcon={<I.plane size={12} />}
    >
      <PropSection title={loc(lang, { ko: '평면도', en: 'Top View', ja: '平面図', zh: '俯视图', es: 'Vista superior', ar: 'المنظر العلوي' })}>
        <PropRow label={loc(lang, { ko: '소스', en: 'Source', ja: 'ソース', zh: '来源', es: 'Origen', ar: 'المصدر' })}>
          <span style={{ fontSize: 11, color: 'var(--nx-accent)' }}>Bracket_v14</span>
        </PropRow>
        <PropRow label={loc(lang, { ko: '투영', en: 'Projection', ja: '投影法', zh: '投影', es: 'Proyección', ar: 'الإسقاط' })}>
          <Soon lang={lang}><PropSelect
            value="first"
            onChange={() => { /* not wired */ }}
            options={[
              { value: 'first', label: loc(lang, { ko: '1각법 (ISO)', en: 'First angle (ISO)', ja: '第一角法 (ISO)', zh: '第一角投影 (ISO)', es: 'Primer ángulo (ISO)', ar: 'الزاوية الأولى (ISO)' }) },
              { value: 'third', label: loc(lang, { ko: '3각법 (ANSI)', en: 'Third angle (ANSI)', ja: '第三角法 (ANSI)', zh: '第三角投影 (ANSI)', es: 'Tercer ángulo (ANSI)', ar: 'الزاوية الثالثة (ANSI)' }) },
            ]}
          /></Soon>
        </PropRow>
        <PropRow label={loc(lang, { ko: '축척', en: 'Scale', ja: '尺度', zh: '比例', es: 'Escala', ar: 'المقياس' })}>
          <Soon lang={lang}><PropSelect
            value="1:1"
            onChange={() => { /* not wired */ }}
            options={[
              { value: '1:1', label: '1 : 1' },
              { value: '1:2', label: '1 : 2' },
              { value: '2:1', label: '2 : 1' },
              { value: '5:1', label: '5 : 1' },
            ]}
          /></Soon>
        </PropRow>
        <PropRow label={loc(lang, { ko: '스타일', en: 'Style', ja: 'スタイル', zh: '样式', es: 'Estilo', ar: 'النمط' })}>
          <Soon lang={lang}><PropSelect
            value="hidden-visible"
            onChange={() => { /* not wired */ }}
            options={[
              { value: 'hidden-visible', label: loc(lang, { ko: '숨김선 표시', en: 'Hidden lines visible', ja: '隠れ線を表示', zh: '显示隐藏线', es: 'Líneas ocultas visibles', ar: 'إظهار الخطوط المخفية' }) },
              { value: 'hidden-removed', label: loc(lang, { ko: '숨김선 제거', en: 'Hidden lines removed', ja: '隠れ線を除去', zh: '移除隐藏线', es: 'Líneas ocultas eliminadas', ar: 'إزالة الخطوط المخفية' }) },
              { value: 'shaded', label: loc(lang, { ko: '쉐이드', en: 'Shaded', ja: 'シェーディング', zh: '着色', es: 'Sombreado', ar: 'مظلّل' }) },
            ]}
          /></Soon>
        </PropRow>
        <PropRow label={loc(lang, { ko: '접선 엣지', en: 'Tangent edges', ja: '接線エッジ', zh: '相切边', es: 'Aristas tangentes', ar: 'الحواف المماسّة' })}>
          <Soon lang={lang}><PropCheck checked onChange={() => { /* not wired */ }} label={loc(lang, { ko: '팬텀', en: 'Phantom', ja: 'ファントム', zh: '幻影线', es: 'Fantasma', ar: 'وهمي' })} /></Soon>
        </PropRow>
      </PropSection>

      <PropSection title={loc(lang, { ko: '치수 (6)', en: 'Dimensions (6)', ja: '寸法 (6)', zh: '尺寸 (6)', es: 'Cotas (6)', ar: 'الأبعاد (6)' })}>
        <PropItemRow bullet="↔" label="80.00" meta="d.1 · width" />
        <PropItemRow bullet="↕" label="50.00" meta="d.2 · depth" />
        <PropItemRow bullet="↔" label="50.00" meta="d.3 · hole spacing" />
        <PropItemRow bullet="∅" label="∅6.5" meta="d.4 · hole" />
        <PropItemRow bullet="⌀" label="∅10 ⌴ 3.5" meta="d.5 · counterbore" />
        <PropItemRow bullet="↶" label="R 2.0" meta="d.6 · fillet" />
      </PropSection>

      <PropSection title={loc(lang, { ko: '기하공차 (GD&T)', en: 'GD&T', ja: '幾何公差 (GD&T)', zh: '几何公差 (GD&T)', es: 'GD&T', ar: 'التفاوتات الهندسية (GD&T)' })}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <FcfBox sym="⌖" tol="∅0.2" datums={['A', 'B', 'C']} note={loc(lang, { ko: '위치 공차: 4× ∅6.5 홀', en: 'Position tolerance: 4× ∅6.5 holes', ja: '位置度公差: 4× ∅6.5 穴', zh: '位置公差: 4× ∅6.5 孔', es: 'Tolerancia de posición: 4× ∅6.5 agujeros', ar: 'تفاوت الموضع: 4× ∅6.5 ثقوب' })} />
          <FcfBox sym="⫳" tol="0.05" datums={['A']} note={loc(lang, { ko: '평면도: 기준면', en: 'Flatness: base face', ja: '平面度: 基準面', zh: '平面度: 基准面', es: 'Planitud: cara base', ar: 'الاستواء: الوجه المرجعي' })} />
        </div>
      </PropSection>

      <PropSection title={loc(lang, { ko: 'GD&T 평가기 (라이브)', en: 'GD&T Evaluators (live)', ja: 'GD&T 評価器 (ライブ)', zh: 'GD&T 评估器 (实时)', es: 'Evaluadores GD&T (en vivo)', ar: 'مقيّمات GD&T (مباشر)' })}>
        <FeatureCatalogPanel
          routes={['inspection', 'drawing']}
          routeLabels={{
            inspection: loc(lang, { ko: 'GD&T/검사', en: 'GD&T/Inspect', ja: 'GD&T/検査', zh: 'GD&T/检验', es: 'GD&T/Inspección', ar: 'GD&T/الفحص' }),
            drawing: loc(lang, { ko: '도면', en: 'Drawing', ja: '図面', zh: '图纸', es: 'Plano', ar: 'الرسم' }),
          }}
          license="pro"
          dict={isKo ? CATALOG_DICT_KO : CATALOG_DICT_EN}
          onRun={(featureId, entryFn) => {
             
            console.info(`[catalog] run ${featureId} via ${entryFn}()`);
          }}
        />
      </PropSection>

      <ToleranceStackSection isKo={isKo} />

      <PropSection title={loc(lang, { ko: '표제란', en: 'Title Block', ja: '表題欄', zh: '标题栏', es: 'Cajetín', ar: 'خانة العنوان' })}>
        <PropRow label={loc(lang, { ko: '제작자', en: 'Drawn by', ja: '作成者', zh: '制图', es: 'Dibujado por', ar: 'رسمه' })}>
          <input
            defaultValue="J. Kim"
            style={{ width: '100%', height: 22, padding: '0 6px', borderRadius: 3, border: '1px solid var(--nx-border)', background: 'var(--nx-bg)', color: 'var(--nx-text)', fontSize: 11 }}
          />
        </PropRow>
        <PropRow label={loc(lang, { ko: '검토', en: 'Checked', ja: '検図', zh: '审核', es: 'Revisado', ar: 'دُقّق' })}>
          <input
            defaultValue="A. Moon"
            style={{ width: '100%', height: 22, padding: '0 6px', borderRadius: 3, border: '1px solid var(--nx-border)', background: 'var(--nx-bg)', color: 'var(--nx-text)', fontSize: 11 }}
          />
        </PropRow>
        <PropRow label={loc(lang, { ko: '승인', en: 'Approved', ja: '承認', zh: '批准', es: 'Aprobado', ar: 'مُعتمد' })}>
          <input
            defaultValue=""
            style={{ width: '100%', height: 22, padding: '0 6px', borderRadius: 3, border: '1px solid var(--nx-border)', background: 'var(--nx-bg)', color: 'var(--nx-text)', fontSize: 11 }}
          />
        </PropRow>
        <PropRow label={loc(lang, { ko: '표준', en: 'Standard', ja: '規格', zh: '标准', es: 'Norma', ar: 'المعيار' })}>
          <PropSelect
            value="asme"
            onChange={() => { /* TODO */ }}
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
          {loc(lang, { ko: '📄 PDF 출력', en: '📄 Plot PDF', ja: '📄 PDF 出力', zh: '📄 输出 PDF', es: '📄 Trazar PDF', ar: '📄 طباعة PDF' })}
        </button>
        <button onClick={onExportDxf} style={ghostBtn}>
          {loc(lang, { ko: '⇩ DWG 내보내기', en: '⇩ Export DWG', ja: '⇩ DWG 書き出し', zh: '⇩ 导出 DWG', es: '⇩ Exportar DWG', ar: '⇩ تصدير DWG' })}
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
