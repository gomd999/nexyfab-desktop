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
import { useRouter } from 'next/navigation';
import { WorkspaceLoading } from '../WorkspaceLoading';
import { useLang } from '../hooks/useLang';
import { useTheme } from '../ThemeContext';
import { Shell } from './Shell';
import { I } from './Icons';
import { useShellBridge } from './shellBridgeStore';
import { ViewportChips } from './ViewportChips';
import { SelectionBubble } from './SelectionBubble';
import type { ShellMode } from './ModeRibbons';

// Best-effort keyboard event dispatch so Shell's TitleBar buttons reach Inner's
// existing keyboard shortcut handlers (Inner registers global Ctrl+Z / ⌘K /
// etc. listeners). Avoids deep refactor of Inner to expose imperative APIs.
function dispatchKey(opts: { key: string; code: string; ctrl?: boolean; shift?: boolean; meta?: boolean }) {
  if (typeof document === 'undefined') return;
  const target = (document.activeElement as HTMLElement) ?? document.body;
  const evt = new KeyboardEvent('keydown', {
    key: opts.key,
    code: opts.code,
    ctrlKey: opts.ctrl ?? false,
    metaKey: opts.meta ?? false,
    shiftKey: opts.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(evt);
}

function dispatchCmdPalette() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nexyfab:open-command-palette'));
}

// Bridges Shell's ribbon tool clicks into the existing Inner command stack.
// Inner listens for 'nexyfab:tool' (see ShapeGeneratorInner.tsx) and maps the
// tool id to handleAddFeatureCmd / setIsSketchMode / setSketchTool.
function dispatchTool(id: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('nexyfab:tool', { detail: { id } }));
}

