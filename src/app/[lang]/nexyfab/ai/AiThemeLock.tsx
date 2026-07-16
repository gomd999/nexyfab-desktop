'use client';

// /nexyfab/ai 앱 창은 다크 고정 — 챗 캔버스가 다크 그라데이션이라, 라이트 테마의
// 흰 사이드바와 반반이 되는 이질감을 막는다. 떠날 때 원래 테마를 복원한다.
import { useEffect } from 'react';

export default function AiThemeLock() {
  useEffect(() => {
    const el = document.documentElement;
    const prev = el.getAttribute('data-theme');
    el.setAttribute('data-theme', 'dark');
    return () => {
      if (prev) el.setAttribute('data-theme', prev);
      else el.removeAttribute('data-theme');
    };
  }, []);
  return null;
}
