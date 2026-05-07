'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useToast } from '@/components/ToastProvider';
import { formatDate, formatDday } from '@/lib/formatDate';
import RfqModelViewer from '@/components/nexyfab/RfqModelViewer';
import RfqCadFilesPanel from '@/components/nexyfab/RfqCadFilesPanel';
import DfmScoreBadge from '@/components/nexyfab/DfmScoreBadge';

const RfqResponderPanel = dynamic(() => import('./RfqResponderPanel'), { ssr: false });
const OrderPriorityPanel = dynamic(() => import('./OrderPriorityPanel'), { ssr: false });
const CapacityMatchPanel = dynamic(() => import('./CapacityMatchPanel'), { ssr: false });
const QuoteAccuracyPanel = dynamic(() => import('./QuoteAccuracyPanel'), { ssr: false });
const PartnerAIHistoryPanel = dynamic(() => import('./PartnerAIHistoryPanel'), { ssr: false });
const PartnerStatsPanel = dynamic(() => import('./PartnerStatsPanel'), { ssr: false });
const PartnerAIPrefsPanel = dynamic(() => import('./PartnerAIPrefsPanel'), { ssr: false });
const PartnerOrdersPanel = dynamic(() => import('./PartnerOrdersPanel'), { ssr: false });
import PartnerNotificationBell from './PartnerNotificationBell';
import { loadLocalAiPrefs, type AiPrefs } from './PartnerAIPrefsPanel';

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
  pending:   'bg-amber-100 text-amber-700',
  responded: 'bg-blue-100 text-blue-700',
  accepted:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-600',
  expired:   'bg-gray-100 text-gray-500',
};

type QuoteTab = 'all' | 'pending' | 'accepted' | 'rejected' | 'expired';

const QUOTE_TABS: { key: QuoteTab; label: string }[] = [
  { key: 'all',      label: '전체' },
  { key: 'pending',  label: '검토중' },
  { key: 'accepted', label: '수락됨' },
  { key: 'rejected', label: '거절됨' },
  { key: 'expired',  label: '만료' },
];

function won(n: number) {
  return n?.toLocaleString('ko-KR') + '원';
}

// ── PDF download — uses server-side jsPDF endpoint ───────────────────────────
function downloadQuotePdf(quote: Quote) {
  window.open(`/api/quotes/${quote.id}/pdf`, '_blank', 'noopener,noreferrer');
}