// "30s ago" / "방금" style — keep tiny so the TitleBar savedAt label stays compact.
function formatRelative(ms: number, isKo: boolean): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 5) return isKo ? '방금' : 'just now';
  if (s < 60) return isKo ? `${s}초 전` : `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return isKo ? `${m}분 전` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return isKo ? `${h}시간 전` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return isKo ? `${d}일 전` : `${d}d ago`;
}

const ShapeGeneratorInner = dynamic(
  () => import('../ShapeGeneratorInner').then((m) => ({ default: m.ShapeGeneratorInner })),
  { ssr: false, loading: () => <WorkspaceLoading variant="app" /> },
);

export function ModelerShell() {
  const router = useRouter();
  const lang = useLang();
  const { mode: themeMode, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState('solid');
  const [mode, setMode] = useState<ShellMode>('modeling');
  const [tool, setTool] = useState<string | null>(null);

  const isKo = lang === 'ko';
  const langSeg = lang === 'ko' ? 'kr' : lang;

  // Pull live status from Inner via the bridge store.
  const bridgeEditMode = useShellBridge(s => s.editMode);
  const bridgeUnits = useShellBridge(s => s.unitSystem);
  const bridgeView = useShellBridge(s => s.viewLabel);
  const bridgeFeatureCount = useShellBridge(s => s.featureCount);
  const bridgeVolume = useShellBridge(s => s.volume);
  const bridgeTriangleCount = useShellBridge(s => s.triangleCount);
  const bridgeSelectedLabel = useShellBridge(s => s.selectedLabel);
  const bridgeFps = useShellBridge(s => s.fps);
  const bridgeCloudStatus = useShellBridge(s => s.cloudStatus);
  const bridgeCloudSavedAt = useShellBridge(s => s.cloudSavedAt);
  const bridgeAutosaveSavedAt = useShellBridge(s => s.autosaveSavedAt);
  const bridgeSketchSolverOk = useShellBridge(s => s.sketchSolverOk);
  const bridgeSketchDof = useShellBridge(s => s.sketchDof);

  // Mode chip & hint reflect Inner's actual edit mode.
  const modeChip =
    bridgeEditMode === 'sketch'
      ? (isKo ? '스케치 모드' : 'SKETCH MODE')
      : bridgeEditMode === 'assembly'
        ? (isKo ? '어셈블리 모드' : 'ASSEMBLY MODE')
        : undefined;
  // Sketch solver indicator — mockup #15 shows "Fully constrained · DOF 0".
  const sketchSolverLabel =
    bridgeEditMode === 'sketch' && bridgeSketchSolverOk !== null
      ? bridgeSketchSolverOk
        ? (isKo ? `완전 정의 · DOF ${bridgeSketchDof ?? 0}` : `Fully constrained · DOF ${bridgeSketchDof ?? 0}`)
        : (isKo ? `미정의 · DOF ${bridgeSketchDof ?? '?'}` : `Under-defined · DOF ${bridgeSketchDof ?? '?'}`)
      : undefined;

  const modeHint =
    bridgeEditMode === 'sketch'
      ? sketchSolverLabel ?? (isKo ? 'S 키로 나가기' : 'Press S to exit')
      : bridgeEditMode === 'assembly'
        ? (isKo ? 'A 키로 나가기' : 'Press A to exit')
        : undefined;

  // Saved-at label for TitleBar.
  const savedAtMs = bridgeCloudSavedAt ?? bridgeAutosaveSavedAt;
  const savedAtLabel =
    bridgeCloudStatus === 'saving'
      ? (isKo ? '저장 중…' : 'Saving…')
      : bridgeCloudStatus === 'error'
        ? (isKo ? '저장 오류' : 'Save error')
        : bridgeCloudStatus === 'conflict'
          ? (isKo ? '버전 충돌' : 'Version conflict')
          : savedAtMs
            ? (isKo ? `${formatRelative(savedAtMs, isKo)} 저장됨` : `Saved · ${formatRelative(savedAtMs, isKo)}`)
            : (isKo ? '자동 저장 대기' : 'Auto-save ready');

  // Status pills
  const statusPills: { id: string; label: string; tone?: 'ok' | 'warn' | 'error' }[] = [];
  if (bridgeVolume !== null) {
    statusPills.push({ id: 'vol', label: `${bridgeVolume.toFixed(1)} cm³` });
  }
  if (bridgeTriangleCount > 0) {
    statusPills.push({ id: 'tri', label: `${Math.round(bridgeTriangleCount).toLocaleString()} tri` });
  }
  if (bridgeFps > 0) {
    statusPills.push({
      id: 'fps',
      label: `${bridgeFps} fps`,
      tone: bridgeFps >= 30 ? 'ok' : bridgeFps >= 15 ? 'warn' : 'error',
    });
  }
  const cloudPill =
    bridgeCloudStatus === 'saved'
      ? { id: 'cloud', label: isKo ? '동기화됨' : 'Synced', tone: 'ok' as const }
      : bridgeCloudStatus === 'saving'
        ? { id: 'cloud', label: isKo ? '저장 중' : 'Saving' }
        : bridgeCloudStatus === 'error'
          ? { id: 'cloud', label: isKo ? '오류' : 'Error', tone: 'error' as const }
          : null;
  if (cloudPill) statusPills.push(cloudPill);

  return (
    <Shell
      mode={mode}
      titleBar={{
        filename: bridgeSelectedLabel
          ? `${bridgeSelectedLabel}.nxpart`
          : (isKo ? '무제.nxpart' : 'Untitled.nxpart'),
        savedAt: savedAtLabel,
        breadcrumbs: ['Projects', bridgeSelectedLabel ?? (isKo ? '무제' : 'Untitled')],
        mode: modeChip,
        modeHint,
        onExitMode: modeChip
          ? () => {
              if (bridgeEditMode === 'sketch') {
                window.dispatchEvent(new CustomEvent('nexyfab:tool', { detail: { id: 'sketch.finish' } }));
              } else if (bridgeEditMode === 'assembly') {
                // Toggle assembly panel via uiStore — fall back to no-op if listener not registered.
                window.dispatchEvent(new CustomEvent('nexyfab:assembly-close'));
              }
            }
          : undefined,
        avatars: [],
        canUndo: true,
        canRedo: true,
        onNew: () => router.push(`/${langSeg}/nexyfab/hub`),
        onOpen: () => router.push(`/${langSeg}/nexyfab/projects`),
        onSave: () => {
          // Inner runs autosave on a 30s debounce + saves on Ctrl+S.
          dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true });
        },
        onUndo: () => dispatchKey({ key: 'z', code: 'KeyZ', ctrl: true, meta: true }),
        onRedo: () => dispatchKey({ key: 'z', code: 'KeyZ', ctrl: true, meta: true, shift: true }),
        onSearch: dispatchCmdPalette,
        onShare: () => router.push(`/${langSeg}/nexyfab/projects`),
        shareLabel: isKo ? '공유' : 'Share',
        onPublish: () => {
          // Publish = persist current state and toast. Inner handles via Ctrl+S.
          dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true });
        },
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
          // Drawing / Render tabs route to their standalone surfaces. Other
          // tabs keep the user in the modeler and just swap ribbon visuals.
          if (id === 'drawing') {
            router.push(`/${langSeg}/shape-generator/drawing`);
            return;
          }
          if (id === 'render') {
            router.push(`/${langSeg}/shape-generator/render`);
            return;
          }
          if (id === 'assembly') {
            setMode('assembly');
            // Open Inner's assembly browser so the Mate / BOM controls
            // become reachable. Routed through the same window event Inner
            // listens for, so we don't depend on imports of Inner state.
            dispatchTool('asm.insert');
            return;
          }
          setMode('modeling');
        },
        onTool: id => {
          setTool(id);
          dispatchTool(id);
        },
        isActive: id => tool === id,
      }}
      leftWidth={0}
      rightWidth={0}
      viewport={
        <Suspense fallback={<WorkspaceLoading variant="app" />}>
          <ShapeGeneratorInner />
          <ViewportChips isKo={isKo} />
          <SelectionBubble isKo={isKo} />
        </Suspense>
      }
      statusBar={{
        left: [
          {
            id: 'units',
            items: [
              `${bridgeUnits} · g · MPa`,
              bridgeFeatureCount > 0
                ? (isKo ? `${bridgeFeatureCount}개 피처` : `${bridgeFeatureCount} feat`)
                : '',
            ].filter(Boolean),
          },
          { id: 'view', items: [bridgeView] },
        ],
        pills: statusPills,
      }}
    />
  );
}
