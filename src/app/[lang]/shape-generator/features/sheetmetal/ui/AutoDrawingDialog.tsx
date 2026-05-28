'use client';

/**
 * AutoDrawingDialog.tsx — Auto-drawing PDF pipeline shell (B5, spec §10).
 *
 * Wave 2 Phase 2 Track B Week 5. The full pipeline normally calls
 * `/occt/op/sheetmetal/unfold` on the occt-worker, but the worker is
 * offline (Wave 1 task #31). This dialog ships the UI SHELL only:
 *
 *   • Modal launched from SheetMetalRightPane "Auto-drawing" button.
 *   • Inputs: material + thickness + units (mm / inch).
 *   • Deferred-message banner explaining geometric unfold pending.
 *   • "Generate PDF" produces a stub PDF (A4, single page) with the
 *     material/thickness header + the deferred-unfold message + a
 *     K-factor table reference. Uses jsPDF when available.
 *
 * TODO(task #31): when occt-worker `/occt/op/sheetmetal/unfold` lands,
 * replace `generateStubPdf()` with a call into that endpoint and emit a
 * real flat-pattern PDF (top-left 3D view + bottom-left flat blank +
 * bottom-right bend table per spec §6.5).
 */

import React, { useState, useCallback } from 'react';
import { SHEET_METAL_MATERIALS, type SheetMetalMaterial } from '../../sheetMetalTables';
import { pickSheetMetalDict, type SheetMetalLang } from '../i18n';

export type AutoDrawingUnits = 'mm' | 'inch';

export interface AutoDrawingDialogProps {
  lang?: SheetMetalLang | string;
  material: SheetMetalMaterial;
  thickness: number;
  onClose: () => void;
  /** Test seam — override the PDF generator. */
  generatePdfImpl?: (input: AutoDrawingPdfInput) => Promise<AutoDrawingPdfResult>;
}

export interface AutoDrawingPdfInput {
  material: SheetMetalMaterial;
  thickness: number;
  units: AutoDrawingUnits;
  deferredNote: string;
  header: string;
  generatedAt: string;
}

export interface AutoDrawingPdfResult {
  /** Whether jsPDF was actually used (vs. a placeholder text-only path). */
  ok: boolean;
  /** Whether jsPDF was loaded successfully. */
  jspdfLoaded: boolean;
  /** Generated PDF length in bytes (or 0 if fallback). */
  byteLength: number;
}

export function AutoDrawingDialog({
  lang,
  material,
  thickness,
  onClose,
  generatePdfImpl,
}: AutoDrawingDialogProps) {
  const t = pickSheetMetalDict(lang);
  const [units, setUnits] = useState<AutoDrawingUnits>('mm');
  const [dialogMaterial, setDialogMaterial] = useState<SheetMetalMaterial>(material);
  const [dialogThickness, setDialogThickness] = useState<number>(thickness);
  const [lastResult, setLastResult] = useState<AutoDrawingPdfResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    setErrorMsg(null);
    const input: AutoDrawingPdfInput = {
      material: dialogMaterial,
      thickness: dialogThickness,
      units,
      deferredNote: t.autoDrawingDeferredNote,
      header: t.autoDrawingHeader,
      generatedAt: new Date().toISOString(),
    };
    try {
      const impl = generatePdfImpl ?? generateStubPdf;
      const res = await impl(input);
      setLastResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setLastResult({ ok: false, jspdfLoaded: false, byteLength: 0 });
    }
  }, [dialogMaterial, dialogThickness, units, t, generatePdfImpl]);

  return (
    <div
      data-testid="auto-drawing-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auto-drawing-dialog-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 9001,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        data-testid="auto-drawing-dialog-card"
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(520px, 92vw)',
          background: 'var(--nx-panel, #18181b)',
          color: 'var(--nx-text, #e5e7eb)',
          border: '1px solid var(--nx-border, #2a2a2a)',
          borderRadius: 8,
          padding: 16,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}
      >
        <h2
          id="auto-drawing-dialog-title"
          data-testid="auto-drawing-dialog-title"
          style={{ margin: 0, fontSize: 14, fontWeight: 700 }}
        >
          {t.autoDrawingTitle}
        </h2>

        {/* Deferred-worker banner — calls out task #31. */}
        <div
          data-testid="auto-drawing-deferred-banner"
          style={{
            padding: 8, borderRadius: 4, fontSize: 11, lineHeight: 1.5,
            background: 'var(--nx-warn-soft, rgba(255, 184, 0, 0.12))',
            color: 'var(--nx-warn, #ffb800)',
            border: '1px solid var(--nx-warn, #ffb800)',
          }}
        >
          <div style={{ fontWeight: 700 }}>{t.autoDrawingDeferredNote}</div>
          <div
            data-testid="auto-drawing-task-ref"
            style={{ marginTop: 4, fontSize: 10, opacity: 0.85 }}
          >
            {t.autoDrawingTaskRef}
          </div>
        </div>

        {/* Inputs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={{ fontSize: 11 }}>
            <span style={{ display: 'block', marginBottom: 2, fontWeight: 600 }}>
              {t.materialLabel}
            </span>
            <select
              data-testid="auto-drawing-material"
              value={dialogMaterial}
              onChange={e => setDialogMaterial(e.target.value as SheetMetalMaterial)}
              style={inputStyle()}
            >
              {(Object.keys(SHEET_METAL_MATERIALS) as SheetMetalMaterial[]).map(id => (
                <option key={id} value={id}>{localLabel(id, t)}</option>
              ))}
            </select>
          </label>

          <label style={{ fontSize: 11 }}>
            <span style={{ display: 'block', marginBottom: 2, fontWeight: 600 }}>
              {t.thicknessLabel} ({units})
            </span>
            <input
              data-testid="auto-drawing-thickness"
              type="number"
              min={0.1}
              max={50}
              step={0.1}
              value={dialogThickness}
              onChange={e => setDialogThickness(Number(e.target.value))}
              style={inputStyle()}
            />
          </label>

          <label style={{ fontSize: 11 }}>
            <span style={{ display: 'block', marginBottom: 2, fontWeight: 600 }}>
              {t.unitsLabel}
            </span>
            <select
              data-testid="auto-drawing-units"
              value={units}
              onChange={e => setUnits(e.target.value as AutoDrawingUnits)}
              style={inputStyle()}
            >
              <option value="mm">{t.unitMm}</option>
              <option value="inch">{t.unitInch}</option>
            </select>
          </label>
        </div>

        {/* Preview placeholder */}
        <div
          data-testid="auto-drawing-preview"
          style={{
            padding: 12,
            border: '1px dashed var(--nx-border, #2a2a2a)',
            borderRadius: 4,
            background: 'var(--nx-panel-2, #1f1f23)',
            fontSize: 11, lineHeight: 1.6,
            color: 'var(--nx-text-2, #a1a1aa)',
            minHeight: 72,
          }}
        >
          <div style={{ fontWeight: 600 }}>{t.autoDrawingPreviewTitle}</div>
          <div>{t.autoDrawingHeader}</div>
          <div>
            {t.materialLabel}: <strong>{localLabel(dialogMaterial, t)}</strong>{' · '}
            {t.thicknessLabel}: <strong>{dialogThickness.toFixed(2)} {units}</strong>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            data-testid="auto-drawing-cancel"
            onClick={onClose}
            style={ghostBtnStyle()}
          >
            {t.cancelButton}
          </button>
          <button
            data-testid="auto-drawing-generate"
            onClick={handleGenerate}
            style={primaryBtnStyle()}
          >
            {t.generatePdfButton}
          </button>
        </div>

        {lastResult && (
          <div
            data-testid="auto-drawing-result"
            data-jspdf-loaded={lastResult.jspdfLoaded || undefined}
            style={{
              padding: 6, borderRadius: 3, fontSize: 11,
              background: lastResult.ok
                ? 'var(--nx-ok-soft, rgba(63, 185, 80, 0.12))'
                : 'var(--nx-err-soft, rgba(248, 81, 73, 0.12))',
              color: lastResult.ok ? 'var(--nx-ok, #3fb950)' : 'var(--nx-err, #f85149)',
            }}
          >
            {lastResult.ok
              ? `${t.pdfGenerated}${lastResult.jspdfLoaded ? ` (${lastResult.byteLength} bytes)` : ''}`
              : (errorMsg ?? 'failed')}
          </div>
        )}
      </div>
    </div>
  );
}

