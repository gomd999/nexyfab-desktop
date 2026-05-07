'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Partner {
  partnerId: string;
  email: string;
  company: string;
}

interface Attachment {
  id: string;
  filename: string;
  originalName: string;
  type: 'image' | 'model' | 'document';
  url: string;
}

interface Contract {
  id: string;
  projectName: string;
  factoryName?: string;
  contractAmount: number;
  status: string;
  completedAt?: string;
  contractDate?: string;
  attachments?: Attachment[];
}

function won(n: number) {
  return n?.toLocaleString('ko-KR') + '원';
}

function formatDate(iso: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function amountLabel(amount: number): string {
  if (!amount) return '비공개';
  if (amount < 5_000_000) return '소형 프로젝트';
  if (amount < 30_000_000) return '중소형 프로젝트';
  if (amount < 100_000_000) return '중형 프로젝트';
  if (amount < 500_000_000) return '대형 프로젝트';
  return '특대형 프로젝트';
}

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
        <Link href="/" prefetch={false} className="text-lg font-black text-gray-900">NexyFab</Link>
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
            <Link key={item.href} href={item.href} prefetch={false}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${isActive ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'}`}>
              <span>{item.icon}</span>{item.label}
            </Link>
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

export default function PartnerPortfolioPage() {
  const router = useRouter();
  const [partner, setPartner] = useState<Partner | null>(null);
  const [completed, setCompleted] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const getSession = () => localStorage.getItem('partnerSession') || '';

  const logout = () => {
    localStorage.removeItem('partnerSession');
    localStorage.removeItem('partnerInfo');
    router.push('/partner/login');
  };

  const fetchContracts = useCallback(async (session: string) => {
    const res = await fetch('/api/partner/contracts', {
      headers: { Authorization: `Bearer ${session}` },
    });
    const data = await res.json();
    const all: Contract[] = data.contracts || [];
    setCompleted(all.filter(c => c.status === 'completed'));
  }, []);

  useEffect(() => {
    const session = getSession();
    if (!session) { router.replace('/partner/login'); return; }

    if (session === 'demo') {
      setPartner({ partnerId: 'demo-partner-001', email: 'demo-partner@nexyfab.com', company: 'Demo 제조사' });
      setCompleted([
        { id: 'demo-p1', projectName: 'EV 배터리 케이스 외주 제조', factoryName: '한국제조 (주)', contractAmount: 28000000, status: 'completed', completedAt: new Date(Date.now() - 10 * 86400000).toISOString(), contractDate: new Date(Date.now() - 90 * 86400000).toISOString() },
        { id: 'demo-p2', projectName: '항공우주 브라켓 가공', factoryName: '선진정밀 (주)', contractAmount: 55000000, status: 'completed', completedAt: new Date(Date.now() - 60 * 86400000).toISOString(), contractDate: new Date(Date.now() - 150 * 86400000).toISOString() },
        { id: 'demo-p3', projectName: '의료 임플란트 티타늄 가공', factoryName: '메디컬파츠', contractAmount: 12000000, status: 'completed', completedAt: new Date(Date.now() - 120 * 86400000).toISOString(), contractDate: new Date(Date.now() - 180 * 86400000).toISOString() },
      ]);
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

  const totalAmount = completed.reduce((s, c) => s + (c.contractAmount || 0), 0);

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

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 flex items-center justify-around py-2">
        {[
          { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
          { href: '/partner/projects', label: '프로젝트', icon: '📦' },
          { href: '/partner/quotes', label: '견적', icon: '📝' },
          { href: '/partner/settlements', label: '정산', icon: '💰' },
          { href: '/partner/profile', label: '프로필', icon: '🏭' },
        ].map(item => (
          <Link key={item.href} href={item.href} prefetch={false} className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl ${item.href === '/partner/portfolio' ? 'text-blue-600' : 'text-gray-500'}`}>
            <span className="text-xl leading-tight">{item.icon}</span>
            <span className="text-[10px] font-semibold">{item.label}</span>
          </Link>
        ))}
      </nav>

      <main className="flex-1 p-6 overflow-auto pb-20 md:pb-6">
        <div className="max-w-5xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-black text-gray-900">포트폴리오</h1>
            <p className="text-sm text-gray-500 mt-1">완료된 프로젝트 실적 현황</p>
          </div>

          {/* 내 실적 요약 */}
          <div className="grid grid-cols-2 gap-4 mb-8">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">완료 건수</p>
              <p className="text-3xl font-black text-gray-900">{completed.length}<span className="text-lg font-semibold text-gray-500 ml-1">건</span></p>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-5">
              <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">총 수주 금액</p>
              <p className="text-2xl font-black text-blue-600 truncate">{won(totalAmount)}</p>
            </div>
          </div>

          {completed.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-20 text-center text-gray-400 text-sm">
              <p className="text-4xl mb-3">🏆</p>
              <p>아직 완료된 프로젝트가 없습니다.</p>
              <p className="text-xs mt-1 text-gray-300">프로젝트를 완료하면 여기에 표시됩니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {completed.map(contract => {
                const images = (contract.attachments || []).filter(a => a.type === 'image');
                const thumbUrl = images[0]?.url || null;

                return (
                  <div key={contract.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    {/* 썸네일 */}
                    {thumbUrl ? (
                      <div
                        className="relative w-full h-40 bg-gray-100 cursor-pointer overflow-hidden"
                        onClick={() => setLightboxUrl(thumbUrl)}
                      >
                        <Image
                          src={thumbUrl}
                          alt={contract.projectName}
                          fill
                          className="object-cover hover:scale-105 transition-transform"
                          sizes="(max-width: 768px) 100vw, 480px"
                          unoptimized
                        />
                      </div>
                    ) : (
                      <div className="w-full h-40 bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                        <span className="text-4xl">🏭</span>
                      </div>
                    )}

                    {/* 카드 내용 */}
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-green-100 text-green-700">완료</span>
                        {contract.completedAt && (
                          <span className="text-xs text-gray-400">{formatDate(contract.completedAt)}</span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-gray-900 mb-1 truncate">{contract.projectName}</h3>
                      {contract.factoryName && (
                        <p className="text-xs text-gray-500 mb-2 truncate">{contract.factoryName}</p>
                      )}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
                          {amountLabel(contract.contractAmount)}
                        </span>
                        {images.length > 1 && (
                          <span className="text-xs text-gray-400">📎 {images.length}장</span>
                        )}
                      </div>
                    </div>

                    {/* 이미지 썸네일 미리보기 (여러 장) */}
                    {images.length > 1 && (
                      <div className="px-4 pb-4 grid grid-cols-4 gap-1">
                        {images.slice(1, 5).map(img => (
                          <div
                            key={img.id}
                            className="relative h-12 w-full rounded overflow-hidden cursor-pointer"
                            onClick={() => setLightboxUrl(img.url)}
                          >
                            <Image
                              src={img.url}
                              alt={img.originalName}
                              fill
                              className="object-cover hover:opacity-80 transition"
                              sizes="80px"
                              unoptimized
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* 라이트박스 */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <Image
            src={lightboxUrl}
            alt="원본 이미지"
            width={1600}
            height={1200}
            className="max-h-[90vh] w-auto max-w-full object-contain rounded-xl shadow-2xl"
            unoptimized
            onClick={e => e.stopPropagation()}
          />
          <button
            className="absolute top-4 right-4 text-white text-2xl font-bold hover:text-gray-300"
            onClick={() => setLightboxUrl(null)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
