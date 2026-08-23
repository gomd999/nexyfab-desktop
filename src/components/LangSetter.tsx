'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { toIsoLang, toRouteLang } from '@/lib/i18n/normalize';

export default function LangSetter() {
    const pathname = usePathname();

    useEffect(() => {
        if (!pathname) return;
        const pathLang = pathname.split('/')[1];
        const routeAliases = ['kr', 'ko', 'en', 'ja', 'jp', 'cn', 'zh', 'es', 'ar'];
        let requestedLang = routeAliases.includes(pathLang) ? pathLang : null;
        if (!requestedLang) {
            const params = new URLSearchParams(window.location.search);
            requestedLang = params.get('lang');
        }
        if (!requestedLang) {
            const cookie = document.cookie.match(/(?:^|; )nf_lang=([^;]+)/)?.[1];
            requestedLang = cookie ? decodeURIComponent(cookie) : null;
        }
        const routeLang = toRouteLang(requestedLang);
        const isoLang = toIsoLang(routeLang);
        const htmlLang = isoLang === 'zh' ? 'zh-CN' : isoLang;

        document.documentElement.lang = htmlLang;
        document.documentElement.dir = routeLang === 'ar' ? 'rtl' : 'ltr';

        document.body.className = document.body.className.replace(/lang-\S+/g, '');
        document.body.classList.add(`lang-${htmlLang}`);

        // Global Scroll Reveal Logic
        // requestAnimationFrame defers observer setup until after React hydration,
        // preventing className mismatch between server HTML and client DOM.
        let observer: IntersectionObserver;
        const raf = requestAnimationFrame(() => {
            observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('active');
                    } else {
                        entry.target.classList.remove('active');
                    }
                });
            }, { threshold: 0.1 });
            document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
        });

        // Global Mouse Tracking for Parallax
        const handleMouseMove = (e: MouseEvent) => {
            const x = (e.clientX / window.innerWidth) - 0.5;
            const y = (e.clientY / window.innerHeight) - 0.5;
            document.documentElement.style.setProperty('--mouse-x', x.toString());
            document.documentElement.style.setProperty('--mouse-y', y.toString());
        };

        window.addEventListener('mousemove', handleMouseMove);

        return () => {
            cancelAnimationFrame(raf);
            observer?.disconnect();
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, [pathname]);

    return null;
}


