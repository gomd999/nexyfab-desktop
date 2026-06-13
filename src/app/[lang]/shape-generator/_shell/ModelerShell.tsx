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
import { useCommandHistory } from '../history/useCommandHistory';
import { sketchStatusLabel } from './sketchStatusUi';
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
import { MotionStudyPanel } from './MotionStudyPanel';
import { OnboardingTutorial } from './OnboardingTutorial';
import { VersionTreePanel } from './VersionTreePanel';
import { EmailVerifyBanner } from './EmailVerifyBanner';
import { AccountTypeCard } from './AccountTypeCard';
import { GuestExpiryBanner } from './GuestExpiryBanner';
import { ShareProjectModal } from './ShareProjectModal';
import AuthModal from '@/components/nexyfab/AuthModal';
import { useAnalysisStore } from '../store/analysisStore';
import { useTouchGestures } from './useTouchGestures';
import { fmtShell, pickShellDict, type ShellDict } from './shellDict';

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
function formatRelative(ms: number, d: ShellDict): string {
  const diff = Math.max(0, Date.now() - ms);
  const s = Math.floor(diff / 1000);
  if (s < 5) return d.tJustNow;
  if (s < 60) return fmtShell(d.tSecondsAgo, { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return fmtShell(d.tMinutesAgo, { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return fmtShell(d.tHoursAgo, { n: h });
  const days = Math.floor(h / 24);
  return fmtShell(d.tDaysAgo, { n: days });
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
  const [showShareModal, setShowShareModal] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);

  const d = pickShellDict(lang);
  // Deferred sub-panels (Onboarding/EmailVerify/AccountType/Motion/Versions)
  // are still ko/en-binary — keep isKo for them only.
  const isKo = lang === 'ko';
  const langSeg = lang === 'ko' ? 'kr' : lang;
  const isMobile = useIsMobile();
  // Touch gestures (pinch/pan/orbit/long-press) — enabled only on touch-
  // primary devices to avoid double-firing with the desktop mouse path.
  useTouchGestures({ enabled: isMobile });
  // Guest-mode signup gate — listens for any `requireSignup` dispatched by
  // shell components (PDF export, DXF export, share link, AI quota) and
  // pops the AuthModal so the user can sign up without leaving the modeler.
  const [signupModalOpen, setSignupModalOpen] = useState(false);
  const [signupReason, setSignupReason] = useState<string>('');
  useEffect(() => {
    const onRequire = (e: Event) => {
      const ce = e as CustomEvent<{ feature?: string }>;
      setSignupReason(ce.detail?.feature ?? '');
      setSignupModalOpen(true);
    };
    window.addEventListener('nexyfab:require-signup', onRequire);
    return () => window.removeEventListener('nexyfab:require-signup', onRequire);
  }, []);
  // Bottom drawer — surfaces DFM/FEA/Cost/Variants via custom event from
  // ModelerRightPane Inspector ANALYZE rows.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'dfm' | 'fea' | 'cost' | 'variants' | 'motion' | 'versions'>('dfm');
  useEffect(() => {
    const onAnalyzeOpen = (e: Event) => {
      const ce = e as CustomEvent<{ drawer: 'dfm' | 'fea' | 'cost' | 'variants' | 'motion' | 'versions' }>;
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
      label: d.fmNewDesign,
      shortcut: '⌘N',
      onClick: () => router.push(`/${langSeg}/nexyfab/hub`),
    },
    {
      id: 'open',
      label: d.fmOpen,
      shortcut: '⌘O',
      onClick: () => router.push(`/${langSeg}/nexyfab/projects`),
    },
    {
      id: 'save',
      label: d.fmSave,
      shortcut: '⌘S',
      onClick: () => dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true }),
    },
    {
      id: 'saveas',
      label: d.fmSaveAs,
      shortcut: '⇧⌘S',
      onClick: () => dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true, shift: true }),
    },
    { id: 'div1', label: '', divider: true },
    {
      id: 'import',
      label: d.fmImport,
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:file-import'));
        }
      },
    },
    {
      id: 'export-stl',
      label: d.fmExportStl,
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:file-export', { detail: { format: 'stl' } }));
        }
      },
    },
    {
      id: 'export-step',
      label: d.fmExportStep,
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:file-export', { detail: { format: 'step' } }));
        }
      },
    },
    { id: 'div2', label: '', divider: true },
    {
      id: 'projects',
      label: d.fmAllProjects,
      onClick: () => router.push(`/${langSeg}/nexyfab/projects`),
    },
    {
      id: 'hub',
      label: d.fmBackToHub,
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

  // Undo/redo button state — read straight from the commandHistory singleton
  // (shared module instance with Inner; useSyncExternalStore keeps it live).
  // Undo Phase B: replaces the previous hardcoded `canUndo: true`.
  const { canUndo, canRedo } = useCommandHistory();

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
  const bridgeSketchStatus = useShellBridge(s => s.sketchStatus);
  const bridgeSketchDof = useShellBridge(s => s.sketchDof);
  const bridgeSketchRedundant = useShellBridge(s => s.sketchRedundantCount);

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
      ? d.modeSketch
      : bridgeEditMode === 'assembly'
        ? d.modeAssembly
        : undefined;
  // Sketch solver indicator — SolidWorks-style 3-state: under-constrained /
  // fully constrained / over-defined-or-conflicting. Empty sketch → no pill.
  const sketchSolverLabel =
    bridgeEditMode === 'sketch'
      ? sketchStatusLabel(bridgeSketchStatus, bridgeSketchDof, bridgeSketchRedundant, d) ?? undefined
      : undefined;

  const modeHint =
    bridgeEditMode === 'sketch'
      ? sketchSolverLabel ?? d.exitSketchHint
      : bridgeEditMode === 'assembly'
        ? d.exitAssemblyHint
        : undefined;

  // Saved-at label for TitleBar.
  const savedAtMs = bridgeCloudSavedAt ?? bridgeAutosaveSavedAt;
  const savedAtLabel =
    bridgeCloudStatus === 'saving'
      ? d.saving
      : bridgeCloudStatus === 'error'
        ? d.saveError
        : bridgeCloudStatus === 'conflict'
          ? d.versionConflict
          : savedAtMs
            ? fmtShell(d.savedAgo, { t: formatRelative(savedAtMs, d) })
            : d.autosaveReady;

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
      ? { id: 'cloud', label: d.pillSynced, tone: 'ok' as const }
      : bridgeCloudStatus === 'saving'
        ? { id: 'cloud', label: d.pillSaving }
        : bridgeCloudStatus === 'error'
          ? { id: 'cloud', label: d.pillError, tone: 'error' as const }
          : null;
  if (cloudPill) statusPills.push(cloudPill);

  return (
    <Shell
      mode={mode}
      titleBar={{
        filename: bridgeSelectedLabel
          ? `${bridgeSelectedLabel}.nxpart`
          : d.untitledFile,
        savedAt: savedAtLabel,
        breadcrumbs: ['Projects', bridgeSelectedLabel ?? d.untitled],
        onBrandClick: () => router.push(`/${langSeg}/nexyfab/hub`),
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
        // In sketch mode the Ctrl+Z we dispatch is consumed by the sketch
        // session's own stack (not commandHistory), whose depth isn't exposed
        // reactively — keep the buttons enabled there rather than lying.
        canUndo: bridgeEditMode === 'sketch' ? true : canUndo,
        canRedo: bridgeEditMode === 'sketch' ? true : canRedo,
        onNew: () => setFileMenuOpen(v => !v),
        onOpen: () => router.push(`/${langSeg}/nexyfab/projects`),
        onSave: () => {
          // Inner runs autosave on a 30s debounce + saves on Ctrl+S.
          dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true });
        },
        onUndo: () => dispatchKey({ key: 'z', code: 'KeyZ', ctrl: true, meta: true }),
        onRedo: () => dispatchKey({ key: 'z', code: 'KeyZ', ctrl: true, meta: true, shift: true }),
        onSearch: dispatchCmdPalette,
        onShare: () => setShowShareModal(true),
        shareLabel: d.share,
        onPublish: () => {
          // Publish = persist current state and toast. Inner handles via Ctrl+S.
          dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true });
        },
        publishLabel: d.publish,
        rightExtras: (
          <button
            type="button"
            className="nx-pillbtn"
            style={{ height: 24, padding: '0 8px' }}
            onClick={toggleTheme}
            title={d.toggleTheme}
            aria-label={d.toggleTheme}
          >
            {themeMode === 'dark' ? <I.sun size={12} /> : <I.moon size={12} />}
          </button>
        ),
      }}
      ribbon={{
        activeTab,
        onTabChange: id => {
          setActiveTab(id);
          // Leaving sketch mode via a non-sketch top-tab — commit the
          // in-progress sketch first so the user doesn't lose work, then
          // fall through to the normal mode/route switch below.
          if (mode === 'sketch' && !id.startsWith('sketch.')) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('nexyfab:tool', { detail: { id: 'sketch.finish' } }));
            }
          }
          // Sketch sub-tabs (Draw / Constrain / Finish) stay in sketch mode.
          if (id.startsWith('sketch.')) {
            setMode('sketch');
            return;
          }
          // Sheet Metal mode entry.
          if (id === 'sheetmetal') {
            setMode('sheetmetal');
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
          // Sheet Metal tools go through their own channel so Inner can
          // resolve them with sheet-specific parameters (thickness, K-factor).
          if (id.startsWith('sm.')) {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('nexyfab:sheet-metal-tool', { detail: { tool: id } }));
            }
            return;
          }
          dispatchTool(id);
        },
        isActive: id => tool === id,
      }}
      leftWidth={280}
      rightWidth={320}
      left={
        mode === 'sketch' ? <SketchLeftPane lang={lang} />
        : mode === 'assembly' ? <AssemblyLeftPane lang={lang} />
        : <ModelerLeftPane lang={lang} />
      }
      right={
        mode === 'sketch' ? <SketchRightPane lang={lang} />
        : mode === 'assembly' ? <AssemblyRightPane lang={lang} />
        : <ModelerRightPane lang={lang} />
      }
      viewport={
        <Suspense fallback={<WorkspaceLoading variant="app" />}>
          <ShapeGeneratorInner />
          <ViewportChips lang={lang} />
          <SelectionBubble lang={lang} />
          <SolverInfoChip lang={lang} />
          <FileMenu
            open={fileMenuOpen}
            onClose={() => setFileMenuOpen(false)}
            items={fileMenuItems}
          />
          <OnboardingTutorial isKo={isKo} />
          <EmailVerifyBanner isKo={isKo} lang={lang} />
          <AccountTypeCard isKo={isKo} lang={lang} />
          <GuestExpiryBanner lang={lang} />
          {showShareModal && (
            <ShareProjectModal lang={lang} onClose={() => setShowShareModal(false)} />
          )}
          <AuthModal
            open={signupModalOpen}
            onClose={() => setSignupModalOpen(false)}
            defaultMode="signup"
            redirectMessage={
              signupReason === 'pdf-export' ? d.signupPdf
              : signupReason === 'dxf-export' ? d.signupDxf
              : signupReason === 'share' ? d.signupShare
              : signupReason === 'ai-quota' ? d.signupAi
              : d.signupGeneric
            }
            lang={lang}
          />
        </Suspense>
      }
      bottomDrawer={
        <BottomDrawer
          open={drawerOpen}
          activeTab={drawerTab}
          tabs={[
            { id: 'dfm', label: 'DFM' },
            { id: 'fea', label: 'FEA' },
            { id: 'cost', label: d.drawerCost },
            { id: 'variants', label: d.drawerVariants },
            { id: 'motion', label: d.drawerMotion },
            { id: 'versions', label: d.drawerVersions },
          ]}
          onTabChange={(id) => setDrawerTab(id as typeof drawerTab)}
          onClose={() => setDrawerOpen(false)}
        >
          {drawerTab === 'motion'
            ? <MotionStudyPanel isKo={isKo} />
            : drawerTab === 'versions'
              ? <VersionTreePanel isKo={isKo} />
              : <DrawerContent tab={drawerTab as 'dfm' | 'fea' | 'cost' | 'variants'} d={d} />}
        </BottomDrawer>
      }
      statusBar={{
        left: [
          {
            id: 'units',
            items: [
              `${bridgeUnits} · g · MPa`,
              bridgeFeatureCount > 0
                ? fmtShell(d.featCount, { n: bridgeFeatureCount })
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

// ─── Drawer content — launcher cards for DFM/FEA/Cost/Variants. Clicking a
// card sets the corresponding uiStore flag via custom event so Inner's
// existing ErrorBoundary-wrapped modal opens. This keeps the analytical
// panels fully functional with their original prop wiring while exposing
// them through the new Inspector → ANALYZE → drawer flow.
function DrawerContent({ tab, d }: { tab: 'dfm' | 'fea' | 'cost' | 'variants'; d: ShellDict }) {
  // FEA + Cost + DFM render rich inline summaries reading analysisStore;
  // Variants stays as a simple launcher card.
  if (tab === 'dfm') return <DfmDrawerContent d={d} />;
  if (tab === 'fea') return <FeaDrawerContent d={d} />;
  if (tab === 'cost') return <CostDrawerContent d={d} />;
  // Only `variants` reaches this path; dfm/fea/cost intercepted above.
  const plainTab = 'variants' as const;
  void tab;
  const event: Record<'variants', string> = {
    variants: 'nexyfab:open-variants',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 12, color: 'var(--nx-text)' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{d.variantsTitle}</div>
        <div style={{ color: 'var(--nx-text-2)', lineHeight: 1.5, fontSize: 11 }}>{d.variantsDesc}</div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          style={{
            height: 32, padding: '0 16px', border: 0, borderRadius: 4,
            background: 'var(--nx-accent)', color: '#fff', fontSize: 12,
            fontWeight: 600, cursor: 'pointer',
          }}
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent(event[plainTab]));
            }
          }}
        >
          {d.runArrow}
        </button>
        <button
          style={{
            height: 32, padding: '0 12px',
            border: '1px solid var(--nx-border)', borderRadius: 4,
            background: 'transparent', color: 'var(--nx-text-2)',
            fontSize: 11, cursor: 'pointer',
          }}
        >
          {d.settings}
        </button>
      </div>
      <div style={{ marginTop: 8, padding: 10, background: 'var(--nx-panel-2)', borderRadius: 4, fontSize: 10, color: 'var(--nx-text-3)' }}>
        {d.drawerRunHint}
      </div>
    </div>
  );
}

// FEA drawer adds a solver-mode picker on top of the launcher card.
function FeaDrawerContent({ d }: { d: ShellDict }) {
  const [solverMode, setSolverMode] = useState<'linear' | 'nonlinear' | 'modal'>('linear');
  const launch = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexyfab:open-fea', { detail: { solverMode } }));
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: 'var(--nx-text)' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{d.feaTitle}</div>
        <div style={{ color: 'var(--nx-text-2)', fontSize: 11, marginTop: 4 }}>
          {d.feaPick}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['linear', 'nonlinear', 'modal'] as const).map(m => (
          <button
            key={m}
            onClick={() => setSolverMode(m)}
            style={{
              flex: 1, height: 26, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${solverMode === m ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
              background: solverMode === m ? 'var(--nx-accent-soft)' : 'transparent',
              color: solverMode === m ? 'var(--nx-accent-2)' : 'var(--nx-text-2)',
              borderRadius: 3,
            }}
          >
            {m === 'linear' ? d.feaLinear : m === 'nonlinear' ? d.feaNonlinear : d.feaModal}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--nx-text-3)', lineHeight: 1.5 }}>
        {solverMode === 'linear' && d.feaLinearDesc}
        {solverMode === 'nonlinear' && d.feaNonlinearDesc}
        {solverMode === 'modal' && d.feaModalDesc}
      </div>
      <button
        onClick={launch}
        style={{
          height: 32, padding: '0 16px', border: 0, borderRadius: 4,
          background: 'var(--nx-accent)', color: '#fff', fontSize: 12,
          fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start',
        }}
      >
        {d.runArrow}
      </button>
    </div>
  );
}

// Cost drawer with currency + qty.
function CostDrawerContent({ d }: { d: ShellDict }) {
  const [qty, setQty] = useState(1);
  const launch = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexyfab:open-cost', { detail: { qty } }));
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: 'var(--nx-text)' }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{d.costTitle}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{d.quantity}</span>
        <input
          type="number"
          min={1}
          max={100000}
          value={qty}
          onChange={e => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
          style={{
            height: 24, padding: '0 6px', borderRadius: 3,
            border: '1px solid var(--nx-border)', background: 'var(--nx-bg)',
            color: 'var(--nx-text)', fontSize: 12, fontFamily: 'ui-monospace, monospace',
          }}
        />
      </div>
      <button
        onClick={launch}
        style={{
          height: 32, padding: '0 16px', border: 0, borderRadius: 4,
          background: 'var(--nx-accent)', color: '#fff', fontSize: 12,
          fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start',
        }}
      >
        {fmtShell(d.costEstimateBtn, { n: qty })}
      </button>
    </div>
  );
}

