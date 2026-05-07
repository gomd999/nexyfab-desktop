'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { formatDate } from '@/lib/formatDate';

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

const STATUS_LABELS: Record<string, string> = {
  contracted: '계약 완료', in_progress: '제조 중', quality_check: '품질 검수',
  delivered: '납품 완료', completed: '완료', cancelled: '취소됨',
};
const STATUS_COLORS: Record<string, string> = {
  contracted: 'bg-blue-100 text-blue-700', in_progress: 'bg-yellow-100 text-yellow-700',
  quality_check: 'bg-purple-100 text-purple-700', delivered: 'bg-teal-100 text-teal-700',
  completed: 'bg-green-100 text-green-700', cancelled: 'bg-red-100 text-red-700',
};

function won(n?: number) { return n != null ? `₩${n.toLocaleString('ko-KR')}` : '-'; }

function Sparkline({ data, color = '#3b82f6' }: { data: number[]; color?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 80, h = 24;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width={w} height={h} className="mt-2">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

interface SystemHealth {
  jobPending: number;
  jobFailed: number;
  slaOverdue: number;
  slaWarning: number;
}

type Tab = 'contracts' | 'inquiries' | 'partners' | 'settlements';

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [pwError, setPwError] = useState(false);
  const [tab, setTab] = useState<Tab>('contracts');
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [inquiries, setInquiries] = useState<Inquiry[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [saasSummary, setSaasSummary] = useState<SaasSummary | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [health, setHealth] = useState<SystemHealth | null>(null);

  async function login() {
    const res = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) { setAuthed(true); setPwError(false); }
    else setPwError(true);
  }

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

  useEffect(() => { if (authed) { fetchAll(); fetchHealth(); } }, [authed]);

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

  if (!authed) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="text-3xl mb-2">🔐</div>
            <h1 className="text-xl font-black text-gray-900">관리자 로그인</h1>
            <p className="text-xs text-gray-400 mt-1">NexyFab Admin Dashboard</p>
          </div>
          <input
            type="password" value={pw} onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()}
            placeholder="관리자 비밀번호"
            className={`w-full px-4 py-3 rounded-xl border text-sm outline-none mb-3 ${pwError ? 'border-red-400 bg-red-50' : 'border-gray-200 focus:border-blue-400'}`}
          />
          {pwError && <p className="text-xs text-red-500 mb-3">비밀번호가 올바르지 않습니다.</p>}
          <button onClick={login} className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-700 transition">
            로그인
          </button>
        </div>
      </div>
    );
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
    { key: 'contracts', label: '계약관리', icon: '📋' },
    { key: 'inquiries', label: '문의관리', icon: '📩' },
    { key: 'partners', label: '파트너관리', icon: '🏭' },
    { key: 'settlements', label: '정산관리', icon: '💰' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <div>
          <span className="text-lg font-black text-gray-900">NexyFab</span>
          <span className="ml-2 text-xs font-bold text-gray-400 uppercase tracking-widest">Admin</span>
        </div>
        <button onClick={() => setAuthed(false)} className="text-xs text-gray-400 hover:text-gray-600 transition">
          로그아웃
        </button>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          {[
            { label: '진행 중 계약', value: activeContracts.length, icon: '📦', color: 'text-blue-600', sparkData: [3,5,4,6,5,7,activeContracts.length||7], sparkColor: '#3b82f6' },
            { label: '신규 문의', value: newInquiries.length, icon: '📩', color: 'text-orange-500', sparkData: [8,5,9,6,7,4,newInquiries.length||4], sparkColor: '#f97316' },
            { label: '등록 파트너', value: partners.length, icon: '🏭', color: 'text-purple-600', sparkData: [10,12,12,13,14,14,partners.length||14], sparkColor: '#9333ea' },
            { label: '누적 수수료', value: won(totalCommission), icon: '💰', color: 'text-green-600', sparkData: [200000,350000,280000,420000,390000,510000,totalCommission||510000], sparkColor: '#16a34a' },
          ].map((s, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-400 mt-1 font-semibold">{s.label}</div>
              <Sparkline data={s.sparkData} color={s.sparkColor} />
            </div>
          ))}
        </div>

        {/* SaaS KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: '총 회원수', value: saasSummary?.total_users ?? '—', icon: '👤', color: 'text-sky-600', href: '/admin/users',
              sparkData: [120,135,142,150,158,163,saasSummary?.total_users||163], sparkColor: '#0284c7' },
            { label: '유료 구독', value: saasSummary?.active_subs ?? '—', icon: '⭐', color: 'text-amber-500', href: '/admin/subscriptions',
              sparkData: [28,31,30,34,36,38,saasSummary?.active_subs||38], sparkColor: '#f59e0b' },
            { label: '이번 달 매출', value: saasSummary ? won(saasSummary.revenue_krw_mtd) : '—', icon: '📈', color: 'text-emerald-600', href: '/admin/analytics',
              sparkData: [1200000,1450000,1380000,1600000,1750000,1820000,saasSummary?.revenue_krw_mtd||1820000], sparkColor: '#059669' },
            { label: '결제 실패', value: saasSummary?.failed_mtd ?? '—', icon: '⚠️', color: saasSummary?.failed_mtd ? 'text-red-500' : 'text-gray-400', href: '/admin/billing',
              sparkData: [5,3,7,4,6,2,saasSummary?.failed_mtd||2], sparkColor: '#ef4444' },
          ].map((s, i) => (
            <Link key={i} href={s.href} prefetch={false} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:border-blue-200 hover:shadow-md transition-all group">
              <div className="text-2xl mb-2">{s.icon}</div>
              <div className={`text-xl font-black ${s.color}`}>{s.value}</div>
              <div className="text-xs text-gray-400 mt-1 font-semibold group-hover:text-blue-500 transition-colors">{s.label} →</div>
              <Sparkline data={s.sparkData} color={s.sparkColor} />
            </Link>
          ))}
        </div>

        {/* System Health bar */}
        {health && (
          <div className="flex flex-wrap items-center gap-2 mb-6 p-3 bg-white rounded-xl border border-gray-100 shadow-sm text-xs">
            <span className="font-bold text-gray-500 mr-1">시스템 상태</span>
            <Link href="/admin/jobs" prefetch={false} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition ${health.jobPending > 0 ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' : 'bg-gray-50 text-gray-500'}`}>
              ⚡ 대기 Job {health.jobPending}
            </Link>
            <Link href="/admin/email-logs" prefetch={false} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition ${health.jobFailed > 0 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-50 text-gray-500'}`}>
              {health.jobFailed > 0 ? '❌' : '✅'} 실패 Job {health.jobFailed}
            </Link>
            <Link href="/admin/sla" prefetch={false} className={`flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold transition ${health.slaOverdue > 0 ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-gray-50 text-gray-500'}`}>
              🚨 SLA 위반 {health.slaOverdue}
            </Link>
            {health.slaWarning > 0 && (
              <Link href="/admin/sla" prefetch={false} className="flex items-center gap-1 px-2.5 py-1 rounded-lg font-semibold bg-amber-50 text-amber-600 border border-amber-200 transition">
                ⏰ 납기 경고 {health.slaWarning}
              </Link>
            )}
            {health.jobPending === 0 && health.jobFailed === 0 && health.slaOverdue === 0 && (
              <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-green-600 bg-green-50 border border-green-200 font-semibold">
                ✅ 모든 시스템 정상
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
            placeholder="검색..."
            className="flex-1 px-4 py-2 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-400" />
          <button onClick={fetchAll} className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700 border border-gray-200 rounded-xl transition">
            새로고침
          </button>
        </div>

        {loading ? (
          <div className="text-center py-16 text-gray-400 text-sm">불러오는 중...</div>
        ) : (
          <>
            {tab === 'contracts' && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="border-b border-gray-50">
                      {['프로젝트명', '고객', '파트너', '계약 금액', '수수료', '상태', '변경'].map((h, i) => (
                        <th key={i} className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredContracts.length === 0 ? (
                      <tr><td colSpan={7} className="text-center py-12 text-gray-400">계약 없음</td></tr>
                    ) : filteredContracts.map((c, i) => (
                      <tr key={c.id} className={i < filteredContracts.length - 1 ? 'border-b border-gray-50' : ''}>
                        <td className="px-4 py-3 font-semibold text-gray-900 max-w-[160px] truncate">{c.projectName}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.customerEmail || '-'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.factoryName || '-'}</td>
                        <td className="px-4 py-3 font-bold text-gray-900">{won(c.contractAmount)}</td>
                        <td className="px-4 py-3 text-gray-500">{won(c.finalCharge)}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-500'}`}>
                            {STATUS_LABELS[c.status] || c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <select value={c.status} disabled={updatingId === c.id}
                            onChange={e => updateContractStatus(c.id, e.target.value)}
                            className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-blue-400 disabled:opacity-50">
                            {Object.entries(STATUS_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>{l}</option>
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
                      {['이름', '이메일', '회사', '메시지', '상태', '날짜'].map((h, i) => (
                        <th key={i} className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInquiries.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-gray-400">문의 없음</td></tr>
                    ) : filteredInquiries.map((inq, i) => (
                      <tr key={inq.id} className={i < filteredInquiries.length - 1 ? 'border-b border-gray-50' : ''}>
                        <td className="px-4 py-3 font-semibold text-gray-900">{inq.name}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{inq.email}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{inq.company || '-'}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-[200px] truncate">{inq.message}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${inq.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'}`}>
                            {inq.status === 'resolved' ? '처리완료' : '신규'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {inq.createdAt ? formatDate(inq.createdAt) : '-'}
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
                    파트너 없음
                  </div>
                ) : filteredPartners.map(p => (
                  <div key={p.partnerId} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-bold text-gray-900 text-sm">{p.company}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{p.email}</div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.status === 'active' ? '활성' : '대기'}
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
                      {['프로젝트명', '파트너', '계약 금액', '수수료율', '실 청구액', '상태'].map((h, i) => (
                        <th key={i} className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.filter(c => c.status === 'completed').length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-12 text-gray-400">완료된 계약 없음</td></tr>
                    ) : contracts.filter(c => c.status === 'completed').map((c, i, arr) => (
                      <tr key={c.id} className={i < arr.length - 1 ? 'border-b border-gray-50' : ''}>
                        <td className="px-4 py-3 font-semibold text-gray-900">{c.projectName}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{c.factoryName || c.partnerId || '-'}</td>
                        <td className="px-4 py-3 font-bold text-gray-900">{won(c.contractAmount)}</td>
                        <td className="px-4 py-3 text-gray-500">{c.commissionRate ?? '-'}%</td>
                        <td className="px-4 py-3 font-black text-blue-600">{won(c.finalCharge)}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-700">정산 완료</span>
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
