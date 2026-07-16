'use client';

// NexyfabUnifiedSidebar — single left-rail nav across all NexyFab routes.
// Replaces the old NexyfabNav (operational) + the Hub-local sidebar that
// confusingly lived alongside it.
//
// Sidebar surface intentionally narrow — only the Design destinations are
// pinned. Manufacturing (RFQ/Orders/etc.) and Account (Settings/Guide/
// Billing/Logout) used to be sibling sections; both were dropped on user
// request (2026-05-16) because the dashboard already covers Manufacturing
// and Account belongs in the avatar dropdown (industry pattern).
//
// Token-driven (--nx-*) so light/dark are free. Mobile: collapses to a
// 56px rail with icon-only entries.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
  /**
   * If true, the href is used verbatim (no `/${lang}` prefix). Use for
   * cross-surface links like the partner portal that lives outside the
   * customer i18n tree.
   */
  external?: boolean;
}

interface NavSection {
  titleKo: string;
  titleEn: string;
  items: NavItem[];
}

// 2026-07-16 IA 결정: 분야-우선 7항목으로 축소(사용자 멘탈 모델 = "무엇을 설계하러 왔나").
// - 계산기·설계 검토 → 스튜디오 4탭(생성|검증|계산기|출력)이 정식 진입로
// - 가설·랙 → 기계 페이지 안의 세부분야 칩으로 흡수(isActive에서 rack도 기계로 판정)
// - 자유형 Studio·전문가형 CAD·종이레이저컷·부품 → 기계 페이지의 전문 도구 카드
// - 공유된 항목 → 내 프로젝트 페이지의 '공유됨' 탭
// 2026-07-16 AI 설계+스튜디오 통합 IA: [분야] + 채팅 내역 + 내 프로젝트.
// 채팅 섹션은 동적(nf_chat_threads_v1 — 랜딩 챗·스튜디오 도크와 같은 저장소)이라
// SECTIONS 밖에서 렌더한다. 분야와 채팅 사이에 끼워 넣기 위해 섹션을 둘로 나눈다.
// 2026-07-16 재배치(사용자): 최상단='＋ 새 채팅' CTA(별도 렌더), 홈(허브)은 하단으로.
const SECTION_MAIN: NavSection = {
  titleKo: '', titleEn: '',
  items: [
    { icon: '🔧', labelKo: '기계',     labelEn: 'Mechanical',   href: '/nexyfab/design?domain=mech' },
    { icon: '🏢', labelKo: '건축',     labelEn: 'Architecture', href: '/nexyfab/design?domain=building' },
    { icon: '🌉', labelKo: '토목',     labelEn: 'Civil',        href: '/nexyfab/design?domain=civil' },
    { icon: '🌳', labelKo: '조경',     labelEn: 'Landscape',    href: '/nexyfab/design?domain=landscape' },
    { icon: '🪑', labelKo: '인테리어', labelEn: 'Interior',     href: '/nexyfab/design?domain=interior' },
  ],
};
const SECTION_BOTTOM: NavSection = {
  titleKo: '', titleEn: '',
  items: [
    { icon: '🏠', labelKo: '홈 (허브)',   labelEn: 'Home (Hub)',  href: '/nexyfab/hub' },
    { icon: '📁', labelKo: '내 프로젝트', labelEn: 'My Projects', href: '/nexyfab/projects' },
  ],
};

interface ChatThreadLite { id: string; title: string; domain?: string; updated?: number; pinned?: boolean; badge?: string | null }
// 스레드 분야 아이콘 — ChatHero의 도메인 값(mechanical…)과 동일 키
const THREAD_EMOJI: Record<string, string> = { mechanical: '🔧', civil: '🌉', architecture: '🏢', landscape: '🌳', interior: '🪑' };

// Avatar dropdown items (replaces the old Account sidebar section).
interface MenuItem { icon: string; labelKo: string; labelEn: string; href: string; external?: boolean; }
const AVATAR_MENU: MenuItem[] = [
  { icon: '💳', labelKo: '결제 & 구독',  labelEn: 'Billing',  href: '/nexyfab/billing' },
  { icon: '🔧', labelKo: '설정',          labelEn: 'Settings', href: '/nexyfab/settings' },
  { icon: '📖', labelKo: '사용 가이드',  labelEn: 'Guide',    href: '/help' },
];

