'use client';

// NexyfabUnifiedSidebar — single left-rail nav across all NexyFab routes.
// Replaces the old NexyfabNav (operational) + the Hub-local sidebar that
// confusingly lived alongside it. Sections mirror the user journey:
//
//   DESIGN          — what the user creates (Hub, CAD, AI, Library)
//   MANUFACTURING   — what they do with their designs (RFQ, Orders, …)
//   ACCOUNT         — billing, settings, help
//
// Token-driven (--nx-*) so light/dark are free. Mobile: collapses to a
// 56px rail with icon-only entries.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import { isKorean } from '@/lib/i18n/normalize';
import NotificationBell from './NotificationBell';
import NexysysAppSwitcher from './NexysysAppSwitcher';

interface UnifiedSidebarProps {
  lang: string;
}

interface NavItem {
  icon: string;
  labelKo: string;
  labelEn: string;
  href: string;
  badge?: 'NEW' | 'PRO' | 'TEAM';
  comingSoon?: boolean;
}

interface NavSection {
  titleKo: string;
  titleEn: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    titleKo: '디자인',
    titleEn: 'Design',
    items: [
      { icon: '🏠', labelKo: '홈',                labelEn: 'Hub',                href: '/nexyfab/hub' },
      { icon: '✏️', labelKo: '3D 설계 시작',     labelEn: '3D Design',          href: '/shape-generator' },
      { icon: '✨', labelKo: 'Nexy AI 스튜디오', labelEn: 'Nexy AI Studio',     href: '/nexyfab/ai-studio', badge: 'NEW' },
      { icon: '📁', labelKo: '내 프로젝트',       labelEn: 'My Projects',        href: '/nexyfab/projects' },
      { icon: '🔗', labelKo: '공유된 항목',       labelEn: 'Shared with me',     href: '/nexyfab/projects?filter=shared' },
      { icon: '🔩', labelKo: '부품 라이브러리',   labelEn: 'Part Library',       href: '/nexyfab/cots' },
    ],
  },
  {
    titleKo: '제조',
    titleEn: 'Manufacturing',
    items: [
      { icon: '💬', labelKo: '견적 요청',     labelEn: 'RFQ',             href: '/nexyfab/rfq' },
      { icon: '📦', labelKo: '주문 추적',     labelEn: 'Orders',          href: '/nexyfab/orders' },
      { icon: '🏭', labelKo: '제조사 매칭',   labelEn: 'Marketplace',     href: '/nexyfab/marketplace' },
      { icon: '⚙️', labelKo: '제조 대시보드', labelEn: 'Mfr Dashboard',   href: '/nexyfab/manufacturer' },
      { icon: '💾', labelKo: '파일 관리',     labelEn: 'Files',           href: '/nexyfab/files' },
      { icon: '👥', labelKo: '팀 협업',       labelEn: 'Team',            href: '/nexyfab/team', badge: 'TEAM' },
    ],
  },
  {
    titleKo: '계정',
    titleEn: 'Account',
    items: [
      { icon: '💳', labelKo: '결제 & 구독', labelEn: 'Billing',  href: '/nexyfab/billing' },
      { icon: '🔧', labelKo: '설정',         labelEn: 'Settings', href: '/nexyfab/settings' },
      { icon: '📖', labelKo: '사용 가이드', labelEn: 'Guide',    href: '/help' },
    ],
  },
];

const PLAN_BADGE: Record<string, { label: string; color: string }> = {
  free:       { label: 'FREE', color: 'var(--nx-text-3)' },
  pro:        { label: 'PRO',  color: 'var(--nx-accent)' },
  team:       { label: 'TEAM', color: '#a371f7' },
  enterprise: { label: 'ENT',  color: '#d29922' },
};

