'use client';

import React, { useState, useEffect } from 'react';
// Image import removed — using initials avatar instead
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LanguageSelector from './LanguageSelector';
import NexyfabNotificationBell from '@/app/components/NexyfabNotificationBell';

const dict = {
    ko: { pricing: '요금', factories: '공장 찾기', login: '로그인', dashboard: '대시보드', quickQuote: '빠른 견적', shapeGen: '3D 모델링', download: '다운로드', logout: '로그아웃', notifications: '알림' },
    en: { pricing: 'Pricing', factories: 'Find Factories', login: 'Sign In', dashboard: 'Dashboard', quickQuote: 'Quick Quote', shapeGen: '3D Modeler', download: 'Download', logout: 'Sign Out', notifications: 'Notifications' },
    ja: { pricing: '料金', factories: '工場を探す', login: 'ログイン', dashboard: 'ダッシュボード', quickQuote: 'クイック見積もり', shapeGen: '3Dモデリング', download: 'ダウンロード', logout: 'ログアウト', notifications: '通知' },
    cn: { pricing: '价格', factories: '找工厂', login: '登录', dashboard: '控制台', quickQuote: '快速报价', shapeGen: '3D建模', download: '下载', logout: '退出', notifications: '通知' },
    es: { pricing: 'Precios', factories: 'Fábricas', login: 'Iniciar Sesión', dashboard: 'Panel', quickQuote: 'Cotización Rápida', shapeGen: 'Modelado 3D', download: 'Descargar', logout: 'Cerrar Sesión', notifications: 'Avisos' },
    ar: { pricing: 'الأسعار', factories: 'ابحث عن مصنع', login: 'تسجيل الدخول', dashboard: 'لوحة التحكم', quickQuote: 'عرض سعر سريع', shapeGen: 'نمذجة ثلاثية الأبعاد', download: 'تنزيل', logout: 'خروج', notifications: 'إشعارات' },
};

const IconZap = () => (
    <svg aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
);
const IconUser = () => (
    <svg aria-hidden="true" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
);
const IconLogin = () => (
    <svg aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
        <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3" />
    </svg>
);
const IconCalculator = () => (
    <svg aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
        <rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 10h2m4 0h2M8 14h2m4 0h2M8 18h2m4 0h2" />
    </svg>
);
const IconCube = () => (
    <svg aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </svg>
);
const IconFactory = () => (
    <svg aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
        <path d="M2 20V9l6-4v4l6-4v4l6-4v15H2z" /><path d="M6 20v-4h4v4M12 12h2M12 16h2M16 12h2M16 16h2" />
    </svg>
);
const IconDownload = () => (
    <svg aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
    </svg>
);

