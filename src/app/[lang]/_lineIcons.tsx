import React from 'react';

/**
 * 랜딩 마케팅 섹션 공용 라인 SVG 아이콘 세트.
 * currentColor 상속 → 부모 color 로 틴트. 도메인 아이콘은 _domainIcons.tsx 참고.
 * 스트로크 스타일은 _domainIcons 와 동일(1.7, round)해 시각적으로 통일된다.
 */
export type LineIconName =
  | 'rocket' | 'palette' | 'factory' | 'search' | 'microscope' | 'dna' | 'money'
  | 'check' | 'brain' | 'lock' | 'bolt' | 'chart' | 'cube' | 'ruler' | 'thermometer'
  | 'shield' | 'clipboard' | 'puzzle' | 'flask' | 'crane' | 'tools' | 'keyboard' | 'robot';

const svgBase: React.SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
};

const PATHS: Record<LineIconName, React.ReactNode> = {
  rocket: (<><path d="M12 3c2.8 1.6 4.2 4.6 4 8.5L14.5 15h-5L8 11.5C7.8 7.6 9.2 4.6 12 3z" /><circle cx="12" cy="9" r="1.4" /><path d="M8.6 15l-2 1.9 2.3.5M15.4 15l2 1.9-2.3.5M10.4 17.6c0 1.6.6 3 1.6 3s1.6-1.4 1.6-3" /></>),
  palette: (<><path d="M12 3.2a8.8 8.8 0 1 0 0 17.6c1.4 0 2-1 2-1.9 0-.5-.2-.8-.2-1.2 0-.7.6-1.2 1.3-1.2H17a4.3 4.3 0 0 0 4.3-4.3C21.3 6.7 17.2 3.2 12 3.2z" /><circle cx="7.6" cy="11.4" r="1" /><circle cx="10" cy="7.6" r="1" /><circle cx="14.4" cy="7.6" r="1" /></>),
  factory: (<><path d="M3 21h18" /><path d="M4 21V11l5 3.2V11l5 3.2V8l6 3.8V21" /><path d="M7 18h1.4M11.4 18h1.4M15.8 18h1.4" /></>),
  search: (<><circle cx="11" cy="11" r="6.2" /><path d="M20 20l-4.6-4.6" /></>),
  microscope: (<><path d="M6 21h12" /><path d="M9 21a6.5 6.5 0 0 0 6.4-7.7" /><path d="M10.2 3.4l2.6 1.5-2.4 4.2-2.6-1.5z" /><path d="M9 9.6l3 1.7M8 13l2.7-1.6" /></>),
  dna: (<><path d="M8 3c0 4 8 6 8 9s-8 5-8 9M16 3c0 4-8 6-8 9s8 5 8 9" /><path d="M9.3 6h5.4M9 9h6M9 15h6M9.3 18h5.4" /></>),
  money: (<><circle cx="12" cy="12" r="8.4" /><path d="M12 6.6v10.8M14.6 9.1a3 3 0 0 0-2.6-1.4c-1.6 0-2.8.9-2.8 2.1 0 2.8 5.6 1.5 5.6 4.5 0 1.3-1.3 2.2-3 2.2A3 3 0 0 1 9 15" /></>),
  check: (<><circle cx="12" cy="12" r="8.5" /><path d="M8.4 12.3l2.4 2.4 4.7-5.1" /></>),
  brain: (<><path d="M12 5.5a3 3 0 0 0-5.7-1.3A2.8 2.8 0 0 0 5 9.4a2.8 2.8 0 0 0 1 5.1A2.6 2.6 0 0 0 12 16.6zM12 5.5a3 3 0 0 1 5.7-1.3A2.8 2.8 0 0 1 19 9.4a2.8 2.8 0 0 1-1 5.1A2.6 2.6 0 0 1 12 16.6z" /><path d="M12 5.5v13.5" /></>),
  lock: (<><rect x="5" y="10.5" width="14" height="9.5" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /><circle cx="12" cy="15" r="1.2" /></>),
  bolt: (<><path d="M13 3L5 13.5h5l-1 7.5 8-11h-5z" /></>),
  chart: (<><path d="M4 20h16" /><path d="M6.5 20v-6M11 20V10M15.5 20v-8M20 20V6.5" /></>),
  cube: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 3v18M4 7.5l8 4.5 8-4.5" /></>),
  ruler: (<><rect x="3" y="8.5" width="18" height="7" rx="1" /><path d="M7 8.5v2.6M11 8.5v3.4M15 8.5v2.6M19 8.5v3.4" /></>),
  thermometer: (<><path d="M12 4a2 2 0 0 0-2 2v7.3a3.2 3.2 0 1 0 4 0V6a2 2 0 0 0-2-2z" /><path d="M12 8.5v6" /></>),
  shield: (<><path d="M12 3l7 3v5.5c0 4.3-3 8-7 9-4-1-7-4.7-7-9V6z" /><path d="M9 12l2 2 4-4" /></>),
  clipboard: (<><rect x="6" y="5" width="12" height="16" rx="2" /><path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" /><path d="M9 10.5h6M9 14h6M9 17.5h4" /></>),
  puzzle: (<><path d="M9 5h2.2a1.4 1.4 0 0 1 2.6 0H16a1 1 0 0 1 1 1v2.4a1.4 1.4 0 0 1 0 2.6V14a1 1 0 0 1-1 1h-2.4a1.4 1.4 0 0 0-2.6 0H9a1 1 0 0 1-1-1v-2.6a1.4 1.4 0 0 1 0-2.6V6a1 1 0 0 1 1-1z" /></>),
  flask: (<><path d="M9 3h6M10 3v5.6L5.6 16.8A2 2 0 0 0 7.4 20h9.2a2 2 0 0 0 1.8-3.2L14 8.6V3" /><path d="M8.4 14h7.2" /></>),
  crane: (<><path d="M3 21h18" /><path d="M12 21V6M12 6H5l2.5-2.6M12 6h7.5M19.5 6v3.2M7.5 9h4.5M9.5 9v2" /></>),
  tools: (<><path d="M14.6 6.4a3.5 3.5 0 0 0-4.7 4.2l-5.4 5.4a1.6 1.6 0 0 0 2.3 2.3l5.4-5.4a3.5 3.5 0 0 0 4.2-4.7l-2.1 2.1-1.9-.4-.4-1.9z" /></>),
  keyboard: (<><rect x="3" y="7" width="18" height="10" rx="2" /><path d="M6.5 10.2h.01M9.5 10.2h.01M12.5 10.2h.01M15.5 10.2h.01M8 13.6h8" /></>),
  robot: (<><rect x="5" y="8" width="14" height="10" rx="2" /><path d="M12 5v3M9 3.5h6" /><path d="M9.5 12.5h.01M14.5 12.5h.01M9.5 15.4h5M3 12v3M21 12v3" /></>),
};

export function LineIcon({ name, size = 22 }: { name: LineIconName; size?: number }) {
  return (
    <svg {...svgBase} width={size} height={size} aria-hidden focusable="false" style={{ display: 'block', flexShrink: 0 }}>
      {PATHS[name]}
    </svg>
  );
}
