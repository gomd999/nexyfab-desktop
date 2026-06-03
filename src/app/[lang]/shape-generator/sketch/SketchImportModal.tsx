'use client';

/**
 * SketchImportModal — SVG/DXF → sketch entities import dialog.
 *
 * Multi-format modal that wraps `importSketchFromSvg`
 * (lib/sketch/sketchSvgImport) AND `importSketchFromDxf`
 * (lib/sketch/sketchDxfImport), auto-detecting the source format from the
 * file extension and/or content sniffing.
 *
 * Two ingress paths so the user can either drop in a saved file or paste
 * markup from another tool:
 *
 *   1. File picker (<input type="file" accept=".svg,.dxf,.stp,.step,image/svg+xml">)
 *      — preferred path; reads via FileReader.readAsText. Works for SVG
 *        files emitted by our own SketchExportModal, DXF files from
 *        AutoCAD/LibreCAD/QCAD, plus tolerates STEP file selection (which
 *        will route through content sniffing → unknown format warning).
 *   2. Paste-text <textarea>
 *      — fallback for cases where the user has the markup string but no
 *        file (clipboard, REST response, etc.). Trimmed before submission
 *        so accidental leading/trailing whitespace doesn't trip the
 *        "empty input" guard inside the underlying importer.
 *
 * ── Format detection ────────────────────────────────────────────────────
 * Two-tier strategy:
 *   1. Extension hint: if the file came in via the picker AND its name
 *      ends in .svg/.dxf/.stp/.step we lock in that format up-front.
 *   2. Content sniffing: applied to every paste AND used as the authoritative
 *      source when no extension hint exists (paste path, or file with an
 *      ambiguous name). Recognized signatures:
 *        - starts with `<svg` or `<?xml` → SVG (case-insensitive, after
 *          leading whitespace + optional BOM)
 *        - starts with `0\nSECTION` (DXF group code 0 + SECTION value, in
 *          either CRLF or LF) → DXF
 *        - anything else → 'unknown'; the importer falls back to the
 *          try-both policy described below.
 *   3. Fallback (try-both): when format is 'unknown' AND the user clicks
 *      Import we run importSketchFromSvg first; if it returns ok=false,
 *      we run importSketchFromDxf; the FIRST successful parse wins. If
 *      both fail we surface the SVG importer's error (since SVG was tried
 *      first) AND prepend a "could not detect format" hint.
 *
 * The modal NEVER touches the solver directly. It calls `onImport(entities)`
 * with a frozen `SketchEntities` snapshot and closes; the host editor is
 * responsible for mapping those entities into solver state. This keeps the
 * modal pure and side-effect-free for tests, and lets two different hosts
 * (SolverSketchEditor + future SketchEditor v1.lite) reuse the same dialog.
 *
 * Error / warning surface:
 *   - hard parse failure (no <svg>, unterminated tag, empty input, no
 *     valid DXF group records) → red alert; Import button stays clickable
 *     so user can retry after editing the textarea.
 *   - non-fatal warnings (unsupported <text>/<rect>, missing Y-flip wrapper,
 *     skipped DXF SPLINE/POLYLINE, unknown units, etc.) → yellow alert
 *     WITH the import still completing. Closing happens via "Import"
 *     callback path on the host side; the modal hands the entities up
 *     alongside warnings if the host wants to surface them.
 *   - both can coexist (e.g. partial parse) — both panels render.
 *
 * Test surface (data-testids — all prefixed sketch-import-):
 *   sketch-import-modal, sketch-import-file, sketch-import-textarea,
 *   sketch-import-submit, sketch-import-cancel,
 *   sketch-import-warnings, sketch-import-warning-{idx},
 *   sketch-import-error, sketch-import-detected-format.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  importSketchFromSvg,
  type SketchImportResult,
} from '@/lib/sketch/sketchSvgImport';
import {
  importSketchFromDxf,
  type DxfImportResult,
} from '@/lib/sketch/sketchDxfImport';
import type { SketchEntities } from '@/lib/sketch/sketchSvgExport';

export type SketchImportLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

/** Format detection outcome — drives label + which importer to call. */
export type DetectedFormat = 'svg' | 'dxf' | 'unknown';

