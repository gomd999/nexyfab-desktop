'use client';

/**
 * SketchImportModal — SVG → sketch entities import dialog.
 *
 * Standalone modal that wraps `importSketchFromSvg` (lib/sketch/sketchSvgImport)
 * and provides two ingress paths so the user can either drop in a saved file
 * or paste markup from another tool:
 *
 *   1. File picker (<input type="file" accept=".svg, image/svg+xml">)
 *      — preferred path; reads via FileReader.readAsText. Works for SVG
 *        files emitted by our own SketchExportModal and by third-party
 *        tooling (Inkscape, LibreCAD) that the importer tolerates.
 *   2. Paste-text <textarea>
 *      — fallback for cases where the user has the SVG string but no file
 *        (clipboard, REST response, etc.). Trimmed before submission so
 *        accidental leading/trailing whitespace doesn't trip the "empty
 *        input" guard inside `importSketchFromSvg`.
 *
 * The modal NEVER touches the solver directly. It calls `onImport(entities)`
 * with a frozen `SketchEntities` snapshot and closes; the host editor is
 * responsible for mapping those entities into solver state. This keeps the
 * modal pure and side-effect-free for tests, and lets two different hosts
 * (SolverSketchEditor + future SketchEditor v1.lite) reuse the same dialog.
 *
 * Error / warning surface:
 *   - hard parse failure (no <svg>, unterminated tag, empty input)
 *     → red alert; Import button stays clickable so user can retry after
 *       editing the textarea
 *   - non-fatal warnings (unsupported <text>/<rect>, missing Y-flip wrapper,
 *     skipped element) → yellow alert WITH the import still completing.
 *       Closing happens via "Import" callback path on the host side; the
 *       modal hands the entities up alongside warnings if the host wants
 *       to surface them.
 *   - both can coexist (e.g. partial parse) — both panels render.
 *
 * Test surface (data-testids — all prefixed sketch-import-):
 *   sketch-import-modal, sketch-import-file, sketch-import-textarea,
 *   sketch-import-submit, sketch-import-cancel,
 *   sketch-import-warnings, sketch-import-warning-{idx},
 *   sketch-import-error.
 */

import React, { useCallback, useState } from 'react';
import {
  importSketchFromSvg,
  type SketchImportResult,
} from '@/lib/sketch/sketchSvgImport';
import type { SketchEntities } from '@/lib/sketch/sketchSvgExport';

export type SketchImportLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface SketchImportModalProps {
  lang: SketchImportLang;
  /**
   * Called when the user successfully parses an SVG and clicks Import. The
   * host is expected to (a) map entities into solver state, then (b)
   * implicitly close the modal — the modal also calls `onClose` after a
   * successful import so the host doesn't have to remember.
   */
  onImport: (entities: SketchEntities, warnings: ReadonlyArray<string>) => void;
  onClose: () => void;
}

// ─── i18n (6 langs) ──────────────────────────────────────────────────────

interface Dict {
  title: string;
  fileLabel: string;
  orPaste: string;
  pasteLabel: string;
  pastePlaceholder: string;
  import: string;
  cancel: string;
  warningsTitle: string;
  errorTitle: string;
  noInput: string;
  importSummary: (counts: { points: number; lines: number; circles: number; arcs: number }) => string;
}

