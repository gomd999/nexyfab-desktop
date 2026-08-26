'use client';

// ModelerShell — wraps the existing ShapeGeneratorInner with the new shell-v2
// chrome (TitleBar + Ribbon + StatusBar). Inner's legacy chrome bars (top
// ShapeGeneratorToolbar, DesignFunnelBar, CommandToolbar, PdmMetaWorkspaceStrip,
// StatusBar) are hidden via globals.css when `body.sg-shell-v2` is on. Inner's
// panels (FeatureTree, viewport canvas, Inspector) keep rendering inside
// Shell's viewport slot so all real CAD behavior continues to work unchanged.
//
// Ribbon actions bridge into the existing command stack through
// `nexyfab:tool`; ShapeGeneratorInner maps those ids to real CAD handlers.

import React, { Suspense, useCallback, useMemo, useRef, useState, useEffect } from 'react';
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
import { CadWorkflowRail } from './CadWorkflowRail';
import type { AdaptiveComplexProductExecutionPlan } from '@/lib/ai/adaptiveComplexProductExecution';
import { DomainWorkspaceBar } from './DomainWorkspaceBar';
import { useDomainWorkspaceSelection } from './domainWorkspaceStore';
import { loc } from '@/lib/i18n/loc';
import { createCommercialLocalizer } from '@/lib/i18n/commercialLocalizer';
import { useAssemblyState } from '../hooks/useAssemblyState';
import { EmbeddedAssemblyWorkspace } from '../assembly/EmbeddedAssemblyWorkspace';
import type { AssemblyBrowserLang } from '../assembly/AssemblyBrowserModal';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  featureTreeSignature,
  placedPartGeometrySignature,
  provisionPlacedPartFeatureTree,
} from '../assembly/placedPartFeatureTreeProvisioning';
import { dispatchAssemblyRibbonCommand } from '../assembly/assemblyRibbonCommands';
import { generationDomainFor } from '@/lib/ai/domainGenerationRequest';
import { SpatialCadWorkspace } from './spatial/SpatialCadWorkspace';
import { spatialRibbonGroups, spatialRibbonTabs } from './spatial/spatialRibbon';
import { CoordinationCadWorkspace } from './spatial/CoordinationCadWorkspace';
import { dispatchSpatialCadCommand } from './spatial/spatialCadCommands';
import type { StudioTruthState } from '@/lib/ai/studioTruthContract';
import { saveSpatialAiInstruction, SPATIAL_AI_HANDOFF_REQUEST_EVENT } from '@/lib/ai/spatialDesignBriefHandoff';
import { shellChromeText } from './shellChromeI18n';

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
  const [complexExecutionPlan, setComplexExecutionPlan] = useState<AdaptiveComplexProductExecutionPlan | null>(null);
  const [domainWorkspace] = useDomainWorkspaceSelection();
  const [spatialVerification, setSpatialVerification] = useState<StudioTruthState>('NOT_RUN');
  const [coordinationOpen, setCoordinationOpen] = useState(false);
  const baseSpatialDomain = domainWorkspace.domain === 'mechanical' ? null : domainWorkspace.domain;
  const spatialDomain = coordinationOpen ? 'coordination' as const : baseSpatialDomain;
  const isSpatial = spatialDomain !== null;
  const spatialTabs = useMemo(() => spatialDomain ? spatialRibbonTabs(spatialDomain) : undefined, [spatialDomain]);
  const spatialGroups = useMemo(
    () => spatialDomain ? spatialRibbonGroups(spatialDomain, domainWorkspace.experience, activeTab) : undefined,
    [activeTab, domainWorkspace.experience, spatialDomain],
  );
  const { placedParts, setPlacedParts, assemblyMates, setAssemblyMates } = useAssemblyState();
  const [assemblyFeatureTrees, setAssemblyFeatureTrees] = useState<Record<string, FeatureTree>>({});
  const autoAssemblyTreesRef = useRef<Record<string, { partSignature: string; treeSignature: string }>>({});

  const assemblyTreeProvisionIssues = useMemo(() => placedParts.flatMap(part => {
    const provision = provisionPlacedPartFeatureTree(part);
    return provision.status === 'unsupported'
      ? [`${part.name} (${part.shapeId}): ${provision.reason}`]
      : [];
  }), [placedParts]);

  // Promote losslessly representable legacy parts into the canonical feature-
  // tree solver path. Auto-owned trees follow parameter edits; once a user
  // edits a tree in the assembly workspace, ownership is released and their
  // authored tree is never overwritten.
  useEffect(() => {
    setAssemblyFeatureTrees(current => {
      const next = { ...current };
      const liveIds = new Set(placedParts.map(part => part.id));
      let changed = false;

      for (const id of Object.keys(next)) {
        if (!liveIds.has(id)) {
          delete next[id];
          delete autoAssemblyTreesRef.current[id];
          changed = true;
        }
      }

      for (const part of placedParts) {
        const provision = provisionPlacedPartFeatureTree(part);
        if (provision.status !== 'exact') continue;
        const desiredPartSignature = placedPartGeometrySignature(part);
        const desiredTreeSignature = featureTreeSignature(provision.tree);
        const existingTreeSignature = featureTreeSignature(next[part.id]);
        const owner = autoAssemblyTreesRef.current[part.id];
        const canAutoUpdate = !next[part.id] || (
          owner !== undefined && owner.treeSignature === existingTreeSignature
        );
        if (!canAutoUpdate) {
          delete autoAssemblyTreesRef.current[part.id];
          continue;
        }
        if (existingTreeSignature !== desiredTreeSignature) {
          next[part.id] = provision.tree;
          changed = true;
        }
        autoAssemblyTreesRef.current[part.id] = {
          partSignature: desiredPartSignature,
          treeSignature: desiredTreeSignature,
        };
      }
      return changed ? next : current;
    });
  }, [placedParts]);

  const handleAssemblyFeatureTreesChange = useCallback((next: Record<string, FeatureTree>) => {
    setAssemblyFeatureTrees(current => {
      for (const [partId, owner] of Object.entries(autoAssemblyTreesRef.current)) {
        if (featureTreeSignature(next[partId]) !== owner.treeSignature) {
          delete autoAssemblyTreesRef.current[partId];
        }
      }
      const currentSignature = JSON.stringify(current);
      const nextSignature = JSON.stringify(next);
      return currentSignature === nextSignature ? current : next;
    });
  }, []);

  useEffect(() => {
    const accept = (value: unknown) => {
      if (value && typeof value === 'object' && (value as { schema?: string }).schema === 'nexyfab.adaptive-complex-product-execution.v1') {
        const plan = value as AdaptiveComplexProductExecutionPlan;
        setComplexExecutionPlan(plan);
        if (plan.nextAction === 'run_ai_managed_precision_cad') {
          window.dispatchEvent(new CustomEvent('nexyfab:open-right-pane', { detail: { tab: 'ai' } }));
        }
      }
    };
    try { const stored = window.sessionStorage.getItem('nexyfab:ai-complex-execution-plan:v1'); if (stored) accept(JSON.parse(stored)); } catch { /* unavailable or invalid session data */ }
    const onPlan = (event: Event) => accept((event as CustomEvent<AdaptiveComplexProductExecutionPlan>).detail);
    window.addEventListener('nexyfab:complex-execution-plan', onPlan);
    return () => window.removeEventListener('nexyfab:complex-execution-plan', onPlan);
  }, []);

  const d = pickShellDict(lang);
  const tc = (key: Parameters<typeof shellChromeText>[1]) => shellChromeText(lang, key);
  // Deferred sub-panels (Onboarding/EmailVerify/AccountType/Motion/Versions)
  // are still ko/en-binary — keep isKo for them only.
  const isKo = lang === 'ko';
  const L = createCommercialLocalizer(lang);
  const langSeg = lang === 'ko' ? 'kr' : lang;
  const openSpatialAi = useCallback((instruction?: string) => {
    if (!spatialDomain || spatialDomain === 'coordination') return;
    // Active spatial workspaces synchronously serialize only their current
    // draft dimensions/truth state. No auth token or approval claim is sent.
    saveSpatialAiInstruction(window.sessionStorage, spatialDomain, instruction ?? '');
    window.dispatchEvent(new Event(SPATIAL_AI_HANDOFF_REQUEST_EVENT));
    router.push(`/${langSeg}/nexyfab/design/?domain=${generationDomainFor(spatialDomain)}&handoff=1`);
  }, [langSeg, router, spatialDomain]);
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
  const [drawerTab, setDrawerTab] = useState<'jobs' | 'dfm' | 'fea' | 'cost' | 'variants' | 'motion' | 'versions'>('dfm');
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
      // K-series kernel-ceiling op: thicken the active sketch (or a demo
      // square) into a solid via the real OCCT worker, shown via the import
      // seam. Lands outside the parametric tree (see ShapeGeneratorInner).
      id: 'kseries-thicken',
      label: 'Thicken surface → solid (K-series)',
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:kseries-thicken', { detail: { thickness: 2 } }));
        }
      },
    },
    {
      // P-2(260808b) — 역루프: 현재 모델을 AI 챗 컨텍스트로("이 상태에서 …해줘").
      id: 'send-to-chat',
      label: 'AI 챗으로 보내기 (모델 컨텍스트)',
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:send-to-chat'));
        }
      },
    },
    {
      // Import a STEP file as a true OCCT B-rep solid (STEPControl_Reader via
      // the worker) — accurate volume/bbox + re-exportable, vs the default
      // occt-import-js → tessellated-mesh import.
      id: 'kseries-import-step',
      label: 'Import STEP as B-rep (K-series)',
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:kseries-import-step'));
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
    {
      id: 'export-papercraft',
      label: d.fmExportPapercraft,
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:file-export', { detail: { format: 'papercraft' } }));
        }
      },
    },
    {
      id: 'export-slice',
      label: d.fmExportSlice,
      onClick: () => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('nexyfab:file-export', { detail: { format: 'papercraft-slice' } }));
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
  useEffect(() => {
    if (sp?.get('workspace') === 'coordination') setCoordinationOpen(true);
  }, [sp]);
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
  const bridgeDfmWarningCount = useShellBridge(s => s.dfmWarningCount);

  useEffect(() => {
    setSpatialVerification('NOT_RUN');
  }, [spatialDomain]);
  useEffect(() => {
    const onVerification = (event: Event) => {
      const state = (event as CustomEvent<{ state?: StudioTruthState }>).detail?.state;
      if (state === 'NOT_RUN' || state === 'PREVIEW' || state === 'BLOCKED') setSpatialVerification(state);
    };
    window.addEventListener('nexyfab:spatial-verification-status', onVerification);
    return () => window.removeEventListener('nexyfab:spatial-verification-status', onVerification);
  }, []);

  // A spatial discipline must never inherit the mechanical feature ribbon or
  // a stale sketch/assembly state from the hidden product modeler.
  useEffect(() => {
    if (spatialDomain) {
      const domainTabs = spatialRibbonTabs(spatialDomain);
      setMode('modeling');
      setTool(null);
      setActiveTab(current => domainTabs.some(tab => tab.id === current)
        ? current
        : domainTabs[0]?.id ?? 'space.requirements');
    } else {
      setActiveTab(current => current.startsWith('space.') ? 'solid' : current);
    }
  }, [spatialDomain]);

  // Sync shell mode + active sketch tab to Inner's sketch state. When the
  // user toggles sketch mode in Inner, the shell ribbon switches to the
  // sketch tabs (Draw/Constrain/Finish); when they exit, we pop back to
  // 'solid'. Guard against echoing user clicks by only changing tab when
  // the current tab is for the wrong mode.
  useEffect(() => {
    if (isSpatial) return;
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
  }, [bridgeEditMode, activeTab, isSpatial]);

  // Mode chip & hint reflect Inner's actual edit mode.
  const modeChip =
    mode === 'assembly' || bridgeEditMode === 'assembly'
      ? d.modeAssembly
      : bridgeEditMode === 'sketch'
      ? d.modeSketch
      : undefined;
  // Sketch solver indicator — SolidWorks-style 3-state: under-constrained /
  // fully constrained / over-defined-or-conflicting. Empty sketch → no pill.
  const sketchSolverLabel =
    bridgeEditMode === 'sketch'
      ? sketchStatusLabel(bridgeSketchStatus, bridgeSketchDof, bridgeSketchRedundant, d) ?? undefined
      : undefined;

  const modeHint =
    mode === 'assembly' || bridgeEditMode === 'assembly'
      ? d.exitAssemblyHint
      : bridgeEditMode === 'sketch'
      ? sketchSolverLabel ?? d.exitSketchHint
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
  const statusPills: {
    id: string;
    label: string;
    tone?: 'ok' | 'warn' | 'error';
    saveState?: 'ready' | 'saving' | 'saved' | 'error';
  }[] = [];
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
  if (bridgeCloudStatus === 'saved') {
    statusPills.push({ id: 'cloud', label: d.pillSynced, tone: 'ok', saveState: 'saved' });
  } else if (bridgeCloudStatus === 'saving') {
    statusPills.push({ id: 'cloud', label: d.pillSaving, saveState: 'saving' });
  } else if (bridgeCloudStatus === 'error' || bridgeCloudStatus === 'conflict') {
    statusPills.push({ id: 'cloud', label: bridgeCloudStatus === 'conflict' ? d.versionConflict : d.pillError, tone: 'error', saveState: 'error' });
  } else {
    statusPills.push({ id: 'cloud', label: d.autosaveReady, saveState: 'ready' });
  }

  return (
    <Shell
      mode={mode}
      experienceLevel={domainWorkspace.experience}
      viewportOnly={isMobile}
      domainWorkspace={<div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}><DomainWorkspaceBar lang={langSeg} compact sessionVerification={isSpatial ? spatialVerification : undefined} />{baseSpatialDomain && <button type="button" data-testid="coordination-workspace-toggle" aria-pressed={coordinationOpen} onClick={() => setCoordinationOpen(current => !current)} style={{ height: 24, marginRight: 8, border: `1px solid ${coordinationOpen ? 'var(--nx-accent)' : 'var(--nx-border)'}`, borderRadius: 5, background: coordinationOpen ? 'var(--nx-accent)' : 'var(--nx-panel-2)', color: coordinationOpen ? 'var(--nx-on-accent, #071a17)' : 'var(--nx-text-2)', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap', cursor: 'pointer' }}>{tc('coordination')}</button>}</div>}
      commandPaletteEnabled={!isSpatial}
      workflow={(
        <CadWorkflowRail
          compact
          lang={lang}
          domain={domainWorkspace.domain}
          hasModel={isSpatial || bridgeFeatureCount > 0 || bridgeTriangleCount > 0}
          dfmWarningCount={isSpatial
            ? spatialVerification === 'BLOCKED' ? 1 : spatialVerification === 'PREVIEW' ? 0 : null
            : bridgeDfmWarningCount}
          executionPlan={isSpatial ? null : complexExecutionPlan}
          onAiDesign={isSpatial ? openSpatialAi : () => dispatchTool('ai.suggest')}
          onPreciseCad={isSpatial
            ? () => dispatchSpatialCadCommand('spatial.plan')
            : () => { setMode('modeling'); setActiveTab('solid'); }}
          onVerify={() => {
            if (isSpatial) {
              dispatchSpatialCadCommand('spatial.verify');
            } else {
              setDrawerTab('dfm');
              setDrawerOpen(true);
            }
          }}
          onExportEvidencePackage={() => {
            // Spatial release stays disabled until a discipline-specific,
            // authority-backed deliverable exists. Never route it to the
            // mechanical STEP exporter.
            if (!isSpatial) window.dispatchEvent(new CustomEvent('nexyfab:file-export', { detail: { format: 'step' } }));
          }}
        />
      )}
      titleBar={{
        lang,
        filename: isSpatial && spatialDomain
          ? `${spatialDomain}-concept.nxspace`
          : bridgeSelectedLabel
          ? `${bridgeSelectedLabel}.nxpart`
          : d.untitledFile,
        savedAt: isSpatial ? undefined : savedAtLabel,
        breadcrumbs: isSpatial && spatialDomain ? [tc('spaceDesignLabs'), `${spatialDomain} ${tc('concept')}`] : [tc('projects'), bridgeSelectedLabel ?? d.untitled],
        // Leaving an active expert-modeler session — go to the Hub, NOT the
        // guest "Studio-first funnel" (the Hub auto-redirects a guest's first
        // visit to the free-form Studio). Mark the Hub visited so it stays put.
        onBrandClick: () => {
          try { sessionStorage.setItem('nexyfab:hub-visited', '1'); } catch { /* ignore */ }
          router.push(`/${langSeg}/nexyfab/hub`);
        },
        mode: isSpatial ? tc('preview') : modeChip,
        modeHint: isSpatial ? (L('실측·호스트 권한 미확인', 'field/host authority unconfirmed')) : modeHint,
        onExitMode: !isSpatial && modeChip
          ? () => {
              if (bridgeEditMode === 'sketch') {
                window.dispatchEvent(new CustomEvent('nexyfab:tool', { detail: { id: 'sketch.finish' } }));
              } else if (mode === 'assembly' || bridgeEditMode === 'assembly') {
                setMode('modeling');
                setActiveTab('solid');
                // Toggle assembly panel via uiStore — fall back to no-op if listener not registered.
                window.dispatchEvent(new CustomEvent('nexyfab:assembly-close'));
              }
            }
          : undefined,
        avatars,
        // In sketch mode the Ctrl+Z we dispatch is consumed by the sketch
        // session's own stack (not commandHistory), whose depth isn't exposed
        // reactively — keep the buttons enabled there rather than lying.
        canUndo: !isSpatial && (bridgeEditMode === 'sketch' ? true : canUndo),
        canRedo: !isSpatial && (bridgeEditMode === 'sketch' ? true : canRedo),
        onNew: isSpatial ? undefined : () => setFileMenuOpen(v => !v),
        onOpen: isSpatial ? undefined : () => router.push(`/${langSeg}/nexyfab/projects`),
        onSave: isSpatial ? undefined : () => {
          // Inner runs autosave on a 30s debounce + saves on Ctrl+S.
          dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true });
        },
        onUndo: isSpatial ? undefined : () => dispatchKey({ key: 'z', code: 'KeyZ', ctrl: true, meta: true }),
        onRedo: isSpatial ? undefined : () => dispatchKey({ key: 'z', code: 'KeyZ', ctrl: true, meta: true, shift: true }),
        onSearch: isSpatial ? undefined : dispatchCmdPalette,
        onShare: isSpatial ? undefined : () => setShowShareModal(true),
        shareLabel: d.share,
        onPublish: isSpatial ? undefined : () => {
          // Publish = persist current state and toast. Inner handles via Ctrl+S.
          dispatchKey({ key: 's', code: 'KeyS', ctrl: true, meta: true });
        },
        publishLabel: d.publish,
        rightExtras: (
          <>
          {!isSpatial && (
            <>
              <button
                type="button"
                className="nx-pillbtn nx-title-utility"
                data-testid="studio-open-ai"
                onClick={() => window.dispatchEvent(new CustomEvent('nexyfab:open-right-pane', { detail: { tab: 'ai' } }))}
              >
                <I.ai size={12} /><span>AI</span>
              </button>
              <button
                type="button"
                className="nx-pillbtn nx-title-utility"
                data-testid="studio-open-jobs"
                onClick={() => { setDrawerTab('jobs'); setDrawerOpen(true); }}
              >
                <I.bolt size={12} /><span>{tc('jobs')}</span>
              </button>
              <button
                type="button"
                className="nx-pillbtn nx-title-utility"
                data-testid="shell-open-verify"
                aria-label={L('제조 가능성 및 해석 검증 열기', 'Open manufacturability and analysis verification')}
                onClick={() => { setDrawerTab('dfm'); setDrawerOpen(true); }}
              >
                <I.comments size={12} /><span>{tc('verify')}</span>
                {bridgeDfmWarningCount !== null && bridgeDfmWarningCount > 0 && <b>{bridgeDfmWarningCount}</b>}
              </button>
            </>
          )}
          {!isSpatial && (
          <button
            type="button"
            className="nx-pillbtn"
            data-testid="shell-open-rfq"
            onClick={() => window.dispatchEvent(new CustomEvent('nexyfab:open-rfq'))}
          >
            Quote
          </button>
          )}
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
          </>
        ),
      }}
      ribbon={{
        tabs: spatialTabs,
        groups: spatialGroups,
        activeTab,
        onTabChange: id => {
          setActiveTab(id);
          if (isSpatial) {
            if (id === 'space.layout') dispatchSpatialCadCommand('spatial.plan');
            else if (id === 'space.furniture') dispatchSpatialCadCommand('spatial.furniture');
            else if (id === 'space.requirements' || id === 'space.model' || id === 'space.evidence' || id === 'space.deliverables' || id === 'space.planting' || id === 'space.water') {
              dispatchSpatialCadCommand(`spatial.section.${id.replace('space.', '')}`);
            }
            return;
          }
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
            router.push(`/${langSeg}/shape-generator/drawing?expert=1`);
            return;
          }
          if (id === 'render') {
            router.push(`/${langSeg}/shape-generator/render?expert=1`);
            return;
          }
          if (id === 'assembly') {
            setMode('assembly');
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
          if (isSpatial) {
            if (id === 'spatial.ai') openSpatialAi();
            else dispatchSpatialCadCommand(id);
            return;
          }
          // Assembly has its own embedded workspace. Route its ribbon into
          // that visible surface instead of opening the now-hidden legacy
          // AssemblyPanel inside ShapeGeneratorInner.
          if (mode === 'assembly' && dispatchAssemblyRibbonCommand(id)) return;
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
        isSpatial ? undefined
        : mode === 'sketch' ? <SketchLeftPane lang={lang} />
        : mode === 'assembly' ? undefined
        : <ModelerLeftPane lang={lang} />
      }
      right={
        isSpatial ? undefined
        : mode === 'sketch' ? <SketchRightPane lang={lang} />
        : mode === 'assembly' ? undefined
        : <ModelerRightPane lang={lang} />
      }
      viewport={
        <Suspense fallback={<WorkspaceLoading variant="app" />}>
          {isSpatial && spatialDomain ? (
            spatialDomain === 'coordination'
              ? <CoordinationCadWorkspace lang={langSeg} />
              : <SpatialCadWorkspace domain={spatialDomain} lang={langSeg} experience={domainWorkspace.experience} onAiDesign={openSpatialAi} />
          ) : (
          <>
          <div hidden={mode === 'assembly'} style={{ width: '100%', height: '100%' }}>
            <ShapeGeneratorInner embeddedInShell />
            {!isMobile && <ViewportChips lang={lang} />}
            {!isMobile && <SelectionBubble lang={lang} />}
            {!isMobile && <SolverInfoChip lang={lang} />}
          </div>
          {mode === 'assembly' && (
            <EmbeddedAssemblyWorkspace
              lang={(lang === 'cn' ? 'zh' : lang) as AssemblyBrowserLang}
              placedParts={placedParts}
              assemblyMates={assemblyMates}
              featureTrees={assemblyFeatureTrees}
              featureTreeProvisionIssues={assemblyTreeProvisionIssues}
              onPlacedPartsChange={setPlacedParts}
              onAssemblyMatesChange={setAssemblyMates}
              onFeatureTreesChange={handleAssemblyFeatureTreesChange}
              onClose={() => {
                setMode('modeling');
                setActiveTab('solid');
                window.dispatchEvent(new CustomEvent('nexyfab:assembly-close'));
              }}
            />
          )}
          </>
          )}
          {!isSpatial && (
          <FileMenu
            open={fileMenuOpen}
            onClose={() => setFileMenuOpen(false)}
            items={fileMenuItems}
          />
          )}
          {!isSpatial && mode !== 'assembly' && <OnboardingTutorial isKo={isKo} />}
          {!isSpatial && mode !== 'assembly' && <EmailVerifyBanner isKo={isKo} lang={lang} />}
          {!isSpatial && mode !== 'assembly' && <AccountTypeCard isKo={isKo} lang={lang} />}
          {!isSpatial && mode !== 'assembly' && !isMobile && <GuestExpiryBanner lang={lang} />}
          {!isSpatial && showShareModal && (
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
      bottomDrawer={isSpatial || mode === 'assembly' ? undefined :
        <BottomDrawer
          lang={lang}
          open={drawerOpen}
          activeTab={drawerTab}
          tabs={[
            { id: 'jobs', label: tc('jobs') },
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
          {drawerTab === 'jobs'
            ? <JobsDrawerContent lang={lang} cloudStatus={bridgeCloudStatus} />
            : drawerTab === 'motion'
            ? <MotionStudyPanel isKo={isKo} />
            : drawerTab === 'versions'
              ? <VersionTreePanel isKo={isKo} documentId={projectId} />
              : <DrawerContent tab={drawerTab as 'dfm' | 'fea' | 'cost' | 'variants'} d={d} lang={lang} />}
        </BottomDrawer>
      }
      statusBar={{
        left: isSpatial && spatialDomain ? [
          { id: 'domain', items: [`${spatialDomain} · ${spatialDomain === 'civil' || spatialDomain === 'landscape' ? 'm' : 'mm'}`, 'concept revision'] },
          { id: 'authority', items: ['PREVIEW · NOT_RELEASED'] },
        ] : [
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
        pills: isSpatial ? [] : statusPills,
      }}
    />
  );
}

function JobsDrawerContent({ lang, cloudStatus }: { lang: string; cloudStatus: string }) {
  const L = createCommercialLocalizer(lang);
  const dfmResults = useAnalysisStore(s => s.dfmResults);
  const feaResult = useAnalysisStore(s => s.feaResult);
  const rows = [
    {
      id: 'persistence',
      label: L('모델 저장', 'Model persistence'),
      state: cloudStatus === 'saving' ? 'RUNNING' : cloudStatus === 'saved' ? 'SAVED' : cloudStatus === 'error' || cloudStatus === 'conflict' ? 'BLOCKED' : 'NOT_RUN',
      detail: L('현재 브라우저 세션의 저장 상태', 'Current browser-session save state'),
    },
    {
      id: 'dfm',
      label: 'DFM',
      state: dfmResults === null ? 'NOT_RUN' : 'PREVIEW_RESULT',
      detail: dfmResults === null ? (L('검사를 실행하지 않음', 'Check has not been run')) : (L('로컬 분석 결과가 있음 · 출시 검증 아님', 'Local result available · not release verification')),
    },
    {
      id: 'fea',
      label: 'FEA',
      state: feaResult === null ? 'NOT_RUN' : 'PREVIEW_RESULT',
      detail: feaResult === null ? (L('해석을 실행하지 않음', 'Solve has not been run')) : (L('세션 결과가 있음 · 출시 검증 아님', 'Session result available · not release verification')),
    },
    {
      id: 'orchestrator',
      label: L('Cloudflare 작업 오케스트레이터', 'Cloudflare job orchestrator'),
      state: 'NOT_RUN',
      detail: L('이 패널에서 실제 프로젝트 큐 조회를 실행하지 않음', 'Live project queue was not queried by this panel'),
    },
  ];

  return (
    <div data-testid="studio-jobs-drawer" style={{ display: 'grid', gap: 8, color: 'var(--nx-text)', fontSize: 11 }}>
      <div>
        <b style={{ fontSize: 13 }}>{L('현재 세션 작업', 'Current session jobs')}</b>
        <div style={{ marginTop: 3, color: 'var(--nx-text-3)' }}>{L('실제 관측 상태만 표시합니다.', 'Only observed states are shown.')}</div>
      </div>
      {rows.map(row => (
        <article key={row.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 0.7fr) 120px minmax(220px, 1fr)', gap: 10, alignItems: 'center', minHeight: 36, padding: '6px 9px', border: '1px solid var(--nx-border)', borderRadius: 5, background: 'var(--nx-panel-2)' }}>
          <b>{row.label}</b>
          <span style={{ color: row.state === 'BLOCKED' ? 'var(--nx-danger)' : row.state === 'NOT_RUN' ? 'var(--nx-warn)' : 'var(--nx-accent)', fontFamily: 'var(--font-jetbrains-mono), monospace', fontSize: 10 }}>{row.state}</span>
          <span style={{ color: 'var(--nx-text-2)' }}>{row.detail}</span>
        </article>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="nx-pillbtn" onClick={() => window.dispatchEvent(new CustomEvent('nexyfab:analyze-open', { detail: { drawer: 'dfm' } }))}>{L('DFM 열기', 'Open DFM')}</button>
        <button type="button" className="nx-pillbtn" onClick={() => window.dispatchEvent(new CustomEvent('nexyfab:analyze-open', { detail: { drawer: 'fea' } }))}>{L('FEA 열기', 'Open FEA')}</button>
      </div>
    </div>
  );
}

// ─── Drawer content — launcher cards for DFM/FEA/Cost/Variants. Clicking a
// card sets the corresponding uiStore flag via custom event so Inner's
// existing ErrorBoundary-wrapped modal opens. This keeps the analytical
// panels fully functional with their original prop wiring while exposing
// them through the new Inspector → ANALYZE → drawer flow.
function DrawerContent({ tab, d, lang }: { tab: 'dfm' | 'fea' | 'cost' | 'variants'; d: ShellDict; lang: string }) {
  // FEA + Cost + DFM render rich inline summaries reading analysisStore;
  // Variants stays as a simple launcher card.
  if (tab === 'dfm') return <DfmDrawerContent d={d} />;
  if (tab === 'fea') return <FeaDrawerContent d={d} lang={lang} />;
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
function FeaDrawerContent({ d, lang }: { d: ShellDict; lang: string }) {
  const [solverMode, setSolverMode] = useState<'linear' | 'nonlinear' | 'modal' | 'buckling'>('linear');
  const launch = () => {
    if (typeof window !== 'undefined') {
      if (solverMode === 'buckling') {
        window.dispatchEvent(new CustomEvent('nexyfab:open-buckling'));
      } else {
        window.dispatchEvent(new CustomEvent('nexyfab:open-fea', { detail: { solverMode } }));
      }
    }
  };
  const bucklingLabel = loc(lang, {
    ko: '좌굴', en: 'Buckling', ja: '座屈', zh: '屈曲', es: 'Pandeo', ar: 'الانبعاج',
  });
  const bucklingDescription = loc(lang, {
    ko: '임계하중 계수 · 고유치 기반 선형 좌굴.',
    en: 'Critical load factor · eigenvalue linear buckling.',
    ja: '臨界荷重係数 · 固有値線形座屈解析。',
    zh: '临界载荷系数 · 特征值线性屈曲分析。',
    es: 'Factor de carga crítica · pandeo lineal por autovalores.',
    ar: 'معامل الحمل الحرج · انبعاج خطي بالقيم الذاتية.',
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, color: 'var(--nx-text)' }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{d.feaTitle}</div>
        <div style={{ color: 'var(--nx-text-2)', fontSize: 11, marginTop: 4 }}>
          {d.feaPick}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {(['linear', 'nonlinear', 'modal', 'buckling'] as const).map(m => (
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
            {m === 'linear' ? d.feaLinear : m === 'nonlinear' ? d.feaNonlinear : m === 'modal' ? d.feaModal : bucklingLabel}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: 'var(--nx-text-3)', lineHeight: 1.5 }}>
        {solverMode === 'linear' && d.feaLinearDesc}
        {solverMode === 'nonlinear' && d.feaNonlinearDesc}
        {solverMode === 'modal' && d.feaModalDesc}
        {solverMode === 'buckling' && bucklingDescription}
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
        data-testid="shell-open-full-dfm"
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
