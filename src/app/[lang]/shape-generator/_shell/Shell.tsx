'use client';

// Top-level shell-v2 layout. Composes TitleBar + Ribbon + body (left/viewport/right) + StatusBar.
// All zones accept ReactNode children so callers can inject existing production components
// (FeatureTree, RightPanel tabs, CommandToolbar handlers, etc.) without refactoring them.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { TitleBar, type TitleBarProps } from './TitleBar';
import { ModeRibbon, MODE_DEFAULT_TABS, type ShellMode, type RibbonHandler, type RibbonActiveCheck } from './ModeRibbons';
import { StatusBar, type StatusBarProps } from './StatusBar';
import { useShellBridge } from './shellBridgeStore';
import type { RibbonTabDef } from './Ribbon';
import { CommandPaletteShell, useCommandPaletteShortcut } from '../featureCatalog/CommandPaletteShell';
import { FrecencyTracker } from '../featureCatalog/commandPalette';
import type { FeatureLicense } from '../featureCatalog/registry';

export interface ShellProps {
  mode: ShellMode;
  titleBar: TitleBarProps;
  ribbon: {
    tabs?: RibbonTabDef[];
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
}

export function Shell({
  mode,
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
}: ShellProps) {
  const tabs = ribbon.tabs ?? MODE_DEFAULT_TABS[mode];

  // ⌘K command palette — registry-driven feature search.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Persist frecency across the shell instance (not yet localStorage-backed).
  const frecency = useMemo(() => new FrecencyTracker(), []);
  useCommandPaletteShortcut(setPaletteOpen);
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
  const COLLAPSED_W = 22;

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
    <div className="nx-app">
      <TitleBar {...titleBar} />
      {domainWorkspace}
      {workflow}
      <ModeRibbon
        mode={mode}
        tabs={tabs}
        activeTab={ribbon.activeTab}
        onTabChange={ribbon.onTabChange}
        onTool={ribbon.onTool}
        isActive={ribbon.isActive}
      />
      <div className="nx-body">
        {left && (
          <aside
            className="nx-panel"
            style={{
              width: leftCollapsed ? COLLAPSED_W : leftWidth,
              flex: `0 0 ${leftCollapsed ? COLLAPSED_W : leftWidth}px`,
              position: 'relative',
              overflow: 'hidden',
              transition: 'width 0.15s ease, flex-basis 0.15s ease',
            }}
          >
            {/* Edge handle — sits flush to the inner edge so it stays clickable
                whether the panel is open or collapsed. */}
            <button
              type="button"
              onClick={() => setLeftCollapsed(v => !v)}
              aria-label={leftCollapsed ? 'Expand left panel' : 'Collapse left panel'}
              title={leftCollapsed ? 'Expand' : 'Collapse'}
              style={{
                position: 'absolute',
                top: 6,
                right: 2,
                width: 16, height: 24,
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
            <div style={{ visibility: leftCollapsed ? 'hidden' : 'visible', height: '100%' }}>
              {left}
            </div>
          </aside>
        )}
        <div
          className="nx-viewport"
          style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0, minHeight: 0 }}
        >
          <div style={{ flex: '1 1 auto', position: 'relative', minHeight: 0 }}>{viewport}</div>
          {bottomDrawer}
        </div>
        {right && (
          <aside
            className="nx-panel right"
            style={{
              width: rightCollapsed ? COLLAPSED_W : rightWidth,
              flex: `0 0 ${rightCollapsed ? COLLAPSED_W : rightWidth}px`,
              position: 'relative',
              overflow: 'hidden',
              transition: 'width 0.15s ease, flex-basis 0.15s ease',
            }}
          >
            <button
              type="button"
              onClick={() => setRightCollapsed(v => !v)}
              aria-label={rightCollapsed ? 'Expand right panel' : 'Collapse right panel'}
              title={rightCollapsed ? 'Expand' : 'Collapse'}
              style={{
                position: 'absolute',
                top: 6,
                left: 2,
                width: 16, height: 24,
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
            <div style={{ visibility: rightCollapsed ? 'hidden' : 'visible', height: '100%' }}>
              {right}
            </div>
          </aside>
        )}
      </div>
      {statusBar && <StatusBar {...statusBar} />}
      <CommandPaletteShell
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onActivate={handleCommandPick}
        userTier={userLicense}
        frecency={frecency}
      />
    </div>
  );
}