export default function NexyfabUnifiedSidebar({ lang }: UnifiedSidebarProps) {
  const pathname = usePathname();
  const { user, token } = useAuthStore();
  const isKo = isKorean(lang);

  // Hide on the modeler / sketch routes — those have their own shell-v2 chrome.
  if (pathname?.includes('/shape-generator')) return null;

  const isActive = (href: string): boolean => {
    const [path, query] = href.split('?');
    const full = `/${lang}${path}`;
    // Don't activate Hub for every nexyfab child route.
    if (path === '/nexyfab/hub') return pathname === full || pathname === full + '/';
    if (path === '/nexyfab/projects') {
      // Differentiate "내 프로젝트" vs "공유된 항목" via querystring sniffing.
      const matches = pathname === full || pathname.startsWith(full + '/');
      if (!matches) return false;
      const isShared = typeof window !== 'undefined' && window.location.search.includes('filter=shared');
      return query?.includes('filter=shared') ? isShared : !isShared;
    }
    return pathname === full || pathname?.startsWith(full + '/');
  };

  const badge = PLAN_BADGE[user?.plan ?? 'free'] ?? PLAN_BADGE.free;
  const initials = user ? user.name.slice(0, 2).toUpperCase() : '?';

  return (
    <>
      <style precedence="default" href="nexyfab-unified-nav">{`
        .nf-uni-nav { width: 220px; min-width: 220px; }
        .nf-uni-label { display: block; }
        .nf-uni-section-title { display: block; }
        .nf-uni-brand-text { display: inline; }
        @media (max-width: 768px) {
          .nf-uni-nav { width: 56px !important; min-width: 56px !important; }
          .nf-uni-label { display: none !important; }
          .nf-uni-section-title { display: none !important; }
          .nf-uni-brand-text { display: none !important; }
        }
      `}</style>
      <aside
        className="nf-uni-nav"
        role="navigation"
        aria-label={isKo ? '주요 메뉴' : 'Main navigation'}
        style={{
          flex: '0 0 auto',
          background: 'var(--nx-panel)',
          borderRight: '1px solid var(--nx-border)',
          color: 'var(--nx-text)',
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          position: 'sticky',
          top: 0,
        }}
      >
        {/* Brand */}
        <Link
          href={`/${lang}/nexyfab/hub`}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '14px 14px 10px',
            textDecoration: 'none',
            color: 'var(--nx-text)',
            fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em',
            borderBottom: '1px solid var(--nx-border)',
          }}
        >
          <span style={{ color: 'var(--nx-text)' }}>Nexy</span>
          <span className="nf-uni-brand-text" style={{ color: 'var(--nx-accent)' }}>Fab</span>
        </Link>

        {/* Sections */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {SECTIONS.map((sec) => (
            <div key={sec.titleEn} style={{ marginBottom: 8 }}>
              <div
                className="nf-uni-section-title"
                style={{
                  fontSize: 10, fontWeight: 700,
                  color: 'var(--nx-text-3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  padding: '10px 14px 4px',
                }}
              >
                {isKo ? sec.titleKo : sec.titleEn}
              </div>
              {sec.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={`/${lang}${item.href}`}
                    aria-current={active ? 'page' : undefined}
                    aria-label={isKo ? item.labelKo : item.labelEn}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 14px',
                      textDecoration: 'none',
                      color: active ? 'var(--nx-accent-2)' : 'var(--nx-text)',
                      background: active ? 'var(--nx-accent-soft)' : 'transparent',
                      borderLeft: active ? '2px solid var(--nx-accent)' : '2px solid transparent',
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      lineHeight: 1.2,
                    }}
                    onMouseEnter={(e) => {
                      if (!active) (e.currentTarget as HTMLAnchorElement).style.background = 'var(--nx-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!active) (e.currentTarget as HTMLAnchorElement).style.background = 'transparent';
                    }}
                  >
                    <span aria-hidden="true" style={{ fontSize: 16, flex: '0 0 18px', textAlign: 'center' }}>{item.icon}</span>
                    <span className="nf-uni-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {isKo ? item.labelKo : item.labelEn}
                    </span>
                    {item.badge && (
                      <span
                        className="nf-uni-label"
                        style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 5px',
                          borderRadius: 3, letterSpacing: '0.04em',
                          background: item.badge === 'NEW' ? 'var(--nx-accent)' : item.badge === 'PRO' ? '#a371f7' : '#d29922',
                          color: '#fff',
                        }}
                      >
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer — user profile + notifications + app switcher */}
        <div
          style={{
            borderTop: '1px solid var(--nx-border)',
            padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <div
            style={{
              width: 28, height: 28, borderRadius: '50%',
              background: 'var(--nx-accent-soft)',
              color: 'var(--nx-accent)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700,
              flex: '0 0 28px',
            }}
          >
            {initials}
          </div>
          <div className="nf-uni-label" style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nx-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name ?? (isKo ? '게스트' : 'Guest')}
            </div>
            <div style={{ fontSize: 9, color: badge.color, fontWeight: 700 }}>
              {badge.label}
            </div>
          </div>
          <div className="nf-uni-label" style={{ display: 'flex', gap: 4 }}>
            {token && <NotificationBell token={token} lang={lang} />}
            <NexysysAppSwitcher />
          </div>
        </div>
      </aside>
    </>
  );
}
