/**
 * reportPdfMetadataExtractor.ts — Extract structured inspection
 * metadata from a PDF report text dump.
 *
 * Inspection reports often arrive as scanned/typeset PDFs. After
 * the consumer has run pdf-to-text, the result is plain text. This
 * module finds:
 *
 *   - Part number (PN-XXXX, P/N XXXX).
 *   - Drawing number (DWG-XXXX).
 *   - Revision (REV X / RV.X).
 *   - Date of inspection.
 *   - Inspector name (after "Inspected by:" etc).
 *   - GD&T callouts (FCF strings).
 *   - Pass / fail summary.
 *
 * Returns a normalized record + a confidence score per field.
 */

export interface PdfMetadata {
  partNumber?: string;
  drawingNumber?: string;
  revision?: string;
  inspectionDate?: string;       // ISO YYYY-MM-DD
  inspector?: string;
  gdtCallouts: string[];
  passFail?: 'pass' | 'fail';
  /** Confidence per field 0-1. */
  confidence: Record<string, number>;
  /** Warnings about ambiguous or missing data. */
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function extractMetadata(textDump: string): PdfMetadata {
  const result: PdfMetadata = {
    gdtCallouts: [],
    confidence: {},
    warnings: [],
  };

  // Part number.
  const pnMatch = textDump.match(/\b(?:P\/N|PN|Part\s*(?:No|#))[:\s]*([A-Z0-9-]{3,})/i);
  if (pnMatch) {
    result.partNumber = pnMatch[1]!.toUpperCase();
    result.confidence['partNumber'] = 0.9;
  } else {
    result.warnings.push('Part number not found.');
  }

  // Drawing number.
  const dwgMatch = textDump.match(/\b(?:DWG|DRG|Drawing\s*(?:No|#))[:\s]*([A-Z0-9-]{3,})/i);
  if (dwgMatch) {
    result.drawingNumber = dwgMatch[1]!.toUpperCase();
    result.confidence['drawingNumber'] = 0.9;
  }

  // Revision.
  const revMatch = textDump.match(/\b(?:REV|RV)[\s.]?([A-Z0-9]{1,3})\b/i);
  if (revMatch) {
    result.revision = revMatch[1]!.toUpperCase();
    result.confidence['revision'] = 0.85;
  }

  // Inspection date — match common formats.
  const dateMatch = textDump.match(/(?:Inspected|Date|Inspection\s*Date)[\s:]*([0-9]{1,4}[-/.][0-9]{1,2}[-/.][0-9]{1,4})/i);
  if (dateMatch) {
    const iso = parseDateToIso(dateMatch[1]!);
    if (iso) {
      result.inspectionDate = iso;
      result.confidence['inspectionDate'] = 0.85;
    } else {
      result.warnings.push(`Date ${dateMatch[1]} could not be parsed.`);
    }
  }

  // Inspector.
  const inspectorMatch = textDump.match(/Inspect(?:or|ed by)[:\s]*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
  if (inspectorMatch) {
    result.inspector = inspectorMatch[1]!.trim();
    result.confidence['inspector'] = 0.7;
  }

  // GD&T callouts: search for FCF patterns like ⊥ Ø0.1 A B C or pos|0.1|A.
  const fcfRegex = /([⊥▱∠⌭⊕⌖◎⌒][\s\d.A-Z|]+)/g;
  let m: RegExpExecArray | null;
  while ((m = fcfRegex.exec(textDump)) !== null) {
    if (m[1] !== undefined) result.gdtCallouts.push(m[1].trim());
  }
  if (result.gdtCallouts.length > 0) result.confidence['gdtCallouts'] = 0.6;

  // Pass / fail.
  if (/\bPASS(?:ED)?\b/i.test(textDump)) {
    result.passFail = 'pass';
    result.confidence['passFail'] = 0.85;
  } else if (/\bFAIL(?:ED)?\b/i.test(textDump)) {
    result.passFail = 'fail';
    result.confidence['passFail'] = 0.85;
  }

  return result;
}

// ── Date parser ───────────────────────────────────────────────

function parseDateToIso(raw: string): string | null {
  const sep = raw.includes('-') ? '-' : raw.includes('/') ? '/' : '.';
  const parts = raw.split(sep).map(p => p.trim());
  if (parts.length !== 3) return null;
  // Detect YYYY-MM-DD vs DD-MM-YYYY heuristically.
  let yyyy: string, mm: string, dd: string;
  if (parts[0]!.length === 4) {
    [yyyy, mm, dd] = parts as [string, string, string];
  } else if (parts[2]!.length === 4) {
    [dd, mm, yyyy] = parts as [string, string, string];
  } else {
    return null;
  }
  const y = parseInt(yyyy, 10);
  const m = parseInt(mm, 10);
  const d = parseInt(dd, 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
}

// ── Multi-document scoring ────────────────────────────────────

export interface ExtractionResult {
  metadata: PdfMetadata;
  confidenceMean: number;
  /** Number of fields with non-null value. */
  completeness: number;
}

export function scoreExtraction(metadata: PdfMetadata): ExtractionResult {
  const values = Object.values(metadata.confidence);
  const mean = values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
  const completeness = countNonNullFields(metadata);
  return { metadata, confidenceMean: mean, completeness };
}

function countNonNullFields(m: PdfMetadata): number {
  let count = 0;
  if (m.partNumber) count++;
  if (m.drawingNumber) count++;
  if (m.revision) count++;
  if (m.inspectionDate) count++;
  if (m.inspector) count++;
  if (m.gdtCallouts.length > 0) count++;
  if (m.passFail) count++;
  return count;
}

// ── Summary ────────────────────────────────────────────────────

export interface MetadataSummary {
  completeness: number;
  confidenceMean: number;
  passFail?: 'pass' | 'fail';
  warningCount: number;
}

export function summarize(metadata: PdfMetadata): MetadataSummary {
  const scored = scoreExtraction(metadata);
  const result: MetadataSummary = {
    completeness: scored.completeness,
    confidenceMean: scored.confidenceMean,
    warningCount: metadata.warnings.length,
  };
  if (metadata.passFail) result.passFail = metadata.passFail;
  return result;
}