export default function Header() {
    const pathname = usePathname();

    // ── 모든 hooks는 early return 앞에 선언 (Rules of Hooks) ─────────────────
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [currentUser, setCurrentUser] = useState<{ name?: string; avatar?: string } | null>(null);
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 20);
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    useEffect(() => {
        const load = () => {
            let stored: string | null = null;
            try {
                stored = localStorage.getItem('currentUser');
            } catch (err) {
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('[Header] localStorage unavailable:', err);
                }
                setCurrentUser(null);
                return;
            }
            try {
                setCurrentUser(stored ? JSON.parse(stored) : null);
            } catch (err) {
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('[Header] currentUser parse failed, clearing:', err);
                }
                try { localStorage.removeItem('currentUser'); } catch { /* ignore */ }
                setCurrentUser(null);
            }
        };
        load();
        window.addEventListener('storage', load);
        return () => window.removeEventListener('storage', load);
    }, []);

    useEffect(() => { setIsMobileOpen(false); }, [pathname]);
    // ─────────────────────────────────────────────────────────────────────────

    if (pathname?.includes('/shape-generator')) return null;

    const parts = pathname?.split('/').filter(Boolean) || [];
    const isAdmin = parts[0] === 'adminlink';
    const langCode = isAdmin ? 'kr' : (parts[0] || 'en');
    const lang = ['en', 'kr', 'ja', 'cn', 'es', 'ar'].includes(langCode) ? langCode : 'en';
    const langMapCode: Record<string, string> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'cn', es: 'es', ar: 'ar' };
    const t = dict[langMapCode[lang] as keyof typeof dict];

    const isActive = (href: string) => pathname?.includes(href.replace(/\/$/, '')) ?? false;
    const isRtl = lang === 'ar';

    const nexysysUrl = process.env.NEXT_PUBLIC_NEXYSYS_URL || 'https://nexysys.com';

    const navItems = [
        { href: `/${lang}/shape-generator/`, label: t.shapeGen, icon: <IconCube />, external: false, highlight: 'blue' as const },
        { href: `/${lang}/factories/`, label: t.factories, icon: <IconFactory />, external: false, highlight: false as const },
        { href: `/${lang}/pricing/`, label: t.pricing, icon: <IconZap />, external: false, highlight: false as const },
        { href: `/${lang}/download/`, label: t.download, icon: <IconDownload />, external: false, highlight: false as const },
        { href: `/${lang}/quick-quote/`, label: t.quickQuote, icon: <IconCalculator />, external: false, highlight: 'gradient' as const },
    ];

    // ── Styles ──────────────────────────────────────────────────────────────
    const headerBg = scrolled
        ? 'rgba(255,255,255,0.85)'
        : 'transparent';
    const headerBorder = scrolled ? '1px solid rgba(229,231,235,0.6)' : '1px solid transparent';
    const headerShadow = scrolled ? '0 4px 24px rgba(11,92,255,0.06)' : 'none';

    return (
        <>
            <header dir={isRtl ? 'rtl' : undefined} role="banner" style={{
                position: 'fixed', top: 0, left: 0, width: '100%', zIndex: 100,
                background: headerBg,
                backdropFilter: scrolled ? 'blur(20px)' : 'none',
                WebkitBackdropFilter: scrolled ? 'blur(20px)' : 'none',
                borderBottom: headerBorder,
                boxShadow: headerShadow,
                transition: 'all 0.35s ease',
                padding: scrolled ? '0' : '0',
            }}>
                <div style={{
                    maxWidth: '1440px', margin: '0 auto',
                    padding: '0 40px', height: scrolled ? '60px' : '72px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    position: 'relative',
                    transition: 'height 0.35s ease',
                }}>
                    {/* Logo */}
                    <Link href={`/${lang}`} style={{ textDecoration: 'none', fontSize: '22px', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span>
                            <span style={{ color: '#111827' }}>Nexy</span><span style={{ color: '#0b5cff' }}>Fab</span>
                        </span>
                        <span aria-label="Beta version" style={{
                            fontSize: '10px', fontWeight: 800, letterSpacing: '0.05em',
                            color: '#0b5cff', background: 'rgba(11,92,255,0.1)',
                            border: '1px solid rgba(11,92,255,0.25)', borderRadius: '6px',
                            padding: '2px 6px', lineHeight: 1, textTransform: 'uppercase',
                        }}>BETA</span>
                    </Link>

                    {/* Desktop Pill Nav — absolutely centered */}
                    <nav aria-label="Main navigation" style={{
                        position: 'absolute', left: '50%', transform: 'translateX(-50%)',
                        display: 'flex', alignItems: 'center', gap: '1px',
                        flexWrap: 'nowrap',
                        background: 'rgba(243,244,246,0.7)',
                        border: '1px solid rgba(229,231,235,0.6)',
                        borderRadius: '18px', padding: '3px',
                        backdropFilter: 'blur(8px)',
                    }} className="desktop-only">
                        {navItems.map(item => {
                            const active = !item.external && isActive(item.href);
                            if (item.highlight === 'blue') {
                                return (
                                    <Link key={item.href} href={item.href} prefetch
                                        aria-label={item.label}
                                        aria-current={active ? 'page' : undefined}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '5px',
                                            padding: '6px 12px', borderRadius: '14px',
                                            background: active ? '#083db0' : '#0b5cff',
                                            color: '#fff',
                                            boxShadow: active ? '0 2px 12px rgba(11,92,255,0.5), inset 0 1px 2px rgba(0,0,0,0.15)' : '0 2px 10px rgba(11,92,255,0.3)',
                                            fontWeight: 800, fontSize: '12px', textDecoration: 'none',
                                            transition: 'all 0.15s', whiteSpace: 'nowrap',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(11,92,255,0.45)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(11,92,255,0.3)'; }}
                                    >
                                        {item.icon}
                                        {item.label}
                                    </Link>
                                );
                            }
                            if (item.highlight === 'gradient') {
                                return (
                                    <Link key={item.href} href={item.href}
                                        aria-label={item.label}
                                        aria-current={active ? 'page' : undefined}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '5px',
                                            padding: '6px 12px', borderRadius: '14px',
                                            background: active ? '#6366f1' : 'linear-gradient(135deg, #0b5cff 0%, #6366f1 100%)',
                                            color: '#fff',
                                            boxShadow: '0 2px 10px rgba(99,102,241,0.35)',
                                            fontWeight: 800, fontSize: '12px', textDecoration: 'none',
                                            transition: 'all 0.15s', whiteSpace: 'nowrap',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(99,102,241,0.45)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(99,102,241,0.35)'; }}
                                    >
                                        {item.icon}
                                        {item.label}
                                    </Link>
                                );
                            }
                            return (
                                <Link key={item.href} href={item.href}
                                    target={item.external ? '_blank' : undefined}
                                    rel={item.external ? 'noopener noreferrer' : undefined}
                                    aria-label={item.label}
                                    aria-current={active ? 'page' : undefined}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '5px',
                                        padding: '6px 10px', borderRadius: '14px',
                                        background: active ? '#fff' : 'transparent',
                                        color: active ? '#0b5cff' : '#6b7280',
                                        boxShadow: active ? '0 1px 6px rgba(0,0,0,0.08)' : 'none',
                                        fontWeight: 700, fontSize: '12px', textDecoration: 'none',
                                        transition: 'all 0.15s', whiteSpace: 'nowrap',
                                    }}
                                    onMouseEnter={e => { if (!active) e.currentTarget.style.color = '#111827'; }}
                                    onMouseLeave={e => { if (!active) e.currentTarget.style.color = '#6b7280'; }}
                                >
                                    {item.icon}
                                    {item.label}
                                </Link>
                            );
                        })}
                    </nav>

                    {/* Right Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {currentUser && (
                            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                                <NexyfabNotificationBell ariaLabel={t.notifications} />
                            </div>
                        )}
                        <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <LanguageSelector />
                            {currentUser ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Link href={`/${lang}/dashboard`} style={{
                                        display: 'flex', alignItems: 'center', gap: '10px',
                                        background: '#111827', color: '#fff',
                                        padding: '9px 18px', borderRadius: '16px',
                                        fontWeight: 800, fontSize: '13px', textDecoration: 'none',
                                        transition: 'transform 0.15s, box-shadow 0.15s',
                                        boxShadow: '0 4px 16px rgba(17,24,39,0.15)',
                                    }}
                                        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                                    >
                                        <span>{t.dashboard}</span>
                                        <div style={{ width: '22px', height: '22px', background: 'rgba(255,255,255,0.15)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <IconUser />
                                        </div>
                                    </Link>
                                    <button
                                        onClick={() => { localStorage.removeItem('currentUser'); setCurrentUser(null); window.location.href = `/${lang}/`; }}
                                        title={t.logout}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '5px',
                                            background: 'rgba(239,68,68,0.08)', color: '#ef4444',
                                            border: '1px solid rgba(239,68,68,0.2)',
                                            padding: '9px 14px', borderRadius: '14px',
                                            fontWeight: 700, fontSize: '12px', cursor: 'pointer',
                                            transition: 'all 0.15s', whiteSpace: 'nowrap',
                                        }}
                                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.15)'; e.currentTarget.style.borderColor = '#ef4444'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.08)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.2)'; }}
                                    >
                                        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                                        {t.logout}
                                    </button>
                                </div>
                            ) : (
                                <Link href="/login" style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    background: '#0b5cff', color: '#fff',
                                    padding: '10px 22px', borderRadius: '16px',
                                    fontWeight: 800, fontSize: '13px', textDecoration: 'none',
                                    transition: 'transform 0.15s, box-shadow 0.15s',
                                    boxShadow: '0 4px 16px rgba(11,92,255,0.3)',
                                }}
                                    onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.04)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; }}
                                >
                                    <IconLogin />
                                    <span>{t.login}</span>
                                </Link>
                            )}
                        </div>

                        {/* Mobile Hamburger */}
                        <button
                            onClick={() => setIsMobileOpen(!isMobileOpen)}
                            className="mobile-only"
                            style={{
                                background: 'rgba(243,244,246,0.8)', border: '1px solid rgba(229,231,235,0.6)',
                                borderRadius: '12px', width: '40px', height: '40px',
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                gap: isMobileOpen ? '0px' : '5px', cursor: 'pointer', padding: '0',
                                transition: 'all 0.2s',
                            }}
                            aria-label={isMobileOpen ? 'Close menu' : 'Open menu'}
                            aria-expanded={isMobileOpen}
                            aria-controls="mobile-menu"
                        >
                            <span style={{ display: 'block', width: '18px', height: '2px', background: '#374151', borderRadius: '2px', transition: 'all 0.25s', transform: isMobileOpen ? 'rotate(45deg) translate(1px, 1px)' : 'none' }} />
                            <span style={{ display: 'block', width: '18px', height: '2px', background: '#374151', borderRadius: '2px', opacity: isMobileOpen ? 0 : 1, transition: 'opacity 0.2s' }} />
                            <span style={{ display: 'block', width: '18px', height: '2px', background: '#374151', borderRadius: '2px', transition: 'all 0.25s', transform: isMobileOpen ? 'rotate(-45deg) translate(1px, -1px)' : 'none' }} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Mobile Overlay */}
            {isMobileOpen && (
                <div
                    role="button"
                    tabIndex={0}
                    aria-label="Close menu"
                    onClick={() => setIsMobileOpen(false)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsMobileOpen(false); } }}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 98, backdropFilter: 'blur(4px)' }}
                />
            )}

            {/* Mobile Dropdown */}
            <div id="mobile-menu"
                role="dialog"
                aria-label="Navigation menu"
                style={{
                position: 'fixed', top: scrolled ? '60px' : '72px', left: '16px', right: '16px',
                background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(20px)',
                borderRadius: '20px', border: '1px solid rgba(229,231,235,0.8)',
                boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
                zIndex: 99, overflow: 'hidden',
                maxHeight: isMobileOpen ? '400px' : '0',
                opacity: isMobileOpen ? 1 : 0,
                transition: 'max-height 0.3s ease, opacity 0.25s ease, top 0.35s ease',
            }} className="mobile-only">
                <div style={{ padding: '12px' }}>
                    {navItems.map(item => {
                        const active = !item.external && isActive(item.href);
                        if (item.highlight) {
                            return (
                                <Link key={item.href} href={item.href} prefetch={!item.external}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '12px',
                                        padding: '14px 16px', borderRadius: '14px',
                                        color: '#fff',
                                        background: item.highlight === 'blue' ? '#0b5cff' : 'linear-gradient(135deg, #0b5cff 0%, #6366f1 100%)',
                                        fontWeight: 800, fontSize: '15px', textDecoration: 'none',
                                        marginBottom: '4px',
                                        boxShadow: '0 2px 8px rgba(11,92,255,0.3)',
                                    }}>
                                    {item.icon}
                                    {item.label}
                                </Link>
                            );
                        }
                        return (
                            <Link key={item.href} href={item.href} prefetch={!item.external}
                                target={item.external ? '_blank' : undefined}
                                rel={item.external ? 'noopener noreferrer' : undefined}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '12px',
                                    padding: '14px 16px', borderRadius: '14px',
                                    color: active ? '#0b5cff' : '#374151',
                                    background: active ? '#eff6ff' : 'transparent',
                                    fontWeight: 700, fontSize: '15px', textDecoration: 'none',
                                    marginBottom: '4px',
                                }}>
                                {item.icon}
                                {item.label}
                            </Link>
                        );
                    })}

                    <div style={{ height: '1px', background: '#f3f4f6', margin: '8px 0' }} />

                    {currentUser ? (
                        <>
                        <Link href={`/${lang}/dashboard`} style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '14px 16px', borderRadius: '14px',
                            color: '#374151', fontWeight: 700, fontSize: '15px', textDecoration: 'none',
                        }}>
                            <span aria-hidden="true" style={{
                                width: 26, height: 26, borderRadius: '50%',
                                background: 'linear-gradient(135deg, #0b5cff, #6366f1)',
                                color: '#fff', fontSize: 11, fontWeight: 800,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0, letterSpacing: '-0.02em',
                            }}>
                                {(currentUser.name ?? '?')[0].toUpperCase()}
                            </span>
                            {t.dashboard}
                        </Link>
                        <button
                            onClick={() => { localStorage.removeItem('currentUser'); setCurrentUser(null); window.location.href = `/${lang}/`; }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: '10px',
                                padding: '14px 16px', borderRadius: '14px',
                                background: 'rgba(239,68,68,0.06)', color: '#ef4444',
                                fontWeight: 700, fontSize: '15px', border: 'none',
                                cursor: 'pointer', width: '100%', textAlign: 'left',
                            }}
                        >
                            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
                            {t.logout}
                        </button>
                        </>
                    ) : (
                        <Link href="/login" style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '14px 16px', borderRadius: '14px',
                            color: '#0b5cff', fontWeight: 700, fontSize: '15px', textDecoration: 'none',
                        }}>
                            <IconLogin />
                            {t.login}
                        </Link>
                    )}

                </div>
            </div>

            {/* Spacer to prevent content from hiding behind fixed header */}
            <div style={{ height: '72px' }} />
        </>
    );
}
