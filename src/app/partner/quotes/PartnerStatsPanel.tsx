'use client';

/**
 * PartnerStatsPanel — partner monthly performance stats modal.
 * Computes accept-rate / avg amount / response speed / process distribution
 * from the passed `quotes` array.
 */
import { usePartnerLang } from '../_lib/partnerLang';
import { quotePanelsDict, type QuotePanelsDict } from '../_lib/dicts/quotePanels';

interface Quote {
  id: string;
  projectName: string;
  estimatedAmount: number;
  status: string;
  createdAt: string;
  dfmProcess?: string | null;
  partnerResponse?: {
    estimatedAmount: number;
    estimatedDays: number | null;
    note: string;
    respondedAt: string;
  };
}

interface Props {
  quotes: Quote[];
  company?: string;
  onClose: () => void;
}

const C = {
  bg: '#0d1117', surface: '#161b22', card: '#21262d', border: '#30363d',
  text: '#e6edf3', textDim: '#8b949e', textMuted: '#6e7681',
  accent: '#388bfd', green: '#3fb950', yellow: '#d29922', red: '#f85149',
  purple: '#8b5cf6', teal: '#2dd4bf', orange: '#f97316',
};

const LOCALE_FOR_LANG: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
};
function fmtMoney(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(LOCALE_FOR_LANG[lang] ?? 'en-US', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n);
  } catch { return `₩${n.toLocaleString()}`; }
}

function StatBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: C.card, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}`, flex: 1, minWidth: 110 }}>
      <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ margin: '0 0 2px', fontSize: 22, fontWeight: 900, color: color ?? C.text }}>{value}</p>
      {sub && <p style={{ margin: 0, fontSize: 10, color: C.textMuted }}>{sub}</p>}
    </div>
  );
}

function ProcessBar({ process, count, max, uncategorisedLabel }: { process: string; count: number; max: number; uncategorisedLabel: string }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 11, color: C.textDim, minWidth: 100, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{process || uncategorisedLabel}</span>
      <div style={{ flex: 1, height: 8, background: C.border, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: C.accent, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: C.accent, minWidth: 20, textAlign: 'right' }}>{count}</span>
    </div>
  );
}

function MonthRow({ month, total, accepted, avgAmount: _avgAmount, countLabel }: { month: string; total: number; accepted: number; avgAmount: number; countLabel: (n: number) => string }) {
  const rate = total > 0 ? Math.round((accepted / total) * 100) : 0;
  const color = rate >= 60 ? C.green : rate >= 30 ? C.yellow : C.red;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 60px 60px', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 11, color: C.textDim }}>{month}</span>
      <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${rate}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, textAlign: 'right' }}>{rate}%</span>
      <span style={{ fontSize: 10, color: C.textMuted, textAlign: 'right' }}>{countLabel(total)}</span>
    </div>
  );
}

function getMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function PartnerStatsPanel({ quotes, company, onClose }: Props) {
  const lang = usePartnerLang();
  const t = quotePanelsDict(lang);
  const total = quotes.length;
  const responded = quotes.filter(q => ['responded', 'accepted'].includes(q.status)).length;
  const accepted  = quotes.filter(q => q.status === 'accepted').length;
  const rejected  = quotes.filter(q => q.status === 'rejected').length;

  const acceptRate = total > 0 ? Math.round((accepted / total) * 100) : 0;
  const responseRate = total > 0 ? Math.round((responded / total) * 100) : 0;
  const acceptRateColor = acceptRate >= 50 ? C.green : acceptRate >= 25 ? C.yellow : C.red;

  const acceptedQuotes = quotes.filter(q => q.status === 'accepted' && q.partnerResponse?.estimatedAmount);
  const avgAmount = acceptedQuotes.length > 0
    ? Math.round(acceptedQuotes.reduce((s, q) => s + (q.partnerResponse?.estimatedAmount ?? 0), 0) / acceptedQuotes.length)
    : 0;

  const totalRevenue = acceptedQuotes.reduce((s, q) => s + (q.partnerResponse?.estimatedAmount ?? 0), 0);

  // process distribution (data prefix kept KR canonical so existing
  // partner records remain comparable across locales)
  const processCounts: Record<string, number> = {};
  for (const q of quotes) {
    const p = q.dfmProcess ?? t.psProcessUncategorised;
    processCounts[p] = (processCounts[p] ?? 0) + 1;
  }
  const processEntries = Object.entries(processCounts).sort((a, b) => b[1] - a[1]);
  const maxProcess = processEntries[0]?.[1] ?? 1;

  // 월별 통계 (최근 6개월)
  const monthStats: Record<string, { total: number; accepted: number; amounts: number[] }> = {};
  for (const q of quotes) {
    const m = getMonth(q.createdAt);
    if (!monthStats[m]) monthStats[m] = { total: 0, accepted: 0, amounts: [] };
    monthStats[m].total++;
    if (q.status === 'accepted') {
      monthStats[m].accepted++;
      if (q.partnerResponse?.estimatedAmount) monthStats[m].amounts.push(q.partnerResponse.estimatedAmount);
    }
  }
  const sortedMonths = Object.entries(monthStats)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 6)
    .reverse();

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{ background: C.surface, borderRadius: 16, border: `1px solid ${C.border}`, width: '100%', maxWidth: 580, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg, #1a2030, #1a301e)' }}>
          <span style={{ fontSize: 18 }} aria-hidden="true">📈</span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: C.text }}>{t.psHeader}</p>
            <p style={{ margin: 0, fontSize: 11, color: C.textMuted }}>{company ?? t.psFallbackCompany} · {t.psPeriodAll}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.textMuted, fontSize: 18, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Key metrics */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <StatBox label={t.psMetricTotalRfq} value={String(total)} sub={t.psSubCountSuffix} />
            <StatBox label={t.psMetricAccept} value={`${acceptRate}%`} sub={t.psSubAcceptRatio(accepted, total)} color={acceptRateColor} />
            <StatBox label={t.psMetricResponse} value={`${responseRate}%`} sub={t.psSubAcceptRatio(responded, total)} color={C.accent} />
            <StatBox label={t.psMetricAvgAccept} value={avgAmount > 0 ? fmtMoney(avgAmount, lang) : t.psUnitDash} sub={t.psSubAcceptBase} color={C.teal} />
          </div>

          {/* Outcome distribution */}
          <div style={{ background: C.card, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>{t.psDistributionTitle}</p>
            <div style={{ display: 'flex', gap: 4, height: 18, borderRadius: 4, overflow: 'hidden' }}>
              {accepted > 0  && <div style={{ flex: accepted,  background: C.green  }} title={`${t.psLegendAccepted} ${t.psLegendCount(accepted)}`} />}
              {responded > accepted && <div style={{ flex: responded - accepted, background: C.accent }} title={`${t.psLegendInProgress} ${t.psLegendCount(responded - accepted)}`} />}
              {rejected > 0  && <div style={{ flex: rejected,  background: C.red    }} title={`${t.psLegendRejected} ${t.psLegendCount(rejected)}`} />}
              {total - responded - rejected > 0 && <div style={{ flex: total - responded - rejected, background: C.border }} title={`${t.psLegendPending} ${t.psLegendCount(total - responded - rejected)}`} />}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              {[
                { label: t.psLegendAccepted, color: C.green,  n: accepted },
                { label: t.psLegendRejected, color: C.red,    n: rejected },
                { label: t.psLegendPending,  color: C.border, n: total - responded - rejected },
              ].map(({ label, color, n }) => (
                <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.textMuted }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                  {label} {t.psLegendCount(n)}
                </span>
              ))}
            </div>
          </div>

          {/* Cumulative revenue */}
          {totalRevenue > 0 && (
            <div style={{ background: `${C.green}12`, border: `1px solid ${C.green}30`, borderRadius: 10, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ margin: 0, fontSize: 12, color: C.green, fontWeight: 700 }}>{t.psCumulativeTitle}</p>
              <p style={{ margin: 0, fontSize: 20, fontWeight: 900, color: C.green }}>{fmtMoney(totalRevenue, lang)}</p>
            </div>
          )}

          {/* Process distribution */}
          {processEntries.length > 0 && (
            <div style={{ background: C.card, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>{t.psProcessTitle}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {processEntries.slice(0, 6).map(([p, cnt]) => (
                  <ProcessBar key={p} process={p} count={cnt} max={maxProcess} uncategorisedLabel={t.psProcessUncategorised} />
                ))}
              </div>
            </div>
          )}

          {/* Monthly trend */}
          {sortedMonths.length > 1 && (
            <div style={{ background: C.card, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>{t.psMonthlyTitle}</p>
              <div>
                {sortedMonths.map(([m, stat]) => (
                  <MonthRow
                    key={m}
                    month={m}
                    total={stat.total}
                    accepted={stat.accepted}
                    avgAmount={stat.amounts.length > 0 ? Math.round(stat.amounts.reduce((a, b) => a + b, 0) / stat.amounts.length) : 0}
                    countLabel={t.psLegendCount}
                  />
                ))}
              </div>
            </div>
          )}

          {total === 0 && (
            <p style={{ color: C.textMuted, fontSize: 12, textAlign: 'center', padding: '32px 0' }}>{t.psEmpty}</p>
          )}
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 18px' }}>
          <button
            onClick={onClose}
            style={{ width: '100%', padding: '10px', borderRadius: 8, border: `1px solid ${C.border}`, background: 'transparent', color: C.textDim, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            {t.psClose}
          </button>
        </div>
      </div>
    </div>
  );
}
