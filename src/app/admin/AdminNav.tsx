'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import NotificationBell from '@/app/components/NotificationBell';

const NAV_ITEMS = [
  { href: '/admin', label: '대시보드', exact: true },
  { href: '/admin/users', label: '회원 관리' },
  { href: '/admin/subscriptions', label: '구독 관리' },
  { href: '/admin/billing', label: '청구 관리' },
  { href: '/admin/analytics', label: '매출 분석' },
  { href: '/admin/rfq', label: 'RFQ 관리' },
  { href: '/admin/factories', label: '제조사 관리' },
  { href: '/admin/quotes', label: '견적 관리' },
  { href: '/admin/contracts', label: '계약 관리' },
  { href: '/admin/inquiries', label: '문의 관리' },
  { href: '/admin/partners', label: '파트너 관리' },
  { href: '/admin/partner-applications', label: '파트너 신청' },
  { href: '/admin/partner-kpi', label: '파트너 KPI' },
  { href: '/admin/settlements', label: '정산 관리' },
  { href: '/admin/templates', label: '템플릿 관리' },
  { href: '/admin/sla', label: 'SLA 모니터링' },
  { href: '/admin/manufacturing-kpi', label: '제조 KPI' },
  { href: '/admin/releases', label: '릴리즈 관리' },
  { href: '/admin/jobs', label: 'Job Queue' },
  { href: '/admin/email-logs', label: '이메일 로그' },
  { href: '/admin/audit', label: '감사 로그' },
  { href: '/admin/webhooks', label: '웹훅 이벤트' },
  { href: '/admin/search', label: '검색' },
  { href: '/admin/logs', label: '로그' },
  { href: '/admin/security', label: '보안', danger: true },
];

export default function AdminNav() {
  const pathname = usePathname();

  function isActive(href: string, exact?: boolean) {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  return (
    <nav className="bg-white border-b px-4 py-2.5 flex items-center gap-1 flex-wrap">
      <Link href="/admin" className="font-bold text-base text-gray-900 mr-3 hover:text-blue-600 transition-colors shrink-0">
        NexyFab <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Admin</span>
      </Link>
      {NAV_ITEMS.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className={[
            'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap',
            isActive(item.href, item.exact)
              ? item.danger
                ? 'bg-red-50 text-red-600'
                : 'bg-blue-50 text-blue-700'
              : item.danger
                ? 'text-red-500 hover:bg-red-50'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
          ].join(' ')}
        >
          {item.label}
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <NotificationBell recipient="admin" />
        <Link href="/partner/dashboard" className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">파트너 포털</Link>
        <Link href="/" className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">← 사이트로</Link>
      </div>
    </nav>
  );
}
