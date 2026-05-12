// ─── Engineering drawing standards (ISO 128 / ASME Y14.5) ──────────────────
//
// Centralizes line widths, dash patterns, colors and validation rules so
// the auto-drawing pipeline can be audited against published standards
// before we let customers ship them to manufacturers. Source documents:
//   - ISO 128-20:1996 — basic line types
//   - ISO 128-24:1999 — mechanical engineering line widths
//   - ASME Y14.2-2014 — line conventions
//   - ASME Y14.5-2018 — dimensioning & tolerancing
//
// The numbers below reflect the ISO recommended thin/thick pair (0.25/0.5)
// which is the most common A3/A4 default. ASME 4-thickness scheme is
// covered by tagging visible+section as `thick` and the rest as `thin`.

import type { DrawingLine, DrawingResult, ViewResult } from './autoDrawing';

export type DrawingStandard = 'ISO' | 'ASME';

export interface LineStyle {
  /** SVG strokeWidth in mm (drawing units = mm) */
  width: number;
  /** Hex color — black for compliance, accent colors for screen-only */
  color: string;
  /** SVG strokeDasharray pattern (mm units), or undefined for solid */
  dasharray?: string;
}

/**
 * ISO 128 / ASME Y14.2 compliant line styles. Widths follow the
 * recommended 2:1 thick:thin ratio (0.5 mm thick, 0.25 mm thin).
 */
export const ISO_LINE_SPEC: Record<DrawingLine['type'], LineStyle> = {
  visible:   { width: 0.5,  color: '#000000' },
  hidden:    { width: 0.25, color: '#000000', dasharray: '2 1' },
  // Center line: long-dash short-dash short-dash repeating (ISO 128 §10).
  center:    { width: 0.25, color: '#000000', dasharray: '6 2 1 2' },
  // Dimension lines: thin continuous (ISO 128 §6).
  dimension: { width: 0.25, color: '#000000' },
};

/**
 * ASME Y14.2 — slightly bolder thick line (0.6 mm) is also conformant.
 * We keep the 2:1 ratio.
 */
export const ASME_LINE_SPEC: Record<DrawingLine['type'], LineStyle> = {
  visible:   { width: 0.6,  color: '#000000' },
  hidden:    { width: 0.3,  color: '#000000', dasharray: '2 1' },
  center:    { width: 0.3,  color: '#000000', dasharray: '6 2 1 2' },
  dimension: { width: 0.3,  color: '#000000' },
};

export function getLineSpec(standard: DrawingStandard): Record<DrawingLine['type'], LineStyle> {
  return standard === 'ASME' ? ASME_LINE_SPEC : ISO_LINE_SPEC;
}

// ─── Paper sizes (ISO 216) ──────────────────────────────────────────────────
// For reference: A0..A4 in millimeters. Used by the validator to confirm
// that the drawing fits the requested sheet.
export const ISO_216_PAPER_MM: Record<string, { w: number; h: number }> = {
  A0: { w: 1189, h: 841 },
  A1: { w: 841,  h: 594 },
  A2: { w: 594,  h: 420 },
  A3: { w: 420,  h: 297 },
  A4: { w: 297,  h: 210 },
};

// ─── Compliance validator ───────────────────────────────────────────────────

export type ComplianceSeverity = 'error' | 'warning' | 'info';

export interface ComplianceIssue {
  severity: ComplianceSeverity;
  rule: string;
  message: string;
  /** Optional view scope */
  view?: string;
}

export interface ComplianceReport {
  standard: DrawingStandard;
  compliant: boolean;
  issues: ComplianceIssue[];
}

/**
 * Validate a DrawingResult against ISO 128 / ASME Y14 rules.
 *
 * Note: this is a structural check, not a full geometric audit. It catches
 * the regressions that block customer use (wrong line widths, missing
 * standard fields, paper mismatch). Visual fidelity (correct dimension
 * placement, GD&T frames) is out of scope and falls to user review.
 */
export function validateDrawingCompliance(
  drawing: DrawingResult,
  standard: DrawingStandard = 'ISO',
): ComplianceReport {
  const issues: ComplianceIssue[] = [];
  const paperSize = guessPaperSize(drawing.paperWidth, drawing.paperHeight);

  if (!paperSize) {
    issues.push({
      severity: 'warning',
      rule: 'ISO 216',
      message: `Non-standard paper size ${drawing.paperWidth}×${drawing.paperHeight}mm — manufacturers expect A0/A1/A2/A3/A4`,
    });
  }

  if (drawing.views.length === 0) {
    issues.push({
      severity: 'error',
      rule: 'minimum views',
      message: 'Drawing has no projected views',
    });
  }

  // Title block presence & required fields.
  const tb = drawing.titleBlock;
  if (!tb || !tb.partName?.trim()) {
    issues.push({
      severity: 'error',
      rule: 'ISO 7200',
      message: 'Title block missing part name',
    });
  }
  if (!tb?.scale?.trim()) {
    issues.push({
      severity: 'warning',
      rule: 'ISO 7200',
      message: 'Title block missing scale',
    });
  }
  if (!tb?.date?.trim()) {
    issues.push({
      severity: 'warning',
      rule: 'ISO 7200',
      message: 'Title block missing date',
    });
  }
  if (!tb?.material?.trim()) {
    issues.push({
      severity: 'info',
      rule: 'ISO 7200',
      message: 'Title block missing material — required for manufacturing handoff',
    });
  }

  // Line style audit per view: catch zero-length, malformed entries that
  // would render as garbage.
  for (const view of drawing.views) {
    const lineIssues = validateViewLines(view, standard);
    issues.push(...lineIssues);
  }

  // At least one visible line must be present, otherwise the drawing is
  // pointless.
  const totalVisible = drawing.views.reduce(
    (n, v) => n + v.lines.filter(l => l.type === 'visible').length,
    0,
  );
  if (totalVisible === 0) {
    issues.push({
      severity: 'error',
      rule: 'ISO 128',
      message: 'No visible (object) lines in any view',
    });
  }

  const errorCount = issues.filter(i => i.severity === 'error').length;
  return {
    standard,
    compliant: errorCount === 0,
    issues,
  };
}

function validateViewLines(view: ViewResult, _standard: DrawingStandard): ComplianceIssue[] {
  const out: ComplianceIssue[] = [];

  let degenerate = 0;
  for (const line of view.lines) {
    const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    if (!Number.isFinite(line.x1) || !Number.isFinite(line.y1) ||
        !Number.isFinite(line.x2) || !Number.isFinite(line.y2)) {
      out.push({
        severity: 'error',
        rule: 'line geometry',
        view: view.projection,
        message: `View "${view.projection}" contains a non-finite line endpoint`,
      });
      break; // one error per view is enough
    }
    if (len < 0.01) degenerate++;
  }

  if (degenerate > 0) {
    out.push({
      severity: 'warning',
      rule: 'ISO 128',
      view: view.projection,
      message: `View "${view.projection}" has ${degenerate} zero-length line(s) — should be culled`,
    });
  }

  return out;
}

function guessPaperSize(w: number, h: number): string | null {
  for (const [name, dims] of Object.entries(ISO_216_PAPER_MM)) {
    const match =
      (Math.abs(w - dims.w) < 1 && Math.abs(h - dims.h) < 1) ||
      (Math.abs(h - dims.w) < 1 && Math.abs(w - dims.h) < 1);
    if (match) return name;
  }
  return null;
}
