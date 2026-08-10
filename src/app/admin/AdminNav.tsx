'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import NotificationBell from '@/app/components/NotificationBell';

interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
  danger?: boolean;
  /** Logical grouping — renders a faint divider between groups so the long
   *  flat nav stays readable. Items without a group inherit from the prior. */
  group?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin', label: '대시보드', exact: true, group: 'core' },
  { href: '/admin/users', label: '회원 관리', group: 'core' },
  { href: '/admin/subscriptions', label: '구독 관리', group: 'billing' },
  { href: '/admin/billing', label: '청구 관리', group: 'billing' },
  { href: '/admin/refund-queue', label: '환불 큐', group: 'billing' },     // ← Round 29
  { href: '/admin/analytics', label: '매출 분석', group: 'billing' },
  { href: '/admin/rfq', label: 'RFQ 관리', group: 'mfg' },
  { href: '/admin/factories', label: '제조사 관리', group: 'mfg' },
  { href: '/admin/quotes', label: '견적 관리', group: 'mfg' },
  { href: '/admin/contracts', label: '계약 관리', group: 'mfg' },
  { href: '/admin/inquiries', label: '문의 관리', group: 'mfg' },
  { href: '/admin/partners', label: '파트너 관리', group: 'partner' },
  { href: '/admin/partner-applications', label: '파트너 신청', group: 'partner' },
  { href: '/admin/partner-kpi', label: '파트너 KPI', group: 'partner' },
  { href: '/admin/partner-cutover', label: '파트너 SSO 컷오버', group: 'partner' },
  { href: '/admin/settlements', label: '정산 관리', group: 'partner' },
  { href: '/admin/templates', label: '템플릿 관리', group: 'ops' },
  { href: '/admin/sla', label: 'SLA 모니터링', group: 'ops' },
  { href: '/admin/manufacturing-kpi', label: '제조 KPI', group: 'ops' },
  { href: '/admin/releases', label: '릴리즈 관리', group: 'ops' },
  { href: '/admin/jobs', label: 'Job Queue', group: 'ops' },
  // AI / Funnel — added in Rounds 16-29.
  { href: '/admin/funnel', label: '깔때기', group: 'ai' },
  { href: '/admin/cost-overshoot', label: 'AI 비용', group: 'ai' },
  { href: '/admin/ai-usage', label: 'AI 시계열', group: 'ai' },

  { href: '/admin/prompt-stats', label: 'Prompt 통계', group: 'ai' },
  { href: '/admin/prompt-compare', label: 'Prompt 비교', group: 'ai' },
  { href: '/admin/prompt-compare-history', label: 'Prompt 비교 기록', group: 'ai' },
  { href: '/admin/disabled-variants', label: 'Variant Kill Switch', group: 'ai' },
  { href: '/admin/email-logs', label: '이메일 로그', group: 'logs' },
  { href: '/admin/audit', label: '감사 로그 (legacy)', group: 'logs' },
  { href: '/admin/audit-log', label: '감사 로그 (admin actions)', group: 'logs' },
  { href: '/admin/webhooks', label: '웹훅 이벤트', group: 'logs' },
  { href: '/admin/search', label: '검색', group: 'logs' },
  { href: '/admin/logs', label: '로그', group: 'logs' },
  // Concierge / matchmaking ops console
  { href: '/admin/concierge', label: 'Concierge 매칭', group: 'concierge' },
  { href: '/admin/anti-poach', label: '거래우회 감시', group: 'concierge' },
  // Platform observability + runtime config
  { href: '/admin/api-health', label: '🔌 API Health', group: 'platform' },
  { href: '/admin/native-cad-workers', label: 'CAD Workers', exact: true, group: 'platform' },
  { href: '/admin/native-cad-workers/expert-review', label: 'CAD Review', group: 'platform' },
  { href: '/admin/settings', label: '🔐 Settings', group: 'platform' },
  { href: '/admin/security', label: '보안', danger: true, group: 'security' },
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
      {NAV_ITEMS.map((item, i) => {
        // Insert a faint vertical divider when the group changes — gives the
        // long nav some visual rhythm without forcing a sidebar refactor.
        const prev = i > 0 ? NAV_ITEMS[i - 1] : undefined;
        const showDivider = !!item.group && prev && prev.group !== item.group;
        return (
          <span key={item.href} className="contents">
            {showDivider && <span aria-hidden className="w-px h-5 bg-gray-200 mx-1 self-center" />}
            <Link
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
          </span>
        );
      })}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <NotificationBell recipient="admin" />
        <Link href="/partner/dashboard" className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">파트너 포털</Link>
        <Link href="/" className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">← 사이트로</Link>
      </div>
    </nav>
  );
}
