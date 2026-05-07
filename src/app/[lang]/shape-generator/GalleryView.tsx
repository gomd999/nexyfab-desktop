'use client';

import React, { useState, useMemo, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { SHAPES, type ShapeConfig, type ShapeResult } from './shapes';
import { COTS_PARTS, type COTSPart } from './cots/cotsData';

// ─── i18n dict (6 languages) ───────────────────────────────────────────────
const dict = {
  ko: {
    subtitle: '파라메트릭 형상 설계 · AI 채팅 · 위상 최적화',
    chatPlaceholder: 'AI에게 설계를 요청하세요... (예: "기어 만들어줘")',
    blankSketch: '빈 캔버스로 스케치 시작',
    partsLabel: (n: number) => `${n} 개 부품`,
    shapesLabel: (n: number) => `${n} 개 형상`,
    selectCotsTitle: '표준 부품을 선택하세요',
    selectCotsHint: '왼쪽 목록에서 볼트, 너트, 베어링 등을 선택하면 상세 사양이 표시됩니다',
    dimensions: '치수 사양',
    suppliersHeader: '공급처',
    perPiece: '/ 개',
    addToBom: 'BOM에 담기',
    openDesigner: '설계 열기',
    openDesignerMain: '🛠 상세 설계',
    cotsBomHeader: (n: number) => `COTS BOM — ${n}개 부품`,
    clearCart: '초기화',
    totalLabel: '총 금액',
    totalSummary: (types: number, pcs: number) => `${types}종 ${pcs}개`,
    footerHint: '💡 "상세 설계"에서 스케치, 불리안, 정점/엣지 편집, 위상최적화를 사용할 수 있습니다',
    rfqSent: '✓ 전송됨',
    rfqSending: '전송 중…',
    rfqSendBtn: '📋 RFQ 전송',
    rfqFailFallback: 'RFQ 전송 실패',
    csvHeader: '부품명,규격,수량,단가(₩),소계(₩),공급처',
    cotsBomNote: (n: number) => `COTS 표준부품 BOM (${n}종)`,
    totalLine: '합계 / Total',
    examplePrompts: [
      '기어 부품 만들어줘', 'L-브래킷 100x50x30', '선풍기 조립체 BOM',
      '별 모양 스케치', '경량화 최적화해줘',
    ],
  },
  en: {
    subtitle: 'Parametric Shape Design · AI Chat · Topology Optimization',
    chatPlaceholder: 'Ask AI to design... (e.g., "Create a gear")',
    blankSketch: 'Start from Blank Sketch',
    partsLabel: (n: number) => `${n} parts`,
    shapesLabel: (n: number) => `${n} shapes`,
    selectCotsTitle: 'Select a COTS part',
    selectCotsHint: 'Click a bolt, nut, bearing or other part on the left to view its specifications',
    dimensions: 'Dimensions',
    suppliersHeader: 'Suppliers',
    perPiece: '/ piece',
    addToBom: 'Add to BOM',
    openDesigner: 'Open Designer',
    openDesignerMain: '🛠 Open Designer',
    cotsBomHeader: (n: number) => `COTS BOM — ${n} parts`,
    clearCart: 'Clear',
    totalLabel: 'Total',
    totalSummary: (types: number, pcs: number) => `${types} types, ${pcs} pcs`,
    footerHint: '💡 Use "Open Designer" for Sketch, Boolean, Vertex/Edge editing, and Topology Optimization',
    rfqSent: '✓ Sent',
    rfqSending: 'Sending…',
    rfqSendBtn: '📋 Send RFQ',
    rfqFailFallback: 'RFQ send failed',
    csvHeader: 'Part Name,Standard,Qty,Unit Price (₩),Subtotal (₩),Suppliers',
    cotsBomNote: (n: number) => `COTS Parts BOM (${n} types)`,
    totalLine: 'Total',
    examplePrompts: [
      'Create a gear part', 'L-bracket 100x50x30', 'Fan assembly BOM',
      'Star shape sketch', 'Optimize for lightweight',
    ],
  },
  ja: {
    subtitle: 'パラメトリック形状設計 · AIチャット · 位相最適化',
    chatPlaceholder: 'AIに設計を依頼... (例:「歯車を作って」)',
    blankSketch: '空白スケッチから開始',
    partsLabel: (n: number) => `${n} 個の部品`,
    shapesLabel: (n: number) => `${n} 個の形状`,
    selectCotsTitle: '標準部品を選択してください',
    selectCotsHint: '左のリストからボルト、ナット、ベアリングなどを選択すると詳細仕様が表示されます',
    dimensions: '寸法仕様',
    suppliersHeader: '供給元',
    perPiece: '/ 個',
    addToBom: 'BOMに追加',
    openDesigner: '設計を開く',
    openDesignerMain: '🛠 詳細設計',
    cotsBomHeader: (n: number) => `COTS BOM — ${n}部品`,
    clearCart: 'クリア',
    totalLabel: '合計金額',
    totalSummary: (types: number, pcs: number) => `${types}種 ${pcs}個`,
    footerHint: '💡「詳細設計」でスケッチ、ブーリアン、頂点/エッジ編集、位相最適化を使用できます',
    rfqSent: '✓ 送信済み',
    rfqSending: '送信中…',
    rfqSendBtn: '📋 RFQ送信',
    rfqFailFallback: 'RFQ送信失敗',
    csvHeader: '部品名,規格,数量,単価(₩),小計(₩),供給元',
    cotsBomNote: (n: number) => `COTS標準部品 BOM (${n}種)`,
    totalLine: '合計 / Total',
    examplePrompts: [
      '歯車部品を作って', 'Lブラケット 100x50x30', '扇風機アセンブリBOM',
      '星形スケッチ', '軽量化最適化',
    ],
  },
  zh: {
    subtitle: '参数化形状设计 · AI 聊天 · 拓扑优化',
    chatPlaceholder: '向 AI 请求设计... (例如:"做个齿轮")',
    blankSketch: '从空白草图开始',
    partsLabel: (n: number) => `${n} 个零件`,
    shapesLabel: (n: number) => `${n} 个形状`,
    selectCotsTitle: '请选择标准零件',
    selectCotsHint: '从左侧列表选择螺栓、螺母、轴承等即可查看详细规格',
    dimensions: '尺寸规格',
    suppliersHeader: '供应商',
    perPiece: '/ 个',
    addToBom: '加入 BOM',
    openDesigner: '打开设计器',
    openDesignerMain: '🛠 详细设计',
    cotsBomHeader: (n: number) => `COTS BOM — ${n}个零件`,
    clearCart: '清空',
    totalLabel: '总金额',
    totalSummary: (types: number, pcs: number) => `${types}种 ${pcs}个`,
    footerHint: '💡 在"详细设计"中可使用草图、布尔、顶点/边缘编辑、拓扑优化',
    rfqSent: '✓ 已发送',
    rfqSending: '发送中…',
    rfqSendBtn: '📋 发送 RFQ',
    rfqFailFallback: 'RFQ 发送失败',
    csvHeader: '零件名称,规格,数量,单价(₩),小计(₩),供应商',
    cotsBomNote: (n: number) => `COTS 标准零件 BOM (${n}种)`,
    totalLine: '合计 / Total',
    examplePrompts: [
      '做一个齿轮零件', 'L型支架 100x50x30', '风扇组件 BOM',
      '星形草图', '轻量化优化',
    ],
  },
  es: {
    subtitle: 'Diseño paramétrico de formas · Chat IA · Optimización topológica',
    chatPlaceholder: 'Pide a la IA que diseñe... (ej: "Crea un engranaje")',
    blankSketch: 'Empezar desde boceto en blanco',
    partsLabel: (n: number) => `${n} piezas`,
    shapesLabel: (n: number) => `${n} formas`,
    selectCotsTitle: 'Seleccione una pieza COTS',
    selectCotsHint: 'Haga clic en un perno, tuerca, rodamiento u otra pieza a la izquierda para ver sus especificaciones',
    dimensions: 'Dimensiones',
    suppliersHeader: 'Proveedores',
    perPiece: '/ pieza',
    addToBom: 'Añadir al BOM',
    openDesigner: 'Abrir diseñador',
    openDesignerMain: '🛠 Abrir diseñador',
    cotsBomHeader: (n: number) => `COTS BOM — ${n} piezas`,
    clearCart: 'Vaciar',
    totalLabel: 'Total',
    totalSummary: (types: number, pcs: number) => `${types} tipos, ${pcs} uds`,
    footerHint: '💡 Use "Abrir diseñador" para boceto, booleanos, edición de vértice/arista y optimización topológica',
    rfqSent: '✓ Enviado',
    rfqSending: 'Enviando…',
    rfqSendBtn: '📋 Enviar RFQ',
    rfqFailFallback: 'Envío de RFQ fallido',
    csvHeader: 'Nombre,Estándar,Cant,Precio unit (₩),Subtotal (₩),Proveedores',
    cotsBomNote: (n: number) => `COTS BOM de piezas (${n} tipos)`,
    totalLine: 'Total',
    examplePrompts: [
      'Crea un engranaje', 'Soporte L 100x50x30', 'BOM de ensamble de ventilador',
      'Boceto en forma de estrella', 'Optimizar para aligerar',
    ],
  },
  ar: {
    subtitle: 'تصميم الأشكال البارامترية · دردشة AI · تحسين الطوبولوجيا',
    chatPlaceholder: 'اطلب من الذكاء الاصطناعي التصميم... (مثال: "أنشئ ترسًا")',
    blankSketch: 'ابدأ من رسم فارغ',
    partsLabel: (n: number) => `${n} قطعة`,
    shapesLabel: (n: number) => `${n} شكل`,
    selectCotsTitle: 'اختر قطعة COTS',
    selectCotsHint: 'انقر على برغي أو صامولة أو محمل أو قطعة أخرى على اليسار لعرض مواصفاتها',
    dimensions: 'الأبعاد',
    suppliersHeader: 'الموردون',
    perPiece: '/ قطعة',
    addToBom: 'أضف إلى BOM',
    openDesigner: 'فتح المصمم',
    openDesignerMain: '🛠 فتح المصمم',
    cotsBomHeader: (n: number) => `COTS BOM — ${n} قطعة`,
    clearCart: 'مسح',
    totalLabel: 'الإجمالي',
    totalSummary: (types: number, pcs: number) => `${types} أنواع، ${pcs} قطعة`,
    footerHint: '💡 استخدم "فتح المصمم" للرسم، العمليات البوليانية، تحرير الرأس/الحافة، وتحسين الطوبولوجيا',
    rfqSent: '✓ أُرسل',
    rfqSending: 'جاري الإرسال…',
    rfqSendBtn: '📋 إرسال RFQ',
    rfqFailFallback: 'فشل إرسال RFQ',
    csvHeader: 'اسم القطعة,المعيار,الكمية,سعر الوحدة (₩),الإجمالي الفرعي (₩),الموردون',
    cotsBomNote: (n: number) => `COTS قائمة مواد (${n} نوع)`,
    totalLine: 'الإجمالي / Total',
    examplePrompts: [
      'أنشئ ترسًا', 'حامل L 100x50x30', 'قائمة مواد لتجميع مروحة',
      'رسم على شكل نجمة', 'حسّن من أجل الوزن الخفيف',
    ],
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

const ShapePreview = dynamic(() => import('./ShapePreview'), { ssr: false });

/* ─── Constants ──────────────────────────────────────────────────────────── */

const SHAPE_ICONS: Record<string, string> = {
  box: '📦', cylinder: '🔩', sphere: '🔮', cone: '🔺', torus: '🍩', wedge: '🔻',
  pipe: '🔧', lBracket: '📐', flange: '⚙️', plateBend: '🔨',
  gear: '⚙️', fanBlade: '🌀', sprocket: '🔗', pulley: '🎡',
  sweep: '🔀', loft: '🔄',
};

const CATEGORY_LABELS: Record<string, Record<string, string>> = {
  ko: { basic: '기본 형상', mechanical: '기계 부품', all: '전체', cots: '표준 부품' },
  en: { basic: 'Basic Shapes', mechanical: 'Mechanical Parts', all: 'All', cots: 'COTS Parts' },
  ja: { basic: '基本形状', mechanical: '機械部品', all: 'すべて', cots: '標準部品' },
  zh: { basic: '基本形状', mechanical: '机械零件', all: '全部', cots: '标准零件' },
  cn: { basic: '基本形状', mechanical: '机械零件', all: '全部', cots: '标准零件' },
  es: { basic: 'Formas Básicas', mechanical: 'Piezas Mecánicas', all: 'Todo', cots: 'Piezas COTS' },
  ar: { basic: 'أشكال أساسية', mechanical: 'أجزاء ميكانيكية', all: 'الكل', cots: 'مكونات COTS' },
};

// COTS category → real shape id mapping (must exist in SHAPE_MAP)
const COTS_SHAPE_MAP: Record<string, string> = {
  bolt: 'cylinder', nut: 'cylinder', washer: 'cylinder', bearing: 'torus',
  collar: 'cylinder', clip: 'cylinder',
};
const COTS_ICONS: Record<string, string> = {
  bolt: '🔩', nut: '🔧', washer: '⭕', bearing: '🎯', collar: '🔘', clip: '📎',
};

const COTS_PARAM_LABELS: Record<string, Record<string, string>> = {
  M:           { ko: '나사 호칭',      en: 'Thread Size',      ja: 'ねじ呼び',         zh: '螺纹规格',    es: 'Tamaño de rosca',    ar: 'مقاس السن' },
  length:      { ko: '길이',          en: 'Length (mm)',      ja: '長さ (mm)',        zh: '长度 (mm)',   es: 'Longitud (mm)',      ar: 'الطول (mm)' },
  pitch:       { ko: '피치',          en: 'Pitch (mm)',       ja: 'ピッチ (mm)',      zh: '螺距 (mm)',   es: 'Paso (mm)',          ar: 'الخطوة (mm)' },
  headDia:     { ko: '헤드 직경',      en: 'Head Dia (mm)',    ja: '頭部径 (mm)',      zh: '头部直径 (mm)', es: 'Diám. cabeza (mm)', ar: 'قطر الرأس (mm)' },
  headH:       { ko: '헤드 높이',      en: 'Head H (mm)',      ja: '頭部高さ (mm)',    zh: '头部高度 (mm)', es: 'Alto cabeza (mm)',  ar: 'ارتفاع الرأس (mm)' },
  width:       { ko: '폭 / 대변거리',   en: 'Width A/F (mm)',   ja: '幅 / 対辺 (mm)',   zh: '对边宽度 (mm)', es: 'Ancho A/F (mm)',    ar: 'العرض A/F (mm)' },
  height:      { ko: '높이',          en: 'Height (mm)',      ja: '高さ (mm)',        zh: '高度 (mm)',   es: 'Altura (mm)',        ar: 'الارتفاع (mm)' },
  innerDia:    { ko: '내경',          en: 'Inner Dia (mm)',   ja: '内径 (mm)',        zh: '内径 (mm)',   es: 'Diám. interior (mm)', ar: 'القطر الداخلي (mm)' },
  outerDia:    { ko: '외경',          en: 'Outer Dia (mm)',   ja: '外径 (mm)',        zh: '外径 (mm)',   es: 'Diám. exterior (mm)', ar: 'القطر الخارجي (mm)' },
  thickness:   { ko: '두께',          en: 'Thickness (mm)',   ja: '厚さ (mm)',        zh: '厚度 (mm)',   es: 'Espesor (mm)',        ar: 'السماكة (mm)' },
  bore:        { ko: '보어 (내경)',    en: 'Bore ID (mm)',     ja: 'ボア内径 (mm)',    zh: '内孔径 (mm)', es: 'Agujero ID (mm)',     ar: 'فتحة ID (mm)' },
  OD:          { ko: '외경 OD',       en: 'Outer Dia (mm)',   ja: '外径 OD (mm)',     zh: '外径 OD (mm)', es: 'Diám. exterior (mm)', ar: 'القطر الخارجي (mm)' },
  dynamicLoadN:{ ko: '동적 하중',      en: 'Dynamic Load (N)', ja: '動荷重 (N)',       zh: '动载荷 (N)',  es: 'Carga dinámica (N)',  ar: 'حمل ديناميكي (N)' },
  staticLoadN: { ko: '정적 하중',      en: 'Static Load (N)',  ja: '静荷重 (N)',       zh: '静载荷 (N)',  es: 'Carga estática (N)',  ar: 'حمل ساكن (N)' },
  d:           { ko: '축 직경',       en: 'Shaft Dia (mm)',   ja: '軸径 (mm)',        zh: '轴径 (mm)',   es: 'Diám. eje (mm)',      ar: 'قطر العمود (mm)' },
  d1:          { ko: '홈 직경',       en: 'Groove Dia (mm)',  ja: '溝径 (mm)',        zh: '槽径 (mm)',   es: 'Diám. ranura (mm)',   ar: 'قطر الحز (mm)' },
  b:           { ko: '너비',          en: 'Groove Width (mm)', ja: '溝幅 (mm)',       zh: '槽宽 (mm)',   es: 'Ancho ranura (mm)',   ar: 'عرض الحز (mm)' },
};

function cotsParamsToShapeParams(part: COTSPart): Record<string, number> {
  const p = part.params;
  switch (part.category) {
    case 'bolt':
      return { radius: (p.headDia ?? 10) / 2, height: (p.length ?? 20) + (p.headH ?? 5) };
    case 'nut':
      return { radius: (p.width ?? 10) / 2, height: p.height ?? 5 };
    case 'washer':
      return { radius: (p.outerDia ?? 12) / 2, height: p.thickness ?? 1.5 };
    case 'bearing':
      return { R: ((p.OD ?? 22) + (p.bore ?? 8)) / 4, r: ((p.OD ?? 22) - (p.bore ?? 8)) / 4 };
    case 'collar':
      return { radius: (p.OD ?? 20) / 2, height: p.width ?? 10 };
    case 'clip':
      return { radius: (p.d ?? 10) / 2, height: (p.thickness ?? 1) * 4 };
    default:
      return {};
  }
}

/* ─── CotsBomActions (RFQ + CSV) ─────────────────────────────────────────── */

interface CartItem { part: COTSPart; qty: number }

async function exportCotsCsv(cart: CartItem[], lang: string) {
  const { downloadBlob } = await import('@/lib/platform');
  const tt = dict[langMap[lang] ?? 'en'];
  const header = tt.csvHeader;
  const rows = cart.map(({ part, qty }) =>
    [
      lang === 'ko' ? part.nameKo : part.name,
      part.standard,
      qty,
      part.unitPriceKRW,
      part.unitPriceKRW * qty,
      part.suppliers.join(' / '),
    ].join(',')
  );
  const total = cart.reduce((s, { part, qty }) => s + part.unitPriceKRW * qty, 0);
  rows.push(`,,,,${total},`);
  const csv = [header, ...rows].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  await downloadBlob(`cots-bom-${Date.now()}.csv`, blob);
}

function CotsBomActions({ cart, total, lang, onClear: _onClear }: { cart: CartItem[]; total: number; lang: string; onClear: () => void }) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const tt = dict[langMap[lang] ?? 'en'];

  const handleRfq = useCallback(async () => {
    setSending(true);
    setErrMsg(null);
    try {
      const noteLines = cart.map(({ part, qty }) =>
        `${lang === 'ko' ? part.nameKo : part.name} (${part.standard}) × ${qty}ea — ₩${(part.unitPriceKRW * qty).toLocaleString()}`
      );
      noteLines.push(`\n${tt.totalLine}: ₩${total.toLocaleString()}`);

      const res = await fetch('/api/nexyfab/rfq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shapeId: 'cots-bom',
          shapeName: tt.cotsBomNote(cart.length),
          materialId: 'cots',
          quantity: cart.reduce((s, { qty }) => s + qty, 0),
          note: noteLines.join('\n'),
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : tt.rfqFailFallback);
    } finally {
      setSending(false);
    }
  }, [cart, total, lang, tt]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {errMsg && <span style={{ fontSize: 11, color: '#f85149' }}>{errMsg}</span>}
      <button
        onClick={() => void exportCotsCsv(cart, lang)}
        style={{
          padding: '8px 14px', borderRadius: 10,
          border: '1px solid #30363d', background: '#21262d',
          color: '#94a3b8', fontWeight: 700, fontSize: 12, cursor: 'pointer',
        }}
      >
        📥 CSV
      </button>
      <button
        onClick={handleRfq}
        disabled={sending || sent}
        style={{
          padding: '8px 18px', borderRadius: 10, border: 'none',
          background: sent ? '#3fb950' : 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
          color: '#fff', fontWeight: 800, fontSize: 13, cursor: sending || sent ? 'default' : 'pointer',
          opacity: sending ? 0.7 : 1, transition: 'all 0.2s',
        }}
      >
        {sent ? tt.rfqSent : sending ? tt.rfqSending : tt.rfqSendBtn}
      </button>
    </div>
  );
}

/* ─── Props ───────────────────────────────────────────────────────────────── */

interface GalleryViewProps {
  lang: string;
  t: Record<string, string>;
  onEnterWorkspace: (shapeId: string, params: Record<string, number>) => void;
  onChatDesign: (message: string) => void;
  onBlankSketch: () => void;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export default function GalleryView({ lang, t, onEnterWorkspace, onChatDesign, onBlankSketch }: GalleryViewProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const resolvedLang = langMap[seg] ?? (langMap[lang] ?? 'en');
  const tt = dict[resolvedLang];

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>(SHAPES[0].id);
  const [filter, setFilter] = useState<'all' | 'basic' | 'mechanical' | 'cots'>('all');
  const [selectedCots, setSelectedCots] = useState<COTSPart | null>(null);
  const [cotsBomCart, setCotsBomCart] = useState<Array<{ part: COTSPart; qty: number }>>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);

  const cartTotal = cotsBomCart.reduce((s, { part, qty }) => s + part.unitPriceKRW * qty, 0);
  const cartCount = cotsBomCart.reduce((s, { qty }) => s + qty, 0);

  const addToCart = useCallback((part: COTSPart) => {
    setCotsBomCart(prev => {
      const existing = prev.findIndex(x => x.part.id === part.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], qty: next[existing].qty + 1 };
        return next;
      }
      return [...prev, { part, qty: 1 }];
    });
    setCartOpen(true);
  }, []);

  const setCartQty = useCallback((partId: string, qty: number) => {
    if (qty <= 0) {
      setCotsBomCart(prev => prev.filter(x => x.part.id !== partId));
    } else {
      setCotsBomCart(prev => prev.map(x => x.part.id === partId ? { ...x, qty } : x));
    }
  }, []);

  const catLabels = CATEGORY_LABELS[lang] || CATEGORY_LABELS.en;

  // Generate default params and result for each shape (memoized)
  const shapeResults = useMemo(() => {
    const map: Record<string, { params: Record<string, number>; result: ShapeResult | null }> = {};
    for (const s of SHAPES) {
      const p: Record<string, number> = {};
      s.params.forEach(sp => { p[sp.key] = sp.default; });
      try { map[s.id] = { params: p, result: s.generate(p) }; }
      catch { map[s.id] = { params: p, result: null }; }
    }
    return map;
  }, []);

  const selectedShape = useMemo(() => SHAPES.find(s => s.id === selectedId)!, [selectedId]);
  const selectedResult = shapeResults[selectedId]?.result ?? null;

  // Editable params for selected shape
  const [params, setParams] = useState<Record<string, number>>(() => {
    const p: Record<string, number> = {};
    SHAPES[0].params.forEach(sp => { p[sp.key] = sp.default; });
    return p;
  });

  const liveResult = useMemo(() => {
    try { return selectedShape.generate(params); } catch { return selectedResult; }
  }, [selectedShape, params, selectedResult]);

  const handleSelectShape = useCallback((s: ShapeConfig) => {
    setSelectedId(s.id);
    const p: Record<string, number> = {};
    s.params.forEach(sp => { p[sp.key] = sp.default; });
    setParams(p);
  }, []);

  const handleParamChange = useCallback((key: string, value: number) => {
    setParams(prev => ({ ...prev, [key]: value }));
  }, []);

  const filteredShapes = useMemo(() => {
    if (filter === 'all') return SHAPES;
    if (filter === 'basic') return SHAPES.filter(s => s.tier === 1);
    if (filter === 'cots') return [];
    return SHAPES.filter(s => s.tier === 2);
  }, [filter]);

  const filteredCots = useMemo(() => COTS_PARTS, []);

  const handleChatSubmit = useCallback(() => {
    if (!chatInput.trim()) return;
    onChatDesign(chatInput.trim());
    setChatInput('');
  }, [chatInput, onChatDesign]);

  const handleChatKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChatSubmit(); }
  }, [handleChatSubmit]);

  const examplePrompts = useMemo(() => [...tt.examplePrompts], [tt]);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f0c29 0%, #1a1a2e 40%, #16213e 100%)', display: 'flex', flexDirection: 'column' }}>

      {/* ════════ HERO HEADER ════════ */}
      <div style={{ padding: '40px 40px 0', textAlign: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 36, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em' }}>
          <span style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>NexyFab</span>
          {' '}
          <span style={{ color: '#e2e8f0' }}>Shape Generator</span>
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 15, marginTop: 8, fontWeight: 500 }}>
          {tt.subtitle}
        </p>
      </div>

      {/* ════════ AI CHAT BAR ════════ */}
      <div style={{ maxWidth: 700, width: '100%', margin: '24px auto 0', padding: '0 20px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'rgba(255,255,255,0.07)', backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16,
          padding: '6px 8px 6px 18px', transition: 'all 0.2s',
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>🤖</span>
          <input
            ref={chatInputRef}
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={handleChatKeyDown}
            placeholder={tt.chatPlaceholder}
            style={{
              flex: 1, background: 'none', border: 'none', outline: 'none',
              color: '#e2e8f0', fontSize: 14, fontWeight: 500,
              padding: '10px 0',
            }}
          />
          <button
            onClick={handleChatSubmit}
            disabled={!chatInput.trim()}
            style={{
              padding: '8px 20px', borderRadius: 12, border: 'none',
              background: chatInput.trim() ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'rgba(255,255,255,0.08)',
              color: '#fff', fontWeight: 700, fontSize: 13, cursor: chatInput.trim() ? 'pointer' : 'default',
              transition: 'all 0.2s', opacity: chatInput.trim() ? 1 : 0.5,
            }}
          >
            →
          </button>
        </div>

        {/* Example prompts */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 10 }}>
          {examplePrompts.map(prompt => (
            <button
              key={prompt}
              onClick={() => { setChatInput(prompt); chatInputRef.current?.focus(); }}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                color: '#94a3b8', cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(102,126,234,0.2)'; e.currentTarget.style.color = '#a5b4fc'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = '#94a3b8'; }}
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      {/* ════════ QUICK START ════════ */}
      <div style={{ maxWidth: 700, width: '100%', margin: '20px auto 0', padding: '0 20px', display: 'flex', gap: 10, justifyContent: 'center' }}>
        <button
          onClick={onBlankSketch}
          style={{
            padding: '10px 24px', borderRadius: 14, border: '2px solid rgba(102,126,234,0.4)',
            background: 'rgba(102,126,234,0.1)', backdropFilter: 'blur(10px)',
            color: '#a5b4fc', fontWeight: 800, fontSize: 14, cursor: 'pointer',
            transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 8,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(102,126,234,0.25)'; e.currentTarget.style.borderColor = '#667eea'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(102,126,234,0.1)'; e.currentTarget.style.borderColor = 'rgba(102,126,234,0.4)'; }}
        >
          <span style={{ fontSize: 18 }}>✏️</span>
          {tt.blankSketch}
        </button>
      </div>

      {/* ════════ MAIN CONTENT — Grid + Preview ════════ */}
      <div style={{ flex: 1, display: 'flex', gap: 24, padding: '28px 32px 32px', maxWidth: 1400, width: '100%', margin: '0 auto', minHeight: 0 }}>

        {/* ── LEFT: Shape card grid ── */}
        <div style={{ width: 340, flexShrink: 0, display: 'flex', flexDirection: 'column', minWidth: 0 }}>

          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
            {(['all', 'basic', 'mechanical', 'cots'] as const).map(f => (
              <button
                key={f}
                onClick={() => { setFilter(f); if (f !== 'cots') setSelectedCots(null); }}
                style={{
                  padding: '6px 14px', borderRadius: 10, border: 'none',
                  background: filter === f
                    ? (f === 'cots' ? 'rgba(251,191,36,0.2)' : 'rgba(102,126,234,0.25)')
                    : 'rgba(255,255,255,0.05)',
                  color: filter === f ? (f === 'cots' ? '#fbbf24' : '#a5b4fc') : '#64748b',
                  fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s',
                  position: 'relative', display: 'flex', alignItems: 'center', gap: 4,
                }}
              >
                {f === 'cots' ? '⚙️ ' : ''}{catLabels[f]}
                {f === 'cots' && cartCount > 0 && (
                  <span style={{
                    background: '#fbbf24', color: '#000', borderRadius: '50%',
                    fontSize: 9, fontWeight: 900, minWidth: 16, height: 16,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 3px',
                  }}>{cartCount}</span>
                )}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ color: '#475569', fontSize: 12, fontWeight: 600, alignSelf: 'center' }}>
              {filter === 'cots' ? tt.partsLabel(filteredCots.length) : tt.shapesLabel(filteredShapes.length)}
            </span>
          </div>

          {/* Cards grid — shapes */}
          {filter !== 'cots' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, overflowY: 'auto', flex: 1, paddingRight: 4 }}>
              {filteredShapes.map(s => {
                const isActive = s.id === selectedId;
                const isHovered = s.id === hoveredId;
                const sr = shapeResults[s.id]?.result;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelectShape(s)}
                    onMouseEnter={() => setHoveredId(s.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    style={{
                      background: isActive ? 'rgba(102,126,234,0.15)' : isHovered ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.03)',
                      border: isActive ? '2px solid #667eea' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10, padding: 10, cursor: 'pointer',
                      transition: 'all 0.2s', transform: isHovered ? 'translateY(-2px)' : 'none',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 24 }}>{SHAPE_ICONS[s.id] || s.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? '#a5b4fc' : '#e2e8f0', textAlign: 'center' }}>
                      {t[`shapeName_${s.id}`] ?? s.id}
                    </span>
                    {sr && (
                      <span style={{ fontSize: 10, color: '#64748b', textAlign: 'center' }}>
                        {sr.bbox.w.toFixed(0)}×{sr.bbox.h.toFixed(0)}×{sr.bbox.d.toFixed(0)} mm
                      </span>
                    )}
                    {s.tier === 2 && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.15)', padding: '1px 6px', borderRadius: 4 }}>PRO</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* COTS parts list */}
          {filter === 'cots' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1, paddingRight: 4 }}>
              {filteredCots.map(part => {
                const isActive = selectedCots?.id === part.id;
                return (
                  <div
                    key={part.id}
                    onClick={() => setSelectedCots(part)}
                    style={{
                      background: isActive ? 'rgba(251,191,36,0.12)' : 'rgba(255,255,255,0.03)',
                      border: isActive ? '2px solid #fbbf24' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 10, padding: '10px 14px', cursor: 'pointer',
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: 10,
                    }}
                  >
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{COTS_ICONS[part.category] ?? '⚙️'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: isActive ? '#fbbf24' : '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {lang === 'ko' ? part.nameKo : part.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>{part.standard}</div>
                    </div>
                    <div style={{ fontSize: 10, color: '#fbbf24', fontWeight: 700, flexShrink: 0 }}>
                      ₩{part.unitPriceKRW}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── RIGHT: Preview + Params  OR  COTS Detail ── */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {filter === 'cots' ? (
            /* ═══ COTS Detail Panel ═══ */
            selectedCots ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>

                {/* Header card */}
                <div style={{
                  background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.25)',
                  borderRadius: 16, padding: '20px 22px', flexShrink: 0,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 36 }}>{COTS_ICONS[selectedCots.category] ?? '⚙️'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 17, fontWeight: 900, color: '#fde68a', lineHeight: 1.3 }}>
                        {lang === 'ko' ? selectedCots.nameKo : selectedCots.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#92400e', background: 'rgba(251,191,36,0.15)', display: 'inline-block', padding: '2px 8px', borderRadius: 6, marginTop: 4, fontWeight: 700 }}>
                        {selectedCots.standard}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: 22, fontWeight: 900, color: '#fbbf24' }}>₩{selectedCots.unitPriceKRW}</div>
                      <div style={{ fontSize: 10, color: '#78716c' }}>{tt.perPiece}</div>
                      <div style={{ fontSize: 11, color: '#a8a29e', marginTop: 2 }}>{selectedCots.unitWeightG}g</div>
                    </div>
                  </div>
                </div>

                {/* Params table */}
                <div style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 14, padding: '14px 18px', flexShrink: 0,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    {tt.dimensions}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                    {Object.entries(selectedCots.params).map(([key, val]) => {
                      const labelObj = COTS_PARAM_LABELS[key];
                      const label = labelObj ? (labelObj[resolvedLang] ?? labelObj.en) : key;
                      return (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 5 }}>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{label}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{val}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Suppliers */}
                <div style={{
                  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 14, padding: '14px 18px', flexShrink: 0,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                    {tt.suppliersHeader}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {selectedCots.suppliers.map(s => (
                      <span key={s} style={{
                        padding: '4px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.2)',
                        color: '#a5b4fc',
                      }}>{s}</span>
                    ))}
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={() => addToCart(selectedCots)}
                    style={{
                      flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                      background: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
                      color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.15)'; }}
                    onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
                  >
                    🛒 {tt.addToBom}
                  </button>
                  <button
                    onClick={() => onEnterWorkspace(COTS_SHAPE_MAP[selectedCots.category] ?? 'cylinder', cotsParamsToShapeParams(selectedCots))}
                    style={{
                      flex: 1, padding: '12px 0', borderRadius: 12,
                      border: '1px solid rgba(251,191,36,0.3)',
                      background: 'rgba(251,191,36,0.07)',
                      color: '#fbbf24', fontWeight: 700, fontSize: 13, cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.15)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.07)'; }}
                  >
                    🛠 {tt.openDesigner}
                  </button>
                </div>
              </div>
            ) : (
              /* No COTS selected placeholder */
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                color: '#475569', gap: 12,
              }}>
                <span style={{ fontSize: 48 }}>⚙️</span>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {tt.selectCotsTitle}
                </div>
                <div style={{ fontSize: 12, color: '#334155', textAlign: 'center', maxWidth: 240 }}>
                  {tt.selectCotsHint}
                </div>
              </div>
            )
          ) : (
            /* ═══ Normal Shape Preview + Params ═══ */
            <>
              {/* 3D Preview card */}
              <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, overflow: 'hidden', height: 340, flexShrink: 0,
              }}>
                <ShapePreview result={liveResult} />
              </div>

              {/* Parameter panel */}
              <div style={{
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 16, padding: 18, flex: 1, overflowY: 'auto', minHeight: 0,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 22 }}>{SHAPE_ICONS[selectedId] || '🧊'}</span>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>
                      {t[`shapeName_${selectedId}`] ?? selectedId}
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>
                      {t[`shapeDesc_${selectedId}`] ?? ''}
                    </div>
                  </div>
                </div>

                {/* Params */}
                {selectedShape.params.map(sp => {
                  const label = t[sp.labelKey] ?? sp.key;
                  const val = params[sp.key] ?? sp.default;
                  return (
                    <div key={sp.key} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>{label}</label>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc' }}>{val}{sp.unit}</span>
                      </div>
                      <input
                        type="range" min={sp.min} max={sp.max} step={sp.step} value={val}
                        onChange={e => handleParamChange(sp.key, parseFloat(e.target.value))}
                        style={{ width: '100%', accentColor: '#667eea', height: 4 }}
                      />
                    </div>
                  );
                })}

                {/* Geometry info */}
                {liveResult && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, padding: 10, background: 'rgba(102,126,234,0.08)', borderRadius: 10 }}>
                    <div style={{ fontSize: 11 }}>
                      <span style={{ color: '#64748b' }}>Volume</span>
                      <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{liveResult.volume_cm3.toFixed(2)} cm³</div>
                    </div>
                    <div style={{ fontSize: 11 }}>
                      <span style={{ color: '#64748b' }}>Surface</span>
                      <div style={{ fontWeight: 700, color: '#e2e8f0' }}>{liveResult.surface_area_cm2.toFixed(2)} cm²</div>
                    </div>
                    <div style={{ fontSize: 11, gridColumn: 'span 2' }}>
                      <span style={{ color: '#64748b' }}>Size</span>
                      <div style={{ fontWeight: 700, color: '#a5b4fc' }}>{liveResult.bbox.w.toFixed(1)} × {liveResult.bbox.h.toFixed(1)} × {liveResult.bbox.d.toFixed(1)} mm</div>
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                  <button
                    onClick={() => onEnterWorkspace(selectedId, params)}
                    style={{
                      flex: 1, padding: '12px 0', borderRadius: 12, border: 'none',
                      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      color: '#fff', fontWeight: 800, fontSize: 14, cursor: 'pointer',
                      transition: 'all 0.2s', letterSpacing: '-0.01em',
                    }}
                  >
                    {tt.openDesignerMain}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ════════ COTS BOM 장바구니 드로어 ════════ */}
      {cotsBomCart.length > 0 && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 200,
          background: '#161b22',
          borderTop: '2px solid #fbbf2455',
          transition: 'transform 0.25s ease',
        }}>
          {/* 드로어 헤더 (토글) */}
          <div
            onClick={() => setCartOpen(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 24px', cursor: 'pointer',
              borderBottom: cartOpen ? '1px solid #30363d' : 'none',
            }}
          >
            <span style={{ fontSize: 16 }}>🛒</span>
            <span style={{ fontWeight: 800, fontSize: 14, color: '#fbbf24' }}>
              {tt.cotsBomHeader(cartCount)}
            </span>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#e2e8f0', marginLeft: 8 }}>
              ₩{cartTotal.toLocaleString()}
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={e => { e.stopPropagation(); setCotsBomCart([]); }}
              style={{ fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              {tt.clearCart}
            </button>
            <span style={{ color: '#64748b', fontSize: 12 }}>{cartOpen ? '▼' : '▲'}</span>
          </div>

          {/* 드로어 본문 */}
          {cartOpen && (
            <div style={{ padding: '12px 24px 16px', maxHeight: 300, overflowY: 'auto' }}>
              {/* 부품 목록 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {cotsBomCart.map(({ part, qty }) => (
                  <div key={part.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 12px',
                  }}>
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{COTS_ICONS[part.category] ?? '⚙️'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {lang === 'ko' ? part.nameKo : part.name}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>{part.standard} · ₩{part.unitPriceKRW}/ea</div>
                    </div>
                    {/* 수량 조절 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => setCartQty(part.id, qty - 1)}
                        style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #30363d', background: '#21262d', color: '#e2e8f0', cursor: 'pointer', fontWeight: 700 }}
                      >−</button>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', minWidth: 28, textAlign: 'center' }}>{qty}</span>
                      <button
                        onClick={() => setCartQty(part.id, qty + 1)}
                        style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid #30363d', background: '#21262d', color: '#e2e8f0', cursor: 'pointer', fontWeight: 700 }}
                      >+</button>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', minWidth: 72, textAlign: 'right', flexShrink: 0 }}>
                      ₩{(part.unitPriceKRW * qty).toLocaleString()}
                    </div>
                    <button
                      onClick={() => setCartQty(part.id, 0)}
                      style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 14, padding: '0 4px' }}
                    >✕</button>
                  </div>
                ))}
              </div>

              {/* 합계 + 액션 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 10, borderTop: '1px solid #30363d' }}>
                <div style={{ flex: 1 }}>
                  <span style={{ fontSize: 12, color: '#64748b' }}>{tt.totalLabel}: </span>
                  <span style={{ fontSize: 16, fontWeight: 900, color: '#fbbf24' }}>₩{cartTotal.toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: '#64748b', marginLeft: 6 }}>
                    ({tt.totalSummary(cotsBomCart.length, cartCount)})
                  </span>
                </div>
                <CotsBomActions cart={cotsBomCart} total={cartTotal} lang={lang} onClear={() => setCotsBomCart([])} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════ FOOTER ════════ */}
      <div style={{ padding: '16px 32px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <span style={{ fontSize: 11, color: '#475569' }}>
          {tt.footerHint}
        </span>
      </div>
    </div>
  );
}
