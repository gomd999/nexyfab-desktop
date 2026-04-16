'use client';

import { useEffect, useState, useCallback } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Invoice {
  id: string;
  user_id: string;
  email: string;
  name: string;
  product: string;
  plan: string;
  status: string;
  display_amount: number;
  currency: string;
  country: string;
  total_amount_krw: number;
  description: string;
  created_at: number;
  paid_at: number | null;
  attempt_count: number;
  last_error: string | null;
  last_attempt_at: number | null;
}

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
  open:          'bg-blue-100 text-blue-700',
  paid:          'bg-green-100 text-green-700',
  past_due:      'bg-red-100 text-red-700',
  uncollectible: 'bg-gray-200 text-gray-500',
  void:          'bg-gray-100 text-gray-400',
};
const STATUS_KO: Record<string, string> = {
  open: '미결제', paid: '결제완료', past_due: '연체',
  uncollectible: '수금불가', void: '취소됨',
};
const PRODUCT_COLOR: Record<string, string> = {
  nexyfab:  'bg-blue-100 text-blue-700',
  nexyflow: 'bg-purple-100 text-purple-700',
  nexywise: 'bg-teal-100 text-teal-700',
};

function fmt(ts: number) {
  return new Date(ts).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function fmtAmount(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AdminBillingPage() {
  const [authed, setAuthed]   = useState(false);
  const [pw, setPw]           = useState('');
  const [pwError, setPwError] = useState(false);

  const [invoices, setInvoices]   = useState<Invoice[]>([]);
  const [total, setTotal]         = useState(0);
  const [retryQueue, setRetryQueue] = useState(0);
  const [page, setPage]           = useState(1);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [toast, setToast]         = useState('');
  const [expanded, setExpanded]   = useState<string | null>(null);

  // Filters
  const [filterStatus,  setFilterStatus]  = useState('');
  const [filterProduct, setFilterProduct] = useState('');
  const [filterCountry, setFilterCountry] = useState('');
  const [filterQ,       setFilterQ]       = useState('');

  // Action state
  const [retrying, setRetrying] = useState<string | null>(null);
  const [voiding,  setVoiding]  = useState<string | null>(null);
  const [runningRetries, setRunningRetries] = useState(false);

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
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (filterStatus)  params.set('status',  filterStatus);
      if (filterProduct) params.set('product', filterProduct);
      if (filterCountry) params.set('country', filterCountry);
      if (filterQ)       params.set('q',       filterQ);
      const res = await fetch(`/api/admin/billing?${params}`);
      if (!res.ok) { setError('데이터를 불러오지 못했습니다.'); return; }
      const data = await res.json() as { invoices: Invoice[]; total: number; retryQueue: number };
      setInvoices(data.invoices);
      setTotal(data.total);
      setRetryQueue(data.retryQueue);
    } finally { setLoading(false); }
  }, [page, filterStatus, filterProduct, filterCountry, filterQ]);

  useEffect(() => { if (authed) void load(); }, [authed, load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function handleRetry(invoiceId: string) {
    setRetrying(invoiceId);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      const d = await res.json() as { message?: string; error?: string };
      if (res.ok) showToast(d.message ?? '재시도 예약 완료');
      else showToast(`오류: ${d.error}`);
    } finally { setRetrying(null); void load(); }
  }

  async function handleVoid(invoiceId: string) {
    if (!confirm('이 인보이스를 void 처리하시겠습니까?')) return;
    setVoiding(invoiceId);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId }),
      });
      if (res.ok) showToast('Void 처리 완료');
      else showToast('오류 발생');
    } finally { setVoiding(null); void load(); }
  }

  async function handleRunRetries() {
    setRunningRetries(true);
    try {
      const res = await fetch('/api/admin/billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run-retries' }),
      });
      const d = await res.json() as { processed?: number; succeeded?: number; failed?: number };
      showToast(`재시도 실행: 처리 ${d.processed}건 · 성공 ${d.succeeded}건 · 실패 ${d.failed}건`);
    } finally { setRunningRetries(false); void load(); }
  }

  // ── Login gate ──────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">💳</div>
            <h1 className="text-xl font-black text-gray-900">청구 관리</h1>
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

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900">청구 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            전체 {total.toLocaleString()}건
            {retryQueue > 0 && (
              <span className="ml-2 text-red-600 font-semibold">재시도 대기 {retryQueue}건</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void handleRunRetries()} disabled={runningRetries}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 transition">
            {runningRetries ? <Spinner /> : '🔄'} 재시도 큐 실행
          </button>
          <button onClick={() => void load()}
            className="px-4 py-2 text-sm font-semibold rounded-xl border border-gray-200 bg-white hover:bg-gray-50">
            새로고침
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3">
        <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">전체 상태</option>
          <option value="open">미결제</option>
          <option value="paid">결제완료</option>
          <option value="past_due">연체</option>
          <option value="uncollectible">수금불가</option>
          <option value="void">취소됨</option>
        </select>
        <select value={filterProduct} onChange={e => { setFilterProduct(e.target.value); setPage(1); }}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400">
          <option value="">전체 제품</option>
          <option value="nexyfab">NexyFab</option>
          <option value="nexyflow">NexyFlow</option>
          <option value="nexywise">NexyWise</option>
        </select>
        <input value={filterCountry} onChange={e => { setFilterCountry(e.target.value.toUpperCase()); setPage(1); }}
          placeholder="국가 (KR, US...)"
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 w-32" />
        <input value={filterQ} onChange={e => { setFilterQ(e.target.value); setPage(1); }}
          placeholder="이메일 / 이름 / ID 검색"
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 flex-1 min-w-[180px]" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-10">{error}</p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-16">인보이스가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">사용자</th>
                  <th className="px-4 py-3 text-left">제품/플랜</th>
                  <th className="px-4 py-3 text-left">금액</th>
                  <th className="px-4 py-3 text-left">상태</th>
                  <th className="px-4 py-3 text-left">국가</th>
                  <th className="px-4 py-3 text-left">시도</th>
                  <th className="px-4 py-3 text-left">일시</th>
                  <th className="px-4 py-3 text-left">액션</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <>
                    <tr key={inv.id}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition"
                      onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 truncate max-w-[150px]">{inv.email}</p>
                        <p className="text-xs text-gray-400 truncate max-w-[150px]">{inv.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${PRODUCT_COLOR[inv.product] ?? 'bg-gray-100 text-gray-600'}`}>
                          {inv.product}
                        </span>
                        <p className="text-xs text-gray-500 mt-0.5 capitalize">{inv.plan}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">
                        {fmtAmount(inv.display_amount, inv.currency)}
                        <p className="text-xs font-normal text-gray-400">
                          {inv.total_amount_krw.toLocaleString('ko-KR')}원
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[inv.status] ?? 'bg-gray-100 text-gray-500'}`}>
                          {STATUS_KO[inv.status] ?? inv.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{inv.country}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold ${inv.attempt_count > 1 ? 'text-amber-600' : 'text-gray-400'}`}>
                          {inv.attempt_count}회
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        {fmt(inv.created_at)}
                        {inv.paid_at && <p className="text-green-600">결제 {fmt(inv.paid_at)}</p>}
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1.5">
                          {(inv.status === 'past_due' || inv.status === 'open') && (
                            <button
                              onClick={() => void handleRetry(inv.id)}
                              disabled={retrying === inv.id}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-600 text-white disabled:opacity-50 transition">
                              {retrying === inv.id ? <Spinner /> : '🔄'} 재시도
                            </button>
                          )}
                          {inv.status !== 'paid' && inv.status !== 'void' && (
                            <button
                              onClick={() => void handleVoid(inv.id)}
                              disabled={voiding === inv.id}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 transition">
                              {voiding === inv.id ? <Spinner /> : 'Void'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Expanded detail row */}
                    {expanded === inv.id && (
                      <tr key={`${inv.id}-exp`} className="bg-blue-50">
                        <td colSpan={8} className="px-6 py-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                            <div>
                              <p className="font-semibold text-gray-700 mb-1">인보이스 ID</p>
                              <p className="font-mono text-gray-500">{inv.id}</p>
                            </div>
                            <div>
                              <p className="font-semibold text-gray-700 mb-1">설명</p>
                              <p className="text-gray-500">{inv.description || '—'}</p>
                            </div>
                            {inv.last_error && (
                              <div className="sm:col-span-2">
                                <p className="font-semibold text-red-600 mb-1">마지막 오류</p>
                                <p className="font-mono text-red-500 bg-red-50 rounded-lg px-3 py-2">{inv.last_error}</p>
                              </div>
                            )}
                            {inv.last_attempt_at && (
                              <div>
                                <p className="font-semibold text-gray-700 mb-1">마지막 시도</p>
                                <p className="text-gray-500">{fmt(inv.last_attempt_at)}</p>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
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
