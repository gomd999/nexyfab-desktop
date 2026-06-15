/**
 * sheetTemplate — Phase 4.1.3 of NexyFab Pro own-CAD (ADR-013).
 *
 * Drawing sheet templates: standard engineering drawing format
 * (titleblock + revision history + border + scale notes). The template
 * layer is metadata-only at this batch — the actual SheetRenderer-side
 * drawing of titleblock cells, border strokes, and revision tables lives
 * in a separate renderer layer (Phase 4.1.4) that consumes this metadata.
 *
 * Design choices:
 *  - SheetTemplate is plain data: name + paperSize + optional titleblock,
 *    border, revisionHistory. No behavior on the type itself.
 *  - applyTemplate is a pure function: takes an existing Sheet, returns a
 *    new Sheet whose viewports + dimensions are preserved verbatim but
 *    whose paperSize is overridden to the template's and whose template
 *    metadata is attached under a `template` field that downstream
 *    renderers can pick up. We deliberately DO NOT modify sheet.ts to
 *    add a `template` field on the Sheet type; instead we cast through a
 *    TemplatedSheet alias that extends Sheet structurally.
 *  - buildSheetFromTemplate is the convenience entry point used by Hub /
 *    Drawing UI when a user picks "New drawing from template".
 *  - TEMPLATES exports 4 baked-in templates; consumers can deep-clone via
 *    structured-clone if they need a mutable starting point.
 *
 * Out of scope (Phase 4.1.4+):
 *  - SVG / DXF / PDF cells for the titleblock — separate renderer layer.
 *  - Custom user-defined templates persisted to PDM (Phase 4.3).
 *  - Per-sheet template overrides on a multi-sheet drawing document.
 */

import { standardThreeViewSheet, type PaperSize, type Sheet } from './sheet';

// ─── template type ───────────────────────────────────────────────────────

export interface SheetTemplateTitleblock {
  title?: string;
  drawnBy?: string;
  checkedBy?: string;
  date?: string;
  scale?: string;
  sheetNumber?: string;
  project?: string;
}

export interface SheetTemplateBorder {
  /** Margin from paper edge to border line (mm). */
  margin: number;
  /** Border line stroke width (mm). */
  strokeWidth: number;
}

export interface SheetTemplateRevision {
  rev: string;
  description: string;
  date: string;
  by: string;
}

export interface SheetTemplate {
  /** Stable name used as the key in {@link TEMPLATES}. */
  name: string;
  /**
   * Paper size the template expects. {@link applyTemplate} will override
   * the input Sheet's paperSize to match — keep this consistent with
   * downstream renderer assumptions (titleblock cell sizes scale to the
   * paper).
   */
  paperSize: Exclude<PaperSize, 'custom'>;
  /** Titleblock anchored at bottom-right by convention. */
  titleblock?: SheetTemplateTitleblock;
  /** Border lines around the printable area. */
  border?: SheetTemplateBorder;
  /** Revision history table (newest entry last). */
  revisionHistory?: ReadonlyArray<SheetTemplateRevision>;
}

/**
 * Structural extension of Sheet that carries the template metadata.
 * SheetRenderer reads `sheet.template` if present and lays down the
 * titleblock / border / revision table on its own layer.
 */
export interface TemplatedSheet extends Sheet {
  template?: SheetTemplate;
}

// ─── pure functions ──────────────────────────────────────────────────────

/**
 * Attach a template to an existing sheet. The sheet's viewports,
 * dimensions, and GD&T callouts are preserved verbatim. The paperSize is
 * overridden to the template's (so the renderer's titleblock layout is
 * consistent with the IR's paper dimensions).
 *
 * Pure: returns a NEW Sheet object; does not mutate the input.
 */
export function applyTemplate(sheet: Sheet, template: SheetTemplate): TemplatedSheet {
  return {
    ...sheet,
    paperSize: template.paperSize,
    // customPaper is dropped because templates always specify a standard
    // A-series size; leaving a stale customPaper would confuse
    // paperDimensions().
    customPaper: undefined,
    template: cloneTemplate(template),
  };
}

/**
 * Build a fresh standard 3-view sheet (front/top/right/iso) for the given
 * source model, then apply the template. Scale defaults to 1:1 — callers
 * who need a non-unit scale should build via {@link standardThreeViewSheet}
 * then call {@link applyTemplate} themselves.
 */
export function buildSheetFromTemplate(template: SheetTemplate, sourceId: string): TemplatedSheet {
  const base = standardThreeViewSheet({
    id: `sheet-${template.name}-${sourceId}`,
    name: template.titleblock?.title ?? template.name,
    sourceId,
    paperSize: template.paperSize,
    scale: 1,
  });
  return applyTemplate(base, template);
}

// ─── template registry ──────────────────────────────────────────────────

/** Deep-clone a template so the registry is never aliased into a Sheet. */
function cloneTemplate(template: SheetTemplate): SheetTemplate {
  return {
    name: template.name,
    paperSize: template.paperSize,
    titleblock: template.titleblock ? { ...template.titleblock } : undefined,
    border: template.border ? { ...template.border } : undefined,
    revisionHistory: template.revisionHistory
      ? template.revisionHistory.map((r) => ({ ...r }))
      : undefined,
  };
}

const ENGINEERING: SheetTemplate = {
  name: 'engineering',
  paperSize: 'A3',
  titleblock: {
    title: 'UNTITLED',
    drawnBy: '',
    checkedBy: '',
    date: '',
    scale: '1:1',
    sheetNumber: '1/1',
    project: '',
  },
  border: { margin: 10, strokeWidth: 0.5 },
  revisionHistory: [],
};

const ARCHITECTURAL: SheetTemplate = {
  name: 'architectural',
  paperSize: 'A1',
  titleblock: {
    title: 'UNTITLED',
    drawnBy: '',
    checkedBy: '',
    date: '',
    scale: '1:50',
    sheetNumber: 'A-001',
    project: '',
  },
  border: { margin: 15, strokeWidth: 0.7 },
  revisionHistory: [],
};

const MINIMAL: SheetTemplate = {
  name: 'minimal',
  paperSize: 'A4',
  // No titleblock, no border, no revision history — just paper + viewports.
};

const ISO_A3: SheetTemplate = {
  name: 'iso-a3',
  paperSize: 'A3',
  titleblock: {
    title: 'ISO 7200',
    drawnBy: '',
    checkedBy: '',
    date: '',
    scale: '1:1',
    sheetNumber: '1/1',
    project: '',
  },
  border: { margin: 10, strokeWidth: 0.35 },
  revisionHistory: [],
};

export const TEMPLATES: Readonly<Record<string, SheetTemplate>> = Object.freeze({
  engineering: ENGINEERING,
  architectural: ARCHITECTURAL,
  minimal: MINIMAL,
  isoA3: ISO_A3,
});