const dict: Record<SketchImportLang, Dict> = {
  en: {
    title: 'Import SVG',
    fileLabel: 'SVG file',
    orPaste: 'or',
    pasteLabel: 'Paste SVG markup',
    pastePlaceholder: '<svg xmlns="http://www.w3.org/2000/svg"> ...',
    import: 'Import',
    cancel: 'Cancel',
    warningsTitle: 'Warnings',
    errorTitle: 'Error',
    noInput: 'Choose a file or paste SVG markup first.',
    importSummary: (c) =>
      `Imported ${c.points} point(s), ${c.lines} line(s), ${c.circles} circle(s), ${c.arcs} arc(s).`,
  },
  ko: {
    title: 'SVG 가져오기',
    fileLabel: 'SVG 파일',
    orPaste: '또는',
    pasteLabel: 'SVG 마크업 붙여넣기',
    pastePlaceholder: '<svg xmlns="http://www.w3.org/2000/svg"> ...',
    import: '가져오기',
    cancel: '취소',
    warningsTitle: '경고',
    errorTitle: '오류',
    noInput: '파일을 선택하거나 SVG 마크업을 붙여넣으세요.',
    importSummary: (c) =>
      `점 ${c.points}개, 선 ${c.lines}개, 원 ${c.circles}개, 호 ${c.arcs}개 가져옴.`,
  },
  ja: {
    title: 'SVGインポート',
    fileLabel: 'SVGファイル',
    orPaste: 'または',
    pasteLabel: 'SVGマークアップを貼り付け',
    pastePlaceholder: '<svg xmlns="http://www.w3.org/2000/svg"> ...',
    import: 'インポート',
    cancel: 'キャンセル',
    warningsTitle: '警告',
    errorTitle: 'エラー',
    noInput: 'ファイルを選ぶか、SVGマークアップを貼り付けてください。',
    importSummary: (c) =>
      `点 ${c.points}件, 線 ${c.lines}件, 円 ${c.circles}件, 弧 ${c.arcs}件 をインポート。`,
  },
  zh: {
    title: '导入SVG',
    fileLabel: 'SVG文件',
    orPaste: '或',
    pasteLabel: '粘贴SVG标记',
    pastePlaceholder: '<svg xmlns="http://www.w3.org/2000/svg"> ...',
    import: '导入',
    cancel: '取消',
    warningsTitle: '警告',
    errorTitle: '错误',
    noInput: '请选择文件或粘贴SVG标记。',
    importSummary: (c) =>
      `已导入 ${c.points} 点 / ${c.lines} 线 / ${c.circles} 圆 / ${c.arcs} 弧。`,
  },
  es: {
    title: 'Importar SVG',
    fileLabel: 'Archivo SVG',
    orPaste: 'o',
    pasteLabel: 'Pegar marcado SVG',
    pastePlaceholder: '<svg xmlns="http://www.w3.org/2000/svg"> ...',
    import: 'Importar',
    cancel: 'Cancelar',
    warningsTitle: 'Advertencias',
    errorTitle: 'Error',
    noInput: 'Elige un archivo o pega el marcado SVG.',
    importSummary: (c) =>
      `Importado: ${c.points} pts, ${c.lines} líneas, ${c.circles} círcs, ${c.arcs} arcos.`,
  },
  ar: {
    title: 'استيراد SVG',
    fileLabel: 'ملف SVG',
    orPaste: 'أو',
    pasteLabel: 'الصق ترميز SVG',
    pastePlaceholder: '<svg xmlns="http://www.w3.org/2000/svg"> ...',
    import: 'استيراد',
    cancel: 'إلغاء',
    warningsTitle: 'تحذيرات',
    errorTitle: 'خطأ',
    noInput: 'اختر ملفًا أو ألصق ترميز SVG.',
    importSummary: (c) =>
      `تم استيراد ${c.points} نقطة و${c.lines} خط و${c.circles} دائرة و${c.arcs} قوس.`,
  },
};

// ─── component ───────────────────────────────────────────────────────────

