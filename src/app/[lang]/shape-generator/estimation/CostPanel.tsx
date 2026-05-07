'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  estimateCosts,
  getProcessName,
  formatCost,
  PROCESS_ICONS,
  type GeometryMetrics,
  type CostEstimate,
  type ProcessType,
  type CostCurrency,
  type CostEstimationContext,
} from './CostEstimator';
import type { FlatPatternResult } from '../features/sheetMetal';
import type { DFMIssueSummary } from './rfqBundler';
import { useFreemium, type FreemiumFeature } from '@/hooks/useFreemium';
import UpgradeModal from '@/components/nexyfab/UpgradeModal';

/* ─── Props ─────────────────────────────────────────────────────────────────── */

interface CostPanelProps {
  metrics: GeometryMetrics;
  materialId: string;
  lang: string;
  onClose: () => void;
  onRequestQuote?: () => void;
  onOpenSuppliers?: () => void;
  /** Optional real flat pattern (from the sheet-metal feature) — if present
   * the sheet-metal estimate uses actual perimeter/bend data instead of the
   * surface-area approximation. */
  flatPattern?: FlatPatternResult;
  /** Initial currency selection; user can override in the panel header. */
  defaultCurrency?: CostCurrency;
  /** Part name for the quote request */
  partName?: string;
  /** DFM issues to include in the RFQ bundle (optional) */
  dfmIssues?: DFMIssueSummary[];
}

/* ─── Palette (dark theme) ──────────────────────────────────────────────────── */

const C = {
  bg: '#161b22',
  card: '#21262d',
  border: '#30363d',
  accent: '#388bfd',
  accentBright: '#58a6ff',
  text: '#c9d1d9',
  dim: '#8b949e',
  green: '#3fb950',
  yellow: '#d29922',
  red: '#f85149',
};

/* ─── i18n helpers ──────────────────────────────────────────────────────────── */

