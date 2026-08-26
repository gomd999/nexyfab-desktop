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
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/hooks/useAuth';
import { toIsoLang, toRouteLang, type IsoLang } from '@/lib/i18n/normalize';
import NotificationBell from './NotificationBell';
import NexysysAppSwitcher from './NexysysAppSwitcher';

interface UnifiedSidebarProps {
  lang: string;
}

interface NavItem {
  icon: string;
  labels: Record<IsoLang, string>;
  href: string;
  badge?: 'NEW' | 'BETA' | 'PRO' | 'TEAM';
  comingSoon?: boolean;
  /** Domains that make a grouped destination visually active. */
  activeDomains?: string[];
  /** Existing domain routes exposed as subordinate project types. */
  children?: NavItem[];
  /**
   * If true, the href is used verbatim (no `/${lang}` prefix). Use for
   * cross-surface links like the partner portal that lives outside the
   * customer i18n tree.
   */
  external?: boolean;
}

interface NavSection {
  titles: Record<IsoLang, string>;
  items: NavItem[];
}

const localized = (ko: string, en: string, ja: string, zh: string, es: string, ar: string): Record<IsoLang, string> => ({ ko, en, ja, zh, es, ar });

// 2026-08 commercial IA: AI mechanical CAD + precision CAD are the product.
// Spatial disciplines retain their route contracts in a separately labelled
// Labs surface; they are not peers of the commercial mechanical product.
const SECTION_MAIN: NavSection = {
  titles: localized('', '', '', '', '', ''),
  items: [
    { icon: '⚙️', labels: localized('AI 기계 CAD', 'AI Mechanical CAD', 'AI機械CAD', 'AI机械CAD', 'CAD mecánico con IA', 'CAD ميكانيكي بالذكاء الاصطناعي'), href: '/nexyfab/ai' },
    { icon: '📐', labels: localized('정밀 CAD', 'Precision CAD', '精密CAD', '精密CAD', 'CAD de precisión', 'CAD دقيق'), href: '/shape-generator?expert=1&mode=expert&domain=mech&workMode=precision_cad' },
    { icon: '🔎', labels: localized('설계 검토·제조', 'Review & Manufacturing', '設計レビュー・製造', '设计审查与制造', 'Revisión y fabricación', 'مراجعة وتصنيع'), href: '/nexyfab/evaluate' },
  ],
};
const SECTION_BOTTOM: NavSection = {
  titles: localized('', '', '', '', '', ''),
  items: [
    { icon: '📁', labels: localized('내 프로젝트', 'My Projects', 'マイプロジェクト', '我的项目', 'Mis proyectos', 'مشاريعي'), href: '/nexyfab/projects' },
    { icon: '🧊', labels: localized('예제 및 템플릿', 'Examples & Templates', '例とテンプレート', '示例与模板', 'Ejemplos y plantillas', 'أمثلة وقوالب'), href: '/examples' },
  ],
};

const SECTION_LABS: NavSection = {
  titles: localized('부가 서비스', 'Additional services', '追加サービス', '附加服务', 'Servicios adicionales', 'خدمات إضافية'),
  items: [
    {
      icon: '🧪',
      labels: localized('Space Design Labs', 'Space Design Labs', '空間設計ラボ', '空间设计实验室', 'Laboratorio de diseño espacial', 'مختبر تصميم المساحات'),
      href: '/nexyfab/design?domain=building',
      badge: 'BETA',
      activeDomains: ['building', 'civil', 'bridge', 'landscape', 'interior'],
      children: [
        { icon: '🏢', labels: localized('건축', 'Architecture', '建築', '建筑', 'Arquitectura', 'عمارة'), href: '/nexyfab/design?domain=building' },
        { icon: '🌉', labels: localized('토목', 'Civil', '土木', '土木工程', 'Ingeniería civil', 'هندسة مدنية'), href: '/nexyfab/design?domain=civil' },
        { icon: '🌳', labels: localized('조경', 'Landscape', 'ランドスケープ', '景观', 'Paisajismo', 'تنسيق حدائق'), href: '/nexyfab/design?domain=landscape' },
        { icon: '🪑', labels: localized('인테리어', 'Interior', 'インテリア', '室内设计', 'Interiorismo', 'تصميم داخلي'), href: '/nexyfab/design?domain=interior' },
      ],
    },
  ],
};

