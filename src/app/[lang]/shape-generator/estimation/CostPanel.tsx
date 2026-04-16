'use client';

import React, { useState, useMemo, useCallback } from 'react';
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

function t(lang: string, ko: string, en: string) { return lang === 'ko' ? ko : en; }

/* ─── Confidence badge ──────────────────────────────────────────────────────── */

function ConfidenceBadge({ level, lang }: { level: 'high' | 'medium' | 'low'; lang: string }) {
  const map = {
    high:   { color: C.green,  label: t(lang, '높음', 'High') },
    medium: { color: C.yellow, label: t(lang, '보통', 'Med') },
    low:    { color: C.red,    label: t(lang, '낮음', 'Low') },
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
  if (estimates.length === 0) return null;
  const maxCost = Math.max(...estimates.map(e => e.unitCost));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: C.dim, marginBottom: 2 }}>
        {t(lang, '공정별 단가 비교', 'Unit Cost Comparison')}
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
  const color = level <= 4 ? C.green : level <= 7 ? C.yellow : C.red;
  return (
    <span title={t(lang, '난이도 점수', 'Difficulty score')} style={{
      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: `${color}22`, color, border: `1px solid ${color}44`,
    }}>{level}/10</span>
  );
}

/* ─── Estimate card ─────────────────────────────────────────────────────────── */

