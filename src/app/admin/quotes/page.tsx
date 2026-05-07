'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast, type ToastType } from '@/components/ToastProvider';

// ─── CSV ──────────────────────────────────────────────────────────────────

function downloadQuotesCSV(data: Quote[], toast?: (type: ToastType, message: string) => void) {
  if (data.length === 0) { toast?.('warning', '내보낼 데이터가 없습니다.'); return; }
  const headers = ['견적ID', '프로젝트명', '파트너사', '견적금액', '상태', '유효기간', '연결문의ID', '생성일'];
  const rows = data.map(q => [
    q.id,
    q.projectName,
    q.factoryName || '',
    q.estimatedAmount,
    q.status,
    q.validUntil || '',
    q.inquiryId || '',
    q.createdAt?.slice(0, 10) || '',
  ]);
  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `quotes_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface Quote {
  id: string;
  inquiryId?: string;
  projectName: string;
  factoryName?: string;
  estimatedAmount: number;
  details?: string;
  validUntil?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired' | 'responded';
  createdAt: string;
  updatedAt?: string;
  partnerEmail?: string;
  partnerResponse?: {
    estimatedAmount: number;
    estimatedDays: number | null;
    note: string;
    respondedAt: string;
    respondedBy: string;
  };
}

interface ApprovedPartner {
  id: string;
  email?: string;
  company?: string;
  name?: string;
  partnerStatus: string;
}

interface Inquiry {
  id: string;
  name?: string;
  company?: string;
  email?: string;
  request_field?: string;
  date: string;
}

// ─── 상수 ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  pending: '검토중',
  responded: '파트너응답',
  accepted: '수락',
  rejected: '거절',
  expired: '만료',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  responded: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  expired: 'bg-gray-100 text-gray-500',
};

const TOKEN_KEY = 'nexyfab_admin_authed';

const won = (n: number) => n.toLocaleString('ko-KR') + '원';

// ─── 컴포넌트 ────────────────────────────────────────────────────────────

export default function QuotesAdminPage() {
  const { toast } = useToast();
  const [authed, setAuthed] = useState(false);
  const [pwInput, setPwInput] = useState('');
  const [pwError, setPwError] = useState('');

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [approvedPartners, setApprovedPartners] = useState<ApprovedPartner[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  // 새 견적 모달
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    inquiryId: '',
    projectName: '',
    factoryName: '',
    estimatedAmount: '',
    details: '',
    validUntil: '',
    partnerEmail: '',
  });
  const [submitting, setSubmitting] = useState(false);

  // 계약 전환 모달
  const [convertQuote, setConvertQuote] = useState<Quote | null>(null);
  const [convertForm, setConvertForm] = useState({ contractAmount: '', plan: 'standard', customerEmail: '', lang: 'ko' });
  const [converting, setConverting] = useState(false);

  // 견적 비교 모달
  const [compareProject, setCompareProject] = useState<string | null>(null);
  const [selectingQuote, setSelectingQuote] = useState<string | null>(null);

  // 만료 견적 숨기기 토글
  const [hideExpired, setHideExpired] = useState(false);

  // ─── 인증 ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (localStorage.getItem(TOKEN_KEY) === '1') setAuthed(true);
  }, []);

  useEffect(() => {
    if (authed) {
      fetchQuotes();
      fetchInquiries();
      fetchApprovedPartners();
    }
  }, [authed]);

  async function fetchApprovedPartners() {
    try {
      const res = await fetch('/api/partners');
      const data = await res.json();
      setApprovedPartners((data.partners || []).filter((p: ApprovedPartner) => p.partnerStatus === 'approved'));
    } catch { /* silent */ }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwInput }),
    });
    if (res.ok) {
      localStorage.setItem(TOKEN_KEY, '1');
      setAuthed(true);
      setPwError('');
    } else {
      setPwError('비밀번호가 올바르지 않습니다.');
    }
  }

  function handleLogout() {
    localStorage.removeItem(TOKEN_KEY);
    setAuthed(false);
    setPwInput('');
  }

  // ─── 데이터 패치 ────────────────────────────────────────────────────────

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/quotes');
      if (!res.ok) throw new Error('fetch fail');
      const data = await res.json();
      setQuotes(data.quotes || []);
    } catch {
      setError('견적 목록을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchInquiries = useCallback(async () => {
    try {
      const res = await fetch('/api/inquiries');
      if (!res.ok) return;
      const data = await res.json();
      setInquiries(data.inquiries || []);
    } catch {
      // silent
    }
  }, []);

  // ─── 상태 변경 ───────────────────────────────────────────────────────────

  async function updateStatus(id: string, status: string) {
    setUpdating(id);
    try {
      const res = await fetch('/api/quotes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQuotes(prev => prev.map(q => (q.id === id ? data.quote : q)));
    } catch {
      toast('error', '상태 변경에 실패했습니다.');
    } finally {
      setUpdating(null);
    }
  }

  // ─── 새 견적 생성 ────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          estimatedAmount: Number(form.estimatedAmount.replace(/[^0-9]/g, '')),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQuotes(prev => [data.quote, ...prev]);
      setShowModal(false);
      setForm({ inquiryId: '', projectName: '', factoryName: '', estimatedAmount: '', details: '', validUntil: '', partnerEmail: '' });
    } catch {
      toast('error', '견적 생성에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── 계약 전환 ────────────────────────────────────────────────────────────

  async function handleConvert() {
    if (!convertQuote || !convertForm.contractAmount) return;
    setConverting(true);
    try {
      // 1. 견적 상태 → accepted
      await fetch('/api/quotes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: convertQuote.id, status: 'accepted' }),
      });

      // 2. 계약 생성
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: convertQuote.projectName,
          factoryName: convertQuote.factoryName || '',
          contractAmount: Number(convertForm.contractAmount.replace(/[^0-9]/g, '')),
          plan: convertForm.plan,
          quoteId: convertQuote.id,
          customerEmail: convertForm.customerEmail || undefined,
          partnerEmail: convertQuote.partnerEmail || undefined,
          lang: convertForm.lang,
        }),
      });
      const data = await res.json();
      if (data.contract) {
        toast('success', `계약이 생성되었습니다. 계약 ID: ${data.contract.id} / 최종 수수료: ${data.contract.finalCharge.toLocaleString('ko-KR')}원`);
        setConvertQuote(null);
        setConvertForm({ contractAmount: '', plan: 'standard', customerEmail: '', lang: 'ko' });
        fetchQuotes();
      }
    } catch {
      toast('error', '계약 전환에 실패했습니다.');
    } finally {
      setConverting(false);
    }
  }

  // ─── 견적 선택 (비교 모달에서) ──────────────────────────────────────────

  async function handleSelectQuote(selectedQuote: Quote, allProjectQuotes: Quote[]) {
    if (!confirm(`"${selectedQuote.factoryName || selectedQuote.partnerEmail}"의 견적을 채택하시겠습니까?`)) return;
    setSelectingQuote(selectedQuote.id);
    try {
      // 1. 계약 생성
      const contractRes = await fetch('/api/contracts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectName: selectedQuote.projectName,
          factoryName: selectedQuote.factoryName || '',
          contractAmount: selectedQuote.partnerResponse?.estimatedAmount || selectedQuote.estimatedAmount,
          plan: 'standard',
          quoteId: selectedQuote.id,
          partnerEmail: selectedQuote.partnerEmail || '',
        }),
      });
      if (!contractRes.ok) throw new Error('계약 생성 실패');
      const contractData = await contractRes.json();

      // 2. 선택된 견적 → accepted
      await fetch('/api/quotes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selectedQuote.id, status: 'accepted' }),
      });

      // 3. 나머지 견적 → rejected
      const others = allProjectQuotes.filter(q => q.id !== selectedQuote.id);
      await Promise.all(
        others.map(q =>
          fetch('/api/quotes', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: q.id, status: 'rejected' }),
          })
        )
      );

      // 알림은 /api/quotes PATCH 핸들러(accepted/rejected)에서 자동 발송됨

      toast('success', `계약이 생성되었습니다. 계약 ID: ${contractData.contract?.id || ''} / 최종 수수료: ${contractData.contract?.finalCharge?.toLocaleString('ko-KR') || 0}원`);
      setCompareProject(null);
      fetchQuotes();
    } catch (e: any) {
      toast('error', e?.message || '처리 중 오류가 발생했습니다.');
    } finally {
      setSelectingQuote(null);
    }
  }

  // ─── 비밀번호 게이트 ─────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 w-full max-w-sm">
          <h1 className="text-2xl font-black text-gray-900 mb-1">관리자 인증</h1>
          <p className="text-sm text-gray-500 mb-8">견적 관리 페이지에 접근하려면 비밀번호를 입력하세요.</p>
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <input
              type="password"
              placeholder="비밀번호"
              value={pwInput}
              onChange={e => setPwInput(e.target.value)}
              autoFocus
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
            {pwError && <p className="text-red-500 text-sm font-semibold">{pwError}</p>}
            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition text-sm"
            >
              로그인
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── 통계 ────────────────────────────────────────────────────────────────

  const stats = {
    total: quotes.length,
    pending: quotes.filter(q => q.status === 'pending').length,
    accepted: quotes.filter(q => q.status === 'accepted').length,
    rejected: quotes.filter(q => q.status === 'rejected').length,
    expired: quotes.filter(q => q.status === 'expired').length,
  };

  // 같은 projectName을 가진 responded 상태 견적 그룹
  const respondedByProject: Record<string, Quote[]> = {};
  quotes
    .filter(q => q.status === 'responded' && q.partnerResponse)
    .forEach(q => {
      if (!respondedByProject[q.projectName]) respondedByProject[q.projectName] = [];
      respondedByProject[q.projectName].push(q);
    });
  // 2개 이상 응답이 있는 프로젝트만
  const comparableProjects = Object.entries(respondedByProject).filter(([, qs]) => qs.length >= 2);

  // 만료 견적 하단 정렬 + 숨기기 필터

  function getDaysUntilExpiry(validUntil: string): number {
    const due = new Date(validUntil);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }

  const displayedQuotes = quotes
    .filter(q => !(hideExpired && q.status === 'expired'))
    .sort((a, b) => {
      const aExp = a.status === 'expired' ? 1 : 0;
      const bExp = b.status === 'expired' ? 1 : 0;
      if (aExp !== bExp) return aExp - bExp;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  // ─── 렌더 ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-gray-900">견적 관리</h1>
          <p className="text-sm text-gray-500 mt-1">NexyFab Admin — 전체 견적 현황</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setHideExpired(v => !v)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition ${hideExpired ? 'border-gray-400 bg-gray-100 text-gray-700 font-semibold' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
          >
            {hideExpired ? '만료 견적 표시' : '만료 견적 숨기기'}
          </button>
          <button
            onClick={() => downloadQuotesCSV(quotes, toast)}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            CSV 내보내기
          </button>
          <button
            onClick={fetchQuotes}
            disabled={loading}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 transition disabled:opacity-50"
          >
            {loading ? '새로고침 중...' : '새로고침'}
          </button>
          {comparableProjects.length > 0 && (
            <button
              onClick={() => setCompareProject(comparableProjects[0][0])}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-lg transition"
            >
              견적 비교 ({comparableProjects.length})
            </button>
          )}
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition"
          >
            + 새 견적 작성
          </button>
          <button
            onClick={handleLogout}
            className="px-4 py-2 bg-gray-100 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-200 transition"
          >
            로그아웃
          </button>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        {[
          { label: '전체', value: stats.total, color: 'text-gray-900' },
          { label: '검토중', value: stats.pending, color: 'text-amber-600' },
          { label: '수락', value: stats.accepted, color: 'text-green-600' },
          { label: '거절', value: stats.rejected, color: 'text-red-500' },
          { label: '만료', value: stats.expired, color: 'text-gray-400' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 text-center">
            <p className={`text-2xl font-black ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* 에러 */}
      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm font-semibold rounded-xl flex items-center justify-between gap-3">
          <span>{error}</span>
          <button
            onClick={fetchQuotes}
            className="shrink-0 px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            다시 시도
          </button>
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex gap-3 items-center">
                <div className="animate-pulse bg-gray-100 rounded h-4 w-24" />
                <div className="animate-pulse bg-gray-100 rounded h-4 flex-1" />
                <div className="animate-pulse bg-gray-100 rounded h-4 w-20" />
                <div className="animate-pulse bg-gray-100 rounded h-4 w-16" />
                <div className="animate-pulse bg-gray-100 rounded h-4 w-16" />
              </div>
            ))}
          </div>
        ) : displayedQuotes.length === 0 ? (
          <div className="py-20 text-center">
            <div className="text-4xl mb-3">📝</div>
            <p className="text-sm font-semibold text-gray-500 mb-1">등록된 견적이 없습니다</p>
            <p className="text-xs text-gray-400">새 견적을 작성하거나 필터를 확인해 보세요.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">견적ID</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">프로젝트명</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">파트너사</th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">견적금액</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">상태</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">유효기간</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">파트너 응답</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">생성일</th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">액션</th>
                </tr>
              </thead>
              <tbody>
                {displayedQuotes.map((q, i) => {
                  const daysLeft = q.validUntil ? getDaysUntilExpiry(q.validUntil) : null;
                  const nearExpiry = q.status === 'pending' && daysLeft !== null && daysLeft >= 0 && daysLeft <= 3;
                  return (
                  <tr
                    key={q.id}
                    className={`border-b border-gray-50 hover:bg-gray-50 transition ${q.status === 'expired' ? 'opacity-60' : ''} ${i % 2 === 0 ? '' : 'bg-gray-50/30'}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">{q.id}</td>
                    <td className="px-4 py-3 whitespace-nowrap max-w-[180px]">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-gray-800 truncate">{q.projectName}</span>
                        {respondedByProject[q.projectName] && respondedByProject[q.projectName].length >= 2 && (
                          <button
                            onClick={e => { e.stopPropagation(); setCompareProject(q.projectName); }}
                            className="shrink-0 px-1.5 py-0.5 text-[10px] font-bold bg-violet-100 text-violet-700 rounded-full hover:bg-violet-200 transition"
                          >
                            {respondedByProject[q.projectName].length}개 응답
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{q.factoryName || '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{won(q.estimatedAmount)}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${q.status === 'expired' ? 'bg-gray-100 text-gray-500' : STATUS_COLORS[q.status] || 'bg-gray-100 text-gray-500'}`}>
                          {q.status === 'expired' ? '만료됨' : STATUS_LABELS[q.status] || q.status}
                        </span>
                        {nearExpiry && (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-600">
                            ⚠ {daysLeft}일 후 만료
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500 text-xs whitespace-nowrap">{q.validUntil || '—'}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {q.partnerResponse ? (
                        <div className="text-xs text-left">
                          <div className="font-semibold text-gray-800">{won(q.partnerResponse.estimatedAmount)}</div>
                          {q.partnerResponse.estimatedDays && (
                            <div className="text-gray-500">{q.partnerResponse.estimatedDays}일</div>
                          )}
                          <div className="text-gray-400">{q.partnerResponse.respondedBy}</div>
                        </div>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500 text-xs whitespace-nowrap">{q.createdAt?.slice(0, 10)}</td>
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        {q.status === 'pending' && (
                          <>
                            <button
                              onClick={() => {
                                setConvertQuote(q);
                                setConvertForm({ contractAmount: String(q.estimatedAmount), plan: 'standard', customerEmail: '', lang: 'ko' });
                              }}
                              disabled={updating === q.id}
                              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50 whitespace-nowrap"
                            >
                              계약 전환
                            </button>
                            <button
                              onClick={() => updateStatus(q.id, 'rejected')}
                              disabled={updating === q.id}
                              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition disabled:opacity-50"
                            >
                              거절
                            </button>
                            <button
                              onClick={() => updateStatus(q.id, 'expired')}
                              disabled={updating === q.id}
                              className="px-2.5 py-1 text-xs font-bold rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-500 border border-gray-200 transition disabled:opacity-50"
                            >
                              만료
                            </button>
                          </>
                        )}
                        {q.status !== 'pending' && (
                          <span className="text-xs text-gray-400">—</span>
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

      {/* 새 견적 모달 */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-gray-900 text-white px-6 py-4">
              <h2 className="text-lg font-bold">새 견적 작성</h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">문의 연결 (선택)</label>
                <select
                  value={form.inquiryId}
                  onChange={e => {
                    const inq = inquiries.find(i => i.id === e.target.value);
                    setForm(f => ({
                      ...f,
                      inquiryId: e.target.value,
                      projectName: inq ? (inq.request_field || '') : f.projectName,
                      factoryName: inq ? (inq.company || '') : f.factoryName,
                    }));
                  }}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
                >
                  <option value="">— 직접 입력 —</option>
                  {inquiries.map(inq => (
                    <option key={inq.id} value={inq.id}>
                      {inq.company || inq.name || '이름없음'} — {inq.date?.slice(0, 10)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">프로젝트명 *</label>
                <input
                  value={form.projectName}
                  onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))}
                  required
                  placeholder="프로젝트명 입력"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">파트너사명</label>
                <input
                  value={form.factoryName}
                  onChange={e => setForm(f => ({ ...f, factoryName: e.target.value }))}
                  placeholder="담당 파트너사명"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">견적금액 (원) *</label>
                <input
                  value={form.estimatedAmount}
                  onChange={e => setForm(f => ({ ...f, estimatedAmount: e.target.value }))}
                  required
                  placeholder="예: 50000000"
                  type="number"
                  min={0}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">유효기간</label>
                <input
                  type="date"
                  value={form.validUntil}
                  onChange={e => setForm(f => ({ ...f, validUntil: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">파트너 지정 (선택)</label>
                <select
                  value={form.partnerEmail}
                  onChange={e => setForm(f => ({ ...f, partnerEmail: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
                >
                  <option value="">— 파트너 없음 —</option>
                  {approvedPartners.map(p => (
                    <option key={p.id} value={p.email || ''}>
                      {p.company || p.name || '이름없음'} ({p.email || '이메일없음'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">견적 내용</label>
                <textarea
                  value={form.details}
                  onChange={e => setForm(f => ({ ...f, details: e.target.value }))}
                  rows={3}
                  placeholder="견적 상세 내용 입력..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 resize-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="submit"
                  disabled={submitting || !form.projectName || !form.estimatedAmount}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                >
                  {submitting ? '생성 중...' : '견적 생성'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-5 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 계약 전환 모달 */}
      {convertQuote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setConvertQuote(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-1">계약 전환</h2>
            <p className="text-sm text-gray-500 mb-4">
              견적 <span className="font-mono text-xs">{convertQuote.id}</span> → 계약 생성
            </p>
            <p className="text-sm font-semibold text-gray-800 mb-4">{convertQuote.projectName}</p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">최종 계약금액 (원) *</label>
                <input
                  value={convertForm.contractAmount}
                  onChange={e => setConvertForm(f => ({ ...f, contractAmount: e.target.value }))}
                  placeholder={String(convertQuote.estimatedAmount)}
                  type="number"
                  min={0}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">플랜</label>
                <select
                  value={convertForm.plan}
                  onChange={e => setConvertForm(f => ({ ...f, plan: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
                >
                  <option value="standard">Standard (수수료 공제 50만원)</option>
                  <option value="premium">Premium (수수료 공제 100만원)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">고객 이메일 (계약 알림 발송)</label>
                <input
                  type="email"
                  value={convertForm.customerEmail}
                  onChange={e => setConvertForm(f => ({ ...f, customerEmail: e.target.value }))}
                  placeholder="customer@example.com"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">이메일 언어</label>
                <select
                  value={convertForm.lang}
                  onChange={e => setConvertForm(f => ({ ...f, lang: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white"
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                </select>
              </div>
              {(convertForm.customerEmail || convertQuote.partnerEmail) && (
                <p className="text-xs text-blue-600 bg-blue-50 rounded-lg p-2">
                  계약 생성 시
                  {convertForm.customerEmail && <> <strong>{convertForm.customerEmail}</strong></>}
                  {convertForm.customerEmail && convertQuote.partnerEmail && ' 및'}
                  {convertQuote.partnerEmail && <> <strong>{convertQuote.partnerEmail}</strong></>}
                  에 계약 체결 이메일이 자동 발송됩니다.
                </p>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button
                onClick={handleConvert}
                disabled={!convertForm.contractAmount || converting}
                className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
              >
                {converting ? '처리 중...' : '계약 생성'}
              </button>
              <button
                onClick={() => setConvertQuote(null)}
                className="px-4 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 견적 비교 모달 */}
      {compareProject && (() => {
        const projectQuotes = respondedByProject[compareProject] || [];
        if (projectQuotes.length === 0) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setCompareProject(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* 모달 헤더 */}
              <div className="bg-gray-900 text-white px-6 py-4 flex items-center justify-between shrink-0">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">견적 비교</p>
                  <h2 className="text-lg font-bold">프로젝트명: {compareProject}</h2>
                </div>
                {comparableProjects.length > 1 && (
                  <div className="flex items-center gap-2">
                    {comparableProjects.map(([pName]) => (
                      <button
                        key={pName}
                        onClick={() => setCompareProject(pName)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${pName === compareProject ? 'bg-violet-600 text-white' : 'bg-white/10 text-gray-300 hover:bg-white/20'}`}
                      >
                        {pName.length > 12 ? pName.slice(0, 12) + '…' : pName}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 비교 테이블 */}
              <div className="overflow-x-auto flex-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-5 py-3 text-xs font-bold text-gray-500 uppercase tracking-wide w-36">항목</th>
                      {projectQuotes.map(q => (
                        <th key={q.id} className="text-center px-4 py-3 text-xs font-bold text-gray-700 uppercase tracking-wide whitespace-nowrap">
                          {q.factoryName || q.partnerEmail || q.id}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-gray-50">
                      <td className="px-5 py-3 text-xs font-semibold text-gray-500">견적 금액</td>
                      {projectQuotes.map(q => (
                        <td key={q.id} className="px-4 py-3 text-center font-bold text-gray-900 whitespace-nowrap">
                          {won(q.partnerResponse!.estimatedAmount)}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-gray-50 bg-gray-50/40">
                      <td className="px-5 py-3 text-xs font-semibold text-gray-500">납기일 (일수)</td>
                      {projectQuotes.map(q => (
                        <td key={q.id} className="px-4 py-3 text-center text-gray-700 whitespace-nowrap">
                          {q.partnerResponse!.estimatedDays ? `${q.partnerResponse!.estimatedDays}일` : '—'}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-gray-50">
                      <td className="px-5 py-3 text-xs font-semibold text-gray-500">메모</td>
                      {projectQuotes.map(q => (
                        <td key={q.id} className="px-4 py-3 text-center text-gray-600 text-xs max-w-[160px]">
                          {q.partnerResponse!.note || '—'}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-gray-50 bg-gray-50/40">
                      <td className="px-5 py-3 text-xs font-semibold text-gray-500">응답일</td>
                      {projectQuotes.map(q => (
                        <td key={q.id} className="px-4 py-3 text-center text-gray-500 text-xs whitespace-nowrap">
                          {q.partnerResponse!.respondedAt?.slice(0, 10) || '—'}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="px-5 py-3 text-xs font-semibold text-gray-500">선택</td>
                      {projectQuotes.map(q => (
                        <td key={q.id} className="px-4 py-4 text-center">
                          <button
                            onClick={() => handleSelectQuote(q, projectQuotes)}
                            disabled={selectingQuote !== null}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50 whitespace-nowrap"
                          >
                            {selectingQuote === q.id ? '처리 중...' : '이 견적 선택'}
                          </button>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="px-6 py-4 border-t border-gray-100 shrink-0">
                <button
                  onClick={() => setCompareProject(null)}
                  className="w-full py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
