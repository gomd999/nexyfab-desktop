'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface Partner {
  partnerId: string;
  email: string;
  company: string;
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
}

const STATUS_LABELS: Record<string, string> = {
  contracted: '계약 완료',
  in_progress: '진행 중',
  quality_check: '품질 검수',
  delivered: '납품 완료',
  completed: '완료',
  cancelled: '취소됨',
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  contracted: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  in_progress: { bg: '#fefce8', text: '#a16207', border: '#fde68a' },
  quality_check: { bg: '#fff7ed', text: '#c2410c', border: '#fed7aa' },
  delivered: { bg: '#faf5ff', text: '#7e22ce', border: '#e9d5ff' },
  completed: { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' },
  cancelled: { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca' },
};

function won(n: number) {
  return n?.toLocaleString('ko-KR') + '원';
}

function getDdayInfo(deadline: string): { label: string; color: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(deadline); due.setHours(0, 0, 0, 0);
  const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return { label: `D+${Math.abs(diff)} 초과`, color: '#ef4444' };
  if (diff === 0) return { label: 'D-Day', color: '#ef4444' };
  if (diff <= 7) return { label: `D-${diff}`, color: '#f97316' };
  if (diff <= 14) return { label: `D-${diff}`, color: '#eab308' };
  return { label: `D-${diff}`, color: '#22c55e' };
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
    <aside className="hidden md:flex flex-col w-56 shrink-0 bg-white border-r border-gray-100 min-h-screen">
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
        {navItems.map(item => {
          const isActive = typeof window !== 'undefined' && window.location.pathname === item.href;
          return (
            <a key={item.href} href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span>{item.icon}</span>{item.label}
            </a>
          );
        })}
      </nav>
      <div className="px-3 py-4 border-t border-gray-100">
        <button onClick={onLogout} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors">
          <span>🚪</span>로그아웃
        </button>
      </div>
    </aside>
  );
}

export default function PartnerProjectsPage() {
  const router = useRouter();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const logout = () => {
    localStorage.removeItem('partnerSession');
    localStorage.removeItem('partnerInfo');
    router.push('/partner/login');
  };

  const fetchContracts = useCallback(async (session: string) => {
    const res = await fetch('/api/partner/contracts', { headers: { Authorization: `Bearer ${session}` } });
    const data = await res.json();
    setContracts(data.contracts || []);
  }, []);

  useEffect(() => {
    const session = localStorage.getItem('partnerSession');
    if (!session) { router.replace('/partner/login'); return; }

    if (session === 'demo') {
      setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
      setContracts([]);
      setLoading(false);
      return;
    }

    fetch(`/api/partner/auth?session=${session}`)
      .then(r => r.json())
      .then(d => {
        if (!d.valid) { router.replace('/partner/login'); return; }
        setPartner(d.partner);
        fetchContracts(session).finally(() => setLoading(false));
      })
      .catch(() => router.replace('/partner/login'));
  }, [router, fetchContracts]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">불러오는 중...</p>
      </div>
    );
  }

  const filtered = contracts.filter(c => {
    const matchStatus = statusFilter === 'all' || c.status === statusFilter;
    const q = search.trim().toLowerCase();
    const matchSearch = !q || c.projectName.toLowerCase().includes(q) || (c.factoryName || '').toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const inProgress = filtered
    .filter(c => ['contracted', 'in_progress', 'quality_check', 'delivered'].includes(c.status))
    .sort((a, b) => {
      const getD = (c: Contract) => {
        if (!c.deadline) return 999;
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const due = new Date(c.deadline); due.setHours(0, 0, 0, 0);
        return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      };
      return getD(a) - getD(b);
    });
  const done = filtered.filter(c => ['completed', 'cancelled'].includes(c.status));

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar partner={partner} onLogout={logout} />

      {/* ⑧ Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 flex items-center justify-around py-2 px-2">
        {[
          { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
          { href: '/partner/projects', label: '프로젝트', icon: '📦' },
          { href: '/partner/quotes', label: '견적', icon: '📝' },
          { href: '/partner/profile', label: '프로필', icon: '🏭' },
        ].map(item => (
          <a key={item.href} href={item.href} className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl ${item.href === '/partner/projects' ? 'text-blue-600' : 'text-gray-500'}`}>
            <span className="text-2xl leading-tight">{item.icon}</span>
            <span className="text-[10px] font-semibold">{item.label}</span>
          </a>
        ))}
      </nav>

      <main className="flex-1 p-6 overflow-auto pb-20 md:pb-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-900">프로젝트</h1>
            <p className="text-sm text-gray-500 mt-1">프로젝트를 선택하면 상세 관리 페이지로 이동합니다</p>
            <div className="flex gap-2 mt-4 flex-wrap">
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="프로젝트명, 공장명 검색..."
                className="flex-1 min-w-0 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition bg-white" />
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-blue-400 bg-white text-gray-700">
                <option value="all">전체 상태</option>
                <option value="contracted">계약 완료</option>
                <option value="in_progress">진행 중</option>
                <option value="quality_check">품질 검수</option>
                <option value="delivered">납품 완료</option>
                <option value="completed">완료</option>
                <option value="cancelled">취소됨</option>
              </select>
            </div>
          </div>

          {contracts.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center text-gray-400 text-sm">
              배정된 계약이 없습니다.
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-12 text-center text-gray-400 text-sm">
              검색 결과가 없습니다.
            </div>
          ) : (
            <>
              {/* 진행 중 */}
              {inProgress.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">진행 중 ({inProgress.length})</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {inProgress.map(c => <ProjectCard key={c.id} contract={c} />)}
                  </div>
                </div>
              )}

              {/* 완료 / 취소 */}
              {done.length > 0 && (
                <div>
                  <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">완료 / 취소 ({done.length})</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {done.map(c => <ProjectCard key={c.id} contract={c} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ProjectCard({ contract }: { contract: Contract }) {
  const sc = STATUS_COLORS[contract.status] || { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' };
  const ddayInfo = contract.deadline ? getDdayInfo(contract.deadline) : null;

  return (
    <a href={`/partner/projects/${contract.id}`} style={{ textDecoration: 'none' }}>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer">
        {/* Status + ID */}
        <div className="flex items-center gap-2 mb-2">
          <span style={{ background: sc.bg, color: sc.text, border: `1px solid ${sc.border}` }}
            className="text-xs font-bold px-2.5 py-1 rounded-full">
            {STATUS_LABELS[contract.status] || contract.status}
          </span>
          {contract.completionRequested && (
            <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">완료 확인 요청 중</span>
          )}
          <span className="text-xs text-gray-300 font-mono ml-auto">{contract.id.slice(0, 8)}…</span>
        </div>

        {/* Project Name */}
        <h3 className="text-base font-bold text-gray-900 mb-1">{contract.projectName}</h3>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
          <span className="font-semibold text-gray-700">{won(contract.contractAmount)}</span>
          {contract.contractDate && <span>{contract.contractDate}</span>}
          {contract.factoryName && <span>{contract.factoryName}</span>}
        </div>

        {/* D-day */}
        {ddayInfo && (
          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-xs text-gray-400">납기일</span>
            <span className="text-xs font-bold" style={{ color: ddayInfo.color }}>{ddayInfo.label}</span>
            <span className="text-xs text-gray-400">({contract.deadline})</span>
          </div>
        )}

        {/* CTA arrow */}
        <div className="mt-4 flex justify-end">
          <span className="text-xs font-bold text-blue-600">상세 보기 →</span>
        </div>
      </div>
    </a>
  );
}