function EstimateCard({ est, lang }: { est: CostEstimate; lang: string }) {
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
            {t(lang, '리드타임', 'Lead Time')}: {est.leadTime}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: C.accentBright }}>
            {formatCost(est.totalCost, est.currency)}
          </div>
          <div style={{ fontSize: 10, color: C.dim }}>
            {t(lang, '단가', 'Unit Cost')}: {formatCost(est.unitCost, est.currency)}
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
              <span style={{ color: C.dim }}>{t(lang, '재료비', 'Material')}</span><br />
              <span style={{ fontWeight: 700, color: C.text }}>{formatCost(est.materialCost, est.currency)}</span>
            </div>
            <div>
              <span style={{ color: C.dim }}>{t(lang, '가공비', 'Machine')}</span><br />
              <span style={{ fontWeight: 700, color: C.text }}>{formatCost(est.machineCost, est.currency)}</span>
            </div>
            <div>
              <span style={{ color: C.dim }}>{t(lang, '셋업비', 'Setup')}</span><br />
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
          {t(lang, '원자재 시세', 'Market Prices')}
          {commodity && <span style={{ marginLeft: 4, fontSize: 10, color: '#484f58' }}>({commodity})</span>}
        </span>
        <button onClick={fetchPrices} disabled={loading}
          style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, cursor: 'pointer',
            border: '1px solid #30363d', background: shown ? '#21262d' : '#388bfd22',
            color: shown ? '#8b949e' : '#388bfd',
          }}>
          {loading ? '...' : shown ? (t(lang, '숨기기', 'Hide')) : (t(lang, '조회', 'Fetch'))}
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
                <span style={{ color: '#3fb950', fontWeight: 700 }}>{price.krwPerKg.toLocaleString('ko-KR')}원</span>
              </div>
              <div style={{ fontSize: 9, color: '#484f58', width: '100%' }}>
                {t(lang, '갱신: ', 'Updated: ')}{price.updatedAt?.slice(0, 10) ?? '—'} · {price.source}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#484f58' }}>
              {t(lang, '이 재료의 시세 정보가 없습니다.', 'No price data for this material.')}
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 9, color: '#484f58' }}>
            {t(lang, `환율: 1 USD = ${prices.krwPerUsd?.toLocaleString()}원`, `Rate: 1 USD = ${prices.krwPerUsd?.toLocaleString()} KRW`)}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CostPanel({ metrics, materialId, lang, onClose, onRequestQuote, onOpenSuppliers, flatPattern, defaultCurrency, partName, dfmIssues }: CostPanelProps) {
  const [selectedQty, setSelectedQty] = useState(1);
  const [customQty, setCustomQty] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('cost');
  // Default to KRW when the UI is in Korean — matches the user's mental model.
  const [currency, setCurrency] = useState<CostCurrency>(defaultCurrency ?? (lang === 'ko' ? 'KRW' : 'USD'));
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
            {t(lang, '즉시 견적', 'Instant Quote')}
          </div>
          <div style={{ fontSize: 9, color: C.dim }}>
            {t(lang, '형상 기반 자동 비용 추정', 'Geometry-based cost estimation')}
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
            <div><span style={{ color: C.dim }}>{t(lang, '체적', 'Volume')}</span> <span style={{ fontWeight: 700, color: C.text }}>{metrics.volume_cm3.toFixed(2)} cm³</span></div>
            <div><span style={{ color: C.dim }}>{t(lang, '표면적', 'Surface')}</span> <span style={{ fontWeight: 700, color: C.text }}>{metrics.surfaceArea_cm2.toFixed(1)} cm²</span></div>
            <div style={{ gridColumn: 'span 2' }}>
              <span style={{ color: C.dim }}>{t(lang, '크기', 'Size')}</span>{' '}
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
            {t(lang, '수량', 'Quantity')}
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
              placeholder={t(lang, '직접', 'Custom')}
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
            ['cost', t(lang, '비용순', 'By Cost')],
            ['leadtime', t(lang, '납기순', 'By Lead Time')],
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
            {t(lang, '공정', 'Process')} ({sorted.length})
          </div>
          {sorted.map(est => (
            <EstimateCard key={est.process} est={est} lang={lang} />
          ))}
          {sorted.length === 0 && (
            <div style={{ fontSize: 11, color: C.dim, textAlign: 'center', padding: 20 }}>
              {t(lang, '이 재질에 적합한 공정이 없습니다', 'No applicable processes for this material')}
            </div>
          )}
        </div>

        {/* Disclaimer */}
        <div style={{ fontSize: 9, color: C.dim, lineHeight: 1.5, marginTop: 4 }}>
          {t(lang,
            '* 자동 추정 가격이며, 정식 견적은 "견적 요청" 버튼을 이용해 주세요.',
            '* Automated estimate. Use "Request Quote" for a formal quotation.',
          )}
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
          🏭 {t(lang, '공급사 매칭 보기', 'Find Suppliers')}
        </button>
        <button
          onClick={async () => {
            const { printQuote } = await import('./quotePrinter');
            printQuote({
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
          🖨️ {t(lang, 'PDF 견적서 출력', 'Print PDF Quote')}
        </button>
        <button
          disabled={rfqStatus === 'building'}
          onClick={() => gateFeature('rfq_bundle', async () => {
            setRfqStatus('building');
            try {
              const { downloadRFQBundle } = await import('./rfqBundler');
              downloadRFQBundle({
                partName: partName || t(lang, '무제 부품', 'Unnamed Part'),
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
            ? (lang === 'ko' ? '⏳ 번들 생성 중…' : '⏳ Building bundle…')
            : rfqStatus === 'done'
            ? (lang === 'ko' ? '✓ RFQ 패키지 다운로드 완료' : '✓ RFQ bundle downloaded')
            : `📦 ${t(lang, 'RFQ 패키지 다운로드 (.zip)', 'Download RFQ Bundle (.zip)')}`}
        </button>
        <button
          disabled={quoteStatus === 'sending' || quoteStatus === 'sent'}
          onClick={async () => {
            if (quoteStatus === 'sent') return;
            setQuoteStatus('sending');
            try {
              const { submitQuoteToNexyFlow } = await import('./nexyflowQuoteAPI');
              const q = await submitQuoteToNexyFlow({
                partName: partName || t(lang, '무제 부품', 'Unnamed Part'),
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
            ? (lang === 'ko' ? '전송 중…' : 'Sending…')
            : quoteStatus === 'sent'
            ? (lang === 'ko' ? `✓ 전송됨 (${quoteId})` : `✓ Sent (${quoteId})`)
            : quoteStatus === 'error'
            ? (lang === 'ko' ? '전송 실패 — 재시도' : 'Send Failed — Retry')
            : t(lang, '정식 견적 요청 → NexyFlow', 'Request Formal Quote → NexyFlow')}
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
