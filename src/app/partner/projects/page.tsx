'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatDate, formatDday } from '@/lib/formatDate';
import { usePartnerLang } from '../_lib/partnerLang';
import { projectsDict, type ProjectsDict } from '../_lib/dicts/projects';

interface Partner {
  partnerId: string;
  email: string;
  company: string;
}

interface Milestones {
  total: number;
  completed: number;
}

interface Contract {
  id: string;
  projectName: string;
  factoryName?: string;
  contractAmount: number;
  status: string;
  contractDate?: string;
  deadline?: string;
  completionRequested?: boolean;
  milestones?: Milestones;
}

type TabKey = 'all' | 'active' | 'completed' | 'on_hold';

const ACTIVE_STATUSES    = ['contracted', 'in_progress', 'quality_check', 'delivered'];
const COMPLETED_STATUSES = ['completed'];
const ON_HOLD_STATUSES   = ['cancelled'];

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  contracted: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  in_progress: { bg: '#fefce8', text: '#a16207', border: '#fde68a' },
  quality_check: { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  delivered: { bg: '#faf5ff', text: '#7e22ce', border: '#e9d5ff' },
  completed: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  cancelled: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
};

function statusText(status: string, t: ProjectsDict): string {
  const key = `status_${status}` as keyof ProjectsDict;
  const v = t[key];
  return typeof v === 'string' ? v : status;
}

const LOCALE_FOR_LANG: Record<string, string> = {
  ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA',
};

function fmtMoney(n: number, lang: string) {
  try {
    return new Intl.NumberFormat(LOCALE_FOR_LANG[lang] ?? 'en-US', {
      style: 'currency', currency: 'KRW', maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₩${n.toLocaleString()}`;
  }
}

function EmptyState({ tab, isSearch, query, t }: { tab: TabKey; isSearch?: boolean; query?: string; t: ProjectsDict }) {
  if (isSearch && query) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-14 text-center">
        <div className="text-4xl mb-3" aria-hidden="true">🔍</div>
        <p className="text-gray-500 text-sm font-semibold">{t.searchEmptyTitle(query)}</p>
        <p className="text-gray-400 text-xs mt-1">{t.searchEmptyHint}</p>
      </div>
    );
  }
  const ICON: Record<TabKey, string> = { all: '📦', active: '⚙️', completed: '✅', on_hold: '⏸️' };
  const TEXT: Record<TabKey, string> = {
    all: t.emptyAll, active: t.emptyActive, completed: t.emptyCompleted, on_hold: t.emptyOnHold,
  };
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center">
      <div className="text-4xl mb-3" aria-hidden="true">{ICON[tab]}</div>
      <p className="text-gray-400 text-sm font-medium">{TEXT[tab]}</p>
    </div>
  );
}

function MilestoneBar({ milestones, t }: { milestones?: Milestones; t: ProjectsDict }) {
  if (!milestones || milestones.total === 0) return null;
  const pct = Math.round((milestones.completed / milestones.total) * 100);
  const barColor = pct === 100 ? '#22c55e' : '#3b82f6';
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">{t.milestoneTitle}</span>
        <span className="text-xs font-bold" style={{ color: barColor }}>
          {t.milestoneSuffix(milestones.completed, milestones.total)}
        </span>
      </div>
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
      </div>
    </div>
  );
}

export default function PartnerProjectsPage() {
  const router = useRouter();
  const lang = usePartnerLang();
  const t = projectsDict(lang);
  const [_partner, setPartner] = useState<Partner | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('all');

  const TAB_LABELS: { key: TabKey; label: string }[] = [
    { key: 'all',       label: t.tabAll },
    { key: 'active',    label: t.tabActive },
    { key: 'completed', label: t.tabCompleted },
    { key: 'on_hold',   label: t.tabOnHold },
  ];

  const fetchContracts = useCallback(async (session: string) => {
    const res = await fetch('/api/partner/contracts', { headers: { Authorization: `Bearer ${session}` } });
    const data = await res.json();
    setContracts(data.contracts || []);
  }, []);

  useEffect(() => {
    const session = localStorage.getItem('partnerSession');
    if (!session) { router.replace(`/partner/login?lang=${lang}`); return; }

    if (session === 'demo') {
      queueMicrotask(() => {
        setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
        setContracts([
          { id: 'demo-c1', projectName: 'IoT 모듈 PCB 조립', factoryName: '선진정밀 (주)', contractAmount: 42000000, status: 'in_progress', contractDate: new Date(Date.now() - 30 * 86400000).toISOString(), deadline: new Date(Date.now() + 14 * 86400000).toISOString(), milestones: { total: 5, completed: 3 } },
          { id: 'demo-c2', projectName: '의료기기 케이스 시제품', factoryName: '대한정밀 (주)', contractAmount: 8500000, status: 'quality_check', contractDate: new Date(Date.now() - 20 * 86400000).toISOString(), deadline: new Date(Date.now() + 3 * 86400000).toISOString(), milestones: { total: 4, completed: 3 } },
          { id: 'demo-c3', projectName: 'EV 배터리 케이스 외주 제조', factoryName: '한국제조 (주)', contractAmount: 28000000, status: 'completed', contractDate: new Date(Date.now() - 90 * 86400000).toISOString(), milestones: { total: 5, completed: 5 } },
        ]);
        setLoading(false);
      });
      return;
    }

    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(d => {
        if (!d.valid) { router.replace(`/partner/login?lang=${lang}`); return; }
        setPartner(d.partner);
        fetchContracts(session).finally(() => setLoading(false));
      })
      .catch(() => router.replace(`/partner/login?lang=${lang}`));
  }, [router, fetchContracts, lang]);

  if (loading) {
    return (
      <main className="flex-1 p-6 bg-gray-50 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse bg-gray-200 rounded h-7 w-32 mb-2" />
          <div className="animate-pulse bg-gray-100 rounded h-4 w-64 mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
                <div className="animate-pulse bg-gray-100 rounded-full h-6 w-20" />
                <div className="animate-pulse bg-gray-200 rounded h-5 w-3/4" />
                <div className="animate-pulse bg-gray-100 rounded h-4 w-1/2" />
              </div>
            ))}
          </div>
        </div>
      </main>
    );
  }

  function matchesTab(c: Contract): boolean {
    if (activeTab === 'all')       return true;
    if (activeTab === 'active')    return ACTIVE_STATUSES.includes(c.status);
    if (activeTab === 'completed') return COMPLETED_STATUSES.includes(c.status);
    if (activeTab === 'on_hold')   return ON_HOLD_STATUSES.includes(c.status);
    return true;
  }

  const searchQ = search.trim().toLowerCase();
  const filtered = contracts.filter(c => {
    const matchSearch = !searchQ
      || c.projectName.toLowerCase().includes(searchQ)
      || (c.factoryName || '').toLowerCase().includes(searchQ)
      || c.id.toLowerCase().includes(searchQ);
    return matchesTab(c) && matchSearch;
  });

  const tabCounts: Record<TabKey, number> = {
    all:       contracts.length,
    active:    contracts.filter(c => ACTIVE_STATUSES.includes(c.status)).length,
    completed: contracts.filter(c => COMPLETED_STATUSES.includes(c.status)).length,
    on_hold:   contracts.filter(c => ON_HOLD_STATUSES.includes(c.status)).length,
  };

  return (
    <main className="flex-1 p-6 overflow-auto pb-20 md:pb-6 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5">
          <h1 className="text-2xl font-black text-gray-900">{t.pageTitle}</h1>
          <p className="text-sm text-gray-500 mt-1">{t.pageSubtitle}</p>
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition bg-white"
          />
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl">
          {TAB_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === key
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
              {tabCounts[key] > 0 && (
                <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                  activeTab === key ? 'bg-blue-100 text-blue-700' : 'bg-gray-200 text-gray-500'
                }`}>
                  {tabCounts[key]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Results */}
        {filtered.length === 0 ? (
          <EmptyState tab={activeTab} isSearch={!!searchQ} query={search.trim()} t={t} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filtered.map(c => <ProjectCard key={c.id} contract={c} t={t} lang={lang} />)}
          </div>
        )}
      </div>
    </main>
  );
}

