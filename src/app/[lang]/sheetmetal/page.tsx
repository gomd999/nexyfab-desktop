'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { loc } from '@/lib/i18n/loc';
import { toIsoLang } from '@/lib/i18n/normalize';

type Copy = { ko: string; en: string; ja: string; zh: string; es: string; ar: string };
const COPY: Record<string, Copy> = {
  exL: { ko: 'L 브래킷, 100x60 두께 2, 뒤쪽 30mm 플랜지', en: 'L bracket, 100x60 thickness 2, 30mm rear flange', ja: 'Lブラケット、100x60 厚さ2、後部フランジ30mm', zh: 'L 支架，100x60 厚度2，后侧30mm法兰', es: 'Soporte L, 100x60 grosor 2, brida trasera de 30mm', ar: 'حامل L، 100×60 بسماكة 2، شفة خلفية 30 مم' },
  exU: { ko: 'U 채널, 80x50 두께 1.5, 양옆 25mm', en: 'U channel, 80x50 thickness 1.5, 25mm both sides', ja: 'Uチャンネル、80x50 厚さ1.5、両側25mm', zh: 'U 型槽，80x50 厚度1.5，两侧25mm', es: 'Canal U, 80x50 grosor 1,5, 25mm a ambos lados', ar: 'قناة U، 80×50 بسماكة 1.5، 25 مم على الجانبين' },
  exTray: { ko: '전장 박스 트레이, 120x80 두께 2, 4면 20mm', en: 'Electrical box tray, 120x80 thickness 2, 20mm on four sides', ja: '電装ボックストレー、120x80 厚さ2、四辺20mm', zh: '电气箱托盘，120x80 厚度2，四边20mm', es: 'Bandeja para caja eléctrica, 120x80 grosor 2, 20mm en cuatro lados', ar: 'صينية صندوق كهربائي، 120×80 بسماكة 2، 20 مم على الجوانب الأربعة' },
  exSheet: { ko: '2mm 판금, 가로 90 세로 90, 앞 40mm 플랜지', en: '2mm sheet metal, 90x90, 40mm front flange', ja: '2mm板金、90x90、前部フランジ40mm', zh: '2mm 钣金，90x90，前侧40mm法兰', es: 'Chapa de 2mm, 90x90, brida frontal de 40mm', ar: 'صاج 2 مم، 90×90، شفة أمامية 40 مم' },
  generateError: { ko: '생성에 실패했어요. 다시 시도해 주세요.', en: 'Generation failed. Please try again.', ja: '生成に失敗しました。もう一度お試しください。', zh: '生成失败。请重试。', es: 'La generación falló. Inténtalo de nuevo.', ar: 'فشل الإنشاء. يرجى المحاولة مرة أخرى.' },
  stepFailed: { ko: 'STEP 생성에 실패했어요.', en: 'STEP generation failed.', ja: 'STEPの生成に失敗しました。', zh: 'STEP 生成失败。', es: 'Falló la generación de STEP.', ar: 'فشل إنشاء STEP.' },
  modelerFailed: { ko: '모델러 열기에 실패했어요.', en: 'Could not open the modeler.', ja: 'モデラーを開けませんでした。', zh: '无法打开建模器。', es: 'No se pudo abrir el modelador.', ar: 'تعذر فتح النمذجة.' },
  title: { ko: '말로 판금 부품 → 굽힘보정 전개도', en: 'Sheet-metal part to bend-compensated template', ja: '文章から板金部品の曲げ補正展開図へ', zh: '从文字生成钣金件弯曲补偿展开图', es: 'De texto a plantilla de chapa con compensación de doblez', ar: 'من وصف نصي إلى قالب صاج مع تعويض الثني' },
  subtitle: { ko: '판금 부품을 글로 설명하면 굽힘보정(K-factor)이 적용된 레이저/펀치용 전개도(칼선·굽힘선)와 굽힘표를 자동 생성하고 DXF로 내보냅니다. 블랭크 치수는 단순 합이 아니라 굽힘 공제만큼 보정됩니다.', en: 'Describe a sheet-metal part to automatically create a K-factor compensated laser/punch template, bend table, and DXF. Blank dimensions include bend deductions.', ja: '板金部品を説明すると、Kファクター補正済みのレーザー/パンチ用展開図・曲げ表を自動生成しDXFに書き出します。ブランク寸法は曲げ控除を反映します。', zh: '描述钣金件即可自动生成应用 K 因子的激光/冲压展开图、折弯表并导出 DXF。毛坯尺寸包含折弯扣除补偿。', es: 'Describe una pieza de chapa para generar una plantilla láser/punzonado con compensación K-factor, tabla de dobleces y DXF. Las dimensiones incluyen las deducciones.', ar: 'صف قطعة من الصاج لإنشاء قالب ليزر/ثقب مع تعويض K-factor وجدول ثني وDXF. تتضمن أبعاد الخام خصومات الثني.' },
  placeholder: { ko: '예: L 브래킷, 100x60 두께 2, 뒤쪽 30mm 플랜지', en: 'Example: L bracket, 100x60 thickness 2, 30mm rear flange', ja: '例：Lブラケット、100x60 厚さ2、後部フランジ30mm', zh: '示例：L 支架，100x60 厚度2，后侧30mm法兰', es: 'Ejemplo: soporte L, 100x60 grosor 2, brida trasera 30mm', ar: 'مثال: حامل L، 100×60 بسماكة 2، شفة خلفية 30 مم' },
  creating: { ko: '생성 중…', en: 'Generating…', ja: '生成中…', zh: '生成中…', es: 'Generando…', ar: 'جارٍ الإنشاء…' },
  createFlat: { ko: '전개도 생성', en: 'Create template', ja: '展開図を生成', zh: '生成展开图', es: 'Crear plantilla', ar: 'إنشاء القالب' },
  body: { ko: '본체', en: 'Body', ja: '本体', zh: '主体', es: 'Cuerpo', ar: 'الجسم' },
  blank: { ko: '블랭크', en: 'Blank', ja: 'ブランク', zh: '毛坯', es: 'Blanco', ar: 'الخام' },
  openModeler: { ko: '🧊 모델러에서 열기', en: '🧊 Open in modeler', ja: '🧊 モデラーで開く', zh: '🧊 在建模器中打开', es: '🧊 Abrir en modelador', ar: '🧊 فتح في النمذجة' },
  modelerTitle: { ko: '접힌 부품을 모델러로 — FEA·DFM·견적', en: 'Folded part in modeler — FEA · DFM · quote', ja: '折り曲げ部品をモデラーへ — FEA・DFM・見積', zh: '将折叠零件导入建模器 — FEA · DFM · 报价', es: 'Pieza plegada en modelador — FEA · DFM · cotización', ar: 'الجزء المطوي في النمذجة — FEA · DFM · عرض السعر' },
  opening: { ko: '여는 중…', en: 'Opening…', ja: '開いています…', zh: '正在打开…', es: 'Abriendo…', ar: 'جارٍ الفتح…' },
  stepTitle: { ko: '접힌 3D 부품을 STEP으로 — 모델러/SolidWorks에서 열림', en: 'Folded 3D part as STEP — opens in modeler/SolidWorks', ja: '折り曲げ3D部品をSTEPへ — モデラー/SolidWorksで開けます', zh: '将折叠 3D 零件导出为 STEP — 可在建模器/SolidWorks 中打开', es: 'Pieza 3D plegada como STEP — se abre en modelador/SolidWorks', ar: 'الجزء ثلاثي الأبعاد المطوي كـ STEP — يفتح في النمذجة/SolidWorks' },
  dxf: { ko: '⬇ DXF 전개도', en: '⬇ DXF template', ja: '⬇ DXF展開図', zh: '⬇ DXF 展开图', es: '⬇ Plantilla DXF', ar: '⬇ قالب DXF' },
  preview: { ko: '3D 폴드 미리보기', en: '3D fold preview', ja: '3D折り曲げプレビュー', zh: '3D 折弯预览', es: 'Vista previa 3D plegada', ar: 'معاينة الثني ثلاثية الأبعاد' },
  dragRotate: { ko: '· 드래그하여 회전', en: '· drag to rotate', ja: '· ドラッグで回転', zh: '· 拖动旋转', es: '· arrastra para girar', ar: '· اسحب للتدوير' },
  flatPattern: { ko: '전개도 (FLAT PATTERN)', en: 'Flat pattern', ja: '展開図', zh: '展开图', es: 'Patrón plano', ar: 'النمط المسطح' },
  bendTable: { ko: '굽힘표 (BEND TABLE)', en: 'Bend table', ja: '曲げ表', zh: '折弯表', es: 'Tabla de dobleces', ar: 'جدول الثني' },
  flange: { ko: '플랜지', en: 'Flange', ja: 'フランジ', zh: '法兰', es: 'Brida', ar: 'الشفة' },
  angle: { ko: '각도', en: 'Angle', ja: '角度', zh: '角度', es: 'Ángulo', ar: 'الزاوية' },
  height: { ko: '높이', en: 'Height', ja: '高さ', zh: '高度', es: 'Altura', ar: 'الارتفاع' },
  allowance: { ko: '굽힘여유(BA)', en: 'Bend allowance (BA)', ja: '曲げ代(BA)', zh: '折弯余量(BA)', es: 'Margen de doblez (BA)', ar: 'سماحية الثني (BA)' },
  deduction: { ko: '굽힘공제(BD)', en: 'Bend deduction (BD)', ja: '曲げ控除(BD)', zh: '折弯扣除(BD)', es: 'Deducción de doblez (BD)', ar: 'خصم الثني (BD)' },
  flat: { ko: '평면부', en: 'Flat', ja: '平面部', zh: '平面部分', es: 'Plano', ar: 'مسطح' },
  cut: { ko: '칼선', en: 'Cut', ja: 'カット', zh: '切割线', es: 'Corte', ar: 'قص' },
  bend: { ko: '굽힘선', en: 'Bend', ja: '曲げ線', zh: '折弯线', es: 'Doble', ar: 'ثني' },
  formula: { ko: 'BA = (θ·π/180)·(R + K·T) · BD = 2·OSSB − BA · 블랭크 = Σ외형 − ΣBD. 절단 블랭크를 굽히면 설계 외형치수가 됩니다.', en: 'BA = (θ·π/180)·(R + K·T) · BD = 2·OSSB − BA · Blank = Σ profile − ΣBD. Bending the cut blank produces the designed outer dimensions.', ja: 'BA = (θ·π/180)·(R + K·T) · BD = 2·OSSB − BA · ブランク = Σ外形 − ΣBD。切断ブランクを曲げると設計外形寸法になります。', zh: 'BA = (θ·π/180)·(R + K·T) · BD = 2·OSSB − BA · 毛坯 = Σ外形 − ΣBD。折弯切割毛坯后即得到设计外形尺寸。', es: 'BA = (θ·π/180)·(R + K·T) · BD = 2·OSSB − BA · Blanco = Σperfil − ΣBD. Al doblar el blanco cortado se obtienen las dimensiones exteriores de diseño.', ar: 'BA = (θ·π/180)·(R + K·T) · BD = 2·OSSB − BA · الخام = Σالمحيط − ΣBD. ينتج عن ثني الخام المقطوع الأبعاد الخارجية المصممة.' },
};
const EXAMPLE_KEYS = ['exL', 'exU', 'exTray', 'exSheet'] as const;
const EDGE_LABELS: Record<string, Copy> = {
  front: { ko: '앞', en: 'Front', ja: '前', zh: '前', es: 'Frontal', ar: 'أمام' },
  back: { ko: '뒤', en: 'Back', ja: '後', zh: '后', es: 'Trasera', ar: 'خلف' },
  left: { ko: '좌', en: 'Left', ja: '左', zh: '左', es: 'Izquierda', ar: 'يسار' },
  right: { ko: '우', en: 'Right', ja: '右', zh: '右', es: 'Derecha', ar: 'يمين' },
};
const tr = (lang: string, key: string) => loc(lang, COPY[key] ?? { ko: key, en: key, ja: key, zh: key, es: key, ar: key });

