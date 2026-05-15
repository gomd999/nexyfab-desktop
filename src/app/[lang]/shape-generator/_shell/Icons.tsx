// Line-style SVG icon set for the shell-v2 chrome.
// Stroke uses currentColor so theme tokens cascade.
// Ported from `Nexyfab 3d design/app/icons.jsx`.

import type { SVGProps, ReactNode } from 'react';

type IcoProps = {
  d?: string;
  size?: number;
  fill?: string;
  sw?: number;
  vb?: string;
  children?: ReactNode;
} & Omit<SVGProps<SVGSVGElement>, 'children'>;

const Ico = ({
  d,
  size = 16,
  fill,
  sw = 1.5,
  vb = '0 0 24 24',
  children,
  ...rest
}: IcoProps) => (
  <svg
    width={size}
    height={size}
    viewBox={vb}
    fill={fill ?? 'none'}
    stroke="currentColor"
    strokeWidth={sw}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {d ? <path d={d} /> : children}
  </svg>
);

export type IconProps = { size?: number; className?: string };

export const I = {
  // file/system
  folder: (p: IconProps) => <Ico {...p} d="M3 6.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  file: (p: IconProps) => <Ico {...p} d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5" />,
  save: (p: IconProps) => <Ico {...p} d="M5 4h11l3 3v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z M7 4v6h10V4 M8 14h8v6H8z" />,
  undo: (p: IconProps) => <Ico {...p} d="M4 8h11a5 5 0 0 1 0 10H9 M4 8l4-4 M4 8l4 4" />,
  redo: (p: IconProps) => <Ico {...p} d="M20 8H9a5 5 0 0 0 0 10h6 M20 8l-4-4 M20 8l-4 4" />,
  search: (p: IconProps) => <Ico {...p} d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15z M21 21l-5.2-5.2" />,
  cog: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06A2 2 0 1 1 4.13 16.93l.06-.06A1.7 1.7 0 0 0 4.53 15 1.7 1.7 0 0 0 3 14H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.53 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 6.96 4.24l.06.06A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3.1V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
    </Ico>
  ),
  // tree icons
  body: (p: IconProps) => <Ico {...p} d="M4 7l8-4 8 4-8 4z M4 7v10l8 4 M20 7v10l-8 4 M12 11v10" />,
  sketch: (p: IconProps) => <Ico {...p} d="M4 20l4-1 12-12-3-3L5 16z M14 6l3 3 M12 20h8" />,
  plane: (p: IconProps) => <Ico {...p} d="M3 8l9-4 9 4-9 4z M3 16l9 4 9-4 M3 8v8 M21 8v8" />,
  extrude: (p: IconProps) => <Ico {...p} d="M4 9l5-3 11 4-5 3z M4 9v8l11 4v-8 M15 13l5-3v8l-5 3" />,
  revolve: (p: IconProps) => (
    <Ico {...p}>
      <ellipse cx="12" cy="6" rx="6" ry="2" />
      <path d="M6 6v12 M18 6v12" />
      <ellipse cx="12" cy="18" rx="6" ry="2" />
    </Ico>
  ),
  sweep: (p: IconProps) => <Ico {...p} d="M4 16c0-6 4-10 8-10 M12 6c4 0 4 4 8 4 M16 13l4-3-3-3" />,
  loft: (p: IconProps) => <Ico {...p} d="M5 5h6v6H5z M13 13h6v6h-6z M11 5l8 8 M5 11l8 8" />,
  fillet: (p: IconProps) => <Ico {...p} d="M4 20V8a4 4 0 0 1 4-4h12" />,
  chamfer: (p: IconProps) => <Ico {...p} d="M4 20V10l6-6h10" />,
  hole: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
    </Ico>
  ),
  shell: (p: IconProps) => <Ico {...p} d="M5 5h14v14H5z M9 9h6v6H9z" />,
  pattern: (p: IconProps) => (
    <Ico {...p}>
      <rect x="4" y="4" width="5" height="5" />
      <rect x="15" y="4" width="5" height="5" />
      <rect x="4" y="15" width="5" height="5" />
      <rect x="15" y="15" width="5" height="5" />
    </Ico>
  ),
  mirror: (p: IconProps) => <Ico {...p} d="M12 3v18 M4 7l4 5-4 5 M20 7l-4 5 4 5" />,
  combine: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="9" cy="12" r="5" />
      <circle cx="15" cy="12" r="5" />
    </Ico>
  ),
  draft: (p: IconProps) => <Ico {...p} d="M5 20h14 M7 20V8l5-4 5 4v12" />,
  // sketch tools
  line: (p: IconProps) => <Ico {...p} d="M5 19L19 5" />,
  rect: (p: IconProps) => (
    <Ico {...p}>
      <rect x="4" y="4" width="16" height="16" />
    </Ico>
  ),
  circle: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="8" />
    </Ico>
  ),
  arc: (p: IconProps) => <Ico {...p} d="M4 18a10 10 0 0 1 16 0" />,
  poly: (p: IconProps) => <Ico {...p} d="M12 3l8 6-3 10H7l-3-10z" />,
  spline: (p: IconProps) => <Ico {...p} d="M3 18C7 18 7 6 11 6s4 12 8 12" />,
  dim: (p: IconProps) => <Ico {...p} d="M4 8v8 M20 8v8 M4 12h16 M7 9l-3 3 3 3 M17 9l3 3-3 3" />,
  constraint: (p: IconProps) => <Ico {...p} d="M5 12h14 M9 8v8 M15 8v8" />,
  trim: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M20 4 8 16 M4 4l12 12" />
    </Ico>
  ),
  offset: (p: IconProps) => (
    <Ico {...p}>
      <rect x="3" y="3" width="12" height="12" />
      <rect x="9" y="9" width="12" height="12" />
    </Ico>
  ),
  // panels
  tree: (p: IconProps) => <Ico {...p} d="M4 6h4 M4 12h7 M4 18h10 M4 6v12" />,
  layers: (p: IconProps) => <Ico {...p} d="M12 3 3 8l9 5 9-5z M3 13l9 5 9-5 M3 18l9 5 9-5" />,
  paint: (p: IconProps) => <Ico {...p} d="M19 11V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8 M19 11h2v6a3 3 0 0 1-6 0v-2a2 2 0 0 1 2-2h2" />,
  ruler: (p: IconProps) => <Ico {...p} d="M3 17 17 3l4 4L7 21z M7 11l3 3 M11 7l3 3 M15 11l3 3" />,
  history: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Ico>
  ),
  comments: (p: IconProps) => <Ico {...p} d="M21 12a8 8 0 0 1-12 7l-5 1 1-4A8 8 0 1 1 21 12z" />,
  ai: (p: IconProps) => <Ico {...p} d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />,
  // utility
  eye: (p: IconProps) => <Ico {...p} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />,
  eye_off: (p: IconProps) => <Ico {...p} d="M3 3l18 18 M9.9 5.1A10 10 0 0 1 22 12s-2 3.5-5.3 5.5 M6.6 6.6C4 8 2 12 2 12s4 7 10 7c1.7 0 3.2-.4 4.5-1" />,
  lock: (p: IconProps) => (
    <Ico {...p}>
      <rect x="5" y="11" width="14" height="10" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </Ico>
  ),
  link: (p: IconProps) => <Ico {...p} d="M10 14l4-4 M9 7l1-1a4 4 0 0 1 6 6l-1 1 M15 17l-1 1a4 4 0 0 1-6-6l1-1" />,
  plus: (p: IconProps) => <Ico {...p} d="M12 5v14 M5 12h14" />,
  minus: (p: IconProps) => <Ico {...p} d="M5 12h14" />,
  x: (p: IconProps) => <Ico {...p} d="M6 6l12 12 M18 6 6 18" />,
  check: (p: IconProps) => <Ico {...p} d="M5 12l5 5L20 7" />,
  caret_r: (p: IconProps) => <Ico {...p} d="M9 6l6 6-6 6" />,
  caret_d: (p: IconProps) => <Ico {...p} d="M6 9l6 6 6-6" />,
  more: (p: IconProps) => <Ico {...p} d="M12 5v.01 M12 12v.01 M12 19v.01" />,
  user: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
    </Ico>
  ),
  cube: (p: IconProps) => <Ico {...p} d="M12 3l9 5v8l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v10" />,
  pin: (p: IconProps) => <Ico {...p} d="M12 22V13 M5 9h14l-3 4H8z M9 4h6v5H9z" />,
  share: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </Ico>
  ),
  rotate: (p: IconProps) => <Ico {...p} d="M20 12a8 8 0 1 1-3-6.2 M20 4v5h-5" />,
  zoom_in: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-5.2-5.2 M11 8v6 M8 11h6" />
    </Ico>
  ),
  zoom_out: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-5.2-5.2 M8 11h6" />
    </Ico>
  ),
  pan: (p: IconProps) => <Ico {...p} d="M12 5v6 M12 5l-3 3 M12 5l3 3 M12 19v-6 M12 19l-3-3 M12 19l3-3 M5 12h6 M5 12l3-3 M5 12l3 3 M19 12h-6 M19 12l-3-3 M19 12l-3 3" />,
  fit: (p: IconProps) => <Ico {...p} d="M5 9V5h4 M19 9V5h-4 M5 15v4h4 M19 15v4h-4" />,
  section: (p: IconProps) => <Ico {...p} d="M4 4v16 M4 12l8-8h8v8 M12 12l8 8H4" />,
  globe: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18 M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </Ico>
  ),
  // visibility/render
  sun: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2" />
    </Ico>
  ),
  moon: (p: IconProps) => <Ico {...p} d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" />,
  bolt: (p: IconProps) => <Ico {...p} d="M13 3 4 14h7l-1 7 9-11h-7z" />,
  // drawing
  doc: (p: IconProps) => <Ico {...p} d="M6 3h10l4 4v14H6z M6 8h4 M6 12h12 M6 16h12 M6 20h12" />,
  print: (p: IconProps) => <Ico {...p} d="M6 9V3h12v6 M4 14h16v-3a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2z M6 14h12v7H6z" />,
  // git
  branch: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="8" r="2" />
      <path d="M6 8v8 M18 10c0 5-6 4-12 8" />
    </Ico>
  ),
  commit: (p: IconProps) => (
    <Ico {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M3 12h5 M16 12h5" />
    </Ico>
  ),
};

export type IconName = keyof typeof I;
