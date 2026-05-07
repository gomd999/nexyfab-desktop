'use client';
import { useEffect } from 'react';

export default function FullscreenAutoHide({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) {
      document.body.classList.remove('sg-fs-hide');
      return;
    }
    const REVEAL_ZONE = 48;
    const HIDE_DELAY = 2500;
    let timer: number | undefined;

    const hide = () => document.body.classList.add('sg-fs-hide');
    const show = () => document.body.classList.remove('sg-fs-hide');
    const scheduleHide = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(hide, HIDE_DELAY);
    };

    const onMove = (e: MouseEvent) => {
      if (e.clientY < REVEAL_ZONE) {
        show();
        if (timer) { window.clearTimeout(timer); timer = undefined; }
      } else if (!document.body.classList.contains('sg-fs-hide') && timer === undefined) {
        scheduleHide();
      }
    };

    scheduleHide();
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (timer) window.clearTimeout(timer);
      document.body.classList.remove('sg-fs-hide');
    };
  }, [active]);
  return null;
}
