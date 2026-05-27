/**
 * gcodeDialectTranslator.ts — Convert G-code between CNC controller
 * dialects (Fanuc / Haas / Mach3 / LinuxCNC / Siemens).
 *
 * Each controller has its own quirks:
 *
 *   - Coordinate selection codes: Fanuc/Haas/Mach3 use G54-G59;
 *     Siemens uses G54 P1, P2, ... or named work offsets.
 *   - Spindle codes are shared (M3/M4/M5) but Haas adds M19 (orient),
 *     Mach3 M11/M10 for tool change probes.
 *   - End-of-program: Fanuc M30 vs Mach3 M2.
 *   - Program number: O1234 (Fanuc) vs % header (LinuxCNC).
 *   - Comment delimiters: `(...)` is universal but Mach3 also accepts `;`.
 *
 * The translator parses raw G-code (via simple line tokenizer) and
 * emits the same logical program in the target dialect, swapping
 * codes and adjusting the header / footer.
 */

import type { GCodeBlock } from './gcodeReader';
import { parseGCode } from './gcodeReader';

export type Dialect = 'fanuc' | 'haas' | 'mach3' | 'linuxcnc' | 'siemens';

export interface TranslateOptions {
  sourceDialect: Dialect;
  targetDialect: Dialect;
  /** Preserve original line numbers (N labels). */
  preserveLineNumbers: boolean;
  /** Program identifier (e.g., 1234 → O1234 or %_N_PART_MPF). */
  programNumber?: number;
  /** Optional rename map (e.g., replace M19 with M3 if target doesn't support orient). */
  symbolRewrites?: Record<string, string>;
}

export const DEFAULT_OPTIONS: TranslateOptions = {
  sourceDialect: 'fanuc',
  targetDialect: 'fanuc',
  preserveLineNumbers: false,
};

export interface TranslateResult {
  /** Translated G-code text. */
  output: string;
  /** Lines that could not be translated (preserved as-is). */
  unresolved: string[];
  /** Number of code substitutions made. */
  substitutionCount: number;
}

// ── Top-level entry ────────────────────────────────────────────

export function translate(source: string, options: Partial<TranslateOptions> = {}): TranslateResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const parsed = parseGCode(source);
  const lines: string[] = [];
  const unresolved: string[] = [];
  let subs = 0;

  // Header.
  lines.push(...buildHeader(opts));

  // Track which source lines were emitted as blocks; preserve comment-only lines.
  const blocksByLine = new Map<number, GCodeBlock>();
  for (const b of parsed.blocks) blocksByLine.set(b.lineNumber, b);
  const sourceLines = source.split(/\r?\n/);
  for (let i = 0; i < sourceLines.length; i++) {
    const lineNumber = i + 1;
    const block = blocksByLine.get(lineNumber);
    if (block) {
      const { line, substituted, ok } = emitBlock(block, opts);
      if (!ok) unresolved.push(block.raw);
      if (substituted) subs++;
      if (line.trim().length > 0) lines.push(line);
    } else {
      // Preserve comment-only or empty source lines that have a comment.
      const raw = sourceLines[i]!;
      const commentMatch = raw.match(/\([^)]*\)/);
      if (commentMatch) lines.push(commentMatch[0]);
    }
  }

  // Footer.
  lines.push(...buildFooter(opts));

  return { output: lines.join('\n'), unresolved, substitutionCount: subs };
}

// ── Header / footer ───────────────────────────────────────────

function buildHeader(opts: TranslateOptions): string[] {
  const out: string[] = [];
  switch (opts.targetDialect) {
    case 'fanuc':
    case 'haas':
      if (opts.programNumber !== undefined) out.push(`O${opts.programNumber}`);
      out.push('G21 G17 G90 G94');
      break;
    case 'mach3':
      out.push('%');
      if (opts.programNumber !== undefined) out.push(`O${opts.programNumber}`);
      out.push('G21 G17 G90');
      break;
    case 'linuxcnc':
      out.push('%');
      out.push('G21 G17 G90 G94');
      break;
    case 'siemens':
      out.push(';PROGRAM');
      out.push('G54 G17 G90 G94');
      break;
  }
  return out;
}

function buildFooter(opts: TranslateOptions): string[] {
  switch (opts.targetDialect) {
    case 'fanuc':
    case 'haas':
    case 'siemens':
      return ['M30'];
    case 'mach3':
      return ['M2', '%'];
    case 'linuxcnc':
      return ['M2', '%'];
  }
}

// ── Per-block emission ────────────────────────────────────────

function emitBlock(block: GCodeBlock, opts: TranslateOptions): { line: string; substituted: boolean; ok: boolean } {
  if (block.command === 'COMMENT') {
    return { line: block.raw, substituted: false, ok: true };
  }
  // Substitution table.
  const rewrites = opts.symbolRewrites ?? {};
  let cmd = block.command as string;
  let substituted = false;
  if (cmd in rewrites) {
    cmd = rewrites[cmd]!;
    substituted = true;
  } else {
    const auto = autoRewrite(block.command, opts);
    if (auto !== null) {
      cmd = auto;
      substituted = true;
    }
  }
  // Skip header/footer commands (we generate our own) but preserve substitution count.
  if (cmd === 'M30' || cmd === 'M2') {
    return { line: '', substituted, ok: true };
  }
  const tokens: string[] = [];
  if (opts.preserveLineNumbers) tokens.push(`N${block.lineNumber}`);
  tokens.push(cmd);
  for (const [letter, value] of Object.entries(block.params)) {
    tokens.push(`${letter}${formatNumber(value)}`);
  }
  return { line: tokens.join(' '), substituted, ok: true };
}

function autoRewrite(command: string, opts: TranslateOptions): string | null {
  // M30 → M2 for Mach3 / LinuxCNC handled in footer, here just signal.
  if (command === 'M30' && (opts.targetDialect === 'mach3' || opts.targetDialect === 'linuxcnc')) {
    return 'M2';
  }
  if (command === 'M2' && (opts.targetDialect === 'fanuc' || opts.targetDialect === 'haas' || opts.targetDialect === 'siemens')) {
    return 'M30';
  }
  // M0 (program stop) is universal.
  return null;
}

function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(4).replace(/\.?0+$/, '');
}

// ── Diff utility ──────────────────────────────────────────────

export interface TranslationDiff {
  identicalLines: number;
  changedLines: number;
  totalLines: number;
}

export function diffOriginal(source: string, translated: string): TranslationDiff {
  const a = source.split(/\r?\n/);
  const b = translated.split(/\r?\n/);
  const max = Math.max(a.length, b.length);
  let identical = 0;
  let changed = 0;
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) identical++;
    else changed++;
  }
  return { identicalLines: identical, changedLines: changed, totalLines: max };
}

// ── Summary ────────────────────────────────────────────────────

export interface TranslateSummary {
  outputLineCount: number;
  unresolvedCount: number;
  substitutionCount: number;
  successFraction: number;
}

export function summarize(result: TranslateResult): TranslateSummary {
  const lines = result.output.split(/\r?\n/);
  const total = lines.length;
  const unresolved = result.unresolved.length;
  return {
    outputLineCount: total,
    unresolvedCount: unresolved,
    substitutionCount: result.substitutionCount,
    successFraction: total > 0 ? 1 - unresolved / total : 1,
  };
}