const SheetMetal3D = dynamic(() => import('./SheetMetal3D'), { ssr: false });

interface Bend { edge: string; angle: number; height: number; bendAllowance: number; bendDeduction: number; flangeFlat: number }
interface FlatResult {
  ok: boolean;
  fromPrompt?: boolean;
  base?: { W: number; L: number; thickness: number; bendRadius: number; kFactor: number };
  blank?: { width: number; length: number };
  bends?: Bend[];
  bytes?: number;
  svg?: string;
  dxf?: string;
  error?: string;
}

export default function SheetMetalDemoPage() {
  const pathname = usePathname();
  const locale = toIsoLang(pathname?.split('/')[1]);
  const [prompt, setPrompt] = useState(() => tr(locale, 'exL'));
  const [result, setResult] = useState<FlatResult | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async (p?: string) => {
    const text = (p ?? prompt).trim();
    if (!text) return;
    if (p) setPrompt(p);
    setLoading(true);
    try {
      const res = await fetch('/api/nexyfab/sheetmetal-flat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, error: tr(locale, 'generateError') });
    } finally {
      setLoading(false);
    }
  };

  const [stepBusy, setStepBusy] = useState(false);

  const downloadDxf = () => {
    if (!result?.dxf) return;
    const blob = new Blob([result.dxf], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nexyfab-sheetmetal.dxf'; a.click();
    URL.revokeObjectURL(url);
  };

  // Folded 3D B-rep STEP — the part as a real CAD model (re-opens in the modeler
  // / SolidWorks / Fusion, feeds FEA & quoting), not just a flat DXF.
  const fetchStep = async (): Promise<string | null> => {
    if (!result?.base || !result.bends) return null;
    const res = await fetch('/api/nexyfab/sheetmetal-step', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        width: result.base.W, length: result.base.L, thickness: result.base.thickness, bendRadius: result.base.bendRadius,
        flanges: result.bends.map(b => ({ edge: b.edge, height: b.height, angle: b.angle })),
      }),
    });
    return res.ok ? res.text() : null;
  };

  const downloadStep = async () => {
    if (stepBusy) return;
    setStepBusy(true);
    try {
      const text = await fetchStep();
      if (!text) { alert(tr(locale, 'stepFailed')); return; }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/step' }));
      const a = document.createElement('a');
      a.href = url; a.download = 'nexyfab-sheetmetal.step'; a.click();
      URL.revokeObjectURL(url);
    } catch { alert(tr(locale, 'stepFailed')); }
    finally { setStepBusy(false); }
  };

  // One-click handoff: stash the folded STEP and open the modeler, which imports
  // it on load (→ analysable part, FEA / DFM / quote). NOTE: a native-flange
  // handoff (editable flange features) was attempted but the flange feature does
  // not apply cleanly in the programmatic handoff context (works via the Sheet
  // Metal ribbon though) — deferred. The STEP-mesh path is the reliable one.
  // Stash the parametric spec and open the modeler, which rebuilds it as NATIVE
  // editable flange features (height/angle stay editable, Flatten works).
  const openInModeler = () => {
    if (!result?.base || !result.bends) return;
    try {
      sessionStorage.setItem('nexyfab:sheetmetal-handoff-spec', JSON.stringify({
        W: result.base.W, L: result.base.L, T: result.base.thickness, bendRadius: result.base.bendRadius,
        flanges: result.bends.map(b => ({ edge: b.edge, height: b.height, angle: b.angle })),
      }));
      const lang = window.location.pathname.split('/')[1] || 'ko';
      window.location.href = `/${lang}/shape-generator?expert=1&mode=expert&domain=mechanical&experience=expert&workMode=precision_cad`;
    } catch { alert(tr(locale, 'modelerFailed')); }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0d1117', color: '#e6edf3', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '48px 20px' }}>
        <p style={{ color: '#ea580c', fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 8px' }}>
          NexyFab · Sheet Metal
        </p>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: '0 0 8px' }}>{tr(locale, 'title')}</h1>
        <p style={{ color: '#8b949e', fontSize: 15, margin: '0 0 28px', lineHeight: 1.6 }}>
          {tr(locale, 'subtitle')}
        </p>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void generate(); }}
            placeholder={tr(locale, 'placeholder')}
            style={{ flex: '1 1 320px', padding: '12px 14px', borderRadius: 8, border: '1px solid #30363d', background: '#161b22', color: '#e6edf3', fontSize: 15 }}
          />
          <button
            onClick={() => void generate()}
            disabled={loading}
            style={{ padding: '12px 22px', borderRadius: 8, border: 'none', background: loading ? '#1f2937' : '#ea580c', color: '#fff', fontSize: 15, fontWeight: 700, cursor: loading ? 'default' : 'pointer' }}
          >
            {loading ? tr(locale, 'creating') : tr(locale, 'createFlat')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
          {EXAMPLE_KEYS.map(key => (
            <button key={key} onClick={() => void generate(tr(locale, key))} disabled={loading}
              style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #30363d', background: '#161b22', color: '#8b949e', fontSize: 13, cursor: 'pointer' }}>
              {tr(locale, key)}
            </button>
          ))}
        </div>

        {result && result.ok && result.svg && (
          <div style={{ border: '1px solid #30363d', borderRadius: 12, padding: 20, background: '#161b22' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
              <div style={{ fontSize: 13, color: '#8b949e' }}>
                {result.base && <>{tr(locale, 'body')} {result.base.W}×{result.base.L}×{result.base.thickness}mm · R{result.base.bendRadius} · K{result.base.kFactor}</>}
                {result.blank && <> · <b style={{ color: '#e6edf3' }}>{tr(locale, 'blank')} {result.blank.width}×{result.blank.length}mm</b></>}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button onClick={() => void openInModeler()} disabled={stepBusy} title={tr(locale, 'modelerTitle')}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: stepBusy ? '#1f2937' : '#2563eb', color: '#fff', fontSize: 14, fontWeight: 700, cursor: stepBusy ? 'default' : 'pointer' }}>
                  {stepBusy ? tr(locale, 'opening') : tr(locale, 'openModeler')}
                </button>
                <button onClick={() => void downloadStep()} disabled={stepBusy} title={tr(locale, 'stepTitle')}
                  style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #ea580c', background: 'transparent', color: '#ea580c', fontSize: 14, fontWeight: 700, cursor: stepBusy ? 'default' : 'pointer' }}>
                  {stepBusy ? '…' : '⬇ 3D STEP'}
                </button>
                <button onClick={downloadDxf} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #238636', background: '#238636', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                  {tr(locale, 'dxf')}
                </button>
              </div>
            </div>
            {result.base && result.bends && result.bends.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8b949e', marginBottom: 8, letterSpacing: '0.05em' }}>
                  {tr(locale, 'preview')} <span style={{ fontWeight: 400, color: '#6e7681' }}>{tr(locale, 'dragRotate')}</span>
                </div>
                <SheetMetal3D base={result.base} bends={result.bends} />
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: '#8b949e', marginBottom: 8, letterSpacing: '0.05em' }}>{tr(locale, 'flatPattern')}</div>
            <div style={{ background: '#fff', borderRadius: 8, padding: 16 }} dangerouslySetInnerHTML={{ __html: result.svg }} />
            <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: '#8b949e' }}>
              <span><span style={{ color: '#dc2626' }}>━</span> {tr(locale, 'cut')}</span>
              <span><span style={{ color: '#ea580c' }}>┄</span> {tr(locale, 'bend')}</span>
            </div>

            {result.bends && result.bends.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#8b949e', marginBottom: 8, letterSpacing: '0.05em' }}>{tr(locale, 'bendTable')}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: '#6e7681', textAlign: 'left' }}>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>{tr(locale, 'flange')}</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>{tr(locale, 'angle')}</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>{tr(locale, 'height')}</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>{tr(locale, 'allowance')}</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>{tr(locale, 'deduction')}</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid #30363d' }}>{tr(locale, 'flat')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.bends.map((bd, i) => (
                      <tr key={i} style={{ color: '#c9d1d9' }}>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{loc(locale, EDGE_LABELS[bd.edge] ?? { ko: bd.edge, en: bd.edge, ja: bd.edge, zh: bd.edge, es: bd.edge, ar: bd.edge })}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{bd.angle}°</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{bd.height}mm</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d', color: '#ea580c' }}>{bd.bendAllowance}mm</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{bd.bendDeduction}mm</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid #21262d' }}>{bd.flangeFlat}mm</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: 11, color: '#6e7681', margin: '10px 0 0', lineHeight: 1.6 }}>
                  {tr(locale, 'formula')}
                </p>
              </div>
            )}
          </div>
        )}
        {result && !result.ok && (
          <div style={{ color: '#f85149', fontSize: 14 }}>{result.error ?? tr(locale, 'generateError')}</div>
        )}
      </div>
    </div>
  );
}
