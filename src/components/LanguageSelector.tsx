'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { toRouteLang, type RouteLang } from '@/lib/i18n/normalize';

const languages = [
    { code: 'en', label: 'English' },
    { code: 'kr', label: '한국어' },
    { code: 'cn', label: '中文' },
    { code: 'ja', label: '日本語' },
    { code: 'es', label: 'Español' },
    { code: 'ar', label: 'العربية' },
];
const SELECT_LANGUAGE_LABEL: Record<RouteLang, string> = {
    kr: '언어 선택', en: 'Select language', ja: '言語を選択', cn: '选择语言', es: 'Seleccionar idioma', ar: 'اختر اللغة',
};

export default function LanguageSelector() {
    const pathname = usePathname() || '/en';
    const searchParams = useSearchParams();
    const queryLang = searchParams.get('lang');
    const currentQuery = searchParams.toString();

    // Parse the current language and path
    const segments = pathname.split('/').filter(Boolean);
    let currentLang: RouteLang = 'en';
    let restOfPath = '';

    if (segments.length > 0 && ['en', 'kr', 'ja', 'cn', 'ko', 'zh', 'jp', 'es', 'ar'].includes(segments[0])) {
        // Accept legacy ISO/JP segments, but always emit the canonical route
        // vocabulary when the user selects another language.
        currentLang = toRouteLang(segments[0]);
        restOfPath = '/' + segments.slice(1).join('/');
    } else {
        restOfPath = pathname !== '/' ? pathname : '';
        // Auth/account routes live outside /[lang]. Keep their language in a
        // query parameter instead of navigating to a route that does not
        // exist (for example /en/login).
        currentLang = toRouteLang(queryLang);
    }

    const [isOpen, setIsOpen] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const currentLabel = languages.find(l => l.code === currentLang)?.label || '한국어';
    const isRtl = currentLang === 'ar';

    const getLink = (code: string) => {
        const isUnlocalizedAuthRoute = /^(\/login|\/register(?:\/customer)?|\/account|\/dashboard)(?:\/|$)/.test(restOfPath);
        if (isUnlocalizedAuthRoute) {
            const query = new URLSearchParams(currentQuery);
            query.set('lang', code);
            return `${restOfPath || '/'}?${query.toString()}`;
        }
        const query = new URLSearchParams(currentQuery);
        // A localized path already carries its locale in the first segment;
        // retaining a stale ?lang= value would make auth/onboarding resolve a
        // different language than the URL.
        query.delete('lang');
        const suffix = query.toString();
        return `/${code}${restOfPath}${suffix ? `?${suffix}` : ''}`;
    };

    return (
        <div
            ref={dropdownRef}
            dir={isRtl ? 'rtl' : 'ltr'}
            style={{
                position: 'relative',
                zIndex: 1000005,
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocusCapture={() => setIsHovered(true)}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setIsHovered(false);
                    setIsOpen(false);
                }
            }}
        >
            <button
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-label={`${currentLabel} — ${SELECT_LANGUAGE_LABEL[currentLang]}`}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '6px 14px',
                    borderRadius: '24px',
                    background: isHovered || isOpen ? '#005fcc' : '#ffffff',
                    color: isHovered || isOpen ? '#ffffff' : '#1f2937',
                    border: '1px solid',
                    borderColor: isHovered || isOpen
                        ? '#005fcc'
                        : '#cbd5e1',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    fontSize: '13px',
                    fontWeight: 600,
                }}
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm7.5-6.923c-.67.204-1.335.82-1.887 1.855A7.97 7.97 0 0 0 5.145 4H7.5V1.077zM4.09 4a9.267 9.267 0 0 1 .64-1.539 6.7 6.7 0 0 1 .597-.933A7.025 7.025 0 0 0 2.255 4H4.09zm-.582 3.5c.03-.877.138-1.718.312-2.5H1.674a6.958 6.958 0 0 0-.656 2.5h2.49zM4.847 5a12.5 12.5 0 0 0-.338 2.5H7.5V5H4.847zM8.5 5v2.5h2.99a12.495 12.495 0 0 0-.337-2.5H8.5zM4.51 8.5a12.5 12.5 0 0 0 .337 2.5H7.5V8.5H4.51zm3.99 0V11h2.653c.187-.765.306-1.608.338-2.5H8.5zM5.145 12c.138.592.32 1.052.534 1.372.255.385.62.637.948.711V12H5.146zm3.355 1.408c.55-.13.882-.413 1.056-.632.214-.294.4-1.028.534-1.6H8.5v2.16c.11-.006.223-.016.33-.027a4.64 4.64 0 0 0 .17-.008zm1.696-1.232c-.255.933-.516 1.684-.79 2.128a6.38 6.38 0 0 1-1.618 1.583A6.975 6.975 0 0 0 10.196 12H8.86l.335.176zm1.334-1.176h1.968a6.96 6.96 0 0 0-.656-2.5h-2.14c.174.78.282 1.623.312 2.5z" />
                    </svg>
                </span>
                <span>{currentLabel}</span>
                <span style={{ fontSize: '10px' }}>▼</span>
            </button>

            {(isOpen || isHovered) && (
                <div
                    role="listbox"
                    style={{
                        display: 'block',
                        position: 'absolute',
                        top: '100%',
                        paddingTop: '8px',
                        ...(isRtl ? { left: 0 } : { right: 0 }),
                        minWidth: '110px',
                        zIndex: 1000006
                    }}
                >
                    <div
                        style={{
                            background: '#ffffff',
                            borderRadius: '8px',
                            boxShadow: '0px 4px 12px rgba(0,0,0,0.1)',
                            border: '1px solid #cbd5e1',
                            overflow: 'hidden',
                        }}
                    >
                        {languages.map((lang) => {
                            const isCurrent = currentLang === lang.code;
                            return (
                                <a
                                    key={lang.code}
                                    href={getLink(lang.code)}
                                    role="option"
                                    aria-selected={isCurrent}
                                    lang={lang.code === 'kr' ? 'ko' : lang.code === 'cn' ? 'zh' : lang.code}
                                    dir={lang.code === 'ar' ? 'rtl' : 'ltr'}
                                    style={{
                                        display: 'block',
                                        padding: '10px 16px',
                                        textDecoration: 'none',
                                        color: isCurrent
                                            ? '#005fcc'
                                            : '#1f2937',
                                        fontSize: '14px',
                                        fontWeight: isCurrent ? 600 : 400,
                                        borderBottom: '1px solid #e5e7eb',
                                        background: isCurrent
                                            ? '#eff6ff'
                                            : '#ffffff',
                                        transition: 'background 0.2s',
                                    }}
                                    onClick={() => {
                                        // Persist the lang choice so pages outside the
                                        // [lang] route tree (e.g. /dashboard, /login) can
                                        // still render in the chosen language.
                                        //   - cookie: Header (SSR-safe via document.cookie on hydrate)
                                        //   - localStorage: (auth)/dashboard already reads `nf_lang` here
                                        // Both must be set or the dashboard body and the header drift apart.
                                        try {
                                            document.cookie = `nf_lang=${lang.code}; Path=/; Max-Age=31536000; SameSite=Lax`;
                                            localStorage.setItem('nf_lang', lang.code);
                                        } catch { /* ignore */ }
                                        setIsOpen(false);
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isCurrent) e.currentTarget.style.background = '#f3f4f6';
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!isCurrent) e.currentTarget.style.background = '#ffffff';
                                    }}
                                >
                                    {lang.label}
                                </a>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}


