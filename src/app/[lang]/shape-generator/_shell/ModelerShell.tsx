'use client';

// ModelerShell — wraps the existing ShapeGeneratorInner with the new shell-v2
// chrome (TitleBar + Ribbon + StatusBar). Inner's own top toolbar (.sg-topbar
// / .sg-autohide) and bottom StatusBar are hidden via globals.css when
// body.sg-shell-v2 is on (Shell mounts add the class). Inner's panels
// (FeatureTree, viewport canvas, Inspector) keep rendering inside Shell's
// viewport slot so all real CAD behavior continues to work unchanged.
//
// Ribbon buttons are visual today; the existing CommandToolbar (now hidden)
// is still wired to handlers. Connecting Ribbon → CommandToolbar action ids
// is a follow-up PR.

import React, { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { WorkspaceLoading } from '../WorkspaceLoading';
import { useTheme } from '../ThemeContext';
import { Shell } from './Shell';
import type { ShellMode } from './ModeRibbons';

const ShapeGeneratorInner = dynamic(
  () => import('../ShapeGeneratorInner').then((m) => ({ default: m.ShapeGeneratorInner })),
  { ssr: false, loading: () => <WorkspaceLoading variant="app" /> },
);

interface ModelerShellProps {
  lang?: string;
}

export function ModelerShell({ lang = 'en' }: ModelerShellProps) {
  const { toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('solid');
  const [mode, setMode] = useState<ShellMode>('modeling');
  const [tool, setTool] = useState<string | null>(null);

  return (
    <Shell
      mode={mode}
      titleBar={{
        filename: 'Untitled.nxpart',
        savedAt: undefined,
        breadcrumbs: ['Projects', 'Untitled'],
        onShare: () => {},
        onPublish: toggleTheme,
        shareLabel: 'Share',
        publishLabel: '☼ / ☽',
      }}
      ribbon={{
        activeTab,
        onTabChange: id => {
          setActiveTab(id);
          if (id === 'drawing') setMode('drawing');
          else if (id === 'render') setMode('render');
          else if (id === 'assembly') setMode('assembly');
          else setMode('modeling');
        },
        onTool: id => setTool(id),
        isActive: id => tool === id,
      }}
      leftWidth={0}
      rightWidth={0}
      viewport={
        <Suspense fallback={<WorkspaceLoading variant="app" />}>
          <ShapeGeneratorInner />
        </Suspense>
      }
      statusBar={{
        left: [{ id: 'mode', items: [mode] }],
        pills: [{ id: 'shell', label: 'shell v2' }],
      }}
    />
  );
}