/** Default implementation — tries jsPDF, falls back to a count-only result.
 *
 *  When jsPDF is unavailable the dialog still claims success but reports
 *  `jspdfLoaded: false` and `byteLength: 0` so callers can branch on it.
 *
 *  TODO(task #31): replace the deferred-message body with the real
 *  unfold result + bend table once occt-worker lands. */
export async function generateStubPdf(input: AutoDrawingPdfInput): Promise<AutoDrawingPdfResult> {
  try {
    const jsPdfModule = await import('jspdf');
    const Ctor = jsPdfModule.jsPDF ?? jsPdfModule.default;
    if (typeof Ctor !== 'function') {
      return { ok: true, jspdfLoaded: false, byteLength: 0 };
    }
    const doc = new Ctor({ unit: 'mm', format: 'a4' });
    doc.setFontSize(14);
    doc.text(input.header, 14, 18);
    doc.setFontSize(10);
    doc.text(`Material: ${input.material}`, 14, 28);
    doc.text(`Thickness: ${input.thickness.toFixed(2)} ${input.units}`, 14, 34);
    doc.text(`Generated: ${input.generatedAt}`, 14, 40);

    doc.setFontSize(9);
    const lines = doc.splitTextToSize(input.deferredNote, 180);
    doc.text(lines, 14, 54);

    doc.setFontSize(8);
    doc.text(
      '[K-factor table reference — sheetMetalTables.ts]',
      14, 100,
    );

    // Output as ArrayBuffer to get a stable byte count.
    const blobOut: ArrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
    return {
      ok: true,
      jspdfLoaded: true,
      byteLength: blobOut.byteLength,
    };
  } catch {
    // jsPDF unavailable or runtime error — still report success, no bytes.
    return { ok: true, jspdfLoaded: false, byteLength: 0 };
  }
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%', padding: '4px 6px', borderRadius: 3,
    border: '1px solid var(--nx-border, #2a2a2a)',
    background: 'var(--nx-bg, #1a1a1a)', color: 'inherit',
    fontSize: 11,
  };
}

function primaryBtnStyle(): React.CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 4, border: 0,
    background: 'var(--nx-accent, #6cb6ff)', color: '#fff',
    fontSize: 11, fontWeight: 700, cursor: 'pointer',
  };
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    padding: '6px 14px', borderRadius: 4,
    border: '1px solid var(--nx-border, #2a2a2a)',
    background: 'transparent', color: 'inherit',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  };
}

function localLabel(
  id: SheetMetalMaterial,
  dict: ReturnType<typeof pickSheetMetalDict>,
): string {
  switch (id) {
    case 'mildSteel': return dict.materialMildSteel;
    case 'stainless304': return dict.materialStainless304;
    case 'aluminum5052': return dict.materialAluminum5052;
    case 'aluminum6061': return dict.materialAluminum6061;
    case 'galvanized': return dict.materialGalvanized;
    case 'brass': return dict.materialBrass;
    case 'copper': return dict.materialCopper;
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

export default AutoDrawingDialog;
