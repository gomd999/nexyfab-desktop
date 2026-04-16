import { useEffect, useRef } from 'react';
import { useUIStore } from '../store/uiStore';
import type { EditMode } from '../editing/types';
import type { TransformMode } from '../ShapePreview';
import type { SketchTool } from '../sketch/types';
import { loadCustomShortcuts, getEffectiveKey } from '../shortcutConfig';

export interface KeyboardShortcutDeps {
  isPreviewMode: boolean;
  handleCancelPreview: () => void;
  isSketchMode: boolean;
  setIsSketchMode: (v: boolean) => void;
  showAIAssistant: boolean;
  setShowAIAssistant: (v: boolean) => void;
  editMode: EditMode;
  setEditMode: (v: EditMode) => void;
  transformMode: TransformMode;
  setTransformMode: (v: TransformMode) => void;
  setMeasureActive: (fn: (prev: boolean) => boolean) => void;
  setShowDimensions: (fn: (prev: boolean) => boolean) => void;
  handleHistoryUndo: () => void;
  handleHistoryRedo: () => void;
  sketchTool: SketchTool;
  setSketchTool: (t: SketchTool) => void;
  // .nfab native project I/O
  handleSaveNfab: (forceSaveAs?: boolean) => void | Promise<void>;
  handleSaveNfabCloud: () => void | Promise<void>;
  handleLoadNfab: () => void | Promise<void>;
  // Sketch-specific redo (undo is handled internally by SketchCanvas via onUndo prop)
  handleSketchRedo?: () => void;
  // Context-aware help panel (? key)
  handleShowContextHelp?: () => void;
}

/**
 * 전역 키보드 단축키를 등록합니다.
 * page.tsx의 KEYBOARD SHORTCUTS 섹션에서 분리됨.
 * Single-character hotkeys respect user customizations from shortcutConfig / localStorage.
 */
