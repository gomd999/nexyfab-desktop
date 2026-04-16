'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';

const languages = [
    { code: 'en', label: 'English' },
    { code: 'kr', label: '한국어' },
    { code: 'cn', label: '中文' },
    { code: 'ja', label: '日本語' },
    { code: 'es', label: 'Español' },
    { code: 'ar', label: 'العربية' },
];

export default function LanguageSelector() {
    const pathname = usePathname() || '/en';

    // Parse the current language and path
    const segments = pathname.split('/').filter(Boolean);
    let currentLang = 'en';
    let restOfPath = '';

    if (segments.length > 0 && ['en', 'kr', 'ja', 'cn', 'jp', 'es', 'ar'].includes(segments[0])) {
        // Handle jp to ja alias if needed
        currentLang = segments[0] === 'jp' ? 'ja' : segments[0];
        restOfPath = '/' + segments.slice(1).join('/');
    } else {
        restOfPath = pathname !== '/' ? pathname : '';
    }

    const [isOpen, setIsOpen] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [isHovered, setIsHovered] = useState(false);

    const dropdownRef = useRef<HTMLDivElement>(null);
    const hideTimeout = useRef<NodeJS.Timeout | null>(null);
    const lastScrollY = useRef(0);
    const isHoveredRef = useRef(false);

    // useEffect에서 사용하므로 반드시 먼저 선언
    const resetHideTimeout = () => {
        if (hideTimeout.current) clearTimeout(hideTimeout.current);
        if (!isHoveredRef.current) {
            hideTimeout.current = setTimeout(() => {
                setIsVisible(false);
                setIsOpen(false);
            }, 1500);
        }
    };

    // Keep ref in sync with state for timeout closures
    useEffect(() => {
        isHoveredRef.current = isHovered;
        if (isHovered) {
            setIsVisible(true);
            if (hideTimeout.current) clearTimeout(hideTimeout.current);
        } else {
            resetHideTimeout();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isHovered]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const handleMouseMove = () => {
            setIsVisible(true);
            resetHideTimeout();
        };

        const handleScroll = () => {
            const currentScrollY = window.scrollY;
            if (currentScrollY > lastScrollY.current + 5) {
                setIsVisible(false);
                setIsOpen(false);
            } else if (currentScrollY < lastScrollY.current - 5) {
                setIsVisible(true);
                resetHideTimeout();
            }
            lastScrollY.current = currentScrollY;
        };

        resetHideTimeout();
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('scroll', handleScroll, { passive: true });

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('scroll', handleScroll);
            if (hideTimeout.current) clearTimeout(hideTimeout.current);
        };
    }, []);

    const currentLabel = languages.find(l => l.code === currentLang)?.label || '한국어';

    const getLink = (code: string) => {
        return `/${code}${restOfPath}`;
    };

    return (
        <div
            ref={dropdownRef}
            style={{
                position: 'relative',
                zIndex: 1000005,
                opacity: isVisible ? 1 : 0,
                visibility: isVisible ? 'visible' : 'hidden',
                pointerEvents: isVisible ? 'auto' : 'none',
                transition: 'opacity 0.4s ease, visibility 0.4s ease'
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <button
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '6px 14px',
                    borderRadius: '24px',
                    background: isHovered || isOpen ? '#007bff' : '#ffffff',
                    color: isHovered || isOpen ? '#ffffff' : '#333333',
                    border: '1px solid',
                    borderColor: isHovered || isOpen ? '#007bff' : '#dddddd',
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
                    style={{
                        display: 'block',
                        position: 'absolute',
                        top: '100%',
                        paddingTop: '8px',
                        right: 0,
                        minWidth: '110px',
                        zIndex: 1000006
                    }}
                >
                    <div
                        style={{
                            background: '#fff',
                            borderRadius: '8px',
                            boxShadow: '0px 4px 12px rgba(0,0,0,0.1)',
                            border: '1px solid #ebebeb',
                            overflow: 'hidden',
                        }}
                    >
                        {languages.map((lang) => (
                            <a
                                key={lang.code}
                                href={getLink(lang.code)}
                                style={{
                                    display: 'block',
                                    padding: '10px 16px',
                                    textDecoration: 'none',
                                    color: currentLang === lang.code ? '#007bff' : '#333',
                                    fontSize: '14px',
                                    fontWeight: currentLang === lang.code ? '600' : '400',
                                    borderBottom: '1px solid #f1f1f1',
                                    background: currentLang === lang.code ? '#f8faff' : '#fff',
                                    transition: 'background 0.2s',
                                }}
                                onClick={() => setIsOpen(false)}
                                onMouseEnter={(e) => {
                                    if (currentLang !== lang.code) e.currentTarget.style.background = '#f9f9f9';
                                }}
                                onMouseLeave={(e) => {
                                    if (currentLang !== lang.code) e.currentTarget.style.background = '#fff';
                                }}
                            >
                                {lang.label}
                            </a>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}


