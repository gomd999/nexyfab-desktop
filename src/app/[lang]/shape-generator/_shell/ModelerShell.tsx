'use client';

// ModelerShell — wraps the existing ShapeGeneratorInner with the new shell-v2
// chrome (TitleBar + Ribbon + StatusBar). Inner's legacy chrome bars (top
// ShapeGeneratorToolbar, DesignFunnelBar, CommandToolbar, PdmMetaWorkspaceStrip,
// StatusBar) are hidden via globals.css when `body.sg-shell-v2` is on. Inner's
// panels (FeatureTree, viewport canvas, Inspector) keep rendering inside
// Shell's viewport slot so all real CAD behavior continues to work unchanged.
//
// Ribbon buttons are visual today; the existing CommandToolbar (now hidden)
// is still wired to handlers. Connecting Ribbon → CommandToolbar action ids
// is a follow-up PR.

import React, { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { WorkspaceLoading } from '../WorkspaceLoading';
import { useTheme } from '../ThemeContext';
import { Shell } from './Shell';
import { I } from './Icons';
import type { ShellMode } from './ModeRibbons';

const ShapeGeneratorInner = dynamic(
  () => import('../ShapeGeneratorInner').then((m) => ({ default: m.ShapeGeneratorInner })),
  { ssr: false, loading: () => <WorkspaceLoading variant="app" /> },
);

interface ModelerShellProps {
  lang?: string;
}

export function ModelerShell({ lang = 'en' }: ModelerShellProps) {
  const { mode: themeMode, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('solid');
  const [mode, setMode] = useState<ShellMode>('modeling');
  const [tool, setTool] = useState<string | null>(null);

  const isKo = lang === 'kr' || lang === 'ko';

  return (
    <Shell
      mode={mode}
      titleBar={{
        filename: isKo ? '무제.nxpart' : 'Untitled.nxpart',
        savedAt: isKo ? '자동 저장됨' : 'Auto-saved',
        breadcrumbs: ['Projects', isKo ? '무제' : 'Untitled'],
        avatars: [],
        canUndo: true,
        canRedo: false,
        onShare: () => {},
        shareLabel: isKo ? '공유' : 'Share',
        onPublish: () => {},
        publishLabel: isKo ? '게시' : 'Publish',
        rightExtras: (
          <button
            type="button"
            className="nx-pillbtn"
            style={{ height: 24, padding: '0 8px' }}
            onClick={toggleTheme}
            title={isKo ? '테마 전환' : 'Toggle theme'}
            aria-label={isKo ? '테마 전환' : 'Toggle theme'}
          >
            {themeMode === 'dark' ? <I.sun size={12} /> : <I.moon size={12} />}
          </button>
        ),
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