export default function SketchImportModal({
  lang,
  onImport,
  onClose,
}: SketchImportModalProps): React.ReactElement {
  const t = dict[lang];

  // The currently-staged source text. Populated either from the file picker
  // (FileReader read) or from direct typing into the textarea. We keep the
  // raw textarea in sync so the user can edit a loaded file's contents
  // before submission.
  const [source, setSource] = useState<string>('');
  // Display-only filename of the most recently selected file (or empty if
  // user typed into the textarea). Surface in the file input row so the
  // current selection is visible.
  const [, setFilename] = useState<string>('');
  // Parse result drives the alert panels. Cleared each time the user
  // mutates the input so stale warnings/errors don't linger.
  const [result, setResult] = useState<SketchImportResult | null>(null);
  // Local-only error for "no input chosen" — distinct from importer errors
  // because we don't want to trip the importer for an empty submission.
  const [localError, setLocalError] = useState<string | null>(null);

  // ─── file picker handler ───
  const handleFile = useCallback((evt: React.ChangeEvent<HTMLInputElement>): void => {
    const file = evt.target.files?.[0];
    if (!file) return;
    setFilename(file.name);
    setLocalError(null);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (): void => {
      const text = String(reader.result ?? '');
      setSource(text);
    };
    reader.onerror = (): void => {
      setLocalError(reader.error?.message ?? 'file read failed');
    };
    reader.readAsText(file);
  }, []);

  // ─── textarea handler ───
  const handlePaste = useCallback((evt: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setSource(evt.target.value);
    setFilename('');
    setLocalError(null);
    setResult(null);
  }, []);

  // ─── submit ───
  // Importer never throws — all failure modes come back as
  // `{ok:false, error}`. On success we call onImport + close; on hard error
  // we keep the modal open so the user can fix and retry.
  const handleImport = useCallback((): void => {
    if (source.trim().length === 0) {
      setLocalError(t.noInput);
      return;
    }
    setLocalError(null);
    const r = importSketchFromSvg(source);
    setResult(r);
    if (r.ok && r.entities) {
      onImport(r.entities, r.warnings);
      onClose();
    }
  }, [source, t.noInput, onImport, onClose]);

  // ─── derived UI flags ───
  const warnings = result?.warnings ?? [];
  const hardError = result && !result.ok ? result.error ?? 'unknown error' : null;

  return (
    <div
      data-testid="sketch-import-modal"
      role="dialog"
      aria-label={t.title}
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        fontFamily: 'system-ui, sans-serif',
      }}
      onClick={(e) => {
        // Backdrop click closes — but only when the actual click target IS
        // the backdrop, never a descendant. Matches sibling modals (Export,
        // Step, etc.) so muscle memory is consistent.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 20,
          minWidth: 460,
          maxWidth: 560,
          maxHeight: '88vh',
          overflow: 'auto',
          boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h2
          data-testid="sketch-import-title"
          style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}
        >
          {t.title}
        </h2>

        {/* File picker row */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: '#374151', fontWeight: 500 }}>{t.fileLabel}</span>
          <input
            type="file"
            accept=".svg,image/svg+xml"
            data-testid="sketch-import-file"
            onChange={handleFile}
            style={{ fontSize: 12 }}
          />
        </label>

        {/* visual separator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#9ca3af' }}>
          <span style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
          <span>{t.orPaste}</span>
          <span style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
        </div>

        {/* Paste textarea */}
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
          <span style={{ color: '#374151', fontWeight: 500 }}>{t.pasteLabel}</span>
          <textarea
            data-testid="sketch-import-textarea"
            value={source}
            onChange={handlePaste}
            placeholder={t.pastePlaceholder}
            rows={8}
            style={{
              fontFamily: 'monospace',
              fontSize: 11,
              padding: 6,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              resize: 'vertical',
            }}
          />
        </label>

        {/* Hard error alert (red) — importer reported ok:false OR local validation
            (no input chosen). Sits above warnings so the eye finds it first. */}
        {(hardError || localError) && (
          <div
            data-testid="sketch-import-error"
            role="alert"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              borderRadius: 4,
              padding: 8,
              fontSize: 12,
            }}
          >
            <strong style={{ marginRight: 6 }}>{t.errorTitle}:</strong>
            {hardError ?? localError}
          </div>
        )}

        {/* Non-fatal warnings (yellow). Present even on successful imports
            when unsupported elements were skipped. Rendered as a list so
            each individual warning is independently selectable / testable. */}
        {warnings.length > 0 && (
          <div
            data-testid="sketch-import-warnings"
            role="alert"
            style={{
              background: '#fffbeb',
              border: '1px solid #fde68a',
              color: '#92400e',
              borderRadius: 4,
              padding: 8,
              fontSize: 12,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 4 }}>{t.warningsTitle}:</strong>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {warnings.map((w, i) => (
                <li key={i} data-testid={`sketch-import-warning-${i}`}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Action bar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            data-testid="sketch-import-cancel"
            style={{ padding: '6px 14px', fontSize: 12, background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            onClick={handleImport}
            data-testid="sketch-import-submit"
            style={{ padding: '6px 14px', fontSize: 12, background: '#2563eb', color: '#fff', border: '1px solid #2563eb', borderRadius: 4, cursor: 'pointer' }}
          >
            {t.import}
          </button>
        </div>
      </div>
    </div>
  );
}
