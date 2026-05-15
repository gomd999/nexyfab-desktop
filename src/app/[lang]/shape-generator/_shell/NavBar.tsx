'use client';

// Floating viewport nav (bottom-center). Pan / orbit / zoom / fit / section / eye.

import { I, type IconName } from './Icons';

export type NavMode = 'orbit' | 'pan' | 'zoom_in' | 'zoom_out' | 'fit' | 'section' | 'eye';

export interface NavButton {
  id: NavMode;
  title: string;
  ico: IconName;
  active?: boolean;
  onClick?: () => void;
}

export interface NavBarProps {
  buttons?: NavButton[];
}

const DEFAULT_BUTTONS: NavButton[] = [
  { id: 'pan', title: 'Pan', ico: 'pan' },
  { id: 'orbit', title: 'Orbit', ico: 'rotate', active: true },
  { id: 'zoom_in', title: 'Zoom in', ico: 'zoom_in' },
  { id: 'zoom_out', title: 'Zoom out', ico: 'zoom_out' },
  { id: 'fit', title: 'Fit', ico: 'fit' },
  { id: 'section', title: 'Section', ico: 'section' },
  { id: 'eye', title: 'Visibility', ico: 'eye' },
];

export function NavBar({ buttons = DEFAULT_BUTTONS }: NavBarProps) {
  return (
    <div className="nx-nav">
      {buttons.map((b, i) => {
        const Icon = I[b.ico] ?? I.cube;
        const showSep = i === 4; // after fit, before section
        return (
          <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {showSep && <span className="sep" />}
            <button
              type="button"
              title={b.title}
              className={b.active ? 'active' : ''}
              onClick={b.onClick}
            >
              <Icon size={14} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