interface ChatThreadLite { id: string; title: string; domain?: string; updated?: number; pinned?: boolean; badge?: string | null }
// 스레드 분야 아이콘 — ChatHero의 도메인 값(mechanical…)과 동일 키
const THREAD_EMOJI: Record<string, string> = { mechanical: '🔧', civil: '🌉', architecture: '🏢', landscape: '🌳', interior: '🪑' };

// Avatar dropdown items (replaces the old Account sidebar section).
interface MenuItem { icon: string; labels: Record<IsoLang, string>; href: string; external?: boolean; }
const AVATAR_MENU: MenuItem[] = [
  { icon: '💳', labels: localized('결제 및 구독', 'Billing', '請求と契約', '账单与订阅', 'Facturación', 'الفوترة والاشتراك'), href: '/nexyfab/billing' },
  { icon: '🔧', labels: localized('설정', 'Settings', '設定', '设置', 'Configuración', 'الإعدادات'), href: '/nexyfab/settings' },
  { icon: '📖', labels: localized('사용 가이드', 'Guide', '利用ガイド', '使用指南', 'Guía', 'دليل الاستخدام'), href: '/help' },
];

type SidebarCopy = {
  visitor: string; guest: string; chats: string; mainNavigation: string; newDesign: string;
  pin: string; unpin: string; deleteChat: string; login: string; createAccount: string; logout: string;
  guestInfo: string; projectTypes: (label: string) => string; deleteConfirm: (title: string) => string;
};

const SIDEBAR_COPY: Record<IsoLang, SidebarCopy> = {
  ko: { visitor: '비회원', guest: '게스트', chats: '채팅', mainNavigation: '주요 메뉴', newDesign: '새 기계 설계', pin: '고정', unpin: '고정 해제', deleteChat: '대화 삭제', login: '로그인', createAccount: '가입하기', logout: '로그아웃', guestInfo: '게스트는 AI·CAD를 체험하고 이 브라우저에 임시 저장할 수 있습니다. 클라우드 저장·내보내기·협업·제조 요청은 로그인이 필요합니다.', projectTypes: (label) => `${label} 세부 유형`, deleteConfirm: (title) => `“${title}” 대화를 삭제할까요?` },
  en: { visitor: 'GUEST', guest: 'Guest', chats: 'Chats', mainNavigation: 'Main navigation', newDesign: 'New mechanical design', pin: 'Pin', unpin: 'Unpin', deleteChat: 'Delete chat', login: 'Log in', createAccount: 'Create account', logout: 'Log out', guestInfo: 'Guests can try AI and CAD with temporary browser storage. Sign in for cloud save, export, collaboration, and manufacturing requests.', projectTypes: (label) => `${label} project types`, deleteConfirm: (title) => `Delete “${title}”?` },
  ja: { visitor: 'ゲスト', guest: 'ゲスト', chats: 'チャット', mainNavigation: 'メインナビゲーション', newDesign: '新しい機械設計', pin: '固定', unpin: '固定解除', deleteChat: 'チャットを削除', login: 'ログイン', createAccount: 'アカウント作成', logout: 'ログアウト', guestInfo: 'ゲストはAIとCADを試し、このブラウザに一時保存できます。クラウド保存、エクスポート、共同作業、製造依頼にはログインが必要です。', projectTypes: (label) => `${label}のプロジェクト種別`, deleteConfirm: (title) => `「${title}」を削除しますか？` },
  zh: { visitor: '访客', guest: '访客', chats: '聊天', mainNavigation: '主导航', newDesign: '新建机械设计', pin: '固定', unpin: '取消固定', deleteChat: '删除聊天', login: '登录', createAccount: '创建账户', logout: '退出登录', guestInfo: '访客可以试用 AI 和 CAD，并临时保存在此浏览器中。云端保存、导出、协作和制造请求需要登录。', projectTypes: (label) => `${label}项目类型`, deleteConfirm: (title) => `要删除“${title}”聊天吗？` },
  es: { visitor: 'INVITADO', guest: 'Invitado', chats: 'Chats', mainNavigation: 'Navegación principal', newDesign: 'Nuevo diseño mecánico', pin: 'Fijar', unpin: 'Desfijar', deleteChat: 'Eliminar chat', login: 'Iniciar sesión', createAccount: 'Crear cuenta', logout: 'Cerrar sesión', guestInfo: 'Los invitados pueden probar IA y CAD con almacenamiento temporal en este navegador. Inicia sesión para guardar en la nube, exportar, colaborar y solicitar fabricación.', projectTypes: (label) => `Tipos de proyecto de ${label}`, deleteConfirm: (title) => `¿Eliminar el chat “${title}”?` },
  ar: { visitor: 'ضيف', guest: 'ضيف', chats: 'المحادثات', mainNavigation: 'التنقل الرئيسي', newDesign: 'تصميم ميكانيكي جديد', pin: 'تثبيت', unpin: 'إلغاء التثبيت', deleteChat: 'حذف المحادثة', login: 'تسجيل الدخول', createAccount: 'إنشاء حساب', logout: 'تسجيل الخروج', guestInfo: 'يمكن للضيوف تجربة الذكاء الاصطناعي وCAD مع حفظ مؤقت في هذا المتصفح. يلزم تسجيل الدخول للحفظ السحابي والتصدير والتعاون وطلبات التصنيع.', projectTypes: (label) => `أنواع مشاريع ${label}`, deleteConfirm: (title) => `هل تريد حذف المحادثة «${title}»؟` },
};