export function useKeyboardShortcuts({
  isPreviewMode,
  handleCancelPreview,
  isSketchMode,
  setIsSketchMode,
  showAIAssistant,
  setShowAIAssistant,
  editMode,
  setEditMode,
  transformMode,
  setTransformMode,
  setMeasureActive,
  setShowDimensions,
  handleHistoryUndo,
  handleHistoryRedo,
  sketchTool,
  setSketchTool,
  handleSaveNfab,
  handleSaveNfabCloud,
  handleLoadNfab,
  handleSketchRedo,
  handleShowContextHelp,
}: KeyboardShortcutDeps) {

  // ── Custom key map (loaded once, refreshed on nexyfab:shortcuts-updated) ──
  const customKeysRef = useRef<Record<string, string>>({});

  useEffect(() => {
    customKeysRef.current = loadCustomShortcuts();
    const refresh = () => { customKeysRef.current = loadCustomShortcuts(); };
    window.addEventListener('nexyfab:shortcuts-updated', refresh);
    return () => window.removeEventListener('nexyfab:shortcuts-updated', refresh);
  }, []);

  // ── Main key handler ──
  useEffect(() => {
    const dispatchView = (view: string) => {
      window.dispatchEvent(new CustomEvent('nexyfab:view', { detail: view }));
    };

    /** Effective key for an action, lowercased. */
    const ck = (id: string) => getEffectiveKey(id, customKeysRef.current);

    const handler = (e: KeyboardEvent) => {
      // Skip if user is typing in an input
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;

      const k = e.key.toLowerCase();

      // Ctrl+K — command palette
      if (e.ctrlKey && e.key === 'k') { e.preventDefault(); useUIStore.getState().togglePanel('showCommandPalette'); return; }

      // Ctrl+Shift+S — cloud save (.nfab) — must check before Ctrl+S
      if (e.ctrlKey && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); void handleSaveNfabCloud(); return;
      }
      // Ctrl+S — local save (.nfab)
      if (e.ctrlKey && !e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault(); void handleSaveNfab(); return;
      }
      // Ctrl+O — open .nfab
      if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault(); void handleLoadNfab(); return;
      }

      // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — undo/redo
      // In sketch mode, SketchCanvas handles Ctrl+Z (calls onUndo). Only intercept redo here.
      if (e.ctrlKey && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (!isSketchMode) handleHistoryUndo();
        return;
      }
      if (e.ctrlKey && k === 'z' && e.shiftKey) {
        e.preventDefault();
        if (isSketchMode) handleSketchRedo?.(); else handleHistoryRedo();
        return;
      }
      if (e.ctrlKey && k === 'y') {
        e.preventDefault();
        if (isSketchMode) handleSketchRedo?.(); else handleHistoryRedo();
        return;
      }

      // Escape — cancel preview / exit modes
      // NOTE: SketchCanvas handles ESC first (in-progress draw + tool!==select → select).
      if (e.key === 'Escape') {
        if (isPreviewMode) { handleCancelPreview(); return; }
        if (editMode !== 'none') { setEditMode('none'); return; }
        if (transformMode !== 'off') { setTransformMode('off'); return; }
        if (isSketchMode) { setIsSketchMode(false); return; }
        if (showAIAssistant) { setShowAIAssistant(false); return; }
      }

      // ── Sketch mode: tool hotkeys ──
      if (isSketchMode && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // Build hotkey map dynamically from custom keys
        const sketchHotkeys: Record<string, SketchTool> = {
          [ck('sk_line')]:         'line',
          [ck('sk_arc')]:          'arc',
          [ck('sk_circle')]:       'circle',
          [ck('sk_rect')]:         'rect',
          [ck('sk_polygon')]:      'polygon',
          [ck('sk_ellipse')]:      'ellipse',
          [ck('sk_slot')]:         'slot',
          [ck('sk_fillet')]:       'fillet',
          [ck('sk_mirror')]:       'mirror',
          [ck('sk_construction')]: 'construction',
          [ck('sk_spline')]:       'spline',
          [ck('sk_offset')]:       'offset',
          [ck('sk_trim')]:         'trim',
          [ck('sk_select')]:       'select',
          [ck('sk_dimension')]:    'dimension',
        };
        const next = sketchHotkeys[k];
        if (next) {
          if (sketchTool !== next) setSketchTool(next);
          return;
        }
        // Sketch toggle key in sketch mode: swallow to prevent accidental exit.
        if (k === ck('sketch')) return;
        // Fall through only for '?' and 'escape'; swallow other 3D-viewport hotkeys.
        if (k !== '?' && k !== 'escape') return;
      }

      // ── 3D viewport hotkeys (only outside sketch mode) ──
      // 1/2/3 — edit mode (Vertex / Edge / Face) — Blender style
      if (e.key === '1' && !e.shiftKey) { setEditMode(editMode === 'vertex' ? 'none' : 'vertex'); return; }
      if (e.key === '2' && !e.shiftKey) { setEditMode(editMode === 'edge' ? 'none' : 'edge'); return; }
      if (e.key === '3' && !e.shiftKey) { setEditMode(editMode === 'face' ? 'none' : 'face'); return; }

      // Camera presets
      if (e.key === 'Home') { e.preventDefault(); dispatchView('fit'); return; }
      if (k === ck('view_fit') && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        dispatchView('fit');
        window.dispatchEvent(new Event('nexyfab:fit-camera'));
        return;
      }
      if (e.key === '7' && !e.shiftKey) { dispatchView('top'); return; }
      if (e.key === '5' && !e.shiftKey) { dispatchView('front'); return; }
      if (e.key === '6' && !e.shiftKey) { dispatchView('right'); return; }
      if (e.key === '0' && !e.shiftKey) { dispatchView('iso'); return; }
      // Numpad — Blender-style view set
      if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
        switch (e.key) {
          case 'Numpad1': dispatchView('front'); return;
          case 'Numpad2': dispatchView('back'); return;
          case 'Numpad3': dispatchView('right'); return;
          case 'Numpad4': dispatchView('left'); return;
          case 'Numpad7': dispatchView('top'); return;
          case 'Numpad8': dispatchView('bottom'); return;
          case 'Numpad0': dispatchView('iso'); return;
        }
      }

      // Transform gizmos
      if (k === ck('translate') && !e.ctrlKey) { setTransformMode(transformMode === 'translate' ? 'off' : 'translate'); return; }
      if (k === ck('rotate')    && !e.ctrlKey) { setTransformMode(transformMode === 'rotate'    ? 'off' : 'rotate');    return; }
      if (k === ck('scale')     && !e.ctrlKey) { setTransformMode(transformMode === 'scale'     ? 'off' : 'scale');     return; }

      // Mode toggles
      if (k === ck('sketch')  && !e.ctrlKey) { setIsSketchMode(!isSketchMode); return; }
      if (k === ck('measure'))                { setMeasureActive(v => !v); return; }
      if (k === ck('dims'))                   { setShowDimensions(d => !d); return; }
      if (k === ck('perf'))                   { useUIStore.getState().togglePanel('showPerf'); return; }

      // ? — context-aware help (falls back to shortcut panel if no handler provided)
      if (e.key === '?') {
        if (handleShowContextHelp) { handleShowContextHelp(); }
        else { useUIStore.getState().togglePanel('showShortcuts'); }
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    isPreviewMode, handleCancelPreview,
    isSketchMode, setIsSketchMode,
    showAIAssistant, setShowAIAssistant,
    editMode, setEditMode,
    transformMode, setTransformMode,
    setMeasureActive, setShowDimensions,
    handleHistoryUndo, handleHistoryRedo,
    sketchTool, setSketchTool,
    handleSaveNfab, handleSaveNfabCloud, handleLoadNfab,
    handleSketchRedo, handleShowContextHelp,
  ]);
}
