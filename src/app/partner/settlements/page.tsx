'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ToastProvider';

interface Partner { partnerId: string; email: string; company: string; }
interface Contract {
  id: string; projectName: string; factoryName?: string; contractAmount: number;
  commissionRate?: number; grossCommission?: number; planDeduction?: number; finalCharge?: number;
  status: string; contractDate?: string; completionRequested?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  contracted: '계약 완료', in_progress: '제조 중', quality_check: '품질 검수',
  delivered: '납품 완료', completed: '완료', cancelled: '취소됨',
};

function won(n?: number) { return n != null ? `₩${n.toLocaleString('ko-KR')}` : '-'; }

function Sidebar({ partner, onLogout }: { partner: Partner | null; onLogout: () => void }) {
  const navItems = [
    { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
    { href: '/partner/projects', label: '프로젝트', icon: '📦' },
    { href: '/partner/quotes', label: '견적', icon: '📝' },
    { href: '/partner/settlements', label: '정산', icon: '💰' },
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
          <div className="text-sm font-bold text-gray-800 truncate">{partner.company}</div>
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

export default function PartnerSettlementsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);

  const logout = () => {
    localStorage.removeItem('partnerSession');
    localStorage.removeItem('partnerInfo');
    router.push('/partner/login');
  };

  const fetchData = useCallback(async (session: string) => {
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
        fetchData(session).finally(() => setLoading(false));
      })
      .catch(() => router.replace('/partner/login'));
  }, [router, fetchData]);

  async function downloadPdf(contractId: string) {
    setPdfLoading(contractId);
    try {
      const session = localStorage.getItem('partnerSession') || '';
      const res = await fetch(`/api/partner/settlement-pdf?contractId=${contractId}`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) { toast('error', 'PDF 생성에 실패했습니다.'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `settlement-${contractId}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch { toast('error', '오류가 발생했습니다.'); }
    finally { setPdfLoading(null); }
  }

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400 text-sm">불러오는 중...</p></div>;

  const completed = contracts.filter(c => c.status === 'completed');
  const active = contracts.filter(c => !['completed', 'cancelled'].includes(c.status));

  const totalEarnings = completed.reduce((s, c) => s + (c.contractAmount || 0), 0);
  const totalCommission = completed.reduce((s, c) => s + (c.finalCharge || 0), 0);
  const netEarnings = totalEarnings - totalCommission;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar partner={partner} onLogout={logout} />

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-100 flex items-center justify-around py-2 px-2">
        {[
          { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
          { href: '/partner/projects', label: '프로젝트', icon: '📦' },
          { href: '/partner/settlements', label: '정산', icon: '💰' },
          { href: '/partner/profile', label: '프로필', icon: '🏭' },
        ].map(item => (
          <a key={item.href} href={item.href} className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl ${item.href === '/partner/settlements' ? 'text-blue-600' : 'text-gray-500'}`}>
            <span className="text-2xl leading-tight">{item.icon}</span>
            <span className="text-[10px] font-semibold">{item.label}</span>
          </a>
        ))}
      </nav>

      <main className="flex-1 p-6 overflow-auto pb-20 md:pb-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-900">정산 내역</h1>
            <p className="text-sm text-gray-500 mt-1">완료된 계약의 수익과 수수료를 확인합니다.</p>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {[
              { label: '총 계약 금액', value: won(totalEarnings), icon: '💼', color: '#1d4ed8' },
              { label: 'NexyFab 수수료', value: won(totalCommission), icon: '📋', color: '#7c3aed' },
              { label: '순 수익 (추정)', value: won(netEarnings), icon: '💰', color: '#059669' },
            ].map((s, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="text-2xl mb-2">{s.icon}</div>
                <div className="text-xl font-black" style={{ color: s.color }}>{s.value}</div>
                <div className="text-xs text-gray-500 mt-1 font-semibold">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Active Contracts */}
          {active.length > 0 && (
            <div className="mb-8">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">진행 중 ({active.length})</h2>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {active.map((c, i) => (
                  <div key={c.id} className={`flex items-center gap-4 px-5 py-4 ${i < active.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900 truncate">{c.projectName}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{STATUS_LABELS[c.status] || c.status} · {c.contractDate || ''}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-black text-gray-900">{won(c.contractAmount)}</div>
                      <div className="text-xs text-gray-400 mt-0.5">수수료 {c.commissionRate ?? '-'}%</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Completed Contracts */}
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">완료 ({completed.length})</h2>
            {completed.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-16 text-center text-gray-400 text-sm">
                완료된 계약이 없습니다.
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {completed.map((c, i) => (
                  <div key={c.id} className={`px-5 py-4 ${i < completed.length - 1 ? 'border-b border-gray-50' : ''}`}>
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="text-sm font-bold text-gray-900">{c.projectName}</div>
                        <div className="text-xs text-gray-400 mt-0.5">{c.contractDate || ''}</div>
                      </div>
                      <button onClick={() => downloadPdf(c.id)} disabled={pdfLoading === c.id}
                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition disabled:opacity-50">
                        {pdfLoading === c.id ? '생성 중...' : '📄 정산서 다운로드'}
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: '계약 금액', value: won(c.contractAmount) },
                        { label: '수수료율', value: `${c.commissionRate ?? '-'}%` },
                        { label: '산정 수수료', value: won(c.grossCommission) },
                        { label: '실 청구액', value: won(c.finalCharge), highlight: true },
                      ].map((item, j) => (
                        <div key={j} className="bg-gray-50 rounded-xl px-3 py-2">
                          <div className="text-[10px] text-gray-400 font-semibold uppercase mb-1">{item.label}</div>
                          <div className={`text-sm font-black ${item.highlight ? 'text-blue-600' : 'text-gray-900'}`}>{item.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
