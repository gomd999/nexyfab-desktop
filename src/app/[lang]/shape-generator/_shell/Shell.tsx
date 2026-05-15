'use client';

// Top-level shell-v2 layout. Composes TitleBar + Ribbon + body (left/viewport/right) + StatusBar.
// All zones accept ReactNode children so callers can inject existing production components
// (FeatureTree, RightPanel tabs, CommandToolbar handlers, etc.) without refactoring them.

import { useEffect, type ReactNode } from 'react';
import { TitleBar, type TitleBarProps } from './TitleBar';
import { ModeRibbon, MODE_DEFAULT_TABS, type ShellMode, type RibbonHandler, type RibbonActiveCheck } from './ModeRibbons';
import { StatusBar, type StatusBarProps } from './StatusBar';
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
        <div className="nx-viewport">{viewport}</div>
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