const dict = {
  ko: {
    high: '높음', medium: '보통', low: '낮음',
    unitCostCompare: '공정별 단가 비교',
    difficultyScore: '난이도 점수',
    leadTime: '리드타임', unitCost: '단가',
    material: '재료비', machine: '가공비', setup: '셋업비',
    marketPrices: '원자재 시세', hide: '숨기기', fetch: '조회', updated: '갱신: ',
    noPriceData: '이 재료의 시세 정보가 없습니다.',
    rate: (krw: string) => `환율: 1 USD = ${krw}원`,
    instantQuote: '즉시 견적',
    geomBasedEst: '형상 기반 자동 비용 추정',
    volume: '체적', surface: '표면적', size: '크기',
    quantity: '수량', custom: '직접',
    byCost: '비용순', byLeadTime: '납기순',
    process: '공정',
    noProcesses: '이 재질에 적합한 공정이 없습니다',
    disclaimer: '* 자동 추정 가격이며, 정식 견적은 "견적 요청" 버튼을 이용해 주세요.',
    findSuppliers: '공급사 매칭 보기',
    printPDF: 'PDF 견적서 출력',
    buildingBundle: '⏳ 번들 생성 중…',
    bundleDone: '✓ RFQ 패키지 다운로드 완료',
    rfqDownload: 'RFQ 패키지 다운로드 (.zip)',
    sending: '전송 중…',
    sentTpl: (id: string) => `✓ 전송됨 (${id})`,
    sendFailed: '전송 실패 — 재시도',
    requestQuote: '정식 견적 요청 → NexyFlow',
    unnamedPart: '무제 부품',
  },
  en: {
    high: 'High', medium: 'Med', low: 'Low',
    unitCostCompare: 'Unit Cost Comparison',
    difficultyScore: 'Difficulty score',
    leadTime: 'Lead Time', unitCost: 'Unit Cost',
    material: 'Material', machine: 'Machine', setup: 'Setup',
    marketPrices: 'Market Prices', hide: 'Hide', fetch: 'Fetch', updated: 'Updated: ',
    noPriceData: 'No price data for this material.',
    rate: (krw: string) => `Rate: 1 USD = ${krw} KRW`,
    instantQuote: 'Instant Quote',
    geomBasedEst: 'Geometry-based cost estimation',
    volume: 'Volume', surface: 'Surface', size: 'Size',
    quantity: 'Quantity', custom: 'Custom',
    byCost: 'By Cost', byLeadTime: 'By Lead Time',
    process: 'Process',
    noProcesses: 'No applicable processes for this material',
    disclaimer: '* Automated estimate. Use "Request Quote" for a formal quotation.',
    findSuppliers: 'Find Suppliers',
    printPDF: 'Print PDF Quote',
    buildingBundle: '⏳ Building bundle…',
    bundleDone: '✓ RFQ bundle downloaded',
    rfqDownload: 'Download RFQ Bundle (.zip)',
    sending: 'Sending…',
    sentTpl: (id: string) => `✓ Sent (${id})`,
    sendFailed: 'Send Failed — Retry',
    requestQuote: 'Request Formal Quote → NexyFlow',
    unnamedPart: 'Unnamed Part',
  },
  ja: {
    high: '高', medium: '中', low: '低',
    unitCostCompare: '工程別単価比較',
    difficultyScore: '難易度スコア',
    leadTime: '納期', unitCost: '単価',
    material: '材料費', machine: '加工費', setup: 'セットアップ費',
    marketPrices: '原材料相場', hide: '隠す', fetch: '取得', updated: '更新: ',
    noPriceData: 'この材料の相場情報がありません。',
    rate: (krw: string) => `レート: 1 USD = ${krw} KRW`,
    instantQuote: '即時見積',
    geomBasedEst: '形状ベースのコスト自動推定',
    volume: '体積', surface: '表面積', size: 'サイズ',
    quantity: '数量', custom: 'カスタム',
    byCost: 'コスト順', byLeadTime: '納期順',
    process: '工程',
    noProcesses: 'この材質に適合する工程がありません',
    disclaimer: '* 自動推定価格です。正式な見積は「見積依頼」ボタンをご利用ください。',
    findSuppliers: 'サプライヤー検索',
    printPDF: 'PDF見積書を出力',
    buildingBundle: '⏳ バンドル作成中…',
    bundleDone: '✓ RFQパッケージをダウンロードしました',
    rfqDownload: 'RFQパッケージダウンロード (.zip)',
    sending: '送信中…',
    sentTpl: (id: string) => `✓ 送信済み (${id})`,
    sendFailed: '送信失敗 — 再試行',
    requestQuote: '正式見積依頼 → NexyFlow',
    unnamedPart: '無題の部品',
  },
  zh: {
    high: '高', medium: '中', low: '低',
    unitCostCompare: '各工艺单价对比',
    difficultyScore: '难度评分',
    leadTime: '交货期', unitCost: '单价',
    material: '材料费', machine: '加工费', setup: '准备费',
    marketPrices: '原材料行情', hide: '隐藏', fetch: '查询', updated: '更新: ',
    noPriceData: '暂无该材料的行情数据。',
    rate: (krw: string) => `汇率: 1 USD = ${krw} KRW`,
    instantQuote: '即时报价',
    geomBasedEst: '基于几何形状的成本估算',
    volume: '体积', surface: '表面积', size: '尺寸',
    quantity: '数量', custom: '自定义',
    byCost: '按成本', byLeadTime: '按交期',
    process: '工艺',
    noProcesses: '没有适合此材料的工艺',
    disclaimer: '* 自动估算价格,正式报价请使用"报价请求"按钮。',
    findSuppliers: '查找供应商',
    printPDF: '打印PDF报价单',
    buildingBundle: '⏳ 正在生成捆绑包…',
    bundleDone: '✓ RFQ包已下载',
    rfqDownload: '下载RFQ包 (.zip)',
    sending: '发送中…',
    sentTpl: (id: string) => `✓ 已发送 (${id})`,
    sendFailed: '发送失败 — 重试',
    requestQuote: '正式报价请求 → NexyFlow',
    unnamedPart: '未命名零件',
  },
  es: {
    high: 'Alta', medium: 'Med', low: 'Baja',
    unitCostCompare: 'Comparación de coste unitario',
    difficultyScore: 'Puntuación de dificultad',
    leadTime: 'Plazo', unitCost: 'Coste unit.',
    material: 'Material', machine: 'Máquina', setup: 'Preparación',
    marketPrices: 'Precios de mercado', hide: 'Ocultar', fetch: 'Consultar', updated: 'Actualizado: ',
    noPriceData: 'Sin datos de precios para este material.',
    rate: (krw: string) => `Tasa: 1 USD = ${krw} KRW`,
    instantQuote: 'Cotización Instantánea',
    geomBasedEst: 'Estimación de coste basada en geometría',
    volume: 'Volumen', surface: 'Superficie', size: 'Tamaño',
    quantity: 'Cantidad', custom: 'Pers.',
    byCost: 'Por coste', byLeadTime: 'Por plazo',
    process: 'Proceso',
    noProcesses: 'Sin procesos aplicables para este material',
    disclaimer: '* Estimación automática. Use "Solicitar cotización" para una cotización formal.',
    findSuppliers: 'Buscar proveedores',
    printPDF: 'Imprimir cotización PDF',
    buildingBundle: '⏳ Creando paquete…',
    bundleDone: '✓ Paquete RFQ descargado',
    rfqDownload: 'Descargar paquete RFQ (.zip)',
    sending: 'Enviando…',
    sentTpl: (id: string) => `✓ Enviado (${id})`,
    sendFailed: 'Error al enviar — Reintentar',
    requestQuote: 'Solicitar cotización formal → NexyFlow',
    unnamedPart: 'Pieza sin nombre',
  },
  ar: {
    high: 'مرتفع', medium: 'متوسط', low: 'منخفض',
    unitCostCompare: 'مقارنة تكلفة الوحدة',
    difficultyScore: 'درجة الصعوبة',
    leadTime: 'مدة التسليم', unitCost: 'تكلفة الوحدة',
    material: 'مادة', machine: 'آلة', setup: 'إعداد',
    marketPrices: 'أسعار السوق', hide: 'إخفاء', fetch: 'جلب', updated: 'تحديث: ',
    noPriceData: 'لا توجد بيانات أسعار لهذه المادة.',
    rate: (krw: string) => `السعر: 1 USD = ${krw} KRW`,
    instantQuote: 'عرض أسعار فوري',
    geomBasedEst: 'تقدير التكلفة استناداً إلى الشكل',
    volume: 'الحجم', surface: 'السطح', size: 'المقاس',
    quantity: 'الكمية', custom: 'مخصص',
    byCost: 'حسب التكلفة', byLeadTime: 'حسب المدة',
    process: 'العملية',
    noProcesses: 'لا توجد عمليات مناسبة لهذه المادة',
    disclaimer: '* تقدير آلي. استخدم "طلب عرض أسعار" للحصول على عرض رسمي.',
    findSuppliers: 'البحث عن موردين',
    printPDF: 'طباعة عرض أسعار PDF',
    buildingBundle: '⏳ جارٍ إنشاء الحزمة…',
    bundleDone: '✓ تم تنزيل حزمة RFQ',
    rfqDownload: 'تنزيل حزمة RFQ (.zip)',
    sending: 'جارٍ الإرسال…',
    sentTpl: (id: string) => `✓ تم الإرسال (${id})`,
    sendFailed: 'فشل الإرسال — إعادة المحاولة',
    requestQuote: 'طلب عرض أسعار رسمي ← NexyFlow',
    unnamedPart: 'جزء بدون اسم',
  },
} as const;

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

