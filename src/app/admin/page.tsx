'use client';
import { useAdminI18n } from './AdminI18nProvider';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/formatDate';
import { formatMoney, formatNumber } from '@/lib/i18n/format';

interface Contract {
  id: string; projectName: string; customerEmail?: string; factoryName?: string;
  contractAmount: number; commissionRate?: number; finalCharge?: number;
  status: string; contractDate?: string; partnerId?: string;
}
interface Inquiry {
  id: string; name: string; email: string; company?: string; message: string;
  status?: string; createdAt?: string;
}
interface Partner {
  partnerId: string; email: string; company: string; specialties?: string[];
  status?: string; createdAt?: string;
}
interface SaasSummary {
  total_users: number;
  active_subs: number;
  revenue_krw_mtd: number;
  failed_mtd: number;
}

const STATUS_LABELS: Record<string, { ko: string; en: string }> = {
  contracted: { ko: '계약 완료', en: 'Contracted' },
  in_progress: { ko: '제조 중', en: 'In production' },
  quality_check: { ko: '품질 검수', en: 'Quality check' },
  delivered: { ko: '납품 완료', en: 'Delivered' },
  completed: { ko: '완료', en: 'Completed' },
  cancelled: { ko: '취소됨', en: 'Cancelled' },
};
const STATUS_COLORS: Record<string, string> = {
  contracted: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700',
  quality_check: 'bg-purple-100 text-purple-700', delivered: 'bg-teal-100 text-teal-700',
  completed: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700',
};

interface SystemHealth {
  jobPending: number;
  jobFailed: number;
  slaOverdue: number;
  slaWarning: number;
}

type Tab = 'contracts' | 'inquiries' | 'partners' | 'settlements';

