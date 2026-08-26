'use client';

// Top-level shell-v2 layout. Composes TitleBar + Ribbon + body (left/viewport/right) + StatusBar.
// All zones accept ReactNode children so callers can inject existing production components
// (FeatureTree, RightPanel tabs, CommandToolbar handlers, etc.) without refactoring them.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { TitleBar, type TitleBarProps } from './TitleBar';
import { ModeRibbon, MODE_DEFAULT_TABS, type ShellMode, type RibbonHandler, type RibbonActiveCheck, type RibbonActionGroup } from './ModeRibbons';
import { StatusBar, type StatusBarProps } from './StatusBar';
import { useShellBridge } from './shellBridgeStore';
import type { RibbonTabDef } from './Ribbon';
import { CommandPaletteShell, useCommandPaletteShortcut } from '../featureCatalog/CommandPaletteShell';
import { FrecencyTracker } from '../featureCatalog/commandPalette';
import type { FeatureLicense } from '../featureCatalog/registry';
import type { UserExperienceLevel } from '@/lib/ai/domainProfile';
import { shellChromeText } from './shellChromeI18n';

export interface ShellProps {
  mode: ShellMode;
  experienceLevel?: UserExperienceLevel;
  titleBar: TitleBarProps;
  ribbon: {
    tabs?: RibbonTabDef[];
    groups?: RibbonActionGroup[];
    activeTab: string;
    onTabChange: (id: string) => void;
    onTool: RibbonHandler;
    isActive?: RibbonActiveCheck;
  };
  /** AI complete-product build → conditional precise CAD → verification → release evidence guidance. */
  workflow?: ReactNode;
  domainWorkspace?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  viewport: ReactNode;
  /** Optional bottom drawer (DFM/FEA/Cost/Variants). Renders below viewport. */
  bottomDrawer?: ReactNode;
  statusBar?: StatusBarProps;
  leftWidth?: number;
  rightWidth?: number;
  /** When set, ⌘K opens the command palette + activating a feature
   *  calls this callback (typically dispatches to the same handlers
   *  the ribbon's onTool uses). */
  onCommandPick?: (featureId: string) => void;
  /** User's tier — drives palette filtering. */
  userLicense?: FeatureLicense;
  /** Mechanical feature palette is intentionally disabled in spatial workspaces. */
  commandPaletteEnabled?: boolean;
  /** Render only the hosted viewport when it provides its own phone UI. */
  viewportOnly?: boolean;
  /** Stable key used to persist Browser/Inspector widths for this workspace. */
  layoutStorageKey?: string;
}

const PANEL_MIN = 220;
const PANEL_MAX = 480;

function clampPanelWidth(value: number): number {
  return Math.round(Math.min(PANEL_MAX, Math.max(PANEL_MIN, value)));
}

function usePersistedPanelWidth(storageKey: string, defaultWidth: number) {
  const normalizedDefault = clampPanelWidth(defaultWidth);
  const [width, setWidth] = useState(normalizedDefault);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) setWidth(clampPanelWidth(saved));
    } catch { /* storage can be unavailable in privacy/sandboxed contexts */ }
  }, [storageKey]);

  const update = useCallback((next: number) => {
    const normalized = clampPanelWidth(next);
    setWidth(normalized);
    try { window.localStorage.setItem(storageKey, String(normalized)); } catch { /* keep session state */ }
  }, [storageKey]);

  return { width, update, reset: () => update(normalizedDefault) };
}

