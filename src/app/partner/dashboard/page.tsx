'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import PartnerNotificationBell from '@/app/components/PartnerNotificationBell';
import { formatDate } from '@/lib/formatDate';
import { usePartnerLang } from '../_lib/partnerLang';
import { dashboardDict, type DashboardDict } from '../_lib/dicts/dashboard';

// ─── helpers ─────────────────────────────────────────────────────────────────

const LOCALE_FOR_LANG: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
};

function fmtMoney(n: number | null | undefined, lang: string) {
  if (n == null) return '-';
  try {
    return new Intl.NumberFormat(LOCALE_FOR_LANG[lang] ?? 'en-US', {
      style: 'currency', currency: 'KRW', maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₩${n.toLocaleString()}`;
  }
}

function getDaysLeft(deadline: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(deadline); due.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

function statusText(s: string, t: DashboardDict): string {
  const key = `status_${s}` as keyof DashboardDict;
  const v = t[key];
  return typeof v === 'string' ? v : s;
}

// ─── types ────────────────────────────────────────────────────────────────────

interface DashboardData {
  partner: { email: string; company: string; factoryId: string | null; factoryName: string };
  stats: {
    totalAssigned: number; pendingQuotes: number; activeContracts: number;
    completedContracts: number; avgResponseHours: number | null; winRate: number | null;
  };
  pendingRfqs: {
    id: string; shapeName: string; materialId: string; quantity: number;
    volume_cm3: number; dfmScore: number | null; note: string | null;
    assignedAt: string | null; createdAt: string;
  }[];
  activeContracts: {
    id: string; project_name: string; status: string;
    contract_amount: number | null; deadline: string | null;
    progress_percent: number; created_at: string; customer_email: string | null;
  }[];
  recentQuotes: {
    id: string; projectName: string; status: string;
    estimatedAmount: number | null; respondedAt: string | null; createdAt: string;
  }[];
}

const STATUS_COLORS: Record<string, string> = {
  contracted: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700',
  quality_check: 'bg-orange-100 text-orange-700', delivered: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-600',
};

const MATERIAL_LABELS: Record<string, string> = {
  pla: 'PLA', abs: 'ABS', petg: 'PETG', nylon: 'Nylon',
  aluminum: 'Aluminum', steel: 'Steel', titanium: 'Titanium',
};

// ─── QuoteModal ───────────────────────────────────────────────────────────────

interface QuoteModalProps {
  rfq: DashboardData['pendingRfqs'][0];
  session: string;
  onClose: () => void;
  onSubmitted: () => void;
  t: DashboardDict;
}
function QuoteModal({ rfq, session, onClose, onSubmitted, t }: QuoteModalProps) {
  const [amount, setAmount] = useState('');
  const [days, setDays] = useState('');
  const [note, setNote] = useState('');
  const [validDays, setValidDays] = useState('14');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!amount) { setError(t.qmErrAmount); return; }
    setLoading(true); setError('');
    try {
      const validUntil = new Date(Date.now() + Number(validDays) * 86_400_000).toISOString();
      const res = await fetch('/api/partner/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({
          rfqId: rfq.id, estimatedAmount: Number(amount),
          estimatedDays: days ? Number(days) : null, note, validUntil,
        }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || t.qmErrSubmit); return; }
      onSubmitted();
    } catch {
      setError(t.qmErrNetwork);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">{t.qmTitle}</h3>
          <p className="text-xs text-gray-400 mt-1 truncate">{rfq.shapeName} · {MATERIAL_LABELS[rfq.materialId] ?? rfq.materialId} · {rfq.quantity}{t.qtyUnit}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">{t.qmAmountLabel}</label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
              placeholder={t.qmAmountPlaceholder} min="0"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">{t.qmDaysLabel}</label>
              <input type="number" value={days} onChange={e => setDays(e.target.value)}
                placeholder={t.qmDaysPlaceholder} min="1"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">{t.qmValidLabel}</label>
              <input type="number" value={validDays} onChange={e => setValidDays(e.target.value)}
                min="1" max="90"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">{t.qmNoteLabel}</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              rows={3} placeholder={t.qmNotePlaceholder}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} disabled={loading}
            className="flex-1 py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
            {t.qmBtnCancel}
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-bold text-white transition disabled:opacity-50">
            {loading ? t.qmBtnSubmitting : t.qmBtnSubmit}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MilestoneModal ───────────────────────────────────────────────────────────

interface Milestone {
  id: string; title: string; description: string | null;
  status: string; dueDate: string | null; completedAt: string | null;
}

function MilestoneModal({
  contract, session, onClose, t,
}: {
  contract: DashboardData['activeContracts'][0];
  session: string;
  onClose: () => void;
  t: DashboardDict;
}) {
  const [items, setItems] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [newDue, setNewDue] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contract.id}/milestones`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      const d = await res.json();
      setItems(d.milestones ?? []);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [contract.id, session]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (ms: Milestone) => {
    const next = ms.status === 'completed' ? 'pending' : 'completed';
    await fetch(`/api/contracts/${contract.id}/milestones`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ milestoneId: ms.id, status: next }),
    });
    await load();
  };

  const addMilestone = async () => {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      await fetch(`/api/contracts/${contract.id}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ title: newTitle.trim(), dueDate: newDue || undefined }),
      });
      setNewTitle(''); setNewDue('');
      await load();
    } finally { setAdding(false); }
  };

  const doneCount = items.filter(m => m.status === 'completed').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[80vh] flex flex-col">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">{t.msTitle}</h3>
          <p className="text-xs text-gray-400 mt-1 truncate">{contract.project_name}</p>
          {!loading && (
            <p className="text-xs text-blue-600 mt-1 font-semibold">{t.msDoneOfTotal(doneCount, items.length)}</p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <p className="text-center text-gray-400 text-sm py-8">{t.msLoading}</p>
          ) : items.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-8">{t.msEmpty}</p>
          ) : (
            <div className="space-y-2">
              {items.map(ms => (
                <div key={ms.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-blue-200 transition-colors">
                  <button onClick={() => toggle(ms)}
                    aria-label={ms.status === 'completed' ? 'uncheck' : 'check'}
                    className={`w-5 h-5 rounded-[5px] border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                      ms.status === 'completed'
                        ? 'bg-green-500 border-green-500 text-white'
                        : 'border-gray-300 hover:border-blue-400'
                    }`}>
                    {ms.status === 'completed' && <span className="text-[10px]">✓</span>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${ms.status === 'completed' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                      {ms.title}
                    </p>
                    {ms.dueDate && (
                      <p className="text-[10px] text-gray-400 mt-0.5">{t.msDueLabel} {ms.dueDate}</p>
                    )}
                    {ms.completedAt && (
                      <p className="text-[10px] text-green-500 mt-0.5">{t.msCompletedLabel} {formatDate(ms.completedAt)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 space-y-2">
          <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
            placeholder={t.msNewPlaceholder}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
            onKeyDown={e => e.key === 'Enter' && addMilestone()} />
          <div className="flex gap-2">
            <input type="date" value={newDue} onChange={e => setNewDue(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition" />
            <button onClick={addMilestone} disabled={adding || !newTitle.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition disabled:opacity-50">
              {adding ? t.msBtnAdding : t.msBtnAdd}
            </button>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-50">
          <button onClick={onClose}
            className="w-full py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition">
            {t.msBtnClose}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ProgressModal ────────────────────────────────────────────────────────────

interface ProgressModalProps {
  contract: DashboardData['activeContracts'][0];
  session: string;
  onClose: () => void;
  onUpdated: () => void;
  t: DashboardDict;
}
function ProgressModal({ contract, session, onClose, onUpdated, t }: ProgressModalProps) {
  const [progress, setProgress] = useState(contract.progress_percent);
  const [status, setStatus] = useState(contract.status);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/partner/contracts/${contract.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
        body: JSON.stringify({ progressPercent: progress, status, note }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error || t.pmErrUpdate); return; }
      onUpdated();
    } catch {
      setError(t.pmErrNetwork);
    } finally {
      setLoading(false);
    }
  }

  const NEXT_STATUSES = ['in_progress', 'quality_check', 'delivered', 'completed'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="px-6 py-5 border-b border-gray-100">
          <h3 className="text-base font-bold text-gray-900">{t.pmTitle}</h3>
          <p className="text-xs text-gray-400 mt-1 truncate">{contract.project_name}</p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-2">{t.pmProgressLabel(progress)}</label>
            <input type="range" min="0" max="100" step="5"
              value={progress} onChange={e => setProgress(Number(e.target.value))}
              className="w-full accent-blue-600" />
            <div className="flex justify-between text-[10px] text-gray-400 mt-1">
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">{t.pmStatusLabel}</label>
            <div className="grid grid-cols-2 gap-2">
              {NEXT_STATUSES.map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`py-2 px-3 rounded-lg text-xs font-semibold border transition ${
                    status === s
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'border-gray-200 text-gray-600 hover:border-blue-300'
                  }`}>
                  {statusText(s, t)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">{t.pmNoteLabel}</label>
            <textarea value={note} onChange={e => setNote(e.target.value)}
              rows={3} placeholder={t.pmNotePlaceholder}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex gap-2">
          <button onClick={onClose} disabled={loading}
            className="flex-1 py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 transition disabled:opacity-50">
            {t.pmBtnCancel}
          </button>
          <button onClick={submit} disabled={loading}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 rounded-xl text-sm font-bold text-white transition disabled:opacity-50">
            {loading ? t.pmBtnSaving : t.pmBtnSave}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Demo data ───────────────────────────────────────────────────────────────

const DEMO_DATA: DashboardData = {
  partner: { email: 'demo-partner@nexyfab.com', company: 'Demo 제조사', factoryId: 'demo-factory-001', factoryName: 'Demo 제조사' },
  stats: { totalAssigned: 5, pendingQuotes: 2, activeContracts: 2, completedContracts: 3, avgResponseHours: 4.2, winRate: 72 },
  pendingRfqs: [
    { id: 'rfq-d1', shapeName: 'EV 배터리 브라켓', materialId: 'aluminum', quantity: 500, volume_cm3: 120, dfmScore: 88, note: '표면 처리 요청', assignedAt: new Date(Date.now() - 86400000).toISOString(), createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 'rfq-d2', shapeName: '스마트워치 하우징', materialId: 'abs', quantity: 1000, volume_cm3: 45, dfmScore: 94, note: null, assignedAt: new Date(Date.now() - 3600000).toISOString(), createdAt: new Date(Date.now() - 3600000).toISOString() },
  ],
  activeContracts: [
    { id: 'con-d1', project_name: 'IoT 모듈 PCB 조립', status: 'in_progress', contract_amount: 42000000, deadline: new Date(Date.now() + 14 * 86400000).toISOString(), progress_percent: 65, created_at: new Date(Date.now() - 30 * 86400000).toISOString(), customer_email: 'customer@nexyfab.com' },
    { id: 'con-d2', project_name: '의료기기 케이스 시제품', status: 'quality_check', contract_amount: 8500000, deadline: new Date(Date.now() + 3 * 86400000).toISOString(), progress_percent: 90, created_at: new Date(Date.now() - 20 * 86400000).toISOString(), customer_email: 'customer2@nexyfab.com' },
  ],
  recentQuotes: [
    { id: 'q-d1', projectName: 'EV 배터리 케이스 외주 제조', status: 'accepted', estimatedAmount: 28000000, respondedAt: new Date(Date.now() - 5 * 86400000).toISOString(), createdAt: new Date(Date.now() - 7 * 86400000).toISOString() },
    { id: 'q-d2', projectName: '다이캐스팅 하우징', status: 'pending', estimatedAmount: 15000000, respondedAt: new Date(Date.now() - 86400000).toISOString(), createdAt: new Date(Date.now() - 2 * 86400000).toISOString() },
    { id: 'q-d3', projectName: '산업용 로봇팔 부품', status: 'rejected', estimatedAmount: 55000000, respondedAt: new Date(Date.now() - 10 * 86400000).toISOString(), createdAt: new Date(Date.now() - 12 * 86400000).toISOString() },
  ],
};

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PartnerDashboardPage() {
  const router = useRouter();
  const lang = usePartnerLang();
  const t = dashboardDict(lang);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState('');
  const [tab, setTab] = useState<'pending' | 'active' | 'quotes' | 'settlements'>('pending');
  const [settlements, setSettlements] = useState<{
    settlements: { contractId: string; projectName: string; contractAmount: number; commissionAmount: number; netAmount: number; completedAt: string; month: string }[];
    summary: { totalRevenue: number; totalCommission: number; netRevenue: number; count: number };
  } | null>(null);
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [settlementMonth, setSettlementMonth] = useState('');
  const [quoteTarget, setQuoteTarget] = useState<DashboardData['pendingRfqs'][0] | null>(null);
  const [progressTarget, setProgressTarget] = useState<DashboardData['activeContracts'][0] | null>(null);
  const [milestoneTarget, setMilestoneTarget] = useState<DashboardData['activeContracts'][0] | null>(null);
  const [trustDims, setTrustDims] = useState<
    { id: string; labelKo: string; displayKo: string; sampleSize: number }[] | null
  >(null);

  const loadDashboard = useCallback(async (sess: string) => {
    if (sess === 'demo') { setData(DEMO_DATA); setLoading(false); return; }
    try {
      const res = await fetch('/api/partner/dashboard', {
        headers: { Authorization: `Bearer ${sess}` },
      });
      if (res.status === 401) { router.replace(`/partner/login?lang=${lang}`); return; }
      const d: DashboardData = await res.json();
      setData(d);
      localStorage.setItem('partnerInfo', JSON.stringify({ email: d.partner.email, company: d.partner.company }));
    } catch {
      /* keep existing */
    } finally {
      setLoading(false);
    }
  }, [router, lang]);

  useEffect(() => {
    const sess = localStorage.getItem('partnerSession');
    if (!sess) { router.replace(`/partner/login?lang=${lang}`); return; }
    setSession(sess);
    if (sess === 'demo') { setData(DEMO_DATA); setLoading(false); return; }
    loadDashboard(sess);
  }, [loadDashboard, router, lang]);

  const loadSettlements = useCallback(async (month = '') => {
    setSettlementsLoading(true);
    try {
      const url = `/api/partner/settlements${month ? `?month=${month}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${session}` } });
      if (res.ok) setSettlements(await res.json());
    } catch { /* ignore */ } finally {
      setSettlementsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!data?.partner.email) return;
    let cancelled = false;
    setTrustDims(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/nexyfab/partner-trust-aggregates?email=${encodeURIComponent(data.partner.email)}&windowDays=90`,
        );
        const j = (await res.json()) as { dimensions?: { id: string; labelKo: string; displayKo: string; sampleSize: number }[] };
        if (!cancelled) setTrustDims(Array.isArray(j.dimensions) ? j.dimensions : []);
      } catch {
        if (!cancelled) setTrustDims([]);
      }
    })();
    return () => { cancelled = true; };
  }, [data?.partner.email]);

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">{t.loading}</p>
      </div>
    );
  }

  const { partner, stats, pendingRfqs, activeContracts, recentQuotes } = data;

  const urgentContracts = activeContracts
    .filter(c => c.deadline && getDaysLeft(c.deadline) <= 7)
    .sort((a, b) => getDaysLeft(a.deadline!) - getDaysLeft(b.deadline!));

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="p-6 overflow-auto pb-24 md:pb-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black text-gray-900">{t.pageTitle}</h1>
              <p className="text-sm text-gray-500 mt-1">{partner.factoryName} {t.pageSubtitleSuffix}</p>
            </div>
            <PartnerNotificationBell session={session} lang={lang} />
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {[
              { label: t.statTotalAssigned, value: stats.totalAssigned + t.statUnit, color: 'text-gray-900' },
              { label: t.statPendingQuotes, value: stats.pendingQuotes + t.statUnit, color: 'text-blue-700' },
              { label: t.statActiveContracts, value: stats.activeContracts + t.statUnit, color: 'text-yellow-600' },
              { label: t.statCompletedContracts, value: stats.completedContracts + t.statUnit, color: 'text-green-600' },
              {
                label: t.statAvgResponse,
                value: stats.avgResponseHours != null ? stats.avgResponseHours + 'h' : '-',
                color: 'text-gray-900',
              },
              {
                label: t.statWinRate,
                value: stats.winRate != null ? stats.winRate + '%' : '-',
                color: stats.winRate != null && stats.winRate >= 60 ? 'text-green-600' : 'text-gray-700',
              },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider mb-1">{s.label}</p>
                <p className={`text-xl font-black ${s.color}`}>{s.value}</p>
              </div>
            ))}
          </div>

          {/* Multi-dimensional trust */}
          <div className="mb-6 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
            <p className="text-xs font-bold text-indigo-900 uppercase tracking-wider mb-2">{t.trustTitle}</p>
            {trustDims === null ? (
              <p className="text-xs text-indigo-700/80">{t.trustLoading}</p>
            ) : (
              <ul className="space-y-2">
                {trustDims.map(d => (
                  <li key={d.id} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3 text-sm">
                    <span className="font-semibold text-indigo-950 shrink-0 w-32">{d.labelKo}</span>
                    <span className="text-indigo-900 flex-1">{d.displayKo}</span>
                    {d.sampleSize > 0 && (
                      <span className="text-[11px] text-indigo-600/90 shrink-0">n={d.sampleSize}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-indigo-800/70 mt-2 leading-relaxed">{t.trustFooter}</p>
          </div>

          {/* Urgent deadline alerts */}
          {urgentContracts.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-bold text-red-600 uppercase tracking-widest mb-2">{t.urgentTitle(urgentContracts.length)}</p>
              <div className="space-y-2">
                {urgentContracts.map(c => {
                  const d = getDaysLeft(c.deadline!);
                  return (
                    <div key={c.id}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border ${d < 0 ? 'bg-red-100 border-red-300' : d <= 3 ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
                      <div>
                        <p className={`text-sm font-bold ${d < 0 ? 'text-red-800' : 'text-amber-800'}`}>{c.project_name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{t.urgentDeadlineLabel} {formatDate(c.deadline)}</p>
                      </div>
                      <span className={`text-sm font-black ${d < 0 ? 'text-red-700' : d === 0 ? 'text-red-600' : d <= 3 ? 'text-red-500' : 'text-amber-600'}`}>
                        {d < 0 ? t.urgentDplus(Math.abs(d)) : d === 0 ? t.urgentDday : t.urgentDminus(d)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-4 flex-wrap">
            {([
              { key: 'pending', label: t.tabPending(stats.pendingQuotes) },
              { key: 'active', label: t.tabActive(stats.activeContracts) },
              { key: 'quotes', label: t.tabQuotes(recentQuotes.length) },
              { key: 'settlements', label: t.tabSettlements },
            ] as const).map(tt => (
              <button key={tt.key} onClick={() => {
                setTab(tt.key);
                if (tt.key === 'settlements' && !settlements) loadSettlements(settlementMonth);
              }}
                className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold transition-colors ${
                  tab === tt.key ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {tt.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

            {tab === 'pending' && (
              pendingRfqs.length === 0 ? (
                <div className="py-16 text-center text-gray-400 text-sm">{t.emptyPending}</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {pendingRfqs.map(rfq => (
                    <div key={rfq.id} className="px-5 py-4 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900 truncate">{rfq.shapeName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {MATERIAL_LABELS[rfq.materialId] ?? rfq.materialId}
                          {' · '}{rfq.quantity}{t.qtyUnit}
                          {' · '}{rfq.volume_cm3.toFixed(1)} cm³
                          {rfq.dfmScore != null && ` · DFM ${rfq.dfmScore}`}
                        </p>
                        {rfq.note && <p className="text-xs text-gray-400 mt-1 truncate">{rfq.note}</p>}
                        <p className="text-[10px] text-gray-400 mt-1">
                          {t.pendingNoteLabelAssigned} {formatDate(rfq.assignedAt ?? rfq.createdAt)}
                        </p>
                      </div>
                      <button
                        onClick={() => setQuoteTarget(rfq)}
                        className="shrink-0 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition">
                        {t.pendingBtnQuote}
                      </button>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === 'active' && (
              activeContracts.length === 0 ? (
                <div className="py-16 text-center text-gray-400 text-sm">{t.emptyActive}</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {activeContracts.map(c => (
                    <div key={c.id} className="px-5 py-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-gray-900 truncate">{c.project_name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {fmtMoney(c.contract_amount, lang)}
                            {c.deadline && ` · ${t.contractDeadlinePrefix} ${formatDate(c.deadline)}`}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-500'}`}>
                            {statusText(c.status, t)}
                          </span>
                          <a
                            href={`/api/contracts/${c.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:border-gray-400 hover:text-gray-800 transition"
                          >
                            {t.contractBtnPdf}
                          </a>
                          <button
                            onClick={() => setMilestoneTarget(c)}
                            className="px-3 py-1 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:border-purple-300 hover:text-purple-600 transition">
                            {t.contractBtnMilestones}
                          </button>
                          <button
                            onClick={() => setProgressTarget(c)}
                            className="px-3 py-1 border border-gray-200 rounded-lg text-xs font-semibold text-gray-600 hover:border-blue-300 hover:text-blue-600 transition">
                            {t.contractBtnUpdate}
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full transition-all"
                            style={{ width: `${c.progress_percent}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-gray-400 font-semibold w-8 text-right">{c.progress_percent}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === 'quotes' && (
              recentQuotes.length === 0 ? (
                <div className="py-16 text-center text-gray-400 text-sm">{t.emptyQuotes}</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {recentQuotes.map(q => (
                    <div key={q.id} className="px-5 py-4 flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900 truncate">{q.projectName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {q.estimatedAmount != null ? fmtMoney(q.estimatedAmount, lang) : '-'}
                          {q.respondedAt && ` · ${formatDate(q.respondedAt)} ${t.quoteRespondedSuffix}`}
                        </p>
                      </div>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full shrink-0 ${
                        q.status === 'responded' ? 'bg-green-100 text-green-700'
                        : q.status === 'accepted' ? 'bg-blue-100 text-blue-700'
                        : q.status === 'rejected' ? 'bg-red-100 text-red-600'
                        : 'bg-gray-100 text-gray-500'
                      }`}>
                        {q.status === 'responded' ? t.quoteStatusResponded
                          : q.status === 'accepted' ? t.quoteStatusAccepted
                          : q.status === 'rejected' ? t.quoteStatusRejected
                          : q.status}
                      </span>
                    </div>
                  ))}
                </div>
              )
            )}

            {tab === 'settlements' && (
              <div className="px-5 py-4">
                <div className="flex gap-2 mb-4">
                  <input type="month" value={settlementMonth}
                    onChange={e => { setSettlementMonth(e.target.value); loadSettlements(e.target.value); }}
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-400" />
                  <button onClick={() => { setSettlementMonth(''); loadSettlements(''); }}
                    className="px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50">
                    {t.settlementMonthAll}
                  </button>
                  <a href={`/api/partner/settlement-pdf?partnerEmail=${encodeURIComponent(partner.email)}${settlementMonth ? `&month=${settlementMonth}` : ''}`}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto px-3 py-1.5 text-xs font-semibold border border-gray-200 rounded-lg text-gray-600 hover:border-gray-400">
                    {t.settlementBtnPdf}
                  </a>
                </div>

                {settlementsLoading ? (
                  <p className="text-center text-gray-400 text-sm py-8">{t.loading}</p>
                ) : settlements ? (
                  <>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[
                        { label: t.settlementSumRevenue, value: fmtMoney(settlements.summary.totalRevenue, lang), color: 'text-gray-900' },
                        { label: t.settlementSumCommission, value: fmtMoney(settlements.summary.totalCommission, lang), color: 'text-red-600' },
                        { label: t.settlementSumNet, value: fmtMoney(settlements.summary.netRevenue, lang), color: 'text-green-700' },
                      ].map(c => (
                        <div key={c.label} className="bg-gray-50 rounded-xl p-3 text-center">
                          <p className="text-[10px] text-gray-400 mb-1">{c.label}</p>
                          <p className={`text-sm font-black ${c.color}`}>{c.value}</p>
                        </div>
                      ))}
                    </div>

                    {settlements.settlements.length === 0 ? (
                      <p className="text-center text-gray-400 text-sm py-8">{t.emptySettlements}</p>
                    ) : (
                      <div className="divide-y divide-gray-50 -mx-5">
                        {settlements.settlements.map(s => (
                          <div key={s.contractId} className="px-5 py-3 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{s.projectName}</p>
                              <p className="text-[10px] text-gray-400 mt-0.5">
                                {s.month} · {s.contractId}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-bold text-green-700">{fmtMoney(s.netAmount, lang)}</p>
                              <p className="text-[10px] text-gray-400">{t.settlementContractPrefix} {fmtMoney(s.contractAmount, lang)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-center text-gray-400 text-sm py-8">{t.emptyData}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modals */}
      {milestoneTarget && (
        <MilestoneModal
          contract={milestoneTarget}
          session={session}
          onClose={() => setMilestoneTarget(null)}
          t={t}
        />
      )}
      {quoteTarget && (
        <QuoteModal
          rfq={quoteTarget}
          session={session}
          onClose={() => setQuoteTarget(null)}
          onSubmitted={() => { setQuoteTarget(null); loadDashboard(session); }}
          t={t}
        />
      )}
      {progressTarget && (
        <ProgressModal
          contract={progressTarget}
          session={session}
          onClose={() => setProgressTarget(null)}
          onUpdated={() => { setProgressTarget(null); loadDashboard(session); }}
          t={t}
        />
      )}
    </div>
  );
}
