'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Subscription {
  id: string;
  user_id: string;
  email: string;
  name: string;
  product: string;
  plan: string;
  status: string;
  country: string;
  currency: string;
  current_period_start: number;
  current_period_end: number;
  aw_subscription_id: string;
  created_at: number;
  cancelled_at: number | null;
}

interface SummaryRow { status: string; plan: string; count: number }

// ── Helpers ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

const STATUS_COLOR: Record<string, string> = {
  active:    'bg-green-100 text-green-700',
  trialing:  'bg-blue-100 text-blue-700',
  past_due:  'bg-amber-100 text-amber-700',
  cancelled: 'bg-gray-200 text-gray-500',
};
const PLAN_COLOR: Record<string, string> = {
  free:       'bg-gray-100 text-gray-600',
  pro:        'bg-blue-100 text-blue-700',
  team:       'bg-purple-100 text-purple-700',
  enterprise: 'bg-amber-100 text-amber-700',
};
const PRODUCT_EMOJI: Record<string, string> = {
  nexyfab: '🏭', nexyflow: '🔄', nexywise: '📊',
};

function fmt(ts: number) {
  return new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function daysLeft(ts: number) {
  const d = Math.ceil((ts - Date.now()) / 86_400_000);
  return d;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSubscriptionsPage() {
  const [authed, setAuthed]   = useState(false);
  const [pw, setPw]           = useState('');
  const [pwError, setPwError] = useState(false);

  const [subs, setSubs]         = useState<Subscription[]>([]);
  const [summary, setSummary]   = useState<SummaryRow[]>([]);
  const [total, setTotal]       = useState(0);
  const [page, setPage]         = useState(1);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [toast, setToast]       = useState('');

  // Filters
  const [filterStatus,  setFilterStatus]  = useState('active');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterPlan,    setFilterPlan]    = useState('');
  const [filterQ,       setFilterQ]       = useState('');

  // Plan change modal
  const [planModal, setPlanModal]   = useState<Subscription | null>(null);
  const [newPlan, setNewPlan]       = useState('');
  const [planSaving, setPlanSaving] = useState(false);

  // Cancel state
  const [cancelling, setCancelling] = useState<string | null>(null);

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
      const params = new URLSearchParams({ page: String(page) });
      if (filterStatus)  params.set('status',  filterStatus);
      if (filterProduct) params.set('product', filterProduct);
      if (filterPlan)    params.set('plan',    filterPlan);
      if (filterQ)       params.set('q',       filterQ);
      const res = await fetch(`/api/admin/subscriptions?${params}`);
      if (!res.ok) { setError('데이터를 불러오지 못했습니다.'); return; }
      const data = await res.json() as { subscriptions: Subscription[]; total: number; summary: SummaryRow[] };
      setSubs(data.subscriptions);
      setTotal(data.total);
      setSummary(data.summary);
    } finally { setLoading(false); }
  }, [page, filterStatus, filterProduct, filterPlan, filterQ]);

  useEffect(() => { if (authed) void load(); }, [authed, load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handlePlanChange() {
    if (!planModal || !newPlan) return;
    setPlanSaving(true);
    try {
      const res = await fetch('/api/admin/subscriptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId: planModal.id, plan: newPlan }),
      });
      const d = await res.json() as { error?: string };
      if (res.ok) { showToast(`플랜 변경 완료: ${newPlan}`); setPlanModal(null); void load(); }
      else showToast(`오류: ${d.error}`);
    } finally { setPlanSaving(false); }
  }

  async function handleCancel(sub: Subscription) {
    if (!confirm(`${sub.email}의 ${sub.product} 구독을 취소하시겠습니까?`)) return;
    setCancelling(sub.id);
    try {
      const res = await fetch('/api/admin/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionId: sub.id }),
      });
      if (res.ok) showToast('구독 취소 완료');
      else showToast('오류 발생');
      void load();
    } finally { setCancelling(null); }
  }

  // ── Summary stats ───────────────────────────────────────────────────────────
  const activeCount = summary.filter(r => r.status === 'active').reduce((s, r) => s + r.count, 0);
  const mrr = summary.filter(r => r.status === 'active').reduce((s, r) => {
    const prices: Record<string, number> = { free: 0, pro: 29000, team: 42000, enterprise: 299000 };
    return s + (prices[r.plan] ?? 0) * r.count;
  }, 0);

  // ── Login gate ──────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">📋</div>
            <h1 className="text-xl font-black text-gray-900">구독 관리</h1>
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

  // ── Main UI ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-5 py-3 rounded-xl shadow-xl">
          {toast}
        </div>
      )}

      {/* Plan change modal */}
      {planModal && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-black text-gray-900 mb-1">플랜 변경</h2>
            <p className="text-sm text-gray-500 mb-4">
              {planModal.email} · {planModal.product}
            </p>
            <p className="text-xs text-gray-500 mb-1">현재 플랜: <span className="font-bold">{planModal.plan}</span></p>
            <select value={newPlan} onChange={e => setNewPlan(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 mb-4">
              <option value="">플랜 선택</option>
              {['free','pro','team','enterprise'].filter(p => p !== planModal.plan).map(p => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <button onClick={() => void handlePlanChange()} disabled={!newPlan || planSaving}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm disabled:opacity-50 transition">
                {planSaving ? '변경 중...' : '변경'}
              </button>
              <button onClick={() => setPlanModal(null)}
                className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header + KPI */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">구독 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">전체 {total.toLocaleString()}건</p>
        </div>
        <button onClick={() => void load()}
          className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
          새로고침
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '활성 구독', value: activeCount.toLocaleString(), icon: '✅' },
          { label: '예상 MRR', value: (mrr / 10000).toFixed(0) + '만원', icon: '💰' },
          { label: 'Pro 이상', value: summary.filter(r => r.status === 'active' && r.plan !== 'free').reduce((s,r) => s + r.count, 0).toString(), icon: '⬆️' },
          { label: '연체/위험', value: summary.filter(r => r.status === 'past_due').reduce((s,r) => s + r.count, 0).toString(), icon: '⚠️' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-400">{k.icon} {k.label}</p>
            <p className="text-2xl font-black text-gray-900 mt-1">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Plan distribution */}
      {summary.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">플랜별 구독 현황 (활성)</p>
          <div className="flex flex-wrap gap-2">
            {summary.filter(r => r.status === 'active').sort((a, b) => b.count - a.count).map(r => (
              <div key={`${r.plan}-${r.status}`} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${PLAN_COLOR[r.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                {PRODUCT_EMOJI[r.plan] ?? ''} {r.plan} · {r.count}명
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3">
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">전체 상태</option>
          <option value="active">활성</option>
          <option value="trialing">체험</option>
          <option value="past_due">연체</option>
          <option value="cancelled">취소됨</option>
        </select>
        <select value={filterProduct} onChange={e => { setFilterProduct(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">전체 제품</option>
          <option value="nexyfab">NexyFab</option>
          <option value="nexyflow">NexyFlow</option>
          <option value="nexywise">NexyWise</option>
        </select>
        <select value={filterPlan} onChange={e => { setFilterPlan(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">전체 플랜</option>
          <option value="free">Free</option>
          <option value="pro">Pro</option>
          <option value="team">Team</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <input value={filterQ} onChange={e => { setFilterQ(e.target.value); setPage(1); }}
          placeholder="이메일 / 이름 검색"
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 flex-1 min-w-[160px]" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-10">{error}</p>
        ) : subs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-16">구독이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">사용자</th>
                  <th className="px-4 py-3 text-left">제품</th>
                  <th className="px-4 py-3 text-left">플랜</th>
                  <th className="px-4 py-3 text-left">상태</th>
                  <th className="px-4 py-3 text-left">국가 / 통화</th>
                  <th className="px-4 py-3 text-left">갱신일</th>
                  <th className="px-4 py-3 text-left">액션</th>
                </tr>
              </thead>
              <tbody>
                {subs.map(sub => {
                  const days = daysLeft(sub.current_period_end);
                  return (
                    <tr key={sub.id} className="border-b border-gray-50 hover:bg-gray-50 transition">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-[150px]">{sub.email}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[150px]">{sub.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-base">{PRODUCT_EMOJI[sub.product] ?? ''}</span>
                        <span className="ml-1 text-xs text-gray-600">{sub.product}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${PLAN_COLOR[sub.plan] ?? 'bg-gray-100 text-gray-600'}`}>
                          {sub.plan}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[sub.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {sub.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {sub.country} / {sub.currency}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p className="text-gray-600">{fmt(sub.current_period_end)}</p>
                        <p className={days < 7 ? 'text-amber-600 font-semibold' : 'text-gray-400'}>
                          {days > 0 ? `D-${days}` : `D+${Math.abs(days)}`}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {sub.status !== 'cancelled' && (
                            <>
                              <button
                                onClick={() => { setPlanModal(sub); setNewPlan(''); }}
                                className="px-2.5 py-1 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition">
                                플랜 변경
                              </button>
                              <button
                                onClick={() => void handleCancel(sub)}
                                disabled={cancelling === sub.id}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-50 transition">
                                {cancelling === sub.id ? <Spinner /> : '취소'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {total > 50 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-gray-400">{(page - 1) * 50 + 1}–{Math.min(page * 50, total)} / {total}건</p>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              이전
            </button>
            <button disabled={page * 50 >= total} onClick={() => setPage(p => p + 1)}
              className="px-4 py-2 rounded-xl border border-gray-200 bg-white disabled:opacity-40 hover:bg-gray-50 transition">
              다음
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