export default function AdminPage() {
  const { locale } = useAdminI18n();
  const L = useMemo(() => createCommercialLocalizer(locale), [locale]);
  const won = (value?: number) => formatMoney(value, locale, 'KRW', { maximumFractionDigits: 0 }) ?? '-';
  const [tab, setTab] = useState<Tab>('contracts');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [saasSummary, setSaasSummary] = useState<SaasSummary | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  async function fetchAll() {
    setLoading(true);
    try {
      const [cRes, iRes, pRes, aRes] = await Promise.all([
        fetch('/api/contracts'),
        fetch('/api/inquiries'),
        fetch('/api/partner/list'),
        fetch('/api/admin/analytics'),
      ]);
      const cData = await cRes.json();
      const iData = await iRes.json();
      const pData = pRes.ok ? await pRes.json() : { partners: [] };
      setContracts(cData.contracts || []);
      setInquiries(iData.inquiries || []);
      setPartners(pData.partners || []);
      if (aRes.ok) {
        const aData = await aRes.json();
        const s = aData.summary || {};
        setSaasSummary({
          total_users: s.total_users ?? 0,
          active_subs: s.active_subs ?? 0,
          revenue_krw_mtd: s.revenue_krw_mtd ?? 0,
          failed_mtd: s.failed_mtd ?? 0,
        });
      }
    } finally { setLoading(false); }
  }

  async function fetchHealth() {
    try {
      const [jobRes, slaRes] = await Promise.allSettled([
        fetch('/api/admin/jobs'),
        fetch('/api/admin/sla'),
      ]);
      const jobData = jobRes.status === 'fulfilled' && jobRes.value.ok ? await jobRes.value.json() : null;
      const slaData = slaRes.status === 'fulfilled' && slaRes.value.ok ? await slaRes.value.json() : null;
      setHealth({
        jobPending: jobData?.summary?.pending ?? 0,
        jobFailed: jobData?.summary?.failed ?? 0,
        slaOverdue: slaData?.summary?.overdue ?? 0,
        slaWarning: slaData?.summary?.warning ?? 0,
      });
    } catch { /* silent */ }
  }

  useEffect(() => { void fetchAll(); void fetchHealth(); }, []);

  async function updateContractStatus(id: string, status: string) {
    setUpdatingId(id);
    await fetch('/api/contracts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    setContracts(prev => prev.map(c => c.id === id ? { ...c, status } : c));
    setUpdatingId(null);
  }

  const activeContracts = contracts.filter(c => !['completed', 'cancelled'].includes(c.status));
  const newInquiries = inquiries.filter(i => !i.status || i.status === 'new');
  const totalCommission = contracts.filter(c => c.status === 'completed').reduce((s, c) => s + (c.finalCharge || 0), 0);

  const filteredContracts = contracts.filter(c =>
    c.projectName?.toLowerCase().includes(search.toLowerCase()) ||
    (c.customerEmail?.toLowerCase() || '').includes(search.toLowerCase())
  );
  const filteredInquiries = inquiries.filter(i =>
    i.name?.toLowerCase().includes(search.toLowerCase()) ||
    i.email?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredPartners = partners.filter(p =>
    p.company?.toLowerCase().includes(search.toLowerCase()) ||
    p.email?.toLowerCase().includes(search.toLowerCase())
  );

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'contracts', label: L('계약 관리', 'Contracts'), icon: '📋' },
    { key: 'inquiries', label: L('문의 관리', 'Inquiries'), icon: '📩' },
    { key: 'partners', label: L('파트너 관리', 'Partners'), icon: '🏭' },
    { key: 'settlements', label: L('정산 관리', 'Settlements'), icon: '💰' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div>
          <span className="text-lg font-black text-gray-900">NexyFab</span>
          <span className="ml-2 text-xs font-bold text-gray-400 uppercase tracking-widest">Admin</span>
        </div>
        <span className="text-xs text-emerald-600 font-semibold">{L('인증된 관리자 세션', 'Authenticated admin session')}</span>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          {[
            { label: L('진행 중 계약', 'Active contracts'), value: formatNumber(activeContracts.length, locale), icon: '📦', color: 'text-blue-600' },
            { label: L('신규 문의', 'New inquiries'), value: formatNumber(newInquiries.length, locale), icon: '📩', color: 'text-orange-500' },
            { label: L('등록 파트너', 'Registered partners'), value: formatNumber(partners.length, locale), icon: '🏭', color: 'text-purple-600' },
            { label: L('누적 수수료', 'Total commission'), value: won(totalCommission), icon: '💰', color: 'text-green-600' },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-400 mt-1 font-semibold">{s.label}</div>
            </div>
          ))}
        </div>

        {/* SaaS KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: L('총 회원수', 'Total users'), value: saasSummary ? formatNumber(saasSummary.total_users, locale) : '—', icon: '👤', color: 'text-sky-600', href: '/admin/users' },
            { label: L('유료 구독', 'Paid subscriptions'), value: saasSummary ? formatNumber(saasSummary.active_subs, locale) : '—', icon: '⭐', color: 'text-amber-500', href: '/admin/subscriptions' },
            { label: L('이번 달 매출', 'Revenue this month'), value: saasSummary ? won(saasSummary.revenue_krw_mtd) : '—', icon: '📈', color: 'text-emerald-600', href: '/admin/analytics' },
            { label: L('결제 실패', 'Payment failures'), value: saasSummary ? formatNumber(saasSummary.failed_mtd, locale) : '—', icon: '⚠️', color: saasSummary?.failed_mtd ? 'text-red-500' : 'text-gray-400', href: '/admin/billing' },
          ].map((s, i) => (
            <Link key={i} href={s.href} prefetch={false} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:border-blue-200 hover:shadow-md transition-all group">
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-400 mt-1 font-semibold group-hover:text-blue-500 transition-colors">{s.label} →</div>
            </Link>
          ))}
        </div>

        {/* System Health bar */}
        {health && (
          <div className="flex flex-wrap items-center gap-2 mb-6 p-3 bg-white rounded-xl border border-gray-100 shadow-sm text-xs">
            <span className="font-bold text-gray-500 mr-1">{L('시스템 상태', 'System status')}</span>
            <Link href="/admin/jobs" prefetch={false} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition ${health.jobPending > 0 ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' : 'bg-gray-50 text-gray-500'}`}>
              ⚡ {L('대기 작업', 'Queued jobs')} {formatNumber(health.jobPending, locale)}
            </Link>
            <Link href="/admin/email-logs" prefetch={false} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition ${health.jobFailed > 0 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-50 text-gray-500'}`}>
              {health.jobFailed > 0 ? '❌' : '✅'} {L('실패 작업', 'Failed jobs')} {formatNumber(health.jobFailed, locale)}
            </Link>
            <Link href="/admin/sla" prefetch={false} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition ${health.slaOverdue > 0 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-50 text-gray-500'}`}>
              🚨 {L('SLA 위반', 'SLA breaches')} {formatNumber(health.slaOverdue, locale)}
            </Link>
            {health.slaWarning > 0 && (
              <Link href="/admin/sla" prefetch={false} className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-amber-50 text-amber-600 border border-amber-200 transition">
                ⏰ {L('납기 경고', 'Deadline warnings')} {formatNumber(health.slaWarning, locale)}
              </Link>
            )}
            {health.jobPending === 0 && health.jobFailed === 0 && health.slaOverdue === 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-green-600 bg-green-50 border border-green-200 font-semibold">
                {L('✅ 모든 시스템 정상', '✅ All systems operational')}
              </span>
            )}
            <button onClick={fetchHealth} className="ml-auto text-gray-400 hover:text-gray-600 transition">↻</button>
          </div>
        )}

        {/* Tabs + Search */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
            {tabs.map(t => (
              <button key={t.key} onClick={() => { setTab(t.key); setSearch(''); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={L('검색...', 'Search...')}
            className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-400" />
          <button onClick={fetchAll} className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl transition">
            {L('새로고침', 'Refresh')}
          </button>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">{L('불러오는 중...', 'Loading…')}</div>
        ) : (
          <>
            {tab === 'contracts' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-gray-50">
                      {[L('프로젝트명', 'Project'), L('고객', 'Customer'), L('파트너', 'Partner'), L('계약 금액', 'Contract amount'), L('수수료', 'Commission'), L('상태', 'Status'), L('변경', 'Update')].map((h, i) => (
                        <th key={i} className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContracts.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-gray-400">{L('계약 없음', 'No contracts')}</td></tr>
                    ) : filteredContracts.map((c, i) => (
                      <tr key={c.id} className={i < filteredContracts.length - 1 ? 'border-b border-gray-50' : ''}>
                        <td className="px-4 py-3 font-semibold text-gray-900 max-w-[160px] truncate">{c.projectName}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.customerEmail || '-'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.factoryName || '-'}</td>
                        <td className="px-4 py-3 font-bold text-gray-900">{won(c.contractAmount)}</td>
                        <td className="px-4 py-3 text-gray-500">{won(c.finalCharge)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-500'}`}>
                            {STATUS_LABELS[c.status] ? L(STATUS_LABELS[c.status].ko, STATUS_LABELS[c.status].en) : c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <select value={c.status} disabled={updatingId === c.id}
                            onChange={e => updateContractStatus(c.id, e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400 disabled:opacity-50">
                            {Object.entries(STATUS_LABELS).map(([v, label]) => (
                              <option key={v} value={v}>{L(label.ko, label.en)}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'inquiries' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-gray-50">
                      {[L('이름', 'Name'), L('이메일', 'Email'), L('회사', 'Company'), L('메시지', 'Message'), L('상태', 'Status'), L('날짜', 'Date')].map((h, i) => (
                        <th key={i} className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInquiries.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-gray-400">{L('문의 없음', 'No inquiries')}</td></tr>
                    ) : filteredInquiries.map((inq, i) => (
                      <tr key={inq.id} className={i < filteredInquiries.length - 1 ? 'border-b border-gray-50' : ''}>
                        <td className="px-4 py-3 font-semibold text-gray-900">{inq.name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{inq.email}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{inq.company || '-'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">{inq.message}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${inq.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            {inq.status === 'resolved' ? L('처리 완료', 'Resolved') : L('신규', 'New')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {inq.createdAt ? formatDate(inq.createdAt, locale) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === 'partners' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPartners.length === 0 ? (
                  <div className="col-span-3 bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center text-gray-400 text-sm">
                    {L('파트너 없음', 'No partners')}
                  </div>
                ) : filteredPartners.map(p => (
                  <div key={p.partnerId} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-bold text-gray-900 text-sm">{p.company}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{p.email}</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.status === 'active' ? L('활성', 'Active') : L('대기', 'Pending')}
                      </span>
                    </div>
                    {p.specialties && p.specialties.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {p.specialties.map((s, i) => (
                          <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-semibold">{s}</span>
                        ))}
                      </div>
                    )}
                    <div className="text-[10px] text-gray-300 mt-3">ID: {p.partnerId}</div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'settlements' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="border-b border-gray-50">
                      {[L('프로젝트명', 'Project'), L('파트너', 'Partner'), L('계약 금액', 'Contract amount'), L('수수료율', 'Commission rate'), L('실 청구액', 'Final charge'), L('상태', 'Status')].map((h, i) => (
                        <th key={i} className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.filter(c => c.status === 'completed').length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-gray-400">{L('완료된 계약 없음', 'No completed contracts')}</td></tr>
                    ) : contracts.filter(c => c.status === 'completed').map((c, i, arr) => (
                      <tr key={c.id} className={i < arr.length - 1 ? 'border-b border-gray-50' : ''}>
                        <td className="px-4 py-3 font-semibold text-gray-900">{c.projectName}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.factoryName || c.partnerId || '-'}</td>
                        <td className="px-4 py-3 font-bold text-gray-900">{won(c.contractAmount)}</td>
                        <td className="px-4 py-3 text-gray-500">{c.commissionRate ?? '-'}%</td>
                        <td className="px-4 py-3 font-black text-blue-600">{won(c.finalCharge)}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">{L('정산 완료', 'Settled')}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