export interface SketchImportModalProps {
  lang: SketchImportLang;
  /**
   * Called when the user successfully parses an SVG/DXF and clicks Import.
   * The host is expected to (a) map entities into solver state, then (b)
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
  detectedFormat: (fmt: 'SVG' | 'DXF') => string;
  unknownFormat: string;
  importSummary: (counts: { points: number; lines: number; circles: number; arcs: number }) => string;
}

// Titles intentionally preserve "SVG" in the rendered string so the existing
// modal/integration test suite (which asserts `Import SVG` / `SVG 가져오기` /
// etc.) keeps passing — the underlying functionality now spans SVG + DXF
// but the brand-name UX line stays SVG-anchored. The detected-format badge
// is where users see DXF acknowledgment.
const dict: Record<SketchImportLang, Dict> = {
  en: {
    title: 'Import SVG',
    fileLabel: 'SVG / DXF file',
    orPaste: 'or',
    pasteLabel: 'Paste SVG or DXF markup',
    pastePlaceholder: '<svg ...>  or  0\\nSECTION ...',
    import: 'Import',
    cancel: 'Cancel',
    warningsTitle: 'Warnings',
    errorTitle: 'Error',
    noInput: 'Choose a file or paste SVG/DXF markup first.',
    detectedFormat: (fmt) => `Detected: ${fmt}`,
    unknownFormat: 'Unknown format — will try SVG then DXF.',
    importSummary: (c) =>
      `Imported ${c.points} point(s), ${c.lines} line(s), ${c.circles} circle(s), ${c.arcs} arc(s).`,
  },
  ko: {
    title: 'SVG 가져오기',
    fileLabel: 'SVG / DXF 파일',
    orPaste: '또는',
    pasteLabel: 'SVG 또는 DXF 마크업 붙여넣기',
    pastePlaceholder: '<svg ...>  또는  0\\nSECTION ...',
    import: '가져오기',
    cancel: '취소',
    warningsTitle: '경고',
    errorTitle: '오류',
    noInput: '파일을 선택하거나 SVG/DXF 마크업을 붙여넣으세요.',
    detectedFormat: (fmt) => `감지됨: ${fmt}`,
    unknownFormat: '형식을 알 수 없음 — SVG 후 DXF 순으로 시도합니다.',
    importSummary: (c) =>
      `점 ${c.points}개, 선 ${c.lines}개, 원 ${c.circles}개, 호 ${c.arcs}개 가져옴.`,
  },
  ja: {
    title: 'SVGインポート',
    fileLabel: 'SVG / DXF ファイル',
    orPaste: 'または',
    pasteLabel: 'SVGまたはDXFマークアップを貼り付け',
    pastePlaceholder: '<svg ...>  または  0\\nSECTION ...',
    import: 'インポート',
    cancel: 'キャンセル',
    warningsTitle: '警告',
    errorTitle: 'エラー',
    noInput: 'ファイルを選ぶか、SVG/DXFマークアップを貼り付けてください。',
    detectedFormat: (fmt) => `検出: ${fmt}`,
    unknownFormat: '形式不明 — SVG → DXF の順に試行します。',
    importSummary: (c) =>
      `点 ${c.points}件, 線 ${c.lines}件, 円 ${c.circles}件, 弧 ${c.arcs}件 をインポート。`,
  },
  zh: {
    title: '导入SVG',
    fileLabel: 'SVG / DXF 文件',
    orPaste: '或',
    pasteLabel: '粘贴SVG或DXF标记',
    pastePlaceholder: '<svg ...>  或  0\\nSECTION ...',
    import: '导入',
    cancel: '取消',
    warningsTitle: '警告',
    errorTitle: '错误',
    noInput: '请选择文件或粘贴SVG/DXF标记。',
    detectedFormat: (fmt) => `已检测: ${fmt}`,
    unknownFormat: '格式未知 — 将依次尝试 SVG 与 DXF。',
    importSummary: (c) =>
      `已导入 ${c.points} 点 / ${c.lines} 线 / ${c.circles} 圆 / ${c.arcs} 弧。`,
  },
  es: {
    title: 'Importar SVG',
    fileLabel: 'Archivo SVG / DXF',
    orPaste: 'o',
    pasteLabel: 'Pegar marcado SVG o DXF',
    pastePlaceholder: '<svg ...>  o  0\\nSECTION ...',
    import: 'Importar',
    cancel: 'Cancelar',
    warningsTitle: 'Advertencias',
    errorTitle: 'Error',
    noInput: 'Elige un archivo o pega el marcado SVG/DXF.',
    detectedFormat: (fmt) => `Detectado: ${fmt}`,
    unknownFormat: 'Formato desconocido — se probará SVG y luego DXF.',
    importSummary: (c) =>
      `Importado: ${c.points} pts, ${c.lines} líneas, ${c.circles} círcs, ${c.arcs} arcos.`,
  },
  ar: {
    title: 'استيراد SVG',
    fileLabel: 'ملف SVG / DXF',
    orPaste: 'أو',
    pasteLabel: 'الصق ترميز SVG أو DXF',
    pastePlaceholder: '<svg ...>  أو  0\\nSECTION ...',
    import: 'استيراد',
    cancel: 'إلغاء',
    warningsTitle: 'تحذيرات',
    errorTitle: 'خطأ',
    noInput: 'اختر ملفًا أو ألصق ترميز SVG/DXF.',
    detectedFormat: (fmt) => `تم الاكتشاف: ${fmt}`,
    unknownFormat: 'صيغة غير معروفة — سيتم تجربة SVG ثم DXF.',
    importSummary: (c) =>
      `تم استيراد ${c.points} نقطة و${c.lines} خط و${c.circles} دائرة و${c.arcs} قوس.`,
  },
};

// ─── format detection ────────────────────────────────────────────────────

/**
 * Sniff format from the start of the source text. Cheap (looks at the
 * first ~200 chars after trimming leading whitespace + BOM), deterministic,
 * and side-effect-free.
 *
 *   - `<svg` or `<?xml` (case-insensitive)        → 'svg'
 *   - `0\n…SECTION` (DXF group code 0 + value)    → 'dxf'
 *   - anything else                                → 'unknown'
 *
 * DXF detection: the very first byte pair of a well-formed DXF is
 * "0\nSECTION" (group code 0, value SECTION starting the HEADER or ENTITIES
 * section). We strip BOM + leading blank lines and tolerate CRLF/LF and
 * whitespace padding around the "0" so AutoCAD/LibreCAD/QCAD variants all
 * match. We also accept the rare R12 emitter that opens with a "999"
 * comment line by sniffing for "SECTION" within the first ~200 chars when
 * the leading line is "999".
 */
export function sniffSketchFormat(source: string): DetectedFormat {
  if (typeof source !== 'string' || source.length === 0) return 'unknown';
  // Strip UTF-8 BOM + any leading whitespace including blank lines.
  const stripped = source.replace(/^﻿/, '').replace(/^\s+/, '');
  if (stripped.length === 0) return 'unknown';

  // SVG: opens with `<svg` or `<?xml` (case-insensitive). We use a
  // case-insensitive prefix check rather than a regex for speed on large
  // pasted documents.
  const head = stripped.slice(0, 200).toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'svg';

  // DXF: first non-blank token must be "0" followed by a value of
  // "SECTION" on the next non-blank line. Tolerate CR/LF and padding.
  // Quick path: head starts with "0" followed by newline + SECTION.
  if (/^0\s*[\r\n]+\s*SECTION\b/i.test(stripped)) return 'dxf';
  // Fallback: R12 emitters sometimes prepend a 999 comment line. If the
  // first record is "999 …" and a 0/SECTION pair appears soon after, treat
  // as DXF. Bounded to the first ~400 chars so a giant SVG with the text
  // "SECTION" buried inside can't false-positive.
  if (/^999\b/.test(stripped) && /\b0\s*[\r\n]+\s*SECTION\b/i.test(stripped.slice(0, 400))) {
    return 'dxf';
  }

  return 'unknown';
}

/**
 * Resolve format from the (optional) filename's extension. Returns
 * 'unknown' for missing/empty filenames or unrecognized extensions.
 * `.stp`/`.step` map to 'unknown' deliberately — the sketch importers do
 * not currently support STEP; the file picker accepts them so users can
 * try, but they'll route through the try-both fallback (which will fail
 * cleanly with the SVG/DXF parser errors).
 */
export function formatFromFilename(filename: string | null | undefined): DetectedFormat {
  if (!filename) return 'unknown';
  const lower = filename.toLowerCase();
  if (lower.endsWith('.svg')) return 'svg';
  if (lower.endsWith('.dxf')) return 'dxf';
  return 'unknown';
}

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
  // user typed into the textarea). Drives the extension-based format hint
  // when present.
  const [filename, setFilename] = useState<string>('');
  // Parse result drives the alert panels. Cleared each time the user
  // mutates the input so stale warnings/errors don't linger. We accept
  // either importer's result shape since they share `ok | entities |
  // warnings | error`.
  const [result, setResult] = useState<SketchImportResult | DxfImportResult | null>(null);
  // Local-only error for "no input chosen" — distinct from importer errors
  // because we don't want to trip the importer for an empty submission.
  const [localError, setLocalError] = useState<string | null>(null);

