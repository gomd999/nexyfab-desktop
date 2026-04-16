'use client';

import { useEffect, useState, useCallback } from 'react';

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

function fmtKRW(n: number) {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (n >= 10_000)      return `${Math.round(n / 10_000)}만`;
  return n.toLocaleString('ko-KR');
}

function fmt(ts: number) {
  return new Date(ts).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// CSS bar chart component
function BarChart({ data, maxVal, colorFn, labelFn, valueFn }: {
  data: unknown[];
  maxVal: number;
  colorFn: (item: unknown) => string;
  labelFn: (item: unknown) => string;
  valueFn: (item: unknown) => number;
}) {
  if (!data.length) return <p className="text-sm text-gray-400 text-center py-6">데이터 없음</p>;
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
                <span className="text-xs font-bold text-white drop-shadow">{fmtKRW(valueFn(item))}</span>
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
  const [authed, setAuthed]   = useState(false);
  const [pw, setPw]           = useState('');
  const [pwError, setPwError] = useState(false);

  const [data, setData]       = useState<AnalyticsData | null>(null);
  const [mfg, setMfg]         = useState<MfgKpi | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  async function login() {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) { setAuthed(true); setPwError(false); }
    else setPwError(true);
  }

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [saasRes, mfgRes] = await Promise.all([
        fetch('/api/admin/analytics'),
        fetch('/api/admin/manufacturing-kpi'),
      ]);
      if (!saasRes.ok) { setError('데이터를 불러오지 못했습니다.'); return; }
      setData(await saasRes.json() as AnalyticsData);
      if (mfgRes.ok) setMfg(await mfgRes.json() as MfgKpi);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (authed) void load(); }, [authed, load]);

  // ── Login gate ──────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">📊</div>
            <h1 className="text-xl font-black text-gray-900">매출 분석</h1>
            <p className="text-xs text-gray-400 mt-1">관리자 인증 필요</p>
          </div>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void login()}
            placeholder="관리자 비밀번호"
            className={`w-full px-4 py-2.5 rounded-xl border text-sm mb-3 outline-none ${pwError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-blue-400'}`} />
          <button onClick={() => void login()}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm transition">
            로그인
          </button>
          {pwError && <p className="text-red-500 text-xs text-center mt-2">비밀번호가 틀렸습니다</p>}
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-gray-400">분석 데이터 로딩 중...</p>
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-gray-900">매출 분석</h1>
          <p className="text-sm text-gray-500 mt-0.5">전체 결제 및 구독 현황</p>
        </div>
        <button onClick={() => void load()}
          className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
          새로고침
        </button>
      </div>

      {/* KPI Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: '활성 구독',    value: (data.summary.active_subs ?? 0).toLocaleString(),   icon: '✅', color: 'text-green-700' },
          { label: '이번 달 매출', value: fmtKRW(data.summary.revenue_krw_mtd ?? 0) + '원',  icon: '💰', color: 'text-blue-700'  },
          { label: '결제 건수(MTD)', value: (data.summary.paid_invoices_mtd ?? 0).toLocaleString(), icon: '🧾', color: 'text-purple-700' },
          { label: '실패(MTD)',    value: (data.summary.failed_mtd ?? 0).toLocaleString(),    icon: '❌', color: 'text-red-600'   },
          { label: '재시도 대기',  value: (data.summary.retry_queue ?? 0).toLocaleString(),   icon: '🔄', color: 'text-amber-600' },
          { label: '전체 유저',    value: (data.summary.total_users ?? 0).toLocaleString(),   icon: '👤', color: 'text-gray-700'  },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400">{k.icon} {k.label}</p>
            <p className={`text-xl font-black mt-1 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Monthly Revenue */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-bold text-gray-700 mb-4">📅 월별 매출 (최근 12개월)</p>
        {data.monthlyChart.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">결제 데이터 없음</p>
        ) : (
          <div className="space-y-2">
            {data.monthlyChart.map(m => (
              <div key={m.month} className="flex items-center gap-3">
                <p className="text-xs text-gray-500 w-16 shrink-0 text-right">{m.month.slice(5)}</p>
                <div className="flex-1 flex gap-0.5 h-7 rounded-full overflow-hidden bg-gray-100">
                  {([ ['nexyfab', m.nexyfab, 'bg-blue-400'], ['nexyflow', m.nexyflow, 'bg-purple-400'], ['nexywise', m.nexywise, 'bg-teal-400'] ] as [string, number, string][])
                    .filter(([, v]) => v > 0)
                    .map(([key, v, cls]) => (
                      <div key={key} className={`${cls} h-full`}
                        style={{ width: `${Math.max(2, Math.round(v / maxMonthlyRevenue * 100))}%` }}
                        title={`${key}: ${fmtKRW(v)}원`} />
                    ))}
                </div>
                <p className="text-xs font-bold text-gray-700 w-16 shrink-0">{fmtKRW(m.total)}원</p>
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
          <p className="text-sm font-bold text-gray-700 mb-4">🌍 국가별 매출 (Top 10)</p>
          <BarChart
            data={data.byCountry.slice(0, 10)}
            maxVal={maxCountryRevenue}
            colorFn={() => 'bg-blue-500'}
            labelFn={(item) => (item as { country: string }).country}
            valueFn={(item) => (item as { revenue_krw: number }).revenue_krw}
          />
        </div>

        {/* Plan distribution */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-700 mb-4">📦 플랜별 구독 분포 (활성)</p>
          {data.planDist.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">데이터 없음</p>
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
                    <p className="text-xs font-bold text-gray-700 w-8 text-right">{r.count}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Retry funnel */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <p className="text-sm font-bold text-gray-700 mb-4">🔄 결제 재시도 퍼널</p>
        {data.funnelChart.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">결제 시도 데이터 없음</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">
                  <th className="px-3 py-2 text-left">시도 #</th>
                  <th className="px-3 py-2 text-right">전체</th>
                  <th className="px-3 py-2 text-right text-green-600">성공</th>
                  <th className="px-3 py-2 text-right text-red-500">실패</th>
                  <th className="px-3 py-2 text-right">성공률</th>
                  <th className="px-3 py-2 text-left">비율</th>
                </tr>
              </thead>
              <tbody>
                {data.funnelChart.map(row => (
                  <tr key={row.attempt} className="border-b border-gray-50">
                    <td className="px-3 py-2.5 font-medium">
                      {row.attempt === 1 ? '최초 시도' : `재시도 #${row.attempt - 1}`}
                    </td>
                    <td className="px-3 py-2.5 text-right text-gray-700">{row.total}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-green-600">{row.succeeded}</td>
                    <td className="px-3 py-2.5 text-right font-bold text-red-500">{row.failed}</td>
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
          <p className="text-sm font-bold text-gray-700 mb-4">⚡ 이번 달 사용량 Top 10</p>
          {data.topUsage.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">사용 데이터 없음</p>
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
                  <span className="text-sm font-black text-gray-900">{u.total.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent failures */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <p className="text-sm font-bold text-gray-700 mb-4">❌ 최근 결제 실패</p>
          {data.recentFailures.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">최근 실패 없음 👍</p>
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
                        #{f.attempt_number}
                      </span>
                      <p className="text-xs text-gray-400 mt-1">{fmt(f.attempted_at)}</p>
                      {f.next_retry_at && (
                        <p className="text-xs text-amber-500">
                          재시도 {fmt(f.next_retry_at)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              {data.recentFailures.length > 8 && (
                <p className="text-xs text-gray-400 text-center pt-1">
                  외 {data.recentFailures.length - 8}건 — <a href="/admin/billing?status=past_due" className="text-blue-500 hover:underline">청구 관리에서 확인</a>
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── 제조업 퍼널 KPI ─────────────────────────────────────────────── */}
      {mfg && (
        <div className="mt-8 space-y-6">
          <h2 className="text-lg font-bold text-gray-900">제조업 퍼널 KPI</h2>

          {/* 퍼널 카드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: '총 RFQ', value: mfg.funnel.rfqTotal, sub: `이번 달 ${mfg.funnel.rfqMtd}건`, color: 'text-blue-600', bg: 'bg-blue-50' },
              { label: '배정률', value: `${mfg.rates.assignRate}%`, sub: `${mfg.funnel.rfqAssigned}건 배정됨`, color: 'text-purple-600', bg: 'bg-purple-50' },
              { label: '견적 전환율', value: `${mfg.rates.quoteRate}%`, sub: `총 ${mfg.funnel.quoteTotal}건`, color: 'text-amber-600', bg: 'bg-amber-50' },
              { label: '계약 전환율', value: `${mfg.rates.contractRate}%`, sub: `총 ${mfg.funnel.contractTotal}건`, color: 'text-green-600', bg: 'bg-green-50' },
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
            <h3 className="text-sm font-bold text-gray-700 mb-4">RFQ → 계약 퍼널</h3>
            <div className="flex items-end gap-3">
              {[
                { label: 'RFQ', value: mfg.funnel.rfqTotal, color: 'bg-blue-500' },
                { label: '배정', value: mfg.funnel.rfqAssigned, color: 'bg-purple-500' },
                { label: '견적', value: mfg.funnel.quoteTotal, color: 'bg-amber-500' },
                { label: '계약', value: mfg.funnel.contractTotal, color: 'bg-green-500' },
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
                평균 견적 응답 시간: <strong className="text-gray-700">{mfg.avgResponseHours}시간</strong>
              </p>
            )}
          </div>

          {/* 이번 달 KPI */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: '이번 달 RFQ', value: mfg.funnel.rfqMtd },
              { label: '이번 달 배정', value: mfg.funnel.rfqMtdAssigned },
              { label: '이번 달 견적', value: mfg.funnel.quoteMtd },
            ].map((s, i) => (
              <div key={i} className="bg-white rounded-xl border p-4">
                <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                <p className="text-xl font-black text-gray-900">{s.value}</p>
              </div>
            ))}
          </div>

          {/* TOP 제조사 */}
          {mfg.topFactories.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h3 className="text-sm font-bold text-gray-700 mb-4">RFQ 배정 TOP 제조사</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b">
                    <th className="text-left pb-2">제조사</th>
                    <th className="text-right pb-2">배정</th>
                    <th className="text-right pb-2">견적 완료</th>
                    <th className="text-right pb-2">전환율</th>
                  </tr>
                </thead>
                <tbody>
                  {mfg.topFactories.map((f, i) => (
                    <tr key={i} className="border-b border-gray-50 last:border-0">
                      <td className="py-2 font-medium text-gray-800">{f.factory_name}</td>
                      <td className="py-2 text-right text-gray-600">{f.cnt}</td>
                      <td className="py-2 text-right text-gray-600">{f.quoted}</td>
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
              <p className="text-xs text-gray-400">총 계약 매출 (nf_contracts)</p>
              <p className="text-2xl font-black text-green-600">
                ₩{fmtKRW(mfg.funnel.contractRevenue)}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">계약 {mfg.funnel.contractTotal}건 누적</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
