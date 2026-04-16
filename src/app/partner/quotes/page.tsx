'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';
import RfqModelViewer from '@/components/nexyfab/RfqModelViewer';
import DfmScoreBadge from '@/components/nexyfab/DfmScoreBadge';

interface Partner {
  partnerId: string;
  email: string;
  company: string;
}

interface Quote {
  id: string;
  rfqId?: string;
  projectName: string;
  estimatedAmount: number;
  details?: string;
  status: string;
  validUntil?: string;
  createdAt: string;
  partnerEmail?: string;
  shareToken?: string | null;
  dfmScore?: number | null;
  dfmProcess?: string | null;
  bbox?: { w: number; h: number; d: number } | null;
  partnerResponse?: {
    estimatedAmount: number;
    estimatedDays: number | null;
    note: string;
    respondedAt: string;
  };
}

const STATUS_LABELS: Record<string, string> = {
  pending: '응답 대기',
  responded: '응답 완료',
  accepted: '수락됨',
  rejected: '거절됨',
  expired: '만료됨',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  responded: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
  expired: 'bg-gray-100 text-gray-500',
};

function won(n: number) {
  return n?.toLocaleString('ko-KR') + '원';
}

function formatDate(iso: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR');
}

function Sidebar({ partner, onLogout }: { partner: Partner | null; onLogout: () => void }) {
  const navItems = [
    { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
    { href: '/partner/projects', label: '프로젝트', icon: '📦' },
    { href: '/partner/quotes', label: '견적', icon: '📝' },
    { href: '/partner/portfolio', label: '포트폴리오', icon: '🏆' },
    { href: '/partner/profile', label: '프로필', icon: '🏭' },
  ];

  return (
    <aside className="w-56 shrink-0 bg-white border-r border-gray-100 min-h-screen flex flex-col">
      <div className="px-5 py-5 border-b border-gray-100">
        <a href="/" className="text-lg font-black text-gray-900">NexyFab</a>
        <p className="text-xs text-gray-400 mt-0.5">파트너 포털</p>
      </div>
      {partner && (
        <div className="px-5 py-4 border-b border-gray-100">
          <div className="text-sm font-bold text-gray-800 truncate">{partner.company || '파트너'}</div>
          <div className="text-xs text-gray-400 truncate">{partner.email}</div>
        </div>
      )}
      <nav className="flex-1 px-3 py-3 space-y-1">
        {navItems.map(item => (
          <a key={item.href} href={item.href}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
            <span>{item.icon}</span>{item.label}
          </a>
        ))}
      </nav>
      <div className="px-3 py-4 border-t border-gray-100">
        <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors">
          <span>🚪</span>로그아웃
        </button>
      </div>
    </aside>
  );
}

export default function PartnerQuotesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);

  // 응답/수정 모달
  const [respondTarget, setRespondTarget] = useState<Quote | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [respondForm, setRespondForm] = useState({ estimatedAmount: '', estimatedDays: '', note: '' });
  const [submitting, setSubmitting] = useState(false);

  const getSession = () => localStorage.getItem('partnerSession') || '';

  const logout = () => {
    localStorage.removeItem('partnerSession');
    localStorage.removeItem('partnerInfo');
    router.push('/partner/login');
  };

  const fetchQuotes = useCallback(async (session: string) => {
    const res = await fetch('/api/partner/quotes', {
      headers: { Authorization: `Bearer ${session}` },
    });
    const data = await res.json();
    setQuotes(data.quotes || []);
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/partner/login'); return; }

    if (session === 'demo') {
      setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
      setQuotes([]);
      setLoading(false);
      return;
    }

    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(d => {
        if (!d.valid) { router.replace('/partner/login'); return; }
        setPartner(d.partner);
        fetchQuotes(session).finally(() => setLoading(false));
      })
      .catch(() => router.replace('/partner/login'));
  }, [router, fetchQuotes]);

  async function handleRespond(e: React.FormEvent) {
    e.preventDefault();
    if (!respondTarget) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/partner/quotes/respond', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getSession()}`,
        },
        body: JSON.stringify({
          quoteId: respondTarget.id,
          estimatedAmount: Number(respondForm.estimatedAmount.replace(/[^0-9]/g, '')),
          estimatedDays: respondForm.estimatedDays ? Number(respondForm.estimatedDays) : null,
          note: respondForm.note,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQuotes(prev => prev.map(q => q.id === data.quote.id ? data.quote : q));
      setRespondTarget(null);
      setIsEditing(false);
      setRespondForm({ estimatedAmount: '', estimatedDays: '', note: '' });
    } catch {
      toast('error', '견적 제출에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar partner={partner} onLogout={logout} />

      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-900">견적 요청</h1>
            <p className="text-sm text-gray-500 mt-1">어드민이 지정한 견적 요청 목록</p>
          </div>

          {quotes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center text-gray-400 text-sm">
              배정된 견적 요청이 없습니다.
            </div>
          ) : (
            <div className="space-y-4">
              {quotes.map(quote => (
                <div key={quote.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                  <div className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[quote.status] || 'bg-gray-100 text-gray-500'}`}>
                            {STATUS_LABELS[quote.status] || quote.status}
                          </span>
                          <span className="text-xs text-gray-400 font-mono">{quote.id}</span>
                          {(quote.dfmScore != null) && (
                            <DfmScoreBadge score={quote.dfmScore} process={quote.dfmProcess} size="sm" />
                          )}
                        </div>
                        <h3 className="text-base font-bold text-gray-900">{quote.projectName}</h3>
                        <div className="text-sm text-gray-500 mt-0.5">
                          <span className="font-semibold">{won(quote.estimatedAmount)}</span>
                          {quote.validUntil && (
                            <span className="text-gray-400"> · 유효: {formatDate(quote.validUntil)}</span>
                          )}
                        </div>
                        {quote.details && (
                          <p className="text-sm text-gray-600 mt-2 bg-gray-50 rounded-lg px-3 py-2">
                            {quote.details}
                          </p>
                        )}
                      </div>

                      {quote.status === 'pending' && (
                        <button
                          onClick={() => {
                            setRespondTarget(quote);
                            setIsEditing(false);
                            setRespondForm({ estimatedAmount: String(quote.estimatedAmount), estimatedDays: '', note: '' });
                          }}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition shrink-0"
                        >
                          견적 제출
                        </button>
                      )}
                      {quote.status === 'responded' && (
                        <button
                          onClick={() => {
                            setRespondTarget(quote);
                            setIsEditing(true);
                            setRespondForm({
                              estimatedAmount: String(quote.partnerResponse?.estimatedAmount || ''),
                              estimatedDays: String(quote.partnerResponse?.estimatedDays || ''),
                              note: quote.partnerResponse?.note || '',
                            });
                          }}
                          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-lg transition shrink-0"
                        >
                          수정
                        </button>
                      )}
                    </div>

                    {/* 3D 모델 뷰어 */}
                    {(quote.shareToken || quote.rfqId) && (
                      <div className="mt-3 border-t border-gray-100 pt-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">3D 모델</p>
                        <RfqModelViewer
                          rfqId={quote.rfqId}
                          shareToken={quote.shareToken}
                          dfmScore={quote.dfmScore}
                          dfmProcess={quote.dfmProcess}
                          shapeName={quote.projectName}
                          bbox={quote.bbox}
                          variant="compact"
                          autoFetch={!quote.shareToken && !!quote.rfqId}
                        />
                      </div>
                    )}

                    {/* 응답 내용 표시 */}
                    {quote.partnerResponse && (
                      <div className="mt-3 border-t border-gray-100 pt-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">제출한 견적</p>
                        <div className="bg-blue-50 rounded-xl px-4 py-3 space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">견적 금액</span>
                            <span className="font-bold text-gray-900">{won(quote.partnerResponse.estimatedAmount)}</span>
                          </div>
                          {quote.partnerResponse.estimatedDays && (
                            <div className="flex justify-between text-sm">
                              <span className="text-gray-600">납기일</span>
                              <span className="font-semibold text-gray-900">{quote.partnerResponse.estimatedDays}일</span>
                            </div>
                          )}
                          {quote.partnerResponse.note && (
                            <div className="text-sm text-gray-600 mt-1">{quote.partnerResponse.note}</div>
                          )}
                          <div className="text-xs text-gray-400 mt-1">
                            제출: {formatDate(quote.partnerResponse.respondedAt)}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 견적 제출/수정 모달 */}
      {respondTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setRespondTarget(null); setIsEditing(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="bg-gray-900 text-white px-6 py-4">
              <h2 className="text-lg font-bold">{isEditing ? '견적 수정' : '견적 제출'}</h2>
              <p className="text-sm text-gray-400 mt-0.5">{respondTarget.projectName}</p>
            </div>
            <form onSubmit={handleRespond} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">견적 금액 (원) *</label>
                <input
                  type="number"
                  value={respondForm.estimatedAmount}
                  onChange={e => setRespondForm(f => ({ ...f, estimatedAmount: e.target.value }))}
                  required
                  min={0}
                  placeholder="예: 45000000"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">납기일 (일수)</label>
                <input
                  type="number"
                  value={respondForm.estimatedDays}
                  onChange={e => setRespondForm(f => ({ ...f, estimatedDays: e.target.value }))}
                  min={1}
                  placeholder="예: 14"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">메모</label>
                <textarea
                  value={respondForm.note}
                  onChange={e => setRespondForm(f => ({ ...f, note: e.target.value }))}
                  rows={3}
                  placeholder="견적 관련 추가 사항..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={submitting || !respondForm.estimatedAmount}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                >
                  {submitting ? '처리 중...' : isEditing ? '수정하기' : '제출하기'}
                </button>
                <button
                  type="button"
                  onClick={() => { setRespondTarget(null); setIsEditing(false); }}
                  className="px-5 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
