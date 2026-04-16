'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export default function LangSetter() {
    const pathname = usePathname();

    useEffect(() => {
        if (!pathname) return;
        const langCode = pathname.split('/')[1];

        const langMap: Record<string, string> = { kr: 'ko', en: 'en', ja: 'ja', cn: 'zh-CN', es: 'es', ar: 'ar' };
        const htmlLang = langMap[langCode] || 'ko';

        document.documentElement.lang = htmlLang;
        document.documentElement.dir = langCode === 'ar' ? 'rtl' : 'ltr';

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


