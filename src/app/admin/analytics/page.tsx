'use client';
import { AdminText, useAdminI18n } from '../AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

import { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { formatDateTime } from '@/lib/formatDate';

// ── Types ────────────────────────────────────────────────────────────────────

interface AnalyticsData {
  summary: Record<string, number>;
  monthlyChart: { month: string; nexyfab: number; nexyflow: number; nexywise: number; total: number }[];
  byCountry: { country: string; revenue_krw: number; count: number }[];
  funnelChart: { attempt: number; succeeded: number; failed: number; pending: number; total: number; successPct: number | null }[];
  topUsage: { user_id: string; email: string; name: string; product: string; total: number }[];
  planDist: { plan: string; product: string; count: number }[];
  recentFailures: {
    id: string; invoice_id: string; email: string;
    attempt_number: number; error_message: string | null;
    attempted_at: number; next_retry_at: number | null;
  }[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

function fmtKRW(n: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'KRW',
    maximumFractionDigits: 0,
  }).format(n);
}

// CSS bar chart component
function BarChart({ data, maxVal, colorFn, labelFn, valueFn }: {
  data: unknown[];
  maxVal: number;
  colorFn: (item: unknown) => string;
  labelFn: (item: unknown) => string;
  valueFn: (item: unknown) => number;
  locale: string;
}) {
  const { locale } = useAdminI18n();
  if (!data.length) return <p className="text-sm text-gray-400 text-center py-6"><AdminText ko="데이터 없음" en="No data" /></p>;
  return (
    <div className="space-y-2">
      {data.map((item, i) => {
        const pct = maxVal > 0 ? Math.max(2, Math.round((valueFn(item) / maxVal) * 100)) : 0;
        return (
          <div key={i} className="flex items-center gap-3">
            <p className="text-xs text-gray-500 w-20 shrink-0 text-right truncate">{labelFn(item)}</p>
            <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
              <div
                className={`h-full rounded-full flex items-center justify-end pr-2 transition-all ${colorFn(item)}`}
                style={{ width: `${pct}%` }}>
                <span className="text-xs font-bold text-white drop-shadow">{fmtKRW(valueFn(item), locale)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PLAN_COLOR_BG: Record<string, string> = {
  free: 'bg-gray-400', pro: 'bg-blue-500', team: 'bg-purple-500', enterprise: 'bg-amber-500',
};
const PRODUCT_COLOR_BG: Record<string, string> = {
  nexyfab: 'bg-blue-500', nexyflow: 'bg-purple-500', nexywise: 'bg-teal-500',
};

// ── CSV Export ───────────────────────────────────────────────────────────────

function exportCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(','))
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

function getPreset(preset: 'month' | 'lastMonth' | 'quarter'): { start: string; end: string } {
  const now = new Date();
  if (preset === 'month') {
    return {
      start: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: toDateStr(now),
    };
  }
  if (preset === 'lastMonth') {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last  = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: toDateStr(first), end: toDateStr(last) };
  }
  // quarter
  const q = Math.floor(now.getMonth() / 3);
  return {
    start: toDateStr(new Date(now.getFullYear(), q * 3, 1)),
    end: toDateStr(now),
  };
}

// ── Page ─────────────────────────────────────────────────────────────────────

interface MfgKpi {
  funnel: {
    rfqTotal: number; rfqAssigned: number; rfqMtd: number; rfqMtdAssigned: number;
    quoteTotal: number; quoteMtd: number; quoteAccepted: number;
    contractTotal: number; contractRevenue: number;
  };
  rates: { assignRate: number; quoteRate: number; contractRate: number };
  avgResponseHours: number | null;
  topFactories: { factory_id: string; factory_name: string; cnt: number; quoted: number }[];
}

export default function AdminAnalyticsPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const [authed, setAuthed]   = useState(false);
  const [pw, setPw]           = useState('');
  const [pwError, setPwError] = useState(false);
  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [mfg, setMfg]         = useState<MfgKpi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // Date range state — default: last 30 days
  const defaultEnd   = toDateStr(new Date());
  const defaultStart = toDateStr(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate,   setEndDate]   = useState(defaultEnd);
  // pending inputs (committed on 적용)
  const [pendingStart, setPendingStart] = useState(defaultStart);
  const [pendingEnd,   setPendingEnd]   = useState(defaultEnd);

  async function login() {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) { setAuthed(true); setPwError(false); }
    else setPwError(true);
  }

  const load = useCallback(async (start: string, end: string) => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ startDate: start, endDate: end });
      const [saasRes, mfgRes] = await Promise.all([
        fetch(`/api/admin/analytics?${params}`),
        fetch(`/api/admin/manufacturing-kpi?${params}`),
      ]);
      if (!saasRes.ok) { setError(L('데이터를 불러오지 못했습니다.', 'Could not load analytics data.')); return; }
      setData(await saasRes.json() as AnalyticsData);
      if (mfgRes.ok) setMfg(await mfgRes.json() as MfgKpi);
    } finally { setLoading(false); }
  }, [L]);

  useEffect(() => { if (authed) void load(startDate, endDate); }, [authed, load, startDate, endDate]);

  function applyFilter() {
    setStartDate(pendingStart);
    setEndDate(pendingEnd);
  }

  function applyPreset(preset: 'month' | 'lastMonth' | 'quarter') {
    const { start, end } = getPreset(preset);
    setPendingStart(start);
    setPendingEnd(end);
    setStartDate(start);
    setEndDate(end);
  }

  function handleExportCsv() {
    if (!data) return;
    const monthlyRows = data.monthlyChart.map(m => ({
      [L('월', 'Month')]: m.month,
      NexyFab: m.nexyfab.toLocaleString(locale),
      NexyFlow: m.nexyflow.toLocaleString(locale),
      NexyWise: m.nexywise.toLocaleString(locale),
      [L('합계', 'Total')]: m.total.toLocaleString(locale),
    }));
    const planRows = data.planDist.map(p => ({
      [L('제품', 'Product')]: p.product,
      [L('플랜', 'Plan')]: p.plan,
      [L('구독 수', 'Subscriptions')]: p.count.toLocaleString(locale),
    }));
    const failureRows = data.recentFailures.map(f => ({
      ID: f.id,
      [L('인보이스', 'Invoice')]: f.invoice_id,
      [L('이메일', 'Email')]: f.email,
      [L('시도 횟수', 'Attempts')]: f.attempt_number.toLocaleString(locale),
      [L('오류', 'Error')]: f.error_message ?? '',
      [L('시도 일시', 'Attempted at')]: formatDateTime(f.attempted_at, locale),
    }));
    // Export all three sheets as one CSV with section headers
    const allRows: Record<string, unknown>[] = [
      { [L('구분', 'Section')]: `=== ${L('월별 매출', 'Monthly revenue')} ===` },
      ...monthlyRows,
      { [L('구분', 'Section')]: '' },
      { [L('구분', 'Section')]: `=== ${L('플랜 분포', 'Plan distribution')} ===` },
      ...planRows,
      { [L('구분', 'Section')]: '' },
      { [L('구분', 'Section')]: `=== ${L('최근 결제 실패', 'Recent payment failures')} ===` },
      ...failureRows,
    ];
    exportCsv(allRows, `nexyfab-analytics-${startDate}-${endDate}.csv`);
  }

  // ── Login gate ──────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">📊</div>
            <h1 className="text-xl font-black text-gray-900"><AdminText ko="매출 분석" en="Revenue analytics" /></h1>
            <p className="text-xs text-gray-400 mt-1"><AdminText ko="관리자 인증 필요" en="Administrator authentication required" /></p>
          </div>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void login()}
            placeholder={L('관리자 비밀번호', 'Administrator password')}
            className={`w-full px-4 py-2.5 rounded-xl border text-sm mb-3 outline-none ${pwError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-blue-400'}`} />
          <button onClick={() => void login()}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition">
            <AdminText ko="로그인" en="Log in" />
          </button>
          {pwError && <p className="text-red-500 text-xs text-center mt-2"><AdminText ko="비밀번호가 틀렸습니다" en="Incorrect password" /></p>}
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-gray-400"><AdminText ko="분석 데이터 로딩 중..." en="Loading analytics data..." /></p>
        </div>
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500 text-center py-20">{error}</p>;
  }

  const maxMonthlyRevenue = Math.max(...data.monthlyChart.map(m => m.total), 1);
  const maxCountryRevenue = Math.max(...data.byCountry.map(c => c.revenue_krw), 1);

  // ── Main UI ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-black text-gray-900"><AdminText ko="매출 분석" en="Revenue analytics" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><AdminText ko="전체 결제 및 구독 현황" en="All payment and subscription status" /></p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button onClick={handleExportCsv}
            className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50 flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
              <path d="M8 1v9M4 7l4 4 4-4M2 12v2a1 1 0 001 1h10a1 1 0 001-1v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <AdminText ko="CSV 내보내기" en="Export CSV" />
          </button>
          <button onClick={() => void load(startDate, endDate)}
            className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            <AdminText ko="새로고침" en="Refresh" />
          </button>
        </div>
      </div>

      {/* Date Range Filter */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-semibold"><AdminText ko="시작일" en="Start date" /></label>
            <input type="date" value={pendingStart} onChange={e => setPendingStart(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-400 font-semibold"><AdminText ko="종료일" en="End date" /></label>
            <input type="date" value={pendingEnd} onChange={e => setPendingEnd(e.target.value)}
              className="px-3 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-400" />
          </div>
          <button onClick={applyFilter}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition">
            <AdminText ko="적용" en="Apply" />
          </button>
          <div className="flex gap-2 ml-auto flex-wrap">
            {([
              { label: L('이번 달', 'This month'),    preset: 'month'     },
              { label: L('지난 달', 'Last month'),    preset: 'lastMonth' },
              { label: L('이번 분기', 'This quarter'),  preset: 'quarter'   },
            ] as { label: string; preset: 'month' | 'lastMonth' | 'quarter' }[]).map(p => (
              <button key={p.preset} onClick={() => applyPreset(p.preset)}
                className="px-3 py-2 text-xs font-semibold rounded-xl border border-gray-200 bg-gray-50 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-600 transition">
                {p.label}
              </button>
            ))}
          </div>
        </div>
        {(startDate !== defaultStart || endDate !== defaultEnd) && (
          <p className="text-xs text-blue-600 mt-2 font-medium">
            <>{L('필터 적용 중:', 'Filter applied:')} {startDate} ~ {endDate}</>
          </p>
        )}
      </div>

      {/* KPI Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: L('활성 구독', 'Active subscriptions'),    value: (data.summary.active_subs ?? 0).toLocaleString(locale),   icon: '✅', color: 'text-green-700' },
          { label: L('이번 달 매출', 'Monthly revenue'), value: fmtKRW(data.summary.revenue_krw_mtd ?? 0, locale),  icon: '💰', color: 'text-blue-700'  },
          { label: L('결제 건수(MTD)', 'Payments (MTD)'), value: (data.summary.paid_invoices_mtd ?? 0).toLocaleString(locale), icon: '🧾', color: 'text-purple-700' },
          { label: L('실패(MTD)', 'Failures (MTD)'),    value: (data.summary.failed_mtd ?? 0).toLocaleString(locale),    icon: '❌', color: 'text-red-600'   },
          { label: L('재시도 대기', 'Retry queue'),  value: (data.summary.retry_queue ?? 0).toLocaleString(locale),   icon: '🔄', color: 'text-amber-600' },
          { label: L('전체 유저', 'Total users'),    value: (data.summary.total_users ?? 0).toLocaleString(locale),   icon: '👤', color: 'text-gray-700'  },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400">{k.icon} {k.label}</p>
            <p className={`text-xl font-black mt-1 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Monthly Revenue */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-bold text-gray-700 mb-4"><AdminText ko="📅 월별 매출 (최근 12개월)" en="📅 Monthly revenue (last 12 months)" /></p>
        {data.monthlyChart.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8"><AdminText ko="결제 데이터 없음" en="No payment data" /></p>
        ) : (
          <div className="space-y-2">
            {data.monthlyChart.map(m => (
              <div key={m.month} className="flex items-center gap-3">
                <p className="text-xs text-gray-500 w-16 shrink-0 text-right">{new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short' }).format(new Date(`${m.month}-01T00:00:00`))}</p>
                <div className="flex-1 flex gap-0.5 h-7 rounded-full overflow-hidden bg-gray-100">
                  {([ ['nexyfab', m.nexyfab, 'bg-blue-400'], ['nexyflow', m.nexyflow, 'bg-purple-400'], ['nexywise', m.nexywise, 'bg-teal-400'] ] as [string, number, string][])
                    .filter(([, v]) => v > 0)
                    .map(([key, v, cls]) => (
                      <div key={key} className={`${cls} h-full`}
                        style={{ width: `${Math.max(2, Math.round(v / maxMonthlyRevenue * 100))}%` }}
                        title={`${key}: ${fmtKRW(v, locale)}`} />
                    ))}
                </div>
                <p className="text-xs font-bold text-gray-700 w-16 shrink-0">{fmtKRW(m.total, locale)}</p>
              </div>
            ))}
            <div className="flex gap-4 mt-2 pt-2 border-t border-gray-100">
              {[['NexyFab','bg-blue-400'],['NexyFlow','bg-purple-400'],['NexyWise','bg-teal-400']].map(([name,cls]) => (
                <div key={name} className="flex items-center gap-1.5">
                  <div className={`w-3 h-3 rounded-full ${cls}`} />
                  <span className="text-xs text-gray-500">{name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Country + Plan distribution (side by side) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Country breakdown */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-700 mb-4"><AdminText ko="🌍 국가별 매출 (상위 10개)" en="🌍 Revenue by country (Top 10)" /></p>
          <BarChart
            data={data.byCountry.slice(0, 10)}
            maxVal={maxCountryRevenue}
            colorFn={() => 'bg-blue-500'}
            labelFn={(item) => (item as { country: string }).country}
            valueFn={(item) => (item as { revenue_krw: number }).revenue_krw}
            locale={locale}
          />
        </div>

        {/* Plan distribution */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-700 mb-4"><AdminText ko="📦 플랜별 구독 분포 (활성)" en="📦 Active subscriptions by plan" /></p>
          {data.planDist.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8"><AdminText ko="데이터 없음" en="No data" /></p>
          ) : (
            <div className="space-y-2">
              {data.planDist.map(r => {
                const total = data.planDist.filter(d => d.product === r.product).reduce((s, d) => s + d.count, 0);
                const pct   = total > 0 ? Math.round(r.count / total * 100) : 0;
                return (
                  <div key={`${r.product}-${r.plan}`} className="flex items-center gap-3">
                    <p className="text-xs text-gray-500 w-24 shrink-0 capitalize">{r.product} / {r.plan}</p>
                    <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${PLAN_COLOR_BG[r.plan] ?? 'bg-gray-400'}`}
                        style={{ width: `${Math.max(4, pct)}%` }} />
                    </div>
                    <p className="text-xs font-bold text-gray-700 w-8 text-right">{r.count.toLocaleString(locale)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Retry funnel */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-bold text-gray-700 mb-4"><AdminText ko="🔄 결제 재시도 퍼널" en="🔄 Payment retry funnel" /></p>
        {data.funnelChart.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6"><AdminText ko="결제 시도 데이터 없음" en="No payment attempt data" /></p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-3 py-2 text-left"><AdminText ko="시도 #" en="Attempt #" /></th>
                  <th className="px-3 py-2 text-right"><AdminText ko="전체" en="All" /></th>
                  <th className="px-3 py-2 text-right text-green-600"><AdminText ko="성공" en="Success" /></th>
                  <th className="px-3 py-2 text-right text-red-500"><AdminText ko="실패" en="Failed" /></th>
                  <th className="px-3 py-2 text-right"><AdminText ko="성공률" en="Success rate" /></th>
                  <th className="px-3 py-2 text-left"><AdminText ko="비율" en="Ratio" /></th>
                </tr>
              </thead>
              <tbody>
                {data.funnelChart.map(row => (
                  <tr key={row.attempt} className="border-b border-gray-50">
                    <td className="px-3 py-2.5 font-medium">
                      {row.attempt === 1 ? <AdminText ko="최초 시도" en="Initial attempt" /> : <><AdminText ko="재시도 #" en="Retry #" />{row.attempt - 1}</>}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{row.total.toLocaleString(locale)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-green-600">{row.succeeded.toLocaleString(locale)}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-red-500">{row.failed.toLocaleString(locale)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {row.successPct != null ? (
                        <span className={`font-bold ${row.successPct >= 80 ? 'text-green-600' : row.successPct >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                          {row.successPct}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-2.5 w-32">
                      {row.total > 0 && (
                        <div className="flex h-4 rounded-full overflow-hidden bg-gray-100">
                          <div className="bg-green-400 h-full" style={{ width: `${Math.round(row.succeeded / row.total * 100)}%` }} />
                          <div className="bg-red-400 h-full" style={{ width: `${Math.round(row.failed / row.total * 100)}%` }} />
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Top usage + Recent failures */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* Top usage */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-700 mb-4"><AdminText ko="⚡ 이번 달 사용량 상위 10개" en="⚡ Top 10 usage this month" /></p>
          {data.topUsage.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8"><AdminText ko="사용 데이터 없음" en="No usage data" /></p>
          ) : (
            <div className="space-y-2">
              {data.topUsage.slice(0, 10).map((u, i) => (
                <div key={`${u.user_id}-${u.product}`} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-gray-400 w-5 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{u.email}</p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${PRODUCT_COLOR_BG[u.product] ?? 'bg-gray-400'} text-white`}>
                      {u.product}
                    </span>
                  </div>
                  <span className="text-sm font-black text-gray-900">{u.total.toLocaleString(locale)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent failures */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-700 mb-4"><AdminText ko="❌ 최근 결제 실패" en="❌ Recent payment failures" /></p>
          {data.recentFailures.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8"><AdminText ko="최근 실패 없음 👍" en="No recent failures 👍" /></p>
          ) : (
            <div className="space-y-3">
              {data.recentFailures.slice(0, 8).map(f => (
                <div key={f.id} className="border-b border-gray-50 pb-3 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-800 truncate">{f.email}</p>
                      <p className="text-xs text-gray-400 font-mono truncate">{f.invoice_id}</p>
                      {f.error_message && (
                        <p className="text-xs text-red-500 truncate mt-0.5">{f.error_message}</p>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="text-xs bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">
                        #{f.attempt_number.toLocaleString(locale)}
                      </span>
                      <p className="text-xs text-gray-400 mt-1">{formatDateTime(f.attempted_at, locale)}</p>
                      {f.next_retry_at && (
                        <p className="text-xs text-amber-500">
                          <AdminText ko="재시도 " en="Retry " />{formatDateTime(f.next_retry_at, locale)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {data.recentFailures.length > 8 && (
                <p className="text-xs text-gray-400 text-center pt-1">
                  <AdminText ko="외 " en="Plus " />{(data.recentFailures.length - 8).toLocaleString(locale)}<AdminText ko="건 — " en=" more — " /><Link href="/admin/billing?status=past_due" prefetch={false} className="text-blue-500 hover:underline"><AdminText ko="청구 관리에서 확인" en="View in billing" /></Link>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 제조업 퍼널 KPI ─────────────────────────────────────────────── */}
      {mfg && (
        <div className="mt-8 space-y-6">
          <h2 className="text-lg font-bold text-gray-900"><AdminText ko="제조업 퍼널 KPI" en="Manufacturing funnel KPI" /></h2>

          {/* 퍼널 카드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: L('총 RFQ', 'Total RFQs'), value: mfg.funnel.rfqTotal.toLocaleString(locale), sub: `${L('이번 달', 'This month')} ${mfg.funnel.rfqMtd.toLocaleString(locale)}${L('건', ' items')}`, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: L('배정률', 'Assignment rate'), value: `${mfg.rates.assignRate}%`, sub: `${mfg.funnel.rfqAssigned.toLocaleString(locale)}${L('건 배정됨', ' assigned')}`, color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: L('견적 전환율', 'Quote conversion rate'), value: `${mfg.rates.quoteRate}%`, sub: `${L('총', 'Total')} ${mfg.funnel.quoteTotal.toLocaleString(locale)}${L('건', ' items')}`, color: 'text-amber-600', bg: 'bg-amber-50' },
              { label: L('계약 전환율', 'Contract conversion rate'), value: `${mfg.rates.contractRate}%`, sub: `${L('총', 'Total')} ${mfg.funnel.contractTotal.toLocaleString(locale)}${L('건', ' items')}`, color: 'text-green-600', bg: 'bg-green-50' },
            ].map((s, i) => (
              <div key={i} className={`${s.bg} rounded-2xl p-5`}>
                <p className="text-xs text-gray-500 font-semibold mb-1">{s.label}</p>
                <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-400 mt-1">{s.sub}</p>
              </div>
            ))}
          </div>

          {/* 퍼널 시각화 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h3 className="text-sm font-bold text-gray-700 mb-4"><AdminText ko="RFQ → 계약 퍼널" en="RFQ → contract funnel" /></h3>
            <div className="flex items-end gap-3">
              {[
                { label: 'RFQ', value: mfg.funnel.rfqTotal, color: 'bg-blue-500' },
                { label: L('배정', 'Assigned'), value: mfg.funnel.rfqAssigned, color: 'bg-purple-500' },
                { label: L('견적', 'Quotes'), value: mfg.funnel.quoteTotal, color: 'bg-amber-500' },
                { label: L('계약', 'Contracts'), value: mfg.funnel.contractTotal, color: 'bg-green-500' },
              ].map((step, i, arr) => {
                const maxVal = arr[0].value || 1;
                const pct = Math.max(8, Math.round((step.value / maxVal) * 100));
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <p className="text-xs font-bold text-gray-700">{step.value}</p>
                    <div className="w-full rounded-t-lg" style={{ height: `${pct * 1.5}px` }}>
                      <div className={`w-full h-full rounded-t-lg ${step.color} opacity-80`} />
                    </div>
                    <p className="text-xs text-gray-500">{step.label}</p>
                  </div>
                );
              })}
            </div>
            {mfg.avgResponseHours != null && (
              <p className="text-xs text-gray-400 mt-4 text-center">
                <AdminText ko="평균 견적 응답 시간: " en="Average quote response time: " /><strong className="text-gray-700">{mfg.avgResponseHours.toLocaleString(locale)}<AdminText ko="시간" en=" hours" /></strong>
              </p>
            )}
          </div>

          {/* 이번 달 KPI */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: L('이번 달 RFQ', 'RFQs this month'), value: mfg.funnel.rfqMtd },
              { label: L('이번 달 배정', 'Assigned this month'), value: mfg.funnel.rfqMtdAssigned },
              { label: L('이번 달 견적', 'Quotes this month'), value: mfg.funnel.quoteMtd },
            ].map((s, i) => (
              <div key={i} className="bg-white rounded-xl border p-4">
                <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                <p className="text-xl font-black text-gray-900">{s.value.toLocaleString(locale)}</p>
              </div>
            ))}
          </div>

          {/* TOP 제조사 */}
          {mfg.topFactories.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-sm font-bold text-gray-700 mb-4"><AdminText ko="RFQ 배정 상위 제조사" en="Top manufacturers by RFQ assignment" /></h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left pb-2"><AdminText ko="제조사" en="Manufacturer" /></th>
                    <th className="text-right pb-2"><AdminText ko="배정" en="Assigned" /></th>
                    <th className="text-right pb-2"><AdminText ko="견적 완료" en="Quotes completed" /></th>
                    <th className="text-right pb-2"><AdminText ko="전환율" en="Conversion rate" /></th>
                  </tr>
                </thead>
                <tbody>
                  {mfg.topFactories.map((f, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 font-medium text-gray-800">{f.factory_name}</td>
                      <td className="py-2 text-right text-gray-600">{f.cnt.toLocaleString(locale)}</td>
                      <td className="py-2 text-right text-gray-600">{f.quoted.toLocaleString(locale)}</td>
                      <td className="py-2 text-right">
                        <span className={`text-xs font-bold ${f.cnt > 0 && f.quoted / f.cnt > 0.5 ? 'text-green-600' : 'text-amber-600'}`}>
                          {f.cnt > 0 ? Math.round((f.quoted / f.cnt) * 100) : 0}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 계약 매출 */}
          <div className="bg-white rounded-xl border p-5 flex items-center gap-4">
            <div className="text-3xl">🏭</div>
            <div>
              <p className="text-xs text-gray-400"><AdminText ko="총 계약 매출 (nf_contracts)" en="Total contract revenue (nf_contracts)" /></p>
              <p className="text-2xl font-black text-green-600">
                {fmtKRW(mfg.funnel.contractRevenue, locale)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5"><AdminText ko="계약 " en="Contracts: " />{mfg.funnel.contractTotal.toLocaleString(locale)}<AdminText ko="건 누적" en=" total" /></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