function PanelResizeHandle({
  side,
  lang,
  width,
  onChange,
  onReset,
}: {
  side: 'left' | 'right';
  lang?: string;
  width: number;
  onChange: (width: number) => void;
  onReset: () => void;
}) {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const endDrag = useCallback((event?: ReactPointerEvent<HTMLDivElement>) => {
    if (event && drag.current?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    drag.current = null;
    document.body.removeAttribute('data-nx-panel-resizing');
  }, []);
  useEffect(() => () => document.body.removeAttribute('data-nx-panel-resizing'), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
    document.body.setAttribute('data-nx-panel-resizing', side);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const delta = side === 'left' ? event.clientX - active.startX : active.startX - event.clientX;
    onChange(active.startWidth + delta);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const direction = side === 'left' ? 1 : -1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = width + 10 * direction;
    else if (event.key === 'ArrowLeft') next = width - 10 * direction;
    else if (event.key === 'Home') next = PANEL_MIN;
    else if (event.key === 'End') next = PANEL_MAX;
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };

  return (
    <div
      className={`nx-panel-resizer ${side}`}
      data-testid={`shell-${side}-panel-resizer`}
      role="separator"
      aria-label={shellChromeText(lang, side === 'left' ? 'browserPanelWidth' : 'inspectorPanelWidth')}
      aria-orientation="vertical"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title={shellChromeText(lang, 'resizePanel')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" />
    </div>
  );
}

export function Shell({
  mode,
  experienceLevel = 'standard',
  titleBar,
  ribbon,
  workflow,
  domainWorkspace,
  left,
  right,
  viewport,
  bottomDrawer,
  statusBar,
  leftWidth = 280,
  rightWidth = 320,
  onCommandPick,
  userLicense = 'free',
  commandPaletteEnabled = true,
  viewportOnly = false,
  layoutStorageKey = 'precision-cad',
}: ShellProps) {
  const tabs = ribbon.tabs ?? MODE_DEFAULT_TABS[mode];
  const lang = titleBar.lang;
  const t = (key: Parameters<typeof shellChromeText>[1]) => shellChromeText(lang, key);

  // ⌘K command palette — registry-driven feature search.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const open = () => setPaletteOpen(true);
    window.addEventListener('nexyfab:open-command-palette', open);
    return () => window.removeEventListener('nexyfab:open-command-palette', open);
  }, []);
  // Persist frecency across the shell instance (not yet localStorage-backed).
  const frecency = useMemo(() => new FrecencyTracker(), []);
  const setPaletteFromShortcut = useCallback((open: boolean) => {
    if (commandPaletteEnabled) setPaletteOpen(open);
  }, [commandPaletteEnabled]);
  useCommandPaletteShortcut(setPaletteFromShortcut);
  const handleCommandPick = (id: string): void => {
    // Default: route the feature id through the ribbon's onTool handler
    // so the palette and ribbon share activation logic. Caller may
    // override via onCommandPick.
    if (onCommandPick) onCommandPick(id);
    else ribbon.onTool(id);
  };

  // Per-side collapse. When collapsed the aside shrinks to a 22-px rail
  // with a single toggle handle so the viewport reclaims that width;
  // contents inside the panel stay mounted (so internal state — selected
  // tab, scroll position — survives the toggle).
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const leftPanel = usePersistedPanelWidth(`nexyfab:studio-layout:${layoutStorageKey}:left`, leftWidth);
  const rightPanel = usePersistedPanelWidth(`nexyfab:studio-layout:${layoutStorageKey}:right`, rightWidth);
  // Keep the collapsed rail and its only control large enough for an exact
  // pointer/touch target. 28px also leaves the 24px handle a 2px inset.
  const COLLAPSED_W = 28;

  // Body class so legacy `.sg-topbar` etc. can be CSS-hidden when Modeling
  // chrome is eventually wrapped by Shell. Inert today (the CSS rule lives
  // in globals.css but no production element opts in yet).
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.add('sg-shell-v2');
    return () => {
      document.body.classList.remove('sg-shell-v2');
    };
  }, []);

  // FPS counter — averages frames over a 1s window and publishes to the
  // bridge so StatusBar's pill shows live performance.
  const setFps = useShellBridge(s => s.setFps);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round((frames * 1000) / (now - last)));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [setFps]);

  return (
    <div className="nx-app" data-viewport-only={viewportOnly || undefined}>
      {!viewportOnly && <TitleBar {...titleBar} />}
      {!viewportOnly && (domainWorkspace || workflow) && (
        <div className="nx-context-strip">
          {domainWorkspace}
          {workflow}
        </div>
      )}
      {!viewportOnly && (
        <ModeRibbon
          lang={lang}
          mode={mode}
          experienceLevel={experienceLevel}
          groups={ribbon.groups}
          tabs={tabs}
          activeTab={ribbon.activeTab}
          onTabChange={ribbon.onTabChange}
          onTool={ribbon.onTool}
          isActive={ribbon.isActive}
        />
      )}
      <div className="nx-body">
        {!viewportOnly && left && (
          <aside
            className="nx-panel"
            style={{
              width: leftCollapsed ? COLLAPSED_W : leftPanel.width,
              flex: `0 0 ${leftCollapsed ? COLLAPSED_W : leftPanel.width}px`,
              position: 'relative',
              overflow: 'visible',
              transition: 'width 0.15s ease, flex-basis 0.15s ease',
            }}
          >
            {/* Edge handle — sits flush to the inner edge so it stays clickable
                whether the panel is open or collapsed. */}
            <button
              type="button"
              onClick={() => setLeftCollapsed(v => !v)}
              aria-label={t(leftCollapsed ? 'expandLeftPanel' : 'collapseLeftPanel')}
              title={t(leftCollapsed ? 'expand' : 'collapse')}
              style={{
                position: 'absolute',
                top: 1,
                right: 2,
                width: 24, height: 24,
                border: '1px solid var(--nx-border)',
                background: 'var(--nx-panel-2)',
                color: 'var(--nx-text-2)',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 10,
                padding: 0,
                zIndex: 2,
              }}
            >
              {leftCollapsed ? '›' : '‹'}
            </button>
            {!leftCollapsed && (
              <PanelResizeHandle lang={lang} side="left" width={leftPanel.width} onChange={leftPanel.update} onReset={leftPanel.reset} />
            )}
            <div style={{ visibility: leftCollapsed ? 'hidden' : 'visible', height: '100%', overflow: 'hidden' }}>
              {left}
            </div>
          </aside>
        )}
        <div
          className="nx-viewport"
          style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0, minHeight: 0 }}
        >
          <div style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}>{viewport}</div>
          {!viewportOnly && bottomDrawer}
        </div>
        {!viewportOnly && right && (
          <aside
            className="nx-panel right"
            style={{
              width: rightCollapsed ? COLLAPSED_W : rightPanel.width,
              flex: `0 0 ${rightCollapsed ? COLLAPSED_W : rightPanel.width}px`,
              position: 'relative',
              overflow: 'visible',
              transition: 'width 0.15s ease, flex-basis 0.15s ease',
            }}
          >
            <button
              type="button"
              onClick={() => setRightCollapsed(v => !v)}
              aria-label={t(rightCollapsed ? 'expandRightPanel' : 'collapseRightPanel')}
              title={t(rightCollapsed ? 'expand' : 'collapse')}
              style={{
                position: 'absolute',
                top: 1,
                left: 2,
                width: 24, height: 24,
                border: '1px solid var(--nx-border)',
                background: 'var(--nx-panel-2)',
                color: 'var(--nx-text-2)',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 10,
                padding: 0,
                zIndex: 2,
              }}
            >
              {rightCollapsed ? '‹' : '›'}
            </button>
            {!rightCollapsed && (
              <PanelResizeHandle lang={lang} side="right" width={rightPanel.width} onChange={rightPanel.update} onReset={rightPanel.reset} />
            )}
            <div style={{ visibility: rightCollapsed ? 'hidden' : 'visible', height: '100%', overflow: 'hidden' }}>
              {right}
            </div>
          </aside>
        )}
      </div>
      {!viewportOnly && statusBar && <StatusBar {...statusBar} />}
      {!viewportOnly && commandPaletteEnabled && (
        <CommandPaletteShell
          lang={lang}
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onActivate={handleCommandPick}
          userTier={userLicense}
          frecency={frecency}
        />
      )}
    </div>
  );
}
