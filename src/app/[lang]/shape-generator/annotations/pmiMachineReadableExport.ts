/**
 * pmiMachineReadableExport.ts — Export PMI annotations to machine-
 * readable formats per ISO 14306 (JT) / ASME Y14.41 / STEP AP242.
 *
 * The exporter generates:
 *
 *   - Structured JSON suitable for downstream tools.
 *   - Simplified STEP-like text fragment.
 *   - QIF (ASME Y14.41) XML-like fragment.
 *
 * Supports:
 *   - Dimensions (linear / angular / diameter / radius).
 *   - GD&T FCFs with datum chains.
 *   - Surface finish.
 *   - Notes attached to features.
 */

export type AnnotationKind = 'dimension' | 'gdt' | 'surface-finish' | 'note' | 'datum';

export interface PmiAnnotation {
  id: string;
  kind: AnnotationKind;
  featureId?: string;
  /** Nominal value when applicable. */
  nominal?: number;
  /** Tolerance ±. */
  plus?: number;
  minus?: number;
  /** Free text / FCF / etc. */
  text?: string;
  /** Datum chain. */
  datums?: string[];
  /** Material modifier (M / L / RFS). */
  modifier?: 'M' | 'L' | 'S';
}

export type ExportFormat = 'json' | 'step-text' | 'qif-xml';

export interface ExportOptions {
  format: ExportFormat;
  pretty: boolean;
  includeFeatureRefs: boolean;
}

export const DEFAULT_OPTIONS: ExportOptions = {
  format: 'json',
  pretty: true,
  includeFeatureRefs: true,
};

export interface ExportResult {
  format: ExportFormat;
  content: string;
  byteCount: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function exportPmi(annotations: PmiAnnotation[], options: Partial<ExportOptions> = {}): ExportResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  for (const a of annotations) {
    if (a.kind === 'dimension' && a.nominal === undefined) {
      warnings.push(`Dimension ${a.id} missing nominal value.`);
    }
  }
  let content: string;
  switch (opts.format) {
    case 'json':
      content = exportJson(annotations, opts);
      break;
    case 'step-text':
      content = exportStepText(annotations, opts);
      break;
    case 'qif-xml':
      content = exportQif(annotations, opts);
      break;
  }
  return { format: opts.format, content, byteCount: content.length, warnings };
}

// ── JSON ──────────────────────────────────────────────────────

function exportJson(annotations: PmiAnnotation[], opts: ExportOptions): string {
  const payload = {
    schema: 'pmi/0.1',
    annotationCount: annotations.length,
    annotations: opts.includeFeatureRefs ? annotations : annotations.map(stripFeatureRefs),
  };
  return JSON.stringify(payload, null, opts.pretty ? 2 : 0);
}

function stripFeatureRefs(a: PmiAnnotation): PmiAnnotation {
  const copy = { ...a };
  delete copy.featureId;
  return copy;
}

// ── STEP-like text ────────────────────────────────────────────

function exportStepText(annotations: PmiAnnotation[], _opts: ExportOptions): string {
  const lines: string[] = ['/* PMI export — simplified STEP AP242 fragment */', 'BEGIN PMI;'];
  for (const a of annotations) {
    lines.push(`  ${a.id}: ${a.kind.toUpperCase()} ${stepBody(a)};`);
  }
  lines.push('END PMI;');
  return lines.join('\n');
}

function stepBody(a: PmiAnnotation): string {
  switch (a.kind) {
    case 'dimension':
      return `value=${(a.nominal ?? 0).toFixed(4)} plus=${(a.plus ?? 0).toFixed(4)} minus=${(a.minus ?? 0).toFixed(4)}`;
    case 'gdt':
      return `symbol="${a.text ?? ''}" datums=[${(a.datums ?? []).join(',')}] modifier=${a.modifier ?? ''}`;
    case 'surface-finish':
      return `ra=${a.nominal ?? 0}`;
    case 'note':
      return `text="${a.text ?? ''}"`;
    case 'datum':
      return `letter="${a.text ?? ''}"`;
  }
}

// ── QIF XML-like ─────────────────────────────────────────────

function exportQif(annotations: PmiAnnotation[], opts: ExportOptions): string {
  const indent = opts.pretty ? '  ' : '';
  const lines: string[] = [];
  lines.push('<QIF xmlns="http://qifstandards.org/xsd/qif3">');
  lines.push(`${indent}<Annotations count="${annotations.length}">`);
  for (const a of annotations) {
    lines.push(`${indent}${indent}<Annotation id="${a.id}" kind="${a.kind}">`);
    if (opts.includeFeatureRefs && a.featureId) lines.push(`${indent}${indent}${indent}<FeatureRef>${a.featureId}</FeatureRef>`);
    if (a.nominal !== undefined) lines.push(`${indent}${indent}${indent}<Nominal>${a.nominal}</Nominal>`);
    if (a.text) lines.push(`${indent}${indent}${indent}<Text>${escapeXml(a.text)}</Text>`);
    if (a.datums && a.datums.length > 0) lines.push(`${indent}${indent}${indent}<Datums>${a.datums.join(',')}</Datums>`);
    lines.push(`${indent}${indent}</Annotation>`);
  }
  lines.push(`${indent}</Annotations>`);
  lines.push('</QIF>');
  return lines.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case "'": return '&apos;';
      default: return c;
    }
  });
}

// ── Round-trip JSON validation ───────────────────────────────

export interface RoundTripResult {
  ok: boolean;
  parsedCount: number;
  error?: string;
}

export function roundTripJson(exported: ExportResult): RoundTripResult {
  if (exported.format !== 'json') return { ok: false, parsedCount: 0, error: 'Not JSON' };
  try {
    const parsed = JSON.parse(exported.content);
    return { ok: true, parsedCount: parsed.annotationCount ?? 0 };
  } catch (e) {
    return { ok: false, parsedCount: 0, error: String(e) };
  }
}

// ── Summary ────────────────────────────────────────────────────

export interface ExportSummary {
  format: ExportFormat;
  byteCount: number;
  annotationCount: number;
  warningCount: number;
}

export function summarize(annotations: PmiAnnotation[], result: ExportResult): ExportSummary {
  return {
    format: result.format,
    byteCount: result.byteCount,
    annotationCount: annotations.length,
    warningCount: result.warnings.length,
  };
}
