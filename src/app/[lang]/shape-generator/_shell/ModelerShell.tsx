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

import React, { Suspense, useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { WorkspaceLoading } from '../WorkspaceLoading';
import { useLang } from '../hooks/useLang';
import { useTheme } from '../ThemeContext';
import { useAuthStore } from '@/hooks/useAuth';
import { useCollabPolling } from '@/hooks/useCollabPolling';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useSearchParams } from 'next/navigation';
import { Shell } from './Shell';
import { I } from './Icons';
import { useShellBridge } from './shellBridgeStore';
import { ViewportChips } from './ViewportChips';
import { SelectionBubble } from './SelectionBubble';
import { SolverInfoChip } from './SolverInfoChip';
import { FileMenu, type FileMenuItem } from './FileMenu';
import type { ShellMode } from './ModeRibbons';
import { ModelerLeftPane } from './sidebars/ModelerLeftPane';
import { ModelerRightPane } from './sidebars/ModelerRightPane';
import { SketchLeftPane } from './sidebars/SketchLeftPane';
import { SketchRightPane } from './sidebars/SketchRightPane';
import { AssemblyLeftPane } from './sidebars/AssemblyLeftPane';
import { AssemblyRightPane } from './sidebars/AssemblyRightPane';
import { BottomDrawer } from './BottomDrawer';

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
  const user = useAuthStore(s => s.user);
  const [activeTab, setActiveTab] = useState('solid');
  const [mode, setMode] = useState<ShellMode>('modeling');
  const [tool, setTool] = useState<string | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);

  const isKo = lang === 'ko';
  const langSeg = lang === 'ko' ? 'kr' : lang;
  const isMobile = useIsMobile();
  // Bottom drawer — surfaces DFM/FEA/Cost/Variants via custom event from
  // ModelerRightPane Inspector ANALYZE rows.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'dfm' | 'fea' | 'cost' | 'variants'>('dfm');
  useEffect(() => {
    const onAnalyzeOpen = (e: Event) => {
      const ce = e as CustomEvent<{ drawer: 'dfm' | 'fea' | 'cost' | 'variants' }>;
      if (ce.detail?.drawer) {
        setDrawerTab(ce.detail.drawer);
        setDrawerOpen(true);
      }
    };
    window.addEventListener('nexyfab:analyze-open', onAnalyzeOpen);
    return () => window.removeEventListener('nexyfab:analyze-open', onAnalyzeOpen);
  }, []);
  // Toggle a body attribute so shell-v2 CSS can scale hit targets and
  // collapse rails on touch-primary devices.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isMobile) document.body.setAttribute('data-mobile', '1');
    else document.body.removeAttribute('data-mobile');
    return () => { document.body.removeAttribute('data-mobile'); };
  }, [isMobile]);

  const fileMenuItems: FileMenuItem[] = [
    {
      id: 'new',
      label: isKo ? '새 디자인' : 'New Design',
      shortcut: '⌘N',
      onClick: () => router.push(`/${langSeg}/nexyfab/hub`),
    },
    {
      id: 'open',
      label: isKo ? '열기…' : 'Open…',
      shortcut: '⌘O',
      onClick: () => router.push(`/${langSeg}/nexyfab/projects`),
    },
    {
      id: 'save',
      label: isKo ? '저장' : 'Save',
      shortcut: '⌘S',
      onClick: () => dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true }),
    },
    {
      id: 'saveas',
      label: isKo ? '다른 이름으로 저장' : 'Save As…',
      shortcut: '⇧⌘S',
      onClick: () => dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true, shift: true }),
    },
    { id: 'div1', label: '', divider: true },
    {
      id: 'import',
      label: isKo ? 'STEP/IGES 가져오기…' : 'Import STEP/IGES…',
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:file-import'));
        }
      },
    },
    {
      id: 'export-stl',
      label: isKo ? 'STL 내보내기' : 'Export STL',
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:file-export', { detail: { format: 'stl' } }));
        }
      },
    },
    {
      id: 'export-step',
      label: isKo ? 'STEP 내보내기' : 'Export STEP',
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:file-export', { detail: { format: 'step' } }));
        }
      },
    },
    { id: 'div2', label: '', divider: true },
    {
      id: 'projects',
      label: isKo ? '프로젝트 목록' : 'All Projects',
      onClick: () => router.push(`/${langSeg}/nexyfab/projects`),
    },
    {
      id: 'hub',
      label: isKo ? '허브로' : 'Back to Hub',
      onClick: () => router.push(`/${langSeg}/nexyfab/hub`),
    },
  ];

  // Avatars: current user + any remote collab sessions polling on the
  // same project. Deterministic chip color from email hash.
  const userInitials = (user?.name ?? user?.email ?? '?').slice(0, 2).toUpperCase();
  const userColor = (() => {
    const seed = user?.email ?? 'guest';
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    const palette = ['#22e0c8', '#5e9eff', '#ff9b3d', '#a87bff', '#ffd24d', '#ff6b9b'];
    return palette[Math.abs(h) % palette.length];
  })();
  const sp = useSearchParams();
  const projectId = sp?.get('project') ?? null;
  const { sessions, mySessionId } = useCollabPolling(projectId, Boolean(user && projectId));
  const remoteAvatars = sessions
    .filter(s => s.sessionId !== mySessionId)
    .slice(0, 3)
    .map(s => ({
      initials: (s.userName || '?').slice(0, 2).toUpperCase(),
      color: s.color || '#5e9eff',
    }));
  const avatars = user
    ? [{ initials: userInitials, color: userColor }, ...remoteAvatars]
    : [];

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

  // Sync shell mode + active sketch tab to Inner's sketch state. When the
  // user toggles sketch mode in Inner, the shell ribbon switches to the
  // sketch tabs (Draw/Constrain/Finish); when they exit, we pop back to
  // 'solid'. Guard against echoing user clicks by only changing tab when
  // the current tab is for the wrong mode.
  useEffect(() => {
    if (bridgeEditMode === 'sketch') {
      setMode('sketch');
      if (!activeTab.startsWith('sketch.')) setActiveTab('sketch.draw');
    } else if (bridgeEditMode === 'assembly') {
      setMode('assembly');
    } else {
      // Exit sketch — pop back to the Solid tab in modeling mode.
      if (activeTab.startsWith('sketch.')) {
        setMode('modeling');
        setActiveTab('solid');
      }
    }
  }, [bridgeEditMode, activeTab]);

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
        avatars,
        canUndo: true,
        canRedo: true,
        onNew: () => setFileMenuOpen(v => !v),
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
          // Sketch sub-tabs (Draw / Constrain / Finish) stay in sketch mode.
          if (id.startsWith('sketch.')) {
            setMode('sketch');
            return;
          }
          // Drawing / Render tabs route to their standalone surfaces.
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
          // N10: Inspect → enter measure mode (most common Inspect first action).
          if (id === 'inspect') {
            dispatchTool('measure');
            setMode('modeling');
            return;
          }
          // N11: View → cycle through camera presets via custom event.
          // ShapePreview listens for `nexyfab:camera-preset` and dispatches its
          // own dispatchView() for top/front/right/iso/fit.
          if (id === 'view') {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('nexyfab:camera-preset', { detail: { preset: 'iso' } }));
            }
            setMode('modeling');
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
      leftWidth={280}
      rightWidth={320}
      left={
        mode === 'sketch' ? <SketchLeftPane isKo={isKo} />
        : mode === 'assembly' ? <AssemblyLeftPane isKo={isKo} />
        : <ModelerLeftPane isKo={isKo} />
      }
      right={
        mode === 'sketch' ? <SketchRightPane isKo={isKo} />
        : mode === 'assembly' ? <AssemblyRightPane isKo={isKo} />
        : <ModelerRightPane isKo={isKo} />
      }
      viewport={
        <Suspense fallback={<WorkspaceLoading variant="app" />}>
          <ShapeGeneratorInner />
          <ViewportChips isKo={isKo} />
          <SelectionBubble isKo={isKo} />
          <SolverInfoChip isKo={isKo} />
          <FileMenu
            open={fileMenuOpen}
            onClose={() => setFileMenuOpen(false)}
            items={fileMenuItems}
          />
        </Suspense>
      }
      bottomDrawer={
        <BottomDrawer
          open={drawerOpen}
          activeTab={drawerTab}
          tabs={[
            { id: 'dfm', label: isKo ? 'DFM' : 'DFM' },
            { id: 'fea', label: isKo ? 'FEA' : 'FEA' },
            { id: 'cost', label: isKo ? '비용' : 'Cost' },
            { id: 'variants', label: isKo ? '변형' : 'Variants' },
          ]}
          onTabChange={(id) => setDrawerTab(id as typeof drawerTab)}
          onClose={() => setDrawerOpen(false)}
        >
          <DrawerContent tab={drawerTab} isKo={isKo} />
        </BottomDrawer>
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

// ─── Drawer content — minimal scaffold; real DFM/FEA/Cost/Variants panels
//      will be loaded via dynamic import as a follow-up so they stay outside
//      the modeler's main bundle.
function DrawerContent({ tab, isKo }: { tab: 'dfm' | 'fea' | 'cost' | 'variants'; isKo: boolean }) {
  const labels: Record<typeof tab, { en: string; ko: string }> = {
    dfm: { en: 'Design for Manufacturing — undercut / draft / thin-wall checks', ko: '제조성 분석 — 언더컷 / 드래프트 / 박벽 검사' },
    fea: { en: 'Finite Element Analysis — static stress under chosen load', ko: '유한요소해석 — 정적 응력 분포' },
    cost: { en: 'Cost estimate — material + machining + finishing', ko: '비용 예상 — 재료 + 가공 + 후처리' },
    variants: { en: 'Design variants — explore size / material / feature alternatives', ko: '설계 변형 — 크기 / 재료 / 피처 대안 탐색' },
  };
  const l = labels[tab];
  return (
    <div style={{ fontSize: 12, color: 'var(--nx-text)' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{isKo ? l.ko : l.en}</div>
      <p style={{ color: 'var(--nx-text-2)', lineHeight: 1.5 }}>
        {isKo
          ? '기존 패널 컴포넌트는 후속 단계에서 dynamic import 로 이 자리에 마운트됩니다.'
          : 'Existing panel components will be mounted here via dynamic import in the next phase.'}
      </p>
    </div>
  );
}