function resolveLang(seg: string | undefined, fallback: string): keyof typeof dict {
  return langMap[seg ?? ''] ?? langMap[fallback] ?? 'en';
}

/* ─── Confidence badge ──────────────────────────────────────────────────────── */

function ConfidenceBadge({ level, lang }: { level: 'high' | 'medium' | 'low'; lang: string }) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const tt = dict[resolveLang(seg, lang)];
  const map = {
    high:   { color: C.green,  label: tt.high },
    medium: { color: C.yellow, label: tt.medium },
    low:    { color: C.red,    label: tt.low },
  };
  const { color, label } = map[level];
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>{label}</span>
  );
}

/* ─── Mini bar chart ────────────────────────────────────────────────────────── */

function CostBarChart({ estimates, lang }: { estimates: CostEstimate[]; lang: string }) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const tt = dict[resolveLang(seg, lang)];
  if (estimates.length === 0) return null;
  const maxCost = Math.max(...estimates.map(e => e.unitCost));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 2 }}>
        {tt.unitCostCompare}
      </div>
      {estimates.map(e => {
        const pct = maxCost > 0 ? (e.unitCost / maxCost) * 100 : 0;
        return (
          <div key={e.process} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, width: 60, color: C.dim, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {PROCESS_ICONS[e.process]} {getProcessName(e.process, lang).split(' ')[0]}
            </span>
            <div style={{ flex: 1, height: 14, background: '#0d1117', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%', borderRadius: 3,
                background: `linear-gradient(90deg, ${C.accent}, ${C.accentBright})`,
                transition: 'width 0.3s ease',
              }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: C.text, width: 72, textAlign: 'right' }}>
              {formatCost(e.unitCost, e.currency)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DifficultyBadge({ level, lang }: { level: number; lang: string }) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const tt = dict[resolveLang(seg, lang)];
  const color = level <= 4 ? C.green : level <= 7 ? C.yellow : C.red;
  return (
    <span title={tt.difficultyScore} style={{
      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>{level}/10</span>
  );
}

/* ─── Estimate card ─────────────────────────────────────────────────────────── */

function EstimateCard({ est, lang }: { est: CostEstimate; lang: string }) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const tt = dict[resolveLang(seg, lang)];
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      background: C.card, borderRadius: 8, border: `1px solid ${C.border}`,
      padding: '10px 12px', cursor: 'pointer', transition: 'border-color 0.15s',
    }}
      onClick={() => setExpanded(v => !v)}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{PROCESS_ICONS[est.process]}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
            {getProcessName(est.process, lang)}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>
            {tt.leadTime}: {est.leadTime}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.accentBright }}>
            {formatCost(est.totalCost, est.currency)}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>
            {tt.unitCost}: {formatCost(est.unitCost, est.currency)}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          <ConfidenceBadge level={est.confidence} lang={lang} />
          <DifficultyBadge level={est.difficulty} lang={lang} />
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 11 }}>
            <div>
              <span style={{ color: C.dim }}>{tt.material}</span><br />
              <span style={{ fontWeight: 700, color: C.text }}>{formatCost(est.materialCost, est.currency)}</span>
            </div>
            <div>
              <span style={{ color: C.dim }}>{tt.machine}</span><br />
              <span style={{ fontWeight: 700, color: C.text }}>{formatCost(est.machineCost, est.currency)}</span>
            </div>
            <div>
              <span style={{ color: C.dim }}>{tt.setup}</span><br />
              <span style={{ fontWeight: 700, color: C.text }}>{formatCost(est.setupCost, est.currency)}</span>
            </div>
          </div>
          {est.notes.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 10, color: C.yellow }}>
              {est.notes.map((n, i) => <div key={i}>⚠ {n}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Sort options ──────────────────────────────────────────────────────────── */

type SortBy = 'cost' | 'leadtime';

function sortEstimates(ests: CostEstimate[], by: SortBy): CostEstimate[] {
  const copy = [...ests];
  if (by === 'cost') return copy.sort((a, b) => a.totalCost - b.totalCost);
  // leadtime: parse first number from lead time string
  const parseFirst = (s: string) => parseInt(s.match(/\d+/)?.[0] ?? '99', 10);
  return copy.sort((a, b) => parseFirst(a.leadTime) - parseFirst(b.leadTime));
}

/* ─── Main Panel ────────────────────────────────────────────────────────────── */

const PRESET_QUANTITIES = [1, 10, 100, 1000];

// ── Material → commodity mapping ─────────────────────────────────────────────
const MATERIAL_COMMODITY: Record<string, string> = {
  aluminum: 'aluminum', al6061: 'aluminum', al7075: 'aluminum',
  steel: 'steel', stainless_steel: 'steel', tool_steel: 'steel',
  copper: 'copper', brass: 'copper',
  titanium: 'nickel', // approx
};

interface MaterialPrices {
  krwPerUsd: number;
  prices: Record<string, { usdPerKg: number; krwPerKg: number; source: string; updatedAt: string }>;
}

function MaterialPriceTicker({ materialId, lang }: { materialId: string; lang: string }) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const tt = dict[resolveLang(seg, lang)];
  const [prices, setPrices] = useState<MaterialPrices | null>(null);
  const [loading, setLoading] = useState(false);
  const [shown, setShown] = useState(false);

  const commodity = MATERIAL_COMMODITY[materialId] ?? null;

  const fetchPrices = async () => {
    if (prices) { setShown(s => !s); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/material-prices');
      if (res.ok) { setPrices(await res.json()); setShown(true); }
    } catch { /* ignore */ } finally { setLoading(false); }
  };

  const price = commodity && prices ? prices.prices?.[commodity] : null;

  return (
    <div style={{ background: '#0d1117', borderRadius: 8, border: '1px solid #21262d', padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: '#8b949e', fontWeight: 600 }}>
          {tt.marketPrices}
          {commodity && <span style={{ marginLeft: 4, fontSize: 10, color: '#484f58' }}>({commodity})</span>}
        </span>
        <button onClick={fetchPrices} disabled={loading}
          style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, cursor: 'pointer',
            border: '1px solid #30363d', background: shown ? '#21262d' : '#388bfd22',
            color: shown ? '#8b949e' : '#388bfd',
          }}>
          {loading ? '...' : shown ? tt.hide : tt.fetch}
        </button>
      </div>

      {shown && prices && (
        <div style={{ marginTop: 8 }}>
          {price ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: '#484f58' }}>USD/kg </span>
                <span style={{ color: '#e6edf3', fontWeight: 700 }}>${price.usdPerKg.toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 11 }}>
                <span style={{ color: '#484f58' }}>KRW/kg </span>
                <span style={{ color: '#3fb950', fontWeight: 700 }}>₩{price.krwPerKg.toLocaleString('ko-KR')}</span>
              </div>
              <div style={{ fontSize: 9, color: '#484f58', width: '100%' }}>
                {tt.updated}{price.updatedAt?.slice(0, 10) ?? '—'} · {price.source}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#484f58' }}>
              {tt.noPriceData}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 9, color: '#484f58' }}>
            {tt.rate(prices.krwPerUsd?.toLocaleString() ?? '—')}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CostPanel({ metrics, materialId, lang, onClose, onRequestQuote, onOpenSuppliers, flatPattern, defaultCurrency, partName, dfmIssues }: CostPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang;
  const resolvedLang = resolveLang(seg, lang);
  const tt = dict[resolvedLang];
  const [selectedQty, setSelectedQty] = useState(1);
  const [customQty, setCustomQty] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('cost');
  // Default to KRW when the UI is in Korean — matches the user's mental model.
  const [currency, setCurrency] = useState<CostCurrency>(defaultCurrency ?? (resolvedLang === 'ko' ? 'KRW' : 'USD'));
  const [quoteStatus, setQuoteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [rfqStatus, setRfqStatus] = useState<'idle' | 'building' | 'done'>('idle');

  // Freemium gate
  const { check } = useFreemium();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<FreemiumFeature>('supplier_match');
  const [upgradeOverLimit, setUpgradeOverLimit] = useState(false);
  const [upgradeUsed, setUpgradeUsed] = useState(0);
  const [upgradeLimit, setUpgradeLimit] = useState(-1);

  function gateFeature(feature: FreemiumFeature, fn: () => void) {
    const result = check(feature);
    if (!result.allowed) {
      setUpgradeFeature(feature);
      setUpgradeOverLimit(result.overLimit);
      setUpgradeUsed(result.used);
      setUpgradeLimit(result.limit);
      setUpgradeOpen(true);
      return;
    }
    fn();
  }

  const activeQty = customQty ? parseInt(customQty, 10) || 1 : selectedQty;

  // Compute all estimates
  const allEstimates = useMemo(
    () => estimateCosts(metrics, materialId, [activeQty], { currency, flatPattern }),
    [metrics, materialId, activeQty, currency, flatPattern],
  );

  // Sort for display
  const sorted = useMemo(() => sortEstimates(allEstimates, sortBy), [allEstimates, sortBy]);

  return (
    <div style={{
      width: 360, flexShrink: 0, borderLeft: `1px solid ${C.border}`,
      background: C.bg, display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '10px 14px',
        borderBottom: `1px solid ${C.border}`, gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>💰</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
            {tt.instantQuote}
          </div>
          <div style={{ fontSize: 9, color: C.dim }}>
            {tt.geomBasedEst}
          </div>
        </div>
        <button onClick={onClose} style={{
          border: 'none', background: C.card, cursor: 'pointer', fontSize: 12, color: C.dim,
          width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; e.currentTarget.style.color = C.text; }}
          onMouseLeave={e => { e.currentTarget.style.background = C.card; e.currentTarget.style.color = C.dim; }}
        >✕</button>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Geometry summary */}
        <div style={{
          background: C.card, borderRadius: 8, padding: '8px 10px',
          border: `1px solid ${C.border}`, fontSize: 11,
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
            <div><span style={{ color: C.dim }}>{tt.volume}</span> <span style={{ fontWeight: 700, color: C.text }}>{metrics.volume_cm3.toFixed(2)} cm³</span></div>
            <div><span style={{ color: C.dim }}>{tt.surface}</span> <span style={{ fontWeight: 700, color: C.text }}>{metrics.surfaceArea_cm2.toFixed(1)} cm²</span></div>
            <div style={{ gridColumn: 'span 2' }}>
              <span style={{ color: C.dim }}>{tt.size}</span>{' '}
              <span style={{ fontWeight: 700, color: C.accentBright }}>
                {metrics.boundingBox.w.toFixed(1)} x {metrics.boundingBox.h.toFixed(1)} x {metrics.boundingBox.d.toFixed(1)} mm
              </span>
            </div>
          </div>
        </div>

        {/* Material price ticker */}
        <MaterialPriceTicker materialId={materialId} lang={lang} />

        {/* Quantity selector */}
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 6 }}>
            {tt.quantity}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {PRESET_QUANTITIES.map(q => (
              <button key={q} onClick={() => { setSelectedQty(q); setCustomQty(''); }}
                style={{
                  flex: 1, padding: '5px 0', borderRadius: 5, fontSize: 11, fontWeight: 700,
                  border: `1px solid ${(!customQty && selectedQty === q) ? C.accent : C.border}`,
                  background: (!customQty && selectedQty === q) ? `${C.accent}22` : 'transparent',
                  color: (!customQty && selectedQty === q) ? C.accentBright : C.dim,
                  cursor: 'pointer', transition: 'all 0.12s',
                }}>
                {q}
              </button>
            ))}
            <input
              type="number" min="1" max="100000"
              placeholder={tt.custom}
              value={customQty}
              onChange={e => setCustomQty(e.target.value)}
              style={{
                width: 60, padding: '5px 6px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                border: `1px solid ${customQty ? C.accent : C.border}`,
                background: '#0d1117', color: C.text, textAlign: 'center',
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Currency toggle */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['KRW', 'USD'] as CostCurrency[]).map(c => (
            <button key={c} onClick={() => setCurrency(c)} style={{
              flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 700,
              border: `1px solid ${currency === c ? C.accent : C.border}`,
              background: currency === c ? `${C.accent}22` : 'transparent',
              color: currency === c ? C.accentBright : C.dim,
              cursor: 'pointer',
            }}>
              {c === 'KRW' ? '₩ KRW' : '$ USD'}
            </button>
          ))}
        </div>

        {/* Sort toggle */}
        <div style={{ display: 'flex', gap: 4 }}>
          {([
            ['cost', tt.byCost],
            ['leadtime', tt.byLeadTime],
          ] as [SortBy, string][]).map(([key, label]) => (
            <button key={key} onClick={() => setSortBy(key)} style={{
              flex: 1, padding: '4px 0', borderRadius: 5, fontSize: 10, fontWeight: 700,
              border: `1px solid ${sortBy === key ? C.accent : C.border}`,
              background: sortBy === key ? `${C.accent}22` : 'transparent',
              color: sortBy === key ? C.accentBright : C.dim,
              cursor: 'pointer',
            }}>
              {label}
            </button>
          ))}
        </div>

        {/* Bar chart */}
        <CostBarChart estimates={sorted} lang={lang} />

        {/* Estimate cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.dim }}>
            {tt.process} ({sorted.length})
          </div>
          {sorted.map(est => (
            <EstimateCard key={est.process} est={est} lang={lang} />
          ))}
          {sorted.length === 0 && (
            <div style={{ fontSize: 11, color: C.dim, textAlign: 'center', padding: 20 }}>
              {tt.noProcesses}
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.5, marginTop: 4 }}>
          {tt.disclaimer}
        </div>
      </div>

      {/* ── Footer: buttons ── */}
      <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button onClick={() => gateFeature('supplier_match', () => onOpenSuppliers?.())} style={{
          width: '100%', padding: '8px 0', borderRadius: 8,
          border: `1px solid ${C.border}`,
          background: C.card,
          color: C.text, fontSize: 12, fontWeight: 700, cursor: 'pointer',
        }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = C.green)}
          onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
        >
          🏭 {tt.findSuppliers}
        </button>
        <button
          onClick={async () => {
            const { printQuote } = await import('./quotePrinter');
            await printQuote({
              estimates: sorted,
              metrics,
              materialId,
              quantity: activeQty,
              currency,
              flatPattern,
            }, lang);
          }}
          style={{
            width: '100%', padding: '8px 0', borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: C.card,
            color: C.text, fontSize: 12, fontWeight: 700, cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = C.accent)}
          onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
        >
          🖨️ {tt.printPDF}
        </button>
        <button
          disabled={rfqStatus === 'building'}
          onClick={() => gateFeature('rfq_bundle', async () => {
            setRfqStatus('building');
            try {
              const { downloadRFQBundle } = await import('./rfqBundler');
              await downloadRFQBundle({
                partName: partName || tt.unnamedPart,
                materialId,
                quantity: activeQty,
                currency,
                estimates: sorted,
                metrics,
                lang,
                flatPattern,
                dfmIssues,
              });
              setRfqStatus('done');
              setTimeout(() => setRfqStatus('idle'), 3000);
            } catch {
              setRfqStatus('idle');
            }
          })}
          style={{
            width: '100%', padding: '8px 0', borderRadius: 8,
            border: `1px solid ${rfqStatus === 'done' ? C.green : C.border}`,
            background: rfqStatus === 'done' ? `${C.green}18` : C.card,
            color: rfqStatus === 'done' ? C.green : C.text,
            fontSize: 12, fontWeight: 700,
            cursor: rfqStatus === 'building' ? 'default' : 'pointer',
            opacity: rfqStatus === 'building' ? 0.6 : 1,
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { if (rfqStatus === 'idle') e.currentTarget.style.borderColor = C.yellow; }}
          onMouseLeave={e => { if (rfqStatus === 'idle') e.currentTarget.style.borderColor = C.border; }}
        >
          {rfqStatus === 'building'
            ? tt.buildingBundle
            : rfqStatus === 'done'
            ? tt.bundleDone
            : `📦 ${tt.rfqDownload}`}
        </button>
        <button
          disabled={quoteStatus === 'sending' || quoteStatus === 'sent'}
          onClick={async () => {
            if (quoteStatus === 'sent') return;
            setQuoteStatus('sending');
            try {
              const { submitQuoteToNexyFlow } = await import('./nexyflowQuoteAPI');
              const q = await submitQuoteToNexyFlow({
                partName: partName || tt.unnamedPart,
                materialId,
                quantity: activeQty,
                currency,
                estimates: sorted,
                metrics,
              });
              setQuoteId(q.id);
              setQuoteStatus('sent');
              onRequestQuote?.();
            } catch {
              setQuoteStatus('error');
              setTimeout(() => setQuoteStatus('idle'), 3000);
            }
          }}
          style={{
            width: '100%', padding: '10px 0', borderRadius: 8, border: 'none',
            background: quoteStatus === 'sent'
              ? C.green
              : quoteStatus === 'error'
              ? C.red
              : `linear-gradient(135deg, ${C.accent}, #1f6feb)`,
            color: '#fff', fontSize: 13, fontWeight: 800,
            cursor: quoteStatus === 'sending' || quoteStatus === 'sent' ? 'default' : 'pointer',
            transition: 'opacity 0.15s',
            opacity: quoteStatus === 'sending' ? 0.7 : 1,
          }}
        >
          {quoteStatus === 'sending'
            ? tt.sending
            : quoteStatus === 'sent'
            ? tt.sentTpl(quoteId ?? '')
            : quoteStatus === 'error'
            ? tt.sendFailed
            : tt.requestQuote}
        </button>
      </div>

      <UpgradeModal
        open={upgradeOpen}
        feature={upgradeFeature}
        overLimit={upgradeOverLimit}
        used={upgradeUsed}
        limit={upgradeLimit}
        lang={lang}
        onClose={() => setUpgradeOpen(false)}
      />
    </div>
  );
}
