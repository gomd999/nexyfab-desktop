'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useToast } from '@/components/ToastProvider';
import { formatDate, formatDday } from '@/lib/formatDate';
import RfqCadFilesPanel from '@/components/nexyfab/RfqCadFilesPanel';
import DfmScoreBadge from '@/components/nexyfab/DfmScoreBadge';

// RfqModelViewer pulls in Three.js + OCCT — load only when actually rendered.
const RfqModelViewer = dynamic(() => import('@/components/nexyfab/RfqModelViewer'), { ssr: false });

const RfqResponderPanel = dynamic(() => import('./RfqResponderPanel'), { ssr: false });
const OrderPriorityPanel = dynamic(() => import('./OrderPriorityPanel'), { ssr: false });
const CapacityMatchPanel = dynamic(() => import('./CapacityMatchPanel'), { ssr: false });
const QuoteAccuracyPanel = dynamic(() => import('./QuoteAccuracyPanel'), { ssr: false });
const PartnerAIHistoryPanel = dynamic(() => import('./PartnerAIHistoryPanel'), { ssr: false });
const PartnerStatsPanel = dynamic(() => import('./PartnerStatsPanel'), { ssr: false });
const PartnerAIPrefsPanel = dynamic(() => import('./PartnerAIPrefsPanel'), { ssr: false });
const PartnerOrdersPanel = dynamic(() => import('./PartnerOrdersPanel'), { ssr: false });
import PartnerNotificationBell from './PartnerNotificationBell';
import PartnerProBadge from '@/components/nexyfab/PartnerProBadge';
import { loadLocalAiPrefs, type AiPrefs } from './PartnerAIPrefsPanel';
import { usePartnerLang } from '../_lib/partnerLang';
import { quotesDict, type QuotesDict } from '../_lib/dicts/quotes';

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

const STATUS_COLORS: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-700',
  responded: 'bg-blue-100 text-blue-700',
  accepted:  'bg-green-100 text-green-700',
  rejected:  'bg-red-100 text-red-600',
  expired:   'bg-gray-100 text-gray-500',
};

function statusText(s: string, t: QuotesDict): string {
  const key = `status_${s}` as keyof QuotesDict;
  const v = t[key];
  return typeof v === 'string' ? v : s;
}

type QuoteTab = 'all' | 'pending' | 'accepted' | 'rejected' | 'expired';