const PLAN_BADGE: Record<string, { label: string; color: string }> = {
  free:       { label: 'FREE', color: 'var(--nx-text-3)' },
  pro:        { label: 'PRO',  color: 'var(--nx-accent)' },
  team:       { label: 'TEAM', color: '#a371f7' },
  enterprise: { label: 'ENT',  color: '#d29922' },
};

export default function NexyfabUnifiedSidebar({ lang }: UnifiedSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, token, logout } = useAuthStore();
  const isKo = isKorean(lang);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 채팅 내역 — 랜딩 챗과 같은 로컬 저장소(서버 스레드도 랜딩 방문 시 로컬에 미러됨)
  const [chatThreads, setChatThreads] = useState<ChatThreadLite[]>([]);
  useEffect(() => {
    const load = () => {
      try {
        const list = JSON.parse(localStorage.getItem('nf_chat_threads_v1') ?? '[]') as ChatThreadLite[];
        setChatThreads(
          list.filter((t) => t && t.id && t.title)
            .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.updated ?? 0) - (a.updated ?? 0))
            .slice(0, 6),
        );
      } catch { /* ignore */ }
    };
    load();
    window.addEventListener('storage', load);
    window.addEventListener('focus', load);
    return () => { window.removeEventListener('storage', load); window.removeEventListener('focus', load); };
  }, []);

  // Close avatar dropdown on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setMenuOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Hide on the modeler / sketch routes — those have their own shell-v2 chrome.
  if (pathname?.includes('/shape-generator')) return null;

  const isActive = (href: string): boolean => {
    const [path, query] = href.split('?');
    const full = `/${lang}${path}`;
    // Don't activate Hub for every nexyfab child route.
    if (path === '/nexyfab/hub') return pathname === full || pathname === full + '/';
    if (path === '/nexyfab/design') {
      // 분야(?domain=X) 판정. 가설·랙(rack)은 기계에 흡수(2026-07-16 IA).
      const matches = pathname === full || pathname.startsWith(full + '/');
      if (!matches) return false;
      const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
      const cur = sp?.get('domain') ?? null;
      const own = query?.startsWith('domain=') ? query.slice('domain='.length) : null;
      if (!own) return !cur;
      if (own === 'mech') return cur === 'mech' || cur === 'rack';
      return own === cur;
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
          .nf-uni-chat-item { display: none !important; }
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
        {/* Brand — clicking returns to the main customer landing.
            "NexyFab" is one word; the colored spans must not have any gap
            between them. */}
        <Link
          href={`/${lang}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 0,
            padding: '14px 14px 10px',
            textDecoration: 'none',
            color: 'var(--nx-text)',
            fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em',
            borderBottom: '1px solid var(--nx-border)',
          }}
        >
          {/* 메인 사이트 헤더와 동일 팔레트: Nexy=본문색 · Fab=#0b5cff (2026-07-16 통일) */}
          <span style={{ color: 'var(--nx-text)' }}>Nexy</span>
          <span className="nf-uni-brand-text" style={{ color: '#0b5cff' }}>Fab</span>
        </Link>

        {/* ＋ 새 채팅 — 최상단 CTA(Gemini 문법, 2026-07-16 사용자 결정) */}
        <div style={{ padding: '10px 10px 4px' }}>
          <a href={`/${lang}/nexyfab/ai/`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 800, color: 'var(--nx-accent)', border: '1.5px dashed var(--nx-accent)', background: 'var(--nx-accent-soft, rgba(37,99,235,0.08))' }}>
            <span aria-hidden="true">＋</span>
            <span className="nf-uni-label">{isKo ? '새 채팅' : 'New chat'}</span>
          </a>
        </div>

        {/* Sections */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {([SECTION_MAIN, 'CHAT', SECTION_BOTTOM] as Array<NavSection | 'CHAT'>).map((sec) => sec === 'CHAT' ? (
            /* 채팅 내역 — AI 설계(랜딩 챗)와 스튜디오 통합 IA(2026-07-16): 대화 재진입 경로 */
            <div key="chat" style={{ marginBottom: 8 }}>
              <div className="nf-uni-section-title" style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 14px 4px' }}>
                {isKo ? '채팅' : 'Chats'}
              </div>
              {/* 새 채팅은 최상단 CTA로 승격(중복 제거) — 여기는 스레드 목록만.
                  <a> 사용: 같은 라우트에서 ?t=만 바뀌면 Link는 재마운트하지 않아 스레드 전환이 안 됨 */}
              {chatThreads.map((th) => (
                <a key={th.id} className="nf-uni-chat-item" href={`/${lang}/nexyfab/ai/?t=${th.id}`} title={th.title}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 14px', textDecoration: 'none', color: 'var(--nx-text)', fontSize: 12, borderLeft: '2px solid transparent', lineHeight: 1.2 }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--nx-hover)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}>
                  <span aria-hidden="true" style={{ fontSize: 12, flex: '0 0 18px', textAlign: 'center' }}>{th.pinned ? '📌' : (THREAD_EMOJI[th.domain ?? ''] ?? '💬')}</span>
                  <span className="nf-uni-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{th.title}</span>
                  {th.badge && (
                    <span className="nf-uni-label" style={{ fontSize: 9, fontWeight: 800, color: th.badge === 'PASS' || th.badge === '✓' ? '#16a34a' : th.badge === 'FAIL' || th.badge === '✗' ? '#dc2626' : 'var(--nx-text-3)' }}>
                      {th.badge === 'PASS' ? '✓' : th.badge === 'FAIL' ? '✗' : th.badge}
                    </span>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <div key={sec.items[0]?.href ?? sec.titleEn} style={{ marginBottom: 8 }}>
              {(isKo ? sec.titleKo : sec.titleEn) !== '' && (
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
              )}
              {sec.items.map((item) => {
                const active = item.external ? false : isActive(item.href);
                // External (cross-surface) links — append ?lang to preserve
                // the customer's language preference into surfaces that don't
                // share our [lang] segment (e.g. partner portal).
                const linkHref = item.external
                  ? `${item.href}${item.href.includes('?') ? '&' : '?'}lang=${lang}`
                  : `/${lang}${item.href}`;
                return (
                  <Link
                    key={item.href}
                    href={linkHref}
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

        {/* Footer — user profile + notifications + app switcher.
            Avatar+name area is the trigger for the account dropdown
            (Billing / Settings / Guide / Logout) — replaces the old
            Account sidebar section. */}
        <div
          ref={menuRef}
          style={{
            position: 'relative',
            borderTop: '1px solid var(--nx-border)',
            padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <button
            type="button"
            onClick={() => setMenuOpen(o => !o)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              flex: 1, minWidth: 0,
              padding: 0,
              background: 'transparent',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              textAlign: 'left',
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
          </button>
          <div className="nf-uni-label" style={{ display: 'flex', gap: 4 }}>
            {token && <NotificationBell token={token} lang={lang} />}
            <NexysysAppSwitcher />
          </div>

          {menuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 4px)',
                left: 8,
                right: 8,
                background: 'var(--nx-panel)',
                border: '1px solid var(--nx-border)',
                borderRadius: 8,
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                padding: 4,
                zIndex: 50,
              }}
            >
              {AVATAR_MENU.map(item => (
                <Link
                  key={item.href}
                  href={`/${lang}${item.href}`}
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 10px',
                    borderRadius: 6,
                    textDecoration: 'none',
                    color: 'var(--nx-text)',
                    fontSize: 12,
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--nx-hover)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
                >
                  <span aria-hidden="true" style={{ fontSize: 14, width: 16, textAlign: 'center' }}>{item.icon}</span>
                  <span>{isKo ? item.labelKo : item.labelEn}</span>
                </Link>
              ))}
              <div style={{ height: 1, background: 'var(--nx-border)', margin: '4px 0' }} />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                  router.push(`/${lang}`);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: 'transparent',
                  border: 'none',
                  textAlign: 'left',
                  color: 'var(--nx-text)',
                  fontSize: 12,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--nx-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
              >
                <span aria-hidden="true" style={{ fontSize: 14, width: 16, textAlign: 'center' }}>🚪</span>
                <span>{isKo ? '로그아웃' : 'Log out'}</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
