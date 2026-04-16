'use client';

import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import NexysysAppSwitcher from './NexysysAppSwitcher';
import NotificationBell from './NotificationBell';

interface NexyfabNavProps {
  lang: string;
  currentPath?: string;
}

const NAV_ITEMS: { icon: string; labelKo: string; labelEn: string; href: string; accent?: boolean; planBadge?: string }[] = [
  { icon: '🏠', labelKo: '홈', labelEn: 'Home', href: '/nexyfab' },
  { icon: '✏️', labelKo: '3D 설계 시작', labelEn: '3D Design', href: '/shape-generator', accent: true },
  { icon: '📁', labelKo: '내 프로젝트', labelEn: 'My Projects', href: '/nexyfab/projects' },
  { icon: '💬', labelKo: '견적 요청', labelEn: 'RFQ', href: '/nexyfab/rfq' },
  { icon: '📦', labelKo: '주문 추적', labelEn: 'Orders', href: '/nexyfab/orders' },
  { icon: '🏭', labelKo: '제조사 매칭', labelEn: 'Marketplace', href: '/nexyfab/marketplace' },
  { icon: '⚙️', labelKo: '제조 대시보드', labelEn: 'Mfr Dashboard', href: '/nexyfab/manufacturer' },
  { icon: '🔩', labelKo: 'COTS 부품', labelEn: 'COTS Parts', href: '/nexyfab/cots' },
  { icon: '💾', labelKo: '파일 관리', labelEn: 'Files', href: '/nexyfab/files' },
  { icon: '👥', labelKo: '팀 협업', labelEn: 'Team', href: '/nexyfab/team', planBadge: 'team' },
  { icon: '💳', labelKo: '결제 & 구독', labelEn: 'Billing', href: '/nexyfab/billing' },
];

const PLAN_BADGE: Record<string, { label: string; color: string }> = {
  free:       { label: 'FREE', color: '#6e7681' },
  pro:        { label: 'PRO',  color: '#388bfd' },
  team:       { label: 'TEAM', color: '#a371f7' },
  enterprise: { label: 'ENT',  color: '#d29922' },
};

export default function NexyfabNav({ lang }: NexyfabNavProps) {
  const pathname = usePathname();
  const { user, token } = useAuthStore();
  const isKo = lang === 'ko';

  const isActive = (href: string): boolean => {
    const full = `/${lang}${href}`;
    if (href === '/nexyfab') return pathname === full;
    return pathname === full || pathname.startsWith(full + '/');
  };

  const badge = PLAN_BADGE[user?.plan ?? 'free'] ?? PLAN_BADGE.free;
  const initials = user ? user.name.slice(0, 2).toUpperCase() : '?';

  return (
    <>
      <style>{`
        .nf-nav {
          width: 200px;
          min-width: 200px;
        }
        .nf-nav-label { display: block; }
        .nf-logo-text { display: inline; }
        @media (max-width: 768px) {
          .nf-nav {
            width: 56px !important;
            min-width: 56px !important;
          }
          .nf-nav-label { display: none !important; }
          .nf-logo-text { display: none !important; }
          .nf-profile-info { display: none !important; }
        }
      `}</style>

      <nav
        className="nf-nav"
        style={{
          height: '100vh',
          background: '#0d1117',
          borderRight: '1px solid #30363d',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          overflowY: 'auto',
          flexShrink: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          overflowX: 'hidden',
        }}
      >
        {/* Logo */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid #21262d' }}>
          <a
            href={`/${lang}/nexyfab`}
            style={{ fontSize: 17, fontWeight: 800, color: '#e6edf3', textDecoration: 'none', letterSpacing: '-0.02em' }}
          >
            <span style={{ color: '#8b9cf4' }}>N</span>
            <span className="nf-logo-text" style={{ color: '#8b9cf4' }}>exy</span>
            <span className="nf-logo-text">Fab</span>
          </a>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '8px 0' }}>
          {NAV_ITEMS.map(item => {
            const active = isActive(item.href);
            const href = `/${lang}${item.href}`;
            const label = isKo ? item.labelKo : item.labelEn;

            if (item.accent) {
              return (
                <div key={item.href} style={{ padding: '4px 10px 4px' }}>
                  <div style={{ borderTop: '1px solid #21262d', marginBottom: 8 }} />
                  <a
                    href={href}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 9,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                      color: '#fff',
                      fontSize: 13,
                      fontWeight: 700,
                      textDecoration: 'none',
                      transition: 'opacity 0.15s',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
                  >
                    <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
                    <span className="nf-nav-label" style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                      <span>{label}</span>
                      <span style={{ fontSize: 9, fontWeight: 500, opacity: 0.8, letterSpacing: '0.04em' }}>
                        CAD · DFM · FEA
                      </span>
                    </span>
                  </a>
                </div>
              );
            }

            return (
              <a
                key={item.href}
                href={href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '8px 16px',
                  marginBottom: 1,
                  color: active ? '#e6edf3' : '#6e7681',
                  background: active ? '#21262d' : 'transparent',
                  borderLeft: active ? '3px solid #388bfd' : '3px solid transparent',
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  textDecoration: 'none',
                  transition: 'all 0.12s',
                  boxSizing: 'border-box',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
                onMouseEnter={e => {
                  if (!active) {
                    e.currentTarget.style.color = '#c9d1d9';
                    e.currentTarget.style.background = '#161b22';
                  }
                }}
                onMouseLeave={e => {
                  if (!active) {
                    e.currentTarget.style.color = '#6e7681';
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                <span style={{ fontSize: 14, flexShrink: 0 }}>{item.icon}</span>
                <span className="nf-nav-label" style={{ flex: 1 }}>{label}</span>
                {item.planBadge === 'team' && user && !['team', 'enterprise'].includes(user.plan) && (
                  <span className="nf-nav-label" style={{ fontSize: 9, color: '#a371f7', fontWeight: 800 }}>TEAM</span>
                )}
              </a>
            );
          })}
        </div>

        {/* Nexysys product switcher */}
        <NexysysAppSwitcher />

        {/* Notification bell */}
        {user && <NotificationBell token={token} lang={lang} />}

        {/* Bottom: plan badge + profile */}
        <div style={{ borderTop: '1px solid #21262d', padding: '12px', marginTop: 8 }}>
          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 800,
                color: '#fff',
                flexShrink: 0,
              }}>
                {initials}
              </div>
              <div className="nf-profile-info" style={{ minWidth: 0, flex: 1 }}>
                <p style={{
                  margin: 0,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#e6edf3',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {user.name}
                </p>
                <span style={{
                  fontSize: 9,
                  fontWeight: 800,
                  color: badge.color,
                  background: `${badge.color}1a`,
                  borderRadius: 3,
                  padding: '1px 4px',
                  letterSpacing: '0.06em',
                }}>
                  {badge.label}
                </span>
              </div>
            </div>
          ) : (
            <a
              href={`/${lang}/nexyfab`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6e7681', textDecoration: 'none' }}
            >
              <span style={{ flexShrink: 0 }}>👤</span>
              <span className="nf-nav-label">{isKo ? '로그인' : 'Sign in'}</span>
            </a>
          )}
        </div>
      </nav>
    </>
  );
}