function ProjectCard({ contract, t, lang }: { contract: Contract; t: ProjectsDict; lang: string }) {
  const sc = STATUS_COLORS[contract.status] || { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' };
  const dday = contract.deadline ? formatDday(contract.deadline) : null;

  return (
    <Link href={`/partner/projects/${contract.id}?lang=${lang}`} className="block h-full" style={{ textDecoration: 'none' }}>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer h-full flex flex-col">
        {/* Status + D-day badge + ID */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span
            style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}
            className="text-xs font-bold px-2.5 py-1 rounded-full"
          >
            {statusText(contract.status, t)}
          </span>
          {contract.completionRequested && (
            <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">{t.completionRequested}</span>
          )}
          {dday && (
            <span
              className="text-xs font-bold px-2 py-0.5 rounded-full border"
              style={{ color: dday.color, borderColor: dday.color + '55', background: dday.color + '12' }}
            >
              {dday.label}
            </span>
          )}
          <span className="text-xs text-gray-300 font-mono ml-auto">{contract.id.slice(0, 8)}…</span>
        </div>

        {/* Project name */}
        <h3 className="text-base font-bold text-gray-900 mb-1">{contract.projectName}</h3>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          <span className="font-semibold text-gray-700">{fmtMoney(contract.contractAmount, lang)}</span>
          {contract.contractDate && <span>{formatDate(contract.contractDate)}</span>}
          {contract.factoryName && <span className="truncate">{contract.factoryName}</span>}
        </div>

        {/* Deadline date */}
        {contract.deadline && (
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-xs text-gray-400">{t.deadlineLabel}</span>
            <span className="text-xs text-gray-600">{formatDate(contract.deadline)}</span>
          </div>
        )}

        {/* Milestone progress bar */}
        <MilestoneBar milestones={contract.milestones} t={t} />

        {/* CTA */}
        <div className="mt-auto pt-4 flex justify-end">
          <span className="text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-colors">
            {t.detailCta}
          </span>
        </div>
      </div>
    </Link>
  );
}
