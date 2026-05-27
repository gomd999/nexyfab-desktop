/**
 * fileNamingCompliance.ts — PDM file-naming compliance auditor.
 *
 * In a regulated PDM environment (ISO 9001 / AS9100 / IATF 16949)
 * every CAD file must conform to the company's naming policy:
 *
 *   - Project prefix (e.g., PRJ-1234-)
 *   - Drawing number block (e.g., DRG-0042)
 *   - Revision suffix (e.g., -RV03)
 *   - Allowed characters (typically A-Z 0-9 dash underscore)
 *   - Length cap (typically 64 chars)
 *   - File extension whitelist
 *
 * The auditor checks every file in a list against a policy and
 * returns violations + suggested-rename.
 */

export interface NamingPolicy {
  /** Regex for the full name (without extension). */
  pattern: RegExp;
  /** Human-readable template, e.g. "PRJ-1234-DRG-0042-RV03". */
  template: string;
  /** Maximum length (including extension). */
  maxLength: number;
  /** Allowed file extensions (lowercase). */
  allowedExtensions: string[];
  /** Allowed character class regex (excluding extension dot). */
  allowedCharsPattern: RegExp;
  /** Require uppercase letters. */
  enforceUppercase: boolean;
}

export const DEFAULT_POLICY: NamingPolicy = {
  pattern: /^PRJ-\d{4,}-DRG-\d{4,}(-RV\d{2,})?$/,
  template: 'PRJ-####-DRG-####-RVXX',
  maxLength: 64,
  allowedExtensions: ['step', 'stp', 'iges', 'igs', 'dwg', 'dxf', 'prt', 'sldprt', 'sldasm', 'pdf'],
  allowedCharsPattern: /^[A-Z0-9_-]+$/,
  enforceUppercase: true,
};

export interface FileEntry {
  id: string;
  /** Full file name (with extension). */
  name: string;
}

export type IssueKind = 'pattern-mismatch' | 'too-long' | 'bad-extension' | 'illegal-chars' | 'lowercase' | 'missing-extension';

export interface NamingViolation {
  fileId: string;
  fileName: string;
  issues: { kind: IssueKind; message: string }[];
  suggestedRename?: string;
}

// ── Top-level entry ────────────────────────────────────────────

export function auditNaming(files: FileEntry[], policy: NamingPolicy = DEFAULT_POLICY): NamingViolation[] {
  return files
    .map(file => audit(file, policy))
    .filter((v): v is NamingViolation => v !== null);
}

function audit(file: FileEntry, policy: NamingPolicy): NamingViolation | null {
  const issues: NamingViolation['issues'] = [];
  const { stem, ext } = splitName(file.name);

  if (!ext) {
    issues.push({ kind: 'missing-extension', message: 'File has no extension.' });
  } else if (!policy.allowedExtensions.includes(ext.toLowerCase())) {
    issues.push({ kind: 'bad-extension', message: `Extension .${ext} is not allowed.` });
  }

  if (file.name.length > policy.maxLength) {
    issues.push({ kind: 'too-long', message: `Name is ${file.name.length} chars (max ${policy.maxLength}).` });
  }

  if (!policy.allowedCharsPattern.test(stem)) {
    issues.push({ kind: 'illegal-chars', message: 'Name contains characters outside the allowed set.' });
  }

  if (policy.enforceUppercase && stem !== stem.toUpperCase()) {
    issues.push({ kind: 'lowercase', message: 'Name contains lowercase letters.' });
  }

  if (!policy.pattern.test(stem)) {
    issues.push({ kind: 'pattern-mismatch', message: `Name does not match template ${policy.template}.` });
  }

  if (issues.length === 0) return null;

  return {
    fileId: file.id,
    fileName: file.name,
    issues,
    suggestedRename: suggestRename(file.name, policy, stem, ext),
  };
}

function splitName(name: string): { stem: string; ext: string } {
  const idx = name.lastIndexOf('.');
  if (idx <= 0 || idx === name.length - 1) return { stem: name, ext: '' };
  return { stem: name.slice(0, idx), ext: name.slice(idx + 1) };
}

function suggestRename(_originalName: string, policy: NamingPolicy, stem: string, ext: string): string | undefined {
  // Best-effort: uppercase the stem, replace illegal chars with _, append placeholder if pattern still off.
  let suggested = stem;
  if (policy.enforceUppercase) suggested = suggested.toUpperCase();
  suggested = suggested.replace(/[^A-Z0-9_-]/g, '_');
  if (suggested.length > policy.maxLength - (ext ? ext.length + 1 : 0)) {
    suggested = suggested.slice(0, policy.maxLength - (ext ? ext.length + 1 : 0));
  }
  const safeExt = ext && policy.allowedExtensions.includes(ext.toLowerCase()) ? ext.toLowerCase() : policy.allowedExtensions[0]!;
  return ext ? `${suggested}.${safeExt}` : suggested;
}

// ── Bulk-level statistics ─────────────────────────────────────

export interface NamingStats {
  totalFiles: number;
  violationCount: number;
  byIssueKind: Record<IssueKind, number>;
  complianceRate: number;
}

export function stats(files: FileEntry[], policy: NamingPolicy = DEFAULT_POLICY): NamingStats {
  const violations = auditNaming(files, policy);
  const byIssue: Record<IssueKind, number> = {
    'pattern-mismatch': 0, 'too-long': 0, 'bad-extension': 0, 'illegal-chars': 0, 'lowercase': 0, 'missing-extension': 0,
  };
  for (const v of violations) {
    for (const i of v.issues) byIssue[i.kind]++;
  }
  return {
    totalFiles: files.length,
    violationCount: violations.length,
    byIssueKind: byIssue,
    complianceRate: files.length === 0 ? 1 : 1 - violations.length / files.length,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface NamingSummary {
  totalFiles: number;
  violationCount: number;
  complianceRate: number;
  worstFile?: string;
}

export function summarize(files: FileEntry[], policy: NamingPolicy = DEFAULT_POLICY): NamingSummary {
  const violations = auditNaming(files, policy);
  let worst: NamingViolation | undefined;
  for (const v of violations) {
    if (!worst || v.issues.length > worst.issues.length) worst = v;
  }
  const out: NamingSummary = {
    totalFiles: files.length,
    violationCount: violations.length,
    complianceRate: files.length === 0 ? 1 : 1 - violations.length / files.length,
  };
  if (worst) out.worstFile = worst.fileName;
  return out;
}
