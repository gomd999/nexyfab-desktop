'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { toIsoLang, toRouteLang, type IsoLang } from '@/lib/i18n/normalize';

interface UserMenuProps {
  onOpenAuth: (mode?: 'login' | 'signup') => void;
  lang?: string;
}

const PLAN_BADGE: Record<string, { label: string; color: string }> = {
  free: { label: 'FREE', color: 'var(--nx-text-3)' },
  pro: { label: 'PRO', color: '#388bfd' },
  team: { label: 'TEAM', color: '#a371f7' },
  enterprise: { label: 'ENT', color: '#d29922' },
};

const COPY: Record<IsoLang, {
  login: string; signup: string; projects: string; upgrade: string;
  rfq: string; orders: string; marketplace: string; logout: string;
}> = {
  ko: { login: '로그인', signup: '무료 시작', projects: '내 프로젝트', upgrade: 'Pro 업그레이드', rfq: '견적 요청', orders: '주문 추적', marketplace: '마켓플레이스', logout: '로그아웃' },
  en: { login: 'Log in', signup: 'Get started', projects: 'My Projects', upgrade: 'Upgrade to Pro', rfq: 'RFQ', orders: 'Orders', marketplace: 'Marketplace', logout: 'Log out' },
  ja: { login: 'ログイン', signup: '無料で始める', projects: 'マイプロジェクト', upgrade: 'Proにアップグレード', rfq: '見積依頼', orders: '注文追跡', marketplace: 'マーケットプレイス', logout: 'ログアウト' },
  zh: { login: '登录', signup: '免费开始', projects: '我的项目', upgrade: '升级到 Pro', rfq: '询价请求', orders: '订单跟踪', marketplace: '市场', logout: '退出登录' },
  es: { login: 'Iniciar sesión', signup: 'Comenzar gratis', projects: 'Mis proyectos', upgrade: 'Actualizar a Pro', rfq: 'Solicitud de cotización', orders: 'Seguimiento de pedidos', marketplace: 'Marketplace', logout: 'Cerrar sesión' },
  ar: { login: 'تسجيل الدخول', signup: 'ابدأ مجانًا', projects: 'مشاريعي', upgrade: 'الترقية إلى Pro', rfq: 'طلب عرض سعر', orders: 'تتبع الطلبات', marketplace: 'السوق', logout: 'تسجيل الخروج' },
};

export default function UserMenu({ onOpenAuth, lang = 'ko' }: UserMenuProps) {
  const { user, logout } = useAuthStore();
  const copy = COPY[toIsoLang(lang)];
  const routeLang = toRouteLang(lang);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onOpenAuth('login')}
          style={{
            padding: '5px 12px', borderRadius: 6,
            border: '1px solid var(--nx-border)', background: 'transparent',
            color: 'var(--nx-text-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = 'var(--nx-text)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--nx-border)'; e.currentTarget.style.color = 'var(--nx-text-2)'; }}
        >
          {copy.login}
        </button>
        <button
          onClick={() => onOpenAuth('signup')}
          style={{
            padding: '5px 12px', borderRadius: 6,
            border: 'none', background: '#388bfd',
            color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          {copy.signup}
        </button>
      </div>
    );
  }

  const badge = PLAN_BADGE[user.plan] ?? PLAN_BADGE.free;
  const initials = user.name.slice(0, 2).toUpperCase();

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '4px 8px', borderRadius: 8,
          border: '1px solid var(--nx-border)', background: open ? 'var(--nx-panel-2)' : 'transparent',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-panel-2)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'transparent'; }}
      >
        {/* Avatar */}
        <div style={{
          width: 26, height: 26, borderRadius: '50%',
          background: 'linear-gradient(135deg, #388bfd, #8b5cf6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, fontWeight: 800, color: '#fff',
        }}>
          {initials}
        </div>
        <span style={{ fontSize: 12, color: 'var(--nx-text)', fontWeight: 600, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.name}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 800, color: badge.color,
          background: `${badge.color}1a`, borderRadius: 3, padding: '1px 4px', letterSpacing: '0.06em',
        }}>
          {badge.label}
        </span>
        <span style={{ fontSize: 10, color: 'var(--nx-text-3)' }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          background: 'var(--nx-panel)', border: '1px solid var(--nx-border)', borderRadius: 10,
          minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          overflow: 'hidden', zIndex: 1000,
        }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--nx-panel-2)' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--nx-text)' }}>{user.name}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--nx-text-3)' }}>{user.email}</p>
          </div>
          {[
            { label: copy.projects, icon: '📁', href: `/${routeLang}/nexyfab/dashboard` },
            { label: copy.upgrade, icon: '⚡', href: `/${routeLang}/pricing` },
          ].map(item => (
            <a key={item.label} href={item.href} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 14px', color: 'var(--nx-text)', fontSize: 12,
              textDecoration: 'none', transition: 'background 0.12s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--nx-panel-2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
            >
              <span>{item.icon}</span> {item.label}
            </a>
          ))}
          {/* Manufacturing section */}
          <div style={{ borderTop: '1px solid var(--nx-panel-2)', marginTop: 2 }} />
          {[
            { label: copy.rfq, icon: '💬', href: `/${routeLang}/nexyfab/rfq` },
            { label: copy.orders, icon: '📦', href: `/${routeLang}/nexyfab/orders` },
            { label: copy.marketplace, icon: '🏭', href: `/${routeLang}/nexyfab/marketplace` },
          ].map(item => (
            <a key={item.label} href={item.href} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 14px', color: 'var(--nx-text)', fontSize: 12,
              textDecoration: 'none', transition: 'background 0.12s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'var(--nx-panel-2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
            >
              <span>{item.icon}</span> {item.label}
            </a>
          ))}
          <button
            onClick={() => { void logout(); setOpen(false); }}
            style={{
              width: '100%', padding: '9px 14px', textAlign: 'left',
              background: 'none', border: 'none', borderTop: '1px solid var(--nx-panel-2)',
              color: '#f85149', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--nx-panel-2)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            🚪 {copy.logout}
          </button>
        </div>
      )}
    </div>
  );
}