// DFM drawer reads analysisStore.dfmResults for inline summary.
function DfmDrawerContent({ d }: { d: ShellDict }) {
  const dfmResults = useAnalysisStore(s => s.dfmResults);
  const launch = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('nexyfab:open-dfm'));
    }
  };
  // Flatten per-process results into the combined issue list.
  const issues = (dfmResults ?? []).flatMap(r => r.issues);
  const errors = issues.filter(r => r.severity === 'error').length;
  const warnings = issues.filter(r => r.severity === 'warning').length;
  const infos = issues.filter(r => r.severity === 'info').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: 'var(--nx-text)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{d.dfmTitle}</div>
        <div style={{ display: 'flex', gap: 6, fontSize: 10 }}>
          <span style={{ color: 'var(--nx-error, #f85149)' }}>● {errors}</span>
          <span style={{ color: 'var(--nx-warn, #ffa800)' }}>● {warnings}</span>
          <span style={{ color: 'var(--nx-text-3)' }}>● {infos}</span>
        </div>
      </div>
      {issues.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--nx-text-3)' }}>
          {d.dfmNoRun}
        </div>
      ) : (
        <div style={{ maxHeight: 140, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {issues.slice(0, 8).map((r, i) => (
            <div key={i} style={{
              padding: '4px 8px', borderRadius: 3,
              background: 'var(--nx-panel-2)', fontSize: 11,
              borderLeft: `2px solid ${
                r.severity === 'error' ? 'var(--nx-error, #f85149)'
                : r.severity === 'warning' ? 'var(--nx-warn, #ffa800)'
                : 'var(--nx-accent)'}`,
            }}>
              <span style={{ fontWeight: 600 }}>{r.type}</span>
              <span style={{ color: 'var(--nx-text-2)', marginLeft: 6 }}>{r.description}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={launch}
        style={{
          height: 32, padding: '0 16px', border: 0, borderRadius: 4,
          background: 'var(--nx-accent)', color: '#fff', fontSize: 12,
          fontWeight: 600, cursor: 'pointer', alignSelf: 'flex-start',
        }}
      >
        {d.dfmOpenFull}
      </button>
    </div>
  );
}