export default function PartnerQuotesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading]     = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [activeTab, setActiveTab] = useState<QuoteTab>('all');

  // 응답/수정 모달
  const [respondTarget, setRespondTarget] = useState<Quote | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [respondForm, setRespondForm] = useState({ estimatedAmount: '', estimatedDays: '', note: '' });
  const [submitting, setSubmitting] = useState(false);
  const [autoQuoting, setAutoQuoting] = useState(false);
  const [autoQuoteResult, setAutoQuoteResult] = useState<{
    totalKrw: number; unitKrw: number;
    breakdown: { materialKrw: number; machineKrw: number; setupKrw: number; volumeDiscountPct: number; expressApplied: boolean };
    leadTimeDays: { min: number; max: number };
    warnings: string[];
  } | null>(null);
  const [aiDraftTarget, setAiDraftTarget] = useState<Quote | null>(null);
  const [showOrderPriority, setShowOrderPriority] = useState(false);
  const [showCapacityMatch, setShowCapacityMatch] = useState(false);
  const [showQuoteAccuracy, setShowQuoteAccuracy] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [showAIHistory, setShowAIHistory] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showAIPrefs, setShowAIPrefs] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [aiPrefs, setAiPrefs] = useState<Partial<AiPrefs>>({});
  // QuoteAccuracy 결과 보존 → RfqResponder 초안에 보정값 전달
  const [accuracyAdjustment, setAccuracyAdjustment] = useState<number | null>(null);

  // Bulk selection — only enabled for pending/responded rows so we can apply
  // batch operations (decline, extend validity) without touching closed states.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy]       = useState<null | 'decline' | 'extend'>(null);
  const [bulkValidUntil, setBulkValidUntil] = useState<string>(() => {
    const d = new Date(); d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });

  const getSession = () => localStorage.getItem('partnerSession') || '';

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  async function runBulk(action: 'decline' | 'extend_validity') {
    if (selectedIds.size === 0) return;
    if (action === 'decline' && !confirm(`${selectedIds.size}건의 견적을 거절 처리합니다. 계속할까요?`)) return;

    const session = getSession();
    if (!session || session === 'demo') {
      // Demo mode: mutate local state only.
      setQuotes(prev => prev.map(q => {
        if (!selectedIds.has(q.id)) return q;
        if (action === 'decline') return { ...q, status: 'rejected' };
        return { ...q, validUntil: bulkValidUntil };
      }));
      clearSelection();
      toast('success', `[데모] ${selectedIds.size}건 처리 완료`);
      return;
    }

    setBulkBusy(action === 'decline' ? 'decline' : 'extend');
    try {
      const res = await fetch('/api/partner/quotes/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({
          action,
          quoteIds: Array.from(selectedIds),
          ...(action === 'extend_validity' ? { validUntil: bulkValidUntil } : {}),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? '일괄 처리 실패');
      }
      const data = await res.json() as { updated: number; skipped: number };
      toast('success', `${data.updated}건 처리 완료${data.skipped ? ` (${data.skipped}건 건너뜀)` : ''}`);
      clearSelection();
      await fetchQuotes(session);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '일괄 처리에 실패했습니다.');
    } finally {
      setBulkBusy(null);
    }
  }

  const fetchQuotes = useCallback(async (session: string) => {
    try {
      const res = await fetch('/api/partner/quotes', {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setQuotes(data.quotes || []);
    } catch {
      setFetchError(true);
    }
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/partner/login'); return; }

    if (session === 'demo') {
      setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
      setQuotes([
        { id: 'demo-q1', projectName: 'EV 배터리 브라켓', estimatedAmount: 3500000, status: 'pending', createdAt: new Date(Date.now() - 86400000).toISOString(), validUntil: new Date(Date.now() + 13 * 86400000).toISOString(), dfmScore: 88, dfmProcess: 'cnc_milling' },
        { id: 'demo-q2', projectName: '스마트워치 하우징', estimatedAmount: 1200000, status: 'accepted', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), partnerResponse: { estimatedAmount: 1200000, estimatedDays: 7, note: '표면처리 포함', respondedAt: new Date(Date.now() - 4 * 86400000).toISOString() } },
        { id: 'demo-q3', projectName: '산업용 로봇팔 부품', estimatedAmount: 8800000, status: 'rejected', createdAt: new Date(Date.now() - 10 * 86400000).toISOString() },
      ]);
      setLoading(false);
      return;
    }

    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(d => {
        if (!d.valid) { router.replace('/partner/login'); return; }
        setPartner(d.partner);
        fetchQuotes(session).finally(() => setLoading(false));
        // AI prefs: localStorage → server 순으로 병합
        const localPrefs = loadLocalAiPrefs();
        setAiPrefs(localPrefs);
        fetch('/api/partner/profile', { headers: { Authorization: `Bearer ${session}` } })
          .then(r => r.ok ? r.json() : null)
          .then((d: { profile?: { aiPrefs?: Partial<AiPrefs> } } | null) => {
            if (d?.profile?.aiPrefs) setAiPrefs(p => ({ ...d.profile!.aiPrefs, ...p }));
          })
          .catch(() => {});
      })
      .catch(() => router.replace('/partner/login'));
  }, [router, fetchQuotes]);

  async function runAutoQuote(isRush: boolean) {
    if (!respondTarget) return;
    if (getSession() === 'demo') {
      // Demo mode — synthesize a plausible suggestion from existing estimatedAmount.
      const base = respondTarget.estimatedAmount || 1_000_000;
      setAutoQuoteResult({
        totalKrw: Math.round(base * (isRush ? 1.5 : 1.0)),
        unitKrw: Math.round(base * (isRush ? 1.5 : 1.0)),
        breakdown: { materialKrw: Math.round(base * 0.4), machineKrw: Math.round(base * 0.55), setupKrw: 50_000, volumeDiscountPct: 0, expressApplied: isRush },
        leadTimeDays: { min: 7, max: 14 },
        warnings: ['데모 모드: 단가표 미사용, 예시 값입니다.'],
      });
      setRespondForm(f => ({ ...f, estimatedAmount: String(Math.round(base * (isRush ? 1.5 : 1.0))), estimatedDays: '14' }));
      return;
    }
    setAutoQuoting(true);
    setAutoQuoteResult(null);
    try {
      const res = await fetch('/api/partner/quotes/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getSession()}` },
        body: JSON.stringify({ quoteId: respondTarget.id, isRush }),
      });
      const data = await res.json();
      if (!res.ok || !data?.quote) throw new Error(data?.error || 'auto-quote failed');
      setAutoQuoteResult(data.quote);
      setRespondForm(f => ({
        ...f,
        estimatedAmount: String(data.quote.totalKrw),
        estimatedDays: String(data.quote.leadTimeDays.max),
      }));
    } catch (err) {
      console.error('[runAutoQuote] failed:', err);
      alert('자동 견적 생성에 실패했습니다. 단가표를 먼저 등록해 주세요.');
    } finally {
      setAutoQuoting(false);
    }
  }

  async function handleRespond(e: React.FormEvent) {
    e.preventDefault();
    if (!respondTarget) return;

    // 데모 모드: API 호출 없이 로컬 상태만 업데이트
    if (getSession() === 'demo') {
      const amount = Number(respondForm.estimatedAmount.replace(/[^0-9]/g, ''));
      const days = respondForm.estimatedDays ? Number(respondForm.estimatedDays) : null;
      setQuotes(prev => prev.map(q => q.id === respondTarget.id ? {
        ...q,
        status: 'responded',
        partnerResponse: { estimatedAmount: amount, estimatedDays: days, note: respondForm.note, respondedAt: new Date().toISOString() },
      } : q));
      setRespondTarget(null);
      setIsEditing(false);
      setRespondForm({ estimatedAmount: '', estimatedDays: '', note: '' });
      toast('success', '[데모] 견적이 제출되었습니다.');
      return;
    }

    setSubmitting(true);
    try {
      const amount = Number(respondForm.estimatedAmount.replace(/[^0-9]/g, ''));
      const days = respondForm.estimatedDays ? Number(respondForm.estimatedDays) : null;
      const res = await fetch('/api/partner/quotes/respond', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getSession()}`,
        },
        body: JSON.stringify({
          quoteId: respondTarget.id,
          estimatedAmount: amount,
          estimatedDays: days,
          note: respondForm.note,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? '견적 제출 실패');
      }
      // 서버 응답(snake_case)이 아닌 로컬 상태로 업데이트 — 타입 불일치 방지
      setQuotes(prev => prev.map(q => q.id === respondTarget.id ? {
        ...q,
        status: 'responded',
        partnerResponse: {
          estimatedAmount: amount,
          estimatedDays: days,
          note: respondForm.note,
          respondedAt: new Date().toISOString(),
        },
      } : q));
      setRespondTarget(null);
      setIsEditing(false);
      setRespondForm({ estimatedAmount: '', estimatedDays: '', note: '' });
      toast('success', isEditing ? '견적이 수정되었습니다.' : '견적이 제출되었습니다.');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : '견적 제출에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="flex-1 p-6 bg-gray-50 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse bg-gray-200 rounded h-7 w-28 mb-2" />
          <div className="animate-pulse bg-gray-100 rounded h-4 w-56 mb-6" />
          <div className="space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
                <div className="flex gap-2">
                  <div className="animate-pulse bg-gray-100 rounded-full h-6 w-20" />
                  <div className="animate-pulse bg-gray-100 rounded h-6 w-32" />
                </div>
                <div className="animate-pulse bg-gray-200 rounded h-5 w-2/3" />
                <div className="animate-pulse bg-gray-100 rounded h-4 w-1/3" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 p-6 overflow-auto pb-20 md:pb-6 bg-gray-50 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black text-gray-900">견적 요청</h1>
              <p className="text-sm text-gray-500 mt-1">어드민이 지정한 견적 요청 목록</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <PartnerNotificationBell session={getSession()} />
            {/* AI 도구 버튼 그룹 — 데스크톱: 인라인, 모바일: 드롭다운 */}
            <div className="relative shrink-0">
              {/* 모바일: 드롭다운 토글 버튼 */}
              <button
                onClick={() => setAiMenuOpen(o => !o)}
                className="md:hidden px-4 py-2 text-sm font-bold rounded-xl bg-gray-800 text-white hover:bg-gray-700 transition flex items-center gap-2"
              >
                ⚙ AI 도구 {aiMenuOpen ? '▲' : '▼'}
              </button>

              {/* 모바일 드롭다운 바깥 클릭 오버레이 */}
              {aiMenuOpen && (
                <div className="md:hidden fixed inset-0 z-30" onClick={() => setAiMenuOpen(false)} />
              )}

              {/* 모바일 드롭다운 */}
              {aiMenuOpen && (
                <div className="md:hidden absolute right-0 top-12 z-40 bg-white border border-gray-200 rounded-2xl shadow-xl overflow-hidden w-48">
                  {quotes.filter(q => q.status === 'pending' || q.status === 'responded').length > 0 && (
                    <button
                      onClick={() => { setShowOrderPriority(true); setAiMenuOpen(false); }}
                      className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800"
                    >
                      🏆 AI 우선순위
                    </button>
                  )}
                  <button
                    onClick={() => { setShowCapacityMatch(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    🔗 캐파 매칭
                  </button>
                  <button
                    onClick={() => { setShowQuoteAccuracy(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    📊 견적 정확도
                  </button>
                  <button
                    onClick={() => { setShowAIHistory(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    📜 AI 이력
                  </button>
                  <button
                    onClick={() => { setShowOrders(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    📦 주문 관리
                  </button>
                  <button
                    onClick={() => { setShowStats(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    📈 실적 통계
                  </button>
                  <button
                    onClick={() => { setShowAIPrefs(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    ⚙️ AI 기본값 설정
                  </button>
                </div>
              )}

              {/* 데스크톱: 인라인 버튼 */}
              <div className="hidden md:flex gap-2">
                {quotes.filter(q => q.status === 'pending' || q.status === 'responded').length > 0 && (
                  <button
                    onClick={() => setShowOrderPriority(true)}
                    className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700 transition flex items-center gap-2"
                  >
                    🏆 AI 우선순위
                  </button>
                )}
                <button
                  onClick={() => setShowCapacityMatch(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:from-teal-700 hover:to-cyan-700 transition flex items-center gap-2"
                >
                  🔗 캐파 매칭
                </button>
                <button
                  onClick={() => setShowQuoteAccuracy(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transition flex items-center gap-2"
                >
                  📊 견적 정확도
                </button>
                <button
                  onClick={() => setShowAIHistory(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gray-800 text-white hover:bg-gray-700 transition flex items-center gap-2"
                >
                  📜 AI 이력
                </button>
                <button
                  onClick={() => setShowOrders(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 text-white hover:from-orange-700 hover:to-amber-700 transition flex items-center gap-2"
                >
                  📦 주문 관리
                </button>
                <button
                  onClick={() => setShowStats(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700 transition flex items-center gap-2"
                >
                  📈 실적 통계
                </button>
                <button
                  onClick={() => setShowAIPrefs(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gray-700 text-white hover:bg-gray-600 transition flex items-center gap-2"
                >
                  ⚙️ AI 설정
                </button>
              </div>
            </div>
            </div>
          </div>

          {/* Tab bar */}
          {quotes.length > 0 && (
            <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-xl">
              {QUOTE_TABS.map(({ key, label }) => {
                const count = key === 'all' ? quotes.length : quotes.filter(q =>
                  key === 'pending' ? ['pending', 'responded'].includes(q.status) : q.status === key
                ).length;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                      activeTab === key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {label}
                    {count > 0 && (
                      <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                        activeTab === key ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {fetchError ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
              <p className="text-sm text-red-400 mb-4">견적 목록을 불러오지 못했습니다.</p>
              <button
                onClick={() => { setFetchError(false); setLoading(true); const s = localStorage.getItem('partnerSession') || ''; fetchQuotes(s).finally(() => setLoading(false)); }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                다시 시도
              </button>
            </div>
          ) : (() => {
            const tabFiltered = quotes.filter(q => {
              if (activeTab === 'all')      return true;
              if (activeTab === 'pending')  return ['pending', 'responded'].includes(q.status);
              return q.status === activeTab;
            });

            if (quotes.length === 0) {
              return (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
                  <div className="text-4xl mb-3">📝</div>
                  <p className="text-sm font-semibold text-gray-500 mb-1">배정된 견적 요청이 없습니다</p>
                  <p className="text-xs text-gray-400">어드민이 견적을 배정하면 여기에 표시됩니다.</p>
                </div>
              );
            }

            if (tabFiltered.length === 0) {
              const EMPTY_TAB: Record<QuoteTab, string> = {
                all:      '견적이 없습니다.',
                pending:  '검토 중인 견적이 없습니다.',
                accepted: '수락된 견적이 없습니다.',
                rejected: '거절된 견적이 없습니다.',
                expired:  '만료된 견적이 없습니다.',
              };
              return (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-14 text-center">
                  <div className="text-4xl mb-3">📋</div>
                  <p className="text-sm text-gray-400 font-medium">{EMPTY_TAB[activeTab]}</p>
                </div>
              );
            }

            return (
              <div className="space-y-4">
                {tabFiltered.map(quote => {
                  const dday = quote.validUntil ? formatDday(quote.validUntil) : null;
                  return (
                    <div key={quote.id} className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-colors ${selectedIds.has(quote.id) ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100'}`}>
                      <div className="px-5 py-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap mb-1">
                              {(quote.status === 'pending' || quote.status === 'responded') && (
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(quote.id)}
                                  onChange={() => toggleSelect(quote.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                  aria-label="견적 선택"
                                />
                              )}
                              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[quote.status] || 'bg-gray-100 text-gray-500'}`}>
                                {STATUS_LABELS[quote.status] || quote.status}
                              </span>
                              {/* D-day expiry badge */}
                              {dday && (
                                <span
                                  className="text-xs font-bold px-2 py-0.5 rounded-full border"
                                  style={{ color: dday.color, borderColor: dday.color + '55', background: dday.color + '12' }}
                                >
                                  {dday.label}
                                </span>
                              )}
                              <span className="text-xs text-gray-400 font-mono">{quote.id.slice(0, 8)}</span>
                              {(quote.dfmScore != null) && (
                                <DfmScoreBadge score={quote.dfmScore} process={quote.dfmProcess} size="sm" />
                              )}
                            </div>
                            <h3 className="text-base font-bold text-gray-900">{quote.projectName}</h3>
                            <div className="text-sm text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                              <span className="font-semibold">{won(quote.estimatedAmount)}</span>
                              {quote.validUntil && (
                                <span className="text-gray-400">유효: {formatDate(quote.validUntil)}</span>
                              )}
                            </div>
                            {quote.details && (
                              <p className="text-sm text-gray-600 mt-2 bg-gray-50 rounded-lg px-3 py-2">
                                {quote.details}
                              </p>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div className="flex flex-col gap-2 shrink-0">
                            {quote.status === 'pending' && (
                              <button
                                onClick={() => {
                                  setRespondTarget(quote);
                                  setIsEditing(false);
                                  setRespondForm({ estimatedAmount: String(quote.estimatedAmount), estimatedDays: '', note: '' });
                                }}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg transition"
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
                                    estimatedDays: String(quote.partnerResponse?.estimatedDays ?? ''),
                                    note: quote.partnerResponse?.note || '',
                                  });
                                }}
                                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold rounded-lg transition"
                              >
                                수정
                              </button>
                            )}
                            {/* PDF download */}
                            <button
                              onClick={() => downloadQuotePdf(quote)}
                              className="px-3 py-1.5 text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg transition flex items-center gap-1"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                              견적서 PDF
                            </button>
                          </div>
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
                        {quote.rfqId && getSession() !== 'demo' && (
                          <div className="mt-3 border-t border-gray-100 pt-3">
                            <RfqCadFilesPanel
                              rfqId={quote.rfqId}
                              isKo
                              authToken={getSession()}
                              compact
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
                  );
                })}
              </div>
            );
          })()}
        </div>

      {/* 견적 제출/수정 모달 */}
      {respondTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setRespondTarget(null); setIsEditing(false); setAutoQuoteResult(null); }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-gray-900 text-white px-6 py-4">
              <h2 className="text-lg font-bold">{isEditing ? '견적 수정' : '견적 제출'}</h2>
              <p className="text-sm text-gray-400 mt-0.5">{respondTarget.projectName}</p>
            </div>
            <form onSubmit={handleRespond} className="p-6 space-y-4">
              <button
                type="button"
                onClick={() => setAiDraftTarget(respondTarget)}
                className="w-full py-2 text-sm font-bold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white transition flex items-center justify-center gap-2"
              >
                🤖 AI 회신 초안 (자동 작성)
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={autoQuoting}
                  onClick={() => runAutoQuote(false)}
                  className="py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50"
                >
                  {autoQuoting ? '계산 중…' : '📋 단가표 자동 견적'}
                </button>
                <button
                  type="button"
                  disabled={autoQuoting}
                  onClick={() => runAutoQuote(true)}
                  className="py-2 text-sm font-bold rounded-lg border border-emerald-600 text-emerald-700 hover:bg-emerald-50 transition disabled:opacity-50"
                >
                  ⚡ 긴급 단가
                </button>
              </div>

              {autoQuoteResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-xs text-gray-700 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-700">단가표 기준 자동 견적</span>
                    {autoQuoteResult.breakdown.expressApplied && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold text-[10px]">긴급 ×</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>총액</span>
                    <span className="font-bold text-gray-900">{autoQuoteResult.totalKrw.toLocaleString('ko-KR')}원</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>단가 (개당)</span>
                    <span>{autoQuoteResult.unitKrw.toLocaleString('ko-KR')}원</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 border-t border-emerald-100 mt-1">
                    <div>재료 {autoQuoteResult.breakdown.materialKrw.toLocaleString('ko-KR')}</div>
                    <div>가공 {autoQuoteResult.breakdown.machineKrw.toLocaleString('ko-KR')}</div>
                    <div>셋업 {autoQuoteResult.breakdown.setupKrw.toLocaleString('ko-KR')}</div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>수량 할인</span><span>{autoQuoteResult.breakdown.volumeDiscountPct}%</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>리드타임</span><span>{autoQuoteResult.leadTimeDays.min}~{autoQuoteResult.leadTimeDays.max}일</span>
                  </div>
                  {autoQuoteResult.warnings.length > 0 && (
                    <ul className="text-[11px] text-amber-700 mt-1 space-y-0.5">
                      {autoQuoteResult.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                    </ul>
                  )}
                </div>
              )}
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
                  onClick={() => { setRespondTarget(null); setIsEditing(false); setAutoQuoteResult(null); }}
                  className="px-5 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  취소
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showOrderPriority && (
        <OrderPriorityPanel
          quotes={quotes
            .filter(q => q.status === 'pending' || q.status === 'responded')
            .map(q => ({
              id: q.id,
              projectName: q.projectName,
              estimatedAmount: q.estimatedAmount,
              status: q.status,
              dfmScore: q.dfmScore ?? null,
              dfmProcess: q.dfmProcess ?? null,
              validUntil: q.validUntil ?? null,
              details: q.details ?? null,
              bbox: q.bbox ?? null,
            }))}
          onClose={() => setShowOrderPriority(false)}
          onSelectQuote={(id) => {
            const target = quotes.find(q => q.id === id) ?? null;
            if (target) {
              setRespondTarget(target);
              setIsEditing(false);
              setRespondForm({ estimatedAmount: String(target.estimatedAmount), estimatedDays: '', note: '' });
            }
          }}
        />
      )}

      {showCapacityMatch && (
        <CapacityMatchPanel
          quotes={quotes.map(q => ({
            id: q.id,
            rfqId: q.rfqId,
            projectName: q.projectName,
            estimatedAmount: q.estimatedAmount,
            dfmScore: q.dfmScore ?? null,
            dfmProcess: q.dfmProcess ?? null,
            validUntil: q.validUntil,
          }))}
          company={partner?.company}
          onClose={() => setShowCapacityMatch(false)}
        />
      )}

      {showQuoteAccuracy && (
        <QuoteAccuracyPanel
          session={getSession()}
          onClose={() => setShowQuoteAccuracy(false)}
          onResult={(bias) => setAccuracyAdjustment(bias)}
        />
      )}

      {showAIHistory && (
        <PartnerAIHistoryPanel
          session={getSession()}
          onClose={() => setShowAIHistory(false)}
        />
      )}

      {showStats && (
        <PartnerStatsPanel
          quotes={quotes}
          company={partner?.company}
          onClose={() => setShowStats(false)}
        />
      )}

      {showOrders && (
        <PartnerOrdersPanel
          session={getSession()}
          onClose={() => setShowOrders(false)}
        />
      )}

      {aiDraftTarget && (
        <RfqResponderPanel
          rfq={{
            quoteId: aiDraftTarget.id,
            projectName: aiDraftTarget.projectName,
            partName: aiDraftTarget.projectName,
            budgetKrw: aiDraftTarget.estimatedAmount,
            dfmScore: aiDraftTarget.dfmScore ?? null,
            process: aiDraftTarget.dfmProcess ?? undefined,
            bbox: aiDraftTarget.bbox ?? null,
            customerNote: aiDraftTarget.details,
            deadline: aiDraftTarget.validUntil,
          }}
          defaultPartner={{
            hourlyRateKrw: aiPrefs.hourlyRateKrw ?? 80000,
            materialMargin: aiPrefs.materialMargin ?? 0.35,
            leadCapacityDays: aiPrefs.leadCapacityDays,
            certifications: aiPrefs.certifications ?? [],
            processes: aiPrefs.processes ?? [],
          }}
          accuracyAdjustment={accuracyAdjustment}
          onApply={(next) => {
            setRespondForm(next);
            toast('success', 'AI 초안이 적용되었습니다. 검토 후 제출해주세요.');
          }}
          onClose={() => setAiDraftTarget(null)}
        />
      )}

      {showAIPrefs && (
        <PartnerAIPrefsPanel
          session={getSession()}
          initial={aiPrefs}
          onSave={(prefs) => setAiPrefs(prefs)}
          onClose={() => setShowAIPrefs(false)}
        />
      )}

      {/* ── Bulk action bar — sticks to bottom while selection is non-empty ─ */}
      {selectedIds.size > 0 && (
        <div
          role="toolbar"
          aria-label="견적 일괄 작업"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white shadow-2xl border border-gray-200 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3 max-w-3xl"
        >
          <span className="text-sm font-bold text-gray-800">
            {selectedIds.size}건 선택
          </span>

          <div className="h-5 w-px bg-gray-200" />

          <label className="flex items-center gap-2 text-sm text-gray-600">
            유효기간
            <input
              type="date"
              value={bulkValidUntil}
              onChange={(e) => setBulkValidUntil(e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() => runBulk('extend_validity')}
              disabled={bulkBusy !== null}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {bulkBusy === 'extend' ? '적용 중…' : '일괄 연장'}
            </button>
          </label>

          <div className="h-5 w-px bg-gray-200" />

          <button
            type="button"
            onClick={() => runBulk('decline')}
            disabled={bulkBusy !== null}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
          >
            {bulkBusy === 'decline' ? '거절 중…' : '일괄 거절'}
          </button>

          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-gray-500 hover:text-gray-700 px-2"
          >
            선택 해제
          </button>
        </div>
      )}
    </main>
  );
}
