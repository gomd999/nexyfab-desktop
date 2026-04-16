'use client';

// ─── Manufacturing Ready Card ─────────────────────────────────────────────────
// Shown automatically after Extrude / shape generation.
// Summarises DFM feasibility, best cost estimate, and mass — all in one glance.

import { useEffect, useMemo, useState } from 'react';
import type { ShapeResult } from '../shapes';
import type { DFMResult } from './dfmAnalysis';
import {
  estimateCosts,
  type GeometryMetrics,
  PROCESS_ICONS,
  getProcessName,
} from '../estimation/CostEstimator';
import { computeMassProperties } from './massProperties';
import { getMaterialPreset } from '../materials';
import { KRW_PER_USD } from '@/lib/currency';

// ─── Props ────────────────────────────────────────────────────────────────────

interface ManufacturingReadyCardProps {
  result: ShapeResult;
  materialId?: string;
  quantity?: number;
  lang?: string;
  dfmResults?: DFMResult[] | null;
  onClose: () => void;
  onDetailAnalysis: () => void;
  onRequestQuote: () => void;
  onOptimize: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (usd: number) => `₩${Math.round(usd * KRW_PER_USD).toLocaleString('ko-KR')}`;

// ─── Component ────────────────────────────────────────────────────────────────

export default function ManufacturingReadyCard({
  result,
  materialId = 'aluminum',
  quantity = 1,
  lang = 'ko',
  dfmResults,
  onClose,
  onDetailAnalysis,
  onRequestQuote,
  onOptimize,
}: ManufacturingReadyCardProps) {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Slide-in on mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  // ── Mass properties ────────────────────────────────────────────────────────
  const massProps = useMemo(() => {
    try {
      const mat = getMaterialPreset(materialId);
      const density = mat?.density ?? 2.7;
      return computeMassProperties(result.geometry, density);
    } catch {
      return null;
    }
  }, [result.geometry, materialId]);

  // ── Cost estimates ─────────────────────────────────────────────────────────
  const costEstimates = useMemo(() => {
    const metrics: GeometryMetrics = {
      volume_cm3: result.volume_cm3,
      surfaceArea_cm2: result.surface_area_cm2,
      boundingBox: result.bbox,
      complexity: Math.min(
        1,
        ((result.geometry.attributes.position?.count ?? 1_000) / 10_000),
      ),
    };
    return estimateCosts(metrics, materialId, [quantity]);
  }, [result, materialId, quantity]);

  // cheapest process for the given quantity
  const bestEstimate = costEstimates.length > 0
    ? costEstimates.reduce((a, b) => (a.unitCost < b.unitCost ? a : b))
    : null;

  // ── DFM summary ────────────────────────────────────────────────────────────
  const dfmOverall   = dfmResults && dfmResults.length > 0 ? dfmResults[0] : null;
  const totalIssues  = dfmResults?.reduce((s, r) => s + r.issues.length, 0) ?? 0;
  const errorCount   = dfmResults?.reduce(
    (s, r) => s + r.issues.filter(i => i.severity === 'error').length, 0,
  ) ?? 0;
  const score        = dfmOverall?.score ?? null;

  // ── Status colour ──────────────────────────────────────────────────────────
  let statusColor  = '#3fb950';
  let statusBg     = 'rgba(63,185,80,0.10)';
  let statusBorder = 'rgba(63,185,80,0.25)';
  let statusLabel  = lang === 'ko' ? '✅ 제조 가능' : '✅ Ready to Manufacture';

  if (errorCount > 0 || (score !== null && score < 50)) {
    statusColor  = '#f85149';
    statusBg     = 'rgba(248,81,73,0.10)';
    statusBorder = 'rgba(248,81,73,0.25)';
    statusLabel  = lang === 'ko' ? '⚠️ 제조 주의 필요' : '⚠️ Issues Detected';
  } else if (totalIssues > 0 || (score !== null && score < 80)) {
    statusColor  = '#d29922';
    statusBg     = 'rgba(210,153,34,0.10)';
    statusBorder = 'rgba(210,153,34,0.25)';
    statusLabel  = lang === 'ko' ? '🟡 경고 있음' : '🟡 Warnings';
  }

  // ── close helper (animate out first) ──────────────────────────────────────
  const dismiss = (cb?: () => void) => {
    setVisible(false);
    setTimeout(() => { onClose(); cb?.(); }, 280);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 10,
        right: 10,
        zIndex: 50,
        width: 300,
        transition: 'transform 0.32s cubic-bezier(0.34,1.4,0.64,1), opacity 0.28s',
        transform: visible ? 'translateY(0)' : 'translateY(120%)',
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
      }}
    >
      <div data-tour="manufacturing-card" style={{
        background: '#161b22',
        border: `1px solid ${statusBorder}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
      }}>

        {/* ── Header ── */}
        <div
          onClick={() => setExpanded(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px',
            background: statusBg,
            borderBottom: expanded ? '1px solid #30363d' : 'none',
            cursor: 'pointer',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: statusColor, flex: 1 }}>
            {statusLabel}
          </span>
          {score !== null && (
            <span style={{
              background: '#21262d', borderRadius: 4, padding: '1px 6px',
              fontSize: 9, color: '#8b949e', fontFamily: 'monospace', fontWeight: 700,
            }}>
              {score}/100
            </span>
          )}
          <span style={{ fontSize: 10, color: '#6e7681', transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>▾</span>
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(); }}
            style={{
              background: 'none', border: 'none', color: '#6e7681',
              fontSize: 13, cursor: 'pointer', padding: '1px 3px', lineHeight: 1,
            }}
          >✕</button>
        </div>

        {/* ── Metrics row (expandable) ── */}
        {expanded && <div style={{ display: 'flex' }}>

          {/* Cost */}
          <div style={{ flex: 1, padding: '10px 12px', borderRight: '1px solid #30363d' }}>
            <div style={{ fontSize: 9, color: '#6e7681', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {lang === 'ko' ? '예상 비용' : 'Est. Cost'}
            </div>
            {bestEstimate ? (
              <>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#e6edf3', lineHeight: 1.2 }}>
                  {fmt(bestEstimate.unitCost)}
                </div>
                <div style={{ fontSize: 9, color: '#6e7681', marginTop: 2 }}>
                  {PROCESS_ICONS[bestEstimate.process]} {getProcessName(bestEstimate.process, lang)}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: '#484f58' }}>—</div>
            )}
          </div>

          {/* Mass */}
          <div style={{ flex: 1, padding: '10px 12px', borderRight: '1px solid #30363d' }}>
            <div style={{ fontSize: 9, color: '#6e7681', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {lang === 'ko' ? '무게' : 'Weight'}
            </div>
            {massProps ? (
              <>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#e6edf3', lineHeight: 1.2 }}>
                  {massProps.mass_g < 1_000
                    ? `${massProps.mass_g.toFixed(1)}g`
                    : `${(massProps.mass_g / 1_000).toFixed(2)}kg`}
                </div>
                <div style={{ fontSize: 9, color: '#6e7681', marginTop: 2 }}>
                  {result.volume_cm3.toFixed(1)} cm³
                </div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: '#484f58' }}>—</div>
            )}
          </div>

          {/* DFM */}
          <div style={{ flex: 1, padding: '10px 12px' }}>
            <div style={{ fontSize: 9, color: '#6e7681', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {lang === 'ko' ? 'DFM 이슈' : 'DFM Issues'}
            </div>
            {dfmResults != null ? (
              <>
                <div style={{
                  fontSize: 17, fontWeight: 700, lineHeight: 1.2,
                  color: errorCount > 0 ? '#f85149' : totalIssues > 0 ? '#d29922' : '#3fb950',
                }}>
                  {totalIssues}
                </div>
                <div style={{ fontSize: 9, color: '#6e7681', marginTop: 2 }}>
                  {errorCount > 0
                    ? `${lang === 'ko' ? '오류' : 'err'} ${errorCount}`
                    : lang === 'ko' ? '건' : 'items'}
                </div>
              </>
            ) : (
              <div style={{ fontSize: 9, color: '#484f58' }}>
                {lang === 'ko' ? '분석 중…' : 'Analyzing…'}
              </div>
            )}
          </div>
        </div>}

        {/* ── Expanded: DFM issues + Action buttons + Cost ── */}
        {expanded && (<>
          {dfmResults && totalIssues > 0 && (
            <div style={{
              padding: '5px 12px 4px',
              borderTop: '1px solid #21262d',
              borderBottom: '1px solid #30363d',
            }}>
              {dfmResults.flatMap(r => r.issues).slice(0, 2).map((issue, i) => (
                <div key={i} style={{ display: 'flex', gap: 5, marginBottom: 2 }}>
                  <span style={{ fontSize: 9, flexShrink: 0, lineHeight: '16px', color: issue.severity === 'error' ? '#f85149' : '#d29922' }}>
                    {issue.severity === 'error' ? '●' : '▲'}
                  </span>
                  <span style={{ fontSize: 9, color: '#8b949e', lineHeight: 1.4 }}>{issue.description}</span>
                </div>
              ))}
              {totalIssues > 2 && (
                <div style={{ fontSize: 9, color: '#484f58', marginTop: 1 }}>
                  +{totalIssues - 2} {lang === 'ko' ? '건 더' : 'more'}
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 5, padding: '7px 8px' }}>
            <button
              onClick={() => dismiss(onDetailAnalysis)}
              style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', fontSize: 10, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; }}
            >📊 {lang === 'ko' ? '상세 분석' : 'Analysis'}</button>
            <button
              onClick={() => dismiss(onOptimize)}
              style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: '#21262d', border: '1px solid #30363d', color: '#a371f7', fontSize: 10, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#30363d'; }}
              onMouseLeave={e => { e.currentTarget.style.background = '#21262d'; }}
            >⚡ {lang === 'ko' ? '경량화' : 'Optimize'}</button>
            <button
              onClick={() => dismiss(onRequestQuote)}
              style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: 'linear-gradient(135deg, #388bfd 0%, #8b5cf6 100%)', border: 'none', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(56,139,253,0.3)', transition: 'opacity 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
            >💬 {lang === 'ko' ? '견적' : 'Quote'}</button>
          </div>

          <CostBreakdown estimates={costEstimates} lang={lang} />
        </>)}
      </div>
    </div>
  );
}

// ─── Cost Breakdown (expandable) ─────────────────────────────────────────────

function CostBreakdown({
  estimates,
  lang,
}: {
  estimates: ReturnType<typeof estimateCosts>;
  lang: string;
}) {
  const [open, setOpen] = useState(false);
  if (estimates.length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid #21262d' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '6px 12px', background: 'none', border: 'none',
          color: '#6e7681', fontSize: 10, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        <span>{lang === 'ko' ? '공정별 비용 비교' : 'Process Cost Comparison'}</span>
        <span style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'none' }}>▾</span>
      </button>

      {open && (
        <div style={{ padding: '0 10px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {estimates
            .slice()
            .sort((a, b) => a.unitCost - b.unitCost)
            .map(est => (
              <div key={`${est.process}-${est.quantity}`} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 8px', borderRadius: 6,
                background: '#0d1117', border: '1px solid #21262d',
              }}>
                <span style={{ fontSize: 12 }}>{PROCESS_ICONS[est.process]}</span>
                <span style={{ flex: 1, fontSize: 10, color: '#8b949e' }}>
                  {getProcessName(est.process, lang)}
                </span>
                <span style={{ fontSize: 10, color: '#e6edf3', fontWeight: 700, fontFamily: 'monospace' }}>
                  {fmt(est.unitCost)}
                </span>
                <span style={{ fontSize: 9, color: '#484f58' }}>
                  {est.leadTime}
                </span>
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 4,
                  background: est.confidence === 'high' ? '#1a2e1a' : est.confidence === 'medium' ? '#2d2208' : '#2d1b1b',
                  color: est.confidence === 'high' ? '#3fb950' : est.confidence === 'medium' ? '#d29922' : '#f85149',
                }}>
                  {est.confidence}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