const LOCALE_FOR_LANG: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
};
function fmtMoney(n: number, lang: string): string {
  try {
    return new Intl.NumberFormat(LOCALE_FOR_LANG[lang] ?? 'en-US', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(n);
  } catch { return `₩${n?.toLocaleString() ?? '0'}`; }
}

// ── PDF download — uses server-side jsPDF endpoint ───────────────────────────
function downloadQuotePdf(quote: Quote) {
  window.open(`/api/quotes/${quote.id}/pdf`, '_blank', 'noopener,noreferrer');
}


export default function PartnerQuotesPage() {
  const router = useRouter();
  const { toast } = useToast();
  const lang = usePartnerLang();
  const t = quotesDict(lang);
  const QUOTE_TABS: { key: QuoteTab; label: string }[] = [
    { key: 'all',      label: t.tabAll },
    { key: 'pending',  label: t.tabPending },
    { key: 'accepted', label: t.tabAccepted },
    { key: 'rejected', label: t.tabRejected },
    { key: 'expired',  label: t.tabExpired },
  ];
  const [partner, setPartner] = useState<Partner | null>(null);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading]     = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [activeTab, setActiveTab] = useState<QuoteTab>('all');
  const [invitationsCount, setInvitationsCount] = useState<number | null>(null);

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
    if (action === 'decline' && !confirm(t.bulkConfirmDecline(selectedIds.size))) return;

    const session = getSession();
    if (!session || session === 'demo') {
      // Demo mode: mutate local state only.
      setQuotes(prev => prev.map(q => {
        if (!selectedIds.has(q.id)) return q;
        if (action === 'decline') return { ...q, status: 'rejected' };
        return { ...q, validUntil: bulkValidUntil };
      }));
      clearSelection();
      toast('success', t.bulkDemoSuccess(selectedIds.size));
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
        throw new Error(err.error ?? t.bulkErrFailed);
      }
      const data = await res.json() as { updated: number; skipped: number };
      toast('success', t.bulkSuccess(data.updated, data.skipped));
      clearSelection();
      await fetchQuotes(session);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : t.bulkErrFailed);
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

  // Concierge invitation count — separate fetch since it joins concierge_status,
  // not nf_quotes. Light call, refresh on focus so newly-pushed invites appear.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const session = getSession();
      if (!session || session === 'demo') return;
      try {
        const res = await fetch('/api/partner/invitations', {
          headers: { Authorization: `Bearer ${session}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json() as { invitations?: unknown[] };
        if (!cancelled) setInvitationsCount(Array.isArray(data.invitations) ? data.invitations.length : 0);
      } catch { /* silent */ }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => { cancelled = true; window.removeEventListener('focus', onFocus); };
  }, []);

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
        warnings: [t.toastAutoQuoteDemoWarning],
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
      alert(t.toastAutoQuoteFailed);
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
      toast('success', t.toastDemoSubmit);
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
        throw new Error(errData.error ?? t.toastSubmitFail);
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
      toast('success', isEditing ? t.toastEditOk : t.toastSubmitOk);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : t.toastSubmitFail);
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
              <h1 className="text-2xl font-black text-gray-900">{t.pageHeader}</h1>
              <p className="text-sm text-gray-500 mt-1">{t.pageSubheader}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <PartnerNotificationBell session={getSession()} />
              <PartnerProBadge session={getSession()} />
            {/* AI 도구 버튼 그룹 — 데스크톱: 인라인, 모바일: 드롭다운 */}
            <div className="relative shrink-0">
              {/* 모바일: 드롭다운 토글 버튼 */}
              <button
                onClick={() => setAiMenuOpen(o => !o)}
                className="md:hidden px-4 py-2 text-sm font-bold rounded-xl bg-gray-800 text-white hover:bg-gray-700 transition flex items-center gap-2"
              >
                {t.aiMenuToggle} {aiMenuOpen ? '▲' : '▼'}
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
                      {t.aiBtnPriority}
                    </button>
                  )}
                  <button
                    onClick={() => { setShowCapacityMatch(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    {t.aiBtnCapacity}
                  </button>
                  <button
                    onClick={() => { setShowQuoteAccuracy(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    {t.aiBtnAccuracy}
                  </button>
                  <button
                    onClick={() => { setShowAIHistory(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    {t.aiBtnHistory}
                  </button>
                  <button
                    onClick={() => { setShowOrders(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    {t.aiBtnOrders}
                  </button>
                  <button
                    onClick={() => { setShowStats(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    {t.aiBtnStats}
                  </button>
                  <button
                    onClick={() => { setShowAIPrefs(true); setAiMenuOpen(false); }}
                    className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-gray-50 flex items-center gap-2 text-gray-800 border-t border-gray-100"
                  >
                    {t.aiBtnPrefs}
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
                    {t.aiBtnPriority}
                  </button>
                )}
                <button
                  onClick={() => setShowCapacityMatch(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 text-white hover:from-teal-700 hover:to-cyan-700 transition flex items-center gap-2"
                >
                  {t.aiBtnCapacity}
                </button>
                <button
                  onClick={() => setShowQuoteAccuracy(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 transition flex items-center gap-2"
                >
                  {t.aiBtnAccuracy}
                </button>
                <button
                  onClick={() => setShowAIHistory(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gray-800 text-white hover:bg-gray-700 transition flex items-center gap-2"
                >
                  {t.aiBtnHistory}
                </button>
                <button
                  onClick={() => setShowOrders(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 text-white hover:from-orange-700 hover:to-amber-700 transition flex items-center gap-2"
                >
                  {t.aiBtnOrders}
                </button>
                <button
                  onClick={() => setShowStats(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 text-white hover:from-green-700 hover:to-emerald-700 transition flex items-center gap-2"
                >
                  {t.aiBtnStats}
                </button>
                <button
                  onClick={() => setShowAIPrefs(true)}
                  className="px-4 py-2 text-sm font-bold rounded-xl bg-gray-700 text-white hover:bg-gray-600 transition flex items-center gap-2"
                >
                  {t.aiBtnPrefs}
                </button>
              </div>
            </div>
            </div>
          </div>

          {/* Concierge invitations banner — appears above tabs when ops has
              recommended this partner for a fresh RFQ that they haven't quoted. */}
          {invitationsCount !== null && invitationsCount > 0 && (
            <Link
              href="/partner/invitations"
              className="block mb-4 p-4 rounded-xl bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 hover:border-blue-400 transition group"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">📥</div>
                  <div>
                    <div className="text-sm font-bold text-blue-900">
                      {t.invitationsBannerTitle(invitationsCount ?? 0)}
                    </div>
                    <div className="text-xs text-blue-700 mt-0.5">
                      {t.invitationsBannerBody}
                    </div>
                  </div>
                </div>
                <div className="text-blue-600 font-bold text-sm group-hover:translate-x-1 transition">
                  →
                </div>
              </div>
            </Link>
          )}

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
              <p className="text-sm text-red-400 mb-4">{t.fetchErrorTitle}</p>
              <button
                onClick={() => { setFetchError(false); setLoading(true); const s = localStorage.getItem('partnerSession') || ''; fetchQuotes(s).finally(() => setLoading(false)); }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {t.retryBtn}
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
                  <p className="text-sm font-semibold text-gray-500 mb-1">{t.emptyAssigned}</p>
                  <p className="text-xs text-gray-400">{t.emptyAssignedHint}</p>
                </div>
              );
            }

            if (tabFiltered.length === 0) {
              const EMPTY_TAB: Record<QuoteTab, string> = {
                all:      t.emptyAll,
                pending:  t.emptyPending,
                accepted: t.emptyAccepted,
                rejected: t.emptyRejected,
                expired:  t.emptyExpired,
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
                                  aria-label={t.selectAria}
                                />
                              )}
                              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[quote.status] || 'bg-gray-100 text-gray-500'}`}>
                                {statusText(quote.status, t)}
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
                              <span className="font-semibold">{fmtMoney(quote.estimatedAmount, lang)}</span>
                              {quote.validUntil && (
                                <span className="text-gray-400">{t.validUntil(formatDate(quote.validUntil))}</span>
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
                                {t.btnSubmitQuote}
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
                                {t.btnEditQuote}
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
                              {t.btnQuotePdf}
                            </button>
                          </div>
                        </div>

                        {/* 3D 모델 뷰어 */}
                        {(quote.shareToken || quote.rfqId) && (
                          <div className="mt-3 border-t border-gray-100 pt-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.modelSectionTitle}</p>
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
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t.submittedQuoteTitle}</p>
                            <div className="bg-blue-50 rounded-xl px-4 py-3 space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="text-gray-600">{t.submittedAmount}</span>
                                <span className="font-bold text-gray-900">{fmtMoney(quote.partnerResponse.estimatedAmount, lang)}</span>
                              </div>
                              {quote.partnerResponse.estimatedDays && (
                                <div className="flex justify-between text-sm">
                                  <span className="text-gray-600">{t.submittedDays}</span>
                                  <span className="font-semibold text-gray-900">{t.submittedDaysUnit(quote.partnerResponse.estimatedDays!)}</span>
                                </div>
                              )}
                              {quote.partnerResponse.note && (
                                <div className="text-sm text-gray-600 mt-1">{quote.partnerResponse.note}</div>
                              )}
                              <div className="text-xs text-gray-400 mt-1">
                                {t.submittedAt(formatDate(quote.partnerResponse.respondedAt))}
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
              <h2 className="text-lg font-bold">{isEditing ? t.modalEdit : t.modalNew}</h2>
              <p className="text-sm text-gray-400 mt-0.5">{respondTarget.projectName}</p>
            </div>
            <form onSubmit={handleRespond} className="p-6 space-y-4">
              <button
                type="button"
                onClick={() => setAiDraftTarget(respondTarget)}
                className="w-full py-2 text-sm font-bold rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white transition flex items-center justify-center gap-2"
              >
                {t.modalAiDraft}
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={autoQuoting}
                  onClick={() => runAutoQuote(false)}
                  className="py-2 text-sm font-bold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-50"
                >
                  {autoQuoting ? t.modalAutoCalcLoading : t.modalAutoCalc}
                </button>
                <button
                  type="button"
                  disabled={autoQuoting}
                  onClick={() => runAutoQuote(true)}
                  className="py-2 text-sm font-bold rounded-lg border border-emerald-600 text-emerald-700 hover:bg-emerald-50 transition disabled:opacity-50"
                >
                  {t.modalUrgentBtn}
                </button>
              </div>

              {autoQuoteResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-xs text-gray-700 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-700">{t.modalAutoResultTitle}</span>
                    {autoQuoteResult.breakdown.expressApplied && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold text-[10px]">{t.modalUrgentBadge}</span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t.modalLabelTotal}</span>
                    <span className="font-bold text-gray-900">{fmtMoney(autoQuoteResult.totalKrw, lang)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t.modalLabelUnit}</span>
                    <span>{fmtMoney(autoQuoteResult.unitKrw, lang)}</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px] pt-1 border-t border-emerald-100 mt-1">
                    <div>{t.modalLabelMaterial} {fmtMoney(autoQuoteResult.breakdown.materialKrw, lang)}</div>
                    <div>{t.modalLabelMachine} {fmtMoney(autoQuoteResult.breakdown.machineKrw, lang)}</div>
                    <div>{t.modalLabelSetup} {fmtMoney(autoQuoteResult.breakdown.setupKrw, lang)}</div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>{t.modalLabelVolumeDiscount}</span><span>{autoQuoteResult.breakdown.volumeDiscountPct}%</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-gray-500">
                    <span>{t.modalLabelLeadTime}</span><span>{t.modalLabelLeadTimeRange(autoQuoteResult.leadTimeDays.min, autoQuoteResult.leadTimeDays.max)}</span>
                  </div>
                  {autoQuoteResult.warnings.length > 0 && (
                    <ul className="text-[11px] text-amber-700 mt-1 space-y-0.5">
                      {autoQuoteResult.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
                    </ul>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.modalFieldAmount}</label>
                <input
                  type="number"
                  value={respondForm.estimatedAmount}
                  onChange={e => setRespondForm(f => ({ ...f, estimatedAmount: e.target.value }))}
                  required
                  min={0}
                  placeholder={t.modalFieldAmountPh}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.modalFieldDays}</label>
                <input
                  type="number"
                  value={respondForm.estimatedDays}
                  onChange={e => setRespondForm(f => ({ ...f, estimatedDays: e.target.value }))}
                  min={1}
                  placeholder={t.modalFieldDaysPh}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">{t.modalFieldNote}</label>
                <textarea
                  value={respondForm.note}
                  onChange={e => setRespondForm(f => ({ ...f, note: e.target.value }))}
                  rows={3}
                  placeholder={t.modalFieldNotePh}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-blue-400 resize-none"
                />
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  type="submit"
                  disabled={submitting || !respondForm.estimatedAmount}
                  className="flex-1 py-2.5 text-sm font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 transition"
                >
                  {submitting ? t.modalSubmitting : isEditing ? t.modalSubmitEdit : t.modalSubmit}
                </button>
                <button
                  type="button"
                  onClick={() => { setRespondTarget(null); setIsEditing(false); setAutoQuoteResult(null); }}
                  className="px-5 py-2.5 text-sm font-semibold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                >
                  {t.modalCancel}
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
            toast('success', t.toastAiDraftApplied);
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
          aria-label={t.bulkToolbarLabel}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white shadow-2xl border border-gray-200 rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3 max-w-3xl"
        >
          <span className="text-sm font-bold text-gray-800">
            {t.bulkSelected(selectedIds.size)}
          </span>

          <div className="h-5 w-px bg-gray-200" />

          <label className="flex items-center gap-2 text-sm text-gray-600">
            {t.bulkValidLabel}
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
              {bulkBusy === 'extend' ? t.bulkExtending : t.bulkExtendBtn}
            </button>
          </label>

          <div className="h-5 w-px bg-gray-200" />

          <button
            type="button"
            onClick={() => runBulk('decline')}
            disabled={bulkBusy !== null}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
          >
            {bulkBusy === 'decline' ? t.bulkDeclining : t.bulkDeclineBtn}
          </button>

          <button
            type="button"
            onClick={clearSelection}
            className="text-xs text-gray-500 hover:text-gray-700 px-2"
          >
            {t.bulkClearSelection}
          </button>
        </div>
      )}
    </main>
  );
}
