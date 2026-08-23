'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import NotificationBell from '@/app/components/NotificationBell';
import AdminSessionControls from './AdminSessionControls';
import { useAdminI18n } from './AdminI18nProvider';
import type { AdminLocale } from '@/lib/i18n/adminTranslations';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';

interface NavItem {
  href: string;
  labelKo: string;
  labelEn: string;
  exact?: boolean;
  danger?: boolean;
  /** Logical grouping — renders a faint divider between groups so the long
   *  flat nav stays readable. Items without a group inherit from the prior. */
  group?: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/admin', labelKo: '대시보드', labelEn: 'Dashboard', exact: true, group: 'core' },
  { href: '/admin/users', labelKo: '회원 관리', labelEn: 'Users', group: 'core' },
  { href: '/admin/subscriptions', labelKo: '구독 관리', labelEn: 'Subscriptions', group: 'billing' },
  { href: '/admin/billing', labelKo: '청구 관리', labelEn: 'Billing', group: 'billing' },
  { href: '/admin/refund-queue', labelKo: '환불 큐', labelEn: 'Refund queue', group: 'billing' },
  { href: '/admin/analytics', labelKo: '매출 분석', labelEn: 'Revenue analytics', group: 'billing' },
  { href: '/admin/rfq', labelKo: 'RFQ 관리', labelEn: 'RFQ management', group: 'mfg' },
  { href: '/admin/factories', labelKo: '제조사 관리', labelEn: 'Manufacturers', group: 'mfg' },
  { href: '/admin/quotes', labelKo: '견적 관리', labelEn: 'Quotes', group: 'mfg' },
  { href: '/admin/contracts', labelKo: '계약 관리', labelEn: 'Contracts', group: 'mfg' },
  { href: '/admin/inquiries', labelKo: '문의 관리', labelEn: 'Inquiries', group: 'mfg' },
  { href: '/admin/partners', labelKo: '파트너 관리', labelEn: 'Partners', group: 'partner' },
  { href: '/admin/partner-applications', labelKo: '파트너 신청', labelEn: 'Partner applications', group: 'partner' },
  { href: '/admin/partner-kpi', labelKo: '파트너 KPI', labelEn: 'Partner KPI', group: 'partner' },
  { href: '/admin/partner-cutover', labelKo: '파트너 SSO 컷오버', labelEn: 'Partner SSO cutover', group: 'partner' },
  { href: '/admin/settlements', labelKo: '정산 관리', labelEn: 'Settlements', group: 'partner' },
  { href: '/admin/templates', labelKo: '템플릿 관리', labelEn: 'Templates', group: 'ops' },
  { href: '/admin/sla', labelKo: 'SLA 모니터링', labelEn: 'SLA monitoring', group: 'ops' },
  { href: '/admin/manufacturing-kpi', labelKo: '제조 KPI', labelEn: 'Manufacturing KPI', group: 'ops' },
  { href: '/admin/releases', labelKo: '릴리즈 관리', labelEn: 'Releases', group: 'ops' },
  { href: '/admin/jobs', labelKo: 'Job Queue', labelEn: 'Job Queue', group: 'ops' },
  // AI / Funnel — added in Rounds 16-29.
  { href: '/admin/funnel', labelKo: '깔때기', labelEn: 'Funnel', group: 'ai' },
  { href: '/admin/cost-overshoot', labelKo: 'AI 비용', labelEn: 'AI cost', group: 'ai' },
  { href: '/admin/ai-usage', labelKo: 'AI 시계열', labelEn: 'AI time series', group: 'ai' },

  { href: '/admin/prompt-stats', labelKo: 'Prompt 통계', labelEn: 'Prompt statistics', group: 'ai' },
  { href: '/admin/prompt-compare', labelKo: 'Prompt 비교', labelEn: 'Prompt comparison', group: 'ai' },
  { href: '/admin/prompt-compare-history', labelKo: 'Prompt 비교 기록', labelEn: 'Prompt history', group: 'ai' },
  { href: '/admin/disabled-variants', labelKo: 'Variant Kill Switch', labelEn: 'Variant Kill Switch', group: 'ai' },
  { href: '/admin/email-logs', labelKo: '이메일 로그', labelEn: 'Email logs', group: 'logs' },
  { href: '/admin/audit', labelKo: '감사 로그 (legacy)', labelEn: 'Audit log (legacy)', group: 'logs' },
  { href: '/admin/audit-log', labelKo: '감사 로그 (admin actions)', labelEn: 'Audit log (admin actions)', group: 'logs' },
  { href: '/admin/webhooks', labelKo: '웹훅 이벤트', labelEn: 'Webhook events', group: 'logs' },
  { href: '/admin/search', labelKo: '검색', labelEn: 'Search', group: 'logs' },
  { href: '/admin/logs', labelKo: '로그', labelEn: 'Logs', group: 'logs' },
  // Concierge / matchmaking ops console
  { href: '/admin/concierge', labelKo: 'Concierge 매칭', labelEn: 'Concierge matching', group: 'concierge' },
  { href: '/admin/anti-poach', labelKo: '거래우회 감시', labelEn: 'Transaction bypass watch', group: 'concierge' },
  // Platform observability + runtime config
  { href: '/admin/api-health', labelKo: '🔌 API 상태', labelEn: '🔌 API health', group: 'platform' },
  { href: '/admin/native-cad-workers', labelKo: 'CAD 작업자', labelEn: 'CAD workers', exact: true, group: 'platform' },
  { href: '/admin/native-cad-workers/expert-review', labelKo: 'CAD 검토', labelEn: 'CAD review', group: 'platform' },
  { href: '/admin/settings', labelKo: '🔐 설정', labelEn: '🔐 Settings', group: 'platform' },
  { href: '/admin/access-emails', labelKo: '관리자 이메일', labelEn: 'Administrator emails', group: 'security' },
  { href: '/admin/security', labelKo: '보안', labelEn: 'Security', danger: true, group: 'security' },
];

export default function AdminNav() {
  const pathname = usePathname();
  const { copy, locale } = useAdminI18n();
  const L = createCommercialLocalizer(locale);

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
              {L(item.labelKo, item.labelEn)}
            </Link>
          </span>
        );
      })}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        <NotificationBell recipient="admin" />
        <AdminSessionControls />
        <label className="flex items-center gap-1 text-xs text-gray-500">
          <span className="sr-only">{copy.language}</span>
          <select aria-label={copy.language} value={locale} onChange={(event) => changeAdminLocale(event.target.value as AdminLocale)} className="border border-gray-200 rounded-md px-1.5 py-1 bg-white">
            <option value="ko">한국어</option><option value="en">English</option><option value="ja">日本語</option><option value="zh">中文</option><option value="es">Español</option><option value="ar">العربية</option>
          </select>
        </label>
        <Link href="/partner/dashboard" className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">{copy.partnerPortal}</Link>
        <Link href="/" className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors">← {copy.site}</Link>
      </div>
    </nav>
  );
}

function changeAdminLocale(locale: AdminLocale) {
  document.cookie = `nf_admin_locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  window.location.reload();
}
