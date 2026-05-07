'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
  { href: '/partner/projects',  label: '프로젝트',  icon: '📦' },
  { href: '/partner/quotes',    label: '견적',      icon: '📝' },
  { href: '/partner/orders',    label: '주문',      icon: '🏗️' },
  { href: '/partner/rma',       label: 'RMA·불량',  icon: '⚠️' },
  { href: '/partner/settlements', label: '정산',    icon: '💰' },
  { href: '/partner/portfolio', label: '포트폴리오', icon: '🏆' },
  { href: '/partner/profile',   label: '프로필',    icon: '🏭' },
];

// Mobile nav shows a subset (no portfolio to keep it compact)
const MOBILE_NAV_ITEMS = [
  { href: '/partner/dashboard', label: '대시보드', icon: '📊' },
  { href: '/partner/quotes',    label: '견적',      icon: '📝' },
  { href: '/partner/orders',    label: '주문',      icon: '🏗️' },
  { href: '/partner/rma',       label: 'RMA',       icon: '⚠️' },
  { href: '/partner/profile',   label: '프로필',    icon: '🏭' },
];

interface PartnerInfo {
  email: string;
  company: string;
}

export default function PartnerNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [info, setInfo] = useState<PartnerInfo>({ email: '', company: '' });

  useEffect(() => {
    try {
      const raw = localStorage.getItem('partnerInfo');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<PartnerInfo>;
        setInfo({
          email: parsed.email ?? '',
          company: parsed.company ?? '',
        });
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('partnerSession');
    localStorage.removeItem('partnerInfo');
    router.push('/partner/login');
  }, [router]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0 bg-white border-r border-gray-100 min-h-screen">
        <div className="px-5 py-5 border-b border-gray-100">
          <Link href="/" prefetch={false} className="text-lg font-black text-gray-900">NexyFab</Link>
          <p className="text-xs text-gray-400 mt-0.5">파트너 포털</p>
        </div>
        {(info.company || info.email) && (
          <div className="px-5 py-4 border-b border-gray-100">
            {info.company && (
              <div className="text-sm font-bold text-gray-800 truncate">{info.company}</div>
            )}
            {info.email && (
              <div className="text-xs text-gray-400 truncate">{info.email}</div>
            )}
          </div>
        )}
        <nav className="flex-1 px-3 py-3 space-y-1">
          {NAV_ITEMS.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 py-4 border-t border-gray-100">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <span>🚪</span>로그아웃
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 flex items-center justify-around py-2">
        {MOBILE_NAV_ITEMS.map(item => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <span className="text-xl leading-tight">{item.icon}</span>
              <span className="text-[10px] font-semibold">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