const PLAN_BADGE: Record<string, { label: string; color: string }> = {
  free:       { label: 'FREE', color: 'var(--nx-text-2)' },
  pro:        { label: 'PRO',  color: 'var(--nx-accent)' },
  team:       { label: 'TEAM', color: '#a371f7' },
  enterprise: { label: 'ENT',  color: '#d29922' },
};

export default function NexyfabUnifiedSidebar({ lang }: UnifiedSidebarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user, token, sessionStatus, logout } = useAuthStore();
  const isAuthenticated = sessionStatus === 'authenticated' && Boolean(user);
  const routeLang = toRouteLang(lang);
  const locale = toIsoLang(routeLang);
  const copy = SIDEBAR_COPY[locale];
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
    window.addEventListener('nf-threads-updated', load); // 같은 탭 저장(storage 이벤트 미발화) 대응
    return () => { window.removeEventListener('storage', load); window.removeEventListener('focus', load); window.removeEventListener('nf-threads-updated', load); };
  }, []);

  const updateThread = (id: string, change: Partial<ChatThreadLite> | null) => {
    try {
      const current = JSON.parse(localStorage.getItem('nf_chat_threads_v1') ?? '[]') as ChatThreadLite[];
      const next = change === null ? current.filter((t) => t.id !== id) : current.map((t) => t.id === id ? { ...t, ...change, updated: Date.now() } : t);
      localStorage.setItem('nf_chat_threads_v1', JSON.stringify(next));
      window.dispatchEvent(new Event('nf-threads-updated'));
    } catch { /* local storage may be unavailable */ }
  };

  const toggleThreadPin = (thread: ChatThreadLite) => updateThread(thread.id, { pinned: !thread.pinned });
  const removeThread = (thread: ChatThreadLite) => {
    if (window.confirm(copy.deleteConfirm(thread.title))) updateThread(thread.id, null);
  };

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

  const currentDomain = searchParams.get('domain');

  const isActive = (href: string, activeDomains?: string[]): boolean => {
    const [path, query] = href.split('?');
    const full = `/${routeLang}${path}`;
    // Don't activate Hub for every nexyfab child route.
    if (path === '/nexyfab/hub') return pathname === full || pathname === full + '/';
    if (path === '/nexyfab/design') {
      // 분야(?domain=X) 판정. 가설·랙(rack)은 기계에 흡수(2026-07-16 IA).
      const matches = pathname === full || pathname.startsWith(full + '/');
      if (!matches) return false;
      const cur = currentDomain;
      if (activeDomains) return cur !== null && activeDomains.includes(cur);
      const own = query?.startsWith('domain=') ? query.slice('domain='.length) : null;
      if (!own) return !cur;
      // The canonical design route defaults to the product/mechanical journey.
      // Keep that default visible to assistive technology as well as visually.
      if (own === 'mech') return cur === null || cur === 'mech' || cur === 'rack';
      if (own === 'civil') return cur === 'civil' || cur === 'bridge'; // 교량은 토목에 흡수(2026-07-16)
      return own === cur;
    }
    return pathname === full || pathname?.startsWith(full + '/');
  };

  const badge = isAuthenticated
    ? (PLAN_BADGE[user?.plan ?? 'free'] ?? PLAN_BADGE.free)
    : { label: copy.visitor, color: 'var(--nx-text-2)' };
  const initials = isAuthenticated && user ? user.name.slice(0, 2).toUpperCase() : '?';

  const renderNavItem = (item: NavItem, nested = false): ReactNode => {
    const active = item.external ? false : isActive(item.href, item.activeDomains);
    const hasChildren = Boolean(item.children?.length);
    const linkHref = item.external
      ? `${item.href}${item.href.includes('?') ? '&' : '?'}lang=${routeLang}`
      : `/${routeLang}${item.href}`;
    const label = item.labels[locale];
    const accessibleLabel = item.badge ? `${label} ${item.badge}` : label;

    return (
      <div key={`${nested ? 'child' : 'parent'}-${item.href}`}>
        <Link
          href={linkHref}
          aria-current={active && !hasChildren ? 'page' : undefined}
          aria-label={accessibleLabel}
          data-active={active ? 'true' : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: nested ? '6px 14px' : '8px 14px',
            paddingInlineStart: nested ? 42 : 14,
            textDecoration: 'none',
            color: active ? 'var(--nx-accent-2)' : nested ? 'var(--nx-text-2)' : 'var(--nx-text)',
            background: active && !hasChildren ? 'var(--nx-accent-soft)' : 'transparent',
            borderInlineStart: active ? '2px solid var(--nx-accent)' : '2px solid transparent',
            fontSize: nested ? 12 : 13,
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
          <span aria-hidden="true" style={{ fontSize: nested ? 13 : 16, flex: '0 0 18px', textAlign: 'center' }}>{item.icon}</span>
          <span className="nf-uni-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </span>
          {item.badge && (
            <span
              className="nf-uni-label"
              aria-hidden="true"
              style={{
                fontSize: 9, fontWeight: 700, padding: '2px 5px',
                borderRadius: 3, letterSpacing: '0.04em',
                background: item.badge === 'NEW' ? 'var(--nx-accent)' : item.badge === 'PRO' ? '#a371f7' : item.badge === 'BETA' ? '#2563eb' : '#d29922',
                color: '#fff',
              }}
            >
              {item.badge}
            </span>
          )}
        </Link>
        {hasChildren && (
          <div role="group" aria-label={copy.projectTypes(label)}>
            {item.children?.map((child) => renderNavItem(child, true))}
          </div>
        )}
      </div>
    );
  };

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
          aria-label={copy.mainNavigation}
          dir={routeLang === 'ar' ? 'rtl' : 'ltr'}
        style={{
          flex: '0 0 auto',
          background: 'var(--nx-panel)',
          borderInlineEnd: '1px solid var(--nx-border)',
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
          href={`/${routeLang}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 0,
            padding: '14px 14px 10px',
            textDecoration: 'none',
            color: 'var(--nx-text)',
            fontWeight: 800, fontSize: 16, letterSpacing: '-0.02em',
            borderBottom: '1px solid var(--nx-border)',
          }}
        >
          {/* Semantic accent preserves the Nexy/Fab split with AA contrast in both themes. */}
          <span style={{ color: 'var(--nx-text)' }}>Nexy</span>
          <span className="nf-uni-brand-text" style={{ color: 'var(--nx-accent)' }}>Fab</span>
        </Link>

        {/* New design is the single primary entry into the AI-guided workflow. */}
        <div style={{ padding: '10px 10px 4px' }}>
          <Link
            href={`/${routeLang}/nexyfab/ai?new=1`}
            onClick={() => { try { window.dispatchEvent(new CustomEvent('nexyfab:new-chat')); } catch { /* non-browser */ } }}
            aria-label={copy.newDesign}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '9px 0', borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 800, color: 'var(--nx-accent)', border: '1.5px dashed var(--nx-accent)', background: 'var(--nx-accent-soft, rgba(37,99,235,0.08))' }}>
            <span aria-hidden="true">＋</span>
            <span className="nf-uni-label">{copy.newDesign}</span>
          </Link>
        </div>

        {/* Sections */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {([SECTION_MAIN, 'CHAT', SECTION_BOTTOM, SECTION_LABS] as Array<NavSection | 'CHAT'>).map((sec) => sec === 'CHAT' ? (chatThreads.length === 0 ? null : (
            /* 채팅 내역 — AI 설계(랜딩 챗)와 스튜디오 통합 IA(2026-07-16): 대화 재진입 경로 */
            <div key="chat" style={{ marginBottom: 8 }}>
              <div className="nf-uni-section-title" style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '10px 14px 4px' }}>
                {copy.chats}
              </div>
              {/* 새 채팅은 최상단 CTA로 승격(중복 제거) — 여기는 스레드 목록만.
                  <a> 사용: 같은 라우트에서 ?t=만 바뀌면 Link는 재마운트하지 않아 스레드 전환이 안 됨 */}
              {chatThreads.map((th) => (
                <div key={th.id} className="nf-uni-chat-item" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px 2px 14px', borderInlineStart: '2px solid transparent', lineHeight: 1.2 }}>
                  <a href={`/${routeLang}/nexyfab/ai/?t=${th.id}`} title={th.title}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1, padding: '4px 0', textDecoration: 'none', color: 'var(--nx-text)', fontSize: 12 }}>
                    <span aria-hidden="true" style={{ fontSize: 12, flex: '0 0 18px', textAlign: 'center' }}>{th.pinned ? '📌' : (THREAD_EMOJI[th.domain ?? ''] ?? '💬')}</span>
                    <span className="nf-uni-label" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{th.title}</span>
                    {th.badge && <span className="nf-uni-label" style={{ fontSize: 9, fontWeight: 800, color: th.badge === 'PASS' || th.badge === '✓' ? '#16a34a' : th.badge === 'FAIL' || th.badge === '✗' ? '#dc2626' : 'var(--nx-text-3)' }}>{th.badge === 'PASS' ? '✓' : th.badge === 'FAIL' ? '✗' : th.badge}</span>}
                  </a>
                  <button type="button" aria-label={th.pinned ? copy.unpin : copy.pin} title={th.pinned ? copy.unpin : copy.pin} onClick={() => toggleThreadPin(th)} style={{ border: 'none', background: 'transparent', color: th.pinned ? 'var(--nx-accent)' : 'var(--nx-text-3)', cursor: 'pointer', padding: 2, fontSize: 11 }}>{th.pinned ? '📌' : '☆'}</button>
                  <button type="button" aria-label={copy.deleteChat} title={copy.deleteChat} onClick={() => removeThread(th)} style={{ border: 'none', background: 'transparent', color: 'var(--nx-text-3)', cursor: 'pointer', padding: 2, fontSize: 11 }}>🗑</button>
                </div>
              ))}
            </div>
          )) : (
            <div key={sec.items[0]?.href ?? sec.titles.en} style={{ marginBottom: 8 }}>
              {sec.titles[locale] !== '' && (
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
                  {sec.titles[locale]}
                </div>
              )}
              {sec.items.map((item) => renderNavItem(item))}
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
                {isAuthenticated ? user?.name : copy.guest}
              </div>
              <div style={{ fontSize: 9, color: badge.color, fontWeight: 700 }}>
                {badge.label}
              </div>
            </div>
          </button>
          <div className="nf-uni-label" style={{ display: 'flex', gap: 4 }}>
            {isAuthenticated && token && <NotificationBell token={token} lang={routeLang} />}
            <NexysysAppSwitcher lang={routeLang} />
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
              {isAuthenticated ? AVATAR_MENU.map(item => (
                <Link
                  key={item.href}
                  href={`/${routeLang}${item.href}`}
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
                  <span>{item.labels[locale]}</span>
                </Link>
              )) : (
                <>
                  <div role="note" style={{ padding: '8px 10px', color: 'var(--nx-text-2)', fontSize: 10, lineHeight: 1.45, borderBottom: '1px solid var(--nx-border)', marginBottom: 4 }}>
                    {copy.guestInfo}
                  </div>
                  <Link href={`/login?lang=${routeLang}`} role="menuitem" onClick={() => setMenuOpen(false)} style={{ display: 'block', padding: '8px 10px', borderRadius: 6, textDecoration: 'none', color: 'var(--nx-text)', fontSize: 12, fontWeight: 700 }}>
                    {copy.login}
                  </Link>
                  <Link href={`/register?lang=${routeLang}`} role="menuitem" onClick={() => setMenuOpen(false)} style={{ display: 'block', padding: '8px 10px', borderRadius: 6, textDecoration: 'none', color: 'var(--nx-accent)', fontSize: 12, fontWeight: 700 }}>
                    {copy.createAccount}
                  </Link>
                </>
              )}
              {isAuthenticated && <>
              <div style={{ height: 1, background: 'var(--nx-border)', margin: '4px 0' }} />
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setMenuOpen(false);
                  // ⚠ 260802: `await` 없이 이동하면 **쿠키가 지워지기 전에** 페이지가 바뀌어
                  //   요청이 취소될 수 있다 — 그러면 로그아웃한 줄 알고 로그인 상태로 남는다.
                  await logout();
                  router.push(`/${routeLang}`);
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
                <span>{copy.logout}</span>
              </button>
              </>}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
