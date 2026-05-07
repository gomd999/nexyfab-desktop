'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThreadCallout, HoleCallout } from '../annotations/GDTTypes';
import type { DesignVariant } from '../panels/DesignVariantsPanel';

/**
 * Consolidates self-contained local UI state for ShapeGeneratorPage.
 * Panel visibility, fullscreen, drag/import, auth modal, annotation callouts,
 * funnel tracking, and standard-part selection.
 *
 * Note: does NOT include state that is shared via zustand stores (uiStore/sceneStore)
 * or tightly coupled state such as feature stack, history, or analysis results.
 */
export function useShapeGeneratorUI() {
  // ── Panel visibility (local) ──
  const [showQuoteWizard, setShowQuoteWizard] = useState(false);
  const [showCSGPanel, setShowCSGPanel] = useState(false);
  const [showARViewer, setShowARViewer] = useState(false);
  const [showFeatureGraph, setShowFeatureGraph] = useState(false);
  const [showNestingTool, setShowNestingTool] = useState(false);
  const [showThreadHolePanel, setShowThreadHolePanel] = useState(false);
  const [showPropertyManager, setShowPropertyManager] = useState(false);
  const [showModelParams, setShowModelParams] = useState(false);
  const [showBomExportMenu, setShowBomExportMenu] = useState(false);
  const [showCommentsPanel, setShowCommentsPanel] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const [showCopilot, setShowCopilot] = useState(false);
  const [showRfqPanel, setShowRfqPanel] = useState(false);
  const [showCAMSimPanel, setShowCAMSimPanel] = useState(false);
  const [showMoldDesignPanel, setShowMoldDesignPanel] = useState(false);

  // ── Annotation callouts (thread / hole) ──
  const [threadCallouts, setThreadCallouts] = useState<ThreadCallout[]>([]);
  const [holeCallouts, setHoleCallouts] = useState<HoleCallout[]>([]);

  // ── Design variants (Phase 2) ──
  const [showVariantsPanel, setShowVariantsPanel] = useState(false);
  const [designVariants, setDesignVariants] = useState<DesignVariant[]>([]);
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null);

  // ── Phase 4 panels ──
  const [showUserPartsPanel, setShowUserPartsPanel] = useState(false);
  const [showSessionTimelapse, setShowSessionTimelapse] = useState(false);
  const [showStockOptimizer, setShowStockOptimizer] = useState(false);

  // ── Conversion funnel ──
  const [rfqDone, setRfqDone] = useState(false);

  // ── Standard parts picker ──
  const [selectedStandardPart, setSelectedStandardPart] = useState<string | null>(null);
  const [standardPartParams, setStandardPartParams] = useState<Record<string, number>>({});

  // ── Auth modal ──
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'login' | 'signup'>('login');

  // ── Fullscreen ──
  const [show3DPreview, setShow3DPreview] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenPrompt, setShowFullscreenPrompt] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = sessionStorage.getItem('nf_fs_prompt_dismissed');
    if (dismissed) return;
    const check = () => {
      if (window.innerWidth < 1280 && !document.fullscreenElement) {
        setShowFullscreenPrompt(true);
      }
    };
    const t = setTimeout(check, 1500);
    return () => clearTimeout(t);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.warn('[Fullscreen]', err));
    } else {
      document.exitFullscreen().catch(err => console.warn('[Fullscreen]', err));
    }
  }, []);

  const dismissFullscreenPrompt = useCallback((goFullscreen: boolean) => {
    setShowFullscreenPrompt(false);
    sessionStorage.setItem('nf_fs_prompt_dismissed', '1');
    if (goFullscreen) toggleFullscreen();
  }, [toggleFullscreen]);

  // ── Drag / import state ──
  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);

  return {
    // Panels
    showQuoteWizard, setShowQuoteWizard,
    showCSGPanel, setShowCSGPanel,
    showARViewer, setShowARViewer,
    showFeatureGraph, setShowFeatureGraph,
    showNestingTool, setShowNestingTool,
    showThreadHolePanel, setShowThreadHolePanel,
    showPropertyManager, setShowPropertyManager,
    showModelParams, setShowModelParams,
    showBomExportMenu, setShowBomExportMenu,
    showCommentsPanel, setShowCommentsPanel,
    showChatPanel, setShowChatPanel,
    showCopilot, setShowCopilot,
    showRfqPanel, setShowRfqPanel,
    showCAMSimPanel, setShowCAMSimPanel,
    showMoldDesignPanel, setShowMoldDesignPanel,
    // Annotations
    threadCallouts, setThreadCallouts,
    holeCallouts, setHoleCallouts,
    // Design variants
    showVariantsPanel, setShowVariantsPanel,
    designVariants, setDesignVariants,
    activeVariantId, setActiveVariantId,
    // Phase 4 panels
    showUserPartsPanel, setShowUserPartsPanel,
    showSessionTimelapse, setShowSessionTimelapse,
    showStockOptimizer, setShowStockOptimizer,
    // Funnel
    rfqDone, setRfqDone,
    // Standard parts
    selectedStandardPart, setSelectedStandardPart,
    standardPartParams, setStandardPartParams,
    // Auth
    showAuthModal, setShowAuthModal,
    authModalMode, setAuthModalMode,
    // Fullscreen
    show3DPreview, setShow3DPreview,
    isFullscreen, setIsFullscreen,
    showFullscreenPrompt, setShowFullscreenPrompt,
    toggleFullscreen,
    dismissFullscreenPrompt,
    // Drag/import
    isDragOver, setIsDragOver,
    isImporting, setIsImporting,
    isDragging, setIsDragging,
    dragCounterRef,
  };
}

export type UseShapeGeneratorUI = ReturnType<typeof useShapeGeneratorUI>;
