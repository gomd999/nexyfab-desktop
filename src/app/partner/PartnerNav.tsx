'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { usePartnerLang } from './_lib/partnerLang';
import { partnerDict } from './_lib/partnerDict';

interface PartnerInfo {
  email: string;
  company: string;
}

export default function PartnerNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [info, setInfo] = useState<PartnerInfo>({ email: '', company: '' });
  const lang = usePartnerLang();
  const t = partnerDict(lang);

  const NAV_ITEMS = [
    { href: '/partner/hub',         label: t.navHub,         icon: '🏠' },
    { href: '/partner/dashboard',   label: t.navDashboard,   icon: '📊' },
    { href: '/partner/projects',    label: t.navProjects,    icon: '📦' },
    { href: '/partner/quotes',      label: t.navQuotes,      icon: '📝' },
    { href: '/partner/orders',      label: t.navOrders,      icon: '🏗️' },
    { href: '/partner/rma',         label: t.navRma,         icon: '⚠️' },
    { href: '/partner/settlements', label: t.navSettlements, icon: '💰' },
    { href: '/partner/portfolio',   label: t.navPortfolio,   icon: '🏆' },
    { href: '/partner/profile',     label: t.navProfile,     icon: '🏭' },
  ];

  const MOBILE_NAV_ITEMS = [
    { href: '/partner/hub',       label: t.navHub,       icon: '🏠' },
    { href: '/partner/quotes',    label: t.navQuotes,    icon: '📝' },
    { href: '/partner/orders',    label: t.navOrders,    icon: '🏗️' },
    { href: '/partner/rma',       label: t.navRma,       icon: '⚠️' },
    { href: '/partner/profile',   label: t.navProfile,   icon: '🏭' },
  ];

  useEffect(() => {
    queueMicrotask(() => {
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
    });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('partnerSession');
    localStorage.removeItem('partnerInfo');
    router.push(`/partner/login?lang=${lang}`);
  }, [router, lang]);

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className="hidden md:flex flex-col w-56 shrink-0 bg-white border-r border-gray-100 min-h-screen"
        role="navigation"
        aria-label={t.brandSubtitle}
      >
        <div className="px-5 py-5 border-b border-gray-100">
          <Link href={`/?lang=${lang}`} prefetch={false} className="text-lg font-black text-gray-900">NexyFab</Link>
          <p className="text-xs text-gray-400 mt-0.5">{t.brandSubtitle}</p>
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
                aria-current={isActive ? 'page' : undefined}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span aria-hidden="true">{item.icon}</span>
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
            <span aria-hidden="true">🚪</span>{t.navLogout}
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-100 flex items-center justify-around py-2"
        aria-label={t.brandSubtitle}
      >
        {MOBILE_NAV_ITEMS.map(item => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              aria-current={isActive ? 'page' : undefined}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-xl ${
                isActive ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <span aria-hidden="true" className="text-xl leading-tight">{item.icon}</span>
              <span className="text-[10px] font-semibold">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
