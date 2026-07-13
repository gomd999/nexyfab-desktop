import React from 'react';

/**
 * 분야 라인 SVG 아이콘 세트 (랜딩 공용).
 * currentColor 를 상속하므로 부모의 color / accent 로 틴트된다.
 * ChatHero 의 분야 칩·입력창, EngVertical 의 EngDomains 카드가 공유한다.
 */
export type DomainIconName =
  | 'mechanical'   // 기어
  | 'civil'        // 아치 교량
  | 'architecture' // 창문 그리드 건물
  | 'landscape'    // 나무
  | 'interior'     // 소파
  | 'concrete';    // 벽돌/조적

const svgBase: React.SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
};

export function DomainIcon({ name, size = 18 }: { name: DomainIconName; size?: number }) {
  return (
    <svg {...svgBase} width={size} height={size} aria-hidden focusable="false" style={{ display: 'block', flexShrink: 0 }}>
      {name === 'mechanical' && (<><circle cx="12" cy="12" r="3.2" /><path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2" /></>)}
      {name === 'civil' && (<><path d="M2 15h20M5 15v-3M19 15v-3M12 12v3" /><path d="M4.5 12c4-4.5 11-4.5 15 0" /></>)}
      {name === 'architecture' && (<><path d="M3 20.5h18" /><rect x="5.5" y="4" width="13" height="16.5" rx="1" /><path d="M9 8h1.5M13.5 8h1.5M9 12h1.5M13.5 12h1.5M9 16h1.5M13.5 16h1.5" /></>)}
      {name === 'landscape' && (<><path d="M12 21v-6" /><path d="M12 15c-3.4 0-5.2-2.2-5.2-4.6C6.8 7.7 8.4 5.7 12 2.8c3.6 2.9 5.2 4.9 5.2 7.6 0 2.4-1.8 4.6-5.2 4.6z" /></>)}
      {name === 'interior' && (<><path d="M5 10.5V8.2A2.2 2.2 0 0 1 7.2 6h9.6A2.2 2.2 0 0 1 19 8.2v2.3" /><rect x="3" y="10.5" width="18" height="6.5" rx="2" /><path d="M6 17v2M18 17v2" /></>)}
      {name === 'concrete' && (<><rect x="3" y="4.5" width="18" height="15" rx="1" /><path d="M3 9.5h18M3 14.5h18M9 4.5v5M15 9.5v5M9 14.5v5M6 9.5v5M18 9.5v5" /></>)}
    </svg>
  );
}
