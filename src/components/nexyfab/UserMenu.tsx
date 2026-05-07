'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuthStore } from '@/hooks/useAuth';
import { isKorean } from '@/lib/i18n/normalize';

interface UserMenuProps {
  onOpenAuth: (mode?: 'login' | 'signup') => void;
  lang?: string;
}

const PLAN_BADGE: Record<string, { label: string; color: string }> = {
  free: { label: 'FREE', color: '#6e7681' },
  pro: { label: 'PRO', color: '#388bfd' },
  team: { label: 'TEAM', color: '#a371f7' },
  enterprise: { label: 'ENT', color: '#d29922' },
};

export default function UserMenu({ onOpenAuth, lang = 'ko' }: UserMenuProps) {
  const { user, logout } = useAuthStore();
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
            border: '1px solid #30363d', background: 'transparent',
            color: '#8b949e', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#58a6ff'; e.currentTarget.style.color = '#c9d1d9'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#30363d'; e.currentTarget.style.color = '#8b949e'; }}
        >
          {isKorean(lang) ? '로그인' : 'Log in'}
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
          {isKorean(lang) ? '무료 시작' : 'Get started'}
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
          border: '1px solid #30363d', background: open ? '#21262d' : 'transparent',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = '#21262d'; }}
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
        <span style={{ fontSize: 12, color: '#e6edf3', fontWeight: 600, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.name}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 800, color: badge.color,
          background: `${badge.color}1a`, borderRadius: 3, padding: '1px 4px', letterSpacing: '0.06em',
        }}>
          {badge.label}
        </span>
        <span style={{ fontSize: 10, color: '#6e7681' }}>▾</span>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
          minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          overflow: 'hidden', zIndex: 1000,
        }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #21262d' }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#e6edf3' }}>{user.name}</p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6e7681' }}>{user.email}</p>
          </div>
          {[
            { label: isKorean(lang) ? '내 프로젝트' : 'My Projects', icon: '📁', href: `/${lang}/nexyfab/dashboard` },
            { label: isKorean(lang) ? 'Pro 업그레이드' : 'Upgrade to Pro', icon: '⚡', href: `/${lang}/pricing` },
          ].map(item => (
            <a key={item.label} href={item.href} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 14px', color: '#c9d1d9', fontSize: 12,
              textDecoration: 'none', transition: 'background 0.12s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#21262d'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
            >
              <span>{item.icon}</span> {item.label}
            </a>
          ))}
          {/* Manufacturing section */}
          <div style={{ borderTop: '1px solid #21262d', marginTop: 2 }} />
          {[
            { label: isKorean(lang) ? '견적 요청' : 'RFQ', icon: '💬', href: `/${lang}/nexyfab/rfq` },
            { label: isKorean(lang) ? '주문 추적' : 'Orders', icon: '📦', href: `/${lang}/nexyfab/orders` },
            { label: isKorean(lang) ? '마켓플레이스' : 'Marketplace', icon: '🏭', href: `/${lang}/nexyfab/marketplace` },
          ].map(item => (
            <a key={item.label} href={item.href} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '9px 14px', color: '#c9d1d9', fontSize: 12,
              textDecoration: 'none', transition: 'background 0.12s',
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = '#21262d'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = 'transparent'; }}
            >
              <span>{item.icon}</span> {item.label}
            </a>
          ))}
          <button
            onClick={() => { logout(); setOpen(false); }}
            style={{
              width: '100%', padding: '9px 14px', textAlign: 'left',
              background: 'none', border: 'none', borderTop: '1px solid #21262d',
              color: '#f85149', fontSize: 12, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 8,
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#21262d'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            🚪 {isKorean(lang) ? '로그아웃' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  );
}
