'use client';

import { useEffect, useState, useRef } from 'react';
import { usePathname } from 'next/navigation';

export default function NavigationProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const prevPath = useRef(pathname);

  useEffect(() => {
    if (pathname !== prevPath.current) {
      // Route changed — animate to 100%
      setProgress(90);
      setVisible(true);
      const t = setTimeout(() => {
        setProgress(100);
        setTimeout(() => {
          setVisible(false);
          setProgress(0);
        }, 200);
      }, 150);
      prevPath.current = pathname;
      return () => clearTimeout(t);
    }
  }, [pathname]);

  // Also detect clicks on <a> tags for loading start
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('http') || anchor.target === '_blank') return;
      // Same page link — skip
      if (href === pathname) return;
      setProgress(30);
      setVisible(true);
      // Slowly increment
      const interval = setInterval(() => {
        setProgress(prev => prev < 80 ? prev + 10 : prev);
      }, 200);
      // Cleanup after 5 seconds (safety)
      setTimeout(() => clearInterval(interval), 5000);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [pathname]);

  if (!visible && progress === 0) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '3px',
      zIndex: 99999, pointerEvents: 'none',
    }}>
      <div style={{
        height: '100%',
        width: `${progress}%`,
        background: 'linear-gradient(90deg, #0b5cff, #6366f1)',
        boxShadow: '0 0 10px rgba(11,92,255,0.5)',
        transition: progress === 0 ? 'none' : 'width 0.3s ease',
        borderRadius: '0 2px 2px 0',
        opacity: visible ? 1 : 0,
      }} />
    </div>
  );
}
