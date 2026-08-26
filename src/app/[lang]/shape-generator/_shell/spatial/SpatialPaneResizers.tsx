'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { shellChromeText } from '../shellChromeI18n';

const MIN_LEFT = 190;
const MAX_LEFT = 420;
const MIN_RIGHT = 240;
const MAX_RIGHT = 460;

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function GridHandle({
  side,
  lang,
  value,
  min,
  max,
  onChange,
  onReset,
}: {
  side: 'left' | 'right';
  lang?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ pointerId: number; startX: number; startValue: number } | null>(null);
  const end = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && drag.current?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    document.body.removeAttribute('data-nx-panel-resizing');
  }, []);
  useEffect(() => () => document.body.removeAttribute('data-nx-panel-resizing'), []);

  const keyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = side === 'left' ? 1 : -1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = value + direction * 10;
    else if (event.key === 'ArrowLeft') next = value - direction * 10;
    else if (event.key === 'Home') next = min;
    else if (event.key === 'End') next = max;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };

  const edgeStyle: CSSProperties = side === 'left'
    ? { left: 'calc(var(--nx-spatial-left) - 4px)' }
    : { right: 'calc(var(--nx-spatial-right) - 4px)' };

  return (
    <div
      className={`nx-spatial-pane-resizer ${side}`}
      data-testid={`spatial-${side}-panel-resizer`}
      role="separator"
      aria-label={shellChromeText(lang, side === 'left' ? 'spatialBrowserPanelWidth' : 'spatialInspectorPanelWidth')}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      title={shellChromeText(lang, 'resizePanel')}
      style={edgeStyle}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startValue: value };
        document.body.setAttribute('data-nx-panel-resizing', side);
      }}
      onPointerMove={event => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        const delta = side === 'left' ? event.clientX - active.startX : active.startX - event.clientX;
        onChange(active.startValue + delta);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={keyDown}
    >
      <span aria-hidden="true" />
    </div>
  );
}

export function SpatialPaneResizers({
  lang,
  storageKey,
  leftDefault = 230,
  rightDefault = 310,
}: {
  lang?: string;
  storageKey: string;
  leftDefault?: number;
  rightDefault?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(() => clamp(leftDefault, MIN_LEFT, MAX_LEFT));
  const [right, setRight] = useState(() => clamp(rightDefault, MIN_RIGHT, MAX_RIGHT));

  const apply = useCallback((side: 'left' | 'right', rawValue: number, persist = true) => {
    const value = side === 'left'
      ? clamp(rawValue, MIN_LEFT, MAX_LEFT)
      : clamp(rawValue, MIN_RIGHT, MAX_RIGHT);
    const host = hostRef.current?.parentElement;
    host?.style.setProperty(side === 'left' ? '--nx-spatial-left' : '--nx-spatial-right', `${value}px`);
    if (side === 'left') setLeft(value); else setRight(value);
    if (persist) {
      try { window.localStorage.setItem(`nexyfab:studio-layout:${storageKey}:${side}`, String(value)); } catch { /* keep session state */ }
    }
  }, [storageKey]);

  useEffect(() => {
    let savedLeft = leftDefault;
    let savedRight = rightDefault;
    try {
      const storedLeft = Number(window.localStorage.getItem(`nexyfab:studio-layout:${storageKey}:left`));
      const storedRight = Number(window.localStorage.getItem(`nexyfab:studio-layout:${storageKey}:right`));
      if (Number.isFinite(storedLeft) && storedLeft > 0) savedLeft = storedLeft;
      if (Number.isFinite(storedRight) && storedRight > 0) savedRight = storedRight;
    } catch { /* use defaults */ }
    apply('left', savedLeft, false);
    apply('right', savedRight, false);
  }, [apply, leftDefault, rightDefault, storageKey]);

  return (
    <div ref={hostRef} className="nx-spatial-pane-resizers" aria-hidden="false">
      <GridHandle lang={lang} side="left" value={left} min={MIN_LEFT} max={MAX_LEFT} onChange={value => apply('left', value)} onReset={() => apply('left', leftDefault)} />
      <GridHandle lang={lang} side="right" value={right} min={MIN_RIGHT} max={MAX_RIGHT} onChange={value => apply('right', value)} onReset={() => apply('right', rightDefault)} />
    </div>
  );
}

export function SpatialResizableHost({
  lang,
  storageKey,
  leftDefault = 220,
  rightDefault = 292,
  children,
}: {
  lang?: string;
  storageKey: string;
  leftDefault?: number;
  rightDefault?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="nx-spatial-resizable-host"
      style={{ '--nx-spatial-left': `${leftDefault}px`, '--nx-spatial-right': `${rightDefault}px` } as CSSProperties}
    >
      {children}
      <SpatialPaneResizers lang={lang} storageKey={storageKey} leftDefault={leftDefault} rightDefault={rightDefault} />
    </div>
  );
}
