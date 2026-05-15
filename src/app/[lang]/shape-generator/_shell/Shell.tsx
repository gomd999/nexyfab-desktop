'use client';

// Top-level shell-v2 layout. Composes TitleBar + Ribbon + body (left/viewport/right) + StatusBar.
// All zones accept ReactNode children so callers can inject existing production components
// (FeatureTree, RightPanel tabs, CommandToolbar handlers, etc.) without refactoring them.

import { useEffect, type ReactNode } from 'react';
import { TitleBar, type TitleBarProps } from './TitleBar';
import { ModeRibbon, MODE_DEFAULT_TABS, type ShellMode, type RibbonHandler, type RibbonActiveCheck } from './ModeRibbons';
import { StatusBar, type StatusBarProps } from './StatusBar';
import { useShellBridge } from './shellBridgeStore';
import type { RibbonTabDef } from './Ribbon';

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
  left?: ReactNode;
  right?: ReactNode;
  viewport: ReactNode;
  /** Optional bottom drawer (DFM/FEA/Cost/Variants). Renders below viewport. */
  bottomDrawer?: ReactNode;
  statusBar?: StatusBarProps;
  leftWidth?: number;
  rightWidth?: number;
}

export function Shell({
  mode,
  titleBar,
  ribbon,
  left,
  right,
  viewport,
  bottomDrawer,
  statusBar,
  leftWidth = 280,
  rightWidth = 320,
}: ShellProps) {
  const tabs = ribbon.tabs ?? MODE_DEFAULT_TABS[mode];

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
          <aside className="nx-panel" style={{ width: leftWidth, flex: `0 0 ${leftWidth}px` }}>
            {left}
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
          <aside className="nx-panel right" style={{ width: rightWidth, flex: `0 0 ${rightWidth}px` }}>
            {right}
          </aside>
        )}
      </div>
      {statusBar && <StatusBar {...statusBar} />}
    </div>
  );
}