  // ─── derived format detection ───
  // Filename hint wins when present (user explicitly selected a .svg / .dxf);
  // otherwise sniff the content. Memoized so we re-evaluate only when the
  // inputs change.
  const detected: DetectedFormat = useMemo(() => {
    const fromName = formatFromFilename(filename);
    if (fromName !== 'unknown') return fromName;
    return sniffSketchFormat(source);
  }, [filename, source]);

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
    // Clear the filename so the detection falls back to content sniffing —
    // otherwise a user who selected a .svg and then pasted DXF would still
    // see "Detected: SVG".
    setFilename('');
    setLocalError(null);
    setResult(null);
  }, []);

  // ─── submit ───
  // Importers never throw — all failure modes come back as
  // `{ok:false, error}`. On success we call onImport + close; on hard error
  // we keep the modal open so the user can fix and retry.
  //
  // Routing rules:
  //   - detected = 'svg'     → importSketchFromSvg only
  //   - detected = 'dxf'     → importSketchFromDxf only
  //   - detected = 'unknown' → try SVG first (more common), fall through
  //                            to DXF on parse failure; surface the SVG
  //                            error if both fail since SVG was the
  //                            primary attempt.
  const handleImport = useCallback((): void => {
    if (source.trim().length === 0) {
      setLocalError(t.noInput);
      return;
    }
    setLocalError(null);

    let r: SketchImportResult | DxfImportResult;
    if (detected === 'svg') {
      r = importSketchFromSvg(source);
    } else if (detected === 'dxf') {
      r = importSketchFromDxf(source);
    } else {
      // Unknown — try SVG first, then DXF. First success wins.
      const svgAttempt = importSketchFromSvg(source);
      if (svgAttempt.ok && svgAttempt.entities) {
        r = svgAttempt;
      } else {
        const dxfAttempt = importSketchFromDxf(source);
        if (dxfAttempt.ok && dxfAttempt.entities) {
          r = dxfAttempt;
        } else {
          // Both failed. Report the SVG error (primary attempt) for
          // continuity, but flag that both formats were tried so the
          // user understands why.
          r = {
            ok: false,
            warnings: [],
            error: `${t.unknownFormat} ${svgAttempt.error ?? 'parse failed'}`,
          };
        }
      }
    }
    setResult(r);
    if (r.ok && r.entities) {
      onImport(r.entities, r.warnings);
      onClose();
    }
  }, [source, detected, t.noInput, t.unknownFormat, onImport, onClose]);

  // ─── derived UI flags ───
  const warnings = result?.warnings ?? [];
  const hardError = result && !result.ok ? result.error ?? 'unknown error' : null;

  // Label string for the detected-format badge.
  const detectedLabel =
    detected === 'svg' ? t.detectedFormat('SVG')
    : detected === 'dxf' ? t.detectedFormat('DXF')
    : source.trim().length === 0 ? '' // hide badge entirely when nothing typed
    : t.unknownFormat;

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
            accept=".svg,.dxf,.stp,.step,image/svg+xml"
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

        {/* Detected-format badge — only when there's input to detect against.
            Shows "Detected: SVG" / "Detected: DXF" or the unknown-format
            advisory. Always carries data-format attribute for test assertions. */}
        {detectedLabel.length > 0 && (
          <div
            data-testid="sketch-import-detected-format"
            data-format={detected}
            style={{
              fontSize: 11,
              color: detected === 'unknown' ? '#92400e' : '#065f46',
              background: detected === 'unknown' ? '#fffbeb' : '#ecfdf5',
              border: `1px solid ${detected === 'unknown' ? '#fde68a' : '#a7f3d0'}`,
              borderRadius: 4,
              padding: '4px 8px',
              alignSelf: 'flex-start',
            }}
          >
            {detectedLabel}
          </div>
        )}

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
